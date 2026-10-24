import { describe, it, expect } from 'vitest';
import {
  CRM3TicketCreateSchema,
  CRM3TicketPatchSchema,
  CRM3NoteCreateSchema,
  CRM3_TICKET_STATUSES,
  CRM3_TICKET_PRIORITIES,
  CRM3_TICKET_STATUS_TRANSITIONS,
  isTicketStatusTransitionAllowed,
} from '@clearshift/contracts';

describe('CRM-3 Web TicketForm Client Validation & Contracts ([CRM3-10] / Issue #35)', () => {
  describe('1. Ticket Creation Form Contract & Validation', () => {
    it('validates a well-formed ticket creation payload', () => {
      const validPayload = {
        subject: 'Cannot access billing portal',
        status: 'Open',
        priority: 'High',
        contactId: '90000000-0000-4000-8000-000000000001',
        orderRef: 'ORD-2026-001',
        note: 'Customer called helpline regarding subscription renewal failure.',
      };

      const parsed = CRM3TicketCreateSchema.safeParse(validPayload);
      expect(parsed.success).toBe(true);
    });

    it('rejects empty or whitespace-only subject', () => {
      const emptyPayload = {
        subject: '   ',
        status: 'New',
        priority: 'Normal',
        contactId: '90000000-0000-4000-8000-000000000001',
      };

      const parsed = CRM3TicketCreateSchema.safeParse(emptyPayload);
      expect(parsed.success).toBe(false);
    });

    it('rejects invalid ticket status values', () => {
      const invalidStatus = {
        subject: 'Valid subject',
        status: 'In Progress', // Forbidden in V1 SDS
        priority: 'Normal',
        contactId: '90000000-0000-4000-8000-000000000001',
      };

      const parsed = CRM3TicketCreateSchema.safeParse(invalidStatus);
      expect(parsed.success).toBe(false);
    });

    it('rejects invalid ticket priority values', () => {
      const invalidPriority = {
        subject: 'Valid subject',
        status: 'New',
        priority: 'Critical', // Forbidden in V1 SDS (must be Urgent)
        contactId: '90000000-0000-4000-8000-000000000001',
      };

      const parsed = CRM3TicketCreateSchema.safeParse(invalidPriority);
      expect(parsed.success).toBe(false);
    });

    it('requires a valid contactId UUID', () => {
      const missingContact = {
        subject: 'Valid subject',
        status: 'New',
        priority: 'Normal',
      };

      const parsed = CRM3TicketCreateSchema.safeParse(missingContact);
      expect(parsed.success).toBe(false);

      const invalidUuidContact = {
        subject: 'Valid subject',
        status: 'New',
        priority: 'Normal',
        contactId: 'not-a-uuid',
      };
      expect(CRM3TicketCreateSchema.safeParse(invalidUuidContact).success).toBe(false);
    });
  });

  describe('2. Ticket Edit / Patch Form Contract', () => {
    it('accepts partial updates for allowed fields', () => {
      const patchPayload = {
        status: 'Solved',
        priority: 'Urgent',
        orderRef: 'ORD-EDIT-999',
      };

      const parsed = CRM3TicketPatchSchema.safeParse(patchPayload);
      expect(parsed.success).toBe(true);
    });

    it('allows nullifying orderRef', () => {
      const patchPayload = {
        orderRef: null,
      };

      const parsed = CRM3TicketPatchSchema.safeParse(patchPayload);
      expect(parsed.success).toBe(true);
    });
  });

  describe('3. Ticket Note Form Contract', () => {
    it('validates a correct note submission', () => {
      const validNote = {
        ticketId: '90000000-0000-4000-8000-000000000001',
        noteText: 'Investigated log files on production; issue resolved.',
      };

      const parsed = CRM3NoteCreateSchema.safeParse(validNote);
      expect(parsed.success).toBe(true);
    });

    it('rejects blank note text', () => {
      const blankNote = {
        ticketId: '90000000-0000-4000-8000-000000000001',
        noteText: '   ',
      };

      const parsed = CRM3NoteCreateSchema.safeParse(blankNote);
      expect(parsed.success).toBe(false);
    });
  });

  describe('4. Lifecycle State Transitions Machine', () => {
    it('allows valid transitions according to V1 SDS status machine', () => {
      expect(isTicketStatusTransitionAllowed('New', 'Open')).toBe(true);
      expect(isTicketStatusTransitionAllowed('Open', 'Waiting')).toBe(true);
      expect(isTicketStatusTransitionAllowed('Open', 'Solved')).toBe(true);
      expect(isTicketStatusTransitionAllowed('Waiting', 'Open')).toBe(true);
      expect(isTicketStatusTransitionAllowed('Waiting', 'Solved')).toBe(true);
      expect(isTicketStatusTransitionAllowed('Solved', 'Closed')).toBe(true);
      expect(isTicketStatusTransitionAllowed('Solved', 'Open')).toBe(true);
    });

    it('allows idempotent no-op transitions (same status to same status)', () => {
      for (const status of CRM3_TICKET_STATUSES) {
        expect(isTicketStatusTransitionAllowed(status, status)).toBe(true);
      }
    });

    it('rejects illegal transitions according to V1 SDS status machine', () => {
      // New cannot jump directly to Solved or Closed
      expect(isTicketStatusTransitionAllowed('New', 'Solved')).toBe(false);
      expect(isTicketStatusTransitionAllowed('New', 'Closed')).toBe(false);

      // Closed is a terminal state; cannot transition to any other status
      expect(isTicketStatusTransitionAllowed('Closed', 'Open')).toBe(false);
      expect(isTicketStatusTransitionAllowed('Closed', 'Solved')).toBe(false);
      expect(isTicketStatusTransitionAllowed('Closed', 'New')).toBe(false);
    });
  });
});
