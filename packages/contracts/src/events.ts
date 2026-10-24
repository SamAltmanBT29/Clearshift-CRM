import { z } from 'zod';
import { randomUUID } from 'crypto';

/**
 * Standard Outbox Event Envelope Schema as mandated by PLT-04 & PLT-09.
 * Ensures consistent serialization across Redis Streams, outbox tables, and consumers.
 */
export const EventEnvelopeSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string().min(1, 'eventType is required'),
  aggregateType: z.string().min(1, 'aggregateType is required'),
  aggregateId: z.string().min(1, 'aggregateId is required'),
  timestamp: z.string().datetime({ message: 'timestamp must be a valid ISO-8601 string' }),
  version: z.number().int().min(1).default(1),
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
  producer: z.string().min(1).default('clearshift'),
  payload: z.record(z.string(), z.unknown()),
});

export type RawEventEnvelope = z.infer<typeof EventEnvelopeSchema>;

export type EventEnvelope<T extends Record<string, unknown> = Record<string, unknown>> = Omit<
  RawEventEnvelope,
  'payload'
> & {
  payload: T;
};

/**
 * Event Headers / Metadata for transport boundaries (Redis Streams, HTTP webhooks, etc.)
 */
export const EventHeadersSchema = z.object({
  'x-event-id': z.string().uuid().optional(),
  'x-event-type': z.string().optional(),
  'x-correlation-id': z.string().optional(),
  'x-aggregate-id': z.string().optional(),
});

export type EventHeaders = z.infer<typeof EventHeadersSchema>;

/**
 * Factory helper to construct a deterministic EventEnvelope.
 */
export function createEventEnvelope<T extends Record<string, unknown>>(params: {
  id?: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: T;
  version?: number;
  correlationId?: string;
  causationId?: string;
  producer?: string;
  timestamp?: string;
}): EventEnvelope<T> {
  const envelope: EventEnvelope<T> = {
    id: params.id ?? randomUUID(),
    eventType: params.eventType,
    aggregateType: params.aggregateType,
    aggregateId: params.aggregateId,
    timestamp: params.timestamp ?? new Date().toISOString(),
    version: params.version ?? 1,
    producer: params.producer ?? 'clearshift',
    payload: params.payload,
  };

  if (params.correlationId !== undefined) {
    envelope.correlationId = params.correlationId;
  }
  if (params.causationId !== undefined) {
    envelope.causationId = params.causationId;
  }

  // Validate envelope against schema (payload is validated as record)
  EventEnvelopeSchema.parse(envelope);
  return envelope;
}

// ============================================================================
// KIT-13: Transactional Event Envelope & Outbox Producer Contracts
// ============================================================================

/**
 * Authoritative Migration Kit Event Taxonomy (KIT-13)
 */
export const MigrationKitEventTypes = {
  BATCH_EXTRACTED: 'batch.extracted',
  BATCH_PROFILED: 'batch.profiled',
  BATCH_CLEANED: 'batch.cleaned',
  BATCH_MAPPED: 'batch.mapped',
  BATCH_LOADED: 'batch.loaded',
  BATCH_VALIDATED: 'batch.validated',
  BATCH_FAILED: 'batch.failed',
  CONTACT_MERGED: 'contact.merged',
} as const;

export type MigrationKitEventType =
  (typeof MigrationKitEventTypes)[keyof typeof MigrationKitEventTypes];

export const MigrationKitEventTypeSchema = z.enum([
  'batch.extracted',
  'batch.profiled',
  'batch.cleaned',
  'batch.mapped',
  'batch.loaded',
  'batch.validated',
  'batch.failed',
  'contact.merged',
]);

/**
 * Forbidden Key List for Confidentiality & Zero Raw Rows Guarantee (KIT-13)
 * Payloads must ONLY contain schema_version, event_id, occurred_at, producer,
 * correlation_id, batch_id, and counts/references. No raw rows or secrets.
 */
export const FORBIDDEN_PAYLOAD_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api_?key/i,
  /access_?token/i,
  /private_?key/i,
  /credit_?card/i,
  /ssn/i,
  /raw_?row/i,
  /raw_?rows/i,
  /raw_?payload/i,
  /raw_?data/i,
];

export class SecretsOrRawRowsForbiddenError extends Error {
  public readonly code = 'SECRETS_OR_RAW_ROWS_FORBIDDEN';
  public readonly statusCode = 422;

  constructor(public readonly forbiddenKeyOrReason: string) {
    super(
      `Confidentiality invariant violation: Migration Kit event payload contains forbidden key or raw content: '${forbiddenKeyOrReason}'. Only counts and references are allowed.`
    );
    this.name = 'SecretsOrRawRowsForbiddenError';
  }
}

/**
 * Recursively inspects an object to ensure no secrets or raw rows are present.
 */
export function assertNoSecretsOrRawRows(obj: unknown, path: string = ''): void {
  if (!obj || typeof obj !== 'object') {
    if (typeof obj === 'string') {
      if (
        obj.startsWith('Bearer ') ||
        obj.startsWith('ghp_') ||
        (obj.startsWith('eyJ') && obj.split('.').length === 3)
      ) {
        throw new SecretsOrRawRowsForbiddenError(`Token/secret value detected at path '${path}'`);
      }
    }
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => assertNoSecretsOrRawRows(item, `${path}[${index}]`));
    return;
  }

  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    for (const pattern of FORBIDDEN_PAYLOAD_KEY_PATTERNS) {
      if (pattern.test(key)) {
        throw new SecretsOrRawRowsForbiddenError(key);
      }
    }
    assertNoSecretsOrRawRows(record[key], path ? `${path}.${key}` : key);
  }
}

// ----------------------------------------------------------------------------
// Base Event Payload Structure
// ----------------------------------------------------------------------------

const BaseEventPayloadSchema = z.object({
  schema_version: z.number().int().positive().default(1),
  event_id: z.string().uuid(),
  occurred_at: z.string().datetime(),
  producer: z.string().min(1).default('migration-kit'),
  correlation_id: z.string().min(1),
  batch_id: z.string().min(1),
  module: z.string().min(1).default('crm-1'),
});

// 1. batch.extracted Payload
export const KitBatchExtractedPayloadSchema = BaseEventPayloadSchema.extend({
  step: z.literal('extract').default('extract'),
  counts: z.object({
    source_count: z.number().int().nonnegative(),
    raw_count: z.number().int().nonnegative(),
  }),
  references: z
    .object({
      file_name: z.string().optional(),
      file_size_bytes: z.number().int().nonnegative().optional(),
      checksum_sha256: z.string().optional(),
    })
    .optional(),
});
export type KitBatchExtractedPayload = z.infer<typeof KitBatchExtractedPayloadSchema>;
export const BatchExtractedPayloadSchema = KitBatchExtractedPayloadSchema;
export type BatchExtractedPayload = KitBatchExtractedPayload;

// 2. batch.profiled Payload
export const KitBatchProfiledPayloadSchema = BaseEventPayloadSchema.extend({
  step: z.literal('profile').default('profile'),
  counts: z.object({
    total_rows: z.number().int().nonnegative(),
    empty_fields_count: z.number().int().nonnegative().optional(),
    duplicate_count: z.number().int().nonnegative().optional(),
    anomaly_count: z.number().int().nonnegative().optional(),
  }),
  references: z
    .object({
      profile_report_id: z.string().optional(),
      completeness: z.number().min(0).max(1).optional(),
      validity: z.number().min(0).max(1).optional(),
      duplicate_rate: z.number().min(0).max(1).optional(),
      reject_rate: z.number().min(0).max(1).optional(),
      link_integrity: z.number().min(0).max(1).optional(),
      overall_score: z.number().min(0).max(100).optional(),
    })
    .optional(),
});
export type KitBatchProfiledPayload = z.infer<typeof KitBatchProfiledPayloadSchema>;

// 3. batch.cleaned Payload
export const KitBatchCleanedPayloadSchema = BaseEventPayloadSchema.extend({
  step: z.literal('clean').default('clean'),
  counts: z.object({
    input_rows: z.number().int().nonnegative(),
    clean_rows: z.number().int().nonnegative(),
    rejected_rows: z.number().int().nonnegative(),
  }),
  references: z
    .object({
      cleaning_rule_version: z.string().optional(),
      cleaning_rule_set: z.string().optional(),
    })
    .optional(),
});
export type KitBatchCleanedPayload = z.infer<typeof KitBatchCleanedPayloadSchema>;

// 4. batch.mapped Payload
export const KitBatchMappedPayloadSchema = BaseEventPayloadSchema.extend({
  step: z.literal('map').default('map'),
  counts: z.object({
    mapped_rows: z.number().int().nonnegative(),
    unmapped_rows: z.number().int().nonnegative().default(0),
  }),
  references: z
    .object({
      mapping_template_id: z.string().optional(),
      target_entity: z.string().optional(),
    })
    .optional(),
});
export type KitBatchMappedPayload = z.infer<typeof KitBatchMappedPayloadSchema>;

// 5. batch.loaded Payload
export const KitBatchLoadedPayloadSchema = BaseEventPayloadSchema.extend({
  step: z.literal('load').default('load'),
  counts: z.object({
    loaded_count: z.number().int().nonnegative(),
    rejected_count: z.number().int().nonnegative(),
    merged_count: z.number().int().nonnegative().default(0),
    skipped_count: z.number().int().nonnegative().default(0),
    unaccounted_count: z.literal(0).default(0),
  }),
  references: z
    .object({
      target_adapter: z.string().optional(),
      chunks_processed: z.number().int().positive().optional(),
    })
    .optional(),
});
export type KitBatchLoadedPayload = z.infer<typeof KitBatchLoadedPayloadSchema>;
export const BatchLoadedPayloadSchema = KitBatchLoadedPayloadSchema;
export type BatchLoadedPayload = KitBatchLoadedPayload;

// 6. batch.validated Payload
export const KitBatchValidatedPayloadSchema = BaseEventPayloadSchema.extend({
  step: z.literal('validate').default('validate'),
  counts: z.object({
    total_validated: z.number().int().nonnegative(),
    passed_count: z.number().int().nonnegative(),
    failed_count: z.number().int().nonnegative(),
  }),
  references: z.object({
    status: z.enum(['OK', 'UNBALANCED', 'PASSED', 'FAILED']),
    balance_sheet_id: z.string().optional(),
  }),
});
export type KitBatchValidatedPayload = z.infer<typeof KitBatchValidatedPayloadSchema>;
export const BatchValidatedPayloadSchema = KitBatchValidatedPayloadSchema;
export type BatchValidatedPayload = KitBatchValidatedPayload;

// 7. batch.failed Payload
export const KitBatchFailedPayloadSchema = BaseEventPayloadSchema.extend({
  failed_step: z.enum([
    'extract',
    'profile',
    'clean',
    'map',
    'dry_run',
    'load',
    'validate',
    'reconcile',
  ]),
  error_code: z.string().min(1),
  error_message: z.string().min(1),
  counts: z
    .object({
      attempted_rows: z.number().int().nonnegative().optional(),
      failed_row_index: z.number().int().positive().optional(),
    })
    .optional(),
  references: z
    .object({
      exception_name: z.string().optional(),
      failure_category: z.string().optional(),
    })
    .optional(),
});
export type KitBatchFailedPayload = z.infer<typeof KitBatchFailedPayloadSchema>;
export const BatchFailedPayloadSchema = KitBatchFailedPayloadSchema;
export type BatchFailedPayload = KitBatchFailedPayload;

// 8. contact.merged Payload (KIT-13 variant)
export const KitContactMergedPayloadSchema = z.object({
  schema_version: z.number().int().positive().default(1),
  event_id: z.string().uuid(),
  occurred_at: z.string().datetime(),
  producer: z.string().min(1).default('migration-kit'),
  correlation_id: z.string().min(1),
  batch_id: z.string().min(1),
  golden_id: z.string().uuid(),
  survivor_id: z.string().min(1),
  merged_record_ids: z.array(z.string().min(1)).min(1),
  counts: z.object({
    total_merged: z.number().int().positive(),
  }),
  references: z.object({
    merge_rule: z.string().min(1),
    confidence_score: z.number().min(0).max(1).optional(),
  }),
});
export type KitContactMergedPayload = z.infer<typeof KitContactMergedPayloadSchema>;

// ----------------------------------------------------------------------------
// Factory Functions for Envelopes
// ----------------------------------------------------------------------------

function buildKitEnvelopeParams<T extends Record<string, unknown>>(
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: T,
  occurredAt: string,
  schemaVersion: number,
  producer: string,
  correlationId: string,
  options?: { correlationId?: string; causationId?: string; id?: string }
): Parameters<typeof createEventEnvelope<T>>[0] {
  const p: Parameters<typeof createEventEnvelope<T>>[0] = {
    eventType,
    aggregateType,
    aggregateId,
    payload,
    producer,
    timestamp: occurredAt,
    version: schemaVersion,
  };
  const resolvedId = options?.id ?? (payload as unknown as { event_id?: string }).event_id;
  if (resolvedId) {
    p.id = resolvedId;
  }
  const corr = options?.correlationId ?? correlationId;
  if (corr) {
    p.correlationId = corr;
  }
  if (options?.causationId) {
    p.causationId = options.causationId;
  }
  return p;
}


export function createBatchExtractedEnvelope(
  payload: KitBatchExtractedPayload,
  options?: { correlationId?: string; causationId?: string; id?: string }
): EventEnvelope<KitBatchExtractedPayload> {
  assertNoSecretsOrRawRows(payload);
  KitBatchExtractedPayloadSchema.parse(payload);
  return createEventEnvelope<KitBatchExtractedPayload>(
    buildKitEnvelopeParams(
      MigrationKitEventTypes.BATCH_EXTRACTED,
      'migration_batch',
      payload.batch_id,
      payload,
      payload.occurred_at,
      payload.schema_version,
      payload.producer,
      payload.correlation_id,
      options
    )
  );
}

export function createBatchProfiledEnvelope(
  payload: KitBatchProfiledPayload,
  options?: { correlationId?: string; causationId?: string; id?: string }
): EventEnvelope<KitBatchProfiledPayload> {
  assertNoSecretsOrRawRows(payload);
  KitBatchProfiledPayloadSchema.parse(payload);
  return createEventEnvelope<KitBatchProfiledPayload>(
    buildKitEnvelopeParams(
      MigrationKitEventTypes.BATCH_PROFILED,
      'migration_batch',
      payload.batch_id,
      payload,
      payload.occurred_at,
      payload.schema_version,
      payload.producer,
      payload.correlation_id,
      options
    )
  );
}

export function createBatchCleanedEnvelope(
  payload: KitBatchCleanedPayload,
  options?: { correlationId?: string; causationId?: string; id?: string }
): EventEnvelope<KitBatchCleanedPayload> {
  assertNoSecretsOrRawRows(payload);
  KitBatchCleanedPayloadSchema.parse(payload);
  return createEventEnvelope<KitBatchCleanedPayload>(
    buildKitEnvelopeParams(
      MigrationKitEventTypes.BATCH_CLEANED,
      'migration_batch',
      payload.batch_id,
      payload,
      payload.occurred_at,
      payload.schema_version,
      payload.producer,
      payload.correlation_id,
      options
    )
  );
}

export function createBatchMappedEnvelope(
  payload: KitBatchMappedPayload,
  options?: { correlationId?: string; causationId?: string; id?: string }
): EventEnvelope<KitBatchMappedPayload> {
  assertNoSecretsOrRawRows(payload);
  KitBatchMappedPayloadSchema.parse(payload);
  return createEventEnvelope<KitBatchMappedPayload>(
    buildKitEnvelopeParams(
      MigrationKitEventTypes.BATCH_MAPPED,
      'migration_batch',
      payload.batch_id,
      payload,
      payload.occurred_at,
      payload.schema_version,
      payload.producer,
      payload.correlation_id,
      options
    )
  );
}

export function createBatchLoadedEnvelope(
  payload: KitBatchLoadedPayload,
  options?: { correlationId?: string; causationId?: string; id?: string }
): EventEnvelope<KitBatchLoadedPayload> {
  assertNoSecretsOrRawRows(payload);
  KitBatchLoadedPayloadSchema.parse(payload);
  return createEventEnvelope<KitBatchLoadedPayload>(
    buildKitEnvelopeParams(
      MigrationKitEventTypes.BATCH_LOADED,
      'migration_batch',
      payload.batch_id,
      payload,
      payload.occurred_at,
      payload.schema_version,
      payload.producer,
      payload.correlation_id,
      options
    )
  );
}

export function createBatchValidatedEnvelope(
  payload: KitBatchValidatedPayload,
  options?: { correlationId?: string; causationId?: string; id?: string }
): EventEnvelope<KitBatchValidatedPayload> {
  assertNoSecretsOrRawRows(payload);
  KitBatchValidatedPayloadSchema.parse(payload);
  return createEventEnvelope<KitBatchValidatedPayload>(
    buildKitEnvelopeParams(
      MigrationKitEventTypes.BATCH_VALIDATED,
      'migration_batch',
      payload.batch_id,
      payload,
      payload.occurred_at,
      payload.schema_version,
      payload.producer,
      payload.correlation_id,
      options
    )
  );
}

export function createBatchFailedEnvelope(
  payload: KitBatchFailedPayload,
  options?: { correlationId?: string; causationId?: string; id?: string }
): EventEnvelope<KitBatchFailedPayload> {
  assertNoSecretsOrRawRows(payload);
  KitBatchFailedPayloadSchema.parse(payload);
  return createEventEnvelope<KitBatchFailedPayload>(
    buildKitEnvelopeParams(
      MigrationKitEventTypes.BATCH_FAILED,
      'migration_batch',
      payload.batch_id,
      payload,
      payload.occurred_at,
      payload.schema_version,
      payload.producer,
      payload.correlation_id,
      options
    )
  );
}

export function createContactMergedEnvelope(
  payload: KitContactMergedPayload,
  options?: { correlationId?: string; causationId?: string; id?: string }
): EventEnvelope<KitContactMergedPayload> {
  assertNoSecretsOrRawRows(payload);
  KitContactMergedPayloadSchema.parse(payload);
  return createEventEnvelope<KitContactMergedPayload>(
    buildKitEnvelopeParams(
      MigrationKitEventTypes.CONTACT_MERGED,
      'contact',
      payload.golden_id,
      payload,
      payload.occurred_at,
      payload.schema_version,
      payload.producer,
      payload.correlation_id,
      options
    )
  );
}
