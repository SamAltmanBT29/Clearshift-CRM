import { describe, it, expect } from 'vitest';
import {
  CRM2_DATA_DICTIONARY,
  CRM2_ERD_RELATIONSHIPS,
  CRM2_TRACEABILITY_MATRIX,
  CRM2_DIRTY_DATA_PACK_PLAN,
  assertConservationEquation,
  buildDealExactBusinessKey,
  buildQuoteExactKey,
} from '../../src/domain/qa-specs.js';
import {
  crm2Stages,
  crm2Deals,
  crm2Quotes,
  crm2QuoteLines,
  crm2ImportBatches,
  crm2ImportReceipts,
  crm2ImportRejects,
} from '../../db/schema.js';
import { getTableColumns } from 'drizzle-orm';

describe('CRM-2 QA Gate G1 Design Specifications (Issue #137 / [CRM2-24])', () => {
  describe('1. Data Dictionary Invariants & Schema Conformance', () => {
    it('defines specifications for all 7 CRM-2 core and migration tables', () => {
      const expectedTables = [
        'crm2_stages',
        'crm2_deals',
        'crm2_quotes',
        'crm2_quote_lines',
        'crm2_import_batches',
        'crm2_import_receipts',
        'crm2_import_rejects',
      ];
      const actualTables = CRM2_DATA_DICTIONARY.map((t) => t.tableName);
      expect(actualTables.sort()).toEqual(expectedTables.sort());
    });

    it('documents every column with type, nullability, constraint, business rule, and example', () => {
      for (const table of CRM2_DATA_DICTIONARY) {
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
        crm2_stages: crm2Stages,
        crm2_deals: crm2Deals,
        crm2_quotes: crm2Quotes,
        crm2_quote_lines: crm2QuoteLines,
        crm2_import_batches: crm2ImportBatches,
        crm2_import_receipts: crm2ImportReceipts,
        crm2_import_rejects: crm2ImportRejects,
      };

      for (const tableDef of CRM2_DATA_DICTIONARY) {
        const drizzleTable = tableMap[tableDef.tableName as keyof typeof tableMap];
        expect(drizzleTable).toBeDefined();

        const drizzleColumns = getTableColumns(drizzleTable);
        const drizzleColNames = Object.values(drizzleColumns).map((c: any) => c.name);
        const dictColNames = tableDef.columns.map((c) => c.name);

        // Every Drizzle column must exist in data dictionary
        for (const drizzleCol of Object.values(drizzleColumns) as any[]) {
          expect(dictColNames).toContain(drizzleCol.name);

          const dictCol = tableDef.columns.find((c) => c.name === drizzleCol.name)!;
          const isDrizzleNullable = !drizzleCol.notNull;
          expect(dictCol.nullable).toBe(isDrizzleNullable);
        }

        // Every data dictionary column must exist in Drizzle schema
        for (const dictCol of tableDef.columns) {
          expect(drizzleColNames).toContain(dictCol.name);
        }
      }
    });

    it('verifies numeric decimal precision constraints on financial columns', () => {
      const dealsTable = CRM2_DATA_DICTIONARY.find((t) => t.tableName === 'crm2_deals')!;
      const valueCol = dealsTable.columns.find((c) => c.name === 'value')!;
      expect(valueCol.pgType).toBe('numeric(14,2)');
      expect(valueCol.constraints).toContain('crm2_deals_value_nonnegative_check');

      const quotesTable = CRM2_DATA_DICTIONARY.find((t) => t.tableName === 'crm2_quotes')!;
      const amountCol = quotesTable.columns.find((c) => c.name === 'amount')!;
      expect(amountCol.pgType).toBe('numeric(14,2)');
      expect(amountCol.constraints).toContain('crm2_quotes_amount_nonnegative_check');

      const linesTable = CRM2_DATA_DICTIONARY.find((t) => t.tableName === 'crm2_quote_lines')!;
      const lineTotalCol = linesTable.columns.find((c) => c.name === 'line_total')!;
      expect(lineTotalCol.pgType).toBe('numeric(14,2)');
    });
  });

  describe('2. ERD Relationships & Boundary Invariants', () => {
    it('defines all core relational and cross-module relationships', () => {
      expect(CRM2_ERD_RELATIONSHIPS.length).toBeGreaterThanOrEqual(7);
      const ids = CRM2_ERD_RELATIONSHIPS.map((r) => r.relationshipId);
      expect(ids).toContain('REL-CRM2-01'); // stages -> deals
      expect(ids).toContain('REL-CRM2-02'); // deals -> quotes
      expect(ids).toContain('REL-CRM2-03'); // quotes -> quote_lines
      expect(ids).toContain('REL-CRM2-04'); // contacts -> deals (cross-module)
    });

    it('enforces deletion restriction on stages with linked deals', () => {
      const stageRel = CRM2_ERD_RELATIONSHIPS.find((r) => r.relationshipId === 'REL-CRM2-01')!;
      expect(stageRel.fromTable).toBe('crm2_deals');
      expect(stageRel.toTable).toBe('crm2_stages');
      expect(stageRel.onDelete).toBe('RESTRICT');
      expect(stageRel.enforcement).toBe('Database Foreign Key');
    });

    it('enforces deletion restriction on deals with linked quotes', () => {
      const dealRel = CRM2_ERD_RELATIONSHIPS.find((r) => r.relationshipId === 'REL-CRM2-02')!;
      expect(dealRel.fromTable).toBe('crm2_quotes');
      expect(dealRel.toTable).toBe('crm2_deals');
      expect(dealRel.onDelete).toBe('RESTRICT');
      expect(dealRel.enforcement).toBe('Database Foreign Key');
    });

    it('enforces cascade deletion on quote lines when quote is deleted', () => {
      const quoteLineRel = CRM2_ERD_RELATIONSHIPS.find((r) => r.relationshipId === 'REL-CRM2-03')!;
      expect(quoteLineRel.fromTable).toBe('crm2_quote_lines');
      expect(quoteLineRel.toTable).toBe('crm2_quotes');
      expect(quoteLineRel.onDelete).toBe('CASCADE');
      expect(quoteLineRel.enforcement).toBe('Database Foreign Key');
    });

    it('enforces PLT-03 boundary for CRM-1 contact reference (no direct cross-schema FK)', () => {
      const contactRel = CRM2_ERD_RELATIONSHIPS.find((r) => r.relationshipId === 'REL-CRM2-04')!;
      expect(contactRel.enforcement).toBe('Domain Application Guard');
      expect(contactRel.fromTable).toBe('crm2_deals');
      expect(contactRel.toTable).toBe('crm1_contacts');
    });
  });

  describe('3. Requirement-to-Test Traceability Matrix Invariants', () => {
    it('covers all module Must requirements', () => {
      const reqIds = CRM2_TRACEABILITY_MATRIX.map((r) => r.reqId);
      expect(reqIds).toContain('FR-CRM2-01'); // deals list, search, paging
      expect(reqIds).toContain('FR-CRM2-02'); // create/edit deal
      expect(reqIds).toContain('FR-CRM2-03'); // stage transitions
      expect(reqIds).toContain('FR-CRM2-04'); // orphan deals
      expect(reqIds).toContain('FR-CRM2-05'); // quotes
      expect(reqIds).toContain('FR-CRM2-06'); // decimal arithmetic
      expect(reqIds).toContain('FR-CRM2-07'); // fixed 6 stages
      expect(reqIds).toContain('FR-CRM2-08'); // deal.won event
      expect(reqIds).toContain('BR-CRM2-DUP-01'); // duplicate key
      expect(reqIds).toContain('MIG-CRM2-01'); // atomic import
      expect(reqIds).toContain('MIG-CRM2-02'); // conservation equation
    });

    it('maps every requirement to a non-empty test suite and test file', () => {
      for (const entry of CRM2_TRACEABILITY_MATRIX) {
        expect(entry.testFile.trim().length).toBeGreaterThan(0);
        expect(entry.testSuite.trim().length).toBeGreaterThan(0);
        expect(entry.verificationEvidence.trim().length).toBeGreaterThan(10);
      }
    });
  });

  describe('4. Dirty Data Pack Plan & Conservation Balance Sheet Invariants', () => {
    it('strictly satisfies conservation equation for 100-row module pack', () => {
      const plan = CRM2_DIRTY_DATA_PACK_PLAN.module100Plan;
      const result = assertConservationEquation({
        sourceCount: plan.totalSourceRows,
        loadedCount: plan.expectedLoaded,
        rejectedCount: plan.expectedRejected,
        mergedCount: plan.expectedMerged,
        skippedCount: plan.expectedSkipped,
      });

      expect(result.valid).toBe(true);
      expect(result.unaccounted).toBe(0);
      expect(result.terminalSum).toBe(100);
      expect(result.sourceCount).toBe(100);
    });

    it('strictly satisfies conservation equation for 1,000-row canonical integration pack', () => {
      const plan = CRM2_DIRTY_DATA_PACK_PLAN.canonical1000Plan;
      const result = assertConservationEquation({
        sourceCount: plan.totalSourceRows,
        loadedCount: plan.expectedLoaded,
        rejectedCount: plan.expectedRejected,
        mergedCount: plan.expectedMerged,
        skippedCount: plan.expectedSkipped,
      });

      expect(result.valid).toBe(true);
      expect(result.unaccounted).toBe(0);
      expect(result.terminalSum).toBe(1000);
      expect(result.sourceCount).toBe(1000);
    });

    it('detects unaccounted rows if counts violate conservation formula', () => {
      const invalidCounts = {
        sourceCount: 100,
        loadedCount: 70,
        rejectedCount: 15,
        mergedCount: 10,
        skippedCount: 0,
      };
      const result = assertConservationEquation(invalidCounts);
      expect(result.valid).toBe(false);
      expect(result.unaccounted).toBe(5);
    });

    it('contains seeded defect scenarios covering all required anomaly classes', () => {
      const scenarios = CRM2_DIRTY_DATA_PACK_PLAN.scenarios;
      expect(scenarios.length).toBeGreaterThanOrEqual(10);

      const categories = scenarios.map((s) => s.category);
      expect(categories).toContain('golden_baseline');
      expect(categories).toContain('exact_duplicate');
      expect(categories).toContain('malformed_syntax');
      expect(categories).toContain('missing_required');
      expect(categories).toContain('lifecycle_violation');
      expect(categories).toContain('referential_orphan');

      // Every rejected scenario must define a stable reason code
      const rejectedScenarios = scenarios.filter((s) => s.expectedOutcome === 'rejected');
      for (const s of rejectedScenarios) {
        expect(s.reasonCode).toBeDefined();
        expect(s.reasonCode!.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe('5. Deterministic Duplicate Key Builders', () => {
    it('normalizes deal business duplicate key deterministically', () => {
      const key1 = buildDealExactBusinessKey({
        name: '  Acme Infrastructure Deal  ',
        stageId: 'STAGE-111',
        contactId: 'CONTACT-222',
      });
      const key2 = buildDealExactBusinessKey({
        name: 'acme infrastructure deal',
        stageId: 'stage-111',
        contactId: 'contact-222',
      });

      expect(key1).toBe('acme infrastructure deal#stage-111#contact-222');
      expect(key1).toBe(key2);
    });

    it('maps missing contactId to "orphan" in deal duplicate key', () => {
      const key = buildDealExactBusinessKey({
        name: 'Orphan Opportunity',
        stageId: 'STAGE-NEW',
        contactId: null,
      });

      expect(key).toBe('orphan opportunity#stage-new#orphan');
    });

    it('normalizes quote unique key with uppercase and trimmed formatting', () => {
      const key1 = buildQuoteExactKey('  q-2026-001  ');
      const key2 = buildQuoteExactKey('Q-2026-001');

      expect(key1).toBe('Q-2026-001');
      expect(key1).toBe(key2);
    });
  });
});
