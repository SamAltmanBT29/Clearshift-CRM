import { z } from 'zod';
import {
  createEventEnvelope,
  type EventEnvelope,
} from './events.js';
import {
  CrmModuleSchema,
  MigrationStepSchema,
  MigrationRunStatusSchema,
  ReconciliationStatusSchema,
  ExactKeyTypeSchema,
  DuplicateReviewDecisionSchema,
  type CrmModule,
  type MigrationStep,
  type MigrationRunStatus,
  type ReconciliationStatus,
  type ExactKeyType,
  type DuplicateReviewDecision,
} from './crm-5.js';

/**
 * CRM-5 Domain Event Taxonomy (Decision G1 & SDS ClearShift CRM v2.0 Section 4.10).
 * Conforms to standard outbox event envelope mandated by PLT-04 & PLT-09.
 */
export const CRM5EventTypes = {
  // Emitted by CRM-5
  RUN_PROJECTED: 'crm.migration.run_projected',
  SCORE_COMPUTED: 'crm.migration.score_computed',
  REJECT_RECORDED: 'crm.migration.reject_recorded',
  RECONCILIATION_COMPLETED: 'crm.migration.reconciliation_completed',
  DUPLICATE_DETECTED: 'crm.migration.duplicate_detected',
  DUPLICATE_RESOLVED: 'crm.migration.duplicate_resolved',

  // Consumed from Migration Kit (EV-01 .. EV-07)
  BATCH_EXTRACTED: 'batch.extracted',
  BATCH_PROFILED: 'batch.profiled',
  BATCH_CLEANED: 'batch.cleaned',
  BATCH_MAPPED: 'batch.mapped',
  BATCH_LOADED: 'batch.loaded',
  BATCH_VALIDATED: 'batch.validated',
  BATCH_FAILED: 'batch.failed',
} as const;

export type CRM5EventType = (typeof CRM5EventTypes)[keyof typeof CRM5EventTypes];

export const CRM5EventTypeSchema = z.enum([
  'crm.migration.run_projected',
  'crm.migration.score_computed',
  'crm.migration.reject_recorded',
  'crm.migration.reconciliation_completed',
  'crm.migration.duplicate_detected',
  'crm.migration.duplicate_resolved',
  'batch.extracted',
  'batch.profiled',
  'batch.cleaned',
  'batch.mapped',
  'batch.loaded',
  'batch.validated',
  'batch.failed',
]);

// ---------------------------------------------------------------------------
// 1. Event Payload Schemas
// ---------------------------------------------------------------------------

export const RunProjectedPayloadSchema = z.object({
  runId: z.string().uuid(),
  batchId: z.string().min(1).max(128),
  module: CrmModuleSchema,
  step: MigrationStepSchema,
  status: MigrationRunStatusSchema,
  recordsIn: z.number().int().nonnegative(),
  recordsOut: z.number().int().nonnegative(),
  recordsRejected: z.number().int().nonnegative(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type RunProjectedPayload = z.infer<typeof RunProjectedPayloadSchema>;

export const ScoreComputedPayloadSchema = z.object({
  scoreId: z.string().uuid(),
  batchId: z.string().min(1).max(128),
  module: CrmModuleSchema,
  score: z.number().min(0).max(100).nullable(),
  completeness: z.number().min(0).max(1).nullable(),
  validity: z.number().min(0).max(1).nullable(),
  duplicateRate: z.number().min(0).max(1).nullable(),
  rejectRate: z.number().min(0).max(1).nullable(),
  linkIntegrity: z.number().min(0).max(1).nullable(),
  isFullyScored: z.boolean(),
  scoredAt: z.string().datetime(),
});
export type ScoreComputedPayload = z.infer<typeof ScoreComputedPayloadSchema>;

export const RejectRecordedPayloadSchema = z.object({
  rejectId: z.string().uuid(),
  batchId: z.string().min(1).max(128),
  module: CrmModuleSchema,
  rowIndex: z.number().int().positive(),
  errorCode: z.string().min(1).max(64),
  errorMessage: z.string().min(1),
  rawPayloadHash: z.string().length(64),
  createdAt: z.string().datetime(),
});
export type RejectRecordedPayload = z.infer<typeof RejectRecordedPayloadSchema>;

export const ReconciliationCompletedPayloadSchema = z.object({
  reportId: z.string().uuid(),
  batchId: z.string().min(1).max(128),
  module: CrmModuleSchema,
  sourceCount: z.number().int().nonnegative(),
  loadedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  mergedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  unaccountedCount: z.number().int().nonnegative(),
  status: ReconciliationStatusSchema,
  isBalanced: z.boolean(),
  reconciledAt: z.string().datetime(),
});
export type ReconciliationCompletedPayload = z.infer<typeof ReconciliationCompletedPayloadSchema>;

export const DuplicateDetectedPayloadSchema = z.object({
  candidateId: z.string().uuid(),
  batchId: z.string().min(1).max(128).optional(),
  module: CrmModuleSchema.optional(),
  keyType: ExactKeyTypeSchema,
  normalizedKey: z.string().min(1),
  recordIds: z.array(z.string()).min(2),
  detectedAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type DuplicateDetectedPayload = z.infer<typeof DuplicateDetectedPayloadSchema>;

export const DuplicateResolvedPayloadSchema = z.object({
  candidateId: z.string().min(1),
  decision: DuplicateReviewDecisionSchema,
  actorId: z.string().min(1),
  keptId: z.string().min(1),
  mergedId: z.string().min(1),
  reason: z.string().min(1),
  resolvedAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type DuplicateResolvedPayload = z.infer<typeof DuplicateResolvedPayloadSchema>;

export const BatchStepEventPayloadSchema = z.object({
  batchId: z.string().min(1).max(128),
  module: CrmModuleSchema.optional(),
  step: MigrationStepSchema,
  status: z.string().min(1),
  recordsProcessed: z.number().int().nonnegative().optional(),
  recordsRejected: z.number().int().nonnegative().optional(),
  timestamp: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type BatchStepEventPayload = z.infer<typeof BatchStepEventPayloadSchema>;

// ---------------------------------------------------------------------------
// 2. Outbox Event Envelope Factory Functions
// ---------------------------------------------------------------------------

function buildEnvelopeParams<T extends Record<string, unknown>>(
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: T,
  options?: {
    id?: string | undefined;
    correlationId?: string | undefined;
    causationId?: string | undefined;
    producer?: string | undefined;
    timestamp?: string | undefined;
  }
): Parameters<typeof createEventEnvelope<T>>[0] {
  const params: Parameters<typeof createEventEnvelope<T>>[0] = {
    eventType,
    aggregateType,
    aggregateId,
    payload,
    producer: options?.producer ?? 'crm-5',
  };
  if (options?.id !== undefined) params.id = options.id;
  if (options?.correlationId !== undefined) params.correlationId = options.correlationId;
  if (options?.causationId !== undefined) params.causationId = options.causationId;
  if (options?.timestamp !== undefined) params.timestamp = options.timestamp;
  return params;
}

export function createRunProjectedEvent(
  payload: RunProjectedPayload,
  options?: { correlationId?: string; causationId?: string; id?: string }
): EventEnvelope<RunProjectedPayload> {
  RunProjectedPayloadSchema.parse(payload);
  return createEventEnvelope<RunProjectedPayload>(
    buildEnvelopeParams(
      CRM5EventTypes.RUN_PROJECTED,
      'crm5_run',
      payload.runId,
      payload,
      { correlationId: options?.correlationId ?? payload.batchId, causationId: options?.causationId, id: options?.id }
    )
  );
}

export function createScoreComputedEvent(
  payload: ScoreComputedPayload,
  options?: { correlationId?: string; causationId?: string; id?: string }
): EventEnvelope<ScoreComputedPayload> {
  ScoreComputedPayloadSchema.parse(payload);
  return createEventEnvelope<ScoreComputedPayload>(
    buildEnvelopeParams(
      CRM5EventTypes.SCORE_COMPUTED,
      'crm5_score',
      payload.scoreId,
      payload,
      { correlationId: options?.correlationId ?? payload.batchId, causationId: options?.causationId, id: options?.id }
    )
  );
}

export function createRejectRecordedEvent(
  payload: RejectRecordedPayload,
  options?: { correlationId?: string; causationId?: string; id?: string }
): EventEnvelope<RejectRecordedPayload> {
  RejectRecordedPayloadSchema.parse(payload);
  return createEventEnvelope<RejectRecordedPayload>(
    buildEnvelopeParams(
      CRM5EventTypes.REJECT_RECORDED,
      'crm5_reject',
      payload.rejectId,
      payload,
      { correlationId: options?.correlationId ?? payload.batchId, causationId: options?.causationId, id: options?.id }
    )
  );
}

export function createReconciliationCompletedEvent(
  payload: ReconciliationCompletedPayload,
  options?: { correlationId?: string; causationId?: string; id?: string }
): EventEnvelope<ReconciliationCompletedPayload> {
  ReconciliationCompletedPayloadSchema.parse(payload);
  return createEventEnvelope<ReconciliationCompletedPayload>(
    buildEnvelopeParams(
      CRM5EventTypes.RECONCILIATION_COMPLETED,
      'crm5_reconciliation_report',
      payload.reportId,
      payload,
      { correlationId: options?.correlationId ?? payload.batchId, causationId: options?.causationId, id: options?.id }
    )
  );
}

export function createDuplicateDetectedEvent(
  payload: DuplicateDetectedPayload,
  options?: { correlationId?: string; causationId?: string; id?: string }
): EventEnvelope<DuplicateDetectedPayload> {
  DuplicateDetectedPayloadSchema.parse(payload);
  return createEventEnvelope<DuplicateDetectedPayload>(
    buildEnvelopeParams(
      CRM5EventTypes.DUPLICATE_DETECTED,
      'crm5_duplicate_candidate',
      payload.candidateId,
      payload,
      { correlationId: options?.correlationId ?? payload.batchId, causationId: options?.causationId, id: options?.id }
    )
  );
}

export function createDuplicateResolvedEvent(
  payload: DuplicateResolvedPayload,
  options?: { correlationId?: string; causationId?: string; id?: string }
): EventEnvelope<DuplicateResolvedPayload> {
  DuplicateResolvedPayloadSchema.parse(payload);
  return createEventEnvelope<DuplicateResolvedPayload>(
    buildEnvelopeParams(
      CRM5EventTypes.DUPLICATE_RESOLVED,
      'crm5_duplicate_candidate',
      payload.candidateId,
      payload,
      { correlationId: options?.correlationId, causationId: options?.causationId, id: options?.id }
    )
  );
}

export function createBatchStepEvent(
  eventType: CRM5EventType,
  payload: BatchStepEventPayload,
  options?: { correlationId?: string; causationId?: string; id?: string; producer?: string }
): EventEnvelope<BatchStepEventPayload> {
  BatchStepEventPayloadSchema.parse(payload);
  return createEventEnvelope<BatchStepEventPayload>(
    buildEnvelopeParams(
      eventType,
      'migration_batch',
      payload.batchId,
      payload,
      {
        producer: options?.producer ?? 'migration-kit',
        correlationId: options?.correlationId ?? payload.batchId,
        causationId: options?.causationId,
        id: options?.id,
      }
    )
  );
}
