import { z } from 'zod';

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
