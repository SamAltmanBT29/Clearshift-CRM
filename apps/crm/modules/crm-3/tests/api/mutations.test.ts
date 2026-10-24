import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Roles, signAccessToken } from '@cs/identity';
import {
  CRM3_API_PREFIX,
  CRM3TicketReadSchema,
  CRM3NoteSchema,
  CRM3_TICKET_STATUSES,
  CRM3_TICKET_PRIORITIES,
  type CRM3TicketStatus,
  type CRM3TicketPriority,
} from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import { Crm3Service, DefaultSyntheticContactResolver } from '../../src/services/crm3.service.js';

const CONTACT_1 = '90000000-0000-4000-8000-000000000001';
const CONTACT_2 = '90000000-0000-4000-8000-000000000002';
const MISSING_CONTACT = '99999999-9999-4999-8999-999999999999';
const MISSING_TICKET = '00000000-0000-4000-8000-000000000999';
const EXISTING_TICKET_ID = '30000000-0000-4000-8000-000000000001'; // Seed ticket #1 (New)

describe('CRM-3 Support Tickets & Activities: Mutation API and Domain Validation ([CRM3-03] / #28)', () => {
  let app: FastifyInstance;
  let service: Crm3Service;
  let contactResolver: DefaultSyntheticContactResolver;
  let editorHeaders: { authorization: string };
  let migrationHeaders: { authorization: string };
  let viewerHeaders: { authorization: string };

  beforeEach(async () => {
    contactResolver = new DefaultSyntheticContactResolver();
    service = new Crm3Service({ contactResolver });
    app = buildApp({ service, enforceAuth: true });
    await app.ready();

    const editorToken = await signAccessToken('synthetic-editor', [Roles.EDITOR]);
    editorHeaders = { authorization: `Bearer ${editorToken}` };

    const migrationToken = await signAccessToken('synthetic-migration', [Roles.MIGRATION_RUNNER]);
    migrationHeaders = { authorization: `Bearer ${migrationToken}` };

    const viewerToken = await signAccessToken('synthetic-viewer', [Roles.VIEWER]);
    viewerHeaders = { authorization: `Bearer ${viewerToken}` };
  });

  // ===========================================================================
  // 1. POST /tickets: Ticket Creation & Domain Validation
  // ===========================================================================
  describe('POST /api/v1/crm-tickets/tickets', () => {
    it('creates a ticket with minimal valid fields and applies defaults (status=New, priority=Normal)', async () => {
      const payload = {
        subject: 'Printer issue on floor 3',
        contactId: CONTACT_1,
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload,
      });

      expect(response.statusCode).toBe(201);
      expect(response.headers.location).toMatch(new RegExp(`^${CRM3_API_PREFIX}/tickets/`));

      const body = response.json();
      expect(CRM3TicketReadSchema.safeParse(body).success).toBe(true);
      expect(body.subject).toBe(payload.subject);
      expect(body.status).toBe('New');
      expect(body.priority).toBe('Normal');
      expect(body.contactId).toBe(CONTACT_1);
      expect(body.contactName).toBe('Sarah Connor');
      expect(body.orderRef).toBeNull();
      expect(body.id).toBeDefined();
      expect(body.createdAt).toBeDefined();
      expect(body.updatedAt).toBeDefined();
      expect(response.headers.location).toBe(`${CRM3_API_PREFIX}/tickets/${body.id}`);

      // Confirm persisted in service
      const fetched = await service.getTicketById(body.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.subject).toBe(payload.subject);
    });

    it('creates a ticket with explicit status, priority, orderRef, sourceSystem, sourceId, and initial note', async () => {
      const payload = {
        subject: 'Urgent server outage',
        status: 'Open' as CRM3TicketStatus,
        priority: 'Urgent' as CRM3TicketPriority,
        contactId: CONTACT_2,
        orderRef: 'ORD-9999',
        note: 'Customer reported service completely unreachable',
        sourceSystem: 'zendesk-import',
        sourceId: 'zd-ticket-1001',
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.status).toBe('Open');
      expect(body.priority).toBe('Urgent');
      expect(body.orderRef).toBe('ORD-9999');
      expect(body.sourceSystem).toBe('zendesk-import');
      expect(body.sourceId).toBe('zd-ticket-1001');
      expect(body.contactName).toBe('Lars Lindqvist');

      // Verify the initial note was created and attached
      const notes = await service.getTicketNotes(body.id, { page: 1, pageSize: 10 });
      expect(notes.total).toBe(1);
      expect(notes.items[0]?.noteText).toBe(payload.note);
      expect(notes.items[0]?.authorId).toBe('synthetic-editor');
    });

    it('allows migration_runner role to create tickets', async () => {
      const payload = {
        subject: 'Migrated ticket from Zendesk',
        contactId: CONTACT_1,
        sourceSystem: 'zendesk',
        sourceId: 'zd-456',
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: migrationHeaders,
        payload,
      });

      expect(response.statusCode).toBe(201);
    });

    it('rejects creation when subject is empty or whitespace with 400 VALIDATION_ERROR', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload: {
          subject: '   ',
          contactId: CONTACT_1,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.message).toBe('Invalid ticket input');
      expect(body.details.length).toBeGreaterThan(0);
      expect(typeof body.correlation_id).toBe('string');
    });

    it('rejects creation when contactId is not a valid UUID with 400 VALIDATION_ERROR', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload: {
          subject: 'Valid subject',
          contactId: 'not-a-uuid',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.details.some((d: any) => d.path?.includes('contactId'))).toBe(true);
    });

    it('rejects creation when status is invalid with 400 VALIDATION_ERROR', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload: {
          subject: 'Valid subject',
          contactId: CONTACT_1,
          status: 'InProgress',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects creation when priority is invalid with 400 VALIDATION_ERROR', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload: {
          subject: 'Valid subject',
          contactId: CONTACT_1,
          priority: 'Critical',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects creation when body contains unknown fields (strict schema)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload: {
          subject: 'Valid subject',
          contactId: CONTACT_1,
          unexpectedExtraField: 'malicious',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects creation with unresolvable contact reference returning 422 VALIDATION_ERROR', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload: {
          subject: 'Valid subject',
          contactId: MISSING_CONTACT,
        },
      });

      expect(response.statusCode).toBe(422);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.details[0]).toMatchObject({
        field: 'contactId',
        code: 'invalid_contact_reference',
      });
      expect(body.correlation_id).toBeDefined();
    });

    it('returns 409 CONFLICT when creating a ticket with duplicate (sourceSystem, sourceId)', async () => {
      const payload = {
        subject: 'First ticket',
        contactId: CONTACT_1,
        sourceSystem: 'crm-seed',
        sourceId: 'unique-id-999',
      };

      const first = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload,
      });
      expect(first.statusCode).toBe(201);

      // Repeat with same source pair
      const second = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload: {
          ...payload,
          subject: 'Duplicate ticket attempt',
        },
      });

      expect(second.statusCode).toBe(409);
      const body = second.json();
      expect(body.code).toBe('CONFLICT');
      expect(body.details[0]).toMatchObject({
        field: 'sourceId',
        code: 'duplicate_source_record',
      });
    });

    it('enforces RBAC: viewer role is rejected with 403 FORBIDDEN', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: viewerHeaders,
        payload: {
          subject: 'Viewer attempt',
          contactId: CONTACT_1,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('enforces RBAC: unauthenticated request is rejected with 401 UNAUTHORIZED', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        payload: {
          subject: 'Anon attempt',
          contactId: CONTACT_1,
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ===========================================================================
  // 2. PATCH /tickets/:id: Ticket Updates & Domain Invariants
  // ===========================================================================
  describe('PATCH /api/v1/crm-tickets/tickets/:id', () => {
    it('updates mutable fields (subject, priority, orderRef) and refreshes updatedAt', async () => {
      const before = await service.getTicketById(EXISTING_TICKET_ID);
      expect(before).not.toBeNull();

      const patchPayload = {
        subject: 'Updated subject for ticket #1',
        priority: 'High' as CRM3TicketPriority,
        orderRef: 'ORD-NEW-1234',
      };

      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${EXISTING_TICKET_ID}`,
        headers: editorHeaders,
        payload: patchPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(CRM3TicketReadSchema.safeParse(body).success).toBe(true);
      expect(body.subject).toBe(patchPayload.subject);
      expect(body.priority).toBe('High');
      expect(body.orderRef).toBe('ORD-NEW-1234');
      expect(body.updatedAt >= (before?.updatedAt ?? '')).toBe(true);

      // Verify persistence
      const after = await service.getTicketById(EXISTING_TICKET_ID);
      expect(after?.subject).toBe(patchPayload.subject);
      expect(after?.priority).toBe('High');
      expect(after?.orderRef).toBe('ORD-NEW-1234');
    });

    it('allows clearing orderRef by passing null', async () => {
      const patchPayload = {
        orderRef: null,
      };

      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${EXISTING_TICKET_ID}`,
        headers: editorHeaders,
        payload: patchPayload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().orderRef).toBeNull();
    });

    it('updates contactId to another valid contact and refreshes enriched projection', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${EXISTING_TICKET_ID}`,
        headers: editorHeaders,
        payload: {
          contactId: CONTACT_2,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.contactId).toBe(CONTACT_2);
      expect(body.contactName).toBe('Lars Lindqvist');
      expect(body.contactEmail).toBe('lars.lindqvist@example.test');
    });

    it('rejects PATCH with empty body with 400 VALIDATION_ERROR', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${EXISTING_TICKET_ID}`,
        headers: editorHeaders,
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects protected/system fields on PATCH (id, createdAt, updatedAt, sourceSystem, sourceId)', async () => {
      for (const field of ['id', 'createdAt', 'updatedAt', 'sourceSystem', 'sourceId']) {
        const response = await app.inject({
          method: 'PATCH',
          url: `${CRM3_API_PREFIX}/tickets/${EXISTING_TICKET_ID}`,
          headers: editorHeaders,
          payload: {
            subject: 'New subject',
            [field]: 'protected-value',
          },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects update for non-existent ticket with 404 NOT_FOUND', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${MISSING_TICKET}`,
        headers: editorHeaders,
        payload: {
          subject: 'Will not apply',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.code).toBe('NOT_FOUND');
      expect(body.details[0]).toMatchObject({
        field: 'id',
        code: 'ticket_not_found',
      });
    });

    it('rejects update with invalid UUID param with 400 VALIDATION_ERROR', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/invalid-uuid-string`,
        headers: editorHeaders,
        payload: {
          subject: 'Will not apply',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects update with unresolvable contactId returning 422 VALIDATION_ERROR', async () => {
      const before = await service.getTicketById(EXISTING_TICKET_ID);

      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${EXISTING_TICKET_ID}`,
        headers: editorHeaders,
        payload: {
          contactId: MISSING_CONTACT,
        },
      });

      expect(response.statusCode).toBe(422);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.details[0].code).toBe('invalid_contact_reference');

      // Ensure no state change
      const after = await service.getTicketById(EXISTING_TICKET_ID);
      expect(after?.contactId).toBe(before?.contactId);
    });

    it('rejects illegal status transition returning 422 INVALID_TICKET_STATUS_TRANSITION', async () => {
      // Seed ticket #1 is in 'New' status; New -> Solved is illegal (only New -> Open allowed)
      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${EXISTING_TICKET_ID}`,
        headers: editorHeaders,
        payload: {
          status: 'Solved',
        },
      });

      expect(response.statusCode).toBe(422);
      const body = response.json();
      expect(body.code).toBe('INVALID_TICKET_STATUS_TRANSITION');
      expect(body.details[0].code).toBe('invalid_transition');
    });

    it('enforces RBAC: migration_runner role cannot PATCH tickets (only editor/admin)', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${EXISTING_TICKET_ID}`,
        headers: migrationHeaders,
        payload: {
          priority: 'High',
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ===========================================================================
  // 3. POST /notes and POST /tickets/:id/notes: Append-only Notes & Author Binding
  // ===========================================================================
  describe('POST /api/v1/crm-tickets/notes and POST /api/v1/crm-tickets/tickets/:id/notes', () => {
    it('appends a note via POST /notes, recording authenticated user as author', async () => {
      const payload = {
        ticketId: EXISTING_TICKET_ID,
        noteText: 'Investigated network traces and identified packet drop on port 443',
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/notes`,
        headers: editorHeaders,
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(CRM3NoteSchema.safeParse(body).success).toBe(true);
      expect(body.ticketId).toBe(EXISTING_TICKET_ID);
      expect(body.noteText).toBe(payload.noteText);
      expect(body.authorId).toBe('synthetic-editor');
      expect(body.createdAt).toBeDefined();

      // Verify the note appears at the top of the ticket notes (newest first)
      const listResponse = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets/${EXISTING_TICKET_ID}/notes`,
        headers: editorHeaders,
      });
      expect(listResponse.statusCode).toBe(200);
      const list = listResponse.json();
      expect(list.items[0]?.id).toBe(body.id);
      expect(list.items[0]?.noteText).toBe(payload.noteText);
    });

    it('appends a note via REST alias POST /tickets/:id/notes', async () => {
      const payload = {
        noteText: 'Resolution in progress: replacing network switch',
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets/${EXISTING_TICKET_ID}/notes`,
        headers: editorHeaders,
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.ticketId).toBe(EXISTING_TICKET_ID);
      expect(body.noteText).toBe(payload.noteText);
      expect(body.authorId).toBe('synthetic-editor');
    });

    it('accepts matching authorId in request body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/notes`,
        headers: editorHeaders,
        payload: {
          ticketId: EXISTING_TICKET_ID,
          noteText: 'Valid author note',
          authorId: 'synthetic-editor',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().authorId).toBe('synthetic-editor');
    });

    it('rejects authorId mismatch with 403 AUTHOR_MISMATCH (cannot impersonate another author)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/notes`,
        headers: editorHeaders,
        payload: {
          ticketId: EXISTING_TICKET_ID,
          noteText: 'Spoofed note',
          authorId: 'another-user-id',
        },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.code).toBe('AUTHOR_MISMATCH');
      expect(body.details[0].code).toBe('author_mismatch');
    });

    it('rejects note creation for non-existent ticket with 404 NOT_FOUND', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/notes`,
        headers: editorHeaders,
        payload: {
          ticketId: MISSING_TICKET,
          noteText: 'Note for missing ticket',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.code).toBe('NOT_FOUND');
      expect(body.details[0].code).toBe('ticket_not_found');
    });

    it('rejects empty note text with 400 VALIDATION_ERROR', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/notes`,
        headers: editorHeaders,
        payload: {
          ticketId: EXISTING_TICKET_ID,
          noteText: '   ',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects extra unexpected properties in note body (strict schema)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/notes`,
        headers: editorHeaders,
        payload: {
          ticketId: EXISTING_TICKET_ID,
          noteText: 'Valid text',
          unwantedField: 'injected',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  // ===========================================================================
  // 4. Error Envelope & Correlation ID Standard Verification
  // ===========================================================================
  describe('Error Envelope & Correlation ID Standard', () => {
    it('propagates custom x-correlation-id header across all mutation errors', async () => {
      const correlationId = 'test-corr-mutations-999';

      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: {
          ...editorHeaders,
          'x-correlation-id': correlationId,
        },
        payload: {
          subject: 'Test subject',
          contactId: MISSING_CONTACT,
        },
      });

      expect(response.statusCode).toBe(422);
      const body = response.json();
      expect(body.correlation_id).toBe(correlationId);
      expect(body).toHaveProperty('code');
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('details');
      expect(Array.isArray(body.details)).toBe(true);
    });

    it('generates a synthetic correlation_id when x-correlation-id header is absent', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload: {
          subject: 'Test subject',
          contactId: MISSING_CONTACT,
        },
      });

      expect(response.statusCode).toBe(422);
      const body = response.json();
      expect(typeof body.correlation_id).toBe('string');
      expect(body.correlation_id.length).toBeGreaterThan(0);
    });
  });
});
