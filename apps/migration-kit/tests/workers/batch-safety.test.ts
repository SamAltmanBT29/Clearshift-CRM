import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  BatchExcessiveFailuresHaltError,
  ReconciliationBlockedByBatchStateError,
  KitBatchStoppedExcessiveFailuresEventSchema,
  isKitBatchResumableStatus,
  type MigrationTargetAdapter,
  type MigrationTargetAdapterResult,
  type KitBatchStoppedExcessiveFailuresEvent,
} from '@clearshift/contracts';
import {
  BatchSafetyMonitor,
  InMemoryCheckpointStore,
  MigrationWorker,
} from '../../src/workers/index.js';
import {
  InMemoryRowOutcomeLedger,
  ReconciliationService,
} from '../../src/reconcile/index.js';

/**
 * Mock Target Adapter supporting failure injection by row number
 */
class MockTargetAdapter implements MigrationTargetAdapter<Record<string, unknown>> {
  public readonly module = 'crm';
  public readonly entity = 'contacts';
  public readonly schemaVersion = 1;

  public records: Map<string, Record<string, unknown>> = new Map();
  public recordsByRow: Map<number, { targetId: string; data: Record<string, unknown> }> =
    new Map();
  public attemptsByRow: Map<number, number> = new Map();
  public failRows: Set<number> = new Set();

  public async importRow(
    _batchId: string,
    sourceRow: number,
    idempotencyKey: string,
    data: Record<string, unknown>
  ): Promise<MigrationTargetAdapterResult> {
    const currentAttempt = (this.attemptsByRow.get(sourceRow) ?? 0) + 1;
    this.attemptsByRow.set(sourceRow, currentAttempt);

    if (this.failRows.has(sourceRow)) {
      return {
        ok: false,
        error: {
          code: 'DATA_VALIDATION_ERROR',
          message: `Constraint violation for row ${sourceRow}`,
          retryable: false,
        },
      };
    }

    const targetId = randomUUID();
    this.records.set(targetId, data);
    this.recordsByRow.set(sourceRow, { targetId, data });
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

describe('KIT-12: V1 Batch Safety — Stop Threshold, Retry Guard & Resumable Failed-Run State', () => {
  let checkpointStore: InMemoryCheckpointStore;
  let outcomeLedger: InMemoryRowOutcomeLedger;
  let safetyMonitor: BatchSafetyMonitor;
  let reconciliationService: ReconciliationService;
  let mockAdapter: MockTargetAdapter;

  beforeEach(() => {
    checkpointStore = new InMemoryCheckpointStore();
    outcomeLedger = new InMemoryRowOutcomeLedger();
    safetyMonitor = new BatchSafetyMonitor({
      checkpointStore,
      failureThresholdPercentage: 10.0,
      minAttemptedRows: 10,
    });
    reconciliationService = new ReconciliationService(outcomeLedger);
    mockAdapter = new MockTargetAdapter();
  });

  describe('1. Continuous Cumulative Failure Rate Monitoring', () => {
    it('calculates failureRate = (failedRows / attemptedRows) * 100 accurately', async () => {
      const batchId = `batch-${randomUUID()}`;

      // 9 successes
      for (let r = 1; r <= 9; r++) {
        await safetyMonitor.recordSuccess(batchId, r);
      }
      expect(safetyMonitor.getStats(batchId).attemptedRows).toBe(9);
      expect(safetyMonitor.getStats(batchId).failedRows).toBe(0);
      expect(safetyMonitor.getStats(batchId).failureRate).toBe(0);
      expect(safetyMonitor.shouldHalt(batchId)).toBe(false);

      // 1 failure -> 1/10 = 10.0% (at threshold, not strictly greater)
      await safetyMonitor.recordFailure(batchId, 10, 9);
      expect(safetyMonitor.getStats(batchId).attemptedRows).toBe(10);
      expect(safetyMonitor.getStats(batchId).failedRows).toBe(1);
      expect(safetyMonitor.getStats(batchId).failureRate).toBe(10);
      expect(safetyMonitor.shouldHalt(batchId)).toBe(false);

      // Next failure -> 2/11 = 18.18% (> 10%) -> should halt
      await expect(
        safetyMonitor.recordFailure(batchId, 11, 9)
      ).rejects.toThrow(BatchExcessiveFailuresHaltError);

      const stats = safetyMonitor.getStats(batchId);
      expect(stats.attemptedRows).toBe(11);
      expect(stats.failedRows).toBe(2);
      expect(stats.isHalted).toBe(true);
      expect(stats.failureRate).toBeCloseTo(18.18, 1);
    });

    it('identifies stopped_excessive_failures as resumable status in contracts', () => {
      expect(isKitBatchResumableStatus('stopped_excessive_failures')).toBe(true);
      expect(isKitBatchResumableStatus('failed')).toBe(true);
      expect(isKitBatchResumableStatus('load_failed_partial')).toBe(true);
      expect(isKitBatchResumableStatus('reconciled')).toBe(false);
      expect(isKitBatchResumableStatus('rolled_back')).toBe(false);
    });
  });

  describe('2. Immediate Stop Threshold (> 10%) & PostgreSQL Zero Rollback Durability', () => {
    it('stops subsequent writes immediately when failure rate exceeds 10%', async () => {
      const batchId = `batch-${randomUUID()}`;
      const worker = new MigrationWorker({
        checkpointStore,
        outcomeLedger,
        continueOnRowError: true,
        chunkSize: 50,
        failureThresholdPercentage: 10.0,
      });

      // Prepare 50 rows. Rows 1..8 succeed. Rows 9, 10, 11 fail.
      // After row 11: 3 failures / 11 attempts = 27.27% > 10% threshold.
      mockAdapter.failRows.add(9);
      mockAdapter.failRows.add(10);
      mockAdapter.failRows.add(11);

      const rows = Array.from({ length: 50 }, (_, i) => ({
        sourceRow: i + 1,
        data: { name: `Contact ${i + 1}`, email: `contact${i + 1}@example.com` },
      }));

      await expect(
        worker.processJob(
          {
            jobId: randomUUID(),
            batchId,
            jobType: 'load',
            module: 'crm',
            entity: 'contacts',
            continueOnRowError: true,
            rows,
          },
          mockAdapter
        )
      ).rejects.toThrow(BatchExcessiveFailuresHaltError);

      // Verify that NO rows after row 11 were attempted
      expect(mockAdapter.attemptsByRow.has(12)).toBe(false);
      expect(mockAdapter.attemptsByRow.has(50)).toBe(false);

      // Verify that already committed records (rows 1..8) remain durable in PostgreSQL (zero rollback)
      expect(mockAdapter.recordsByRow.size).toBe(8);
      for (let r = 1; r <= 8; r++) {
        expect(mockAdapter.recordsByRow.has(r)).toBe(true);
      }
    });

    it('persists checkpoint with status = stopped_excessive_failures and preserves lastCommittedRow', async () => {
      const batchId = `batch-${randomUUID()}`;
      const worker = new MigrationWorker({
        checkpointStore,
        outcomeLedger,
        continueOnRowError: true,
        chunkSize: 50,
        failureThresholdPercentage: 10.0,
      });

      mockAdapter.failRows.add(9);
      mockAdapter.failRows.add(10);
      mockAdapter.failRows.add(11);

      const rows = Array.from({ length: 50 }, (_, i) => ({
        sourceRow: i + 1,
        data: { name: `Contact ${i + 1}` },
      }));

      try {
        await worker.processJob(
          {
            jobId: randomUUID(),
            batchId,
            jobType: 'load',
            module: 'crm',
            entity: 'contacts',
            continueOnRowError: true,
            rows,
          },
          mockAdapter
        );
      } catch (err) {
        expect(err).toBeInstanceOf(BatchExcessiveFailuresHaltError);
      }

      const checkpoint = await checkpointStore.getCheckpoint(batchId);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.status).toBe('stopped_excessive_failures');
      expect(checkpoint?.checkpointName).toBe('load_checkpoint');
      expect(checkpoint?.lastCommittedRow).toBe(8);
    });
  });

  describe('3. Standard Error Envelope & Versioned Outbox Event', () => {
    it('produces standard error envelope with code = STOPPED_EXCESSIVE_FAILURES and required details', () => {
      const batchId = 'batch-sample-123';
      const haltError = new BatchExcessiveFailuresHaltError(
        batchId,
        3, // failedRows
        11, // attemptedRows
        27.27, // failureRate
        10.0, // threshold
        8 // lastCommittedRow
      );

      expect(haltError.code).toBe('STOPPED_EXCESSIVE_FAILURES');
      expect(haltError.statusCode).toBe(422);

      const envelope = haltError.toEnvelope();
      expect(envelope).toEqual({
        code: 'STOPPED_EXCESSIVE_FAILURES',
        message: haltError.message,
        details: {
          batchId: 'batch-sample-123',
          failedRows: 3,
          attemptedRows: 11,
          failureRate: 27.27,
          threshold: 10.0,
          lastCommittedRow: 8,
        },
      });
    });

    it('emits valid versioned outbox event batch.stopped_excessive_failures conforming to schema', async () => {
      const batchId = `batch-${randomUUID()}`;
      const capturedEvents: KitBatchStoppedExcessiveFailuresEvent[] = [];

      const monitor = new BatchSafetyMonitor({
        checkpointStore,
        failureThresholdPercentage: 10.0,
        minAttemptedRows: 10,
        onHaltEvent: (event) => {
          capturedEvents.push(event);
        },
      });

      // 9 successful rows
      for (let r = 1; r <= 9; r++) {
        await monitor.recordSuccess(batchId, r);
      }

      // Row 10 and 11 fail
      await monitor.recordFailure(batchId, 10, 9);

      try {
        await monitor.recordFailure(batchId, 11, 9);
      } catch (err) {
        expect(err).toBeInstanceOf(BatchExcessiveFailuresHaltError);
      }

      expect(capturedEvents).toHaveLength(1);
      const event = capturedEvents[0]!;
      expect(event.eventType).toBe('batch.stopped_excessive_failures');
      expect(event.batchId).toBe(batchId);
      expect(event.failedRows).toBe(2);
      expect(event.attemptedRows).toBe(11);
      expect(event.lastCommittedRow).toBe(9);
      expect(event.checkpoint).toBe('load_checkpoint');

      // Validates schema parses successfully
      const validated = KitBatchStoppedExcessiveFailuresEventSchema.parse(event);
      expect(validated.eventType).toBe('batch.stopped_excessive_failures');
    });
  });

  describe('4. Resumption Preserving Batch Identity (batchId) from lastCommittedRow + 1', () => {
    it('resumes batch using same batchId, skipping committed rows without duplicate writes', async () => {
      const batchId = `batch-${randomUUID()}`;
      const worker = new MigrationWorker({
        checkpointStore,
        outcomeLedger,
        continueOnRowError: true,
        chunkSize: 50,
        failureThresholdPercentage: 10.0,
      });

      // Setup 20 rows.
      // During initial run: rows 1..8 succeed, rows 9, 10, 11 fail -> halts at row 11.
      mockAdapter.failRows.add(9);
      mockAdapter.failRows.add(10);
      mockAdapter.failRows.add(11);

      const rows = Array.from({ length: 20 }, (_, i) => ({
        sourceRow: i + 1,
        data: { name: `Contact ${i + 1}` },
      }));

      // Initial run halts
      await expect(
        worker.processJob(
          {
            jobId: randomUUID(),
            batchId,
            jobType: 'load',
            module: 'crm',
            entity: 'contacts',
            continueOnRowError: true,
            rows,
          },
          mockAdapter
        )
      ).rejects.toThrow(BatchExcessiveFailuresHaltError);

      const cpAfterHalt = await checkpointStore.getCheckpoint(batchId);
      expect(cpAfterHalt?.status).toBe('stopped_excessive_failures');
      expect(cpAfterHalt?.lastCommittedRow).toBe(8);

      // Simulate remediation: user fixes bad data, clears failing rows
      mockAdapter.failRows.clear();

      // Reset safety monitor for the fresh resume attempt
      worker.getSafetyMonitor().reset(batchId);

      // Resume execution using EXACT SAME batchId
      const resumeResult = await worker.processJob(
        {
          jobId: randomUUID(),
          batchId, // Preserves batch identity
          jobType: 'load',
          module: 'crm',
          entity: 'contacts',
          continueOnRowError: true,
          rows,
        },
        mockAdapter
      );

      expect(resumeResult.success).toBe(true);
      expect(resumeResult.status).toBe('loaded');

      // Checkpoint is updated to loaded
      const cpAfterResume = await checkpointStore.getCheckpoint(batchId);
      expect(cpAfterResume?.status).toBe('loaded');
      expect(cpAfterResume?.lastCommittedRow).toBe(20);

      // Verify idempotency: rows 1..8 were NOT re-written or duplicate-attempted on resume
      for (let r = 1; r <= 8; r++) {
        expect(mockAdapter.attemptsByRow.get(r)).toBe(1);
      }
      // Row 9 had 3 bounded retry attempts during initial run + 1 successful attempt on resume
      expect(mockAdapter.attemptsByRow.get(9)).toBe(4);
      // Rows 10..20 were never attempted in initial run (stopped immediately) and attempted once on resume
      for (let r = 10; r <= 20; r++) {
        expect(mockAdapter.attemptsByRow.get(r)).toBe(1);
      }
      expect(mockAdapter.recordsByRow.size).toBe(20);
    });
  });

  describe('5. Reconciliation Blocking on STOPPED_EXCESSIVE_FAILURES', () => {
    it('strictly blocks reconciliation when batchStatus is stopped_excessive_failures', async () => {
      const batchId = `batch-${randomUUID()}`;

      // Simulate 8 records recorded in outcome ledger before halt
      for (let r = 1; r <= 8; r++) {
        await outcomeLedger.recordOutcome({
          batchId,
          sourceRow: r,
          outcome: 'loaded',
          targetId: `target-${r}`,
        });
      }

      // Reconcile must throw ReconciliationBlockedByBatchStateError
      await expect(
        reconciliationService.reconcileBatch(
          batchId,
          20,
          'stopped_excessive_failures'
        )
      ).rejects.toThrow(ReconciliationBlockedByBatchStateError);

      // assertCanSignoff must also throw ReconciliationBlockedByBatchStateError
      const dummyReport = {
        batchId,
        sourceCount: 20,
        loadedCount: 20,
        rejectedCount: 0,
        mergedCount: 0,
        skippedCount: 0,
        unaccountedCount: 0,
        status: 'OK' as const,
        isBalanced: true,
        timestamp: new Date(),
      };

      expect(() => {
        reconciliationService.assertCanSignoff(
          dummyReport,
          'stopped_excessive_failures'
        );
      }).toThrow(ReconciliationBlockedByBatchStateError);
    });

    it('allows reconciliation to proceed once batch successfully completes loaded stage', async () => {
      const batchId = `batch-${randomUUID()}`;

      for (let r = 1; r <= 20; r++) {
        await outcomeLedger.recordOutcome({
          batchId,
          sourceRow: r,
          outcome: 'loaded',
          targetId: `target-${r}`,
        });
      }

      // Reconcile succeeds when status is 'loaded'
      const report = await reconciliationService.reconcileBatch(
        batchId,
        20,
        'loaded'
      );
      expect(report.isBalanced).toBe(true);
      expect(report.unaccountedCount).toBe(0);
      expect(report.loadedCount).toBe(20);

      expect(() => {
        reconciliationService.assertCanSignoff(report, 'loaded');
      }).not.toThrow();
    });
  });
});
