import { describe, it, expect } from 'vitest';
import {
  crm5Runs,
  crm5Scores,
  crm5Rejects,
  crm5ReconciliationReports,
  crm5RunProjections,
  crm5QualityScores,
  crm5RejectProjections,
} from '../../db/schema.js';
import {
  computeQualityScore,
  verifyReconciliation,
  sanitizeCsvFormula,
  MigrationRunSchema,
  QualityScoreSchema,
  MigrationRejectSchema,
  ReconciliationReportSchema,
} from '@clearshift/contracts';

describe('CRM-5 Schema & Architectural Invariants (Issue #46)', () => {
  describe('Drizzle Table Definitions', () => {
    it('defines crm5_runs table with expected columns and UUID primary key', () => {
      expect(crm5Runs).toBeDefined();
      expect(crm5Runs.id).toBeDefined();
      expect(crm5Runs.batchId).toBeDefined();
      expect(crm5Runs.module).toBeDefined();
      expect(crm5Runs.step).toBeDefined();
      expect(crm5Runs.status).toBeDefined();
      expect(crm5Runs.recordsIn).toBeDefined();
      expect(crm5Runs.recordsOut).toBeDefined();
      expect(crm5Runs.recordsRejected).toBeDefined();
      expect(crm5Runs.startedAt).toBeDefined();
      expect(crm5Runs.completedAt).toBeDefined();

      // Aliases
      expect(crm5RunProjections).toBe(crm5Runs);
    });

    it('defines crm5_scores table with 5 quality dimensions', () => {
      expect(crm5Scores).toBeDefined();
      expect(crm5Scores.id).toBeDefined();
      expect(crm5Scores.batchId).toBeDefined();
      expect(crm5Scores.module).toBeDefined();
      expect(crm5Scores.completeness).toBeDefined();
      expect(crm5Scores.validity).toBeDefined();
      expect(crm5Scores.duplicateRate).toBeDefined();
      expect(crm5Scores.rejectRate).toBeDefined();
      expect(crm5Scores.linkIntegrity).toBeDefined();
      expect(crm5Scores.score).toBeDefined();
      expect(crm5Scores.isFullyScored).toBeDefined();

      // Aliases
      expect(crm5QualityScores).toBe(crm5Scores);
    });

    it('defines crm5_rejects table with row index and error details', () => {
      expect(crm5Rejects).toBeDefined();
      expect(crm5Rejects.id).toBeDefined();
      expect(crm5Rejects.batchId).toBeDefined();
      expect(crm5Rejects.module).toBeDefined();
      expect(crm5Rejects.rowIndex).toBeDefined();
      expect(crm5Rejects.errorCode).toBeDefined();
      expect(crm5Rejects.errorMessage).toBeDefined();
      expect(crm5Rejects.rawPayloadHash).toBeDefined();

      // Aliases
      expect(crm5RejectProjections).toBe(crm5Rejects);
    });

    it('defines crm5_reconciliation_reports table with unique batchId and count invariants', () => {
      expect(crm5ReconciliationReports).toBeDefined();
      expect(crm5ReconciliationReports.id).toBeDefined();
      expect(crm5ReconciliationReports.batchId).toBeDefined();
      expect(crm5ReconciliationReports.module).toBeDefined();
      expect(crm5ReconciliationReports.sourceCount).toBeDefined();
      expect(crm5ReconciliationReports.loadedCount).toBeDefined();
      expect(crm5ReconciliationReports.rejectedCount).toBeDefined();
      expect(crm5ReconciliationReports.mergedCount).toBeDefined();
      expect(crm5ReconciliationReports.skippedCount).toBeDefined();
      expect(crm5ReconciliationReports.unaccountedCount).toBeDefined();
      expect(crm5ReconciliationReports.status).toBeDefined();
    });
  });

  describe('Quality Score Formula Invariants', () => {
    it('computes exact quality score when all 5 dimensions are present', () => {
      // Example: completeness 0.95, validity 0.90, duplicateRate 0.05 (1-dup = 0.95), rejectRate 0.02 (1-rej = 0.98), linkIntegrity 1.00
      // Sum = 0.95 + 0.90 + 0.95 + 0.98 + 1.00 = 4.78
      // Average = 4.78 / 5 = 0.956
      // Score = 95.60
      const score = computeQualityScore({
        completeness: 0.95,
        validity: 0.9,
        duplicateRate: 0.05,
        rejectRate: 0.02,
        linkIntegrity: 1.0,
      });

      expect(score).toBe(95.6);
    });

    it('returns 100.00 for a perfect batch', () => {
      const score = computeQualityScore({
        completeness: 1.0,
        validity: 1.0,
        duplicateRate: 0.0,
        rejectRate: 0.0,
        linkIntegrity: 1.0,
      });

      expect(score).toBe(100.0);
    });

    it('returns null if any component is missing or unavailable', () => {
      const score = computeQualityScore({
        completeness: 0.95,
        validity: null,
        duplicateRate: 0.05,
        rejectRate: 0.02,
        linkIntegrity: 1.0,
      });

      expect(score).toBeNull();
    });
  });

  describe('Reconciliation Conservation Invariants', () => {
    it('marks status OK when source equals sum of all buckets and unaccounted is 0', () => {
      const result = verifyReconciliation({
        sourceCount: 1000,
        loadedCount: 950,
        rejectedCount: 30,
        mergedCount: 15,
        skippedCount: 5,
      });

      expect(result.unaccountedCount).toBe(0);
      expect(result.status).toBe('OK');
      expect(result.isBalanced).toBe(true);
    });

    it('marks status UNBALANCED and flags unaccounted rows when counts do not sum to source', () => {
      const result = verifyReconciliation({
        sourceCount: 1000,
        loadedCount: 900,
        rejectedCount: 30,
        mergedCount: 10,
        skippedCount: 10,
      });

      // 900 + 30 + 10 + 10 = 950 -> 50 unaccounted
      expect(result.unaccountedCount).toBe(50);
      expect(result.status).toBe('UNBALANCED');
      expect(result.isBalanced).toBe(false);
    });
  });

  describe('Formula Injection Defense', () => {
    it('prepends a single quote to spreadsheet formula characters', () => {
      expect(sanitizeCsvFormula('=1+2')).toBe("'=1+2");
      expect(sanitizeCsvFormula('+cmd|')).toBe("'+cmd|");
      expect(sanitizeCsvFormula('-SUM(A1:A10)')).toBe("'-SUM(A1:A10)");
      expect(sanitizeCsvFormula('@something')).toBe("'@something");
    });

    it('preserves clean values untouched', () => {
      expect(sanitizeCsvFormula('John Doe')).toBe('John Doe');
      expect(sanitizeCsvFormula('42')).toBe('42');
      expect(sanitizeCsvFormula('batch-123')).toBe('batch-123');
    });
  });

  describe('Zod Contracts & Validation Guards', () => {
    it('validates a valid migration run projection', () => {
      const valid = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        batchId: 'batch-001',
        module: 'crm-1',
        step: 'load',
        status: 'completed',
        recordsIn: 500,
        recordsOut: 480,
        recordsRejected: 20,
        startedAt: new Date(),
        completedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const parsed = MigrationRunSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
    });

    it('rejects negative record counts in migration run', () => {
      const invalid = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        batchId: 'batch-001',
        module: 'crm-1',
        step: 'load',
        status: 'completed',
        recordsIn: -5,
        recordsOut: 0,
        recordsRejected: 0,
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const parsed = MigrationRunSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it('rejects invalid fractions in quality score schema', () => {
      const invalid = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        batchId: 'batch-001',
        module: 'crm-1',
        completeness: 1.5, // Invalid: must be <= 1.0
        validity: 0.9,
        duplicateRate: 0.0,
        rejectRate: 0.0,
        linkIntegrity: 1.0,
        score: 98.0,
        isFullyScored: true,
        scoredAt: new Date(),
        createdAt: new Date(),
      };

      const parsed = QualityScoreSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it('rejects row_index < 1 in migration reject schema', () => {
      const invalid = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        batchId: 'batch-001',
        module: 'crm-1',
        rowIndex: 0, // Invalid: must be >= 1
        errorCode: 'ERR_EMPTY',
        errorMessage: 'Row is empty',
        rawPayloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        createdAt: new Date(),
      };

      const parsed = MigrationRejectSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it('validates a reconciliation report schema', () => {
      const report = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        batchId: 'batch-001',
        module: 'crm-1',
        sourceCount: 100,
        loadedCount: 95,
        rejectedCount: 5,
        mergedCount: 0,
        skippedCount: 0,
        unaccountedCount: 0,
        status: 'OK',
        reconciledAt: new Date(),
        createdAt: new Date(),
      };

      const parsed = ReconciliationReportSchema.safeParse(report);
      expect(parsed.success).toBe(true);
    });
  });
});
