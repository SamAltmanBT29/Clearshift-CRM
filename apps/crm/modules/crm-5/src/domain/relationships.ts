import type {
  CrmModule,
  MigrationRun,
  MigrationRunStatus,
  MigrationStep,
  QualityScore,
  ReconciliationReport,
  MigrationReject,
} from '@clearshift/contracts';

export interface BatchTotals {
  totalRecordsIn: number;
  totalRecordsOut: number;
  totalRecordsRejected: number;
  stepsCompleted: number;
  stepsTotal: number;
  progressPercentage: number;
}

export interface BatchConsistencyResult {
  isConsistent: boolean;
  warnings: string[];
  errors: string[];
}

export interface BatchAggregateInput {
  batchId: string;
  module: CrmModule;
  runs: MigrationRun[];
  score?: QualityScore | null;
  reconciliation?: ReconciliationReport | null;
  rejects?: MigrationReject[];
}

export interface BatchSummary {
  batchId: string;
  module: CrmModule;
  status: MigrationRunStatus;
  totals: BatchTotals;
  score: QualityScore | null;
  reconciliation: ReconciliationReport | null;
  consistency: BatchConsistencyResult;
  updatedAt: Date;
}

// Canonical Migration Step Ordering per 7-step pipeline
export const CANONICAL_STEP_ORDER: readonly MigrationStep[] = [
  'extract',
  'profile',
  'clean',
  'map',
  'load',
  'validate',
  'reconcile',
] as const;

/**
 * Derives the overall aggregate status for a batch based on its step runs.
 * Priority: failed > halted > running > (all completed ? completed : pending).
 */
export function deriveBatchAggregateStatus(runs: MigrationRun[]): MigrationRunStatus {
  if (runs.length === 0) {
    return 'pending';
  }

  // Any failure fails the whole batch
  if (runs.some((r) => r.status === 'failed')) {
    return 'failed';
  }

  // Any halted step halts the batch
  if (runs.some((r) => r.status === 'halted')) {
    return 'halted';
  }

  // Any running step marks batch as running
  if (runs.some((r) => r.status === 'running')) {
    return 'running';
  }

  // If all canonical steps exist and are completed
  const completedSteps = new Set(
    runs.filter((r) => r.status === 'completed').map((r) => r.step)
  );

  if (completedSteps.size >= CANONICAL_STEP_ORDER.length) {
    return 'completed';
  }

  // If at least one is completed but not all, it's still running
  if (completedSteps.size > 0) {
    return 'running';
  }

  return 'pending';
}

/**
 * Derives aggregate record count totals and progress percentage for a batch.
 */
export function deriveBatchTotals(runs: MigrationRun[]): BatchTotals {
  let totalRecordsIn = 0;
  let totalRecordsOut = 0;
  let totalRecordsRejected = 0;
  let stepsCompleted = 0;

  for (const run of runs) {
    totalRecordsIn += run.recordsIn;
    totalRecordsOut += run.recordsOut;
    totalRecordsRejected += run.recordsRejected;
    if (run.status === 'completed') {
      stepsCompleted++;
    }
  }

  const stepsTotal = CANONICAL_STEP_ORDER.length;
  const progressPercentage = Math.round((stepsCompleted / stepsTotal) * 100);

  return {
    totalRecordsIn,
    totalRecordsOut,
    totalRecordsRejected,
    stepsCompleted,
    stepsTotal,
    progressPercentage,
  };
}

/**
 * Asserts cross-entity read-model consistency for a batch across runs, scores, rejects, and reconciliation.
 */
export function validateBatchConsistency(input: BatchAggregateInput): BatchConsistencyResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { runs, score, reconciliation, rejects = [] } = input;

  // 1. Check Step Sequence Invariants
  const completedSteps = new Set(
    runs.filter((r) => r.status === 'completed').map((r) => r.step)
  );

  let foundIncomplete = false;
  for (const step of CANONICAL_STEP_ORDER) {
    if (completedSteps.has(step)) {
      if (foundIncomplete) {
        warnings.push(
          `Step '${step}' is completed while preceding step(s) were not marked completed.`
        );
      }
    } else {
      foundIncomplete = true;
    }
  }

  // 2. Check Reconciliation Consistency (if present)
  if (reconciliation) {
    if (reconciliation.status === 'UNBALANCED') {
      warnings.push(
        `Batch reconciliation report has UNBALANCED status with ${reconciliation.unaccountedCount} unaccounted records.`
      );
    }

    if (reconciliation.unaccountedCount > 0 && reconciliation.status === 'OK') {
      errors.push(
        'Inconsistent reconciliation: status is OK but unaccountedCount is greater than zero.'
      );
    }

    // Check loaded count against load step run
    const loadRun = runs.find((r) => r.step === 'load');
    if (loadRun && loadRun.status === 'completed') {
      if (reconciliation.loadedCount !== loadRun.recordsOut) {
        warnings.push(
          `Reconciliation loadedCount (${reconciliation.loadedCount}) differs from load step recordsOut (${loadRun.recordsOut}).`
        );
      }
    }
  }

  // 3. Check Quality Score Consistency (if present)
  if (score) {
    if (score.isFullyScored && score.score == null) {
      errors.push('Inconsistent quality score: isFullyScored is true but score is null.');
    }
    if (!score.isFullyScored && score.score != null) {
      warnings.push('Quality score has numeric value but is marked as not fully scored.');
    }
  }

  // 4. Check Rejections Consistency
  if (rejects.length > 0) {
    const totalReportedRejects = runs.reduce((acc, r) => acc + r.recordsRejected, 0);
    if (totalReportedRejects === 0) {
      warnings.push(
        `Batch has ${rejects.length} rejection audit rows logged, but run steps report 0 recordsRejected.`
      );
    }
  }

  return {
    isConsistent: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Builds an aggregated, consistent BatchSummary read-model from constituent parts.
 */
export function buildBatchSummary(input: BatchAggregateInput): BatchSummary {
  const status = deriveBatchAggregateStatus(input.runs);
  const totals = deriveBatchTotals(input.runs);
  const consistency = validateBatchConsistency(input);

  // Find latest update time across runs or now
  const latestDate = input.runs.reduce((acc, r) => {
    return r.updatedAt > acc ? r.updatedAt : acc;
  }, new Date(0));

  return {
    batchId: input.batchId,
    module: input.module,
    status,
    totals,
    score: input.score ?? null,
    reconciliation: input.reconciliation ?? null,
    consistency,
    updatedAt: latestDate.getTime() > 0 ? latestDate : new Date(),
  };
}
