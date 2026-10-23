import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import {
  writeOutboxEvent,
  OutboxRepository,
  type OutboxRecord,
} from '@cs/db';
import { createEventEnvelope, type EventEnvelope } from '@clearshift/contracts/events';
import { OutboxRelay } from '../../src/events/relay.js';
import {
  IdempotentEventConsumer,
  InMemoryRedisStreamClient,
} from '@cs/core';

/**
 * In-memory PostgreSQL database mock simulating platform.outbox and platform.consumed_events
 * with transaction support (BEGIN, COMMIT, ROLLBACK).
 */
class InMemoryDatabaseHarness {
  public outboxRecords: Map<string, OutboxRecord> = new Map();
  public consumedRecords: Set<string> = new Set();
  private inTransaction = false;
  private transactionOutboxSnapshot: Map<string, OutboxRecord> | null = null;
  private transactionConsumedSnapshot: Set<string> | null = null;

  async query(sqlText: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
    const trimmed = sqlText.trim().toUpperCase();

    if (trimmed.startsWith('BEGIN')) {
      this.inTransaction = true;
      this.transactionOutboxSnapshot = new Map(this.outboxRecords);
      this.transactionConsumedSnapshot = new Set(this.consumedRecords);
      return { rows: [], rowCount: 0 };
    }

    if (trimmed.startsWith('COMMIT')) {
      this.inTransaction = false;
      this.transactionOutboxSnapshot = null;
      this.transactionConsumedSnapshot = null;
      return { rows: [], rowCount: 0 };
    }

    if (trimmed.startsWith('ROLLBACK')) {
      if (this.transactionOutboxSnapshot) {
        this.outboxRecords = this.transactionOutboxSnapshot;
      }
      if (this.transactionConsumedSnapshot) {
        this.consumedRecords = this.transactionConsumedSnapshot;
      }
      this.inTransaction = false;
      this.transactionOutboxSnapshot = null;
      this.transactionConsumedSnapshot = null;
      return { rows: [], rowCount: 0 };
    }

    if (trimmed.includes('INSERT INTO PLATFORM.OUTBOX')) {
      const [eventId, eventType, payloadJson] = params;
      const record: any = {
        id: randomUUID(),
        eventId,
        event_id: eventId,
        eventType,
        event_type: eventType,
        payload: typeof payloadJson === 'string' ? JSON.parse(payloadJson) : payloadJson,
        publishedAt: null,
        published_at: null,
        createdAt: new Date(),
        created_at: new Date(),
        retryCount: 0,
        retry_count: 0,
        lastError: null,
        last_error: null,
      };
      this.outboxRecords.set(eventId, record);
      return { rows: [record], rowCount: 1 };
    }

    if (trimmed.includes('UPDATE PLATFORM.OUTBOX') && trimmed.includes('SET PUBLISHED_AT = $1')) {
      const [publishedAt, eventId] = params;
      const rec: any = this.outboxRecords.get(eventId);
      if (rec) {
        rec.publishedAt = publishedAt;
        rec.published_at = publishedAt;
        rec.lastError = null;
        rec.last_error = null;
      }
      return { rows: [], rowCount: rec ? 1 : 0 };
    }

    if (trimmed.includes('UPDATE PLATFORM.OUTBOX') && trimmed.includes('SET RETRY_COUNT = RETRY_COUNT + 1')) {
      const [errorMsg, eventId] = params;
      const rec: any = this.outboxRecords.get(eventId);
      if (rec) {
        rec.retryCount = (rec.retryCount ?? 0) + 1;
        rec.retry_count = rec.retryCount;
        rec.lastError = errorMsg;
        rec.last_error = errorMsg;
      }
      return { rows: [], rowCount: rec ? 1 : 0 };
    }

    if (trimmed.includes('SELECT') && trimmed.includes('FROM PLATFORM.OUTBOX')) {
      if (trimmed.includes('WHERE PUBLISHED_AT IS NULL')) {
        const maxRetries = params[0] ?? 5;
        const limit = params[1] ?? 50;
        const rows = Array.from(this.outboxRecords.values())
          .filter((r) => r.publishedAt === null && r.retryCount < maxRetries)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(0, limit);
        return { rows, rowCount: rows.length };
      } else {
        const limit = params[params.length - 1] ?? 1000;
        const rows = Array.from(this.outboxRecords.values())
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(0, limit);
        return { rows, rowCount: rows.length };
      }
    }

    if (trimmed.includes('SELECT 1 FROM PLATFORM.CONSUMED_EVENTS')) {
      const [consumer, eventId] = params;
      const key = `${consumer}:${eventId}`;
      const exists = this.consumedRecords.has(key);
      return { rows: exists ? [{ exists: 1 }] : [], rowCount: exists ? 1 : 0 };
    }

    if (trimmed.includes('INSERT INTO PLATFORM.CONSUMED_EVENTS')) {
      const [consumer, eventId] = params;
      const key = `${consumer}:${eventId}`;
      this.consumedRecords.add(key);
      return { rows: [], rowCount: 1 };
    }

    if (trimmed.includes('DELETE FROM PLATFORM.OUTBOX')) {
      const cutoff = params[0];
      let deleted = 0;
      for (const [id, rec] of Array.from(this.outboxRecords.entries())) {
        if (rec.publishedAt !== null && rec.publishedAt < cutoff) {
          this.outboxRecords.delete(id);
          deleted++;
        }
      }
      return { rows: [], rowCount: deleted };
    }

    if (trimmed.includes('SELECT') && trimmed.includes('COUNT(*) FILTER')) {
      let unpublished = 0;
      let published = 0;
      let failed = 0;
      for (const rec of this.outboxRecords.values()) {
        if (rec.publishedAt === null && rec.retryCount < 5) unpublished++;
        else if (rec.publishedAt !== null) published++;
        else if (rec.publishedAt === null && rec.retryCount >= 5) failed++;
      }
      return {
        rows: [{ unpublished, published, failed }],
        rowCount: 1,
      };
    }

    return { rows: [], rowCount: 0 };
  }
}

/**
 * Concrete test implementation of IdempotentEventConsumer tracking side effects.
 */
class TestLeadProjectorConsumer extends IdempotentEventConsumer {
  public executedSideEffects: string[] = [];
  public failNextEvent = false;

  async handleEvent(envelope: EventEnvelope, _tx: any): Promise<void> {
    if (this.failNextEvent) {
      throw new Error('Simulated transient business processing error');
    }
    this.executedSideEffects.push(envelope.id);
  }
}

describe('[PLT-09] Transactional Outbox, Redis Streams Relay & Consumer Recovery', () => {
  let db: InMemoryDatabaseHarness;
  let redis: InMemoryRedisStreamClient;
  let relay: OutboxRelay;
  let consumer: TestLeadProjectorConsumer;

  const STREAM_NAME = 'clearshift:events';
  const GROUP_NAME = 'crm-lead-projector';

  beforeEach(async () => {
    db = new InMemoryDatabaseHarness();
    redis = new InMemoryRedisStreamClient();

    relay = new OutboxRelay(db, redis, {
      streamName: STREAM_NAME,
      batchSize: 10,
      maxRetries: 3,
    });

    consumer = new TestLeadProjectorConsumer(db, redis, {
      streamName: STREAM_NAME,
      groupName: GROUP_NAME,
      consumerName: 'worker-node-1',
    });

    await consumer.initGroup();
  });

  describe('Acceptance Criterion 1: Crash after DB commit but before publish is recovered from outbox', () => {
    it('ensures committed outbox events are preserved and relayed after a simulated publish crash', async () => {
      const event = createEventEnvelope({
        eventType: 'crm.lead.created',
        aggregateType: 'Lead',
        aggregateId: randomUUID(),
        producer: 'crm-1',
        payload: { leadId: randomUUID(), status: 'new' },
      });

      // 1. Transaction commits business mutation + outbox event atomically
      await db.query('BEGIN');
      await writeOutboxEvent(db, event);
      await db.query('COMMIT');

      // Verify event is in DB outbox but NOT published yet
      const record = db.outboxRecords.get(event.id);
      expect(record).toBeDefined();
      expect(record?.publishedAt).toBeNull();
      expect(record?.retryCount).toBe(0);

      // 2. Simulate application crash / Redis unavailable on first relay attempt
      const brokenRedis = {
        xadd: async () => {
          throw new Error('ECONNREFUSED: Redis instance temporarily down');
        },
      };
      const failingRelay = new OutboxRelay(db, brokenRedis as any, { streamName: STREAM_NAME });
      const failResult = await failingRelay.relayOnce();

      expect(failResult.failed).toBe(1);
      expect(failResult.published).toBe(0);

      // Invariant: Event must NOT be lost; still in outbox with incremented retry count
      const retryingRecord = db.outboxRecords.get(event.id);
      expect(retryingRecord?.publishedAt).toBeNull();
      expect(retryingRecord?.retryCount).toBe(1);
      expect(retryingRecord?.lastError).toContain('ECONNREFUSED');

      // 3. Process recovers and healthy relay runs
      const successResult = await relay.relayOnce();
      expect(successResult.published).toBe(1);
      expect(successResult.failed).toBe(0);

      // Outbox row is now marked as published
      const publishedRecord = db.outboxRecords.get(event.id);
      expect(publishedRecord?.publishedAt).not.toBeNull();
      expect(publishedRecord?.lastError).toBeNull();

      // Message exists in Redis Stream
      const streamEntries = redis.getRawStream(STREAM_NAME);
      expect(streamEntries.length).toBe(1);
      expect(streamEntries[0]?.fields['event_id']).toBe(event.id);
    });
  });

  describe('Acceptance Criterion 2: Duplicate event delivery does not duplicate side effects', () => {
    it('executes side effect exactly once even when the same event is delivered multiple times', async () => {
      const event = createEventEnvelope({
        eventType: 'crm.contact.created',
        aggregateType: 'Contact',
        aggregateId: randomUUID(),
        producer: 'crm-1',
        payload: { contactId: randomUUID(), firstName: 'Jane', lastName: 'Doe' },
      });

      // Insert and relay event
      await writeOutboxEvent(db, event);
      await relay.relayOnce();

      // Delivery 1: Consumer reads and processes message
      const batch1 = await consumer.consumeBatch(10);
      expect(batch1.length).toBe(1);
      expect(batch1[0]?.status).toBe('processed');
      expect(consumer.executedSideEffects).toEqual([event.id]);

      // Verify consumed_events record was stored
      const isRecorded = await OutboxRepository.isEventConsumed(db, GROUP_NAME, event.id);
      expect(isRecorded).toBe(true);

      // Delivery 2: Simulate redelivery of the exact same message (e.g. from network retry)
      const streamMsg = redis.getRawStream(STREAM_NAME)[0]!;
      const duplicateResult = await consumer.processMessage(streamMsg);

      // Invariant: Duplicate must be skipped without executing side effect
      expect(duplicateResult.status).toBe('duplicate_skipped');
      expect(consumer.executedSideEffects).toHaveLength(1); // Still exactly 1!
    });
  });

  describe('Acceptance Criterion 3: Pending consumer messages are reclaimed and only acknowledged after success', () => {
    it('reclaims abandoned pending messages via PEL recovery and acknowledges only after success', async () => {
      const event = createEventEnvelope({
        eventType: 'crm.company.created',
        aggregateType: 'Company',
        aggregateId: randomUUID(),
        producer: 'crm-1',
        payload: { companyId: randomUUID(), name: 'Acme Corp' },
      });

      await writeOutboxEvent(db, event);
      await relay.relayOnce();

      // 1. Initial read by Worker A with simulated crash before acknowledgment
      consumer.failNextEvent = true;
      const initialBatch = await consumer.consumeBatch(10);
      expect(initialBatch[0]?.status).toBe('failed');

      // The message remains pending in Redis PEL
      const lagBeforeRecovery = await consumer.getLag();
      expect(lagBeforeRecovery.pendingCount).toBe(1);
      expect(consumer.executedSideEffects).toHaveLength(0);

      // 2. Worker B reclaims abandoned messages after idle timeout
      redis.simulateConsumerCrash(STREAM_NAME, GROUP_NAME, 45000); // 45s idle
      consumer.failNextEvent = false; // Worker B is healthy

      const recoveryBatch = await consumer.recoverPending(30000);
      expect(recoveryBatch.length).toBe(1);
      expect(recoveryBatch[0]?.status).toBe('processed');

      // Invariant: Side effect executed, and message was acknowledged (PEL now empty)
      expect(consumer.executedSideEffects).toEqual([event.id]);
      const lagAfterRecovery = await consumer.getLag();
      expect(lagAfterRecovery.pendingCount).toBe(0);
    });
  });

  describe('Acceptance Criterion 4: Redis rebuild replays retained outbox events with original IDs', () => {
    it('restores Redis streams from retained PostgreSQL outbox records without mutating original event IDs', async () => {
      const event1 = createEventEnvelope({
        eventType: 'crm.lead.status_changed',
        aggregateType: 'Lead',
        aggregateId: randomUUID(),
        payload: { leadId: randomUUID(), status: 'qualified' },
      });
      const event2 = createEventEnvelope({
        eventType: 'crm.lead.status_changed',
        aggregateType: 'Lead',
        aggregateId: randomUUID(),
        payload: { leadId: randomUUID(), status: 'won' },
      });

      // Write and publish both events
      await writeOutboxEvent(db, event1);
      await writeOutboxEvent(db, event2);
      await relay.relayOnce();

      // Consumer consumes event 1
      const initialConsume = await consumer.consumeBatch(1);
      expect(initialConsume[0]?.eventId).toBe(event1.id);

      // Catastrophic Redis data loss simulation (stream destroyed)
      redis.clearStream(STREAM_NAME);
      expect(await redis.xlen(STREAM_NAME)).toBe(0);

      // Replay command runs from PostgreSQL outbox
      const replayResult = await relay.replay();
      expect(replayResult.replayedCount).toBe(2);
      expect(replayResult.eventIds).toContain(event1.id);
      expect(replayResult.eventIds).toContain(event2.id);

      // Re-read stream messages
      const replayedStream = redis.getRawStream(STREAM_NAME);
      expect(replayedStream.length).toBe(2);
      expect(replayedStream[0]?.fields['event_id']).toBe(event1.id);
      expect(replayedStream[1]?.fields['event_id']).toBe(event2.id);

      // Consumer processes replayed stream: event1 is skipped as duplicate, event2 is processed!
      const replayedProcess1 = await consumer.processMessage(replayedStream[0]!);
      const replayedProcess2 = await consumer.processMessage(replayedStream[1]!);

      expect(replayedProcess1.status).toBe('duplicate_skipped');
      expect(replayedProcess2.status).toBe('processed');
      expect(consumer.executedSideEffects).toEqual([event1.id, event2.id]);
    });
  });

  describe('Acceptance Criterion 5: Consumer lag/pending counts are visible; retention does not trim pending items', () => {
    it('reports consumer lag and enforces invariant that pending entries are never trimmed', async () => {
      const event = createEventEnvelope({
        eventType: 'crm.lead.created',
        aggregateType: 'Lead',
        aggregateId: randomUUID(),
        payload: { leadId: randomUUID() },
      });

      await writeOutboxEvent(db, event);
      await relay.relayOnce();

      // Read message so it enters the PEL as pending
      consumer.failNextEvent = true;
      await consumer.consumeBatch(1);

      // Verify lag visibility
      const lag = await consumer.getLag();
      expect(lag.pendingCount).toBe(1);
      expect(lag.stream).toBe(STREAM_NAME);
      expect(lag.group).toBe(GROUP_NAME);

      // Attempt safe stream trimming while message is pending in consumer group
      const trimResult = await relay.trimSafely([GROUP_NAME], 30);

      // Invariant: Never trim pending messages!
      expect(trimResult.trimmedCount).toBe(0);
      expect(await redis.xlen(STREAM_NAME)).toBe(1);

      // Acknowledge the message (simulating resolution)
      consumer.failNextEvent = false;
      const streamMsg = redis.getRawStream(STREAM_NAME)[0]!;
      await consumer.processMessage(streamMsg);

      const lagAfterAck = await consumer.getLag();
      expect(lagAfterAck.pendingCount).toBe(0);
    });
  });
});
