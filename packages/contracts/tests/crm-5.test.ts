import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CrmModuleSchema,
  MigrationStepSchema,
  MigrationRunStatusSchema,
  ReconciliationStatusSchema,
  MigrationRunSchema,
  RunsQuerySchema,
  QualityScoreSchema,
  computeQualityScore,
  MigrationRejectSchema,
  RejectsQuerySchema,
  ReconciliationReportSchema,
  verifyReconciliation,
  sanitizeCsvFormula,
  normalizeEmail,
  normalizeTaxId,
  normalizeSku,
  normalizePhone,
  normalizeCompositeKey,
  normalizeExactKey,
  DuplicateCandidateSchema,
  DetectDuplicatesInputSchema,
  ResolveDuplicateInputSchema,
  CRM5_API_PREFIX,
} from '../src/crm-5.js';

const crm5OpenApi = readFileSync(new URL('../openapi/crm-5.yaml', import.meta.url), 'utf8');

describe('CRM-5 Migration Control Center & Reports Public Contracts & OpenAPI', () => {
  // ---------------------------------------------------------------------------
  // 1. OpenAPI Specification File Integrity
  // ---------------------------------------------------------------------------
  describe('OpenAPI 3.1 Specification Integrity', () => {
    it('locates and verifies canonical crm-5.yaml metadata and version', () => {
      expect(crm5OpenApi).toContain('openapi: 3.1.0');
      expect(crm5OpenApi).toContain('ClearShift CRM — CRM-5 Migration Control Center & Reports API');
      expect(crm5OpenApi).toContain('version: 1.0.0');
      expect(crm5OpenApi).toContain('url: /api/v1/crm-control');
    });

    it('documents all required endpoints in OpenAPI paths', () => {
      expect(crm5OpenApi).toContain('  /health:');
      expect(crm5OpenApi).toContain('  /runs:');
      expect(crm5OpenApi).toContain('  /scores:');
      expect(crm5OpenApi).toContain('  /rejects:');
      expect(crm5OpenApi).toContain('  /reconciliation:');
      expect(crm5OpenApi).toContain('  /reconciliation/{batch}:');
      expect(crm5OpenApi).toContain('  /duplicates/detect:');
      expect(crm5OpenApi).toContain('  /duplicates/held:');
      expect(crm5OpenApi).toContain('  /duplicates/resolve:');
      expect(crm5OpenApi).toContain('  /batches/{batch}:');
    });

    it('documents HTTP bearerAuth security scheme for protected routes', () => {
      expect(crm5OpenApi).toContain('bearerAuth:');
      expect(crm5OpenApi).toContain('type: http');
      expect(crm5OpenApi).toContain('scheme: bearer');
      expect(crm5OpenApi).toContain('bearerFormat: JWT');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Enums and Pagination Bounds
  // ---------------------------------------------------------------------------
  describe('Enums & Bounded Pagination Query', () => {
    it('validates supported CRM modules', () => {
      expect(CrmModuleSchema.safeParse('crm-1').success).toBe(true);
      expect(CrmModuleSchema.safeParse('crm-5').success).toBe(true);
      expect(CrmModuleSchema.safeParse('crm-99').success).toBe(false);
    });

    it('validates migration lifecycle steps', () => {
      const steps = ['extract', 'profile', 'clean', 'map', 'load', 'validate', 'reconcile'];
      for (const step of steps) {
        expect(MigrationStepSchema.safeParse(step).success).toBe(true);
      }
      expect(MigrationStepSchema.safeParse('archive').success).toBe(false);
    });

    it('validates migration run statuses', () => {
      const statuses = ['pending', 'running', 'completed', 'failed', 'halted'];
      for (const status of statuses) {
        expect(MigrationRunStatusSchema.safeParse(status).success).toBe(true);
      }
      expect(MigrationRunStatusSchema.safeParse('aborted').success).toBe(false);
    });

    it('bounds query page size to 100 maximum and rejects larger values', () => {
      expect(RunsQuerySchema.safeParse({ pageSize: '100' }).success).toBe(true);
      expect(RunsQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
      expect(RunsQuerySchema.safeParse({ limit: '100' }).success).toBe(true);
      expect(RunsQuerySchema.safeParse({ limit: '250' }).success).toBe(false);
      expect(RunsQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    });

    it('defaults pagination to page 1 and size 20', () => {
      const parsed = RunsQuerySchema.parse({});
      expect(parsed.page).toBe(1);
      expect(parsed.pageSize).toBe(20);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Domain Models Validation
  // ---------------------------------------------------------------------------
  describe('Domain Models Validation', () => {
    it('validates a complete MigrationRun record', () => {
      const validRun = {
        id: '11111111-1111-4111-8111-111111111111',
        batchId: 'batch-001',
        module: 'crm-1',
        step: 'load',
        status: 'completed',
        recordsIn: 500,
        recordsOut: 490,
        recordsRejected: 10,
        startedAt: new Date(),
        completedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(MigrationRunSchema.safeParse(validRun).success).toBe(true);
    });

    it('rejects negative counts in MigrationRun', () => {
      const invalidRun = {
        id: '11111111-1111-4111-8111-111111111111',
        batchId: 'batch-001',
        module: 'crm-1',
        step: 'load',
        status: 'completed',
        recordsIn: -5,
        recordsOut: 10,
        recordsRejected: 0,
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(MigrationRunSchema.safeParse(invalidRun).success).toBe(false);
    });

    it('validates QualityScore record', () => {
      const validScore = {
        id: '22222222-2222-4222-8222-222222222222',
        batchId: 'batch-001',
        module: 'crm-1',
        completeness: 0.95,
        validity: 0.98,
        duplicateRate: 0.01,
        rejectRate: 0.02,
        linkIntegrity: 0.96,
        score: 97.2,
        isFullyScored: true,
        scoredAt: new Date(),
        createdAt: new Date(),
      };
      expect(QualityScoreSchema.safeParse(validScore).success).toBe(true);
    });

    it('validates MigrationReject record with 64-char sha256 payload hash', () => {
      const validReject = {
        id: '33333333-3333-4333-8333-333333333333',
        batchId: 'batch-001',
        module: 'crm-1',
        rowIndex: 42,
        errorCode: 'INVALID_EMAIL',
        errorMessage: 'Invalid format',
        rawPayloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        createdAt: new Date(),
      };
      expect(MigrationRejectSchema.safeParse(validReject).success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Exact Quality Score Calculation Formula
  // ---------------------------------------------------------------------------
  describe('Exact Quality Score Calculation Formula', () => {
    it('computes 5-dimension quality score correctly: 100 * (comp + val + (1-dup) + (1-rej) + link) / 5', () => {
      const score = computeQualityScore({
        completeness: 1.0,
        validity: 1.0,
        duplicateRate: 0.0,
        rejectRate: 0.0,
        linkIntegrity: 1.0,
      });
      expect(score).toBe(100);
    });

    it('computes realistic score with 2 decimal precision', () => {
      // 100 * (0.95 + 0.96 + (1 - 0.02) + (1 - 0.03) + 0.94) / 5
      // = 100 * (0.95 + 0.96 + 0.98 + 0.97 + 0.94) / 5
      // = 100 * (4.80) / 5 = 96.00
      const score = computeQualityScore({
        completeness: 0.95,
        validity: 0.96,
        duplicateRate: 0.02,
        rejectRate: 0.03,
        linkIntegrity: 0.94,
      });
      expect(score).toBe(96.0);
    });

    it('returns null if any component is missing or null', () => {
      expect(
        computeQualityScore({
          completeness: 0.95,
          validity: null,
          duplicateRate: 0.01,
          rejectRate: 0.02,
          linkIntegrity: 0.96,
        })
      ).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Strict Conservation Invariant & Reconciliation
  // ---------------------------------------------------------------------------
  describe('Reconciliation Conservation Invariant', () => {
    it('verifies exact balance when source equals sum of terminal states (unaccounted = 0)', () => {
      const result = verifyReconciliation({
        sourceCount: 1000,
        loadedCount: 950,
        rejectedCount: 40,
        mergedCount: 8,
        skippedCount: 2,
      });
      expect(result.unaccountedCount).toBe(0);
      expect(result.status).toBe('OK');
      expect(result.isBalanced).toBe(true);
    });

    it('detects unaccounted discrepancies and flags UNBALANCED status', () => {
      const result = verifyReconciliation({
        sourceCount: 1000,
        loadedCount: 950,
        rejectedCount: 20,
        mergedCount: 5,
        skippedCount: 0,
      });
      // 1000 - (950 + 20 + 5 + 0) = 25 unaccounted
      expect(result.unaccountedCount).toBe(25);
      expect(result.status).toBe('UNBALANCED');
      expect(result.isBalanced).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Formula Injection Defense
  // ---------------------------------------------------------------------------
  describe('Formula Injection Defense (CSV / Spreadsheet)', () => {
    it('neutralizes leading =, +, -, @, \\t, \\r characters by prepending single quote', () => {
      expect(sanitizeCsvFormula('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
      expect(sanitizeCsvFormula('+12345')).toBe("'+12345");
      expect(sanitizeCsvFormula('-CMD|...')).toBe("'-CMD|...");
      expect(sanitizeCsvFormula('@mention')).toBe("'@mention");
      expect(sanitizeCsvFormula('\tleading_tab')).toBe("'\tleading_tab");
      expect(sanitizeCsvFormula('  =MALICIOUS')).toBe("'  =MALICIOUS");
    });

    it('leaves standard text inputs unescaped', () => {
      expect(sanitizeCsvFormula('Normal Company Name')).toBe('Normal Company Name');
      expect(sanitizeCsvFormula('john.doe@clearshift.synthetic')).toBe('john.doe@clearshift.synthetic');
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Deterministic Exact Key Normalizers
  // ---------------------------------------------------------------------------
  describe('Deterministic Exact Key Normalizers (CRM5-12)', () => {
    it('normalizes email: lowercases and trims whitespace', () => {
      expect(normalizeEmail('  Sarah.Connor@ClearShift.Synthetic  ')).toBe(
        'sarah.connor@clearshift.synthetic'
      );
    });

    it('normalizes taxId: uppercases, trims, strips punctuation and spaces', () => {
      expect(normalizeTaxId('  us - 12.345 / 67  ')).toBe('US1234567');
    });

    it('normalizes sku: uppercases and collapses internal whitespace', () => {
      expect(normalizeSku('  sku -  abc   123  ')).toBe('SKU - ABC 123');
    });

    it('normalizes phone: strips non-digits while preserving leading plus', () => {
      expect(normalizePhone('  +1 (555) 019-2834  ')).toBe('+15550192834');
      expect(normalizePhone('  (555) 019-2834  ')).toBe('5550192834');
    });

    it('normalizes composite keys deterministically sorted', () => {
      const composite = normalizeCompositeKey({ z: 'last', a: 'first', m: 'middle' });
      expect(composite).toBe('a=first;m=middle;z=last');
    });

    it('dispatches through normalizeExactKey helper', () => {
      expect(normalizeExactKey('email', ' User@Domain.Com ')).toBe('user@domain.com');
      expect(normalizeExactKey('tax_id', 'TX-99.01')).toBe('TX9901');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Duplicate Review Decision Invariants
  // ---------------------------------------------------------------------------
  describe('Duplicate Review Decision Invariants', () => {
    it('requires distinct keptId and mergedId for MERGE decisions', () => {
      const validMerge = ResolveDuplicateInputSchema.safeParse({
        candidateId: 'cand-001',
        decision: 'MERGE',
        actorId: 'operator-1',
        keptId: 'entity-1',
        mergedId: 'entity-2',
        reason: 'Confirmed exact duplicate',
      });
      expect(validMerge.success).toBe(true);

      const invalidMerge = ResolveDuplicateInputSchema.safeParse({
        candidateId: 'cand-001',
        decision: 'MERGE',
        actorId: 'operator-1',
        keptId: 'entity-1',
        mergedId: 'entity-1',
        reason: 'Same entity',
      });
      expect(invalidMerge.success).toBe(false);
    });
  });
});
