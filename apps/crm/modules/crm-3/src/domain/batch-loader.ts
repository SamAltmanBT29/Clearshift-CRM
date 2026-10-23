import { z } from 'zod';
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_MIN_ATTEMPTED_ROWS,
  DEFAULT_MAX_RETRIES,
  type BatchExecutionReport,
  type BatchExecutionStatus,
  type CRM3ImportStatus,
  type FailedRow,
  type ImportReceipt as BatchCommittedReceipt,
} from '@clearshift/contracts';
import { shouldHaltBatch, evaluateReconciliation, type ReconciliationResult } from '@cs/kit';
import {
  Crm3TargetAdapter,
  CRM3_DEFAULT_SOURCE_SYSTEM,
  CRM3_IMPORT_RETRYABLE_CODES,
  buildCrm3IdempotencyKey,
  isRetryableReasonCode,
  type Crm3ImportRow,
} from '../migration/target-adapter.js';
import { DomainValidationError } from './errors.js';

export interface Crm3BatchRowInput {
  sourceRow: number;
  data: Crm3ImportRow;
  /** Defaults to buildCrm3IdempotencyKey(batchId, sourceRow). Reused unchanged on every retry. */
  idempotencyKey?: string;
}

export interface Crm3BatchLoadInput {
  batchId: string;
  rows: Crm3BatchRowInput[];
  sourceSystem?: string;
  chunkSize?: number;
  maxRetries?: number;
  failureThreshold?: number;
  minAttemptedRows?: number;
}

export interface Crm3BatchLoaderOptions {
  adapter?: Crm3TargetAdapter;
  sleep?: (ms: number) => Promise<void>;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface Crm3BatchReconciliation {
  source: number;
  loaded: number;
  rejected: number;
  merged: number;
  skipped: number;
  /** Rows not attempted because the batch halted; they stay pending for a re-run. */
  notAttempted: number;
  unaccounted: number;
  result: ReconciliationResult;
}

export interface Crm3BatchLoadReport extends BatchExecutionReport {
  /** Durable state recorded on crm3_import_batches.status. */
  batchStatus: CRM3ImportStatus;
  reconciliation: Crm3BatchReconciliation;
}

export const CRM3_DEFAULT_BASE_BACKOFF_MS = 50;
export const CRM3_DEFAULT_MAX_BACKOFF_MS = 1000;

/**
 * Bounded exponential backoff: base * 2^attempt, capped at maxMs.
 */
export function calculateBackoffDelay(
  attempt: number,
  baseMs: number = CRM3_DEFAULT_BASE_BACKOFF_MS,
  maxMs: number = CRM3_DEFAULT_MAX_BACKOFF_MS
): number {
  return Math.min(maxMs, baseMs * 2 ** attempt);
}

/**
 * Splits rows into consecutive chunks of chunkSize (default 500).
 */
export function chunkRows<T>(rows: readonly T[], chunkSize: number = DEFAULT_CHUNK_SIZE): T[][] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error('chunkSize must be a positive integer');
  }
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    chunks.push(rows.slice(i, i + chunkSize));
  }
  return chunks;
}

const LoadInputSchema = z.object({
  batchId: z.string().uuid('batchId must be a UUID'),
  rows: z
    .array(z.object({ sourceRow: z.number().int().min(1), idempotencyKey: z.string().min(1).optional() }).passthrough())
    .min(1, 'rows must not be empty')
    .refine((rows) => new Set(rows.map((r) => r.sourceRow)).size === rows.length, {
      message: 'sourceRow values must be unique within a batch',
    }),
  sourceSystem: z.string().trim().min(1).optional(),
  chunkSize: z.number().int().min(1).max(1000).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  failureThreshold: z.number().min(0).max(1).optional(),
  minAttemptedRows: z.number().int().min(1).optional(),
});

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Loads a CRM-3 ticket batch through Crm3TargetAdapter (CRM3-11).
 * - Rows are processed in chunks of 500 (DEFAULT_CHUNK_SIZE).
 * - Only retryable infrastructure failures are retried, with bounded exponential backoff and the
 *   SAME idempotency key on every attempt; bad-data rejects are never retried.
 * - After every row the shared stop rule runs (decision C9: failed / attempted > 10% with at least
 *   50 attempted rows); the batch halts immediately and records `stopped_excessive_failures`.
 * - No rollback (V1): rows and receipts committed before a halt stay durable. Re-running the same
 *   batch resumes safely because committed rows replay to their existing receipts.
 * - Every source row ends loaded, rejected or not attempted (pending); unaccounted is always 0.
 */
export async function executeCrm3BatchLoad(
  input: Crm3BatchLoadInput,
  options: Crm3BatchLoaderOptions = {}
): Promise<Crm3BatchLoadReport> {
  const parsed = LoadInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainValidationError(
      'Invalid batch load input',
      parsed.error.issues.map((issue) => ({ field: issue.path.join('.') || 'input', message: issue.message }))
    );
  }

  const adapter = options.adapter ?? new Crm3TargetAdapter();
  const service = adapter.getService();
  const sleep = options.sleep ?? defaultSleep;
  const baseBackoffMs = options.baseBackoffMs ?? CRM3_DEFAULT_BASE_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? CRM3_DEFAULT_MAX_BACKOFF_MS;
  const chunkSize = input.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const maxRetries = input.maxRetries ?? DEFAULT_MAX_RETRIES;
  const thresholdConfig = {
    maxFailureRate: input.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD,
    minAttemptedRows: input.minAttemptedRows ?? DEFAULT_MIN_ATTEMPTED_ROWS,
  };

  const { batchId } = input;
  service.ensureImportBatch(batchId, input.sourceSystem ?? CRM3_DEFAULT_SOURCE_SYSTEM);
  service.updateImportBatch(batchId, { status: 'processing', completedAt: null });

  const committedReceipts: BatchCommittedReceipt[] = [];
  const failedRows: FailedRow[] = [];
  let attempted = 0;
  let chunksProcessed = 0;
  let haltReason: string | null = null;

  for (const chunk of chunkRows(input.rows, chunkSize)) {
    if (haltReason) break;
    chunksProcessed += 1;

    for (const row of chunk) {
      attempted += 1;
      const idempotencyKey = row.idempotencyKey ?? buildCrm3IdempotencyKey(batchId, row.sourceRow);

      let attempt = 0;
      for (;;) {
        let result: Awaited<ReturnType<Crm3TargetAdapter['importRow']>>;
        try {
          result = await adapter.importRow(batchId, row.sourceRow, idempotencyKey, row.data);
        } catch (error) {
          result = {
            ok: false,
            error: {
              reasonCode: CRM3_IMPORT_RETRYABLE_CODES.TARGET_UNAVAILABLE,
              message: error instanceof Error ? error.message : String(error),
            },
          };
        }

        if (result.ok) {
          committedReceipts.push({
            batchId,
            sourceRow: row.sourceRow,
            idempotencyKey: result.value.receipt.idempotencyKey,
            targetId: result.value.targetId,
            kind: result.value.receipt.kind,
            committedAt: result.value.receipt.createdAt,
          });
          break;
        }

        if (isRetryableReasonCode(result.error.reasonCode) && attempt < maxRetries) {
          await sleep(calculateBackoffDelay(attempt, baseBackoffMs, maxBackoffMs));
          attempt += 1;
          continue;
        }

        failedRows.push({
          sourceRow: row.sourceRow,
          idempotencyKey,
          errorCode: result.error.reasonCode,
          errorMessage: result.error.message,
          retryAttempts: attempt,
        });
        break;
      }

      if (shouldHaltBatch(failedRows.length, attempted, thresholdConfig)) {
        const ratePct = ((failedRows.length / attempted) * 100).toFixed(1);
        haltReason =
          `Row failure rate ${ratePct}% exceeds ${thresholdConfig.maxFailureRate * 100}% after ` +
          `${attempted} attempted rows; load stopped. Committed rows and receipts are kept.`;
        break;
      }
    }
  }

  const status: BatchExecutionStatus = haltReason
    ? 'STOPPED_EXCESSIVE_FAILURES'
    : committedReceipts.length === 0
      ? 'FAILED'
      : 'COMPLETED';
  const batchStatus: CRM3ImportStatus =
    status === 'STOPPED_EXCESSIVE_FAILURES'
      ? 'stopped_excessive_failures'
      : status === 'FAILED'
        ? 'failed'
        : 'completed';

  const executedAt = new Date();
  service.updateImportBatch(batchId, {
    status: batchStatus,
    loadedCount: service.listImportReceipts(batchId).filter((r) => r.entity === 'ticket').length,
    rejectedCount: failedRows.length,
    completedAt: batchStatus === 'stopped_excessive_failures' ? null : executedAt.toISOString(),
  });

  const counts = {
    source: input.rows.length,
    loaded: committedReceipts.length,
    rejected: failedRows.length,
    merged: 0,
    skipped: 0,
    pending: input.rows.length - attempted,
  };
  const { unaccounted, result } = evaluateReconciliation(counts);

  return {
    batchId,
    module: 'crm-3',
    step: 'load',
    status,
    batchStatus,
    totalRecords: input.rows.length,
    attemptedRecords: attempted,
    committedRecords: committedReceipts.length,
    failedRecords: failedRows.length,
    chunksProcessed,
    chunkSize,
    failureRate: attempted > 0 ? Number((failedRows.length / attempted).toFixed(4)) : 0,
    haltReason,
    committedReceipts,
    failedRows,
    executedAt,
    reconciliation: {
      source: counts.source,
      loaded: counts.loaded,
      rejected: counts.rejected,
      merged: counts.merged,
      skipped: counts.skipped,
      notAttempted: counts.pending,
      unaccounted,
      result,
    },
  };
}
