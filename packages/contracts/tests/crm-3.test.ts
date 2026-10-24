import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CRM3_API_PREFIX,
  CRM3_TICKET_STATUSES,
  CRM3_TICKET_PRIORITIES,
  CRM3_TICKET_STATUS_TRANSITIONS,
  CRM3TicketStatusSchema,
  CRM3TicketPrioritySchema,
  CRM3EntityTypeSchema,
  CRM3ImportStatusSchema,
  CRM3TicketSchema,
  CRM3TicketReadSchema,
  CRM3NoteSchema,
  CRM3TicketCreateSchema,
  CRM3TicketPatchSchema,
  CRM3NoteCreateSchema,
  CRM3TicketListQuerySchema,
  CRM3NoteListQuerySchema,
  CRM3ImportBatchSchema,
  CRM3ImportReceiptSchema,
  assertValidTicketStatus,
  assertValidTicketPriority,
  isTicketStatusTransitionAllowed,
} from '../src/crm-3.js';

const crm3OpenApi = readFileSync(new URL('../openapi/crm-3.yaml', import.meta.url), 'utf8');

describe('CRM-3 Support Tickets & Activities Public Contracts & OpenAPI (Issue #147 / [CRM3-14])', () => {
  // ---------------------------------------------------------------------------
  // 1. OpenAPI 3.1 Spec Integrity
  // ---------------------------------------------------------------------------
  describe('OpenAPI 3.1 Specification Integrity', () => {
    it('locates and verifies canonical crm-3.yaml metadata and version', () => {
      expect(crm3OpenApi).toContain('openapi: 3.1.0');
      expect(crm3OpenApi).toContain('ClearShift CRM-3 Support Tickets and Activities API');
      expect(crm3OpenApi).toContain('version: 1.0.0');
    });

    it('documents all required endpoints in OpenAPI paths', () => {
      expect(crm3OpenApi).toContain('  /api/v1/crm-tickets/tickets:');
      expect(crm3OpenApi).toContain('  /api/v1/crm-tickets/tickets/{id}:');
      expect(crm3OpenApi).toContain('  /api/v1/crm-tickets/tickets/{id}/notes:');
      expect(crm3OpenApi).toContain('  /api/v1/crm-tickets/notes:');
      expect(crm3OpenApi).toContain('  /api/v1/crm-tickets/imports:');
      expect(crm3OpenApi).toContain('  /api/v1/crm-tickets/imports/{batch}:');
    });

    it('documents all operations matching contracts', () => {
      expect(crm3OpenApi).toContain('operationId: listCRM3Tickets');
      expect(crm3OpenApi).toContain('operationId: createCRM3Ticket');
      expect(crm3OpenApi).toContain('operationId: getCRM3Ticket');
      expect(crm3OpenApi).toContain('operationId: patchCRM3Ticket');
      expect(crm3OpenApi).toContain('operationId: listCRM3TicketNotes');
      expect(crm3OpenApi).toContain('operationId: addCRM3Note');
      expect(crm3OpenApi).toContain('operationId: createCRM3Import');
      expect(crm3OpenApi).toContain('operationId: getCRM3Import');
    });

    it('documents bearerAuth security scheme for protected routes', () => {
      expect(crm3OpenApi).toContain('bearerAuth:');
      expect(crm3OpenApi).toContain('type: http');
      expect(crm3OpenApi).toContain('scheme: bearer');
      expect(crm3OpenApi).toContain('bearerFormat: JWT');
    });

    it('documents standardized error envelope and HTTP status responses', () => {
      expect(crm3OpenApi).toContain('ValidationError:');
      expect(crm3OpenApi).toContain('UnauthorizedError:');
      expect(crm3OpenApi).toContain('ForbiddenError:');
      expect(crm3OpenApi).toContain('NotFoundError:');
      expect(crm3OpenApi).toContain('ConflictError:');
      expect(crm3OpenApi).toContain('ErrorEnvelope:');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Domain Invariants & Enums
  // ---------------------------------------------------------------------------
  describe('Domain Invariants & Enums', () => {
    it('enforces exact CRM-3 ticket status set: New, Open, Waiting, Solved, Closed', () => {
      expect(CRM3_TICKET_STATUSES).toEqual(['New', 'Open', 'Waiting', 'Solved', 'Closed']);
      CRM3_TICKET_STATUSES.forEach((status) => {
        expect(CRM3TicketStatusSchema.safeParse(status).success).toBe(true);
      });
      expect(CRM3TicketStatusSchema.safeParse('Pending').success).toBe(false);
      expect(CRM3TicketStatusSchema.safeParse('In Progress').success).toBe(false);
    });

    it('enforces exact CRM-3 ticket priority set: Low, Normal, High, Urgent', () => {
      expect(CRM3_TICKET_PRIORITIES).toEqual(['Low', 'Normal', 'High', 'Urgent']);
      CRM3_TICKET_PRIORITIES.forEach((priority) => {
        expect(CRM3TicketPrioritySchema.safeParse(priority).success).toBe(true);
      });
      expect(CRM3TicketPrioritySchema.safeParse('Critical').success).toBe(false);
      expect(CRM3TicketPrioritySchema.safeParse('Medium').success).toBe(false);
    });

    it('assertValidTicketStatus does not throw for valid statuses and throws for invalid', () => {
      expect(() => assertValidTicketStatus('New')).not.toThrow();
      expect(() => assertValidTicketStatus('Closed')).not.toThrow();
      expect(() => assertValidTicketStatus('InvalidStatus')).toThrow(
        /Domain Invariant Violation/
      );
    });

    it('assertValidTicketPriority does not throw for valid priorities and throws for invalid', () => {
      expect(() => assertValidTicketPriority('Low')).not.toThrow();
      expect(() => assertValidTicketPriority('Urgent')).not.toThrow();
      expect(() => assertValidTicketPriority('InvalidPriority')).toThrow(
        /Domain Invariant Violation/
      );
    });

    it('validates CRM-3 entity types: ticket, note', () => {
      expect(CRM3EntityTypeSchema.safeParse('ticket').success).toBe(true);
      expect(CRM3EntityTypeSchema.safeParse('note').success).toBe(true);
      expect(CRM3EntityTypeSchema.safeParse('contact').success).toBe(false);
    });

    it('validates CRM-3 import statuses', () => {
      const allowed = ['pending', 'processing', 'completed', 'failed'];
      allowed.forEach((status) => {
        expect(CRM3ImportStatusSchema.safeParse(status).success).toBe(true);
      });
      expect(CRM3ImportStatusSchema.safeParse('halted').success).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Query & Pagination Bounds
  // ---------------------------------------------------------------------------
  describe('Query & Pagination Bounds', () => {
    it('defaults ticket list query to page 1 and pageSize 25', () => {
      const parsed = CRM3TicketListQuerySchema.parse({});
      expect(parsed.page).toBe(1);
      expect(parsed.pageSize).toBe(25);
    });

    it('enforces bounded pageSize limit of 100 for tickets', () => {
      expect(CRM3TicketListQuerySchema.safeParse({ pageSize: 100 }).success).toBe(true);
      expect(CRM3TicketListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
      expect(CRM3TicketListQuerySchema.safeParse({ page: 0 }).success).toBe(false);
      expect(CRM3TicketListQuerySchema.safeParse({ page: -1 }).success).toBe(false);
    });

    it('defaults note list query to page 1 and pageSize 25', () => {
      const parsed = CRM3NoteListQuerySchema.parse({});
      expect(parsed.page).toBe(1);
      expect(parsed.pageSize).toBe(25);
    });

    it('enforces bounded pageSize limit of 100 for notes', () => {
      expect(CRM3NoteListQuerySchema.safeParse({ pageSize: 100 }).success).toBe(true);
      expect(CRM3NoteListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Request Payloads & Validation
  // ---------------------------------------------------------------------------
  describe('Request Payloads & Validation', () => {
    const validContactId = '90000000-0000-4000-8000-000000000001';
    const validTicketId = '30000000-0000-4000-8000-000000000001';

    it('validates CRM3TicketCreateSchema with defaults (status: New, priority: Normal)', () => {
      const payload = {
        subject: 'Database connection timeouts',
        contactId: validContactId,
      };
      const parsed = CRM3TicketCreateSchema.parse(payload);
      expect(parsed.subject).toBe('Database connection timeouts');
      expect(parsed.status).toBe('New');
      expect(parsed.priority).toBe('Normal');
      expect(parsed.contactId).toBe(validContactId);
    });

    it('rejects CRM3TicketCreateSchema when subject is empty or missing', () => {
      expect(
        CRM3TicketCreateSchema.safeParse({
          subject: '   ',
          contactId: validContactId,
        }).success
      ).toBe(false);

      expect(
        CRM3TicketCreateSchema.safeParse({
          contactId: validContactId,
        }).success
      ).toBe(false);
    });

    it('rejects CRM3TicketCreateSchema with extra properties (strict)', () => {
      expect(
        CRM3TicketCreateSchema.safeParse({
          subject: 'Valid subject',
          contactId: validContactId,
          extraField: 'not-allowed',
        }).success
      ).toBe(false);
    });

    it('validates CRM3TicketPatchSchema and requires at least one field', () => {
      expect(CRM3TicketPatchSchema.safeParse({}).success).toBe(false);
      expect(CRM3TicketPatchSchema.safeParse({ status: 'Solved' }).success).toBe(true);
      expect(CRM3TicketPatchSchema.safeParse({ priority: 'Urgent' }).success).toBe(true);
      expect(
        CRM3TicketPatchSchema.safeParse({
          subject: 'Updated subject',
          orderRef: null,
        }).success
      ).toBe(true);
    });

    it('validates CRM3NoteCreateSchema and rejects empty noteText', () => {
      expect(
        CRM3NoteCreateSchema.safeParse({
          ticketId: validTicketId,
          noteText: 'Customer confirmed fix works',
        }).success
      ).toBe(true);

      expect(
        CRM3NoteCreateSchema.safeParse({
          ticketId: validTicketId,
          noteText: '   ',
        }).success
      ).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Migration Import Schemas
  // ---------------------------------------------------------------------------
  describe('Migration Import Schemas', () => {
    it('validates CRM3ImportBatchSchema', () => {
      const now = new Date().toISOString();
      const batch = {
        id: '50000000-0000-4000-8000-000000000001',
        sourceSystem: 'zendesk',
        status: 'completed',
        loadedCount: 50,
        rejectedCount: 0,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      };
      expect(CRM3ImportBatchSchema.safeParse(batch).success).toBe(true);

      // Rejects negative counts
      expect(
        CRM3ImportBatchSchema.safeParse({
          ...batch,
          loadedCount: -1,
        }).success
      ).toBe(false);
    });

    it('validates CRM3ImportReceiptSchema with positive sourceRow', () => {
      const now = new Date().toISOString();
      const receipt = {
        id: '60000000-0000-4000-8000-000000000001',
        batchId: '50000000-0000-4000-8000-000000000001',
        sourceRow: 1,
        entity: 'ticket',
        sourceSystem: 'zendesk',
        sourceId: 'ZEN-1234',
        targetId: '30000000-0000-4000-8000-000000000001',
        idempotencyKey: 'batch_500_row_1',
        createdAt: now,
      };
      expect(CRM3ImportReceiptSchema.safeParse(receipt).success).toBe(true);

      // Rejects non-positive sourceRow
      expect(
        CRM3ImportReceiptSchema.safeParse({
          ...receipt,
          sourceRow: 0,
        }).success
      ).toBe(false);
    });
  });
});

describe('CRM-3 Support Tickets ticket status transition contract', () => {
  it('defines a transition entry for every ticket status', () => {
    expect(Object.keys(CRM3_TICKET_STATUS_TRANSITIONS).sort()).toEqual(
      [...CRM3_TICKET_STATUSES].sort()
    );
  });

  it('only lists valid statuses as transition targets', () => {
    for (const targets of Object.values(CRM3_TICKET_STATUS_TRANSITIONS)) {
      for (const target of targets) {
        expect(CRM3_TICKET_STATUSES).toContain(target);
      }
    }
  });

  it('pins the approved V1 transition map', () => {
    expect(CRM3_TICKET_STATUS_TRANSITIONS).toEqual({
      New: ['Open'],
      Open: ['Waiting', 'Solved'],
      Waiting: ['Open', 'Solved'],
      Solved: ['Closed', 'Open'],
      Closed: [],
    });
  });

  it('treats same-status updates as allowed no-ops, including terminal Closed', () => {
    for (const status of CRM3_TICKET_STATUSES) {
      expect(isTicketStatusTransitionAllowed(status, status)).toBe(true);
    }
  });

  it('rejects skipping states and leaving the terminal Closed state', () => {
    expect(isTicketStatusTransitionAllowed('New', 'Solved')).toBe(false);
    expect(isTicketStatusTransitionAllowed('New', 'Closed')).toBe(false);
    expect(isTicketStatusTransitionAllowed('Closed', 'Open')).toBe(false);
    expect(isTicketStatusTransitionAllowed('Waiting', 'Closed')).toBe(false);
  });

  it('documents the transition rule and its error code on PATCH in OpenAPI', () => {
    expect(crm3OpenApi).toContain('INVALID_TICKET_STATUS_TRANSITION');
    expect(crm3OpenApi).toContain('TransitionError');
  });
});
