import { describe, it, expect } from 'vitest';
import {
  CRM3EventTypes,
  CRM3EventTypeSchema,
  createTicketCreatedEvent,
  createTicketUpdatedEvent,
  createTicketStatusChangedEvent,
  createTicketPriorityChangedEvent,
  createTicketNoteAddedEvent,
  createTicketImportBatchLoadedEvent,
} from '../src/crm-3-events.js';
import { EventEnvelopeSchema } from '../src/events.js';

describe('CRM-3 Domain Events Taxonomy & Outbox Envelopes (Issue #147 / [CRM3-14])', () => {
  const sampleTicketId = '30000000-0000-4000-8000-000000000001';
  const sampleContactId = '90000000-0000-4000-8000-000000000001';

  describe('Event Types Taxonomy', () => {
    it('defines standard CRM-3 domain event types', () => {
      expect(CRM3EventTypes.TICKET_CREATED).toBe('crm.ticket.created');
      expect(CRM3EventTypes.TICKET_UPDATED).toBe('crm.ticket.updated');
      expect(CRM3EventTypes.TICKET_STATUS_CHANGED).toBe('crm.ticket.status_changed');
      expect(CRM3EventTypes.TICKET_PRIORITY_CHANGED).toBe('crm.ticket.priority_changed');
      expect(CRM3EventTypes.TICKET_NOTE_ADDED).toBe('crm.ticket.note_added');
      expect(CRM3EventTypes.IMPORT_BATCH_LOADED).toBe('crm.ticket.import_batch_loaded');
    });

    it('validates event types using CRM3EventTypeSchema', () => {
      Object.values(CRM3EventTypes).forEach((type) => {
        expect(CRM3EventTypeSchema.safeParse(type).success).toBe(true);
      });
      expect(CRM3EventTypeSchema.safeParse('crm.ticket.invalid_event').success).toBe(false);
    });
  });

  describe('createTicketCreatedEvent', () => {
    it('creates standard outbox event envelope for ticket creation', () => {
      const now = new Date().toISOString();
      const event = createTicketCreatedEvent({
        aggregateId: sampleTicketId,
        payload: {
          ticketId: sampleTicketId,
          subject: 'Network outage in region US-East',
          status: 'New',
          priority: 'Urgent',
          contactId: sampleContactId,
          orderRef: 'ORD-9999',
          createdAt: now,
        },
        correlationId: 'corr-001',
      });

      expect(event.eventType).toBe(CRM3EventTypes.TICKET_CREATED);
      expect(event.aggregateType).toBe('Ticket');
      expect(event.aggregateId).toBe(sampleTicketId);
      expect(event.correlationId).toBe('corr-001');
      expect(event.version).toBe(1);
      expect(event.producer).toBe('clearshift');

      const parseResult = EventEnvelopeSchema.safeParse(event);
      expect(parseResult.success).toBe(true);
    });

    it('rejects event creation when payload has invalid status', () => {
      expect(() =>
        createTicketCreatedEvent({
          aggregateId: sampleTicketId,
          payload: {
            ticketId: sampleTicketId,
            subject: 'Invalid status ticket',
            status: 'BogusStatus' as any,
            priority: 'Normal',
            contactId: sampleContactId,
            createdAt: new Date().toISOString(),
          },
        })
      ).toThrow();
    });

    it('rejects event creation when payload has invalid priority', () => {
      expect(() =>
        createTicketCreatedEvent({
          aggregateId: sampleTicketId,
          payload: {
            ticketId: sampleTicketId,
            subject: 'Invalid priority ticket',
            status: 'New',
            priority: 'Critical' as any,
            contactId: sampleContactId,
            createdAt: new Date().toISOString(),
          },
        })
      ).toThrow();
    });
  });

  describe('createTicketUpdatedEvent', () => {
    it('creates standard outbox event envelope for ticket field updates', () => {
      const now = new Date().toISOString();
      const event = createTicketUpdatedEvent({
        aggregateId: sampleTicketId,
        payload: {
          ticketId: sampleTicketId,
          subject: 'Updated subject line',
          status: 'Open',
          updatedAt: now,
        },
      });

      expect(event.eventType).toBe(CRM3EventTypes.TICKET_UPDATED);
      expect(event.aggregateType).toBe('Ticket');
      expect(event.payload.subject).toBe('Updated subject line');
      expect(event.payload.status).toBe('Open');
      expect(EventEnvelopeSchema.safeParse(event).success).toBe(true);
    });
  });

  describe('createTicketStatusChangedEvent', () => {
    it('creates status transition event envelope with previous and new status', () => {
      const now = new Date().toISOString();
      const event = createTicketStatusChangedEvent({
        aggregateId: sampleTicketId,
        payload: {
          ticketId: sampleTicketId,
          previousStatus: 'New',
          newStatus: 'Open',
          updatedAt: now,
        },
      });

      expect(event.eventType).toBe(CRM3EventTypes.TICKET_STATUS_CHANGED);
      expect(event.payload.previousStatus).toBe('New');
      expect(event.payload.newStatus).toBe('Open');
      expect(EventEnvelopeSchema.safeParse(event).success).toBe(true);
    });

    it('rejects invalid status values in status change event', () => {
      expect(() =>
        createTicketStatusChangedEvent({
          aggregateId: sampleTicketId,
          payload: {
            ticketId: sampleTicketId,
            previousStatus: 'Invalid' as any,
            newStatus: 'Solved',
            updatedAt: new Date().toISOString(),
          },
        })
      ).toThrow();
    });
  });

  describe('createTicketPriorityChangedEvent', () => {
    it('creates priority transition event envelope with previous and new priority', () => {
      const now = new Date().toISOString();
      const event = createTicketPriorityChangedEvent({
        aggregateId: sampleTicketId,
        payload: {
          ticketId: sampleTicketId,
          previousPriority: 'Normal',
          newPriority: 'Urgent',
          updatedAt: now,
        },
      });

      expect(event.eventType).toBe(CRM3EventTypes.TICKET_PRIORITY_CHANGED);
      expect(event.payload.previousPriority).toBe('Normal');
      expect(event.payload.newPriority).toBe('Urgent');
      expect(EventEnvelopeSchema.safeParse(event).success).toBe(true);
    });
  });

  describe('createTicketNoteAddedEvent', () => {
    it('creates note added event envelope for append-only activity trail', () => {
      const noteId = '40000000-0000-4000-8000-000000000001';
      const now = new Date().toISOString();

      const event = createTicketNoteAddedEvent({
        aggregateId: noteId,
        payload: {
          noteId,
          ticketId: sampleTicketId,
          authorId: 'agent.alex@clearshift.synthetic',
          noteText: 'Identified root cause: database connection pool exhausted.',
          createdAt: now,
        },
      });

      expect(event.eventType).toBe(CRM3EventTypes.TICKET_NOTE_ADDED);
      expect(event.aggregateType).toBe('Note');
      expect(event.payload.noteText).toContain('database connection pool');
      expect(EventEnvelopeSchema.safeParse(event).success).toBe(true);
    });

    it('rejects note added event when noteText is empty', () => {
      expect(() =>
        createTicketNoteAddedEvent({
          aggregateId: '40000000-0000-4000-8000-000000000001',
          payload: {
            noteId: '40000000-0000-4000-8000-000000000001',
            ticketId: sampleTicketId,
            authorId: 'agent.alex@clearshift.synthetic',
            noteText: '',
            createdAt: new Date().toISOString(),
          },
        })
      ).toThrow();
    });
  });

  describe('createTicketImportBatchLoadedEvent', () => {
    it('creates batch loaded event for migration kit integration', () => {
      const batchId = '50000000-0000-4000-8000-000000000001';
      const now = new Date().toISOString();

      const event = createTicketImportBatchLoadedEvent({
        aggregateId: batchId,
        payload: {
          batchId,
          sourceSystem: 'zendesk_tickets',
          loadedCount: 150,
          rejectedCount: 2,
          completedAt: now,
        },
      });

      expect(event.eventType).toBe(CRM3EventTypes.IMPORT_BATCH_LOADED);
      expect(event.aggregateType).toBe('ImportBatch');
      expect(event.payload.loadedCount).toBe(150);
      expect(event.payload.rejectedCount).toBe(2);
      expect(EventEnvelopeSchema.safeParse(event).success).toBe(true);
    });
  });
});
