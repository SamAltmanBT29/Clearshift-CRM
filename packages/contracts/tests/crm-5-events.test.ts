import { describe, expect, it } from 'vitest';
import {
  CRM5EventTypes,
  CRM5EventTypeSchema,
  createRunProjectedEvent,
  createScoreComputedEvent,
  createRejectRecordedEvent,
  createReconciliationCompletedEvent,
  createDuplicateDetectedEvent,
  createDuplicateResolvedEvent,
  createBatchStepEvent,
} from '../src/crm-5-events.js';

describe('CRM-5 Domain Events & Outbox Envelopes (Gate G1 & EV-01..EV-07)', () => {
  const dummyRunId = '50000000-0000-4000-8000-000000000001';
  const dummyScoreId = '51000000-0000-4000-8000-000000000001';
  const dummyRejectId = '52000000-0000-4000-8000-000000000001';
  const dummyReportId = '53000000-0000-4000-8000-000000000001';
  const dummyCandidateId = '54000000-0000-4000-8000-000000000001';
  const dummyBatchId = 'batch-contacts-v1-001';

  describe('Event Type Taxonomy', () => {
    it('defines authoritative CRM-5 event type constants', () => {
      expect(CRM5EventTypes.RUN_PROJECTED).toBe('crm.migration.run_projected');
      expect(CRM5EventTypes.SCORE_COMPUTED).toBe('crm.migration.score_computed');
      expect(CRM5EventTypes.REJECT_RECORDED).toBe('crm.migration.reject_recorded');
      expect(CRM5EventTypes.RECONCILIATION_COMPLETED).toBe('crm.migration.reconciliation_completed');
      expect(CRM5EventTypes.DUPLICATE_DETECTED).toBe('crm.migration.duplicate_detected');
      expect(CRM5EventTypes.DUPLICATE_RESOLVED).toBe('crm.migration.duplicate_resolved');
      expect(CRM5EventTypes.BATCH_EXTRACTED).toBe('batch.extracted');
      expect(CRM5EventTypes.BATCH_LOADED).toBe('batch.loaded');
      expect(CRM5EventTypes.BATCH_FAILED).toBe('batch.failed');
    });

    it('validates event types using CRM5EventTypeSchema enum', () => {
      for (const eventType of Object.values(CRM5EventTypes)) {
        expect(CRM5EventTypeSchema.safeParse(eventType).success).toBe(true);
      }
      expect(CRM5EventTypeSchema.safeParse('crm.invalid.event').success).toBe(false);
    });
  });

  describe('createRunProjectedEvent', () => {
    it('creates compliant outbox envelope with producer crm-5', () => {
      const payload = {
        runId: dummyRunId,
        batchId: dummyBatchId,
        module: 'crm-1' as const,
        step: 'load' as const,
        status: 'completed' as const,
        recordsIn: 500,
        recordsOut: 490,
        recordsRejected: 10,
        startedAt: new Date().toISOString(),
      };

      const event = createRunProjectedEvent(payload, { correlationId: dummyBatchId });

      expect(event.id).toBeDefined();
      expect(event.eventType).toBe(CRM5EventTypes.RUN_PROJECTED);
      expect(event.aggregateType).toBe('crm5_run');
      expect(event.aggregateId).toBe(dummyRunId);
      expect(event.producer).toBe('crm-5');
      expect(event.correlationId).toBe(dummyBatchId);
      expect(event.version).toBe(1);
      expect(event.payload.recordsIn).toBe(500);
    });
  });

  describe('createScoreComputedEvent', () => {
    it('creates score computed event with 5-dimension quality metrics', () => {
      const payload = {
        scoreId: dummyScoreId,
        batchId: dummyBatchId,
        module: 'crm-1' as const,
        score: 97.5,
        completeness: 0.98,
        validity: 0.97,
        duplicateRate: 0.01,
        rejectRate: 0.02,
        linkIntegrity: 0.96,
        isFullyScored: true,
        scoredAt: new Date().toISOString(),
      };

      const event = createScoreComputedEvent(payload);

      expect(event.eventType).toBe(CRM5EventTypes.SCORE_COMPUTED);
      expect(event.aggregateType).toBe('crm5_score');
      expect(event.aggregateId).toBe(dummyScoreId);
      expect(event.payload.score).toBe(97.5);
    });
  });

  describe('createRejectRecordedEvent', () => {
    it('creates reject recorded event with SHA-256 payload hash', () => {
      const payload = {
        rejectId: dummyRejectId,
        batchId: dummyBatchId,
        module: 'crm-1' as const,
        rowIndex: 42,
        errorCode: 'INVALID_EMAIL',
        errorMessage: 'Invalid format',
        rawPayloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        createdAt: new Date().toISOString(),
      };

      const event = createRejectRecordedEvent(payload);

      expect(event.eventType).toBe(CRM5EventTypes.REJECT_RECORDED);
      expect(event.aggregateType).toBe('crm5_reject');
      expect(event.aggregateId).toBe(dummyRejectId);
      expect(event.payload.rowIndex).toBe(42);
    });
  });

  describe('createReconciliationCompletedEvent', () => {
    it('creates reconciliation event reflecting balanced status', () => {
      const payload = {
        reportId: dummyReportId,
        batchId: dummyBatchId,
        module: 'crm-1' as const,
        sourceCount: 500,
        loadedCount: 490,
        rejectedCount: 8,
        mergedCount: 2,
        skippedCount: 0,
        unaccountedCount: 0,
        status: 'OK' as const,
        isBalanced: true,
        reconciledAt: new Date().toISOString(),
      };

      const event = createReconciliationCompletedEvent(payload);

      expect(event.eventType).toBe(CRM5EventTypes.RECONCILIATION_COMPLETED);
      expect(event.aggregateType).toBe('crm5_reconciliation_report');
      expect(event.payload.isBalanced).toBe(true);
      expect(event.payload.unaccountedCount).toBe(0);
    });
  });

  describe('createDuplicateDetectedEvent and createDuplicateResolvedEvent', () => {
    it('creates duplicate detected event with held candidate info', () => {
      const event = createDuplicateDetectedEvent({
        candidateId: dummyCandidateId,
        batchId: dummyBatchId,
        module: 'crm-1' as const,
        keyType: 'email',
        normalizedKey: 'sarah.connor@clearshift.synthetic',
        recordIds: ['id-1', 'id-2'],
        detectedAt: new Date().toISOString(),
      });

      expect(event.eventType).toBe(CRM5EventTypes.DUPLICATE_DETECTED);
      expect(event.aggregateType).toBe('crm5_duplicate_candidate');
      expect(event.payload.recordIds).toHaveLength(2);
    });

    it('creates duplicate resolved event recording human decision', () => {
      const event = createDuplicateResolvedEvent({
        candidateId: dummyCandidateId,
        decision: 'MERGE',
        actorId: 'operator-1',
        keptId: 'id-1',
        mergedId: 'id-2',
        reason: 'Operator verified exact match',
        resolvedAt: new Date().toISOString(),
      });

      expect(event.eventType).toBe(CRM5EventTypes.DUPLICATE_RESOLVED);
      expect(event.payload.decision).toBe('MERGE');
      expect(event.payload.keptId).toBe('id-1');
    });
  });

  describe('createBatchStepEvent', () => {
    it('creates Migration Kit step progress event', () => {
      const event = createBatchStepEvent(CRM5EventTypes.BATCH_LOADED, {
        batchId: dummyBatchId,
        module: 'crm-1',
        step: 'load',
        status: 'completed',
        recordsProcessed: 500,
        recordsRejected: 10,
        timestamp: new Date().toISOString(),
      });

      expect(event.eventType).toBe('batch.loaded');
      expect(event.aggregateType).toBe('migration_batch');
      expect(event.aggregateId).toBe(dummyBatchId);
      expect(event.producer).toBe('migration-kit');
    });
  });
});
