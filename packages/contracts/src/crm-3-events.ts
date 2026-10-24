import { z } from 'zod';
import {
  EventEnvelopeSchema,
  createEventEnvelope,
  type EventEnvelope,
} from './events.js';
import {
  CRM3TicketStatusSchema,
  CRM3TicketPrioritySchema,
  type CRM3TicketStatus,
  type CRM3TicketPriority,
} from './crm-3.js';

/**
 * CRM-3 Domain Event Taxonomy (Decision G1 & SDS ClearShift CRM v2.0 §4.4 / §4.10).
 * Conforms to standard outbox event envelope mandated by PLT-04 & PLT-09.
 */
export const CRM3EventTypes = {
  TICKET_CREATED: 'crm.ticket.created',
  TICKET_UPDATED: 'crm.ticket.updated',
  TICKET_STATUS_CHANGED: 'crm.ticket.status_changed',
  TICKET_PRIORITY_CHANGED: 'crm.ticket.priority_changed',
  TICKET_NOTE_ADDED: 'crm.ticket.note_added',
  IMPORT_BATCH_LOADED: 'crm.ticket.import_batch_loaded',
} as const;

export type CRM3EventType = (typeof CRM3EventTypes)[keyof typeof CRM3EventTypes];

export const CRM3EventTypeSchema = z.enum([
  'crm.ticket.created',
  'crm.ticket.updated',
  'crm.ticket.status_changed',
  'crm.ticket.priority_changed',
  'crm.ticket.note_added',
  'crm.ticket.import_batch_loaded',
]);

// ---------------------------------------------------------------------------
// 1. Event Payload Schemas
// ---------------------------------------------------------------------------

export const TicketCreatedPayloadSchema = z.object({
  ticketId: z.string().uuid(),
  subject: z.string().min(1),
  status: CRM3TicketStatusSchema,
  priority: CRM3TicketPrioritySchema,
  contactId: z.string().uuid(),
  orderRef: z.string().nullable().optional(),
  sourceSystem: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type TicketCreatedPayload = z.infer<typeof TicketCreatedPayloadSchema>;

export const TicketUpdatedPayloadSchema = z.object({
  ticketId: z.string().uuid(),
  subject: z.string().min(1).optional(),
  status: CRM3TicketStatusSchema.optional(),
  priority: CRM3TicketPrioritySchema.optional(),
  contactId: z.string().uuid().optional(),
  orderRef: z.string().nullable().optional(),
  updatedAt: z.string().datetime(),
});
export type TicketUpdatedPayload = z.infer<typeof TicketUpdatedPayloadSchema>;

export const TicketStatusChangedPayloadSchema = z.object({
  ticketId: z.string().uuid(),
  previousStatus: CRM3TicketStatusSchema,
  newStatus: CRM3TicketStatusSchema,
  updatedAt: z.string().datetime(),
});
export type TicketStatusChangedPayload = z.infer<typeof TicketStatusChangedPayloadSchema>;

export const TicketPriorityChangedPayloadSchema = z.object({
  ticketId: z.string().uuid(),
  previousPriority: CRM3TicketPrioritySchema,
  newPriority: CRM3TicketPrioritySchema,
  updatedAt: z.string().datetime(),
});
export type TicketPriorityChangedPayload = z.infer<typeof TicketPriorityChangedPayloadSchema>;

export const TicketNoteAddedPayloadSchema = z.object({
  noteId: z.string().uuid(),
  ticketId: z.string().uuid(),
  authorId: z.string().min(1),
  noteText: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type TicketNoteAddedPayload = z.infer<typeof TicketNoteAddedPayloadSchema>;

export const TicketImportBatchLoadedPayloadSchema = z.object({
  batchId: z.string().uuid(),
  sourceSystem: z.string().min(1),
  loadedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  completedAt: z.string().datetime(),
});
export type TicketImportBatchLoadedPayload = z.infer<
  typeof TicketImportBatchLoadedPayloadSchema
>;

// ---------------------------------------------------------------------------
// 2. Event Envelope Types & Envelopes
// ---------------------------------------------------------------------------

export type TicketCreatedEvent = EventEnvelope<TicketCreatedPayload>;
export type TicketUpdatedEvent = EventEnvelope<TicketUpdatedPayload>;
export type TicketStatusChangedEvent = EventEnvelope<TicketStatusChangedPayload>;
export type TicketPriorityChangedEvent = EventEnvelope<TicketPriorityChangedPayload>;
export type TicketNoteAddedEvent = EventEnvelope<TicketNoteAddedPayload>;
export type TicketImportBatchLoadedEvent = EventEnvelope<TicketImportBatchLoadedPayload>;

// ---------------------------------------------------------------------------
// 3. Factory Helpers
// ---------------------------------------------------------------------------

function buildEventEnvelopeInput<T extends Record<string, unknown>>(
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: T,
  options?: {
    correlationId?: string;
    causationId?: string;
    id?: string;
    timestamp?: string;
  }
): Parameters<typeof createEventEnvelope<T>>[0] {
  const input: Parameters<typeof createEventEnvelope<T>>[0] = {
    eventType,
    aggregateType,
    aggregateId,
    payload,
  };
  if (options?.correlationId !== undefined) input.correlationId = options.correlationId;
  if (options?.causationId !== undefined) input.causationId = options.causationId;
  if (options?.id !== undefined) input.id = options.id;
  if (options?.timestamp !== undefined) input.timestamp = options.timestamp;
  return input;
}

export function createTicketCreatedEvent(
  params: {
    aggregateId: string;
    payload: TicketCreatedPayload;
    correlationId?: string;
    causationId?: string;
    id?: string;
    timestamp?: string;
  }
): TicketCreatedEvent {
  const validated = TicketCreatedPayloadSchema.parse(params.payload);
  return createEventEnvelope(
    buildEventEnvelopeInput(
      CRM3EventTypes.TICKET_CREATED,
      'Ticket',
      params.aggregateId,
      validated,
      params
    )
  );
}

export function createTicketUpdatedEvent(
  params: {
    aggregateId: string;
    payload: TicketUpdatedPayload;
    correlationId?: string;
    causationId?: string;
    id?: string;
    timestamp?: string;
  }
): TicketUpdatedEvent {
  const validated = TicketUpdatedPayloadSchema.parse(params.payload);
  return createEventEnvelope(
    buildEventEnvelopeInput(
      CRM3EventTypes.TICKET_UPDATED,
      'Ticket',
      params.aggregateId,
      validated,
      params
    )
  );
}

export function createTicketStatusChangedEvent(
  params: {
    aggregateId: string;
    payload: TicketStatusChangedPayload;
    correlationId?: string;
    causationId?: string;
    id?: string;
    timestamp?: string;
  }
): TicketStatusChangedEvent {
  const validated = TicketStatusChangedPayloadSchema.parse(params.payload);
  return createEventEnvelope(
    buildEventEnvelopeInput(
      CRM3EventTypes.TICKET_STATUS_CHANGED,
      'Ticket',
      params.aggregateId,
      validated,
      params
    )
  );
}

export function createTicketPriorityChangedEvent(
  params: {
    aggregateId: string;
    payload: TicketPriorityChangedPayload;
    correlationId?: string;
    causationId?: string;
    id?: string;
    timestamp?: string;
  }
): TicketPriorityChangedEvent {
  const validated = TicketPriorityChangedPayloadSchema.parse(params.payload);
  return createEventEnvelope(
    buildEventEnvelopeInput(
      CRM3EventTypes.TICKET_PRIORITY_CHANGED,
      'Ticket',
      params.aggregateId,
      validated,
      params
    )
  );
}

export function createTicketNoteAddedEvent(
  params: {
    aggregateId: string;
    payload: TicketNoteAddedPayload;
    correlationId?: string;
    causationId?: string;
    id?: string;
    timestamp?: string;
  }
): TicketNoteAddedEvent {
  const validated = TicketNoteAddedPayloadSchema.parse(params.payload);
  return createEventEnvelope(
    buildEventEnvelopeInput(
      CRM3EventTypes.TICKET_NOTE_ADDED,
      'Note',
      params.aggregateId,
      validated,
      params
    )
  );
}

export function createTicketImportBatchLoadedEvent(
  params: {
    aggregateId: string;
    payload: TicketImportBatchLoadedPayload;
    correlationId?: string;
    causationId?: string;
    id?: string;
    timestamp?: string;
  }
): TicketImportBatchLoadedEvent {
  const validated = TicketImportBatchLoadedPayloadSchema.parse(params.payload);
  return createEventEnvelope(
    buildEventEnvelopeInput(
      CRM3EventTypes.IMPORT_BATCH_LOADED,
      'ImportBatch',
      params.aggregateId,
      validated,
      params
    )
  );
}

