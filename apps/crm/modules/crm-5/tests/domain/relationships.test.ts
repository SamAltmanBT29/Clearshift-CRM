import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { ControlCenterService } from '../../src/services/control-center.service.js';
import {
  deriveBatchAggregateStatus,
  deriveBatchTotals,
  validateBatchConsistency,
  buildBatchSummary,
} from '../../src/domain/relationships.js';
import {
  BatchSummarySchema,
  type MigrationRun,
  type QualityScore,
  type ReconciliationReport,
} from '@clearshift/contracts';

describe('CRM-5 Relationships & Read-Model Consistency (Issue #51)', () => {
  let app: ReturnType<typeof buildApp>;
  let service: ControlCenterService;

  beforeEach(() => {
    service = new ControlCenterService();
    service.clear();
    app = buildApp({ service });
  });

  const createMockRun = (overrides: Partial<MigrationRun>): MigrationRun => ({
    id: '11111111-1111-4111-a111-111111111111',
    batchId: 'batch-test-rel',
    module: 'crm-1',
    step: 'extract',
    status: 'completed',
    recordsIn: 100,
    recordsOut: 90,
    recordsRejected: 10,
    startedAt: new Date('2026-10-20T10:00:00Z'),
    completedAt: new Date('2026-10-20T10:05:00Z'),
    metadata: null,
    createdAt: new Date('2026-10-20T10:00:00Z'),
    updatedAt: new Date('2026-10-20T10:05:00Z'),
    ...overrides,
  });

  // ---------------------------------------------------------------------------
  // 1. deriveBatchAggregateStatus
  // ---------------------------------------------------------------------------
  describe('deriveBatchAggregateStatus', () => {
    it('returns pending when no runs exist', () => {
      expect(deriveBatchAggregateStatus([])).toBe('pending');
    });

    it('returns failed if any run step has failed', () => {
      const runs = [
        createMockRun({ step: 'extract', status: 'completed' }),
        createMockRun({ step: 'clean', status: 'failed' }),
      ];
      expect(deriveBatchAggregateStatus(runs)).toBe('failed');
    });

    it('returns halted if any step is halted (and none failed)', () => {
      const runs = [
        createMockRun({ step: 'extract', status: 'completed' }),
        createMockRun({ step: 'load', status: 'halted' }),
      ];
      expect(deriveBatchAggregateStatus(runs)).toBe('halted');
    });

    it('returns running if any step is running', () => {
      const runs = [
        createMockRun({ step: 'extract', status: 'completed' }),
        createMockRun({ step: 'clean', status: 'running' }),
      ];
      expect(deriveBatchAggregateStatus(runs)).toBe('running');
    });

    it('returns completed when all 7 canonical steps are completed', () => {
      const steps = ['extract', 'profile', 'clean', 'map', 'load', 'validate', 'reconcile'] as const;
      const runs = steps.map((step) => createMockRun({ step, status: 'completed' }));
      expect(deriveBatchAggregateStatus(runs)).toBe('completed');
    });

    it('returns running when only a subset of steps are completed', () => {
      const runs = [
        createMockRun({ step: 'extract', status: 'completed' }),
        createMockRun({ step: 'profile', status: 'completed' }),
      ];
      expect(deriveBatchAggregateStatus(runs)).toBe('running');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. deriveBatchTotals
  // ---------------------------------------------------------------------------
  describe('deriveBatchTotals', () => {
    it('sums record counts across steps accurately', () => {
      const runs = [
        createMockRun({ recordsIn: 100, recordsOut: 90, recordsRejected: 10, status: 'completed' }),
        createMockRun({ recordsIn: 90, recordsOut: 85, recordsRejected: 5, status: 'completed' }),
        createMockRun({ recordsIn: 85, recordsOut: 80, recordsRejected: 5, status: 'running' }),
      ];

      const totals = deriveBatchTotals(runs);
      expect(totals.totalRecordsIn).toBe(275);
      expect(totals.totalRecordsOut).toBe(255);
      expect(totals.totalRecordsRejected).toBe(20);
      expect(totals.stepsCompleted).toBe(2);
      expect(totals.stepsTotal).toBe(7);
      expect(totals.progressPercentage).toBe(29); // 2/7 * 100 = 28.57 -> 29%
    });
  });

  // ---------------------------------------------------------------------------
  // 3. validateBatchConsistency
  // ---------------------------------------------------------------------------
  describe('validateBatchConsistency', () => {
    it('returns isConsistent: true for fully balanced and consistent batch', () => {
      const runs = [createMockRun({ step: 'load', recordsOut: 100, status: 'completed' })];
      const reconciliation: ReconciliationReport = {
        id: '22222222-2222-4222-a222-222222222222',
        batchId: 'batch-test-rel',
        module: 'crm-1',
        sourceCount: 100,
        loadedCount: 100,
        rejectedCount: 0,
        mergedCount: 0,
        skippedCount: 0,
        unaccountedCount: 0,
        status: 'OK',
        reconciledAt: new Date(),
        createdAt: new Date(),
      };
      const score: QualityScore = {
        id: '33333333-3333-4333-a333-333333333333',
        batchId: 'batch-test-rel',
        module: 'crm-1',
        completeness: 1,
        validity: 1,
        duplicateRate: 0,
        rejectRate: 0,
        linkIntegrity: 1,
        score: 100,
        isFullyScored: true,
        scoredAt: new Date(),
        createdAt: new Date(),
      };

      const result = validateBatchConsistency({
        batchId: 'batch-test-rel',
        module: 'crm-1',
        runs,
        score,
        reconciliation,
      });

      expect(result.isConsistent).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('reports error when reconciliation status is OK but unaccountedCount > 0', () => {
      const reconciliation: ReconciliationReport = {
        id: '22222222-2222-4222-a222-222222222222',
        batchId: 'batch-test-rel',
        module: 'crm-1',
        sourceCount: 100,
        loadedCount: 90,
        rejectedCount: 0,
        mergedCount: 0,
        skippedCount: 0,
        unaccountedCount: 10,
        status: 'OK', // Inconsistent with unaccountedCount 10
        reconciledAt: new Date(),
        createdAt: new Date(),
      };

      const result = validateBatchConsistency({
        batchId: 'batch-test-rel',
        module: 'crm-1',
        runs: [],
        reconciliation,
      });

      expect(result.isConsistent).toBe(false);
      expect(result.errors).toContain(
        'Inconsistent reconciliation: status is OK but unaccountedCount is greater than zero.'
      );
    });

    it('reports error when score isFullyScored is true but score value is null', () => {
      const score: QualityScore = {
        id: '33333333-3333-4333-a333-333333333333',
        batchId: 'batch-test-rel',
        module: 'crm-1',
        completeness: 1,
        validity: 1,
        duplicateRate: null,
        rejectRate: null,
        linkIntegrity: null,
        score: null,
        isFullyScored: true, // Inconsistent
        scoredAt: new Date(),
        createdAt: new Date(),
      };

      const result = validateBatchConsistency({
        batchId: 'batch-test-rel',
        module: 'crm-1',
        runs: [],
        score,
      });

      expect(result.isConsistent).toBe(false);
      expect(result.errors).toContain(
        'Inconsistent quality score: isFullyScored is true but score is null.'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 4. GET /api/v1/crm-control/batches/:batch
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-control/batches/:batch', () => {
    it('returns 200 with full batch summary and consistency checks', async () => {
      service.recordRun({
        batchId: 'batch-summary-001',
        module: 'crm-1',
        step: 'extract',
        status: 'completed',
        recordsIn: 500,
        recordsOut: 480,
        recordsRejected: 20,
      });
      service.recordScore({
        batchId: 'batch-summary-001',
        module: 'crm-1',
        completeness: 0.95,
        validity: 0.95,
        duplicateRate: 0.05,
        rejectRate: 0.05,
        linkIntegrity: 0.95,
      });
      service.recordReconciliation({
        batchId: 'batch-summary-001',
        module: 'crm-1',
        sourceCount: 500,
        loadedCount: 480,
        rejectedCount: 20,
        mergedCount: 0,
        skippedCount: 0,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/batches/batch-summary-001',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(BatchSummarySchema.safeParse(body).success).toBe(true);
      expect(body.batchId).toBe('batch-summary-001');
      expect(body.module).toBe('crm-1');
      expect(body.status).toBe('running'); // extract completed, remaining steps pending
      expect(body.totals.totalRecordsIn).toBe(500);
      expect(body.totals.totalRecordsOut).toBe(480);
      expect(body.totals.totalRecordsRejected).toBe(20);
      expect(body.score.score).toBe(95);
      expect(body.reconciliation.status).toBe('OK');

      expect(body.consistency.isConsistent).toBe(true);
    });

    it('returns 404 when batch is not found', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/batches/non-existent-batch',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('not found');
    });
  });
});
