import {
  REDIS_PINNED_VERSION,
  DEFAULT_BULLMQ_CONCURRENCY,
  BULLMQ_DEFAULT_ATTEMPTS,
  BULLMQ_BACKOFF_BASE_MS,
  BULLMQ_BACKOFF_MAX_MS,
  BULLMQ_JOB_TIMEOUT_MS,
  type BullMQJobOptions,
} from '@clearshift/contracts';

/**
 * Standard Redis connection options pinning baseline 8.10.1
 */
export interface RedisConnectionConfig {
  host: string;
  port: number;
  password?: string;
  tls?: boolean;
  maxRetriesPerRequest: null; // Required by BullMQ
  enableReadyCheck: boolean;
  pinnedVersion: string;
}

/**
 * Pinned BullMQ Queue Name for ClearShift Migration Kit
 */
export const BULLMQ_MIGRATION_QUEUE_NAME = 'kit-migration-pipeline';

/**
 * Creates canonical BullMQ Redis connection configuration.
 */
export function getRedisConfig(
  redisUrl: string = process.env['REDIS_URL'] || 'redis://localhost:6379'
): RedisConnectionConfig {
  const url = new URL(redisUrl);
  return {
    host: url.hostname || 'localhost',
    port: parseInt(url.port || '6379', 10),
    ...(url.password ? { password: url.password } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    pinnedVersion: REDIS_PINNED_VERSION,
  };
}

/**
 * Default BullMQ job options conforming to Decision KIT-11:
 * - 3 attempts max
 * - Exponential backoff base 1s, capped at 30s
 * - Per-job timeout 15 minutes
 * - Concurrency 4
 */
export const DEFAULT_BULLMQ_JOB_OPTIONS: BullMQJobOptions = {
  attempts: BULLMQ_DEFAULT_ATTEMPTS,
  backoff: {
    type: 'exponential',
    delay: BULLMQ_BACKOFF_BASE_MS,
    maxDelay: BULLMQ_BACKOFF_MAX_MS,
  },
  timeout: BULLMQ_JOB_TIMEOUT_MS,
  concurrency: DEFAULT_BULLMQ_CONCURRENCY,
  removeOnComplete: 1000,
  removeOnFail: false, // Keep failed jobs for diagnostic evidence
};

/**
 * Computes exponential backoff delay capped at 30 seconds
 */
export function computeBackoffDelay(
  attempt: number,
  baseMs: number = BULLMQ_BACKOFF_BASE_MS,
  maxMs: number = BULLMQ_BACKOFF_MAX_MS
): number {
  if (attempt <= 1) return baseMs;
  const calculated = baseMs * Math.pow(2, attempt - 1);
  return Math.min(calculated, maxMs);
}
