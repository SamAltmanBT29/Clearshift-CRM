import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import {
  writeOutboxEvent,
  OutboxRepository,
  type OutboxRecord,
} from '../src/outbox/index.js';
import { createEventEnvelope } from '@clearshift/contracts/events';

class MockPgClient {
  public records = new Map<string, OutboxRecord>();
  public consumed = new Set<string>();
  public rolledBack = false;

  async query(text: string, params: any[] = []): Promise<any> {
    const q = text.trim().toUpperCase();

    if (q.startsWith('INSERT INTO PLATFORM.OUTBOX')) {
      const [eventId, eventType, payloadJson] = params;
      const rec: OutboxRecord = {
        id: randomUUID(),
        eventId,
        eventType,
        payload: typeof payloadJson === 'string' ? JSON.parse(payloadJson) : payloadJson,
        publishedAt: null,
        createdAt: new Date(),
        retryCount: 0,
        lastError: null,
      };
      this.records.set(eventId, rec);
      return { rows: [rec], rowCount: 1 };
    }

    if (q.startsWith('UPDATE PLATFORM.OUTBOX') && q.includes('SET PUBLISHED_AT = $1')) {
      const [publishedAt, eventId] = params;
      const rec = this.records.get(eventId);
      if (rec) {
        rec.publishedAt = publishedAt;
        rec.lastError = null;
      }
      return { rows: [], rowCount: rec ? 1 : 0 };
    }

    if (q.startsWith('UPDATE PLATFORM.OUTBOX') && q.includes('RETRY_COUNT = RETRY_COUNT + 1')) {
      const [errorMsg, eventId] = params;
      const rec = this.records.get(eventId);
      if (rec) {
        rec.retryCount++;
        rec.lastError = errorMsg;
      }
      return { rows: [], rowCount: rec ? 1 : 0 };
    }

    if (q.startsWith('SELECT') && q.includes('WHERE PUBLISHED_AT IS NULL')) {
      const maxRetries = params[0] ?? 5;
      const limit = params[1] ?? 50;
      const rows = Array.from(this.records.values())
        .filter((r) => r.publishedAt === null && r.retryCount < maxRetries)
        .slice(0, limit);
      return { rows, rowCount: rows.length };
    }

    if (q.startsWith('DELETE FROM PLATFORM.OUTBOX')) {
      const cutoff = params[0];
      let deleted = 0;
      for (const [id, rec] of Array.from(this.records.entries())) {
        if (rec.publishedAt !== null && rec.publishedAt < cutoff) {
          this.records.delete(id);
          deleted++;
        }
      }
      return { rows: [], rowCount: deleted };
    }

    if (q.startsWith('SELECT 1 FROM PLATFORM.CONSUMED_EVENTS')) {
      const [consumer, eventId] = params;
      const key = `${consumer}:${eventId}`;
      return { rows: this.consumed.has(key) ? [{ ok: 1 }] : [], rowCount: this.consumed.has(key) ? 1 : 0 };
    }

    if (q.startsWith('INSERT INTO PLATFORM.CONSUMED_EVENTS')) {
      const [consumer, eventId] = params;
      this.consumed.add(`${consumer}:${eventId}`);
      return { rows: [], rowCount: 1 };
    }

    if (q.startsWith('SELECT') && q.includes('COUNT(*) FILTER')) {
      let unpublished = 0;
      let published = 0;
      let failed = 0;
      for (const rec of this.records.values()) {
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

describe('[PLT-09] Database Transactional Outbox Unit Tests', () => {
  it('has a valid platform_outbox_v1.sql migration defining outbox and consumed_events tables', () => {
    const migrationPath = resolve(__dirname, '../migrations/platform_outbox_v1.sql');
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS platform;');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS platform.outbox');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS platform.consumed_events');
    expect(sql).toContain('idx_platform_outbox_unpublished');
    expect(sql).toContain('idx_platform_outbox_retention');
  });

  it('atomically writes a valid event envelope to the outbox table within a transaction', async () => {
    const client = new MockPgClient();
    const event = createEventEnvelope({
      eventType: 'crm.contact.created',
      aggregateType: 'Contact',
      aggregateId: randomUUID(),
      payload: { contactId: randomUUID(), email: 'alex@example.com' },
    });

    const record = await writeOutboxEvent(client, event);

    expect(record.eventId).toBe(event.id);
    expect(record.eventType).toBe('crm.contact.created');
    expect(record.publishedAt).toBeNull();
    expect(record.retryCount).toBe(0);
    expect(client.records.size).toBe(1);
  });

  it('rejects an invalid event envelope that violates the EventEnvelopeSchema', async () => {
    const client = new MockPgClient();
    const invalidEnvelope: any = {
      id: 'not-a-uuid',
      eventType: '',
      payload: {},
    };

    await expect(writeOutboxEvent(client, invalidEnvelope)).rejects.toThrow();
    expect(client.records.size).toBe(0);
  });

  it('marks outbox events as published upon successful relay', async () => {
    const client = new MockPgClient();
    const event = createEventEnvelope({
      eventType: 'crm.lead.created',
      aggregateType: 'Lead',
      aggregateId: randomUUID(),
      payload: { leadId: randomUUID() },
    });

    await writeOutboxEvent(client, event);
    const publishDate = new Date();
    await OutboxRepository.markPublished(client, event.id, publishDate);

    const record = client.records.get(event.id);
    expect(record?.publishedAt).toEqual(publishDate);
    expect(record?.lastError).toBeNull();
  });

  it('tracks publication failures and increments retry count', async () => {
    const client = new MockPgClient();
    const event = createEventEnvelope({
      eventType: 'crm.company.created',
      aggregateType: 'Company',
      aggregateId: randomUUID(),
      payload: { companyId: randomUUID() },
    });

    await writeOutboxEvent(client, event);
    await OutboxRepository.recordFailure(client, event.id, 'Redis timeout');

    const record = client.records.get(event.id);
    expect(record?.retryCount).toBe(1);
    expect(record?.lastError).toBe('Redis timeout');
    expect(record?.publishedAt).toBeNull();
  });

  describe('30-Day Retention Purge Invariants', () => {
    it('purges ONLY published events older than 30 days and never deletes unpublished events', async () => {
      const client = new MockPgClient();
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;

      // Event 1: Published 45 days ago (should be PURGED)
      const oldPublishedId = randomUUID();
      client.records.set(oldPublishedId, {
        id: randomUUID(),
        eventId: oldPublishedId,
        eventType: 'crm.contact.created',
        payload: {},
        publishedAt: new Date(now - 45 * dayMs),
        createdAt: new Date(now - 45 * dayMs),
        retryCount: 0,
        lastError: null,
      });

      // Event 2: Published 10 days ago (MUST BE RETAINED - within 30-day window)
      const recentPublishedId = randomUUID();
      client.records.set(recentPublishedId, {
        id: randomUUID(),
        eventId: recentPublishedId,
        eventType: 'crm.contact.created',
        payload: {},
        publishedAt: new Date(now - 10 * dayMs),
        createdAt: new Date(now - 10 * dayMs),
        retryCount: 0,
        lastError: null,
      });

      // Event 3: Created 60 days ago but UNPUBLISHED (MUST NEVER BE PURGED!)
      const oldUnpublishedId = randomUUID();
      client.records.set(oldUnpublishedId, {
        id: randomUUID(),
        eventId: oldUnpublishedId,
        eventType: 'crm.contact.created',
        payload: {},
        publishedAt: null,
        createdAt: new Date(now - 60 * dayMs),
        retryCount: 2,
        lastError: 'network partition',
      });

      // Execute 30-day retention purge
      const purged = await OutboxRepository.purgeExpired(client, 30);

      expect(purged).toBe(1);
      expect(client.records.has(oldPublishedId)).toBe(false); // Deleted
      expect(client.records.has(recentPublishedId)).toBe(true); // Retained (< 30 days)
      expect(client.records.has(oldUnpublishedId)).toBe(true); // Retained (unpublished)
    });
  });

  describe('Deduplication Tracking', () => {
    it('records and checks consumer deduplication status', async () => {
      const client = new MockPgClient();
      const eventId = randomUUID();
      const consumer = 'crm5-projector';

      expect(await OutboxRepository.isEventConsumed(client, consumer, eventId)).toBe(false);

      await OutboxRepository.recordConsumed(client, consumer, eventId);

      expect(await OutboxRepository.isEventConsumed(client, consumer, eventId)).toBe(true);
    });
  });
});
