import { describe, it, expect } from 'vitest';
import {
  CRM4_DATA_DICTIONARY,
  CRM4_ERD_RELATIONSHIPS,
  CRM4_TRACEABILITY_MATRIX,
  CRM4_DIRTY_DATA_PACK_PLAN,
  assertConservationEquation,
  buildListExactKey,
  buildListBusinessKey,
  buildCampaignExactKey,
  buildMemberExactKey,
  buildConsentExactKey,
  evaluateConsentMonotonicity,
} from '../../src/domain/qa-specs.js';
import {
  crm4Lists,
  crm4Campaigns,
  crm4Members,
  crm4Consents,
  crm4ImportBatches,
  crm4ImportReceipts,
  crm4ImportRejects,
} from '../../db/schema.js';
import { getTableColumns } from 'drizzle-orm';

describe('CRM-4 QA Gate G1 Design Specifications (Issue #177 / [CRM4-24])', () => {
  describe('1. Data Dictionary Invariants & Schema Conformance', () => {
    it('defines specifications for all 7 CRM-4 core and migration tables', () => {
      const expectedTables = [
        'crm4_lists',
        'crm4_campaigns',
        'crm4_members',
        'crm4_consents',
        'crm4_import_batches',
        'crm4_import_receipts',
        'crm4_import_rejects',
      ];
      const actualTables = CRM4_DATA_DICTIONARY.map((t) => t.tableName);
      expect(actualTables.sort()).toEqual(expectedTables.sort());
    });

    it('documents every column with type, nullability, constraint, business rule, and example', () => {
      for (const table of CRM4_DATA_DICTIONARY) {
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
        crm4_lists: crm4Lists,
        crm4_campaigns: crm4Campaigns,
        crm4_members: crm4Members,
        crm4_consents: crm4Consents,
        crm4_import_batches: crm4ImportBatches,
        crm4_import_receipts: crm4ImportReceipts,
        crm4_import_rejects: crm4ImportRejects,
      };

      for (const tableDef of CRM4_DATA_DICTIONARY) {
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

    it('verifies non-negative constraints on counter columns', () => {
      const listsTable = CRM4_DATA_DICTIONARY.find((t) => t.tableName === 'crm4_lists')!;
      const campaignCountCol = listsTable.columns.find((c) => c.name === 'campaign_count')!;
      expect(campaignCountCol.pgType).toBe('integer');
      expect(campaignCountCol.constraints).toContain('chk_crm4_lists_campaign_count_nonnegative');

      const memberCountCol = listsTable.columns.find((c) => c.name === 'member_count')!;
      expect(memberCountCol.pgType).toBe('integer');
      expect(memberCountCol.constraints).toContain('chk_crm4_lists_member_count_nonnegative');

      const campaignsTable = CRM4_DATA_DICTIONARY.find((t) => t.tableName === 'crm4_campaigns')!;
      const campMemberCol = campaignsTable.columns.find((c) => c.name === 'member_count')!;
      expect(campMemberCol.pgType).toBe('integer');
      expect(campMemberCol.constraints).toContain('chk_crm4_campaigns_member_count_nonnegative');
    });

    it('verifies member status allowlist constraint', () => {
      const membersTable = CRM4_DATA_DICTIONARY.find((t) => t.tableName === 'crm4_members')!;
      const statusCol = membersTable.columns.find((c) => c.name === 'status')!;
      expect(statusCol.constraints).toContain('chk_crm4_members_status_valid');
      expect(statusCol.businessRule).toContain('sent');
      expect(statusCol.businessRule).toContain('opened');
      expect(statusCol.businessRule).toContain('clicked');
    });

    it('verifies consent status allowlist constraint and monotonic opt-out rule', () => {
      const consentsTable = CRM4_DATA_DICTIONARY.find((t) => t.tableName === 'crm4_consents')!;
      const statusCol = consentsTable.columns.find((c) => c.name === 'status')!;
      expect(statusCol.constraints).toContain('chk_crm4_consents_status_valid');
      expect(statusCol.constraints).toContain('BR-CRM4-01');
    });
  });

  describe('2. ERD Relationship Invariants & Master-Data Ownership', () => {
    it('defines 7 relational edges covering all parent-child and cross-module boundaries', () => {
      expect(CRM4_ERD_RELATIONSHIPS.length).toBe(7);
    });

    it('enforces RESTRICT and immutability on campaign list link', () => {
      const listRel = CRM4_ERD_RELATIONSHIPS.find((r) => r.relationshipId === 'REL-CRM4-01')!;
      expect(listRel.fromTable).toBe('crm4_campaigns');
      expect(listRel.fromColumn).toBe('list_id');
      expect(listRel.toTable).toBe('crm4_lists');
      expect(listRel.toColumn).toBe('id');
      expect(listRel.onDelete).toBe('RESTRICT');
      expect(listRel.description).toContain('Immutable');
    });

    it('enforces CASCADE deletion on campaign members when parent campaign is deleted', () => {
      const memberRel = CRM4_ERD_RELATIONSHIPS.find((r) => r.relationshipId === 'REL-CRM4-02')!;
      expect(memberRel.fromTable).toBe('crm4_members');
      expect(memberRel.toTable).toBe('crm4_campaigns');
      expect(memberRel.onDelete).toBe('CASCADE');
      expect(memberRel.enforcement).toBe('Database Foreign Key');
    });

    it('enforces Domain Application Guard without SQL FKs on cross-module CRM-1 contacts', () => {
      const contactMemberRel = CRM4_ERD_RELATIONSHIPS.find((r) => r.relationshipId === 'REL-CRM4-03')!;
      expect(contactMemberRel.toTable).toBe('crm1_contacts');
      expect(contactMemberRel.enforcement).toBe('Domain Application Guard');

      const contactConsentRel = CRM4_ERD_RELATIONSHIPS.find((r) => r.relationshipId === 'REL-CRM4-04')!;
      expect(contactConsentRel.toTable).toBe('crm1_contacts');
      expect(contactConsentRel.cardinality).toBe('1:1');
      expect(contactConsentRel.enforcement).toBe('Domain Application Guard');
    });

    it('enforces CASCADE deletion on migration receipts and rejects when batch is deleted', () => {
      const receiptRel = CRM4_ERD_RELATIONSHIPS.find((r) => r.relationshipId === 'REL-CRM4-05')!;
      expect(receiptRel.onDelete).toBe('CASCADE');

      const rejectRel = CRM4_ERD_RELATIONSHIPS.find((r) => r.relationshipId === 'REL-CRM4-06')!;
      expect(rejectRel.onDelete).toBe('CASCADE');
    });
  });

  describe('3. Requirement Traceability Matrix', () => {
    it('covers all Must requirements from SDS §4.5, §7.1, and ClearShift Core Rules', () => {
      const mustReqs = [
        'FR-CRM4-01',
        'FR-CRM4-02',
        'FR-CRM4-03',
        'FR-CRM4-04',
        'FR-CRM4-05',
        'BR-CRM4-01',
        'FR-CRM4-10',
        'FR-CRM4-11',
        'BR-CRM4-DUP-01',
        'BR-CRM4-DUP-02',
        'BR-CRM4-DUP-03',
        'MIG-CRM4-01',
        'MIG-CRM4-02',
        'MIG-CRM4-03',
      ];

      const trackedReqIds = CRM4_TRACEABILITY_MATRIX.map((r) => r.reqId);
      for (const reqId of mustReqs) {
        expect(trackedReqIds).toContain(reqId);
      }
    });

    it('maps every traceability entry to a valid test file and verification evidence', () => {
      for (const entry of CRM4_TRACEABILITY_MATRIX) {
        expect(entry.testFile.startsWith('apps/crm/modules/crm-4/')).toBe(true);
        expect(entry.verificationEvidence.length).toBeGreaterThan(10);
        expect(entry.testSuite.length).toBeGreaterThan(5);
      }
    });
  });

  describe('4. Dirty Data Pack Plan & Row Conservation', () => {
    it('strictly satisfies conservation equation on 100-row module pack', () => {
      const plan = CRM4_DIRTY_DATA_PACK_PLAN.module100Plan;
      expect(plan.totalSourceRows).toBe(100);

      const result = assertConservationEquation({
        totalSourceRows: plan.totalSourceRows,
        loaded: plan.expectedLoaded,
        rejected: plan.expectedRejected,
        merged: plan.expectedMerged,
        skipped: plan.expectedSkipped,
      });

      expect(result.isConserved).toBe(true);
      expect(result.unaccounted).toBe(0);
      expect(result.status).toBe('OK');
    });

    it('strictly satisfies conservation equation on 1,000-row canonical pack', () => {
      const plan = CRM4_DIRTY_DATA_PACK_PLAN.canonical1000Plan;
      expect(plan.totalSourceRows).toBe(1000);

      const result = assertConservationEquation({
        totalSourceRows: plan.totalSourceRows,
        loaded: plan.expectedLoaded,
        rejected: plan.expectedRejected,
        merged: plan.expectedMerged,
        skipped: plan.expectedSkipped,
      });

      expect(result.isConserved).toBe(true);
      expect(result.unaccounted).toBe(0);
      expect(result.status).toBe('OK');
    });

    it('verifies scenarios sum up exactly to 100 rows in module pack', () => {
      const scenarios = CRM4_DIRTY_DATA_PACK_PLAN.scenarios;
      const sum100 = scenarios.reduce((acc, s) => acc + s.expectedCountIn100, 0);
      expect(sum100).toBe(100);
    });

    it('verifies scenarios sum up exactly to 1,000 rows in canonical pack', () => {
      const scenarios = CRM4_DIRTY_DATA_PACK_PLAN.scenarios;
      const sum1000 = scenarios.reduce((acc, s) => acc + s.expectedCountIn1000, 0);
      expect(sum1000).toBe(1000);
    });

    it('verifies non-empty reason codes on all rejected defect scenarios', () => {
      const rejectedScenarios = CRM4_DIRTY_DATA_PACK_PLAN.scenarios.filter(
        (s) => s.expectedOutcome === 'rejected'
      );
      expect(rejectedScenarios.length).toBeGreaterThanOrEqual(5);
      for (const scenario of rejectedScenarios) {
        expect(scenario.reasonCode).toBeDefined();
        expect(scenario.reasonCode!.length).toBeGreaterThan(3);
      }
    });

    it('verifies non-empty reason codes on all merged defect scenarios', () => {
      const mergedScenarios = CRM4_DIRTY_DATA_PACK_PLAN.scenarios.filter(
        (s) => s.expectedOutcome === 'merged'
      );
      expect(mergedScenarios.length).toBeGreaterThanOrEqual(2);
      for (const scenario of mergedScenarios) {
        expect(scenario.reasonCode).toBeDefined();
        expect(scenario.reasonCode!.length).toBeGreaterThan(3);
      }
    });

    it('flags conservation failure if unaccounted rows exist', () => {
      const invalidSummary = {
        totalSourceRows: 100,
        loaded: 70,
        rejected: 15,
        merged: 5,
        skipped: 0,
      };
      const result = assertConservationEquation(invalidSummary);
      expect(result.isConserved).toBe(false);
      expect(result.unaccounted).toBe(10);
      expect(result.status).toBe('NOT_CONSERVED');
    });
  });

  describe('5. Deterministic Duplicate Matching & Exact Keys', () => {
    it('builds normalized candidate keys for marketing lists', () => {
      const key1 = buildListExactKey('  Hubspot_Legacy  ', '  LST-9001  ');
      expect(key1).toBe('hubspot_legacy#lst-9001');

      const bizKey = buildListBusinessKey('  Q4   Enterprise   Prospects  ');
      expect(bizKey).toBe('q4 enterprise prospects');
    });

    it('builds normalized candidate composite key for campaigns', () => {
      const key = buildCampaignExactKey(
        '  Developer   Workshop  ',
        '44444444-1111-4444-8444-000000000001',
        ' 2026-11-15 '
      );
      expect(key).toBe('developer   workshop#44444444-1111-4444-8444-000000000001#2026-11-15');
    });

    it('builds normalized candidate key for campaign members', () => {
      const key = buildMemberExactKey(
        '44444444-2222-4444-8444-000000000001',
        '11111111-1111-4111-8111-000000000001'
      );
      expect(key).toBe('44444444-2222-4444-8444-000000000001#11111111-1111-4111-8111-000000000001');
    });

    it('builds candidate key for contact consent', () => {
      const key = buildConsentExactKey('  11111111-1111-4111-8111-000000000001  ');
      expect(key).toBe('11111111-1111-4111-8111-000000000001');
    });
  });

  describe('6. Monotonic Opt-Out Engine (BR-CRM4-01)', () => {
    it('permits initial subscription when no prior consent exists', () => {
      const result = evaluateConsentMonotonicity(null, 'subscribed');
      expect(result.permitted).toBe(true);
    });

    it('permits transition from subscribed to unsubscribed', () => {
      const result = evaluateConsentMonotonicity('subscribed', 'unsubscribed');
      expect(result.permitted).toBe(true);
    });

    it('strictly forbids and rejects transition from unsubscribed to subscribed', () => {
      const result = evaluateConsentMonotonicity('unsubscribed', 'subscribed');
      expect(result.permitted).toBe(false);
      expect(result.reason).toContain('BR-CRM4-01');
    });

    it('permits idempotent unsubscribed confirmation', () => {
      const result = evaluateConsentMonotonicity('unsubscribed', 'unsubscribed');
      expect(result.permitted).toBe(true);
    });
  });
});
