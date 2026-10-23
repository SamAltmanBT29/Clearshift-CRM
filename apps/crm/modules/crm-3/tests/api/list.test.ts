import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Roles, signAccessToken } from '@cs/identity';
import {
  CRM3_API_PREFIX,
  CRM3TicketListResponseSchema,
  CRM3NoteListResponseSchema,
  CRM3TicketReadSchema,
  CRM3NoteSchema,
  CRM3_TICKET_STATUSES,
  CRM3_TICKET_PRIORITIES,
  assertValidTicketStatus,
  assertValidTicketPriority,
} from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import { Crm3Service, DefaultSyntheticContactResolver } from '../../src/services/crm3.service.js';

describe('CRM-3 Support Tickets & Activities: List/Read API & Contracts (Issue #27 / [CRM3-02])', () => {
  let app: FastifyInstance;
  let service: Crm3Service;
  let contactResolver: DefaultSyntheticContactResolver;
  let editorHeaders: { authorization: string };
  let viewerHeaders: { authorization: string };

  beforeEach(async () => {
    contactResolver = new DefaultSyntheticContactResolver();
    service = new Crm3Service({ contactResolver });
    app = buildApp({ service, enforceAuth: true });
    await app.ready();

    const editorToken = await signAccessToken('synthetic-editor', [
      Roles.EDITOR,
      Roles.VIEWER,
      Roles.MIGRATION_RUNNER,
    ]);
    editorHeaders = { authorization: `Bearer ${editorToken}` };

    const viewerToken = await signAccessToken('synthetic-viewer', [Roles.VIEWER]);
    viewerHeaders = { authorization: `Bearer ${viewerToken}` };
  });

  // ---------------------------------------------------------------------------
  // 1. Domain Invariants: Status & Priority Enumerations
  // ---------------------------------------------------------------------------
  describe('Domain Invariants: Exact Enumerations', () => {
    it('restricts status to exact SDS values: New, Open, Waiting, Solved, Closed', () => {
      expect(CRM3_TICKET_STATUSES).toEqual([
        'New',
        'Open',
        'Waiting',
        'Solved',
        'Closed',
      ]);

      CRM3_TICKET_STATUSES.forEach((status) => {
        expect(() => assertValidTicketStatus(status)).not.toThrow();
      });

      expect(() => assertValidTicketStatus('Pending')).toThrow(/Domain Invariant Violation/);
      expect(() => assertValidTicketStatus('In Progress')).toThrow(/Domain Invariant Violation/);
      expect(() => assertValidTicketStatus('new')).toThrow(/Domain Invariant Violation/);
    });

    it('restricts priority to exact SDS values: Low, Normal, High, Urgent', () => {
      expect(CRM3_TICKET_PRIORITIES).toEqual([
        'Low',
        'Normal',
        'High',
        'Urgent',
      ]);

      CRM3_TICKET_PRIORITIES.forEach((priority) => {
        expect(() => assertValidTicketPriority(priority)).not.toThrow();
      });

      expect(() => assertValidTicketPriority('Critical')).toThrow(/Domain Invariant Violation/);
      expect(() => assertValidTicketPriority('Medium')).toThrow(/Domain Invariant Violation/);
      expect(() => assertValidTicketPriority('low')).toThrow(/Domain Invariant Violation/);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. GET /tickets: Bounded Paging & Deterministic Ordering
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-tickets/tickets: List & Paging', () => {
    it('returns 200 with default pagination (pageSize=25) and validated JSON contract', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      const parsed = CRM3TicketListResponseSchema.safeParse(data);
      expect(parsed.success).toBe(true);

      expect(data.page).toBe(1);
      expect(data.pageSize).toBe(25);
      expect(data.total).toBe(32);
      expect(data.items).toHaveLength(25);
    });

    it('returns deterministic, non-overlapping records across page 1 and page 2', async () => {
      const page1Res = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?page=1&pageSize=25`,
        headers: viewerHeaders,
      });
      const page2Res = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?page=2&pageSize=25`,
        headers: viewerHeaders,
      });

      expect(page1Res.statusCode).toBe(200);
      expect(page2Res.statusCode).toBe(200);

      const page1 = page1Res.json();
      const page2 = page2Res.json();

      expect(page1.items).toHaveLength(25);
      expect(page2.items).toHaveLength(7);
      expect(page1.total).toBe(32);
      expect(page2.total).toBe(32);

      const page1Ids = new Set(page1.items.map((t: any) => t.id));
      const overlapping = page2.items.filter((t: any) => page1Ids.has(t.id));
      expect(overlapping).toHaveLength(0);
    });

    it('orders tickets descending by createdAt with deterministic id tie-breaker', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?page=1&pageSize=32`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      for (let i = 0; i < data.items.length - 1; i++) {
        const currTime = new Date(data.items[i].createdAt).getTime();
        const nextTime = new Date(data.items[i + 1].createdAt).getTime();
        expect(currTime).toBeGreaterThanOrEqual(nextTime);
        if (currTime === nextTime) {
          expect(data.items[i].id.localeCompare(data.items[i + 1].id)).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('rejects pageSize above 100 with HTTP 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?pageSize=101`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('INVALID_QUERY');
    });

    it('rejects invalid page number (page < 1) with HTTP 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?page=0`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('INVALID_QUERY');
    });

    it('safely handles unknown query parameters without error or SQL injection risk', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?unknownParam=123&drop_table=true`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.items).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Server-side Search & Filtering
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-tickets/tickets: Search and Filtering', () => {
    it('filters tickets strictly by status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?status=Open`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.items.length).toBeGreaterThan(0);
      data.items.forEach((t: any) => {
        expect(t.status).toBe('Open');
      });
    });

    it('filters tickets strictly by priority', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?priority=Urgent`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.items.length).toBeGreaterThan(0);
      data.items.forEach((t: any) => {
        expect(t.priority).toBe('Urgent');
      });
    });

    it('filters tickets by contactId', async () => {
      const targetContact = '90000000-0000-4000-8000-000000000001';
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?contactId=${targetContact}`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.items.length).toBeGreaterThan(0);
      data.items.forEach((t: any) => {
        expect(t.contactId).toBe(targetContact);
      });
    });

    it('performs case-insensitive server-side search by subject', async () => {
      const searchTerm = encodeURIComponent('CUSTOMER SUPPORT REQUEST #10');
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?search=${searchTerm}`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.items.length).toBeGreaterThan(0);
      data.items.forEach((t: any) => {
        expect(t.subject.toLowerCase()).toContain('customer support request #10');
      });
    });

    it('returns empty result array with total=0 when no records match filter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?search=NonExistentSubjectSearchPattern123456`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.items).toEqual([]);
      expect(data.total).toBe(0);
    });

    it('rejects invalid status filter with HTTP 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?status=NotAStatus`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('INVALID_QUERY');
    });

    it('rejects invalid priority filter with HTTP 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?priority=Critical`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('INVALID_QUERY');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. GET /tickets/:id: Single Ticket Read & Contact Enrichment
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-tickets/tickets/:id', () => {
    it('returns 200 with ticket and enriched contact name/email', async () => {
      const ticketId = '30000000-0000-4000-8000-000000000001';
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets/${ticketId}`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      const parsed = CRM3TicketReadSchema.safeParse(data);
      expect(parsed.success).toBe(true);
      expect(data.id).toBe(ticketId);
      expect(data.contactName).toBe('Sarah Connor');
      expect(data.contactEmail).toBe('sarah.connor@example.test');
    });

    it('returns 404 NOT_FOUND when ticket UUID does not exist', async () => {
      const missingId = '00000000-0000-4000-8000-000000000999';
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets/${missingId}`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.code).toBe('NOT_FOUND');
    });

    it('returns 400 VALIDATION_ERROR when ID is not a valid UUID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets/invalid-not-uuid`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. POST /tickets: Ticket Creation & Invariants
  // ---------------------------------------------------------------------------
  describe('POST /api/v1/crm-tickets/tickets', () => {
    it('creates a new ticket with default status New and priority Normal', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload: {
          subject: 'Payment failed on checkout',
          contactId: '90000000-0000-4000-8000-000000000001',
          orderRef: 'ORD-5544',
        },
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data.subject).toBe('Payment failed on checkout');
      expect(data.status).toBe('New');
      expect(data.priority).toBe('Normal');
      expect(data.orderRef).toBe('ORD-5544');
      expect(data.contactName).toBe('Sarah Connor');
    });

    it('creates initial note when note field is provided in payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload: {
          subject: 'Urgent system crash issue',
          status: 'Open',
          priority: 'Urgent',
          contactId: '90000000-0000-4000-8000-000000000001',
          note: 'Customer reported unexpected 500 error on checkout page.',
        },
      });

      expect(response.statusCode).toBe(201);
      const createdTicket = response.json();

      // Verify the note is present in ticket notes
      const notesRes = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets/${createdTicket.id}/notes`,
        headers: viewerHeaders,
      });
      expect(notesRes.statusCode).toBe(200);
      const notes = notesRes.json();
      expect(notes.items.length).toBeGreaterThanOrEqual(1);
      expect(notes.items[0].noteText).toBe(
        'Customer reported unexpected 500 error on checkout page.'
      );
    });

    it('rejects ticket creation with 422 Unprocessable when contact does not exist', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload: {
          subject: 'Ticket with non-existent contact',
          contactId: '99999999-9999-4999-8999-999999999999',
        },
      });

      expect(response.statusCode).toBe(422);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.message).toContain('does not exist');
    });

    it('rejects whitespace-only subject with 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload: {
          subject: '   ',
          contactId: '90000000-0000-4000-8000-000000000001',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid status enumeration on create with 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload: {
          subject: 'Ticket with bogus status',
          status: 'InvalidStatus',
          contactId: '90000000-0000-4000-8000-000000000001',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid priority enumeration on create with 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload: {
          subject: 'Ticket with bogus priority',
          priority: 'Critical',
          contactId: '90000000-0000-4000-8000-000000000001',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. PATCH /tickets/:id: Update Ticket
  // ---------------------------------------------------------------------------
  describe('PATCH /api/v1/crm-tickets/tickets/:id', () => {
    it('updates ticket status and priority successfully', async () => {
      const ticketId = '30000000-0000-4000-8000-000000000001';
      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${ticketId}`,
        headers: editorHeaders,
        payload: {
          status: 'Solved',
          priority: 'Urgent',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.status).toBe('Solved');
      expect(data.priority).toBe('Urgent');
    });

    it('rejects update with empty payload with 400 Bad Request', async () => {
      const ticketId = '30000000-0000-4000-8000-000000000001';
      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${ticketId}`,
        headers: editorHeaders,
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 NOT_FOUND when updating non-existent ticket', async () => {
      const missingId = '00000000-0000-4000-8000-000000000999';
      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${missingId}`,
        headers: editorHeaders,
        payload: {
          status: 'Closed',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.code).toBe('NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Notes API: GET /tickets/:id/notes & POST /notes (Newest First)
  // ---------------------------------------------------------------------------
  describe('Notes API: Append-Only & Newest-First Ordering', () => {
    it('returns ticket notes newest-first with deterministic tie-breaker', async () => {
      const ticketId = '30000000-0000-4000-8000-000000000001';
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets/${ticketId}/notes`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      const parsed = CRM3NoteListResponseSchema.safeParse(data);
      expect(parsed.success).toBe(true);

      expect(data.items.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < data.items.length - 1; i++) {
        const curr = new Date(data.items[i].createdAt).getTime();
        const next = new Date(data.items[i + 1].createdAt).getTime();
        expect(curr).toBeGreaterThanOrEqual(next);
      }
    });

    it('appends a new note via POST /notes and validates schema', async () => {
      const ticketId = '30000000-0000-4000-8000-000000000001';
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/notes`,
        headers: editorHeaders,
        payload: {
          ticketId,
          noteText: 'Investigated log files: confirmed payment gateway timeout.',
          authorId: 'senior-engineer',
        },
      });

      expect(response.statusCode).toBe(201);
      const note = response.json();
      const parsed = CRM3NoteSchema.safeParse(note);
      expect(parsed.success).toBe(true);
      expect(note.ticketId).toBe(ticketId);
      expect(note.authorId).toBe('senior-engineer');
      expect(note.noteText).toBe(
        'Investigated log files: confirmed payment gateway timeout.'
      );
    });

    it('appends note via POST /tickets/:id/notes REST alias', async () => {
      const ticketId = '30000000-0000-4000-8000-000000000001';
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets/${ticketId}/notes`,
        headers: editorHeaders,
        payload: {
          noteText: 'Customer replied: issue resolved after clearing cache.',
        },
      });

      expect(response.statusCode).toBe(201);
      const note = response.json();
      expect(note.ticketId).toBe(ticketId);
      expect(note.noteText).toBe(
        'Customer replied: issue resolved after clearing cache.'
      );
    });

    it('returns 404 NOT_FOUND when appending note to non-existent ticket', async () => {
      const missingId = '00000000-0000-4000-8000-000000000999';
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/notes`,
        headers: editorHeaders,
        payload: {
          ticketId: missingId,
          noteText: 'Note for missing ticket',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.code).toBe('NOT_FOUND');
    });

    it('rejects empty note text with 400 Bad Request', async () => {
      const ticketId = '30000000-0000-4000-8000-000000000001';
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/notes`,
        headers: editorHeaders,
        payload: {
          ticketId,
          noteText: '   ',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Authentication & Authorization (401 / 403)
  // ---------------------------------------------------------------------------
  describe('Authentication & RBAC Matrix', () => {
    it('rejects unauthenticated GET /tickets with 401 Unauthorized', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: {},
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('rejects invalid or malformed bearer token with 401 Unauthorized', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: { authorization: 'Bearer invalid.token.value' },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('allows viewer role to read tickets', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
    });

    it('rejects viewer role from creating tickets with 403 Forbidden', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: viewerHeaders,
        payload: {
          subject: 'Unauthorized ticket creation attempt',
          contactId: '90000000-0000-4000-8000-000000000001',
        },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.code).toBe('FORBIDDEN');
    });

    it('allows editor role to create tickets', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload: {
          subject: 'Editor created ticket',
          contactId: '90000000-0000-4000-8000-000000000001',
        },
      });

      expect(response.statusCode).toBe(201);
    });
  });
});
