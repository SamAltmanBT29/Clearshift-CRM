import {
  BULLMQ_DEFAULT_ATTEMPTS,
  MaxTargetWriteRetriesExceededError,
  type WorkerCheckpoint,
  type MigrationTargetAdapter,
  type MigrationTargetAdapterResult,
} from '@clearshift/contracts';
import type { ICheckpointStore } from './types.js';
import type { IRowOutcomeLedger } from '../reconcile/outcome-ledger.js';

/**
 * In-memory checkpoint store for tests and worker resilience simulation.
 */
export class InMemoryCheckpointStore implements ICheckpointStore {
  private checkpoints: Map<string, WorkerCheckpoint> = new Map();

  public async saveCheckpoint(checkpoint: WorkerCheckpoint): Promise<void> {
    this.checkpoints.set(checkpoint.batchId, checkpoint);
  }

  public async getCheckpoint(batchId: string): Promise<WorkerCheckpoint | null> {
    return this.checkpoints.get(batchId) ?? null;
  }

  public async clear(batchId?: string): Promise<void> {
    if (batchId) {
      this.checkpoints.delete(batchId);
    } else {
      this.checkpoints.clear();
    }
  }
}

/**
 * Service orchestrating bounded retries, checkpoint tracking, and partial-load recovery.
 */
export class PartialLoadRecoveryService {
  constructor(
    private checkpointStore: ICheckpointStore,
    private outcomeLedger?: IRowOutcomeLedger
  ) {}

  public getCheckpointStore(): ICheckpointStore {
    return this.checkpointStore;
  }

  /**
   * Executes a target row write with bounded retries (max 3) using a stable idempotency key.
   * If retries are exhausted:
   * 1. The batch status transitions to 'load_failed_partial'.
   * 2. The checkpoint is durably committed with the last successfully committed row.
   * 3. The failing row is NOT marked as rejected.
   */
  public async executeWriteWithBoundedRetries<TRow = Record<string, unknown>>(
    adapter: MigrationTargetAdapter<TRow>,
    batchId: string,
    sourceRow: number,
    idempotencyKey: string,
    data: TRow,
    context: {
      chunkIndex: number;
      lastCommittedRow: number;
      maxRetries?: number;
    }
  ): Promise<{ ok: true; value: MigrationTargetAdapterResult }> {
    const maxRetries = context.maxRetries ?? BULLMQ_DEFAULT_ATTEMPTS;
    let attempt = 0;
    let lastError = '';

    while (attempt < maxRetries) {
      attempt++;
      try {
        const result = await adapter.importRow(batchId, sourceRow, idempotencyKey, data);
        if (result.ok) {
          // Commit row outcome in outcome ledger
          if (this.outcomeLedger) {
            await this.outcomeLedger.recordOutcome({
              batchId,
              sourceRow,
              outcome: 'loaded',
              targetId: result.value.targetId,
              idempotencyKey,
            });
          }

          // Update checkpoint to this committed row
          await this.checkpointStore.saveCheckpoint({
            batchId,
            lastCommittedRow: sourceRow,
            lastCommittedChunk: context.chunkIndex,
            status: 'loading',
            checkpointName: 'load_checkpoint',
            updatedAt: new Date(),
          });

          return result;
        }

        // Adapter returned explicit failure
        lastError = result.error.message;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    // All bounded retries exhausted without resolution
    // 1. Update checkpoint with 'load_failed_partial' status and preserve last successfully committed row
    await this.checkpointStore.saveCheckpoint({
      batchId,
      lastCommittedRow: context.lastCommittedRow,
      lastCommittedChunk: context.chunkIndex,
      status: 'load_failed_partial',
      checkpointName: 'load_checkpoint',
      updatedAt: new Date(),
    });

    // 2. CRITICAL INVARIANT: Unresolved write is NOT recorded as 'rejected' in the outcome ledger!
    // It remains unrecorded / pending so that reconciliation detects it as uncommitted / partial.

    // 3. Throw MaxTargetWriteRetriesExceededError
    throw new MaxTargetWriteRetriesExceededError(
      batchId,
      sourceRow,
      attempt,
      lastError
    );
  }

  /**
   * Resumes a batch from its latest committed checkpoint.
   */
  public async prepareResume(
    batchId: string
  ): Promise<{
    resumedFromRow: number;
    resumedFromChunk: number;
    canResume: boolean;
  }> {
    const checkpoint = await this.checkpointStore.getCheckpoint(batchId);
    if (!checkpoint) {
      return {
        resumedFromRow: 0,
        resumedFromChunk: 0,
        canResume: true,
      };
    }

    // Reset status to loading on resume
    await this.checkpointStore.saveCheckpoint({
      ...checkpoint,
      status: 'loading',
      updatedAt: new Date(),
    });

    return {
      resumedFromRow: checkpoint.lastCommittedRow,
      resumedFromChunk: checkpoint.lastCommittedChunk,
      canResume: true,
    };
  }
}
