import {
  ChunkCircuitBreakerHaltError,
} from '@clearshift/contracts';
import type { ChunkExecutionMetrics } from './types.js';

export const DEFAULT_CHUNK_SIZE = 500;
export const MAX_FAILURE_RATE_PERCENT = 10.0;

export interface ChunkDefinition<TRow = Record<string, unknown>> {
  chunkIndex: number;
  startRow: number;
  endRow: number;
  rows: Array<{ sourceRow: number; data: TRow; skipped?: boolean }>;
}

export class ChunkScheduler<TRow = Record<string, unknown>> {
  constructor(
    private chunkSize: number = DEFAULT_CHUNK_SIZE,
    private maxFailureRatePercent: number = MAX_FAILURE_RATE_PERCENT
  ) {}

  /**
   * Partitions source rows into chunks of 500
   */
  public createChunks(
    rows: Array<{ sourceRow: number; data: TRow; skipped?: boolean }>,
    startOffsetRow: number = 0
  ): ChunkDefinition<TRow>[] {
    // If resuming from a checkpoint, filter out rows prior to startOffsetRow
    const pendingRows = startOffsetRow > 0
      ? rows.filter((r) => r.sourceRow > startOffsetRow)
      : rows;

    const chunks: ChunkDefinition<TRow>[] = [];
    for (let i = 0; i < pendingRows.length; i += this.chunkSize) {
      const slice = pendingRows.slice(i, i + this.chunkSize);
      const startRow = slice[0]?.sourceRow ?? 0;
      const endRow = slice[slice.length - 1]?.sourceRow ?? 0;
      chunks.push({
        chunkIndex: Math.floor(i / this.chunkSize),
        startRow,
        endRow,
        rows: slice,
      });
    }

    return chunks;
  }

  /**
   * Evaluates chunk execution metrics and enforces the 10% circuit breaker.
   * If error rate within the chunk exceeds 10%, halts immediately.
   */
  public evaluateChunk(
    batchId: string,
    metrics: ChunkExecutionMetrics
  ): { shouldContinue: boolean; failureRate: number } {
    const attempted = metrics.attemptedRows;
    if (attempted === 0) {
      return { shouldContinue: true, failureRate: 0 };
    }

    const failureRate = (metrics.rejectedRows / attempted) * 100;

    if (failureRate > this.maxFailureRatePercent) {
      throw new ChunkCircuitBreakerHaltError(
        batchId,
        metrics.chunkIndex,
        failureRate,
        this.maxFailureRatePercent
      );
    }

    return { shouldContinue: true, failureRate };
  }
}
