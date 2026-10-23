import type { EventEnvelope } from '@clearshift/contracts/events';

export interface OutboxRecord {
  id: string;
  eventId: string;
  eventType: string;
  payload: EventEnvelope | Record<string, unknown>;
  publishedAt: Date | null;
  createdAt: Date;
  retryCount: number;
  lastError: string | null;
}

export interface ClaimUnpublishedOptions {
  /** Maximum number of records to claim in a batch (default: 50) */
  limit?: number;
  /** Maximum retry attempts before considering permanently failed (default: 5) */
  maxRetries?: number;
}

export interface ReplayFilter {
  /** Include records created or published on/after this date */
  since?: Date;
  /** Include records created or published on/before this date */
  until?: Date;
  /** Optional filter by specific event type */
  eventType?: string;
  /** Maximum records to fetch (default: 1000) */
  limit?: number;
}

export interface OutboxStats {
  unpublishedCount: number;
  publishedCount: number;
  failedCount: number;
}

export interface ConsumedEventRecord {
  consumer: string;
  eventId: string;
  consumedAt: Date;
}
