import {
  type EventEnvelope,
  type KitBatchExtractedPayload,
  type KitBatchProfiledPayload,
  type KitBatchCleanedPayload,
  type KitBatchMappedPayload,
  type KitBatchLoadedPayload,
  type KitBatchValidatedPayload,
  type KitBatchFailedPayload,
  type KitContactMergedPayload,
  createBatchExtractedEnvelope,
  createBatchProfiledEnvelope,
  createBatchCleanedEnvelope,
  createBatchMappedEnvelope,
  createBatchLoadedEnvelope,
  createBatchValidatedEnvelope,
  createBatchFailedEnvelope,
  createContactMergedEnvelope,
  assertNoSecretsOrRawRows,
} from '@clearshift/contracts';
import { writeOutboxEvent, type OutboxRecord } from '@clearshift/database';
import type { IOutboxWriter } from './types.js';

/**
 * Default writer implementation bridging to PostgreSQL outbox table via packages/database
 */
class DefaultDatabaseOutboxWriter implements IOutboxWriter {
  public async writeEvent<T extends Record<string, unknown> = Record<string, unknown>>(
    tx: unknown,
    envelope: EventEnvelope<T>
  ): Promise<OutboxRecord> {
    return writeOutboxEvent(tx, envelope);
  }
}

/**
 * Migration Kit Transactional Outbox Producer (KIT-13)
 *
 * Guarantees:
 * 1. Atomicity: For each state change, DB mutation and outbox envelope commit together in PostgreSQL.
 * 2. Confidentiality: Strictly enforces zero raw rows and zero credentials/secrets in payloads.
 * 3. Structured Envelopes: Conforms to enterprise EventEnvelope schema (PLT-04 & PLT-09).
 */
export class MigrationOutboxProducer {
  constructor(private writer: IOutboxWriter = new DefaultDatabaseOutboxWriter()) {}

  /**
   * Generic emission method with strict confidentiality verification.
   */
  public async emitEnvelope<T extends Record<string, unknown>>(
    tx: unknown,
    envelope: EventEnvelope<T>
  ): Promise<OutboxRecord> {
    assertNoSecretsOrRawRows(envelope.payload);
    return this.writer.writeEvent(tx, envelope);
  }

  /**
   * Step 1: batch.extracted
   */
  public async emitBatchExtracted(
    tx: unknown,
    payload: KitBatchExtractedPayload,
    options?: { correlationId?: string; causationId?: string }
  ): Promise<OutboxRecord> {
    const envelope = createBatchExtractedEnvelope(payload, options);
    return this.emitEnvelope(tx, envelope);
  }

  /**
   * Step 2: batch.profiled
   */
  public async emitBatchProfiled(
    tx: unknown,
    payload: KitBatchProfiledPayload,
    options?: { correlationId?: string; causationId?: string }
  ): Promise<OutboxRecord> {
    const envelope = createBatchProfiledEnvelope(payload, options);
    return this.emitEnvelope(tx, envelope);
  }

  /**
   * Step 3: batch.cleaned
   */
  public async emitBatchCleaned(
    tx: unknown,
    payload: KitBatchCleanedPayload,
    options?: { correlationId?: string; causationId?: string }
  ): Promise<OutboxRecord> {
    const envelope = createBatchCleanedEnvelope(payload, options);
    return this.emitEnvelope(tx, envelope);
  }

  /**
   * Step 4: batch.mapped
   */
  public async emitBatchMapped(
    tx: unknown,
    payload: KitBatchMappedPayload,
    options?: { correlationId?: string; causationId?: string }
  ): Promise<OutboxRecord> {
    const envelope = createBatchMappedEnvelope(payload, options);
    return this.emitEnvelope(tx, envelope);
  }

  /**
   * Step 5: batch.loaded
   */
  public async emitBatchLoaded(
    tx: unknown,
    payload: KitBatchLoadedPayload,
    options?: { correlationId?: string; causationId?: string }
  ): Promise<OutboxRecord> {
    const envelope = createBatchLoadedEnvelope(payload, options);
    return this.emitEnvelope(tx, envelope);
  }

  /**
   * Step 6: batch.validated
   */
  public async emitBatchValidated(
    tx: unknown,
    payload: KitBatchValidatedPayload,
    options?: { correlationId?: string; causationId?: string }
  ): Promise<OutboxRecord> {
    const envelope = createBatchValidatedEnvelope(payload, options);
    return this.emitEnvelope(tx, envelope);
  }

  /**
   * Hard failure emission: batch.failed
   */
  public async emitBatchFailed(
    tx: unknown,
    payload: KitBatchFailedPayload,
    options?: { correlationId?: string; causationId?: string }
  ): Promise<OutboxRecord> {
    const envelope = createBatchFailedEnvelope(payload, options);
    return this.emitEnvelope(tx, envelope);
  }

  /**
   * Deduplication merge event: contact.merged
   */
  public async emitContactMerged(
    tx: unknown,
    payload: KitContactMergedPayload,
    options?: { correlationId?: string; causationId?: string }
  ): Promise<OutboxRecord> {
    const envelope = createContactMergedEnvelope(payload, options);
    return this.emitEnvelope(tx, envelope);
  }
}
