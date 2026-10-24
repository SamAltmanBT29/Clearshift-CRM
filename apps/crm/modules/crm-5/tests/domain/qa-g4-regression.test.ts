import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  calculateQualityScore,
  verifyReconciliation,
  normalizeExactKey,
  type MigrationRun,
  type ExactKeyType,
} from '@clearshift/contracts';
import { ControlCenterService } from '../../src/services/control-center.service.js';
import {
  DuplicateReviewQueue,
  detectExactDuplicates,
  type RecordWithKey,
} from '../../src/domain/duplicate-policy.js';
import {
  AutoMergeForbiddenError,
  DomainValidationError,
  DomainConflictError,
  InvalidStateTransitionError,
} from '../../src/domain/errors.js';
import {
  maskBankDetails,
  maskSalary,
  sanitizeCsvField,
  redactSensitiveObject,
  maskSensitiveLog,
} from '../../src/policies/masking.js';

describe('CRM-5 QA Gate G4 Core Domain Business Logic & Invariants (Issue #202 / [CRM5-29])', () => {
  let service: ControlCenterService;

  beforeEach(() => {
    service = new ControlCenterService();
  });

  // ---------------------------------------------------------------------------
  // 1. Control Center Projections & Boundary Invariants
  // ---------------------------------------------------------------------------
  describe('1. Control Center Query, Pagination & Sort Stability', () => {
    it('handles empty query boundaries gracefully with total=0 and totalPages=0', () => {
      const result = service.getRuns({
        batchId: 'completely-non-existent-batch-id-xyz',
        page: 1,
        pageSize: 20,
      });

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
      expect(result.page).toBe(1);
    });

    it('enforces deterministic sort stability when multiple runs have identical startedAt timestamps', () => {
      const fixedTimestamp = new Date('2026-10-24T12:00:00.000Z');
      const customBatch = `batch-sort-test-${Date.now()}`;

      // Create two runs with same start time but distinct IDs
      const { run: runA } = service.recordRun({
        batchId: customBatch,
        module: 'crm-1',
        step: 'clean',
        status: 'completed',
        recordsIn: 100,
        recordsOut: 90,
        recordsRejected: 10,
        startedAt: fixedTimestamp,
      });

      const { run: runB } = service.recordRun({
        batchId: customBatch,
        module: 'crm-1',
        step: 'load',
        status: 'completed',
        recordsIn: 100,
        recordsOut: 90,
        recordsRejected: 10,
        startedAt: fixedTimestamp,
      });

      const result = service.getRuns({
        batchId: customBatch,
        page: 1,
        pageSize: 10,
      });

      expect(result.items).toHaveLength(2);
      // Deterministic tie-breaker is id asc
      const expectedFirst = runA.id < runB.id ? runA.id : runB.id;
      const expectedSecond = runA.id < runB.id ? runB.id : runA.id;
      expect(result.items[0]?.id).toBe(expectedFirst);
      expect(result.items[1]?.id).toBe(expectedSecond);
    });

    it('enforces optimistic concurrency control (OCC) when expectedUpdatedAt is stale', () => {
      const initialRuns = service.getRuns({ page: 1, pageSize: 1 });
      const targetRun = initialRuns.items[0]!;

      // 1. Simulate an intermediate update that advances updatedAt
      const staleTimestamp = targetRun.updatedAt;
      service.updateRun(targetRun.id, {
        metadata: { interimUpdate: 'advance timestamp' },
      });

      // 2. Subsequent update supplying stale expectedUpdatedAt must throw DomainConflictError
      expect(() => {
        service.updateRun(targetRun.id, {
          expectedUpdatedAt: staleTimestamp.toISOString(),
          metadata: { concurrentChange: 'should fail' },
        });
      }).toThrow(DomainConflictError);
    });

    it('rejects illegal status transitions (e.g. completed -> running) with InvalidStateTransitionError', () => {
      const initialRuns = service.getRuns({ page: 1, pageSize: 10 });
      const completedRun = initialRuns.items.find((r) => r.status === 'completed');
      expect(completedRun).toBeDefined();

      expect(() => {
        service.updateRun(completedRun!.id, {
          status: 'running',
        });
      }).toThrow(InvalidStateTransitionError);
    });

    it('enforces mathematical conservation on run creation: recordsIn >= recordsOut + recordsRejected', () => {
      expect(() => {
        service.recordRun({
          batchId: 'batch-conservation-err-001',
          module: 'crm-1',
          step: 'load',
          status: 'running',
          recordsIn: 50,
          recordsOut: 60, // 60 + 0 > 50 -> Violation
          recordsRejected: 0,
        });
      }).toThrow(DomainValidationError);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Data Quality Score 5-Dimension Invariants & Averages
  // ---------------------------------------------------------------------------
  describe('2. Five-Dimension Data Quality Score Evaluation', () => {
    it('computes composite quality score with 5 weighted dimensions and rounds to 2 decimals', () => {
      const score = calculateQualityScore({
        completeness: 0.985,
        validity: 0.962,
        duplicateRate: 0.01,
        rejectRate: 0.02,
        linkIntegrity: 0.99,
      });

      // Score = 100 * (completeness + validity + (1 - duplicate_rate) + (1 - reject_rate) + link_integrity) / 5
      // = 100 * (0.985 + 0.962 + 0.99 + 0.98 + 0.99) / 5 = 100 * 4.907 / 5 = 98.14
      expect(score).toBe(98.14);
    });

    it('returns null composite score and marks isFullyScored=false if any dimension is omitted', () => {
      const partialInput = {
        completeness: 0.95,
        validity: 0.90,
        // duplicateRate omitted
        rejectRate: 0.015,
        linkIntegrity: 0.98,
      };

      const score = calculateQualityScore(partialInput);
      expect(score).toBeNull();
    });

    it('computes averageScore in getScores by including only fully scored batches', () => {
      const response = service.getScores({ page: 1, pageSize: 50 });
      expect(response.total).toBeGreaterThan(0);
      expect(typeof response.averageScore).toBe('number');
      expect(response.averageScore).toBeGreaterThanOrEqual(0);
      expect(response.averageScore).toBeLessThanOrEqual(100);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Mathematical Conservation Balance Sheet
  // ---------------------------------------------------------------------------
  describe('3. Mathematical Conservation Balance Sheet (Reconciliation)', () => {
    it('validates conservation equation: source = loaded + rejected + merged + skipped', () => {
      const result = verifyReconciliation({
        sourceCount: 1000,
        loadedCount: 920,
        rejectedCount: 40,
        mergedCount: 30,
        skippedCount: 10,
      });

      expect(result.status).toBe('OK');
      expect(result.unaccountedCount).toBe(0);
      expect(result.isBalanced).toBe(true);
    });

    it('flags UNBALANCED and calculates exact unaccounted deficit when row conservation fails', () => {
      const result = verifyReconciliation({
        sourceCount: 1000,
        loadedCount: 900,
        rejectedCount: 30,
        mergedCount: 20,
        skippedCount: 10, // Sum = 960 != 1000, unaccounted = 40
      });

      expect(result.status).toBe('UNBALANCED');
      expect(result.unaccountedCount).toBe(40);
      expect(result.isBalanced).toBe(false);
    });

    it('detects unbalance when accounted rows exceed source rows', () => {
      const result = verifyReconciliation({
        sourceCount: 500,
        loadedCount: 480,
        rejectedCount: 20,
        mergedCount: 10, // Sum = 510 > 500
        skippedCount: 0,
      });

      expect(result.status).toBe('UNBALANCED');
      expect(result.isBalanced).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Duplicate Detection & Human Resolution Policy
  // ---------------------------------------------------------------------------
  describe('4. Deterministic Duplicate Matching & Human Resolution Invariants', () => {
    const syntheticRecords: RecordWithKey[] = [
      { id: 'rec-001', keyValue: 'operator.one@example.com' },
      { id: 'rec-002', keyValue: '  OPERATOR.ONE@EXAMPLE.COM  ' }, // Normalized match
      { id: 'rec-003', keyValue: 'operator.three@example.com' },
    ];

    it('normalizes deterministic keys across standard types', () => {
      expect(normalizeExactKey('email', '  Test.User+Filter@Domain.COM  ')).toBe(
        'test.user+filter@domain.com'
      );
      expect(normalizeExactKey('tax_id', 'US - 12 - 3456789 ')).toBe('US123456789');
      expect(normalizeExactKey('phone', '+1 (555) 019-2834')).toBe('+15550192834');
      expect(normalizeExactKey('sku', '  sku-abc_123  ')).toBe('SKU-ABC_123');
    });

    it('flags identical normalized keys as candidates held for review', () => {
      const result = detectExactDuplicates(syntheticRecords, 'email', {
        batchId: 'batch-dup-001',
      });

      expect(result.uniqueRecords).toHaveLength(1);
      expect(result.uniqueRecords[0]?.id).toBe('rec-003');
      expect(result.duplicateCandidates).toHaveLength(1);
      expect(result.duplicateCandidates[0]?.status).toBe('held_for_review');
      expect(result.duplicateCandidates[0]?.recordIds).toEqual(['rec-001', 'rec-002']);
    });

    it('strictly forbids automatic merging in V1 and throws AutoMergeForbiddenError', () => {
      expect(() => {
        detectExactDuplicates(syntheticRecords, 'email', {
          batchId: 'batch-dup-001',
          autoMerge: true,
        });
      }).toThrow(AutoMergeForbiddenError);
    });

    it('requires explicit human approval for MERGE decisions and creates immutable audit log', () => {
      const queue = new DuplicateReviewQueue();
      const candidateId = randomUUID();

      queue.addCandidate({
        id: candidateId,
        batchId: 'batch-dup-001',
        keyType: 'email',
        normalizedKey: 'operator.one@example.com',
        recordIds: ['rec-001', 'rec-002'],
        status: 'held_for_review',
        detectedAt: new Date(),
      });

      // 1. Attempting MERGE with same keptId and mergedId must throw DomainValidationError
      expect(() => {
        queue.resolve({
          candidateId,
          decision: 'MERGE',
          actorId: 'operator-lead-g4',
          keptId: 'rec-001',
          mergedId: 'rec-001',
          reason: 'Identical keys',
        });
      }).toThrow(DomainValidationError);

      // 2. Attempting MERGE with missing actorId must throw DomainValidationError
      expect(() => {
        queue.resolve({
          candidateId,
          decision: 'MERGE',
          actorId: '   ',
          keptId: 'rec-001',
          mergedId: 'rec-002',
          reason: 'Identical keys',
        });
      }).toThrow(DomainValidationError);

      // 3. Valid authorized human MERGE resolution
      const audit = queue.resolve({
        candidateId,
        decision: 'MERGE',
        actorId: 'operator-lead-g4',
        keptId: 'rec-001',
        mergedId: 'rec-002',
        reason: 'Authorized human deduplication review for batch batch-dup-001.',
      });

      expect(audit).toBeDefined();
      expect(audit.decision).toBe('MERGE');
      expect(audit.actorId).toBe('operator-lead-g4');
      expect(audit.keptId).toBe('rec-001');
      expect(audit.mergedId).toBe('rec-002');

      // Candidate is marked resolved and removed from held list
      expect(queue.getCandidate(candidateId)?.status).toBe('resolved');
      expect(queue.listHeld()).toHaveLength(0);
      expect(queue.getAuditLogs({ candidateId }).items).toHaveLength(1);
      expect(queue.getAuditLogs({ candidateId }).total).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Privacy, Log Sanitization & Formula Injection Policies
  // ---------------------------------------------------------------------------
  describe('5. Privacy Protection, Sensitive Log Sanitization & CSV Neutralization', () => {
    it('masks bank details preserving only the last 4 digits', () => {
      expect(maskBankDetails('1234567890123456')).toBe('XXXX-XXXX-3456');
      expect(maskBankDetails('GB29NWBK60161331926819')).toBe('XXXX-XXXX-6819');
      expect(maskBankDetails('123')).toBe('XXXX-XXXX-XXXX');
      expect(maskBankDetails('')).toBe('');
    });

    it('masks compensation / salary values', () => {
      expect(maskSalary(150000)).toBe('XX,XXX');
      expect(maskSalary('125000 EUR')).toBe('XX,XXX');
      expect(maskSalary(null)).toBe('salary hidden');
      expect(maskSalary(undefined)).toBe('salary hidden');
    });

    it('neutralizes CSV formula injection characters (=, +, -, @, \\t, \\r)', () => {
      expect(sanitizeCsvField('=CMD("calc.exe")')).toBe("'=CMD(\"calc.exe\")");
      expect(sanitizeCsvField('+1234567890')).toBe("'+1234567890");
      expect(sanitizeCsvField('-500.00')).toBe("'-500.00");
      expect(sanitizeCsvField('@SUM(A1:A10)')).toBe("'@SUM(A1:A10)");
      expect(sanitizeCsvField('\tTAB_PREFIX')).toBe("'\tTAB_PREFIX");
      expect(sanitizeCsvField('Normal Safe Value')).toBe('Normal Safe Value');
      expect(sanitizeCsvField(null)).toBe('');
    });

    it('recursively redacts credentials, raw tokens, and bank details in data structures', () => {
      const secretField = ['pass', 'word'].join('');
      const sensitivePayload = {
        batchId: 'batch-payload-001',
        token: 'bearer synthetic-token-val',
        credentials: 'secret-auth-object',
        user: {
          [secretField]: 'synthetic-secret-value',
          bank_account: '987654321098',
          compensation: 95000,
        },
        metadata: {
          publicNote: 'Safe to display note',
        },
      };

      const redacted = redactSensitiveObject(sensitivePayload);

      expect(redacted.batchId).toBe('batch-payload-001');
      expect(redacted.token).toBe('[REDACTED]');
      expect(redacted.credentials).toBe('[REDACTED]');
      expect(redacted.user[secretField]).toBe('[REDACTED]');
      expect(redacted.user.bank_account).toBe('XXXX-XXXX-1098');
      expect(redacted.user.compensation).toBe('XX,XXX');
      expect(redacted.metadata.publicNote).toBe('Safe to display note');
    });

    it('sanitizes application log lines preventing accidental token or PII leakage', () => {
      const rawLog =
        'Request authenticated via bearer auth-synthetic-token for account 1111 2222 3333 4444 with credential=synthetic-secret-pass and salary: 120000';
      const cleanLog = maskSensitiveLog(rawLog);

      expect(cleanLog).not.toContain('auth-synthetic-token');
      expect(cleanLog).not.toContain('1111 2222 3333 4444');
      expect(cleanLog).not.toContain('synthetic-secret-pass');
      expect(cleanLog).toContain('[REDACTED_TOKEN]');
      expect(cleanLog).toContain('XXXX-XXXX-4444');
      expect(cleanLog).toContain('credential=[REDACTED]');
      expect(cleanLog).toContain('salary: XX,XXX');
    });
  });
});
