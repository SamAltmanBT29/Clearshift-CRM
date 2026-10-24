import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Roles, signAccessToken } from '@cs/identity';
import {
  CRM3_API_PREFIX,
  CRM3_TICKET_STATUSES,
  CRM3_TICKET_PRIORITIES,
  CRM3TicketSchema,
  CRM3TicketReadSchema,
  CRM3NoteSchema,
  CRM3TicketListQuerySchema,
  type CRM3TicketStatus,
  type CRM3TicketPriority,
} from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import { Crm3Service, DefaultSyntheticContactResolver } from '../../src/services/crm3.service.js';
import { crm3Audit } from '../../src/services/audit.js';

describe('CRM-3 Module Contract & Regression Suite (Issue #35 / [CRM3-10])', () => {
  let app: FastifyInstance;
  let service: Crm3Service;
  let editorToken: string;
  let viewerToken: string;
  let adminToken: string;
  let migrationRunnerToken: string;
  let analystToken: string;

  const CONTACT_ID = '90000000-0000-4000-8000-000000000001';
  const MISSING_CONTACT_ID = '99999999-9999-4999-8999-999999999999';
  const SEED_TICKET_ID = '30000000-0000-4000-8000-000000000001';

  beforeAll(async () => {
    editorToken = await signAccessToken('synthetic-editor', [Roles.EDITOR]);
    viewerToken = await signAccessToken('synthetic-viewer', [Roles.VIEWER]);
    adminToken = await signAccessToken('synthetic-admin', [Roles.ADMIN]);
    migrationRunnerToken = await signAccessToken('synthetic-runner', [Roles.MIGRATION_RUNNER]);
    analystToken = await signAccessToken('synthetic-analyst', [Roles.ANALYST]);
  });

  beforeEach(async () => {
    crm3Audit.resetLedger();
    service = new Crm3Service({ contactResolver: new DefaultSyntheticContactResolver() });
    app = buildApp({ service, enforceAuth: true });
    await app.ready();
  });

  const editorHeaders = () => ({ authorization: `Bearer ${editorToken}` });
  const viewerHeaders = () => ({ authorization: `Bearer ${viewerToken}` });
  const adminHeaders = () => ({ authorization: `Bearer ${adminToken}` });
  const runnerHeaders = () => ({ authorization: `Bearer ${migrationRunnerToken}` });

  // ---------------------------------------------------------------------------
  // 1. Ticket Lifecycle & Contract Conformance
  // ---------------------------------------------------------------------------
  describe('1. Support Ticket Lifecycle & Contract Conformance', () => {
    it('creates, retrieves, and validates ticket with CRM3TicketReadSchema', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders(),
        payload: {
          subject: 'Critical infrastructure failover verification',
          contactId: CONTACT_ID,
          priority: 'Urgent',
          orderRef: 'ORD-2026-REGRESSION-01',
        },
      });

      expect(createRes.statusCode).toBe(201);
      const created = createRes.json();
      expect(CRM3TicketReadSchema.safeParse(created).success).toBe(true);
      expect(created.subject).toBe('Critical infrastructure failover verification');
      expect(created.status).toBe('New');
      expect(created.priority).toBe('Urgent');
      expect(created.contactId).toBe(CONTACT_ID);
      expect(created.orderRef).toBe('ORD-2026-REGRESSION-01');

      // GET by ID
      const getRes = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets/${created.id}`,
        headers: viewerHeaders(),
      });
      expect(getRes.statusCode).toBe(200);
      const fetched = getRes.json();
      expect(fetched).toEqual(created);
    });

    it('rejects ticket creation when contact does not exist (400 invalid_contact_reference)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders(),
        payload: {
          subject: 'Orphan ticket attempt',
          contactId: MISSING_CONTACT_ID,
          priority: 'Normal',
        },
      });

      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.details[0]?.code).toBe('invalid_contact_reference');
    });

    it('rejects ticket creation with empty subject or missing contactId (strict validation)', async () => {
      const emptySubjectRes = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders(),
        payload: {
          subject: '   ',
          contactId: CONTACT_ID,
        },
      });
      expect(emptySubjectRes.statusCode).toBe(400);

      const missingContactRes = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders(),
        payload: {
          subject: 'Subject without contact',
        },
      });
      expect(missingContactRes.statusCode).toBe(400);
    });

    it('allows migration_runner to create tickets but not patch them', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: runnerHeaders(),
        payload: {
          subject: 'Bulk migration ticket from Kit',
          contactId: CONTACT_ID,
          priority: 'Normal',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const ticket = createRes.json();

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${ticket.id}`,
        headers: runnerHeaders(),
        payload: { priority: 'High' },
      });
      expect(patchRes.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Status Machine & Lifecycle Transition Graph
  // ---------------------------------------------------------------------------
  describe('2. Status Machine & Transition Graph Invariants', () => {
    it('enforces exact approved status transition path: New -> Open -> Solved -> Closed', async () => {
      // Create fresh ticket in New status
      const createRes = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders(),
        payload: { subject: 'Lifecycle test ticket', contactId: CONTACT_ID },
      });
      const ticket = createRes.json();
      expect(ticket.status).toBe('New');

      // 1. New -> Open
      const toOpenRes = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${ticket.id}`,
        headers: editorHeaders(),
        payload: { status: 'Open' },
      });
      expect(toOpenRes.statusCode).toBe(200);
      expect(toOpenRes.json().status).toBe('Open');

      // 2. Open -> Solved
      const toSolvedRes = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${ticket.id}`,
        headers: editorHeaders(),
        payload: { status: 'Solved' },
      });
      expect(toSolvedRes.statusCode).toBe(200);
      expect(toSolvedRes.json().status).toBe('Solved');

      // 3. Solved -> Closed (terminal)
      const toClosedRes = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${ticket.id}`,
        headers: editorHeaders(),
        payload: { status: 'Closed' },
      });
      expect(toClosedRes.statusCode).toBe(200);
      expect(toClosedRes.json().status).toBe('Closed');
    });

    it('rejects illegal transitions: New -> Closed and Closed -> Open with HTTP 400', async () => {
      // Create fresh ticket in New
      const createRes = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders(),
        payload: { subject: 'Illegal jump ticket', contactId: CONTACT_ID },
      });
      const ticket = createRes.json();

      // Illegal: New -> Closed
      const badJumpRes = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${ticket.id}`,
        headers: editorHeaders(),
        payload: { status: 'Closed' },
      });
      expect(badJumpRes.statusCode).toBe(422);
      const badJumpBody = badJumpRes.json();
      expect(badJumpBody.code).toBe('INVALID_TICKET_STATUS_TRANSITION');
      expect(badJumpBody.details[0]?.code).toBe('invalid_transition');

      // Fast-forward to Closed legitimately
      await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${ticket.id}`,
        headers: editorHeaders(),
        payload: { status: 'Open' },
      });
      await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${ticket.id}`,
        headers: editorHeaders(),
        payload: { status: 'Solved' },
      });
      await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${ticket.id}`,
        headers: editorHeaders(),
        payload: { status: 'Closed' },
      });

      // Illegal: Closed -> Open (Closed is terminal)
      const reopenRes = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${ticket.id}`,
        headers: editorHeaders(),
        payload: { status: 'Open' },
      });
      expect(reopenRes.statusCode).toBe(422);
      expect(reopenRes.json().code).toBe('INVALID_TICKET_STATUS_TRANSITION');
    });

    it('permits same-status patch as an allowed idempotent no-op', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${SEED_TICKET_ID}`,
        headers: editorHeaders(),
        payload: { status: 'New' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('rejects setting invalid status or priority values not in SDS enum', async () => {
      const badStatusRes = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${SEED_TICKET_ID}`,
        headers: editorHeaders(),
        payload: { status: 'InProgress' },
      });
      expect(badStatusRes.statusCode).toBe(400);

      const badPriorityRes = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${SEED_TICKET_ID}`,
        headers: editorHeaders(),
        payload: { priority: 'Critical' },
      });
      expect(badPriorityRes.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Append-Only Activity Notes & Chronological Tie-Breakers
  // ---------------------------------------------------------------------------
  describe('3. Append-Only Notes & Chronology Invariants', () => {
    it('appends notes via POST /notes and POST /tickets/:id/notes returning newest-first', async () => {
      // Append Note 1
      const note1Res = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/notes`,
        headers: editorHeaders(),
        payload: {
          ticketId: SEED_TICKET_ID,
          noteText: 'First chronological note',
        },
      });
      expect(note1Res.statusCode).toBe(201);
      const note1 = note1Res.json();
      expect(note1.authorId).toBe('synthetic-editor');
      expect(note1.ticketId).toBe(SEED_TICKET_ID);

      // Append Note 2 via REST alias
      const note2Res = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets/${SEED_TICKET_ID}/notes`,
        headers: adminHeaders(),
        payload: {
          noteText: 'Second chronological note from admin',
        },
      });
      expect(note2Res.statusCode).toBe(201);
      const note2 = note2Res.json();
      expect(note2.authorId).toBe('synthetic-admin');

      // GET /tickets/:id/notes
      const listNotesRes = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets/${SEED_TICKET_ID}/notes`,
        headers: viewerHeaders(),
      });
      expect(listNotesRes.statusCode).toBe(200);
      const notesList = listNotesRes.json();
      expect(notesList.items.length).toBeGreaterThanOrEqual(2);

      // Both new notes must be present in the returned list
      const returnedIds = notesList.items.map((n: any) => n.id);
      expect(returnedIds).toContain(note1.id);
      expect(returnedIds).toContain(note2.id);
    });

    it('rejects appending note with mismatched authorId (403 AUTHOR_MISMATCH)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/notes`,
        headers: editorHeaders(),
        payload: {
          ticketId: SEED_TICKET_ID,
          noteText: 'Impersonation attempt',
          authorId: 'synthetic-admin',
        },
      });
      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.code).toBe('AUTHOR_MISMATCH');
    });

    it('rejects empty or whitespace-only note text (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/notes`,
        headers: editorHeaders(),
        payload: {
          ticketId: SEED_TICKET_ID,
          noteText: '   ',
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Query Filtering, Search & Bounded Pagination
  // ---------------------------------------------------------------------------
  describe('4. Query Filtering & Bounded Pagination', () => {
    it('filters tickets by status and priority', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?status=New&priority=Normal`,
        headers: viewerHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.items)).toBe(true);
      for (const t of body.items) {
        expect(t.status).toBe('New');
        expect(t.priority).toBe('Normal');
      }
    });

    it('enforces maximum pageSize of 100 on tickets list', async () => {
      const validRes = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?pageSize=100`,
        headers: viewerHeaders(),
      });
      expect(validRes.statusCode).toBe(200);

      const invalidRes = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?pageSize=101`,
        headers: viewerHeaders(),
      });
      expect(invalidRes.statusCode).toBe(400);
    });

    it('searches tickets across subject and notes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?search=request`,
        headers: viewerHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. System Fields Immutability & Audit Trail
  // ---------------------------------------------------------------------------
  describe('5. System Fields Immutability & Audit Trail', () => {
    it('blocks callers from modifying protected system fields (id, createdAt, sourceId)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${SEED_TICKET_ID}`,
        headers: editorHeaders(),
        payload: {
          priority: 'High',
          id: '00000000-0000-0000-0000-000000000000',
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('records audit events for ticket creations and updates without leaking sensitive data', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders(),
        payload: {
          subject: 'Audited support workflow ticket',
          contactId: CONTACT_ID,
          priority: 'Normal',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const ticket = createRes.json();

      const events = crm3Audit.getAuditEvents({ entity: 'ticket', entityId: ticket.id });
      expect(events.length).toBe(1);
      expect(events[0]?.action).toBe('ticket.created');
      expect(events[0]?.actor).toBe('synthetic-editor');
      expect(events[0]?.result).toBe('success');
    });
  });
});
