import type { EventEnvelope } from '@clearshift/contracts/events';

export interface StreamMessage {
  id: string;
  fields: Record<string, string>;
}

export interface EventDeduplicator {
  isEventConsumed(db: any, consumer: string, eventId: string): Promise<boolean>;
  recordConsumed(db: any, consumer: string, eventId: string): Promise<void>;
}

export class SqlEventDeduplicator implements EventDeduplicator {
  async isEventConsumed(db: any, consumer: string, eventId: string): Promise<boolean> {
    if (db && typeof db.query === 'function') {
      const res = await db.query(
        `SELECT 1 FROM platform.consumed_events WHERE consumer = $1 AND event_id = $2 LIMIT 1`,
        [consumer, eventId]
      );
      return (res.rowCount ?? 0) > 0;
    }
    return false;
  }

  async recordConsumed(db: any, consumer: string, eventId: string): Promise<void> {
    if (db && typeof db.query === 'function') {
      await db.query(
        `INSERT INTO platform.consumed_events (consumer, event_id, consumed_at)
         VALUES ($1, $2, now())
         ON CONFLICT (consumer, event_id) DO NOTHING`,
        [consumer, eventId]
      );
    }
  }
}

export interface IdempotentConsumerConfig {
  streamName: string;
  groupName: string;
  consumerName: string;
  maxRetries?: number;
  minIdleTimeMs?: number;
  deduplicator?: EventDeduplicator;
}

export interface ConsumerProcessResult {
  status: 'processed' | 'duplicate_skipped' | 'failed';
  eventId: string;
  messageId: string;
  error?: string;
}

export interface ConsumerLagInfo {
  stream: string;
  group: string;
  pendingCount: number;
  minPendingId?: string | null;
  maxPendingId?: string | null;
}

/**
 * Base class for idempotent Redis Streams event consumers.
 *
 * Implements reliable consumer-group processing with:
 * - At-least-once delivery tolerance via database-level deduplication
 * - Durable transaction boundaries (mutations + deduplication record commit together)
 * - Acknowledgement (XACK) only AFTER successful database commit
 * - Abandoned message recovery (XAUTOCLAIM / PEL recovery)
 */
export abstract class IdempotentEventConsumer<
  TPayload extends Record<string, unknown> = Record<string, unknown>
> {
  public readonly streamName: string;
  public readonly groupName: string;
  public readonly consumerName: string;
  public readonly maxRetries: number;
  public readonly minIdleTimeMs: number;
  protected readonly deduplicator: EventDeduplicator;

  constructor(
    protected readonly db: any,
    protected readonly redis: any,
    config: IdempotentConsumerConfig
  ) {
    this.streamName = config.streamName;
    this.groupName = config.groupName;
    this.consumerName = config.consumerName;
    this.maxRetries = config.maxRetries ?? 3;
    this.minIdleTimeMs = config.minIdleTimeMs ?? 30000;
    this.deduplicator = config.deduplicator ?? new SqlEventDeduplicator();
  }

  /**
   * Initializes the consumer group in Redis Streams if it does not already exist.
   */
  async initGroup(): Promise<void> {
    if (this.redis.xgroup) {
      try {
        await this.redis.xgroup(
          'CREATE',
          this.streamName,
          this.groupName,
          '$',
          'MKSTREAM'
        );
      } catch (err: any) {
        // BUSYGROUP Consumer Group name already exists - safe to proceed
        if (!err.message?.includes('BUSYGROUP')) {
          throw err;
        }
      }
    }
  }

  /**
   * Subclasses implement this method to perform business logic within the provided database transaction.
   */
  abstract handleEvent(envelope: EventEnvelope<TPayload>, tx: any): Promise<void>;

  /**
   * Processes a single stream message with deduplication and transactional boundaries.
   */
  async processMessage(message: StreamMessage): Promise<ConsumerProcessResult> {
    const rawPayload = message.fields['payload'];
    if (!rawPayload) {
      // Malformed message; acknowledge and drop safely
      if (this.redis.xack) {
        await this.redis.xack(this.streamName, this.groupName, message.id);
      }
      return {
        status: 'failed',
        eventId: 'unknown',
        messageId: message.id,
        error: 'Missing payload in stream message',
      };
    }

    let envelope: EventEnvelope<TPayload>;
    try {
      envelope = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
    } catch {
      return {
        status: 'failed',
        eventId: 'unknown',
        messageId: message.id,
        error: 'Invalid JSON payload in stream message',
      };
    }

    const eventId = envelope.id ?? message.fields['event_id'];
    if (!eventId) {
      return {
        status: 'failed',
        eventId: 'unknown',
        messageId: message.id,
        error: 'Missing event ID in envelope',
      };
    }

    // 1. Check for duplicate processing against platform.consumed_events
    const alreadyConsumed = await this.deduplicator.isEventConsumed(
      this.db,
      this.groupName,
      eventId
    );

    if (alreadyConsumed) {
      // Duplicate delivery detected: safe skip, acknowledge immediately in Redis
      if (this.redis.xack) {
        await this.redis.xack(this.streamName, this.groupName, message.id);
      }
      return {
        status: 'duplicate_skipped',
        eventId,
        messageId: message.id,
      };
    }

    // 2. Execute business handler and record consumption atomically in DB transaction
    try {
      if (this.db && typeof this.db.transaction === 'function') {
        await this.db.transaction(async (tx: any) => {
          await this.handleEvent(envelope, tx);
          await this.deduplicator.recordConsumed(tx, this.groupName, eventId);
        });
      } else if (this.db && typeof this.db.query === 'function') {
        await this.db.query('BEGIN');
        try {
          await this.handleEvent(envelope, this.db);
          await this.deduplicator.recordConsumed(this.db, this.groupName, eventId);
          await this.db.query('COMMIT');
        } catch (txErr) {
          await this.db.query('ROLLBACK');
          throw txErr;
        }
      } else {
        // Direct execution fallback (e.g. mock DB in tests)
        await this.handleEvent(envelope, this.db);
        await this.deduplicator.recordConsumed(this.db, this.groupName, eventId);
      }

      // 3. Acknowledge in Redis ONLY after database transaction commits successfully
      if (this.redis.xack) {
        await this.redis.xack(this.streamName, this.groupName, message.id);
      }

      return {
        status: 'processed',
        eventId,
        messageId: message.id,
      };
    } catch (err: any) {
      // On failure, message is NOT acknowledged; remains in Redis PEL for recovery
      return {
        status: 'failed',
        eventId,
        messageId: message.id,
        error: err?.message ?? String(err),
      };
    }
  }

  /**
   * Consumes a batch of new messages from Redis Streams.
   */
  async consumeBatch(batchSize: number = 10, blockMs: number = 1000): Promise<ConsumerProcessResult[]> {
    if (!this.redis.xreadgroup) return [];

    const raw = await this.redis.xreadgroup(
      this.groupName,
      this.consumerName,
      this.streamName,
      '>',
      batchSize,
      blockMs
    );

    const messages = this.parseStreamResponse(raw);
    const results: ConsumerProcessResult[] = [];

    for (const msg of messages) {
      const res = await this.processMessage(msg);
      results.push(res);
    }

    return results;
  }

  /**
   * Reclaims abandoned messages from consumers that crashed before acknowledging.
   * Uses XAUTOCLAIM or XPENDING/XCLAIM to reassign and re-process pending messages.
   */
  async recoverPending(
    minIdleTimeMs?: number,
    batchSize: number = 10
  ): Promise<ConsumerProcessResult[]> {
    const idleTime = minIdleTimeMs ?? this.minIdleTimeMs;
    const results: ConsumerProcessResult[] = [];

    // Attempt XAUTOCLAIM (supported on Redis 6.2+)
    if (this.redis.xautoclaim) {
      try {
        const claimResult = await this.redis.xautoclaim(
          this.streamName,
          this.groupName,
          this.consumerName,
          idleTime,
          '0-0',
          batchSize
        );

        const claimedMessages = this.parseClaimResult(claimResult);
        for (const msg of claimedMessages) {
          const res = await this.processMessage(msg);
          results.push(res);
        }
        return results;
      } catch (claimErr) {
        // Fall back to XPENDING if XAUTOCLAIM is not available
      }
    }

    // Fallback: XPENDING + processing
    if (this.redis.xpending) {
      try {
        const pending = await this.redis.xpending(
          this.streamName,
          this.groupName,
          '-',
          '+',
          batchSize
        );
        const entries = Array.isArray(pending) ? pending : [];
        for (const entry of entries) {
          // If entry was idle longer than threshold
          const idle = entry.idleMs ?? entry[2] ?? 0;
          const msgId = entry.id ?? entry[0];
          if (idle >= idleTime && msgId) {
            // Read and process the pending message
            const raw = await this.redis.xreadgroup?.(
              this.groupName,
              this.consumerName,
              this.streamName,
              '0',
              1
            );
            const msgs = this.parseStreamResponse(raw).filter((m) => m.id === msgId);
            for (const msg of msgs) {
              const res = await this.processMessage(msg);
              results.push(res);
            }
          }
        }
      } catch {
        // Handled silently
      }
    }

    return results;
  }

  /**
   * Inspects consumer group lag and pending messages count.
   */
  async getLag(): Promise<ConsumerLagInfo> {
    let pendingCount = 0;
    let minPendingId: string | null = null;
    let maxPendingId: string | null = null;

    if (this.redis.xpending) {
      try {
        const info = await this.redis.xpending(this.streamName, this.groupName);
        if (typeof info === 'object' && info !== null) {
          pendingCount = info.count ?? (Array.isArray(info) ? info.length : 0);
          minPendingId = info.minId ?? null;
          maxPendingId = info.maxId ?? null;
        }
      } catch {
        // Group might not exist yet
      }
    }

    return {
      stream: this.streamName,
      group: this.groupName,
      pendingCount,
      minPendingId,
      maxPendingId,
    };
  }

  private parseStreamResponse(raw: any): StreamMessage[] {
    if (!raw) return [];
    const messages: StreamMessage[] = [];

    // Support both nested Redis array [ [stream, [ [id, [k, v, ...]] ] ] ]
    // and simplified mock format [ { id, fields } ]
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (item && item.id && item.fields) {
          messages.push(item);
        } else if (Array.isArray(item) && item.length === 2 && Array.isArray(item[1])) {
          for (const msg of item[1]) {
            if (Array.isArray(msg) && msg.length === 2) {
              const id = msg[0];
              const fieldArr = msg[1];
              const fields: Record<string, string> = {};
              if (Array.isArray(fieldArr)) {
                for (let i = 0; i < fieldArr.length; i += 2) {
                  fields[fieldArr[i]] = fieldArr[i + 1];
                }
              }
              messages.push({ id, fields });
            }
          }
        }
      }
    }

    return messages;
  }

  private parseClaimResult(claimResult: any): StreamMessage[] {
    if (!claimResult) return [];
    if (Array.isArray(claimResult)) {
      const list = Array.isArray(claimResult[1]) ? claimResult[1] : claimResult;
      const messages: StreamMessage[] = [];
      for (const item of list) {
        if (item && item.id && item.fields) {
          messages.push(item);
        } else if (Array.isArray(item) && item.length === 2) {
          const id = item[0];
          const fieldArr = item[1];
          const fields: Record<string, string> = {};
          if (Array.isArray(fieldArr)) {
            for (let i = 0; i < fieldArr.length; i += 2) {
              fields[fieldArr[i]] = fieldArr[i + 1];
            }
          }
          messages.push({ id, fields });
        }
      }
      return messages;
    }
    return [];
  }
}

/**
 * In-memory Redis Streams client for testing, offline execution, and self-contained environments.
 * Faithfully mimics XADD, XREADGROUP, XGROUP, XACK, XAUTOCLAIM, XPENDING, XLEN, XTRIM.
 */
export class InMemoryRedisStreamClient {
  private streams = new Map<string, StreamMessage[]>();
  private groups = new Map<
    string,
    {
      lastDeliveredIndex: number;
      pel: Map<string, { consumer: string; deliveryTime: number; deliveryCount: number }>;
    }
  >();
  private seq = 0;

  private getGroupKey(stream: string, group: string): string {
    return `${stream}:${group}`;
  }

  async xadd(stream: string, id: string, ...args: (string | number)[]): Promise<string> {
    const streamList = this.streams.get(stream) ?? [];
    const entryId = id === '*' ? `${Date.now()}-${this.seq++}` : id;

    const fields: Record<string, string> = {};
    for (let i = 0; i < args.length; i += 2) {
      fields[String(args[i])] = String(args[i + 1]);
    }

    streamList.push({ id: entryId, fields });
    this.streams.set(stream, streamList);
    return entryId;
  }

  async xgroup(
    command: string,
    stream: string,
    group: string,
    idOrMkstream?: string,
    mkstream?: string
  ): Promise<string> {
    const key = this.getGroupKey(stream, group);
    if (command === 'CREATE') {
      if (this.groups.has(key)) {
        throw new Error('BUSYGROUP Consumer Group name already exists');
      }
      if (!this.streams.has(stream) && (mkstream === 'MKSTREAM' || idOrMkstream === 'MKSTREAM')) {
        this.streams.set(stream, []);
      }
      this.groups.set(key, {
        lastDeliveredIndex: idOrMkstream === '$' ? (this.streams.get(stream)?.length ?? 0) - 1 : -1,
        pel: new Map(),
      });
      return 'OK';
    }
    return 'OK';
  }

  async xreadgroup(
    group: string,
    consumer: string,
    stream: string,
    id: string,
    count: number = 10
  ): Promise<StreamMessage[]> {
    const streamList = this.streams.get(stream) ?? [];
    const groupState = this.groups.get(this.getGroupKey(stream, group));
    if (!groupState) return [];

    const delivered: StreamMessage[] = [];

    if (id === '>') {
      // Read new messages after last delivered
      const startIndex = groupState.lastDeliveredIndex + 1;
      const slice = streamList.slice(startIndex, startIndex + count);
      for (const msg of slice) {
        delivered.push(msg);
        groupState.pel.set(msg.id, {
          consumer,
          deliveryTime: Date.now(),
          deliveryCount: 1,
        });
      }
      groupState.lastDeliveredIndex += slice.length;
    } else {
      // Read history from PEL
      for (const [msgId] of groupState.pel.entries()) {
        const found = streamList.find((m) => m.id === msgId);
        if (found) delivered.push(found);
        if (delivered.length >= count) break;
      }
    }

    return delivered;
  }

  async xack(stream: string, group: string, ...ids: string[]): Promise<number> {
    const groupState = this.groups.get(this.getGroupKey(stream, group));
    if (!groupState) return 0;

    let acked = 0;
    for (const id of ids) {
      if (groupState.pel.delete(id)) {
        acked++;
      }
    }
    return acked;
  }

  async xautoclaim(
    stream: string,
    group: string,
    consumer: string,
    minIdleTime: number,
    start: string = '0-0',
    count: number = 10
  ): Promise<any> {
    const groupState = this.groups.get(this.getGroupKey(stream, group));
    const streamList = this.streams.get(stream) ?? [];
    if (!groupState) return ['0-0', []];

    const now = Date.now();
    const claimed: StreamMessage[] = [];

    for (const [msgId, entry] of groupState.pel.entries()) {
      if (now - entry.deliveryTime >= minIdleTime) {
        entry.consumer = consumer;
        entry.deliveryTime = now;
        entry.deliveryCount += 1;

        const msg = streamList.find((m) => m.id === msgId);
        if (msg) claimed.push(msg);

        if (claimed.length >= count) break;
      }
    }

    return ['0-0', claimed];
  }

  async xpending(stream: string, group: string): Promise<any> {
    const groupState = this.groups.get(this.getGroupKey(stream, group));
    if (!groupState) return { count: 0, minId: null, maxId: null };

    const ids = Array.from(groupState.pel.keys()).sort();
    return {
      count: ids.length,
      minId: ids[0] ?? null,
      maxId: ids[ids.length - 1] ?? null,
    };
  }

  async xlen(stream: string): Promise<number> {
    return this.streams.get(stream)?.length ?? 0;
  }

  async xtrim(stream: string, strategy: string, threshold: string | number): Promise<number> {
    const streamList = this.streams.get(stream);
    if (!streamList) return 0;

    const initialLen = streamList.length;
    let filtered: StreamMessage[];

    if (strategy === 'MINID') {
      const minIdStr = String(threshold);
      filtered = streamList.filter((m) => m.id >= minIdStr);
    } else {
      const maxLen = Number(threshold);
      filtered = streamList.slice(-maxLen);
    }

    this.streams.set(stream, filtered);
    return initialLen - filtered.length;
  }

  // Test helpers to inspect internal state
  getRawStream(stream: string): StreamMessage[] {
    return this.streams.get(stream) ?? [];
  }

  getPEL(stream: string, group: string): Map<string, { consumer: string; deliveryTime: number; deliveryCount: number }> {
    return this.groups.get(this.getGroupKey(stream, group))?.pel ?? new Map();
  }

  simulateConsumerCrash(stream: string, group: string, idleMsAgo: number = 60000): void {
    const pel = this.getPEL(stream, group);
    for (const entry of pel.values()) {
      entry.deliveryTime = Date.now() - idleMsAgo;
    }
  }

  clearStream(stream: string): void {
    this.streams.set(stream, []);
  }
}
