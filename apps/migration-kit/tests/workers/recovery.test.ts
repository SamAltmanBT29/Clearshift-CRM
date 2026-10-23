import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  REDIS_PINNED_VERSION,
  DEFAULT_BULLMQ_CONCURRENCY,
  BULLMQ_DEFAULT_ATTEMPTS,
  BULLMQ_BACKOFF_BASE_MS,
  BULLMQ_BACKOFF_MAX_MS,
  BULLMQ_JOB_TIMEOUT_MS,
  ChunkCircuitBreakerHaltError,
  MaxTargetWriteRetriesExceededError,
  ReconciliationBlockedByBatchStateError,
  type MigrationTargetAdapter,
  type MigrationTargetAdapterResult,
} from '@clearshift/contracts';
import {
  DEFAULT_BULLMQ_JOB_OPTIONS,
  computeBackoffDelay,
  getRedisConfig,
  ChunkScheduler,
  PartialLoadRecoveryService,
  InMemoryCheckpointStore,
  MigrationWorker,
} from '../../src/workers/index.js';
import { InMemoryRowOutcomeLedger, ReconciliationService } from '../../src/reconcile/index.js';
import { InMemoryImportReceiptStore } from '../../src/load/target-adapter.js';

/**
 * Mock Target Adapter for failure injection
 */
class MockTargetAdapter implements MigrationTargetAdapter<Record<string, unknown>> {
  public readonly module = 'crm';
  public readonly entity = 'contacts';
  public readonly schemaVersion = 1;

  public records: Map<string, Record<string, unknown>> = new Map();
  public attemptsByKey: Map<string, number> = new Map();
  public failRows: Set<number> = new Set();
  public maxFailsPerRow: Map<number, number> = new Map();

  public async importRow(
    _batchId: string,
    sourceRow: number,
    idempotencyKey: string,
    data: Record<string, unknown>
  ): Promise<MigrationTargetAdapterResult> {
    const currentAttempt = (this.attemptsByKey.get(idempotencyKey) ?? 0) + 1;
    this.attemptsByKey.set(idempotencyKey, currentAttempt);

    const maxFails = this.maxFailsPerRow.get(sourceRow) ?? (this.failRows.has(sourceRow) ? Infinity : 0);

    if (currentAttempt <= maxFails) {
      return {
        ok: false,
        error: {
          code: 'TARGET_WRITE_FAILED',
          message: `Database connection reset on attempt ${currentAttempt}`,
          retryable: true,
        },
      };
    }

    const targetId = randomUUID();
    this.records.set(targetId, data);
    return {
      ok: true,
      value: {
        targetId,
        idempotencyKey,
        isExisting: false,
      },
    };
  }

  public async preflight(): Promise<{ ok: true; validatedCount: number }> {
    return { ok: true, validatedCount: 0 };
  }
}

describe('KIT-11: BullMQ Worker Execution, Bounded Retries & Partial-Load Recovery', () => {
  let checkpointStore: InMemoryCheckpointStore;
  let outcomeLedger: InMemoryRowOutcomeLedger;
  let recoveryService: PartialLoadRecoveryService;
  let mockAdapter: MockTargetAdapter;

  beforeEach(() => {
    checkpointStore = new InMemoryCheckpointStore();
    outcomeLedger = new InMemoryRowOutcomeLedger();
    recoveryService = new PartialLoadRecoveryService(checkpointStore, outcomeLedger);
    mockAdapter = new MockTargetAdapter();
  });

  describe('1. BullMQ Worker Queue Configuration & Redis 8.10.1 Baseline', () => {
    it('pins Redis baseline version 8.10.1 in connection configuration', () => {
      const config = getRedisConfig('redis://redis-cluster:6379');
      expect(config.pinnedVersion).toBe('8.10.1');
      expect(REDIS_PINNED_VERSION).toBe('8.10.1');
      expect(config.host).toBe('redis-cluster');
      expect(config.port).toBe(6379);
      expect(config.maxRetriesPerRequest).toBeNull();
    });

    it('enforces exact BullMQ retry and timeout constants', () => {
      expect(DEFAULT_BULLMQ_JOB_OPTIONS.attempts).toBe(3);
      expect(BULLMQ_DEFAULT_ATTEMPTS).toBe(3);

      expect(DEFAULT_BULLMQ_JOB_OPTIONS.backoff.delay).toBe(1000);
      expect(BULLMQ_BACKOFF_BASE_MS).toBe(1000);

      expect(DEFAULT_BULLMQ_JOB_OPTIONS.backoff.maxDelay).toBe(30000);
      expect(BULLMQ_BACKOFF_MAX_MS).toBe(30000);

      expect(DEFAULT_BULLMQ_JOB_OPTIONS.timeout).toBe(900000); // 15 minutes
      expect(BULLMQ_JOB_TIMEOUT_MS).toBe(900000);

      expect(DEFAULT_BULLMQ_JOB_OPTIONS.concurrency).toBe(4);
      expect(DEFAULT_BULLMQ_CONCURRENCY).toBe(4);
    });

    it('computes exponential backoff correctly capped at 30 seconds', () => {
      expect(computeBackoffDelay(1)).toBe(1000); // Attempt 1: 1s
      expect(computeBackoffDelay(2)).toBe(2000); // Attempt 2: 2s
      expect(computeBackoffDelay(3)).toBe(4000); // Attempt 3: 4s
      expect(computeBackoffDelay(6)).toBe(30000); // Capped at 30s
    });
  });

  describe('2. Chunk Scheduling & 10% Failure Rate Circuit Breaker (STP-01)', () => {
    let scheduler: ChunkScheduler;

    beforeEach(() => {
      scheduler = new ChunkScheduler(500, 10.0);
    });

    it('allows pipeline to continue when chunk error rate is below or equal to 10%', () => {
      const result = scheduler.evaluateChunk('batch-cb-01', {
        chunkIndex: 0,
        startRow: 1,
        endRow: 500,
        attemptedRows: 500,
        loadedRows: 460,
        rejectedRows: 40, // 40 / 500 = 8.0% <= 10%
        mergedRows: 0,
        skippedRows: 0,
        errorRate: 8.0,
        halted: false,
      });

      expect(result.shouldContinue).toBe(true);
      expect(result.failureRate).toBe(8.0);
    });

    it('immediately halts scheduling new chunks when chunk error rate exceeds 10%', () => {
      expect(() =>
        scheduler.evaluateChunk('batch-cb-02', {
          chunkIndex: 0,
          startRow: 1,
          endRow: 500,
          attemptedRows: 500,
          loadedRows: 440,
          rejectedRows: 60, // 60 / 500 = 12.0% > 10%
          mergedRows: 0,
          skippedRows: 0,
          errorRate: 12.0,
          halted: false,
        })
      ).toThrow(ChunkCircuitBreakerHaltError);
    });
  });

  describe('3. Bounded Retries with Stable Idempotency Key', () => {
    it('retries up to 3 times with the exact same idempotency key and recovers on success', async () => {
      const batchId = 'batch-retry-01';
      const sourceRow = 15;
      const idempKey = `kit:${batchId}:${sourceRow}:crm:contacts:1`;

      // Fail row 15 for 2 attempts, succeed on 3rd attempt
      mockAdapter.maxFailsPerRow.set(sourceRow, 2);

      const result = await recoveryService.executeWriteWithBoundedRetries(
        mockAdapter,
        batchId,
        sourceRow,
        idempKey,
        { email: 'retry.success@clearshift.io' },
        {
          chunkIndex: 0,
          lastCommittedRow: 14,
        }
      );

      expect(result.ok).toBe(true);
      expect(mockAdapter.attemptsByKey.get(idempKey)).toBe(3);

      // Checkpoint must advance to row 15
      const checkpoint = await checkpointStore.getCheckpoint(batchId);
      expect(checkpoint?.lastCommittedRow).toBe(15);
      expect(checkpoint?.status).toBe('loading');

      // Outcome ledger must record outcome as 'loaded'
      const outcome = await outcomeLedger.getOutcome(batchId, sourceRow);
      expect(outcome?.outcome).toBe('loaded');
    });
  });

  describe('4. Partial-Load Failure & Non-Rejection Invariant', () => {
    it('moves batch to load_failed_partial and does NOT mark unresolved row as rejected after 3 failed retries', async () => {
      const batchId = 'batch-partial-fail-01';
      const sourceRow = 20;
      const idempKey = `kit:${batchId}:${sourceRow}:crm:contacts:1`;

      // Permanently fail row 20
      mockAdapter.maxFailsPerRow.set(sourceRow, 999);

      await expect(
        recoveryService.executeWriteWithBoundedRetries(
          mockAdapter,
          batchId,
          sourceRow,
          idempKey,
          { email: 'fail.partial@clearshift.io' },
          {
            chunkIndex: 0,
            lastCommittedRow: 19,
          }
        )
      ).rejects.toThrow(MaxTargetWriteRetriesExceededError);

      // Exactly 3 attempts made with the same key
      expect(mockAdapter.attemptsByKey.get(idempKey)).toBe(3);

      // Checkpoint transitioned to 'load_failed_partial' preserving last committed row (19)
      const checkpoint = await checkpointStore.getCheckpoint(batchId);
      expect(checkpoint?.status).toBe('load_failed_partial');
      expect(checkpoint?.lastCommittedRow).toBe(19);

      // CRITICAL INVARIANT: Row 20 must NOT be marked as rejected in the outcome ledger
      const outcome = await outcomeLedger.getOutcome(batchId, sourceRow);
      expect(outcome).toBeNull();
    });
  });

  describe('5. Injected Worker Crash & Checkpoint Resumption', () => {
    it('resumes from latest committed checkpoint without duplicate target writes', async () => {
      const batchId = 'batch-crash-resume';
      const rows = Array.from({ length: 30 }, (_, idx) => ({
        sourceRow: idx + 1,
        data: { name: `Contact ${idx + 1}`, email: `c${idx + 1}@example.com` },
      }));

      // Worker 1: Crashes after committing row 10
      let crashTriggered = false;
      const worker1 = new MigrationWorker({
        checkpointStore,
        outcomeLedger,
        chunkSize: 10,
        crashHook: (_stage, _chunk, rowNumber) => {
          if (rowNumber === 11 && !crashTriggered) {
            crashTriggered = true;
            throw new Error('SIMULATED_WORKER_SIGKILL_CRASH');
          }
        },
      });

      await expect(
        worker1.processJob(
          {
            jobId: randomUUID(),
            batchId,
            jobType: 'load',
            module: 'crm',
            entity: 'contacts',
            rows,
          },
          mockAdapter
        )
      ).rejects.toThrow('SIMULATED_WORKER_SIGKILL_CRASH');

      // Verify checkpoint after crash is exactly row 10
      const crashCheckpoint = await checkpointStore.getCheckpoint(batchId);
      expect(crashCheckpoint?.lastCommittedRow).toBe(10);
      expect(mockAdapter.records.size).toBe(10);

      // Worker 2: Resumes batch execution from checkpoint (rows 11–30)
      const worker2 = new MigrationWorker({
        checkpointStore,
        outcomeLedger,
        chunkSize: 10,
      });

      const resumeResult = await worker2.processJob(
        {
          jobId: randomUUID(),
          batchId,
          jobType: 'load',
          module: 'crm',
          entity: 'contacts',
          rows,
        },
        mockAdapter
      );

      expect(resumeResult.success).toBe(true);
      expect(resumeResult.processedRows).toBe(20); // Processed remaining 20 rows (11 to 30)

      // Total records in adapter must be 30 (no duplicates created)
      expect(mockAdapter.records.size).toBe(30);

      const finalCheckpoint = await checkpointStore.getCheckpoint(batchId);
      expect(finalCheckpoint?.lastCommittedRow).toBe(30);
      expect(finalCheckpoint?.status).toBe('loaded');
    });
  });

  describe('6. Failure State Blocks Reconciliation Invariant', () => {
    it('strictly blocks reconciliation when batch is in load_failed_partial or failed', async () => {
      const reconciliationService = new ReconciliationService(outcomeLedger);
      const batchId = 'batch-rec-blocked';

      // Record 10 loaded rows
      for (let i = 1; i <= 10; i++) {
        await outcomeLedger.recordOutcome({
          batchId,
          sourceRow: i,
          outcome: 'loaded',
          targetId: randomUUID(),
        });
      }

      // Reconciling while batch is in 'load_failed_partial' must be blocked
      await expect(
        reconciliationService.reconcileBatch(batchId, 10, 'load_failed_partial')
      ).rejects.toThrow(ReconciliationBlockedByBatchStateError);

      // Reconciling while batch is in 'failed' must be blocked
      await expect(
        reconciliationService.reconcileBatch(batchId, 10, 'failed')
      ).rejects.toThrow(ReconciliationBlockedByBatchStateError);

      // Reconciling while batch is in valid status ('loaded') succeeds
      const report = await reconciliationService.reconcileBatch(batchId, 10, 'loaded');
      expect(report.status).toBe('OK');
      expect(report.isBalanced).toBe(true);

      // Calling assertCanSignoff with 'load_failed_partial' also throws
      expect(() =>
        reconciliationService.assertCanSignoff(report, 'load_failed_partial')
      ).toThrow(ReconciliationBlockedByBatchStateError);
    });
  });
});
