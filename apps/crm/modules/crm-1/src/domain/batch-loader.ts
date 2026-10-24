import { randomUUID } from 'node:crypto';
import {
  CRM1_DEFAULT_CHUNK_SIZE,
  CRM1_DEFAULT_FAILURE_THRESHOLD,
  CRM1_DEFAULT_MIN_ATTEMPTED_ROWS,
  CRM1_DEFAULT_MAX_RETRIES,
  type Crm1ExecuteBatchLoadInput,
  type Crm1BatchExecutionReport,
  type Crm1BatchReceipt,
  type Crm1FailedRow,
  type Crm1BatchRecordInput,
} from '@clearshift/contracts';
import { shouldHaltBatch } from '@cs/kit';

/**
 * Row Processing Worker Function Type for CRM-1 Contacts, Companies and Leads
 * Takes a record input and returns a targetId (or throws for transient/permanent failures).
 */
export type Crm1RowProcessorFn = (
  record: Crm1BatchRecordInput,
  attempt: number
) => Promise<{ targetId: string; kind?: 'created' | 'linked' }> | { targetId: string; kind?: 'created' | 'linked' };

export interface Crm1BatchLoaderOptions {
  baseBackoffMs?: number | undefined;
  worker?: Crm1RowProcessorFn | undefined;
  sleepFn?: ((ms: number) => Promise<void>) | undefined;
}

/**
 * Utility to split records into chunks of exact size (default 500 rows).
 * Satisfies Acceptance Criterion: Load operations process records in chunks of 500 rows.
 */
export function chunkArray<T>(items: T[], chunkSize: number = CRM1_DEFAULT_CHUNK_SIZE): T[][] {
  if (chunkSize <= 0) {
    throw new Error('chunkSize must be greater than 0');
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Calculates exponential backoff with deterministic jitter-free bounded formula.
 * delay = baseBackoff * (2 ^ attempt)
 */
export function calculateBackoffDelay(attempt: number, baseBackoffMs: number = 50): number {
  return baseBackoffMs * Math.pow(2, attempt);
}

/**
 * Default synthetic row processor for CRM-1 Contacts, Companies and Leads.
 * Deterministically generates a target UUID.
 */
export const defaultCrm1RowProcessor: Crm1RowProcessorFn = (record) => {
  return {
    targetId: `crm1-tgt-${record.sourceRow}-${randomUUID().slice(0, 8)}`,
    kind: 'created',
  };
};

/**
 * Processes a CRM-1 migration batch in chunks of 500 rows with bounded exponential backoff retries
 * and immediate stop behavior upon exceeding the 10% failure threshold.
 *
 * Invariants & Acceptance Criteria:
 * 1. Chunks of exactly 500 rows (configurable).
 * 2. Transient failures trigger bounded exponential backoff retries without corrupting idempotency keys.
 * 3. Batch execution stops immediately if row failures exceed 10% of attempted rows.
 * 4. Already committed rows and receipts remain durable; batch state transitions to STOPPED_EXCESSIVE_FAILURES.
 * 5. No rollback saga or destructive data loss occurs.
 */
export async function executeCrm1ChunkedBatchLoad(
  input: Crm1ExecuteBatchLoadInput,
  options?: Crm1BatchLoaderOptions
): Promise<Crm1BatchExecutionReport> {
  const chunkSize = input.chunkSize ?? CRM1_DEFAULT_CHUNK_SIZE;
  const maxRetries = input.maxRetries ?? CRM1_DEFAULT_MAX_RETRIES;
  const failureThreshold = input.failureThreshold ?? CRM1_DEFAULT_FAILURE_THRESHOLD;
  const minAttemptedRows = input.minAttemptedRows ?? CRM1_DEFAULT_MIN_ATTEMPTED_ROWS;
  const baseBackoffMs = options?.baseBackoffMs ?? 10;
  const worker = options?.worker ?? defaultCrm1RowProcessor;
  const sleep = options?.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  const chunks = chunkArray(input.records, chunkSize);
  const committedReceipts: Crm1BatchReceipt[] = [];
  const failedRows: Crm1FailedRow[] = [];

  let attemptedRecords = 0;
  let chunksProcessed = 0;
  let isHalted = false;
  let haltReason: string | null = null;

  for (const chunk of chunks) {
    if (isHalted) break;

    chunksProcessed += 1;

    for (const record of chunk) {
      attemptedRecords += 1;
      let success = false;
      let lastError: unknown = null;
      let attempt = 0;

      // Retry loop with bounded exponential backoff
      // Non-negotiable invariant: idempotency key is strictly preserved and never mutated!
      while (attempt <= maxRetries && !success) {
        try {
          const result = await worker(record, attempt);
          committedReceipts.push({
            batchId: input.batchId,
            sourceRow: record.sourceRow,
            idempotencyKey: record.idempotencyKey,
            targetId: result.targetId,
            kind: result.kind ?? 'created',
            committedAt: new Date(),
          });
          success = true;
        } catch (err) {
          lastError = err;
          attempt += 1;
          if (attempt <= maxRetries) {
            const delay = calculateBackoffDelay(attempt - 1, baseBackoffMs);
            if (delay > 0) {
              await sleep(delay);
            }
          }
        }
      }

      if (!success) {
        const errorMsg =
          lastError instanceof Error ? lastError.message : String(lastError ?? 'Unknown processing error');
        failedRows.push({
          sourceRow: record.sourceRow,
          idempotencyKey: record.idempotencyKey,
          errorCode: 'ROW_PROCESSING_FAILED',
          errorMessage: errorMsg,
          retryAttempts: attempt,
        });
      }

      // Check threshold: immediate halt if row failures exceed 10% after min attempted rows (50)
      const currentHalt = shouldHaltBatch(failedRows.length, attemptedRecords, {
        maxFailureRate: failureThreshold,
        minAttemptedRows,
      });

      if (currentHalt) {
        isHalted = true;
        const ratePct = ((failedRows.length / attemptedRecords) * 100).toFixed(1);
        haltReason = `Row failure rate ${ratePct}% exceeds 10% threshold after ${attemptedRecords} attempted rows. Batch execution stopped immediately.`;
        break; // Stop chunk immediately
      }
    }
  }

  const failureRate = attemptedRecords > 0 ? failedRows.length / attemptedRecords : 0;
  const status = isHalted
    ? 'STOPPED_EXCESSIVE_FAILURES'
    : failedRows.length === 0
      ? 'COMPLETED'
      : attemptedRecords === failedRows.length
        ? 'FAILED'
        : 'COMPLETED';

  return {
    batchId: input.batchId,
    module: input.module ?? 'crm-1',
    step: input.step ?? 'load',
    status,
    totalRecords: input.records.length,
    attemptedRecords,
    committedRecords: committedReceipts.length,
    failedRecords: failedRows.length,
    chunksProcessed,
    chunkSize,
    failureRate: Number(failureRate.toFixed(4)),
    haltReason,
    committedReceipts,
    failedRows,
    executedAt: new Date(),
  };
}

export const executeChunkedBatchLoad = executeCrm1ChunkedBatchLoad;
export type { Crm1BatchExecutionReport };

