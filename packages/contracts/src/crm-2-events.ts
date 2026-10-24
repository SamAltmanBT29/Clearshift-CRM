import { z } from 'zod';
import {
  createEventEnvelope,
  type EventEnvelope,
} from './events.js';

/**
 * Internal primitive schemas to break potential circular imports
 */
const StageNameEnum = z.enum([
  'New',
  'Qualified',
  'Proposal',
  'Negotiation',
  'Won',
  'Lost',
]);

const IsoCurrencySchema = z.string().regex(/^[A-Z]{3}$/, {
  message: 'Currency must be an explicit 3-letter uppercase ISO code (e.g. USD, EUR, GBP)',
});

const DecimalStrSchema = z.string().regex(/^\d+(\.\d{1,4})?$/, {
  message: 'Value must be a valid non-negative decimal string',
});

/**
 * CRM-2 Domain Event Taxonomy (Decision G1 & SDS ClearShift CRM v2.0 §8 / Project Plan §8).
 * Conforms to standard outbox event envelope mandated by PLT-04 & PLT-09.
 *
 * Emits deal.won domain event through transactional outbox with approved event contract
 * when deal reaches Won stage, enabling ERP-3 order creation.
 */
export const CRM2EventTypes = {
  DEAL_CREATED: 'crm2.deal.created',
  DEAL_UPDATED: 'crm2.deal.updated',
  DEAL_STAGE_CHANGED: 'crm2.deal.stage_changed',
  DEAL_WON: 'deal.won',
  DEAL_LOST: 'crm2.deal.lost',
  QUOTE_CREATED: 'crm2.quote.created',
  QUOTE_UPDATED: 'crm2.quote.updated',
  QUOTE_ACCEPTED: 'crm2.quote.accepted',
  DUPLICATE_DETECTED: 'crm2.duplicate.detected',
  DUPLICATE_RESOLVED: 'crm2.duplicate.resolved',
  IMPORT_BATCH_LOADED: 'crm2.import.batch_loaded',
} as const;

export type CRM2EventType = (typeof CRM2EventTypes)[keyof typeof CRM2EventTypes];

export const CRM2EventTypeSchema = z.enum([
  'crm2.deal.created',
  'crm.deal.created',
  'crm2.deal.updated',
  'crm.deal.updated',
  'crm2.deal.stage_changed',
  'crm.deal.stage_changed',
  'deal.won',
  'crm.deal.won',
  'crm2.deal.lost',
  'crm.deal.lost',
  'crm2.quote.created',
  'crm.quote.created',
  'crm2.quote.updated',
  'crm.quote.updated',
  'crm2.quote.accepted',
  'crm.quote.accepted',
  'crm2.duplicate.detected',
  'crm2.duplicate.resolved',
  'crm2.import.batch_loaded',
]);

// ---------------------------------------------------------------------------
// 1. Event Payload Schemas
// ---------------------------------------------------------------------------

export const DealCreatedPayloadSchema = z.object({
  dealId: z.string().uuid(),
  name: z.string().min(1),
  contactId: z.string().uuid().nullable().optional(),
  contactName: z.string().nullable().optional(),
  value: DecimalStrSchema,
  currency: IsoCurrencySchema,
  stageId: z.string().uuid(),
  stageName: StageNameEnum,
  closeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'closeDate must be in YYYY-MM-DD format'),
  isOrphan: z.boolean(),
  sourceSystem: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type DealCreatedPayload = z.infer<typeof DealCreatedPayloadSchema>;

export const DealUpdatedPayloadSchema = z.object({
  dealId: z.string().uuid(),
  changes: z.record(z.string(), z.unknown()),
  previousState: z.record(z.string(), z.unknown()).optional(),
  updatedAt: z.string().datetime(),
});
export type DealUpdatedPayload = z.infer<typeof DealUpdatedPayloadSchema>;

export const DealStageChangedPayloadSchema = z.object({
  dealId: z.string().uuid(),
  previousStage: StageNameEnum,
  newStage: StageNameEnum,
  changedAt: z.string().datetime(),
});
export type DealStageChangedPayload = z.infer<typeof DealStageChangedPayloadSchema>;

/**
 * Deal Won event payload emitted when deal reaches terminal Won stage (FR-CRM2-08).
 * Cross-module contract consumed by ERP-3 for automated sales order initiation.
 * Conforms strictly to SDS ClearShift CRM v2.0 §8 and Project Plan §8.
 */
export const DealWonPayloadSchema = z.object({
  dealId: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).optional(),
  dealName: z.string().min(1).optional(),
  amount: DecimalStrSchema,
  value: DecimalStrSchema.optional(),
  currency: IsoCurrencySchema,
  closeDate: z.string().optional(),
  stageName: z.literal('Won').default('Won'),
  correlationId: z.string().optional(),
  wonAt: z.string().datetime().optional(),
  quotesCount: z.number().int().nonnegative().optional(),
  quoteIds: z.array(z.string().uuid()).optional(),
});
export type DealWonPayload = z.infer<typeof DealWonPayloadSchema>;

export const DealLostPayloadSchema = z.object({
  dealId: z.string().uuid(),
  previousStage: StageNameEnum,
  stageName: z.literal('Lost').default('Lost'),
  lossReason: z.string().optional(),
  lostAt: z.string().datetime(),
});
export type DealLostPayload = z.infer<typeof DealLostPayloadSchema>;

export const QuoteCreatedPayloadSchema = z.object({
  quoteId: z.string().uuid(),
  dealId: z.string().uuid(),
  quoteNumber: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format'),
  amount: DecimalStrSchema,
  currency: IsoCurrencySchema,
  note: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type QuoteCreatedPayload = z.infer<typeof QuoteCreatedPayloadSchema>;

export const QuoteUpdatedPayloadSchema = z.object({
  quoteId: z.string().uuid(),
  dealId: z.string().uuid().optional(),
  quoteNumber: z.string().min(1).optional(),
  amount: DecimalStrSchema.optional(),
  currency: IsoCurrencySchema.optional(),
  note: z.string().nullable().optional(),
  updatedAt: z.string().datetime(),
});
export type QuoteUpdatedPayload = z.infer<typeof QuoteUpdatedPayloadSchema>;

export const QuoteAcceptedPayloadSchema = z.object({
  quoteId: z.string().uuid(),
  dealId: z.string().uuid(),
  quoteNumber: z.string().min(1),
  amount: DecimalStrSchema,
  currency: IsoCurrencySchema,
  acceptedAt: z.string().datetime(),
});
export type QuoteAcceptedPayload = z.infer<typeof QuoteAcceptedPayloadSchema>;

export const CRM2DuplicateDetectedPayloadSchema = z.object({
  candidateId: z.string().uuid(),
  batchId: z.string().min(1).max(128).optional(),
  entity: z.enum(['deal', 'quote', 'quote_line']).default('deal'),
  keyType: z.string().min(1),
  normalizedKey: z.string().min(1),
  recordIds: z.array(z.string()).min(2),
  detectedAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CRM2DuplicateDetectedPayload = z.infer<typeof CRM2DuplicateDetectedPayloadSchema>;

export const CRM2DuplicateResolvedPayloadSchema = z.object({
  candidateId: z.string().uuid(),
  decision: z.enum(['MERGE', 'REJECT_DUPLICATE', 'KEEP_SEPARATE']),
  actorId: z.string().min(1),
  keptId: z.string().min(1),
  mergedId: z.string().min(1),
  reason: z.string().min(1),
  resolvedAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CRM2DuplicateResolvedPayload = z.infer<typeof CRM2DuplicateResolvedPayloadSchema>;

export const CRM2ImportBatchLoadedPayloadSchema = z.object({
  batchId: z.string().min(1).max(128),
  sourceSystem: z.string().min(1),
  loadedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  completedAt: z.string().datetime(),
});
export type CRM2ImportBatchLoadedPayload = z.infer<typeof CRM2ImportBatchLoadedPayloadSchema>;

// ---------------------------------------------------------------------------
// 2. Strongly-Typed Event Constructors
// ---------------------------------------------------------------------------

export interface CRM2EventMeta {
  id?: string;
  correlationId?: string;
  causationId?: string;
  producer?: string;
  timestamp?: string;
}

function toEnvelopeInput<T extends Record<string, unknown>>(
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: T,
  meta?: CRM2EventMeta
) {
  const result: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: T;
    producer: string;
    id?: string;
    correlationId?: string;
    causationId?: string;
    timestamp?: string;
  } = {
    eventType,
    aggregateType,
    aggregateId,
    payload,
    producer: meta?.producer ?? 'crm-2',
  };
  if (meta?.id) result.id = meta.id;
  if (meta?.correlationId) result.correlationId = meta.correlationId;
  if (meta?.causationId) result.causationId = meta.causationId;
  if (meta?.timestamp) result.timestamp = meta.timestamp;
  return result;
}

export function createDealCreatedEvent(
  payload: DealCreatedPayload,
  meta?: CRM2EventMeta
): EventEnvelope<DealCreatedPayload> {
  DealCreatedPayloadSchema.parse(payload);
  return createEventEnvelope<DealCreatedPayload>(
    toEnvelopeInput(CRM2EventTypes.DEAL_CREATED, 'Deal', payload.dealId, payload, meta)
  );
}

export function createDealUpdatedEvent(
  payload: DealUpdatedPayload,
  meta?: CRM2EventMeta
): EventEnvelope<DealUpdatedPayload> {
  DealUpdatedPayloadSchema.parse(payload);
  return createEventEnvelope<DealUpdatedPayload>(
    toEnvelopeInput(CRM2EventTypes.DEAL_UPDATED, 'Deal', payload.dealId, payload, meta)
  );
}

export function createDealStageChangedEvent(
  payload: DealStageChangedPayload,
  meta?: CRM2EventMeta
): EventEnvelope<DealStageChangedPayload> {
  DealStageChangedPayloadSchema.parse(payload);
  return createEventEnvelope<DealStageChangedPayload>(
    toEnvelopeInput(CRM2EventTypes.DEAL_STAGE_CHANGED, 'Deal', payload.dealId, payload, meta)
  );
}

/**
 * Creates canonical deal.won domain event (FR-CRM2-08).
 * Satisfies payload requirements: dealId, customerId, amount, currency, and correlationId.
 */
export function createDealWonEvent(
  payload: DealWonPayload,
  meta?: CRM2EventMeta
): EventEnvelope<DealWonPayload> {
  const parsed = DealWonPayloadSchema.parse(payload);
  const correlationId = meta?.correlationId ?? parsed.correlationId ?? `corr-deal-won-${parsed.dealId.slice(0, 8)}`;
  const normalizedPayload: DealWonPayload = {
    ...parsed,
    correlationId,
    customerId: parsed.customerId ?? parsed.contactId ?? null,
    contactId: parsed.contactId ?? parsed.customerId ?? null,
  };

  return createEventEnvelope<DealWonPayload>(
    toEnvelopeInput(CRM2EventTypes.DEAL_WON, 'Deal', parsed.dealId, normalizedPayload, {
      ...meta,
      correlationId,
    })
  );
}

export function createDealLostEvent(
  payload: DealLostPayload,
  meta?: CRM2EventMeta
): EventEnvelope<DealLostPayload> {
  DealLostPayloadSchema.parse(payload);
  return createEventEnvelope<DealLostPayload>(
    toEnvelopeInput(CRM2EventTypes.DEAL_LOST, 'Deal', payload.dealId, payload, meta)
  );
}

export function createQuoteCreatedEvent(
  payload: QuoteCreatedPayload,
  meta?: CRM2EventMeta
): EventEnvelope<QuoteCreatedPayload> {
  QuoteCreatedPayloadSchema.parse(payload);
  return createEventEnvelope<QuoteCreatedPayload>(
    toEnvelopeInput(CRM2EventTypes.QUOTE_CREATED, 'Quote', payload.quoteId, payload, meta)
  );
}

export function createQuoteUpdatedEvent(
  payload: QuoteUpdatedPayload,
  meta?: CRM2EventMeta
): EventEnvelope<QuoteUpdatedPayload> {
  QuoteUpdatedPayloadSchema.parse(payload);
  return createEventEnvelope<QuoteUpdatedPayload>(
    toEnvelopeInput(CRM2EventTypes.QUOTE_UPDATED, 'Quote', payload.quoteId, payload, meta)
  );
}

export function createQuoteAcceptedEvent(
  payload: QuoteAcceptedPayload,
  meta?: CRM2EventMeta
): EventEnvelope<QuoteAcceptedPayload> {
  QuoteAcceptedPayloadSchema.parse(payload);
  return createEventEnvelope<QuoteAcceptedPayload>(
    toEnvelopeInput(CRM2EventTypes.QUOTE_ACCEPTED, 'Quote', payload.quoteId, payload, meta)
  );
}

export function createCRM2DuplicateDetectedEvent(
  payload: CRM2DuplicateDetectedPayload,
  meta?: CRM2EventMeta
): EventEnvelope<CRM2DuplicateDetectedPayload> {
  CRM2DuplicateDetectedPayloadSchema.parse(payload);
  return createEventEnvelope<CRM2DuplicateDetectedPayload>(
    toEnvelopeInput(CRM2EventTypes.DUPLICATE_DETECTED, 'crm2_duplicate_candidate', payload.candidateId, payload, meta)
  );
}

export function createCRM2DuplicateResolvedEvent(
  payload: CRM2DuplicateResolvedPayload,
  meta?: CRM2EventMeta
): EventEnvelope<CRM2DuplicateResolvedPayload> {
  CRM2DuplicateResolvedPayloadSchema.parse(payload);
  return createEventEnvelope<CRM2DuplicateResolvedPayload>(
    toEnvelopeInput(CRM2EventTypes.DUPLICATE_RESOLVED, 'crm2_duplicate_candidate', payload.candidateId, payload, meta)
  );
}

export function createCRM2ImportBatchLoadedEvent(
  payload: CRM2ImportBatchLoadedPayload,
  meta?: CRM2EventMeta
): EventEnvelope<CRM2ImportBatchLoadedPayload> {
  CRM2ImportBatchLoadedPayloadSchema.parse(payload);
  return createEventEnvelope<CRM2ImportBatchLoadedPayload>(
    toEnvelopeInput(CRM2EventTypes.IMPORT_BATCH_LOADED, 'crm2_import_batch', payload.batchId, payload, meta)
  );
}
