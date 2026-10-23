import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CRM5_DATA_DICTIONARY,
  CRM5_ERD_RELATIONSHIPS,
  CRM5_TRACEABILITY_MATRIX,
  CRM5_DIRTY_DATA_PACK_PLAN,
  assertConservationEquation,
} from '../../src/domain/qa-specs.js';
import {
  crm5Runs,
  crm5Scores,
  crm5Rejects,
  crm5ReconciliationReports,
} from '../../db/schema.js';
import { crm5ImportReceipts } from '../../db/import-receipts.js';
import { getTableColumns } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../../../..');

describe('CRM-5 QA Gate G1 Design Specifications (Issue #197 / [CRM5-24])', () => {
  describe('1. Data Dictionary Invariants & Schema Conformance', () => {
    it('defines specifications for all 5 CRM-5 core tables', () => {
      const expectedTables = [
        'crm5_runs',
        'crm5_scores',
        'crm5_rejects',
        'crm5_reconciliation_reports',
        'crm5_import_receipts',
      ];
      const actualTables = CRM5_DATA_DICTIONARY.map((t) => t.tableName);
      expect(actualTables.sort()).toEqual(expectedTables.sort());
    });

    it('documents every column with type, nullability, constraint, business rule, and example', () => {
      for (const table of CRM5_DATA_DICTIONARY) {
        expect(table.columns.length).toBeGreaterThan(0);
        for (const col of table.columns) {
          expect(col.name).toBeDefined();
          expect(col.pgType).toBeDefined();
          expect(typeof col.nullable).toBe('boolean');
          expect(col.constraints.length).toBeGreaterThan(0);
          expect(col.businessRule.trim().length).toBeGreaterThan(5);
          if (!col.nullable) {
            expect(col.example).not.toBeNull();
            expect(col.example).toBeDefined();
          }
        }
      }
    });

    it('strictly conforms to Drizzle ORM schema column names and nullability', () => {
      const tableMap = {
        crm5_runs: crm5Runs,
        crm5_scores: crm5Scores,
        crm5_rejects: crm5Rejects,
        crm5_reconciliation_reports: crm5ReconciliationReports,
        crm5_import_receipts: crm5ImportReceipts,
      };

      for (const tableDef of CRM5_DATA_DICTIONARY) {
        const drizzleTable = tableMap[tableDef.tableName as keyof typeof tableMap];
        expect(drizzleTable).toBeDefined();

        const drizzleColumns = getTableColumns(drizzleTable);
        const drizzleColNames = Object.values(drizzleColumns).map((c: any) => c.name);
        const dictColNames = tableDef.columns.map((c) => c.name);

        // Every Drizzle column must exist in data dictionary
        for (const drizzleCol of Object.values(drizzleColumns) as any[]) {
          expect(dictColNames).toContain(drizzleCol.name);

          const dictCol = tableDef.columns.find((c) => c.name === drizzleCol.name)!;
          const drizzleNotNull = drizzleCol.notNull ?? false;
          expect(!dictCol.nullable).toBe(drizzleNotNull);
        }

        // Every data dictionary column must exist in Drizzle schema
        for (const dictCol of tableDef.columns) {
          expect(drizzleColNames).toContain(dictCol.name);
        }
      }
    });

    it('documents primary key surrogate UUID constraint for every entity', () => {
      for (const table of CRM5_DATA_DICTIONARY) {
        const idCol = table.columns.find((c) => c.name === 'id');
        expect(idCol).toBeDefined();
        expect(idCol?.pgType).toBe('uuid');
        expect(idCol?.nullable).toBe(false);
        expect(idCol?.constraints.some((c) => c.toLowerCase().includes('primary key'))).toBe(true);
      }
    });

    it('verifies numeric and check constraints on quality scores', () => {
      const scoresTable = CRM5_DATA_DICTIONARY.find((t) => t.tableName === 'crm5_scores')!;
      const dimensions = ['completeness', 'validity', 'duplicate_rate', 'reject_rate', 'link_integrity'];

      for (const dim of dimensions) {
        const col = scoresTable.columns.find((c) => c.name === dim)!;
        expect(col).toBeDefined();
        expect(col.pgType).toBe('numeric(5,4)');
        expect(col.nullable).toBe(true);
        expect(col.constraints.some((c) => c.includes('0.0000..1.0000'))).toBe(true);
      }

      const scoreCol = scoresTable.columns.find((c) => c.name === 'score')!;
      expect(scoreCol.pgType).toBe('numeric(5,2)');
      expect(scoreCol.constraints.some((c) => c.includes('0.00..100.00'))).toBe(true);
    });

    it('verifies reconciliation report status check constraint', () => {
      const reconTable = CRM5_DATA_DICTIONARY.find((t) => t.tableName === 'crm5_reconciliation_reports')!;
      const statusCol = reconTable.columns.find((c) => c.name === 'status')!;
      expect(statusCol).toBeDefined();
      expect(statusCol.constraints.some((c) => c.includes("'OK' | 'UNBALANCED'"))).toBe(true);
    });
  });

  describe('2. ERD Relationships & Master-Data Ownership Boundaries', () => {
    it('defines clear relationships with valid source and target tables', () => {
      expect(CRM5_ERD_RELATIONSHIPS.length).toBeGreaterThan(0);
      const tableNames = CRM5_DATA_DICTIONARY.map((t) => t.tableName);

      for (const rel of CRM5_ERD_RELATIONSHIPS) {
        expect(tableNames).toContain(rel.fromTable);
        if (rel.toTable !== 'clearshift_modules') {
          expect(tableNames).toContain(rel.toTable);
        }
        expect(['1:1', '1:N', 'N:1', '0..N']).toContain(rel.cardinality);
        expect(rel.description.length).toBeGreaterThan(10);
      }
    });

    it('asserts master-data ownership boundary: CRM-5 reads projections and never mutates external schemas', () => {
      for (const table of CRM5_DATA_DICTIONARY) {
        expect(table.owner).toContain('CRM-5 Migration Control Center');
      }
    });
  });

  describe('3. Requirement-to-Test Traceability Matrix', () => {
    it('maps all functional requirements to existing automated test files', () => {
      expect(CRM5_TRACEABILITY_MATRIX.length).toBeGreaterThanOrEqual(20);

      for (const entry of CRM5_TRACEABILITY_MATRIX) {
        expect(entry.reqId).toMatch(/^FR-CRM5-\d{2}$/);
        expect(entry.priority).toBe('Must');
        expect(entry.requirement.length).toBeGreaterThan(10);
        expect(entry.testFile.length).toBeGreaterThan(0);

        // Verify referenced test file actually exists in repo
        const absoluteTestPath = path.resolve(REPO_ROOT, entry.testFile);
        expect(
          fs.existsSync(absoluteTestPath),
          `Test file "${entry.testFile}" for ${entry.reqId} should exist on disk`
        ).toBe(true);
      }
    });

    it('covers all major CRM-5 capabilities across layers', () => {
      const reqIds = new Set(CRM5_TRACEABILITY_MATRIX.map((e) => e.reqId));
      const requiredReqs = [
        'FR-CRM5-01', // Dashboard
        'FR-CRM5-02', // Run List
        'FR-CRM5-03', // 5-Dimension Scores
        'FR-CRM5-04', // Rejection Audit
        'FR-CRM5-05', // Reconciliation
        'FR-CRM5-06', // Exact Deduplication
        'FR-CRM5-07', // Target Adapter & Receipts
        'FR-CRM5-08', // Idempotency
        'FR-CRM5-09', // Batch Loader
        'FR-CRM5-10', // 10% Halt
        'FR-CRM5-14', // OpenAPI
        'FR-CRM5-15', // Auth & RBAC
        'FR-CRM5-16', // Route Shell
        'FR-CRM5-24', // Data Dictionary & ERD & Traceability & Dirty Pack
        'FR-CRM5-25', // Canonical Dirty Data Pack
        'FR-CRM5-26', // Profiler Configuration
      ];

      for (const req of requiredReqs) {
        expect(reqIds.has(req), `Requirement ${req} should be present in Traceability Matrix`).toBe(true);
      }
    });
  });

  describe('4. Synthetic Dirty Data Pack Plan & Conservation Balance Sheet', () => {
    it('100-pack module plan strictly satisfies mathematical conservation', () => {
      const plan = CRM5_DIRTY_DATA_PACK_PLAN.module100Plan;
      expect(plan.totalSourceRows).toBe(100);

      const result = assertConservationEquation(
        plan.totalSourceRows,
        plan.expectedLoaded,
        plan.expectedRejected,
        plan.expectedMerged,
        plan.expectedSkipped
      );

      expect(result.isBalanced).toBe(true);
      expect(result.unaccounted).toBe(0);
      expect(result.expectedStatus).toBe('OK');
    });

    it('1,000-pack canonical plan strictly satisfies mathematical conservation', () => {
      const plan = CRM5_DIRTY_DATA_PACK_PLAN.canonical1000Plan;
      expect(plan.totalSourceRows).toBe(1000);
      expect(plan.expectedLoaded).toBe(780);
      expect(plan.expectedRejected).toBe(140);
      expect(plan.expectedMerged).toBe(80);
      expect(plan.expectedSkipped).toBe(0);
      expect(plan.unaccounted).toBe(0);

      const result = assertConservationEquation(
        plan.totalSourceRows,
        plan.expectedLoaded,
        plan.expectedRejected,
        plan.expectedMerged,
        plan.expectedSkipped
      );

      expect(result.isBalanced).toBe(true);
      expect(result.unaccounted).toBe(0);
      expect(result.expectedStatus).toBe('OK');
    });

    it('assertConservationEquation detects unbalanced discrepancies', () => {
      // 100 source, but loaded 50, rejected 40, merged 5, skipped 0 -> unaccounted 5
      const unbalanced = assertConservationEquation(100, 50, 40, 5, 0);
      expect(unbalanced.isBalanced).toBe(false);
      expect(unbalanced.unaccounted).toBe(5);
      expect(unbalanced.expectedStatus).toBe('UNBALANCED');
    });

    it('scenarios cover all 11 defect categories from canonical manifest.json', () => {
      const manifestPath = path.resolve(__dirname, '../fixtures/manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const manifestCategories = Object.keys(manifest.defectCategories);

      const planCategories = new Set(CRM5_DIRTY_DATA_PACK_PLAN.scenarios.map((s) => s.category));

      for (const cat of manifestCategories) {
        expect(
          planCategories.has(cat),
          `Defect category "${cat}" from manifest.json should be covered in dirty data pack plan scenarios`
        ).toBe(true);
      }
    });

    it('all scenario sample records contain 100% synthetic data with zero PII', () => {
      for (const scenario of CRM5_DIRTY_DATA_PACK_PLAN.scenarios) {
        const json = JSON.stringify(scenario.sampleRecord);
        expect(json).not.toMatch(/@(gmail|yahoo|hotmail|outlook)\.com/i);
        expect(json).not.toMatch(/password/i);
        expect(json).not.toMatch(/ssn|social_security/i);
      }
    });
  });

  describe('5. Gate G1 Design Review Verification', () => {
    it('confirms all Gate G1 design artifacts are defined', () => {
      expect(CRM5_DATA_DICTIONARY.length).toBe(5);
      expect(CRM5_ERD_RELATIONSHIPS.length).toBeGreaterThan(0);
      expect(CRM5_TRACEABILITY_MATRIX.length).toBeGreaterThanOrEqual(20);
      expect(CRM5_DIRTY_DATA_PACK_PLAN.scenarios.length).toBeGreaterThanOrEqual(11);
    });
  });
});
