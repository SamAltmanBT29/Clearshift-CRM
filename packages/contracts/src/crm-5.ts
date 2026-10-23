import { z } from 'zod';

/**
 * CRM-5 Migration Control Center and Reports — API Contracts & Zod Schemas
 * Strictly validates requests, responses, and calculation formulas.
 */

// ---------------------------------------------------------------------------
// 1. Enums & Primitive Schemas
// ---------------------------------------------------------------------------

export const CRM5_API_PREFIX = '/api/v1/crm-control';

export const CrmModuleSchema = z.enum(['crm-1', 'crm-2', 'crm-3', 'crm-4', 'crm-5']);
export type CrmModule = z.infer<typeof CrmModuleSchema>;

export const MigrationStepSchema = z.enum([
  'extract',
  'profile',
  'clean',
  'map',
  'load',
  'validate',
  'reconcile',
]);
export type MigrationStep = z.infer<typeof MigrationStepSchema>;

export const MigrationRunStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'halted',
]);
export type MigrationRunStatus = z.infer<typeof MigrationRunStatusSchema>;

export const ReconciliationStatusSchema = z.enum(['OK', 'UNBALANCED']);
export type ReconciliationStatus = z.infer<typeof ReconciliationStatusSchema>;

// Standard Error Envelope is now centralized in common.ts (PLT-04)

// Bounded Pagination Query (hard cap of 100, rejects > 100 with 400)
export const BasePaginationQuerySchema = z.object({
  page: z.coerce
    .number()
    .int({ message: 'page must be an integer' })
    .min(1, { message: 'page must be >= 1' })
    .default(1),
  pageSize: z.coerce
    .number()
    .int({ message: 'pageSize must be an integer' })
    .min(1, { message: 'pageSize must be >= 1' })
    .max(100, { message: 'pageSize cannot exceed 100' })
    .optional(),
  limit: z.coerce
    .number()
    .int({ message: 'limit must be an integer' })
    .min(1, { message: 'limit must be >= 1' })
    .max(100, { message: 'limit cannot exceed 100' })
    .optional(),
});

// Standard PaginationQuery is now centralized in common.ts (PLT-04)

// ---------------------------------------------------------------------------
// 2. Migration Run Schemas
// ---------------------------------------------------------------------------

export const MigrationRunSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().min(1).max(128),
  module: CrmModuleSchema,
  step: MigrationStepSchema,
  status: MigrationRunStatusSchema,
  recordsIn: z.number().int().nonnegative(),
  recordsOut: z.number().int().nonnegative(),
  recordsRejected: z.number().int().nonnegative(),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type MigrationRun = z.infer<typeof MigrationRunSchema>;

export const RunsQuerySchema = BasePaginationQuerySchema.extend({
  module: CrmModuleSchema.optional(),
  batchId: z.string().optional(),
  status: MigrationRunStatusSchema.optional(),
}).transform((data) => {
  const size = data.pageSize ?? data.limit ?? 20;
  return {
    page: data.page,
    pageSize: size,
    limit: size,
    module: data.module,
    batchId: data.batchId,
    status: data.status,
  };
});
export type RunsQuery = z.infer<typeof RunsQuerySchema>;

export const PaginatedRunsResponseSchema = z.object({
  items: z.array(MigrationRunSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});
export type PaginatedRunsResponse = z.infer<typeof PaginatedRunsResponseSchema>;

// ---------------------------------------------------------------------------
// 3. Quality Score Schemas & Exact Formula
// ---------------------------------------------------------------------------

export const QualityScoreComponentsSchema = z.object({
  completeness: z.number().min(0).max(1).nullable().optional(),
  validity: z.number().min(0).max(1).nullable().optional(),
  duplicateRate: z.number().min(0).max(1).nullable().optional(),
  rejectRate: z.number().min(0).max(1).nullable().optional(),
  linkIntegrity: z.number().min(0).max(1).nullable().optional(),
});
export type QualityScoreComponents = z.infer<typeof QualityScoreComponentsSchema>;

export const QualityScoreSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().min(1).max(128),
  module: CrmModuleSchema,
  completeness: z.number().min(0).max(1).nullable(),
  validity: z.number().min(0).max(1).nullable(),
  duplicateRate: z.number().min(0).max(1).nullable(),
  rejectRate: z.number().min(0).max(1).nullable(),
  linkIntegrity: z.number().min(0).max(1).nullable(),
  score: z.number().min(0).max(100).nullable(),
  isFullyScored: z.boolean(),
  scoredAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});
export type QualityScore = z.infer<typeof QualityScoreSchema>;

export const ScoresQuerySchema = BasePaginationQuerySchema.extend({
  module: CrmModuleSchema.optional(),
  batchId: z.string().optional(),
}).transform((data) => {
  const size = data.pageSize ?? data.limit ?? 20;
  return {
    page: data.page,
    pageSize: size,
    limit: size,
    module: data.module,
    batchId: data.batchId,
  };
});
export type ScoresQuery = z.infer<typeof ScoresQuerySchema>;

export const ScoresResponseSchema = z.object({
  items: z.array(QualityScoreSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  limit: z.number().int().positive(),
  averageScore: z.number().min(0).max(100).nullable(),
});
export type ScoresResponse = z.infer<typeof ScoresResponseSchema>;

/**
 * Exact Quality Score Calculation:
 * Score = 100 * (completeness + validity + (1 - duplicate_rate) + (1 - reject_rate) + link_integrity) / 5
 * Rounded to 2 decimal places. Returns null if any of the 5 components is missing/unavailable.
 */
export function computeQualityScore(c: QualityScoreComponents): number | null {
  if (
    c.completeness == null ||
    c.validity == null ||
    c.duplicateRate == null ||
    c.rejectRate == null ||
    c.linkIntegrity == null
  ) {
    return null;
  }
  const raw =
    100 *
    (c.completeness +
      c.validity +
      (1 - c.duplicateRate) +
      (1 - c.rejectRate) +
      c.linkIntegrity) /
    5;
  return Math.round(raw * 100) / 100;
}
export const calculateQualityScore = computeQualityScore;


// ---------------------------------------------------------------------------
// 4. Migration Rejects Schemas
// ---------------------------------------------------------------------------

export const MigrationRejectSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().min(1).max(128),
  module: CrmModuleSchema,
  rowIndex: z.number().int().positive(),
  errorCode: z.string().min(1).max(64),
  errorMessage: z.string().min(1),
  rawPayloadHash: z.string().length(64),
  createdAt: z.coerce.date(),
});
export type MigrationReject = z.infer<typeof MigrationRejectSchema>;

export const RejectsQuerySchema = BasePaginationQuerySchema.extend({
  module: CrmModuleSchema.optional(),
  batchId: z.string().optional(),
}).transform((data) => {
  const size = data.pageSize ?? data.limit ?? 20;
  return {
    page: data.page,
    pageSize: size,
    limit: size,
    module: data.module,
    batchId: data.batchId,
  };
});
export type RejectsQuery = z.infer<typeof RejectsQuerySchema>;

export const PaginatedRejectsResponseSchema = z.object({
  items: z.array(MigrationRejectSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  limit: z.number().int().positive(),
});
export type PaginatedRejectsResponse = z.infer<typeof PaginatedRejectsResponseSchema>;

// ---------------------------------------------------------------------------
// 5. Reconciliation Report Schemas & Exact Conservation Invariant
// ---------------------------------------------------------------------------

export const ReconciliationReportSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().min(1).max(128),
  module: CrmModuleSchema,
  sourceCount: z.number().int().nonnegative(),
  loadedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  mergedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  unaccountedCount: z.number().int().nonnegative(),
  status: ReconciliationStatusSchema,
  reconciledAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});
export type ReconciliationReport = z.infer<typeof ReconciliationReportSchema>;

export interface ReconciliationInput {
  sourceCount: number;
  loadedCount: number;
  rejectedCount: number;
  mergedCount: number;
  skippedCount: number;
}

export interface ReconciliationVerification {
  unaccountedCount: number;
  status: ReconciliationStatus;
  isBalanced: boolean;
}

/**
 * Exact Reconciliation Verification:
 * Source = Loaded + Rejected + Merged + Skipped + Unaccounted
 * OK only if unaccounted = 0 and equation balances.
 */
export function verifyReconciliation(input: ReconciliationInput): ReconciliationVerification {
  const accounted =
    input.loadedCount +
    input.rejectedCount +
    input.mergedCount +
    input.skippedCount;
  const unaccounted = Math.max(0, input.sourceCount - accounted);
  const isBalanced = unaccounted === 0 && input.sourceCount === accounted;
  return {
    unaccountedCount: unaccounted,
    status: isBalanced ? 'OK' : 'UNBALANCED',
    isBalanced,
  };
}

/**
 * Formula Injection Defense for CSV/Spreadsheet Exports:
 * Neutralizes leading '=', '+', '-', '@', '\t', '\r' by prepending a single quote.
 */
export function sanitizeCsvFormula(value: string): string {
  if (typeof value !== 'string') return String(value);
  if (/^[=+\-@\t\r]/.test(value) || /^[=+\-@]/.test(value.trimStart())) {
    return `'${value}`;
  }
  return value;
}

// ---------------------------------------------------------------------------
// 6. Mutation Input Schemas
// ---------------------------------------------------------------------------

export const CreateRunInputSchema = z.object({
  batchId: z.string().min(1, 'batchId is required').max(128),
  module: CrmModuleSchema,
  step: MigrationStepSchema,
  status: MigrationRunStatusSchema.default('pending'),
  recordsIn: z.number().int({ message: 'recordsIn must be an integer' }).nonnegative({ message: 'recordsIn cannot be negative' }).default(0),
  recordsOut: z.number().int({ message: 'recordsOut must be an integer' }).nonnegative({ message: 'recordsOut cannot be negative' }).default(0),
  recordsRejected: z.number().int({ message: 'recordsRejected must be an integer' }).nonnegative({ message: 'recordsRejected cannot be negative' }).default(0),
  startedAt: z.coerce.date().optional(),
  completedAt: z.coerce.date().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  idempotencyKey: z.string().max(128).optional(),
});
export type CreateRunInput = z.infer<typeof CreateRunInputSchema>;

export const UpdateRunInputSchema = z.object({
  status: MigrationRunStatusSchema.optional(),
  recordsIn: z.number().int({ message: 'recordsIn must be an integer' }).nonnegative({ message: 'recordsIn cannot be negative' }).optional(),
  recordsOut: z.number().int({ message: 'recordsOut must be an integer' }).nonnegative({ message: 'recordsOut cannot be negative' }).optional(),
  recordsRejected: z.number().int({ message: 'recordsRejected must be an integer' }).nonnegative({ message: 'recordsRejected cannot be negative' }).optional(),
  completedAt: z.coerce.date().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  expectedUpdatedAt: z.coerce.date().optional(),
});
export type UpdateRunInput = z.infer<typeof UpdateRunInputSchema>;

export const CreateScoreInputSchema = z.object({
  batchId: z.string().min(1, 'batchId is required').max(128),
  module: CrmModuleSchema,
  completeness: z.number().min(0, 'completeness must be >= 0').max(1, 'completeness must be <= 1').nullable().optional(),
  validity: z.number().min(0, 'validity must be >= 0').max(1, 'validity must be <= 1').nullable().optional(),
  duplicateRate: z.number().min(0, 'duplicateRate must be >= 0').max(1, 'duplicateRate must be <= 1').nullable().optional(),
  rejectRate: z.number().min(0, 'rejectRate must be >= 0').max(1, 'rejectRate must be <= 1').nullable().optional(),
  linkIntegrity: z.number().min(0, 'linkIntegrity must be >= 0').max(1, 'linkIntegrity must be <= 1').nullable().optional(),
  idempotencyKey: z.string().max(128).optional(),
});
export type CreateScoreInput = z.infer<typeof CreateScoreInputSchema>;

export const CreateReconciliationInputSchema = z.object({
  batchId: z.string().min(1, 'batchId is required').max(128),
  module: CrmModuleSchema,
  sourceCount: z.number().int({ message: 'sourceCount must be an integer' }).nonnegative({ message: 'sourceCount cannot be negative' }),
  loadedCount: z.number().int({ message: 'loadedCount must be an integer' }).nonnegative({ message: 'loadedCount cannot be negative' }),
  rejectedCount: z.number().int({ message: 'rejectedCount must be an integer' }).nonnegative({ message: 'rejectedCount cannot be negative' }),
  mergedCount: z.number().int({ message: 'mergedCount must be an integer' }).nonnegative({ message: 'mergedCount cannot be negative' }).default(0),
  skippedCount: z.number().int({ message: 'skippedCount must be an integer' }).nonnegative({ message: 'skippedCount cannot be negative' }).default(0),
  idempotencyKey: z.string().max(128).optional(),
});
export type CreateReconciliationInput = z.infer<typeof CreateReconciliationInputSchema>;

export const CreateRejectInputSchema = z.object({
  batchId: z.string().min(1, 'batchId is required').max(128),
  module: CrmModuleSchema,
  rowIndex: z.number().int({ message: 'rowIndex must be an integer' }).min(1, { message: 'rowIndex must be >= 1' }),
  errorCode: z.string().min(1, 'errorCode is required').max(64),
  errorMessage: z.string().min(1, 'errorMessage is required'),
  rawPayloadHash: z.string().min(16).max(64),
  idempotencyKey: z.string().max(128).optional(),
});
export type CreateRejectInput = z.infer<typeof CreateRejectInputSchema>;

// ---------------------------------------------------------------------------
// 7. Exact Duplicate Key Policy Contracts & Normalizers (CRM5-12)
// ---------------------------------------------------------------------------

export const ExactKeyTypeSchema = z.enum([
  'email',
  'tax_id',
  'sku',
  'phone',
  'composite',
]);
export type ExactKeyType = z.infer<typeof ExactKeyTypeSchema>;

export const DuplicateCandidateStatusSchema = z.enum([
  'unique',
  'duplicate_candidate',
  'held_for_review',
  'resolved',
]);
export type DuplicateCandidateStatus = z.infer<typeof DuplicateCandidateStatusSchema>;

export const DuplicateReviewDecisionSchema = z.enum([
  'MERGE',
  'REJECT_DUPLICATE',
  'KEEP_SEPARATE',
]);
export type DuplicateReviewDecision = z.infer<typeof DuplicateReviewDecisionSchema>;

/**
 * Normalization Rules:
 * 1. Email: trimmed and lowercased.
 * 2. Tax ID: trimmed, uppercased, stripped of punctuation and whitespace.
 * 3. SKU: trimmed, uppercased, collapsed internal whitespace.
 * 4. Phone: trimmed, stripped of punctuation, retains leading '+' if present.
 * 5. Composite: deterministic sorted key:value serialization.
 */
export function normalizeEmail(value: string): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

export function normalizeTaxId(value: string): string {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase().replace(/[\s\-_./]/g, '');
}

export function normalizeSku(value: string): string {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function normalizePhone(value: string): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}

export function normalizeCompositeKey(parts: Record<string, unknown> | Array<unknown>): string {
  if (Array.isArray(parts)) {
    return parts.map((p) => String(p ?? '').trim()).join(':');
  }
  const keys = Object.keys(parts).sort();
  return keys
    .map((k) => `${k}=${String(parts[k] ?? '').trim()}`)
    .join(';');
}

export function normalizeExactKey(type: ExactKeyType | string, value: string): string {
  switch (type) {
    case 'email':
      return normalizeEmail(value);
    case 'tax_id':
      return normalizeTaxId(value);
    case 'sku':
      return normalizeSku(value);
    case 'phone':
      return normalizePhone(value);
    case 'composite':
      return value.trim().toLowerCase();
    default:
      return value.trim();
  }
}

export const DuplicateCandidateSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().min(1).max(128).optional(),
  module: CrmModuleSchema.optional(),
  keyType: ExactKeyTypeSchema,
  normalizedKey: z.string().min(1),
  recordIds: z.array(z.string()).min(2),
  status: DuplicateCandidateStatusSchema,
  detectedAt: z.coerce.date(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type DuplicateCandidate = z.infer<typeof DuplicateCandidateSchema>;

export const ResolveDuplicateInputSchema = z
  .object({
    candidateId: z.string().min(1, 'candidateId is required'),
    decision: DuplicateReviewDecisionSchema,
    actorId: z.string().min(1, 'actorId is required'),
    keptId: z.string().min(1, 'keptId is required'),
    mergedId: z.string().min(1, 'mergedId is required'),
    reason: z.string().min(1, 'reason is required'),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (data) => {
      if (data.decision === 'MERGE') {
        return data.keptId !== data.mergedId;
      }
      return true;
    },
    {
      message: 'keptId and mergedId cannot be the same entity for MERGE decision',
      path: ['mergedId'],
    }
  );
export type ResolveDuplicateInput = z.infer<typeof ResolveDuplicateInputSchema>;

export const DuplicateAuditLogEntrySchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string(),
  decision: DuplicateReviewDecisionSchema,
  actorId: z.string(),
  timestamp: z.coerce.date(),
  keptId: z.string(),
  mergedId: z.string(),
  reason: z.string(),
  keyType: ExactKeyTypeSchema.optional(),
  normalizedKey: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type DuplicateAuditLogEntry = z.infer<typeof DuplicateAuditLogEntrySchema>;

export const DetectDuplicatesInputSchema = z.object({
  batchId: z.string().min(1).max(128).optional(),
  module: CrmModuleSchema.optional(),
  keyType: ExactKeyTypeSchema,
  autoMerge: z.boolean().optional().default(false),
  records: z.array(
    z.object({
      id: z.string().min(1, 'record id is required'),
      keyValue: z.string().min(1, 'keyValue is required'),
      payload: z.record(z.string(), z.unknown()).optional(),
    })
  ).min(1, 'At least one record is required for duplicate detection'),
});
export type DetectDuplicatesInput = z.infer<typeof DetectDuplicatesInputSchema>;
// 7. Batch Aggregates & Consistency Schemas
// ---------------------------------------------------------------------------

export const BatchTotalsSchema = z.object({
  totalRecordsIn: z.number().int().nonnegative(),
  totalRecordsOut: z.number().int().nonnegative(),
  totalRecordsRejected: z.number().int().nonnegative(),
  stepsCompleted: z.number().int().nonnegative(),
  stepsTotal: z.number().int().positive(),
  progressPercentage: z.number().int().min(0).max(100),
});
export type BatchTotalsContract = z.infer<typeof BatchTotalsSchema>;

export const BatchConsistencySchema = z.object({
  isConsistent: z.boolean(),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
});
export type BatchConsistencyContract = z.infer<typeof BatchConsistencySchema>;

export const BatchSummarySchema = z.object({
  batchId: z.string().min(1).max(128),
  module: CrmModuleSchema,
  status: MigrationRunStatusSchema,
  totals: BatchTotalsSchema,
  score: QualityScoreSchema.nullable(),
  reconciliation: ReconciliationReportSchema.nullable(),
  consistency: BatchConsistencySchema,
  updatedAt: z.coerce.date(),
});
export type BatchSummaryContract = z.infer<typeof BatchSummarySchema>;

// ---------------------------------------------------------------------------
// 8. Idempotent Retry & Chunked Load Execution Contracts (CRM5-13)
// ---------------------------------------------------------------------------

export const DEFAULT_CHUNK_SIZE = 500;
export const DEFAULT_FAILURE_THRESHOLD = 0.10;
export const DEFAULT_MIN_ATTEMPTED_ROWS = 50;
export const DEFAULT_MAX_RETRIES = 3;

export const BatchExecutionStatusSchema = z.enum([
  'COMPLETED',
  'STOPPED_EXCESSIVE_FAILURES',
  'FAILED',
]);
export type BatchExecutionStatus = z.infer<typeof BatchExecutionStatusSchema>;

export const BatchRecordInputSchema = z.object({
  sourceRow: z.number().int({ message: 'sourceRow must be an integer' }).min(1),
  idempotencyKey: z.string().min(1, 'idempotencyKey is required').max(128),
  data: z.record(z.string(), z.unknown()),
});
export type BatchRecordInput = z.infer<typeof BatchRecordInputSchema>;

export const ExecuteBatchLoadInputSchema = z.object({
  batchId: z.string().min(1, 'batchId is required').max(128),
  module: CrmModuleSchema,
  step: MigrationStepSchema.default('load'),
  chunkSize: z.number().int().min(1).max(1000).default(DEFAULT_CHUNK_SIZE),
  maxRetries: z.number().int().min(0).max(5).default(DEFAULT_MAX_RETRIES),
  failureThreshold: z.number().min(0).max(1).default(DEFAULT_FAILURE_THRESHOLD),
  minAttemptedRows: z.number().int().min(1).default(DEFAULT_MIN_ATTEMPTED_ROWS),
  records: z.array(BatchRecordInputSchema).min(1, 'records must not be empty'),
});
export type ExecuteBatchLoadInput = z.infer<typeof ExecuteBatchLoadInputSchema>;

export const ImportReceiptSchema = z.object({
  batchId: z.string(),
  sourceRow: z.number().int(),
  idempotencyKey: z.string(),
  targetId: z.string(),
  kind: z.enum(['created', 'linked']).default('created'),
  committedAt: z.coerce.date(),
});
export type ImportReceipt = z.infer<typeof ImportReceiptSchema>;

export const FailedRowSchema = z.object({
  sourceRow: z.number().int(),
  idempotencyKey: z.string(),
  errorCode: z.string(),
  errorMessage: z.string(),
  retryAttempts: z.number().int(),
  payloadHash: z.string().optional(),
});
export type FailedRow = z.infer<typeof FailedRowSchema>;

export const BatchExecutionReportSchema = z.object({
  batchId: z.string(),
  module: CrmModuleSchema,
  step: MigrationStepSchema,
  status: BatchExecutionStatusSchema,
  totalRecords: z.number().int().nonnegative(),
  attemptedRecords: z.number().int().nonnegative(),
  committedRecords: z.number().int().nonnegative(),
  failedRecords: z.number().int().nonnegative(),
  chunksProcessed: z.number().int().nonnegative(),
  chunkSize: z.number().int(),
  failureRate: z.number().min(0).max(1),
  haltReason: z.string().nullable().optional(),
  committedReceipts: z.array(ImportReceiptSchema),
  failedRows: z.array(FailedRowSchema),
  executedAt: z.coerce.date(),
});
export type BatchExecutionReport = z.infer<typeof BatchExecutionReportSchema>;

// ---------------------------------------------------------------------------
// 9. Security & Audit Schemas (Issue #54 / [CRM5-15])
// ---------------------------------------------------------------------------

export const CRM5AuditEventSchema = z.object({
  id: z.string().uuid(),
  actor: z.string().min(1),
  action: z.string().min(1),
  entity: z.string().min(1),
  entityId: z.string().uuid().nullable().optional(),
  batchId: z.string().nullable().optional(),
  result: z.enum(['success', 'failure', 'rejected', 'halted']),
  diffRedacted: z.record(z.string(), z.unknown()).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.coerce.date(),
});
export type CRM5AuditEvent = z.infer<typeof CRM5AuditEventSchema>;

export const CRM5ErrorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.array(z.unknown()).optional(),
  correlation_id: z.string().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.array(z.unknown()).optional(),
    })
    .optional(),
});
export type CRM5ErrorEnvelope = z.infer<typeof CRM5ErrorEnvelopeSchema>;

export * from './import-target.js';
export {
  CRM5_RUNS_TARGET_FIELDS,
  CRM5_SCORES_TARGET_FIELDS,
  CRM5_REJECTS_TARGET_FIELDS,
  CRM5_RECONCILIATION_TARGET_FIELDS,
  CRM5_TARGET_ENTITIES,
} from './migration-target.js';


