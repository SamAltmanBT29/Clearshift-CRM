import type {
  KitBatchStatus,
  MigrationJobType,
  BullMQJobOptions,
  WorkerCheckpoint,
} from '@clearshift/contracts';

/**
 * BullMQ Job payload for migration pipeline stages
 */
export interface MigrationJobData {
  jobId: string;
  batchId: string;
  jobType: MigrationJobType;
  module: string;
  entity: string;
  chunkIndex?: number;
  startRow?: number;
  endRow?: number;
  checkpoint?: string;
  attempt?: number;
  rows?: Array<{ sourceRow: number; data: Record<string, unknown>; skipped?: boolean }>;
  metadata?: Record<string, unknown>;
}

/**
 * BullMQ Job Result
 */
export interface MigrationJobResult {
  jobId: string;
  batchId: string;
  jobType: MigrationJobType;
  success: boolean;
  processedRows: number;
  checkpoint: string;
  status: KitBatchStatus;
  error?: string;
}

/**
 * Checkpoint storage interface backed by PostgreSQL in production
 */
export interface ICheckpointStore {
  saveCheckpoint(checkpoint: WorkerCheckpoint): Promise<void>;
  getCheckpoint(batchId: string): Promise<WorkerCheckpoint | null>;
  clear(batchId?: string): Promise<void>;
}

/**
 * Chunk execution telemetry
 */
export interface ChunkExecutionMetrics {
  chunkIndex: number;
  startRow: number;
  endRow: number;
  attemptedRows: number;
  loadedRows: number;
  rejectedRows: number;
  mergedRows: number;
  skippedRows: number;
  errorRate: number;
  halted: boolean;
  haltReason?: string;
}

/**
 * Injected crash hook for failure resilience testing
 */
export type CrashInjectionHook = (
  stage: MigrationJobType,
  chunkIndex: number,
  rowNumber: number
) => void | Promise<void>;
