import { randomUUID } from 'node:crypto';
import {
  computeStableIdempotencyKey,
  type KitBatchStatus,
  type MigrationTargetAdapter,
  BatchExcessiveFailuresHaltError,
} from '@clearshift/contracts';
import {
  MigrationWorkerHealthMonitor,
  migrationWorkerHealth,
  type WorkerJobContext,
} from './health.js';
import {
  DEFAULT_BULLMQ_JOB_OPTIONS,
  BULLMQ_MIGRATION_QUEUE_NAME,
} from './queue-config.js';
import {
  ChunkScheduler,
  DEFAULT_CHUNK_SIZE,
} from './chunk-scheduler.js';
import {
  PartialLoadRecoveryService,
  InMemoryCheckpointStore,
} from './partial-load-recovery.js';
import { BatchSafetyMonitor } from './batch-safety.js';
import type {
  MigrationJobData,
  MigrationJobResult,
  CrashInjectionHook,
  ICheckpointStore,
} from './types.js';
import type { IRowOutcomeLedger } from '../reconcile/outcome-ledger.js';

export class MigrationWorker {
  private scheduler: ChunkScheduler;
  private recoveryService: PartialLoadRecoveryService;
  private healthMonitor: MigrationWorkerHealthMonitor;
  private safetyMonitor: BatchSafetyMonitor;
  private continueOnRowError: boolean;
  private crashHook: CrashInjectionHook | undefined;
  private concurrency: number;

  constructor(options: {
    checkpointStore?: ICheckpointStore | undefined;
    outcomeLedger?: IRowOutcomeLedger | undefined;
    healthMonitor?: MigrationWorkerHealthMonitor | undefined;
    safetyMonitor?: BatchSafetyMonitor | undefined;
    failureThresholdPercentage?: number | undefined;
    continueOnRowError?: boolean | undefined;
    chunkSize?: number | undefined;
    concurrency?: number | undefined;
    crashHook?: CrashInjectionHook | undefined;
  } = {}) {
    const store = options.checkpointStore ?? new InMemoryCheckpointStore();
    this.concurrency = options.concurrency ?? DEFAULT_BULLMQ_JOB_OPTIONS.concurrency;
    this.scheduler = new ChunkScheduler(options.chunkSize ?? DEFAULT_CHUNK_SIZE);
    this.recoveryService = new PartialLoadRecoveryService(
      store,
      options.outcomeLedger
    );
    this.safetyMonitor =
      options.safetyMonitor ??
      new BatchSafetyMonitor({
        checkpointStore: store,
        failureThresholdPercentage: options.failureThresholdPercentage,
      });
    this.continueOnRowError = options.continueOnRowError ?? false;
    this.healthMonitor = options.healthMonitor ?? migrationWorkerHealth;
    this.crashHook = options.crashHook;
  }

  public setCrashHook(hook: CrashInjectionHook | undefined): void {
    this.crashHook = hook;
  }

  public getRecoveryService(): PartialLoadRecoveryService {
    return this.recoveryService;
  }

  public getSafetyMonitor(): BatchSafetyMonitor {
    return this.safetyMonitor;
  }

  public getConcurrency(): number {
    return this.concurrency;
  }

  /**
   * Main entry point for processing migration jobs in worker context.
   */
  public async processJob<TRow extends Record<string, unknown> = Record<string, unknown>>(
    data: MigrationJobData,
    adapter?: MigrationTargetAdapter<TRow>
  ): Promise<MigrationJobResult> {
    const context: WorkerJobContext = {
      jobId: data.jobId || randomUUID(),
      queueName: BULLMQ_MIGRATION_QUEUE_NAME,
      correlationId: (data.metadata?.['correlationId'] as string) || randomUUID(),
      data: {
        batchId: data.batchId,
        jobType: data.jobType,
        chunkIndex: data.chunkIndex,
      },
    };

    return this.healthMonitor.executeJob(context, async () => {
      switch (data.jobType) {
        case 'load':
          return this.processLoadJob(data, adapter as MigrationTargetAdapter<TRow>);
        case 'extract':
        case 'profile':
        case 'clean':
        case 'map':
        case 'validate':
        default:
          return this.processGenericStageJob(data);
      }
    });
  }

  /**
   * Executes Step 5 (Load) across chunks with 10% circuit breaker and partial-load recovery.
   */
  private async processLoadJob<TRow extends Record<string, unknown> = Record<string, unknown>>(
    data: MigrationJobData,
    adapter?: MigrationTargetAdapter<TRow>
  ): Promise<MigrationJobResult> {
    if (!adapter) {
      throw new Error(`TargetAdapter is required for load jobs in module '${data.module}'`);
    }

    const rows = (data.rows ?? []) as Array<{ sourceRow: number; data: TRow; skipped?: boolean }>;
    const resumeInfo = await this.recoveryService.prepareResume(data.batchId);
    const chunks = this.scheduler.createChunks(rows as Array<{ sourceRow: number; data: Record<string, unknown>; skipped?: boolean }>, resumeInfo.resumedFromRow);

    let lastCommittedRow = resumeInfo.resumedFromRow;
    let processedRows = 0;

    for (const chunk of chunks) {
      let chunkAttempted = 0;
      let chunkLoaded = 0;
      let chunkRejected = 0;
      let chunkMerged = 0;
      let chunkSkipped = 0;

      for (const row of chunk.rows) {
        // Trigger injected crash hook if registered (simulating worker crash mid-batch)
        if (this.crashHook) {
          await this.crashHook('load', chunk.chunkIndex, row.sourceRow);
        }

        const idempKey = computeStableIdempotencyKey({
          batchId: data.batchId,
          sourceRow: row.sourceRow,
          module: data.module,
          entity: data.entity,
          operationVersion: adapter.schemaVersion,
        });

        if (row.skipped) {
          chunkSkipped++;
          this.safetyMonitor.recordSkipped(data.batchId);
          continue;
        }

        chunkAttempted++;

        try {
          // Execute target row write with bounded retries (up to 3)
          // If retries are exhausted, it throws MaxTargetWriteRetriesExceededError
          // and transitions batch to 'load_failed_partial' without marking row as rejected
          const result = await this.recoveryService.executeWriteWithBoundedRetries(
            adapter,
            data.batchId,
            row.sourceRow,
            idempKey,
            row.data,
            {
              chunkIndex: chunk.chunkIndex,
              lastCommittedRow,
            }
          );

          if (result.ok) {
            chunkLoaded++;
            lastCommittedRow = row.sourceRow;
            processedRows++;
            await this.safetyMonitor.recordSuccess(
              data.batchId,
              row.sourceRow,
              chunk.chunkIndex
            );
          }
        } catch (err) {
          if (err instanceof BatchExcessiveFailuresHaltError) {
            throw err;
          }

          chunkRejected++;

          // Continuous failure percentage tracking and immediate stop threshold check (KIT-12)
          await this.safetyMonitor.recordFailure(
            data.batchId,
            row.sourceRow,
            lastCommittedRow,
            chunk.chunkIndex,
            err
          );

          const shouldContinue =
            data.continueOnRowError ?? this.continueOnRowError;

          if (shouldContinue) {
            if (this.recoveryService.getOutcomeLedger()) {
              await this.recoveryService.getOutcomeLedger()!.recordOutcome({
                batchId: data.batchId,
                sourceRow: row.sourceRow,
                outcome: 'rejected',
                idempotencyKey: idempKey,
              });
            }
          } else {
            throw err;
          }
        }
      }

      // Check chunk 10% error threshold circuit breaker
      this.scheduler.evaluateChunk(data.batchId, {
        chunkIndex: chunk.chunkIndex,
        startRow: chunk.startRow,
        endRow: chunk.endRow,
        attemptedRows: chunkAttempted,
        loadedRows: chunkLoaded,
        rejectedRows: chunkRejected,
        mergedRows: chunkMerged,
        skippedRows: chunkSkipped,
        errorRate: chunkAttempted > 0 ? (chunkRejected / chunkAttempted) * 100 : 0,
        halted: false,
      });
    }

    const finalStatus: KitBatchStatus = 'loaded';

    // Update final checkpoint to loaded
    await this.recoveryService.getCheckpointStore().saveCheckpoint({
      batchId: data.batchId,
      lastCommittedRow,
      lastCommittedChunk: chunks.length,
      status: finalStatus,
      checkpointName: 'loaded',
      updatedAt: new Date(),
    });

    return {
      jobId: data.jobId,
      batchId: data.batchId,
      jobType: 'load',
      success: true,
      processedRows,
      checkpoint: 'loaded',
      status: finalStatus,
    };
  }

  /**
   * Processes generic non-load stages (extract, profile, clean, map, validate)
   */
  private async processGenericStageJob(
    data: MigrationJobData
  ): Promise<MigrationJobResult> {
    const rowCount = data.rows?.length ?? 0;
    const nextCheckpoint = `${data.jobType}_completed`;

    await this.recoveryService.getCheckpointStore().saveCheckpoint({
      batchId: data.batchId,
      lastCommittedRow: rowCount,
      lastCommittedChunk: 1,
      status: 'loading',
      checkpointName: nextCheckpoint,
      updatedAt: new Date(),
    });

    return {
      jobId: data.jobId,
      batchId: data.batchId,
      jobType: data.jobType,
      success: true,
      processedRows: rowCount,
      checkpoint: nextCheckpoint,
      status: 'loading',
    };
  }
}
