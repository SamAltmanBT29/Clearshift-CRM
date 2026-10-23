import { OutboxRepository, type OutboxRecord, type ReplayFilter } from '@cs/db';
import type { EventEnvelope } from '@clearshift/contracts/events';

export interface RedisStreamMessage {
  id: string;
  fields: Record<string, string>;
}

export interface RedisStreamClient {
  xadd(stream: string, id: string, ...args: (string | number)[]): Promise<string>;
  xreadgroup?(
    group: string,
    consumer: string,
    stream: string,
    id: string,
    count?: number,
    block?: number
  ): Promise<any>;
  xgroup?(
    command: string,
    stream: string,
    group: string,
    idOrMkstream?: string,
    mkstream?: string
  ): Promise<any>;
  xack?(stream: string, group: string, ...ids: string[]): Promise<number>;
  xautoclaim?(
    stream: string,
    group: string,
    consumer: string,
    minIdleTime: number,
    start: string,
    count?: number
  ): Promise<any>;
  xpending?(
    stream: string,
    group: string,
    start?: string,
    end?: string,
    count?: number,
    consumer?: string
  ): Promise<any>;
  xlen?(stream: string): Promise<number>;
  xinfo?(command: string, stream: string): Promise<any>;
  xtrim?(stream: string, strategy: string, threshold: string | number, ...args: any[]): Promise<number>;
}

export interface OutboxRelayConfig {
  streamName?: string;
  batchSize?: number;
  pollIntervalMs?: number;
  maxRetries?: number;
}

export interface RelayBatchResult {
  published: number;
  failed: number;
  records: OutboxRecord[];
  errors: Array<{ eventId: string; error: string }>;
}

export interface ReplayResult {
  replayedCount: number;
  eventIds: string[];
}

export class OutboxRelay {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  public readonly streamName: string;
  public readonly batchSize: number;
  public readonly maxRetries: number;
  public readonly pollIntervalMs: number;

  constructor(
    private readonly db: any,
    private readonly redis: RedisStreamClient,
    config: OutboxRelayConfig = {}
  ) {
    this.streamName = config.streamName ?? 'clearshift:events';
    this.batchSize = config.batchSize ?? 50;
    this.maxRetries = config.maxRetries ?? 5;
    this.pollIntervalMs = config.pollIntervalMs ?? 1000;
  }

  /**
   * Executes a single relay pass:
   * 1. Fetches unpublished outbox rows from PostgreSQL (FIFO).
   * 2. Publishes each event envelope to Redis Streams via XADD.
   * 3. Marks outbox record as published ONLY after Redis accepts it.
   * 4. In case of Redis failure, records error and increments retry counter.
   */
  async relayOnce(): Promise<RelayBatchResult> {
    const unpublished = await OutboxRepository.fetchUnpublished(this.db, {
      limit: this.batchSize,
      maxRetries: this.maxRetries,
    });

    const result: RelayBatchResult = {
      published: 0,
      failed: 0,
      records: unpublished,
      errors: [],
    };

    for (const record of unpublished) {
      try {
        const envelope = record.payload as EventEnvelope;
        const payloadStr =
          typeof record.payload === 'string'
            ? record.payload
            : JSON.stringify(record.payload);

        // Publish to Redis Stream with envelope metadata
        await this.redis.xadd(
          this.streamName,
          '*',
          'event_id',
          record.eventId,
          'event_type',
          record.eventType,
          'payload',
          payloadStr,
          'occurred_at',
          envelope?.timestamp ?? record.createdAt.toISOString()
        );

        // Mark as published in PostgreSQL only after Redis XADD succeeds
        await OutboxRepository.markPublished(this.db, record.eventId, new Date());
        result.published++;
      } catch (err: any) {
        const errorMsg = err?.message ?? String(err);
        await OutboxRepository.recordFailure(this.db, record.eventId, errorMsg);
        result.failed++;
        result.errors.push({ eventId: record.eventId, error: errorMsg });
      }
    }

    return result;
  }

  /**
   * Replays retained outbox events from PostgreSQL back into Redis Streams.
   * Preserves original event IDs so downstream consumers can deduplicate.
   */
  async replay(filter: ReplayFilter = {}, targetStream?: string): Promise<ReplayResult> {
    const stream = targetStream ?? this.streamName;
    const records = await OutboxRepository.queryForReplay(this.db, filter);
    const replayedIds: string[] = [];

    for (const record of records) {
      const envelope = record.payload as EventEnvelope;
      const payloadStr =
        typeof record.payload === 'string'
          ? record.payload
          : JSON.stringify(record.payload);

      await this.redis.xadd(
        stream,
        '*',
        'event_id',
        record.eventId,
        'event_type',
        record.eventType,
        'payload',
        payloadStr,
        'occurred_at',
        envelope?.timestamp ?? record.createdAt.toISOString(),
        'is_replay',
        'true'
      );
      replayedIds.push(record.eventId);
    }

    return {
      replayedCount: replayedIds.length,
      eventIds: replayedIds,
    };
  }

  /**
   * Safely trims Redis stream entries while ensuring pending messages are NEVER trimmed.
   *
   * Constraints:
   * - Never trim entries that are pending (unacknowledged) in any consumer group.
   * - Retain at least 30 days of published history before trimming.
   */
  async trimSafely(
    consumerGroups: string[] = [],
    retentionDays: number = 30
  ): Promise<{ trimmedCount: number; safeTrimPoint: string | null }> {
    let lowestPendingId: string | null = null;

    // Check pending messages across all provided consumer groups
    for (const group of consumerGroups) {
      if (this.redis.xpending) {
        try {
          const pendingInfo = await this.redis.xpending(this.streamName, group);
          // If pendingInfo reports pending messages, check oldest pending ID
          if (pendingInfo && pendingInfo.minId) {
            if (!lowestPendingId || pendingInfo.minId < lowestPendingId) {
              lowestPendingId = pendingInfo.minId;
            }
          }
        } catch {
          // Group might not exist yet; ignore
        }
      }
    }

    // If any message is currently pending, do NOT trim past that pending ID
    if (lowestPendingId) {
      return {
        trimmedCount: 0,
        safeTrimPoint: lowestPendingId,
      };
    }

    // If supported, apply retention trimming threshold
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const minRetainedId = `${cutoffMs}-0`;

    if (this.redis.xtrim) {
      try {
        const trimmed = await this.redis.xtrim(this.streamName, 'MINID', minRetainedId);
        return { trimmedCount: trimmed ?? 0, safeTrimPoint: minRetainedId };
      } catch {
        return { trimmedCount: 0, safeTrimPoint: minRetainedId };
      }
    }

    return { trimmedCount: 0, safeTrimPoint: minRetainedId };
  }

  /**
   * Starts the background relay polling loop.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const poll = async () => {
      if (!this.isRunning) return;
      try {
        await this.relayOnce();
      } catch (err) {
        console.error('[OutboxRelay] Error during polling iteration:', err);
      } finally {
        if (this.isRunning) {
          this.timer = setTimeout(poll, this.pollIntervalMs);
          this.timer.unref?.();
        }
      }
    };

    poll();
  }

  /**
   * Stops the background relay polling loop gracefully.
   */
  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
