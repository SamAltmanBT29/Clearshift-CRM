import { describe, it, expect } from 'vitest';
import {
  CRM1_DATA_DICTIONARY,
  CRM1_ERD_RELATIONSHIPS,
  CRM1_TRACEABILITY_MATRIX,
  CRM1_DIRTY_DATA_PACK_PLAN,
  assertConservationEquation,
} from '../../src/domain/qa-specs.js';
import {
  crm1Companies,
  crm1Contacts,
  crm1Leads,
  crm1ImportBatches,
  crm1ImportReceipts,
  crm1ImportRejects,
} from '../../db/schema.js';
import { getTableColumns } from 'drizzle-orm';
import { normalizeEmail, normalizePhone, normalizeName, normalizeTaxNumber } from '@cs/core';
import {
  buildContactExactEmailKey,
  buildContactExactPhoneNameKey,
  buildCompanyExactTaxKey,
} from '@clearshift/contracts';

describe('CRM-1 QA Gate G1 Design Specifications (Issue #24 / [CRM1-24])', () => {
  describe('1. Data Dictionary Invariants & Schema Conformance', () => {
    it('defines specifications for all 6 CRM-1 core tables', () => {
      const expectedTables = [
        'crm1_companies',
        'crm1_contacts',
        'crm1_leads',
        'crm1_import_batches',
        'crm1_import_receipts',
        'crm1_import_rejects',
      ];
      const actualTables = CRM1_DATA_DICTIONARY.map((t) => t.tableName);
      expect(actualTables.sort()).toEqual(expectedTables.sort());
    });

    it('documents every column with type, nullability, constraint, business rule, and example', () => {
      for (const table of CRM1_DATA_DICTIONARY) {
        expect(table.columns.length).toBeGreaterThan(0);
        for (const col of table.columns) {
          expect(col.name).toBeDefined();
          expect(col.pgType).toBeDefined();
          expect(typeof col.nullable).toBe('boolean');
          expect(col.constraints.length).toBeGreaterThan(0);
          expect(col.businessRule.trim().length).toBeGreaterThan(5);
          // Example can be null only if nullable is true
          if (!col.nullable) {
            expect(col.example).not.toBeNull();
            expect(col.example).toBeDefined();
          }
        }
      }
    });

    it('strictly conforms to Drizzle ORM schema column names and nullability', () => {
      const tableMap = {
        crm1_companies: crm1Companies,
        crm1_contacts: crm1Contacts,
        crm1_leads: crm1Leads,
        crm1_import_batches: crm1ImportBatches,
        crm1_import_receipts: crm1ImportReceipts,
        crm1_import_rejects: crm1ImportRejects,
      };

      for (const tableDef of CRM1_DATA_DICTIONARY) {
        const drizzleTable = tableMap[tableDef.tableName as keyof typeof tableMap];
        expect(drizzleTable).toBeDefined();

        const drizzleColumns = getTableColumns(drizzleTable);
        const drizzleColNames = Object.values(drizzleColumns).map((c: any) => c.name);
        const dictColNames = tableDef.columns.map((c) => c.name);

        // Every Drizzle column must exist in data dictionary
        for (const drizzleCol of Object.values(drizzleColumns) as any[]) {
          expect(dictColNames).toContain(drizzleCol.name);

          const dictCol = tableDef.columns.find((c) => c.name === drizzleCol.name)!;
          // Check nullability alignment
          const drizzleNotNull = drizzleCol.notNull ?? false;
          expect(!dictCol.nullable).toBe(drizzleNotNull);
        }

        // Every dictionary column must exist in Drizzle schema
        for (const colName of dictColNames) {
          expect(drizzleColNames).toContain(colName);
        }
      }
    });

    it('documents primary key surrogate UUID constraint for every entity', () => {
      for (const table of CRM1_DATA_DICTIONARY) {
        const idCol = table.columns.find((c) => c.name === 'id');
        expect(idCol).toBeDefined();
        expect(idCol?.pgType).toBe('uuid');
        expect(idCol?.nullable).toBe(false);
        expect(idCol?.constraints.some((c) => c.toLowerCase().includes('primary key'))).toBe(true);
      }
    });
  });

  describe('2. Entity-Relationship Diagram (ERD) & Ownership Boundaries', () => {
    it('defines foreign key relationships with appropriate deletion restrict/cascade policies', () => {
      const rels = CRM1_ERD_RELATIONSHIPS;

      // Contact -> Company (RESTRICT)
      const contactCompanyRel = rels.find((r) => r.relationshipId === 'REL-CRM1-01');
      expect(contactCompanyRel).toBeDefined();
      expect(contactCompanyRel?.fromTable).toBe('crm1_contacts');
      expect(contactCompanyRel?.fromColumn).toBe('company_id');
      expect(contactCompanyRel?.toTable).toBe('crm1_companies');
      expect(contactCompanyRel?.onDelete).toBe('RESTRICT');

      // Lead -> Contact (RESTRICT)
      const leadContactRel = rels.find((r) => r.relationshipId === 'REL-CRM1-02');
      expect(leadContactRel).toBeDefined();
      expect(leadContactRel?.fromTable).toBe('crm1_leads');
      expect(leadContactRel?.fromColumn).toBe('contact_id');
      expect(leadContactRel?.toTable).toBe('crm1_contacts');
      expect(leadContactRel?.onDelete).toBe('RESTRICT');

      // Receipt -> Batch (CASCADE)
      const receiptBatchRel = rels.find((r) => r.relationshipId === 'REL-CRM1-03');
      expect(receiptBatchRel).toBeDefined();
      expect(receiptBatchRel?.fromTable).toBe('crm1_import_receipts');
      expect(receiptBatchRel?.fromColumn).toBe('batch_id');
      expect(receiptBatchRel?.toTable).toBe('crm1_import_batches');
      expect(receiptBatchRel?.onDelete).toBe('CASCADE');

      // Reject -> Batch (CASCADE)
      const rejectBatchRel = rels.find((r) => r.relationshipId === 'REL-CRM1-04');
      expect(rejectBatchRel).toBeDefined();
      expect(rejectBatchRel?.fromTable).toBe('crm1_import_rejects');
      expect(rejectBatchRel?.fromColumn).toBe('batch_id');
      expect(rejectBatchRel?.toTable).toBe('crm1_import_batches');
      expect(rejectBatchRel?.onDelete).toBe('CASCADE');
    });

    it('enforces boundary isolation: zero cross-module foreign key dependencies', () => {
      const allowedTables = [
        'crm1_companies',
        'crm1_contacts',
        'crm1_leads',
        'crm1_import_batches',
        'crm1_import_receipts',
        'crm1_import_rejects',
      ];

      for (const rel of CRM1_ERD_RELATIONSHIPS) {
        if (rel.enforcement === 'Database Foreign Key') {
          expect(allowedTables).toContain(rel.fromTable);
          expect(allowedTables).toContain(rel.toTable);
        }
      }
    });
  });

  describe('3. Requirement-to-Test Traceability Matrix Invariants', () => {
    it('covers all SDS §4.2 Must requirements with automated test mappings', () => {
      const sdsMustRequirements = [
        'FR-CRM1-01',
        'FR-CRM1-02',
        'FR-CRM1-03',
        'FR-CRM1-04',
        'FR-CRM1-05',
        'FR-CRM1-06',
        'FR-CRM1-07',
        'FR-CRM1-10',
        'FR-CRM1-14',
        'FR-CRM1-23',
      ];

      const mappedReqIds = CRM1_TRACEABILITY_MATRIX.map((m) => m.reqId);
      for (const req of sdsMustRequirements) {
        expect(mappedReqIds).toContain(req);
        const entry = CRM1_TRACEABILITY_MATRIX.find((m) => m.reqId === req);
        expect(entry?.priority).toBe('Must');
        expect(entry?.testFile.length).toBeGreaterThan(0);
        expect(entry?.testSuite.length).toBeGreaterThan(0);
      }
    });

    it('includes non-negotiable platform duplicate, security, and migration invariants', () => {
      const platformInvariants = [
        'BR-CRM1-DUP-01',
        'BR-CRM1-DUP-02',
        'BR-CRM1-DUP-03',
        'SEC-01',
        'SEC-02',
        'MIG-01',
        'MIG-02',
        'MIG-03',
      ];

      const mappedReqIds = CRM1_TRACEABILITY_MATRIX.map((m) => m.reqId);
      for (const inv of platformInvariants) {
        expect(mappedReqIds).toContain(inv);
      }
    });

    it('guarantees unique requirement IDs with no collisions', () => {
      const ids = CRM1_TRACEABILITY_MATRIX.map((m) => m.reqId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('4. Dirty Data Pack Plan & Defect Distribution', () => {
    it('verifies exact row conservation balance sheet for canonical 1,000-row pack', () => {
      const plan = CRM1_DIRTY_DATA_PACK_PLAN.canonical1000Plan;
      const result = assertConservationEquation(
        plan.totalSourceRows,
        plan.expectedLoaded,
        plan.expectedRejected,
        plan.expectedMerged,
        plan.expectedSkipped
      );

      expect(result.balanced).toBe(true);
      expect(result.unaccounted).toBe(0);
      expect(plan.expectedLoaded + plan.expectedRejected + plan.expectedMerged + plan.expectedSkipped).toBe(1000);
    });

    it('verifies exact row conservation balance sheet for module 100-row pack', () => {
      const plan = CRM1_DIRTY_DATA_PACK_PLAN.module100Plan;
      const result = assertConservationEquation(
        plan.totalSourceRows,
        plan.expectedLoaded,
        plan.expectedRejected,
        plan.expectedMerged,
        plan.expectedSkipped
      );

      expect(result.balanced).toBe(true);
      expect(result.unaccounted).toBe(0);
      expect(plan.expectedLoaded + plan.expectedRejected + plan.expectedMerged + plan.expectedSkipped).toBe(100);
    });

    it('scenario distribution sums to 100 rows for module pack', () => {
      const scenarios = CRM1_DIRTY_DATA_PACK_PLAN.scenarios;
      const sum100 = scenarios.reduce((acc, s) => acc + s.expectedCountIn100, 0);
      expect(sum100).toBe(100);
    });

    it('scenario distribution sums to 1,000 rows for canonical pack', () => {
      const scenarios = CRM1_DIRTY_DATA_PACK_PLAN.scenarios;
      const sum1000 = scenarios.reduce((acc, s) => acc + s.expectedCountIn1000, 0);
      expect(sum1000).toBe(1000);
    });

    it('validates deterministic key normalization for duplicate detection', () => {
      // 1. Normalized email exact key
      const email1 = '  Lead.Operations@ClearShift.EXAMPLE.com  ';
      const email2 = 'lead.operations@clearshift.example.com';
      expect(normalizeEmail(email1)).toBe(normalizeEmail(email2));
      expect(normalizeEmail(email1)).toBe('lead.operations@clearshift.example.com');

      // 2. Normalized phone + name compound key
      const phoneRaw = ' +1 (555) 019-2834 ';
      const nameRaw = '  Elena   Rostova  ';
      const normPhone = normalizePhone(phoneRaw);
      const normName = normalizeName(nameRaw);
      expect(normPhone).toBe('+15550192834');
      expect(normName).toBe('elena rostova');
      expect(buildContactExactPhoneNameKey(phoneRaw, 'Elena', 'Rostova')).toBe('+15550192834#elena rostova');

      // 3. Normalized company tax number key
      const taxRaw = ' US-EIN 12-345.678 ';
      expect(normalizeTaxNumber(taxRaw)).toBe('USEIN12345678');
      expect(buildCompanyExactTaxKey(taxRaw)).toBe('USEIN12345678');
    });

    it('ensures every rejection scenario specifies a valid reason code and non-PII sample record', () => {
      for (const scenario of CRM1_DIRTY_DATA_PACK_PLAN.scenarios) {
        if (scenario.expectedOutcome === 'rejected') {
          expect(scenario.reasonCode).toBeDefined();
          expect(scenario.reasonCode!.length).toBeGreaterThan(0);
          expect(scenario.sampleRecord).toBeDefined();
          // Verify no real credential/secret tokens
          const json = JSON.stringify(scenario.sampleRecord).toLowerCase();
          expect(json).not.toContain('password');
          expect(json).not.toContain('secret_123');
        }
      }
    });
  });
});
