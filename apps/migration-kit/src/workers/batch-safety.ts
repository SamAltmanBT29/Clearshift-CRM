import { randomUUID } from 'node:crypto';
import {
  type KitBatchStatus,
  BatchExcessiveFailuresHaltError,
  type KitBatchStoppedExcessiveFailuresEvent,
  KitBatchStoppedExcessiveFailuresEventSchema,
} from '@clearshift/contracts';
import type { ICheckpointStore } from './types.js';

export interface BatchSafetyOptions {
  failureThresholdPercentage?: number | undefined; // default: 10.0
  minAttemptedRows?: number | undefined; // default: 1
  checkpointStore?: ICheckpointStore | undefined;
  onHaltEvent?: ((event: KitBatchStoppedExcessiveFailuresEvent) => Promise<void> | void) | undefined;
}

export interface BatchSafetyCumulativeStats {
  batchId: string;
  attemptedRows: number;
  failedRows: number;
  loadedRows: number;
  mergedRows: number;
  skippedRows: number;
  failureRate: number; // Percentage: 0.0 to 100.0
  threshold: number;
  isHalted: boolean;
  lastCommittedRow: number;
}

/**
 * BatchSafetyMonitor (KIT-12 / SDS §11.10)
 *
 * Continuously monitors cumulative row failure percentage during chunked load:
 *   failureRate = (failedRows / attemptedRows) * 100
 *
 * When failure rate exceeds 10% of attempted rows:
 * 1. Subsequent writes stop immediately.
 * 2. Already committed records and receipts remain durable in PostgreSQL (zero rollback saga in V1).
 * 3. Batch state transitions to STOPPED_EXCESSIVE_FAILURES (stopped_excessive_failures);
 *    resumption preserves batch identity (batchId).
 * 4. Generates standard error envelope { code: 'STOPPED_EXCESSIVE_FAILURES', message, details }
 *    and versioned outbox event batch.stopped_excessive_failures.
 * 5. Resumption from load_checkpoint continues from lastCommittedRow + 1 without duplicate writes.
 * 6. Reconciliation is strictly blocked while batch is in STOPPED_EXCESSIVE_FAILURES or failure state.
 */
export class BatchSafetyMonitor {
  private failureThresholdPercentage: number;
  private minAttemptedRows: number;
  private checkpointStore?: ICheckpointStore | undefined;
  private onHaltEvent?: ((event: KitBatchStoppedExcessiveFailuresEvent) => Promise<void> | void) | undefined;
  private batchStats: Map<string, BatchSafetyCumulativeStats> = new Map();
  private emittedEvents: KitBatchStoppedExcessiveFailuresEvent[] = [];

  constructor(options: BatchSafetyOptions = {}) {
    this.failureThresholdPercentage = options.failureThresholdPercentage ?? 10.0;
    this.minAttemptedRows = options.minAttemptedRows ?? 1;
    this.checkpointStore = options.checkpointStore;
    this.onHaltEvent = options.onHaltEvent;
  }

  public setCheckpointStore(store: ICheckpointStore): void {
    this.checkpointStore = store;
  }

  public setOnHaltEvent(
    handler: (event: KitBatchStoppedExcessiveFailuresEvent) => Promise<void> | void
  ): void {
    this.onHaltEvent = handler;
  }

  /**
   * Retrieves or initializes running cumulative statistics for a batch.
   */
  public getStats(batchId: string): BatchSafetyCumulativeStats {
    let stats = this.batchStats.get(batchId);
    if (!stats) {
      stats = {
        batchId,
        attemptedRows: 0,
        failedRows: 0,
        loadedRows: 0,
        mergedRows: 0,
        skippedRows: 0,
        failureRate: 0,
        threshold: this.failureThresholdPercentage,
        isHalted: false,
        lastCommittedRow: 0,
      };
      this.batchStats.set(batchId, stats);
    }
    return stats;
  }

  /**
   * Resets monitoring state for a batch (e.g. before initial run or clean test).
   */
  public reset(batchId: string): void {
    this.batchStats.delete(batchId);
  }

  /**
   * Returns captured outbox events for auditing or assertions.
   */
  public getEmittedEvents(batchId?: string): KitBatchStoppedExcessiveFailuresEvent[] {
    if (batchId) {
      return this.emittedEvents.filter((e) => e.batchId === batchId);
    }
    return [...this.emittedEvents];
  }

  /**
   * Evaluates if the batch should halt based on current cumulative failure rate.
   */
  public shouldHalt(batchId: string): boolean {
    const stats = this.getStats(batchId);
    if (stats.attemptedRows < this.minAttemptedRows) {
      return false;
    }
    return stats.failureRate > this.failureThresholdPercentage;
  }

  /**
   * Records a successful row write and updates cumulative statistics.
   */
  public async recordSuccess(
    batchId: string,
    sourceRow: number,
    _chunkIndex?: number
  ): Promise<BatchSafetyCumulativeStats> {
    const stats = this.getStats(batchId);
    stats.attemptedRows++;
    stats.loadedRows++;
    stats.lastCommittedRow = Math.max(stats.lastCommittedRow, sourceRow);
    stats.failureRate = (stats.failedRows / stats.attemptedRows) * 100;
    return stats;
  }

  /**
   * Records a skipped row outcome.
   */
  public recordSkipped(batchId: string): BatchSafetyCumulativeStats {
    const stats = this.getStats(batchId);
    stats.skippedRows++;
    return stats;
  }

  /**
   * Records a merged row outcome.
   */
  public recordMerged(
    batchId: string,
    sourceRow: number
  ): BatchSafetyCumulativeStats {
    const stats = this.getStats(batchId);
    stats.attemptedRows++;
    stats.mergedRows++;
    stats.lastCommittedRow = Math.max(stats.lastCommittedRow, sourceRow);
    stats.failureRate = (stats.failedRows / stats.attemptedRows) * 100;
    return stats;
  }

  /**
   * Records a row failure or rejection.
   * If cumulative failure rate exceeds 10%, immediately triggers a batch halt.
   */
  public async recordFailure(
    batchId: string,
    _sourceRow: number,
    lastCommittedRow: number,
    chunkIndex?: number,
    _error?: unknown
  ): Promise<BatchSafetyCumulativeStats> {
    const stats = this.getStats(batchId);
    stats.attemptedRows++;
    stats.failedRows++;
    stats.lastCommittedRow = Math.max(stats.lastCommittedRow, lastCommittedRow);
    stats.failureRate = (stats.failedRows / stats.attemptedRows) * 100;

    if (this.shouldHalt(batchId)) {
      await this.haltBatch(batchId, stats.lastCommittedRow, chunkIndex);
    }

    return stats;
  }

  /**
   * Generic recording method for any outcome.
   */
  public async recordAttempt(params: {
    batchId: string;
    outcome: 'loaded' | 'failed' | 'rejected' | 'merged' | 'skipped';
    sourceRow: number;
    lastCommittedRow?: number;
    chunkIndex?: number;
    error?: unknown;
  }): Promise<{
    shouldHalt: boolean;
    failureRate: number;
    stats: BatchSafetyCumulativeStats;
  }> {
    const { batchId, outcome, sourceRow, lastCommittedRow = 0, chunkIndex } = params;

    if (outcome === 'skipped') {
      const stats = this.recordSkipped(batchId);
      return { shouldHalt: false, failureRate: stats.failureRate, stats };
    }

    if (outcome === 'merged') {
      const stats = this.recordMerged(batchId, sourceRow);
      return { shouldHalt: false, failureRate: stats.failureRate, stats };
    }

    if (outcome === 'loaded') {
      const stats = await this.recordSuccess(batchId, sourceRow, chunkIndex);
      return { shouldHalt: false, failureRate: stats.failureRate, stats };
    }

    // Outcome is failed or rejected
    const stats = await this.recordFailure(
      batchId,
      sourceRow,
      lastCommittedRow,
      chunkIndex,
      params.error
    );

    return {
      shouldHalt: this.shouldHalt(batchId),
      failureRate: stats.failureRate,
      stats,
    };
  }

  /**
   * Triggers immediate batch halt when the failure rate exceeds the 10% threshold:
   * 1. Marks batch as halted in-place.
   * 2. Preserves already committed records and receipts durable in PostgreSQL (NO rollback).
   * 3. Transitions status to 'stopped_excessive_failures' in the checkpoint store.
   * 4. Emits outbox event 'batch.stopped_excessive_failures'.
   * 5. Throws BatchExcessiveFailuresHaltError.
   */
  public async haltBatch(
    batchId: string,
    lastCommittedRow: number,
    chunkIndex?: number
  ): Promise<never> {
    const stats = this.getStats(batchId);
    stats.isHalted = true;
    stats.lastCommittedRow = lastCommittedRow;

    const haltStatus: KitBatchStatus = 'stopped_excessive_failures';

    if (this.checkpointStore) {
      await this.checkpointStore.saveCheckpoint({
        batchId,
        lastCommittedRow,
        lastCommittedChunk: chunkIndex ?? 0,
        status: haltStatus,
        checkpointName: 'load_checkpoint',
        updatedAt: new Date(),
      });
    }

    const eventPayload: KitBatchStoppedExcessiveFailuresEvent = {
      eventId: randomUUID(),
      eventType: 'batch.stopped_excessive_failures',
      batchId,
      failedRows: stats.failedRows,
      attemptedRows: stats.attemptedRows,
      failureRate: stats.failureRate,
      threshold: stats.threshold,
      lastCommittedRow,
      checkpoint: 'load_checkpoint',
      haltedAt: new Date(),
    };

    // Validate event contract
    const parsedEvent = KitBatchStoppedExcessiveFailuresEventSchema.parse(eventPayload);
    this.emittedEvents.push(parsedEvent);

    if (this.onHaltEvent) {
      await this.onHaltEvent(parsedEvent);
    }

    throw new BatchExcessiveFailuresHaltError(
      batchId,
      stats.failedRows,
      stats.attemptedRows,
      stats.failureRate,
      stats.threshold,
      lastCommittedRow
    );
  }
}
