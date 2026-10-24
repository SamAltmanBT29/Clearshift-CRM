import { describe, it, expect, beforeEach } from 'vitest';
import {
  MigrationKitEventTypes,
  SecretsOrRawRowsForbiddenError,
  assertNoSecretsOrRawRows,
  type KitBatchExtractedPayload,
  type KitBatchProfiledPayload,
  type KitBatchCleanedPayload,
  type KitBatchMappedPayload,
  type KitBatchLoadedPayload,
  type KitBatchValidatedPayload,
  type KitBatchFailedPayload,
  type KitContactMergedPayload,
} from '@clearshift/contracts';
import {
  MigrationOutboxProducer,
  Crm5EventProjector,
  InMemoryOutboxWriter,
  InMemoryConsumedEventsStore,
  InMemoryCrm5ProjectionStore,
} from '../../src/events/index.js';

describe('KIT-13: Transactional Event Envelope, Outbox Producer & CRM-5 Projections', () => {
  let outboxWriter: InMemoryOutboxWriter;
  let producer: MigrationOutboxProducer;
  let consumedEvents: InMemoryConsumedEventsStore;
  let projectionStore: InMemoryCrm5ProjectionStore;
  let projector: Crm5EventProjector;

  const batchId = 'batch-kit13-test-001';
  const correlationId = 'corr-kit13-test-001';

  beforeEach(() => {
    outboxWriter = new InMemoryOutboxWriter();
    producer = new MigrationOutboxProducer(outboxWriter);
    consumedEvents = new InMemoryConsumedEventsStore();
    projectionStore = new InMemoryCrm5ProjectionStore();
    projector = new Crm5EventProjector(projectionStore, consumedEvents);
  });

  describe('1. Transactional Dual-Write Atomicity', () => {
    it('commits outbox record atomically when caller transaction commits', async () => {
      const mockTx = { txId: 'tx-001' };

      const payload: KitBatchExtractedPayload = {
        schema_version: 1,
        event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: batchId,
        module: 'crm-1',
        step: 'extract',
        counts: {
          source_count: 1000,
          raw_count: 1000,
        },
        references: {
          file_name: 'contacts_v1.csv',
          checksum_sha256: 'a1b2c3d4e5f6',
        },
      };

      await producer.emitBatchExtracted(mockTx, payload);

      // Staged in transaction, not yet visible globally
      expect(outboxWriter.getRecords()).toHaveLength(0);

      // Commit transaction
      outboxWriter.commitTx(mockTx);

      expect(outboxWriter.getRecords()).toHaveLength(1);
      const record = outboxWriter.getRecords()[0]!;
      expect(record.eventType).toBe('batch.extracted');
      expect(record.eventId).toBe(payload.event_id);
    });

    it('discards outbox record when caller transaction rolls back', async () => {
      const mockTx = { txId: 'tx-rollback-001' };

      const payload: KitBatchExtractedPayload = {
        schema_version: 1,
        event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: batchId,
        module: 'crm-1',
        step: 'extract',
        counts: {
          source_count: 500,
          raw_count: 500,
        },
      };

      await producer.emitBatchExtracted(mockTx, payload);

      // Rollback transaction
      outboxWriter.rollbackTx(mockTx);

      expect(outboxWriter.getRecords()).toHaveLength(0);
    });
  });

  describe('2. Confidentiality & Zero Raw Rows Guarantee', () => {
    it('throws SecretsOrRawRowsForbiddenError when payload contains raw row data or forbidden keys', () => {
      const invalidPayloadWithRawRows = {
        schema_version: 1,
        event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: batchId,
        module: 'crm-1',
        step: 'clean',
        counts: { input_rows: 10, clean_rows: 9, rejected_rows: 1 },
        raw_payload: { email: 'leak@clearshift.internal', password: 'plain' },
      };

      expect(() =>
        assertNoSecretsOrRawRows(invalidPayloadWithRawRows)
      ).toThrowError(SecretsOrRawRowsForbiddenError);
    });

    it('rejects payloads containing bearer tokens or secret credential strings in values', () => {
      const payloadWithSecretToken = {
        schema_version: 1,
        event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: batchId,
        module: 'crm-1',
        counts: { source_count: 100, raw_count: 100 },
        references: {
          authorizationHeader: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M',
        },
      };

      expect(() =>
        assertNoSecretsOrRawRows(payloadWithSecretToken)
      ).toThrowError(SecretsOrRawRowsForbiddenError);
    });

    it('allows valid payloads containing only counts and references', () => {
      const validPayload: KitBatchCleanedPayload = {
        schema_version: 1,
        event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: batchId,
        module: 'crm-1',
        step: 'clean',
        counts: {
          input_rows: 1000,
          clean_rows: 950,
          rejected_rows: 50,
        },
        references: {
          cleaning_rule_version: '1.0.0',
        },
      };

      expect(() => assertNoSecretsOrRawRows(validPayload)).not.toThrow();
    });
  });

  describe('3. Event Envelope Contracts for all 8 Migration Kit Events', () => {
    it('successfully publishes and validates all 8 event types in PostgreSQL outbox', async () => {
      // 1. batch.extracted
      const r1 = await producer.emitBatchExtracted(null, {
        schema_version: 1,
        event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: batchId,
        module: 'crm-1',
        step: 'extract',
        counts: { source_count: 1000, raw_count: 1000 },
      });
      expect(r1.eventType).toBe(MigrationKitEventTypes.BATCH_EXTRACTED);

      // 2. batch.profiled
      const r2 = await producer.emitBatchProfiled(null, {
        schema_version: 1,
        event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: batchId,
        module: 'crm-1',
        step: 'profile',
        counts: { total_rows: 1000, empty_fields_count: 12, duplicate_count: 5 },
        references: { completeness: 0.98, validity: 0.99, overall_score: 98.5 },
      });
      expect(r2.eventType).toBe(MigrationKitEventTypes.BATCH_PROFILED);

      // 3. batch.cleaned
      const r3 = await producer.emitBatchCleaned(null, {
        schema_version: 1,
        event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: batchId,
        module: 'crm-1',
        step: 'clean',
        counts: { input_rows: 1000, clean_rows: 950, rejected_rows: 50 },
      });
      expect(r3.eventType).toBe(MigrationKitEventTypes.BATCH_CLEANED);

      // 4. batch.mapped
      const r4 = await producer.emitBatchMapped(null, {
        schema_version: 1,
        event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: batchId,
        module: 'crm-1',
        step: 'map',
        counts: { mapped_rows: 950, unmapped_rows: 0 },
        references: { target_entity: 'contacts' },
      });
      expect(r4.eventType).toBe(MigrationKitEventTypes.BATCH_MAPPED);

      // 5. batch.loaded
      const r5 = await producer.emitBatchLoaded(null, {
        schema_version: 1,
        event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: batchId,
        module: 'crm-1',
        step: 'load',
        counts: {
          loaded_count: 940,
          rejected_count: 10,
          merged_count: 0,
          skipped_count: 0,
          unaccounted_count: 0,
        },
      });
      expect(r5.eventType).toBe(MigrationKitEventTypes.BATCH_LOADED);

      // 6. batch.validated
      const r6 = await producer.emitBatchValidated(null, {
        schema_version: 1,
        event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: batchId,
        module: 'crm-1',
        step: 'validate',
        counts: { total_validated: 940, passed_count: 940, failed_count: 0 },
        references: { status: 'OK' },
      });
      expect(r6.eventType).toBe(MigrationKitEventTypes.BATCH_VALIDATED);

      // 7. batch.failed
      const r7 = await producer.emitBatchFailed(null, {
        schema_version: 1,
        event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: 'batch-failed-001',
        module: 'crm-1',
        failed_step: 'load',
        error_code: 'TARGET_CIRCUIT_BREAKER_TRIPPED',
        error_message: 'Failure rate exceeded 10%',
      });
      expect(r7.eventType).toBe(MigrationKitEventTypes.BATCH_FAILED);

      // 8. contact.merged
      const r8 = await producer.emitContactMerged(null, {
        schema_version: 1,
        event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: batchId,
        golden_id: crypto.randomUUID(),
        survivor_id: 'cont-001',
        merged_record_ids: ['cont-002', 'cont-003'],
        counts: { total_merged: 2 },
        references: { merge_rule: 'EXACT_EMAIL_MATCH' },
      });
      expect(r8.eventType).toBe(MigrationKitEventTypes.CONTACT_MERGED);

      expect(outboxWriter.getRecords()).toHaveLength(8);
    });
  });

  describe('4. Idempotent Consumer Deduplication', () => {
    it('applies projection on first delivery and skips identical replay without side-effects', async () => {
      const eventId = crypto.randomUUID();
      const extractedPayload: KitBatchExtractedPayload = {
        schema_version: 1,
        event_id: eventId,
        occurred_at: new Date().toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: batchId,
        module: 'crm-1',
        step: 'extract',
        counts: { source_count: 1000, raw_count: 1000 },
      };

      const outboxRecord = await producer.emitBatchExtracted(null, extractedPayload);
      const envelope = outboxRecord.payload as any;

      // Delivery 1
      const res1 = await projector.projectEvent(envelope);
      expect(res1.applied).toBe(true);
      expect(res1.outcome).toBe('projected');

      // Check run projection exists
      const run1 = await projectionStore.getRun(batchId);
      expect(run1).toBeDefined();
      expect(run1?.recordsIn).toBe(1000);
      expect(run1?.recordsOut).toBe(1000);

      // Delivery 2 (Duplicate replay)
      const res2 = await projector.projectEvent(envelope);
      expect(res2.applied).toBe(false);
      expect(res2.outcome).toBe('skipped_duplicate');

      // Delivery 3 (Retry after crash)
      const res3 = await projector.projectEvent(envelope);
      expect(res3.applied).toBe(false);
      expect(res3.outcome).toBe('skipped_duplicate');

      // Projection data remains intact
      const runFinal = await projectionStore.getRun(batchId);
      expect(runFinal?.recordsIn).toBe(1000);
      expect(runFinal?.recordsOut).toBe(1000);
    });
  });

  describe('5. Out-of-Order Delivery Tolerance & Monotonicity', () => {
    it('tolerates out-of-order delivery: loaded arriving before profiled does not regress run step', async () => {
      const now = new Date();

      // 1. batch.loaded arrives first (network reordering / async lag)
      const loadedRecord = await producer.emitBatchLoaded(null, {
        schema_version: 1,
        event_id: crypto.randomUUID(),
        occurred_at: now.toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: batchId,
        module: 'crm-1',
        step: 'load',
        counts: {
          loaded_count: 980,
          rejected_count: 20,
          merged_count: 0,
          skipped_count: 0,
          unaccounted_count: 0,
        },
      });

      await projector.projectEvent(loadedRecord.payload as any);

      const runAfterLoad = await projectionStore.getRun(batchId);
      expect(runAfterLoad?.step).toBe('load');
      expect(runAfterLoad?.status).toBe('completed');
      expect(runAfterLoad?.recordsOut).toBe(980);

      // 2. batch.profiled arrives delayed
      const delayedProfileRecord = await producer.emitBatchProfiled(null, {
        schema_version: 1,
        event_id: crypto.randomUUID(),
        occurred_at: new Date(now.getTime() - 10000).toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: batchId,
        module: 'crm-1',
        step: 'profile',
        counts: { total_rows: 1000 },
        references: { completeness: 0.99, validity: 0.98, overall_score: 98.0 },
      });

      await projector.projectEvent(delayedProfileRecord.payload as any);

      // Crucial: Step must NOT regress back to 'profile', must remain 'load'
      const runAfterDelayed = await projectionStore.getRun(batchId);
      expect(runAfterDelayed?.step).toBe('load');
      expect(runAfterDelayed?.status).toBe('completed');

      // But quality score from profiling was still recorded safely
      const score = await projectionStore.getScore(batchId);
      expect(score).toBeDefined();
      expect(score?.score).toBe(98.0);
    });

    it('ensures hard failure status cannot be overwritten by delayed earlier step events', async () => {
      // 1. batch.failed arrives
      const failedRecord = await producer.emitBatchFailed(null, {
        schema_version: 1,
        event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: batchId,
        module: 'crm-1',
        failed_step: 'clean',
        error_code: 'STOP_THRESHOLD_EXCEEDED',
        error_message: 'Rejections exceeded 10%',
      });

      await projector.projectEvent(failedRecord.payload as any);

      const run = await projectionStore.getRun(batchId);
      expect(run?.status).toBe('failed');
      expect(run?.metadata).toEqual({
        errorCode: 'STOP_THRESHOLD_EXCEEDED',
        errorMessage: 'Rejections exceeded 10%',
        failedStep: 'clean',
      });

      // 2. Delayed earlier event batch.extracted arrives
      const delayedExtract = await producer.emitBatchExtracted(null, {
        schema_version: 1,
        event_id: crypto.randomUUID(),
        occurred_at: new Date(Date.now() - 5000).toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: batchId,
        module: 'crm-1',
        step: 'extract',
        counts: { source_count: 1000, raw_count: 1000 },
      });

      await projector.projectEvent(delayedExtract.payload as any);

      // Status must remain 'failed', never overwritten back to 'completed'
      const runAfter = await projectionStore.getRun(batchId);
      expect(runAfter?.status).toBe('failed');
    });
  });

  describe('6. CRM-5 Projections & Reconciliation Balance Sheet', () => {
    it('projects loaded and contact.merged into crm5_reconciliation_reports preserving row conservation', async () => {
      // 1. batch.loaded
      const loaded = await producer.emitBatchLoaded(null, {
        schema_version: 1,
        event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: batchId,
        module: 'crm-1',
        step: 'load',
        counts: {
          loaded_count: 900,
          rejected_count: 50,
          merged_count: 0,
          skipped_count: 50,
          unaccounted_count: 0,
        },
      });
      await projector.projectEvent(loaded.payload as any);

      const recon1 = await projectionStore.getReconciliation(batchId);
      expect(recon1?.sourceCount).toBe(1000);
      expect(recon1?.loadedCount).toBe(900);
      expect(recon1?.rejectedCount).toBe(50);
      expect(recon1?.mergedCount).toBe(0);
      expect(recon1?.skippedCount).toBe(50);
      expect(recon1?.status).toBe('OK');

      // 2. contact.merged arrives
      const merged = await producer.emitContactMerged(null, {
        schema_version: 1,
        event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        producer: 'migration-kit',
        correlation_id: correlationId,
        batch_id: batchId,
        golden_id: crypto.randomUUID(),
        survivor_id: 'survivor-1',
        merged_record_ids: ['dup-1', 'dup-2'],
        counts: { total_merged: 2 },
        references: { merge_rule: 'EMAIL_AND_PHONE' },
      });
      await projector.projectEvent(merged.payload as any);

      const recon2 = await projectionStore.getReconciliation(batchId);
      expect(recon2?.mergedCount).toBe(2);
    });
  });
});
