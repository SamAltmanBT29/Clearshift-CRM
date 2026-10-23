import { z } from 'zod';
import { createHash } from 'node:crypto';

/**
 * Migration Kit Batch Statuses (KIT-01)
 *
 * Valid success path:
 * created -> extracting -> extracted -> profiled -> cleaned -> mapped -> dry_run_passed -> loading -> loaded -> validating -> validated -> reconciled
 *
 * Side states:
 * failed, load_failed_partial, rollback_pending, rollback_blocked, rolled_back
 */
export const KitBatchSuccessStatusSchema = z.enum([
  'created',
  'extracting',
  'extracted',
  'profiled',
  'cleaned',
  'mapped',
  'dry_run_passed',
  'loading',
  'loaded',
  'validating',
  'validated',
  'reconciled',
]);
export type KitBatchSuccessStatus = z.infer<typeof KitBatchSuccessStatusSchema>;

export const KitBatchSideStatusSchema = z.enum([
  'failed',
  'load_failed_partial',
  'rollback_pending',
  'rollback_blocked',
  'rolled_back',
]);
export type KitBatchSideStatus = z.infer<typeof KitBatchSideStatusSchema>;

export const KitBatchStatusSchema = z.enum([
  // Success path
  'created',
  'extracting',
  'extracted',
  'profiled',
  'cleaned',
  'mapped',
  'dry_run_passed',
  'loading',
  'loaded',
  'validating',
  'validated',
  'reconciled',
  // Side states
  'failed',
  'load_failed_partial',
  'rollback_pending',
  'rollback_blocked',
  'rolled_back',
]);
export type KitBatchStatus = z.infer<typeof KitBatchStatusSchema>;

/**
 * Seven-step pipeline step names
 */
export const KitBatchStepNameSchema = z.enum([
  'extract',
  'profile',
  'clean',
  'map',
  'dry_run',
  'load',
  'validate',
  'reconcile',
]);
export type KitBatchStepName = z.infer<typeof KitBatchStepNameSchema>;

/**
 * Custom Error for illegal state transitions
 */
export class IllegalBatchStateTransitionError extends Error {
  public readonly statusCode = 409;
  public readonly code = 'CONFLICT';

  constructor(
    public readonly fromStatus: string,
    public readonly toStatus: string,
    public readonly batchId?: string,
    additionalMessage?: string
  ) {
    const baseMsg = batchId
      ? `Illegal batch state transition from '${fromStatus}' to '${toStatus}' for batch '${batchId}'`
      : `Illegal batch state transition from '${fromStatus}' to '${toStatus}'`;
    super(additionalMessage ? `${baseMsg}: ${additionalMessage}` : baseMsg);
    this.name = 'IllegalBatchStateTransitionError';
  }
}

/**
 * Custom Error when trying to mutate an immutable ledger entry
 */
export class ImmutableStepLedgerError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'LEDGER_IMMUTABLE';

  constructor(message: string = 'Step ledger entries are append-only and cannot be modified or deleted') {
    super(message);
    this.name = 'ImmutableStepLedgerError';
  }
}

/**
 * State Transition Guard Mapping
 * Defines all allowable transitions for Migration Kit Batches.
 */
export const KIT_BATCH_TRANSITIONS_MAP: Record<KitBatchStatus, readonly KitBatchStatus[]> = {
  // Step 1: Ingestion / Extraction
  created: ['extracting', 'failed'],
  extracting: ['extracted', 'failed'],

  // Step 2: Profiling
  extracted: ['profiled', 'failed'],

  // Step 3: Cleaning
  profiled: ['cleaned', 'failed'],

  // Step 4: Mapping
  cleaned: ['mapped', 'failed'],

  // Step 5: Dry-Run
  mapped: ['dry_run_passed', 'failed'],

  // Step 6: Loading
  dry_run_passed: ['loading', 'failed'],
  loading: ['loaded', 'failed', 'load_failed_partial'],
  load_failed_partial: ['loading', 'failed', 'rollback_pending'],

  // Step 7: Validation
  loaded: ['validating', 'failed'],
  validating: ['validated', 'failed'],

  // Step 8: Reconciliation
  validated: ['reconciled', 'failed'],

  // Terminal states
  reconciled: [],
  rolled_back: [],

  // Rollback flow states
  rollback_pending: ['rolled_back', 'rollback_blocked', 'failed'],
  rollback_blocked: ['failed'],

  // Resumable failure state:
  // Cannot restart from created implicitly; must resume from a committed checkpoint
  failed: [
    'extracting',
    'profiled',
    'cleaned',
    'mapped',
    'dry_run_passed',
    'loading',
    'validating',
    'reconciled',
    'rollback_pending',
  ],
};

/**
 * Maps terminal step status to the step name
 */
export const STATUS_TO_STEP_NAME: Partial<Record<KitBatchStatus, KitBatchStepName>> = {
  extracting: 'extract',
  extracted: 'extract',
  profiled: 'profile',
  cleaned: 'clean',
  mapped: 'map',
  dry_run_passed: 'dry_run',
  loading: 'load',
  loaded: 'load',
  load_failed_partial: 'load',
  validating: 'validate',
  validated: 'validate',
  reconciled: 'reconcile',
};

/**
 * Status to Checkpoint mapping
 */
export const STATUS_TO_CHECKPOINT: Record<KitBatchStatus, string> = {
  created: 'created',
  extracting: 'extracting',
  extracted: 'extracted',
  profiled: 'profiled',
  cleaned: 'cleaned',
  mapped: 'mapped',
  dry_run_passed: 'dry_run_passed',
  loading: 'loading',
  loaded: 'loaded',
  load_failed_partial: 'load_checkpoint',
  validating: 'validating',
  validated: 'validated',
  reconciled: 'reconciled',
  failed: 'failed',
  rollback_pending: 'rollback_pending',
  rollback_blocked: 'rollback_blocked',
  rolled_back: 'rolled_back',
};

/**
 * Computes the durable checkpoint associated with moving to a target status.
 */
export function computeNextCheckpoint(
  targetStatus: KitBatchStatus,
  previousCheckpoint: string
): string {
  if (targetStatus === 'load_failed_partial') {
    return 'load_checkpoint';
  }

  if (targetStatus === 'failed' || targetStatus === 'rollback_pending' || targetStatus === 'rollback_blocked') {
    return previousCheckpoint;
  }

  return STATUS_TO_CHECKPOINT[targetStatus] || previousCheckpoint;
}

/**
 * Resolves the step name for a target state
 */
export function resolveStepName(
  targetStatus: KitBatchStatus,
  overrideName?: KitBatchStepName
): KitBatchStepName {
  if (overrideName) {
    return overrideName;
  }
  const inferred = STATUS_TO_STEP_NAME[targetStatus];
  if (inferred) {
    return inferred;
  }
  return 'extract';
}

/**
 * Checks if a transition between two batch states is allowed.
 * Idempotent transitions (from === to) are always permitted.
 */
export function canKitBatchTransition(from: KitBatchStatus, to: KitBatchStatus): boolean {
  if (from === to) {
    return true;
  }
  const allowed = KIT_BATCH_TRANSITIONS_MAP[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Asserts that a state transition is legal, throwing IllegalBatchStateTransitionError if forbidden.
 * Also verifies that retries cannot restart from 'created' implicitly when attempt > 1 or prior steps exist.
 */
export function assertValidKitBatchTransition(
  from: KitBatchStatus,
  to: KitBatchStatus,
  batchId?: string,
  currentCheckpoint?: string,
  attempt: number = 1
): void {
  if (from === to) {
    return;
  }

  // Explicit check: retries cannot restart from 'created' implicitly
  if (to === 'created') {
    throw new IllegalBatchStateTransitionError(
      from,
      to,
      batchId,
      'Batch cannot restart from created implicitly; must resume from committed checkpoint'
    );
  }

  // Guard against illegal transitions from terminal states
  if (isKitBatchTerminalStatus(from)) {
    throw new IllegalBatchStateTransitionError(
      from,
      to,
      batchId,
      `Cannot transition from terminal status '${from}'`
    );
  }

  if (!canKitBatchTransition(from, to)) {
    throw new IllegalBatchStateTransitionError(from, to, batchId);
  }

  // If retrying from failed, ensure we don't jump arbitrarily to uncheckpointed state
  if (from === 'failed' && currentCheckpoint) {
    // When resuming from failed, the destination must match or advance beyond the checkpoint
    const allowedResumeTarget = getValidResumeTarget(currentCheckpoint);
    if (allowedResumeTarget && to !== allowedResumeTarget && to !== 'rollback_pending') {
      throw new IllegalBatchStateTransitionError(
        from,
        to,
        batchId,
        `Retry must resume from committed checkpoint '${currentCheckpoint}' (expected target '${allowedResumeTarget}')`
      );
    }
  }
}

/**
 * Gets the valid resume target state given a committed checkpoint
 */
export function getValidResumeTarget(checkpoint: string): KitBatchStatus | null {
  switch (checkpoint) {
    case 'created':
    case 'extracting':
      return 'extracting';
    case 'extracted':
      return 'profiled';
    case 'profiled':
      return 'cleaned';
    case 'cleaned':
      return 'mapped';
    case 'mapped':
      return 'dry_run_passed';
    case 'dry_run_passed':
      return 'loading';
    case 'load_checkpoint':
    case 'loading':
      return 'loading';
    case 'loaded':
    case 'validating':
      return 'validating';
    case 'validated':
      return 'reconciled';
    default:
      return null;
  }
}

/**
 * Identifies terminal states for Migration Kit batches
 */
export function isKitBatchTerminalStatus(status: KitBatchStatus): boolean {
  return status === 'reconciled' || status === 'rolled_back';
}

/**
 * Identifies resumable / retryable states
 */
export function isKitBatchResumableStatus(status: KitBatchStatus): boolean {
  return status === 'failed' || status === 'load_failed_partial';
}

/**
 * Returns allowed next states from the transition matrix
 */
export function getAllowedNextKitBatchStates(status: KitBatchStatus): KitBatchStatus[] {
  return [...(KIT_BATCH_TRANSITIONS_MAP[status] || [])];
}

/**
 * Kit Batch Schema
 */
export const KitBatchSchema = z.object({
  id: z.string().uuid(),
  batchNumber: z.string().min(1).max(64),
  module: z.string().min(1).max(64),
  sourceSystem: z.string().max(64).nullable().optional(),
  fileName: z.string().max(255).nullable().optional(),
  fileSizeBytes: z.number().int().nonnegative().nullable().optional(),
  checksum: z.string().length(64),
  status: KitBatchStatusSchema,
  previousStatus: KitBatchStatusSchema.nullable().optional(),
  checkpoint: z.string().max(64),
  attempt: z.number().int().min(1),
  maxAttempts: z.number().int().min(1).default(3),
  totalRows: z.number().int().nonnegative().default(0),
  loadedRows: z.number().int().nonnegative().default(0),
  rejectedRows: z.number().int().nonnegative().default(0),
  mergedRows: z.number().int().nonnegative().default(0),
  skippedRows: z.number().int().nonnegative().default(0),
  unaccountedRows: z.number().int().nonnegative().default(0),
  ruleVersion: z.string().max(32).default('1.0.0'),
  codeVersion: z.string().max(32).default('1.0.0'),
  errorCode: z.string().max(64).nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  correlationId: z.string().max(128),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdBy: z.string().max(128).default('system'),
  startedAt: z.coerce.date().nullable().optional(),
  finishedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type KitBatch = z.infer<typeof KitBatchSchema>;

/**
 * Kit Batch Step Ledger Schema (Immutable)
 */
export const KitBatchStepSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().uuid(),
  stepNumber: z.number().int().min(1),
  stepName: KitBatchStepNameSchema,
  fromStatus: KitBatchStatusSchema,
  toStatus: KitBatchStatusSchema,
  attempt: z.number().int().min(1),
  checkpoint: z.string().max(64),
  recordsIn: z.number().int().nonnegative().default(0),
  recordsOut: z.number().int().nonnegative().default(0),
  recordsRejected: z.number().int().nonnegative().default(0),
  recordsMerged: z.number().int().nonnegative().default(0),
  recordsSkipped: z.number().int().nonnegative().default(0),
  ruleVersion: z.string().max(32).default('1.0.0'),
  codeVersion: z.string().max(32).default('1.0.0'),
  errorCode: z.string().max(64).nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  correlationId: z.string().max(128),
  actor: z.string().max(128).default('system'),
  durationMs: z.number().int().nonnegative().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
});
export type KitBatchStep = z.infer<typeof KitBatchStepSchema>;

/**
 * Creation Input
 */
export const CreateKitBatchInputSchema = z.object({
  id: z.string().uuid().optional(),
  batchNumber: z.string().min(1).max(64).optional(),
  module: z.string().min(1).max(64),
  sourceSystem: z.string().max(64).optional(),
  fileName: z.string().max(255).optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  checksum: z.string().length(64),
  totalRows: z.number().int().nonnegative().default(0),
  ruleVersion: z.string().max(32).default('1.0.0'),
  codeVersion: z.string().max(32).default('1.0.0'),
  correlationId: z.string().max(128).optional(),
  createdBy: z.string().max(128).default('system'),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type CreateKitBatchInput = z.input<typeof CreateKitBatchInputSchema>;

/**
 * State Transition Input
 */
export const TransitionKitBatchInputSchema = z.object({
  targetStatus: KitBatchStatusSchema,
  stepName: KitBatchStepNameSchema.optional(),
  checkpoint: z.string().max(64).optional(),
  recordsIn: z.number().int().nonnegative().optional(),
  recordsOut: z.number().int().nonnegative().optional(),
  recordsRejected: z.number().int().nonnegative().optional(),
  recordsMerged: z.number().int().nonnegative().optional(),
  recordsSkipped: z.number().int().nonnegative().optional(),
  errorCode: z.string().max(64).nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  correlationId: z.string().max(128).optional(),
  actor: z.string().max(128).default('system'),
  durationMs: z.number().int().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type TransitionKitBatchInput = z.input<typeof TransitionKitBatchInputSchema>;

/**
 * Resume Input
 */
export const ResumeKitBatchInputSchema = z.object({
  correlationId: z.string().max(128).optional(),
  actor: z.string().max(128).default('system'),
  reason: z.string().optional(),
});
export type ResumeKitBatchInput = z.input<typeof ResumeKitBatchInputSchema>;

/**
 * Row reconciliation verification helper
 * Enforces: source = loaded + rejected + merged + skipped; unaccounted = 0
 */
export function verifyReconciliationCounts(counts: {
  totalRows: number;
  loadedRows: number;
  rejectedRows: number;
  mergedRows: number;
  skippedRows: number;
}): { ok: boolean; unaccounted: number } {
  const sum = counts.loadedRows + counts.rejectedRows + counts.mergedRows + counts.skippedRows;
  const unaccounted = counts.totalRows - sum;
  return {
    ok: unaccounted === 0,
    unaccounted,
  };
}

/**
 * ---------------------------------------------------------------------------
 * KIT-02: Streamed Source Upload, Parser Limits & Raw Immutability Contracts
 * ---------------------------------------------------------------------------
 */

/**
 * Ingestion and Parser Resource Limits (KIT-02)
 */
export const INGESTION_LIMITS = {
  MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024, // 50 MiB = 52,428,800 bytes
  MAX_EXPANDED_ARCHIVE_SIZE_BYTES: 250 * 1024 * 1024, // 250 MiB = 262,144,000 bytes
  MAX_COLUMNS: 100,
  MAX_DATA_ROWS: 100_000,
  MAX_CELL_SIZE_BYTES: 64 * 1024, // 64 KiB = 65,536 bytes
} as const;

export const FileFormatSchema = z.enum(['csv', 'xlsx']);
export type FileFormat = z.infer<typeof FileFormatSchema>;

export const CsvDelimiterSchema = z.enum([',', ';']);
export type CsvDelimiter = z.infer<typeof CsvDelimiterSchema>;

/**
 * Parser Diagnostics Schema (Tracks blank physical rows, BOM, column counts)
 */
export const ParserDiagnosticsSchema = z.object({
  totalPhysicalLines: z.number().int().nonnegative(),
  blankRowsCount: z.number().int().nonnegative(),
  headerRowIndex: z.number().int().nonnegative(),
  dataRowsCount: z.number().int().nonnegative(),
  columnsCount: z.number().int().nonnegative(),
  detectedDelimiter: z.string(),
  hasBom: z.boolean(),
  warnings: z.array(z.string()).default([]),
});
export type ParserDiagnostics = z.infer<typeof ParserDiagnosticsSchema>;

/**
 * Raw Row Schema (Stored in raw_rows with ordered headers, cells, and checksum)
 */
export const RawRowSchema = z.object({
  id: z.string().uuid().optional(),
  batchId: z.string().uuid(),
  sourceRow: z.number().int().min(1),
  headers: z.array(z.string()),
  cells: z.array(z.string()),
  payload: z.record(z.string(), z.string()),
  rowHash: z.string().length(64),
  createdAt: z.coerce.date().optional(),
});
export type RawRow = z.infer<typeof RawRowSchema>;

/**
 * Options when uploading/streaming a source file
 */
export const UploadSourceOptionsSchema = z.object({
  module: z.string().min(1).max(64),
  sourceSystem: z.string().max(64).optional(),
  format: FileFormatSchema.default('csv'),
  delimiter: CsvDelimiterSchema.default(','),
  dateFormat: z.string().max(32).optional(),
  phoneCountry: z.string().max(16).optional(),
  correlationId: z.string().max(128).optional(),
  actor: z.string().max(128).default('system'),
});
export type UploadSourceOptions = z.infer<typeof UploadSourceOptionsSchema>;

/**
 * Ingestion Result Contract
 */
export const IngestResultSchema = z.object({
  batchId: z.string().uuid(),
  batchNumber: z.string(),
  fileName: z.string(),
  fileSizeBytes: z.number().int().nonnegative(),
  checksum: z.string().length(64),
  storagePath: z.string(),
  headers: z.array(z.string()),
  totalDataRows: z.number().int().nonnegative(),
  diagnostics: ParserDiagnosticsSchema,
});
export type IngestResult = z.infer<typeof IngestResultSchema>;

/**
 * Custom Errors for Ingestion and Parser Limit Violations
 */
export type IngestionLimitType =
  | 'MAX_FILE_SIZE'
  | 'MAX_COLUMNS'
  | 'MAX_DATA_ROWS'
  | 'MAX_CELL_SIZE'
  | 'MAX_EXPANDED_ARCHIVE';

export class IngestionLimitError extends Error {
  public readonly statusCode: number;
  public readonly code = 'LIMIT_EXCEEDED';

  constructor(
    public readonly limitName: IngestionLimitType,
    public readonly limitValue: number,
    public readonly actualValue: number,
    customMessage?: string
  ) {
    const defaultMsg = `Ingestion limit exceeded: ${limitName} limit is ${limitValue}, received ${actualValue}`;
    super(customMessage || defaultMsg);
    this.name = 'IngestionLimitError';
    this.statusCode = limitName === 'MAX_FILE_SIZE' ? 413 : 400;
  }
}

export class InvalidEncodingError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'INVALID_ENCODING';

  constructor(message: string = 'Input file contains invalid non-UTF-8 byte sequences') {
    super(message);
    this.name = 'InvalidEncodingError';
  }
}

export class SecurityRejectedError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'SECURITY_REJECTED';

  constructor(public readonly securityReason: string) {
    super(`Security policy rejected file: ${securityReason}`);
    this.name = 'SecurityRejectedError';
  }
}

export class MalformedFileError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'MALFORMED_FILE';

  constructor(message: string) {
    super(`Malformed file: ${message}`);
    this.name = 'MalformedFileError';
  }
}

/**
 * ---------------------------------------------------------------------------
 * KIT-03: Column Profiling, Data Health Report & Export Contracts
 * ---------------------------------------------------------------------------
 */

export const InferredDataTypeSchema = z.enum([
  'string',
  'integer',
  'decimal',
  'date',
  'email',
  'phone',
  'uuid',
  'boolean',
  'json',
]);
export type InferredDataType = z.infer<typeof InferredDataTypeSchema>;

export const TopValueSchema = z.object({
  value: z.string(),
  count: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100),
});
export type TopValue = z.infer<typeof TopValueSchema>;

export const ColumnProfileSchema = z.object({
  columnName: z.string().min(1),
  totalRows: z.number().int().nonnegative(),
  emptyCount: z.number().int().nonnegative(),
  distinctCount: z.number().int().nonnegative(),
  invalidCount: z.number().int().nonnegative(),
  inferredType: InferredDataTypeSchema,
  topValues: z.array(TopValueSchema),
  minValue: z.string().nullable().optional(),
  maxValue: z.string().nullable().optional(),
});
export type ColumnProfile = z.infer<typeof ColumnProfileSchema>;

export const DuplicateCandidateReportSchema = z.object({
  keyFields: z.array(z.string()),
  totalDuplicates: z.number().int().nonnegative(),
  uniqueDuplicateKeys: z.number().int().nonnegative(),
  sampleDuplicateKeys: z.array(z.string()).default([]),
});
export type DuplicateCandidateReport = z.infer<typeof DuplicateCandidateReportSchema>;

export const ProfileReportSummarySchema = z.object({
  emptyCount: z.number().int().nonnegative(),
  invalidCount: z.number().int().nonnegative(),
  duplicateCount: z.number().int().nonnegative(),
});
export type ProfileReportSummary = z.infer<typeof ProfileReportSummarySchema>;

export const ProfileReportSchema = z.object({
  batchId: z.string().uuid(),
  module: z.string().min(1),
  rulesetVersion: z.number().int().positive().default(1),
  totalRows: z.number().int().nonnegative(),
  totalColumns: z.number().int().nonnegative(),
  columns: z.array(ColumnProfileSchema),
  duplicates: DuplicateCandidateReportSchema,
  summary: ProfileReportSummarySchema,
  generatedAt: z.coerce.date(),
});
export type ProfileReport = z.infer<typeof ProfileReportSchema>;

export const BatchProfiledPayloadSchema = z.object({
  batchId: z.string().uuid(),
  module: z.string().min(1),
  emptyCount: z.number().int().nonnegative(),
  invalidCount: z.number().int().nonnegative(),
  duplicateCount: z.number().int().nonnegative(),
  totalRows: z.number().int().nonnegative(),
  columnsCount: z.number().int().nonnegative(),
  rulesetVersion: z.number().int().positive().default(1),
});
export type BatchProfiledPayload = z.infer<typeof BatchProfiledPayloadSchema>;

/**
 * ---------------------------------------------------------------------------
 * KIT-04: V1 Cleaning Rule Registry, Rejection & Audit Log Contracts
 * ---------------------------------------------------------------------------
 */

export const CleaningRuleIdSchema = z.enum([
  'RL-TEXT-01',
  'RL-TEXT-02',
  'RL-NAME-01',
  'RL-EMAIL-01',
  'RL-PHONE-01',
  'RL-DATE-01',
  'RL-CURRENCY-01',
  'RL-ADDR-01',
  'RL-REQ-01',
  'RL-FORMAT-01',
  'RL-DUP-01',
  'RL-TAX-01',
]);
export type CleaningRuleId = z.infer<typeof CleaningRuleIdSchema>;

export const V1_CLEANING_RULES: readonly CleaningRuleId[] = [
  'RL-TEXT-01',
  'RL-TEXT-02',
  'RL-NAME-01',
  'RL-EMAIL-01',
  'RL-PHONE-01',
  'RL-DATE-01',
  'RL-CURRENCY-01',
  'RL-ADDR-01',
  'RL-REQ-01',
  'RL-FORMAT-01',
  'RL-DUP-01',
  'RL-TAX-01',
] as const;

export const CleanLogEntrySchema = z.object({
  id: z.string().uuid().optional(),
  batchId: z.string().uuid(),
  sourceRow: z.number().int().positive(),
  fieldName: z.string().min(1),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  ruleId: CleaningRuleIdSchema,
  ruleVersion: z.string().min(1).default('1.0.0'),
  createdAt: z.coerce.date().optional(),
});
export type CleanLogEntry = z.infer<typeof CleanLogEntrySchema>;

export const KitRejectSchema = z.object({
  id: z.string().uuid().optional(),
  batchId: z.string().uuid(),
  sourceRow: z.number().int().positive(),
  entity: z.string().min(1),
  reasonCode: z.string().min(1),
  reasonText: z.string().min(1),
  rawJson: z.record(z.unknown()).default({}),
  createdAt: z.coerce.date().optional(),
});
export type KitReject = z.infer<typeof KitRejectSchema>;

export const StgRowStatusSchema = z.enum(['cleaned', 'rejected']);
export type StgRowStatus = z.infer<typeof StgRowStatusSchema>;

export const StgRowSchema = z.object({
  id: z.string().uuid().optional(),
  batchId: z.string().uuid(),
  sourceRow: z.number().int().positive(),
  status: StgRowStatusSchema,
  cleanedPayload: z.record(z.unknown()).default({}),
  rejectReason: z.string().nullable().optional(),
  goldenId: z.string().nullable().optional(),
  createdAt: z.coerce.date().optional(),
});
export type StgRow = z.infer<typeof StgRowSchema>;

export const CleaningRuleConfigSchema = z.object({
  enabledRules: z.array(CleaningRuleIdSchema).optional(),
  disabledRules: z.array(CleaningRuleIdSchema).optional(),
  dateFormat: z.string().default('YYYY-MM-DD'),
  phoneCountry: z.string().default('+1'),
  requiredFields: z.array(z.string()).default([]),
  addressDictionary: z.record(z.string()).optional(),
});
export type CleaningRuleConfig = z.infer<typeof CleaningRuleConfigSchema>;

export const BatchCleanedPayloadSchema = z.object({
  batchId: z.string().uuid(),
  module: z.string().min(1),
  cleanedRows: z.number().int().nonnegative(),
  rejectedRows: z.number().int().nonnegative(),
  totalRows: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional(),
  ruleVersion: z.string().default('1.0.0'),
});
export type BatchCleanedPayload = z.infer<typeof BatchCleanedPayloadSchema>;

/**
 * Migration Kit Mapping & Value Conversion Contracts (KIT-05 / SDS §4.5 & §4.10)
 */

export const MappingTransformationSchema = z.enum([
  'identity',
  'trim',
  'uppercase',
  'lowercase',
]);
export type MappingTransformation = z.infer<typeof MappingTransformationSchema>;

export const FieldMappingDefinitionSchema = z.object({
  sourceColumn: z.string().min(1),
  targetField: z.string().min(1),
  required: z.boolean().default(false),
  transformation: MappingTransformationSchema.default('identity'),
  defaultValue: z.string().nullable().optional(),
});
export type FieldMappingDefinition = z.infer<typeof FieldMappingDefinitionSchema>;

export const ValueConversionUnmappedActionSchema = z.enum([
  'reject',
  'flag_warning',
  'use_default',
  'pass_through',
]);
export type ValueConversionUnmappedAction = z.infer<typeof ValueConversionUnmappedActionSchema>;

export const ValueConversionRuleSchema = z.object({
  targetField: z.string().min(1),
  mappings: z.record(z.string()),
  unmappedAction: ValueConversionUnmappedActionSchema.default('reject'),
  defaultValue: z.string().nullable().optional(),
});
export type ValueConversionRule = z.infer<typeof ValueConversionRuleSchema>;

export const MappingTemplateSchema = z.object({
  id: z.string().uuid().optional(),
  module: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1).default('1.0.0'),
  targetEntity: z.string().min(1).default('contacts'),
  fieldMappings: z.array(FieldMappingDefinitionSchema),
  valueConversions: z.array(ValueConversionRuleSchema).default([]),
  createdBy: z.string().min(1).default('system'),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});
export type MappingTemplate = z.infer<typeof MappingTemplateSchema>;

export const CreateMappingTemplateInputSchema = z.object({
  module: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1).default('1.0.0'),
  targetEntity: z.string().min(1).default('contacts'),
  fieldMappings: z.array(FieldMappingDefinitionSchema),
  valueConversions: z.array(ValueConversionRuleSchema).default([]),
  createdBy: z.string().min(1).optional(),
});
export type CreateMappingTemplateInput = z.infer<typeof CreateMappingTemplateInputSchema>;

export const UpdateMappingTemplateInputSchema = z.object({
  name: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  targetEntity: z.string().min(1).optional(),
  fieldMappings: z.array(FieldMappingDefinitionSchema).optional(),
  valueConversions: z.array(ValueConversionRuleSchema).optional(),
});
export type UpdateMappingTemplateInput = z.infer<typeof UpdateMappingTemplateInputSchema>;

export const TargetFieldDefinitionSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean(),
  dataType: z.enum(['string', 'email', 'phone', 'date', 'number', 'enum', 'uuid', 'boolean']),
  allowedValues: z.array(z.string()).optional(),
  description: z.string().optional(),
});
export type TargetFieldDefinition = z.infer<typeof TargetFieldDefinitionSchema>;

export const TargetEntityDefinitionSchema = z.object({
  entity: z.string().min(1),
  module: z.string().min(1),
  label: z.string().min(1),
  fields: z.array(TargetFieldDefinitionSchema),
});
export type TargetEntityDefinition = z.infer<typeof TargetEntityDefinitionSchema>;

export const TypeIncompatibilityWarningSchema = z.object({
  targetField: z.string(),
  targetLabel: z.string(),
  targetType: z.string(),
  sourceColumn: z.string(),
  sourceType: z.string(),
  warning: z.string(),
});
export type TypeIncompatibilityWarning = z.infer<typeof TypeIncompatibilityWarningSchema>;

export const MappingValidationResultSchema = z.object({
  valid: z.boolean(),
  missingRequiredFields: z.array(z.string()),
  invalidEnumConversions: z.array(
    z.object({
      field: z.string(),
      sourceValue: z.string(),
      reason: z.string(),
    })
  ),
  errors: z.array(z.string()),
  warnings: z.array(z.string()).optional(),
  typeIncompatibilities: z.array(TypeIncompatibilityWarningSchema).optional(),
});
export type MappingValidationResult = z.infer<typeof MappingValidationResultSchema>;

export const CleanCrmRowSchema = z.object({
  id: z.string().uuid().optional(),
  batchId: z.string().uuid(),
  sourceRow: z.number().int().positive(),
  payload: z.record(z.unknown()),
  createdAt: z.coerce.date().optional(),
});
export type CleanCrmRow = z.infer<typeof CleanCrmRowSchema>;

export const BatchMappedPayloadSchema = z.object({
  batchId: z.string().uuid(),
  module: z.string().min(1),
  mappedRows: z.number().int().nonnegative(),
  missingRequired: z.number().int().nonnegative(),
  templateId: z.string().optional(),
  templateName: z.string().optional(),
  targetEntity: z.string().min(1),
  totalRows: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional(),
});
export type BatchMappedPayload = z.infer<typeof BatchMappedPayloadSchema>;

/**
 * Standard CRM Target Entity Registries
 */
export const CRM_CONTACTS_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'firstName', label: 'First Name', required: true, dataType: 'string' },
  { name: 'lastName', label: 'Last Name', required: true, dataType: 'string' },
  { name: 'email', label: 'Email Address', required: true, dataType: 'email' },
  { name: 'phone', label: 'Phone Number', required: false, dataType: 'phone' },
  { name: 'company', label: 'Company Name', required: false, dataType: 'string' },
  { name: 'country', label: 'Country', required: false, dataType: 'string' },
  {
    name: 'leadStatus',
    label: 'Lead Status',
    required: false,
    dataType: 'enum',
    allowedValues: ['New', 'Working', 'Qualified', 'Closed'],
  },
];

export const CRM_LEADS_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'firstName', label: 'First Name', required: true, dataType: 'string' },
  { name: 'lastName', label: 'Last Name', required: true, dataType: 'string' },
  { name: 'email', label: 'Email Address', required: true, dataType: 'email' },
  { name: 'phone', label: 'Phone Number', required: false, dataType: 'phone' },
  { name: 'company', label: 'Company Name', required: false, dataType: 'string' },
  {
    name: 'leadStatus',
    label: 'Lead Status',
    required: true,
    dataType: 'enum',
    allowedValues: ['New', 'Working', 'Qualified', 'Closed'],
  },
];

export const CRM5_RUNS_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'batchId', label: 'Batch ID', required: true, dataType: 'string', description: 'Unique batch execution identifier' },
  {
    name: 'module',
    label: 'Module Identifier',
    required: true,
    dataType: 'enum',
    allowedValues: ['crm-1', 'crm-2', 'crm-3', 'crm-4', 'crm-5'],
    description: 'Target ClearShift CRM module',
  },
  {
    name: 'step',
    label: 'Pipeline Step',
    required: true,
    dataType: 'enum',
    allowedValues: ['extract', 'profile', 'clean', 'map', 'load', 'validate', 'reconcile'],
    description: 'Active migration pipeline execution phase',
  },
  {
    name: 'status',
    label: 'Execution Status',
    required: true,
    dataType: 'enum',
    allowedValues: ['pending', 'running', 'completed', 'failed', 'halted'],
    description: 'Lifecycle run execution status',
  },
  { name: 'recordsIn', label: 'Source Records In', required: false, dataType: 'number', description: 'Total source records processed' },
  { name: 'recordsOut', label: 'Loaded Records Out', required: false, dataType: 'number', description: 'Records successfully loaded' },
  { name: 'recordsRejected', label: 'Rejected Records', required: false, dataType: 'number', description: 'Count of rejected rows' },
  { name: 'startedAt', label: 'Started Timestamp', required: false, dataType: 'date', description: 'Run initiation timestamp' },
  { name: 'completedAt', label: 'Completed Timestamp', required: false, dataType: 'date', description: 'Run finish timestamp' },
];

export const CRM5_SCORES_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'batchId', label: 'Batch ID', required: true, dataType: 'string', description: 'Unique batch execution identifier' },
  {
    name: 'module',
    label: 'Module Identifier',
    required: true,
    dataType: 'enum',
    allowedValues: ['crm-1', 'crm-2', 'crm-3', 'crm-4', 'crm-5'],
    description: 'Target ClearShift CRM module',
  },
  { name: 'completeness', label: 'Completeness Ratio', required: false, dataType: 'number', description: 'Completeness score between 0 and 1' },
  { name: 'validity', label: 'Validity Ratio', required: false, dataType: 'number', description: 'Validity score between 0 and 1' },
  { name: 'duplicateRate', label: 'Duplicate Rate', required: false, dataType: 'number', description: 'Exact duplicate rate between 0 and 1' },
  { name: 'rejectRate', label: 'Reject Rate', required: false, dataType: 'number', description: 'Rejection rate between 0 and 1' },
  { name: 'linkIntegrity', label: 'Link Integrity', required: false, dataType: 'number', description: 'Linkage score between 0 and 1' },
  { name: 'score', label: 'Overall Quality Score', required: true, dataType: 'number', description: 'Composite data quality score between 0 and 100' },
];

export const CRM5_REJECTS_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'batchId', label: 'Batch ID', required: true, dataType: 'string', description: 'Unique batch execution identifier' },
  {
    name: 'module',
    label: 'Module Identifier',
    required: true,
    dataType: 'enum',
    allowedValues: ['crm-1', 'crm-2', 'crm-3', 'crm-4', 'crm-5'],
    description: 'Target module where rejection occurred',
  },
  { name: 'rowIndex', label: 'Source Row Index', required: true, dataType: 'number', description: '1-based source row index' },
  { name: 'errorCode', label: 'Rejection Error Code', required: true, dataType: 'string', description: 'Machine error code' },
  { name: 'errorMessage', label: 'Error Message', required: true, dataType: 'string', description: 'Human-readable failure reason' },
  { name: 'rawPayloadHash', label: 'Raw Payload Hash', required: true, dataType: 'string', description: 'Deterministic SHA-256 hash of raw row payload' },
];

export const CRM5_RECONCILIATION_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'batchId', label: 'Batch ID', required: true, dataType: 'string', description: 'Unique batch execution identifier' },
  {
    name: 'module',
    label: 'Module Identifier',
    required: true,
    dataType: 'enum',
    allowedValues: ['crm-1', 'crm-2', 'crm-3', 'crm-4', 'crm-5'],
    description: 'Target ClearShift module',
  },
  { name: 'sourceCount', label: 'Source Count', required: true, dataType: 'number', description: 'Total source records ingested' },
  { name: 'loadedCount', label: 'Loaded Count', required: true, dataType: 'number', description: 'Total records written to target' },
  { name: 'rejectedCount', label: 'Rejected Count', required: true, dataType: 'number', description: 'Total records rejected to audit table' },
  { name: 'mergedCount', label: 'Merged Count', required: false, dataType: 'number', description: 'Total records merged into golden entities' },
  { name: 'skippedCount', label: 'Skipped Count', required: false, dataType: 'number', description: 'Total records explicitly skipped' },
  {
    name: 'status',
    label: 'Conservation Status',
    required: true,
    dataType: 'enum',
    allowedValues: ['OK', 'UNBALANCED'],
    description: 'Reconciliation conservation audit status',
  },
];

export const CRM5_TARGET_ENTITIES: Record<string, TargetEntityDefinition> = {
  crm5_runs: {
    entity: 'crm5_runs',
    module: 'crm-5',
    label: 'CRM-5 Run Projections',
    fields: CRM5_RUNS_TARGET_FIELDS,
  },
  crm5_scores: {
    entity: 'crm5_scores',
    module: 'crm-5',
    label: 'CRM-5 Data Quality Scores',
    fields: CRM5_SCORES_TARGET_FIELDS,
  },
  crm5_rejects: {
    entity: 'crm5_rejects',
    module: 'crm-5',
    label: 'CRM-5 Migration Rejections',
    fields: CRM5_REJECTS_TARGET_FIELDS,
  },
  crm5_reconciliation_reports: {
    entity: 'crm5_reconciliation_reports',
    module: 'crm-5',
    label: 'CRM-5 Reconciliation Reports',
    fields: CRM5_RECONCILIATION_TARGET_FIELDS,
  },
};

export const CRM_TARGET_ENTITIES: Record<string, TargetEntityDefinition> = {
  contacts: {
    entity: 'contacts',
    module: 'crm',
    label: 'CRM Contacts',
    fields: CRM_CONTACTS_TARGET_FIELDS,
  },
  leads: {
    entity: 'leads',
    module: 'crm',
    label: 'CRM Leads',
    fields: CRM_LEADS_TARGET_FIELDS,
  },
  ...CRM5_TARGET_ENTITIES,
};

// ============================================================================
// KIT-08: Generic Target Adapter, Stable Idempotency & Import Receipts
// ============================================================================

/**
 * Idempotency Key Generation Parameters Schema (KIT-08)
 * Key is derived from: batch_id + source_row + module target + operation version
 * (NOT mutable payload alone; SDS ClearShift Migration Kit v2.0 §11.4)
 */
export const IdempotencyKeyParamsSchema = z.object({
  batchId: z.string().min(1, 'batchId is required').max(128),
  sourceRow: z.number().int({ message: 'sourceRow must be an integer' }).min(1, 'sourceRow must be >= 1'),
  module: z.string().min(1, 'module is required').max(64),
  entity: z.string().min(1, 'entity is required').max(64),
  operationVersion: z.number().int().min(1).default(1),
});
export type IdempotencyKeyParams = z.infer<typeof IdempotencyKeyParamsSchema>;

/**
 * Derives a deterministic stable idempotency key for a source row.
 * Format: SHA256(batchId:sourceRow:module:entity:v{operationVersion})
 */
export function computeStableIdempotencyKey(params: IdempotencyKeyParams): string {
  const parsed = IdempotencyKeyParamsSchema.parse(params);
  const rawKey = `${parsed.batchId}:${parsed.sourceRow}:${parsed.module}:${parsed.entity}:v${parsed.operationVersion}`;
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

export const deriveStableIdempotencyKey = computeStableIdempotencyKey;

/**
 * Idempotency Payload Conflict Error (HTTP 409)
 * Raised when the same idempotency key is submitted with a different payload.
 */
export class IdempotencyConflictError extends Error {
  public readonly statusCode = 409;
  public readonly code = 'IDEMPOTENCY_CONFLICT';

  constructor(
    public readonly idempotencyKey: string,
    public readonly reason: string = `Idempotency key '${idempotencyKey}' was already used with a different request payload.`
  ) {
    super(reason);
    this.name = 'IdempotencyConflictError';
  }
}

/**
 * Result returned by a MigrationTargetAdapter import operation.
 */
export interface MigrationTargetAdapterResult {
  targetId: string;
  receipt: {
    batchId: string;
    sourceRow: number;
    entity: string;
    schemaVersion: number;
    idempotencyKey: string;
    targetId: string;
    kind: 'created' | 'linked';
    createdAt: Date;
    payloadHash?: string | undefined;
  };
  isExisting?: boolean | undefined;
}

/**
 * Error detail returned by a MigrationTargetAdapter.
 */
export interface MigrationTargetAdapterError {
  reasonCode: string;
  message: string;
  field?: string | undefined;
  retryable?: boolean | undefined;
}

/**
 * Generic Target Adapter Contract (Decision C4 & KIT-08)
 * Executed in-process or via module adapter port to guarantee atomic transaction commits
 * between target business records and durable import receipts.
 */
export interface MigrationTargetAdapter<TRow = unknown> {
  readonly module: string;
  readonly entity: string;
  readonly schemaVersion: number;

  /**
   * Preflight validation during dry-run phase (zero database mutations).
   */
  preflight(
    batchId: string,
    rows: TRow[]
  ): Promise<{ validCount: number; rejectCount: number } | { error: MigrationTargetAdapterError }>;

  /**
   * Commits target business record and durable import receipt atomically in one local PG transaction.
   */
  importRow(
    batchId: string,
    sourceRow: number,
    idempotencyKey: string,
    cleanData: TRow
  ): Promise<
    | { ok: true; value: MigrationTargetAdapterResult }
    | { ok: false; error: MigrationTargetAdapterError }
  >;
}

// ============================================================================
// KIT-09: Terminal Outcome Ledger & Mathematically Exact Reconciliation
// ============================================================================

/**
 * Terminal Outcome Types for Migration Kit V1 (Decision KIT-09 & SDS §11.1–11.9)
 * Every source row must have exactly one terminal outcome.
 */
export const TerminalOutcomeTypeSchema = z.enum([
  'loaded',
  'rejected',
  'merged',
  'skipped',
]);
export type TerminalOutcomeType = z.infer<typeof TerminalOutcomeTypeSchema>;

/**
 * Policy code for operator approved row skip action
 */
export const OPERATOR_APPROVED_SKIP_POLICY = 'operator_approved_skip' as const;

/**
 * Input schema for operator-approved row skip action (KIT-09)
 */
export const SkipRowApprovalInputSchema = z.object({
  batchId: z.string().min(1, 'batchId is required').max(128),
  sourceRow: z.number().int().min(1, 'sourceRow must be >= 1'),
  reason: z
    .string()
    .min(10, 'Skip reason must contain at least 10 non-whitespace characters')
    .refine((val) => val.trim().length >= 10, {
      message: 'Skip reason must contain at least 10 non-whitespace characters',
    }),
  actor: z.string().min(1, 'actor is required').max(128),
  actorRole: z.enum([
    'migration_admin',
    'platform_admin',
    'editor',
    'runner',
    'viewer',
  ]),
});
export type SkipRowApprovalInput = z.infer<typeof SkipRowApprovalInputSchema>;

/**
 * Terminal Row Outcome Contract Schema
 */
export const KitRowOutcomeSchema = z.object({
  id: z.string().uuid().optional(),
  batchId: z.string().min(1).max(128),
  sourceRow: z.number().int().min(1),
  outcome: TerminalOutcomeTypeSchema,
  targetId: z.string().uuid().optional(),
  reasonCode: z.string().max(64).optional(),
  reasonMessage: z.string().optional(),
  actor: z.string().max(128).optional(),
  policyCode: z.string().max(64).optional(),
  approvedBy: z.string().max(128).optional(),
  approvedAt: z.coerce.date().optional(),
  idempotencyKey: z.string().max(256).optional(),
  createdAt: z.coerce.date().default(() => new Date()),
});
export type KitRowOutcome = z.infer<typeof KitRowOutcomeSchema>;

/**
 * Mathematically Exact Reconciliation Report Schema (KIT-09 / SDS §11.8)
 * Counts derive strictly from outcome ledger (kit_row_outcomes), never target table totals.
 */
export const KitReconciliationReportSchema = z.object({
  batchId: z.string().min(1).max(128),
  sourceCount: z.number().int().min(0),
  loadedCount: z.number().int().min(0),
  rejectedCount: z.number().int().min(0),
  mergedCount: z.number().int().min(0),
  skippedCount: z.number().int().min(0),
  unaccountedCount: z.number().int(),
  status: z.enum(['OK', 'UNBALANCED']),
  isBalanced: z.boolean(),
  timestamp: z.coerce.date(),
});
export type KitReconciliationReport = z.infer<typeof KitReconciliationReportSchema>;

/**
 * Duplicate Terminal Outcome Error (HTTP 409)
 * Raised when attempting to record more than one terminal outcome for the same source row.
 */
export class DuplicateRowOutcomeError extends Error {
  public readonly statusCode = 409;
  public readonly code = 'DUPLICATE_ROW_OUTCOME';

  constructor(
    public readonly batchId: string,
    public readonly sourceRow: number,
    public readonly existingOutcome: string,
    public readonly attemptedOutcome: string
  ) {
    super(
      `Row ${sourceRow} in batch '${batchId}' already has terminal outcome '${existingOutcome}'. Cannot overwrite with '${attemptedOutcome}'.`
    );
    this.name = 'DuplicateRowOutcomeError';
  }
}

/**
 * Invalid Skip Approval Error (HTTP 400 or 403)
 * Raised when skip conditions (role, reason length, pre-load phase) are violated.
 */
export class InvalidSkipApprovalError extends Error {
  public readonly statusCode: number;
  public readonly code = 'INVALID_SKIP_APPROVAL';

  constructor(message: string, isForbidden: boolean = false) {
    super(message);
    this.statusCode = isForbidden ? 403 : 400;
    this.name = 'InvalidSkipApprovalError';
  }
}

/**
 * Reconciliation Invariant Error (HTTP 422)
 * Raised when attempting to sign off a batch that fails exact row conservation.
 */
export class ReconciliationInvariantError extends Error {
  public readonly statusCode = 422;
  public readonly code = 'RECONCILIATION_UNBALANCED';

  constructor(
    public readonly batchId: string,
    public readonly sourceCount: number,
    public readonly accountedCount: number,
    public readonly unaccountedCount: number
  ) {
    super(
      `Batch '${batchId}' failed reconciliation: source (${sourceCount}) != accounted (${accountedCount}). Unaccounted: ${unaccountedCount}. Signoff is blocked.`
    );
    this.name = 'ReconciliationInvariantError';
  }
}
