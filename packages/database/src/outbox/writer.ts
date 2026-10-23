import { EventEnvelopeSchema, type EventEnvelope } from '@clearshift/contracts/events';
import { outbox } from '../schema/platform.js';
import type { OutboxRecord } from './types.js';

/**
 * Writes an event to the transactional outbox table within an existing database transaction.
 *
 * Ensures business data mutations and their corresponding outbox events are committed
 * atomically in PostgreSQL (dual-write prevention).
 *
 * @param tx - Active Drizzle transaction or PostgreSQL client
 * @param envelope - Validated event envelope conforming to EventEnvelopeSchema
 * @returns The created OutboxRecord
 */
export async function writeOutboxEvent<T extends Record<string, unknown> = Record<string, unknown>>(
  tx: any,
  envelope: EventEnvelope<T>
): Promise<OutboxRecord> {
  // Validate envelope strictly against the ClearShift contract
  EventEnvelopeSchema.parse(envelope);

  // If using Drizzle ORM transaction
  if (tx && typeof tx.insert === 'function') {
    const [row] = await tx
      .insert(outbox)
      .values({
        eventId: envelope.id,
        eventType: envelope.eventType,
        payload: envelope,
        publishedAt: null,
        retryCount: 0,
        lastError: null,
      })
      .returning();

    return {
      id: row.id,
      eventId: row.eventId,
      eventType: row.eventType,
      payload: row.payload as EventEnvelope<T>,
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
      retryCount: row.retryCount,
      lastError: row.lastError,
    };
  }

  // If using raw PostgreSQL client/pool
  if (tx && typeof tx.query === 'function') {
    const res = await tx.query(
      `INSERT INTO platform.outbox (event_id, event_type, payload, published_at, retry_count, last_error)
       VALUES ($1, $2, $3, NULL, 0, NULL)
       RETURNING id, event_id, event_type, payload, published_at, created_at, retry_count, last_error`,
      [envelope.id, envelope.eventType, JSON.stringify(envelope)]
    );
    const row = res.rows[0];
    return {
      id: row.id,
      eventId: row.event_id ?? row.eventId,
      eventType: row.event_type ?? row.eventType,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      publishedAt: row.published_at ?? row.publishedAt ?? null,
      createdAt: row.created_at ?? row.createdAt ?? new Date(),
      retryCount: row.retry_count ?? row.retryCount ?? 0,
      lastError: row.last_error ?? row.lastError ?? null,
    };
  }

  throw new Error('[writeOutboxEvent] Invalid database transaction handle provided.');
}
