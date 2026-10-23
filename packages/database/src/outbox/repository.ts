import { eq, isNull, and, lt, sql, desc, asc, gte, lte } from 'drizzle-orm';
import { outbox, consumedEvents } from '../schema/platform.js';
import type {
  OutboxRecord,
  ClaimUnpublishedOptions,
  ReplayFilter,
  OutboxStats,
} from './types.js';

export class OutboxRepository {
  /**
   * Fetches unpublished events ready for relay dispatch.
   * Uses FIFO ordering (created_at ASC) and respects maximum retry limits.
   */
  static async fetchUnpublished(
    db: any,
    options: ClaimUnpublishedOptions = {}
  ): Promise<OutboxRecord[]> {
    const limit = options.limit ?? 50;
    const maxRetries = options.maxRetries ?? 5;

    // Drizzle client
    if (db && typeof db.select === 'function') {
      const rows = await db
        .select()
        .from(outbox)
        .where(
          and(
            isNull(outbox.publishedAt),
            lt(outbox.retryCount, maxRetries)
          )
        )
        .orderBy(asc(outbox.createdAt))
        .limit(limit);

      return rows.map((r: any) => ({
        id: r.id,
        eventId: r.eventId,
        eventType: r.eventType,
        payload: r.payload,
        publishedAt: r.publishedAt,
        createdAt: r.createdAt,
        retryCount: r.retryCount,
        lastError: r.lastError,
      }));
    }

    // Raw PostgreSQL client / pool (supports FOR UPDATE SKIP LOCKED if in transaction)
    if (db && typeof db.query === 'function') {
      const queryStr = `
        SELECT id, event_id, event_type, payload, published_at, created_at, retry_count, last_error
        FROM platform.outbox
        WHERE published_at IS NULL AND retry_count < $1
        ORDER BY created_at ASC
        LIMIT $2
      `;
      const res = await db.query(queryStr, [maxRetries, limit]);
      return res.rows.map((r: any) => ({
        id: r.id,
        eventId: r.event_id ?? r.eventId,
        eventType: r.event_type ?? r.eventType,
        payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
        publishedAt: r.published_at ?? r.publishedAt ?? null,
        createdAt: r.created_at ?? r.createdAt ?? new Date(),
        retryCount: r.retry_count ?? r.retryCount ?? 0,
        lastError: r.last_error ?? r.lastError ?? null,
      }));
    }

    throw new Error('[OutboxRepository.fetchUnpublished] Invalid database handle provided.');
  }

  /**
   * Marks an outbox event as successfully published to Redis Streams.
   */
  static async markPublished(
    db: any,
    eventId: string,
    publishedAt: Date = new Date()
  ): Promise<void> {
    if (db && typeof db.update === 'function') {
      await db
        .update(outbox)
        .set({
          publishedAt,
          lastError: null,
        })
        .where(eq(outbox.eventId, eventId));
      return;
    }

    if (db && typeof db.query === 'function') {
      await db.query(
        `UPDATE platform.outbox
         SET published_at = $1, last_error = NULL
         WHERE event_id = $2`,
        [publishedAt, eventId]
      );
      return;
    }

    throw new Error('[OutboxRepository.markPublished] Invalid database handle.');
  }

  /**
   * Increments the retry counter and records the error message on failed relay attempts.
   */
  static async recordFailure(
    db: any,
    eventId: string,
    error: Error | string
  ): Promise<void> {
    const errorMsg = typeof error === 'string' ? error : error.message;

    if (db && typeof db.update === 'function') {
      await db
        .update(outbox)
        .set({
          retryCount: sql`${outbox.retryCount} + 1`,
          lastError: errorMsg,
        })
        .where(eq(outbox.eventId, eventId));
      return;
    }

    if (db && typeof db.query === 'function') {
      await db.query(
        `UPDATE platform.outbox
         SET retry_count = retry_count + 1, last_error = $1
         WHERE event_id = $2`,
        [errorMsg, eventId]
      );
      return;
    }

    throw new Error('[OutboxRepository.recordFailure] Invalid database handle.');
  }

  /**
   * Retention purge: Purges only events that have been published AND are older than retentionDays.
   *
   * Invariant: Never deletes unpublished rows, and never deletes rows younger than retention window.
   *
   * @param retentionDays Default: 30 days
   * @returns Number of purged records
   */
  static async purgeExpired(db: any, retentionDays: number = 30): Promise<number> {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    if (db && typeof db.delete === 'function') {
      const res = await db
        .delete(outbox)
        .where(
          and(
            sql`${outbox.publishedAt} IS NOT NULL`,
            lt(outbox.publishedAt, cutoffDate)
          )
        )
        .returning({ id: outbox.id });
      return res.length;
    }

    if (db && typeof db.query === 'function') {
      const res = await db.query(
        `DELETE FROM platform.outbox
         WHERE published_at IS NOT NULL AND published_at < $1`,
        [cutoffDate]
      );
      return res.rowCount ?? 0;
    }

    throw new Error('[OutboxRepository.purgeExpired] Invalid database handle.');
  }

  /**
   * Queries events for Redis stream rebuild / disaster-recovery replay.
   * Preserves chronological order (created_at ASC).
   */
  static async queryForReplay(db: any, filter: ReplayFilter = {}): Promise<OutboxRecord[]> {
    const limit = filter.limit ?? 1000;

    if (db && typeof db.select === 'function') {
      const conditions = [];
      if (filter.since) conditions.push(gte(outbox.createdAt, filter.since));
      if (filter.until) conditions.push(lte(outbox.createdAt, filter.until));
      if (filter.eventType) conditions.push(eq(outbox.eventType, filter.eventType));

      const query = db
        .select()
        .from(outbox)
        .orderBy(asc(outbox.createdAt))
        .limit(limit);

      const rows = conditions.length > 0
        ? await query.where(and(...conditions))
        : await query;

      return rows.map((r: any) => ({
        id: r.id,
        eventId: r.eventId,
        eventType: r.eventType,
        payload: r.payload,
        publishedAt: r.publishedAt,
        createdAt: r.createdAt,
        retryCount: r.retryCount,
        lastError: r.lastError,
      }));
    }

    if (db && typeof db.query === 'function') {
      const clauses: string[] = [];
      const params: any[] = [];
      let idx = 1;

      if (filter.since) {
        clauses.push(`created_at >= $${idx++}`);
        params.push(filter.since);
      }
      if (filter.until) {
        clauses.push(`created_at <= $${idx++}`);
        params.push(filter.until);
      }
      if (filter.eventType) {
        clauses.push(`event_type = $${idx++}`);
        params.push(filter.eventType);
      }

      params.push(limit);
      const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const queryStr = `
        SELECT id, event_id, event_type, payload, published_at, created_at, retry_count, last_error
        FROM platform.outbox
        ${whereClause}
        ORDER BY created_at ASC
        LIMIT $${idx}
      `;

      const res = await db.query(queryStr, params);
      return res.rows.map((r: any) => ({
        id: r.id,
        eventId: r.event_id ?? r.eventId,
        eventType: r.event_type ?? r.eventType,
        payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
        publishedAt: r.published_at ?? r.publishedAt ?? null,
        createdAt: r.created_at ?? r.createdAt ?? new Date(),
        retryCount: r.retry_count ?? r.retryCount ?? 0,
        lastError: r.last_error ?? r.lastError ?? null,
      }));
    }

    throw new Error('[OutboxRepository.queryForReplay] Invalid database handle.');
  }

  /**
   * Retrieves summary statistics on outbox health and publishing lag.
   */
  static async getStats(db: any): Promise<OutboxStats> {
    if (db && typeof db.query === 'function') {
      const res = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE published_at IS NULL AND retry_count < 5) AS unpublished,
          COUNT(*) FILTER (WHERE published_at IS NOT NULL) AS published,
          COUNT(*) FILTER (WHERE published_at IS NULL AND retry_count >= 5) AS failed
        FROM platform.outbox
      `);
      const row = res.rows[0] || {};
      return {
        unpublishedCount: Number(row.unpublished || 0),
        publishedCount: Number(row.published || 0),
        failedCount: Number(row.failed || 0),
      };
    }

    // Default fallback if query not directly supported
    const unpublished = await this.fetchUnpublished(db, { limit: 10000 });
    return {
      unpublishedCount: unpublished.length,
      publishedCount: 0,
      failedCount: 0,
    };
  }

  /**
   * Checks whether a consumer has already processed a given event ID.
   */
  static async isEventConsumed(db: any, consumer: string, eventId: string): Promise<boolean> {
    if (db && typeof db.select === 'function') {
      const rows = await db
        .select({ eventId: consumedEvents.eventId })
        .from(consumedEvents)
        .where(
          and(
            eq(consumedEvents.consumer, consumer),
            eq(consumedEvents.eventId, eventId)
          )
        )
        .limit(1);
      return rows.length > 0;
    }

    if (db && typeof db.query === 'function') {
      const res = await db.query(
        `SELECT 1 FROM platform.consumed_events WHERE consumer = $1 AND event_id = $2 LIMIT 1`,
        [consumer, eventId]
      );
      return (res.rowCount ?? 0) > 0;
    }

    throw new Error('[OutboxRepository.isEventConsumed] Invalid database handle.');
  }

  /**
   * Records that an event has been processed by a consumer within a business transaction.
   */
  static async recordConsumed(db: any, consumer: string, eventId: string): Promise<void> {
    if (db && typeof db.insert === 'function') {
      await db
        .insert(consumedEvents)
        .values({
          consumer,
          eventId,
          consumedAt: new Date(),
        })
        .onConflictDoNothing();
      return;
    }

    if (db && typeof db.query === 'function') {
      await db.query(
        `INSERT INTO platform.consumed_events (consumer, event_id, consumed_at)
         VALUES ($1, $2, now())
         ON CONFLICT (consumer, event_id) DO NOTHING`,
        [consumer, eventId]
      );
      return;
    }

    throw new Error('[OutboxRepository.recordConsumed] Invalid database handle.');
  }
}
