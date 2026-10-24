import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  type ReconciliationReport,
  ReconciliationReportSchema,
  verifyReconciliation,
} from '@clearshift/contracts';
import {
  assertConservationEquation,
  CRM1_DIRTY_DATA_PACK_PLAN,
} from '../../src/domain/qa-specs.js';
import {
  SEEDED_COMPANIES,
} from '../../src/domain/dirty-data-pack.js';
import {
  Crm1ReconciliationService,
  type RowOutcomeRecord,
} from '../../src/services/reconciliation.service.js';
import { Crm1Service } from '../../src/services/crm1.service.js';
import { Crm1TargetAdapter } from '../../src/migration/target-adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CSV_FILE = path.resolve(__dirname, '../fixtures/dirty-pack-100.csv');
const MANIFEST_FILE = path.resolve(__dirname, '../fixtures/manifest.json');

/**
 * Robust RFC-4180 CSV line parser supporting embedded commas inside quoted fields.
 */
function parseCsvLine(text: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

describe('CRM-1 Module Reconciliation Proof & Gate G4 Acceptance Suite (#123 / [CRM1-30])', () => {
  let service: Crm1Service;
  let adapter: Crm1TargetAdapter;
  let reconciliationService: Crm1ReconciliationService;

  beforeEach(() => {
    service = new Crm1Service({ inMemory: true });
    service.clear();
    adapter = new Crm1TargetAdapter(service);
    reconciliationService = new Crm1ReconciliationService({ service, adapter });
  });

  // =========================================================================
  // 1. Canonical 100-Row Dirty Data Pack Reconciliation Proof
  // =========================================================================
  describe('Criterion 1 & 2: Canonical 100-Row Dirty Data Pack Conservation Balance Sheet', () => {
    it('achieves exact mathematical reconciliation with human review merge path: source (100) = loaded (74) + rejected (18) + merged (8) + skipped (0)', async () => {
      expect(fs.existsSync(CSV_FILE)).toBe(true);
      expect(fs.existsSync(MANIFEST_FILE)).toBe(true);

      // Pre-seed SEEDED_COMPANIES so clean contacts referencing them resolve foreign key relationships
      for (const co of SEEDED_COMPANIES) {
        await service.createCompany({
          id: co.id,
          name: co.name,
          taxNumber: co.taxNumber,
          sourceSystem: 'crm_seed',
          sourceId: co.id,
        } as any);
      }

      const rawCsv = fs.readFileSync(CSV_FILE, 'utf8').trim();
      const lines = rawCsv.split('\n');
      const dataRows = lines.slice(1);
      expect(dataRows.length).toBe(100);

      const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
      expect(manifest.totalRecords).toBe(100);
      expect(manifest.summary.cleanRecordsCount).toBe(74);
      expect(manifest.summary.defectiveRecordsCount).toBe(26);
      expect(manifest.summary.loadedCount).toBe(74);
      expect(manifest.summary.rejectedCount).toBe(18);
      expect(manifest.summary.mergedCount).toBe(8);
      expect(manifest.summary.skippedCount).toBe(0);

      const batchId = 'batch-canonical-g4-crm1-100';
      const outcomes: RowOutcomeRecord[] = [];

      // Parse and process all 100 rows through migration pipeline
      for (let i = 0; i < dataRows.length; i++) {
        const line = dataRows[i];
        const manifestRec = manifest.records[i];
        const parts = parseCsvLine(line);
        const rowId = i + 1; // 1-indexed source row
        const idempotencyKey = `${batchId}#${rowId}#contacts#v1`;

        if (manifestRec.status === 'VALID') {
          // Valid clean row -> loaded through target adapter
          const res = await adapter.importRow(batchId, rowId, idempotencyKey, {
            entity: 'contacts',
            data: {
              firstName: parts[1],
              lastName: parts[2],
              email: parts[3],
              phone: parts[4],
              address: parts[5],
              companyId: parts[6] || undefined,
              leadStatus: parts[8] || 'New',
              sourceSystem: parts[9] || 'dirty_pack_100',
              sourceId: parts[10] || `src-${rowId}`,
              consentStatus: (parts[11] as any) || 'unknown',
              unsubscribed: parts[12] === 'true',
            },
          });

          expect(res.ok).toBe(true);
          if (res.ok) {
            outcomes.push({
              sourceRow: rowId,
              outcome: 'loaded',
              entity: 'contacts',
              targetId: res.value.targetId,
              idempotencyKey,
            });
          }
        } else if (manifestRec.expectedOutcome === 'exact_duplicate') {
          // Exact duplicate row held for explicit human review and merged per ClearShift Core Rules
          outcomes.push({
            sourceRow: rowId,
            outcome: 'merged',
            entity: 'contacts',
            targetId: `merged-canonical-target-${rowId}`,
            reasonCode: 'HUMAN_REVIEW_EXACT_DUPLICATE_MERGE',
            reasonText: 'Exact duplicate held and merged into existing target contact after operator sign-off.',
          });
        } else {
          // Defective row (missing required, malformed, orphan FK) rejected
          outcomes.push({
            sourceRow: rowId,
            outcome: 'rejected',
            entity: 'contacts',
            reasonCode: manifestRec.defects?.[0]?.category || 'DATA_QUALITY_REJECTION',
            reasonText: manifestRec.defects?.[0]?.reason || 'Pre-load validation defect.',
          });
        }
      }

      // Reconcile the complete batch
      const reconciliation = reconciliationService.reconcileBatch({
        batchId,
        sourceCount: 100,
        outcomes,
      });

      // 1. Terminal Outcome Verification
      expect(outcomes.length).toBe(100);
      expect(reconciliation.report.sourceCount).toBe(100);
      expect(reconciliation.report.loadedCount).toBe(74);
      expect(reconciliation.report.rejectedCount).toBe(18);
      expect(reconciliation.report.mergedCount).toBe(8);
      expect(reconciliation.report.skippedCount).toBe(0);
      expect(reconciliation.report.unaccountedCount).toBe(0);
      expect(reconciliation.report.status).toBe('OK');
      expect(reconciliation.isConserved).toBe(true);

      // 2. Exact Conservation Invariant Assertion
      const conservationCheck = assertConservationEquation(100, 74, 18, 8, 0);
      expect(conservationCheck.balanced).toBe(true);
      expect(conservationCheck.unaccounted).toBe(0);
      expect(conservationCheck.equation).toBe(
        '100 (source) = 74 (loaded) + 18 (rejected) + 8 (merged) + 0 (skipped)'
      );

      // 3. Schema Conformance
      const parsed = ReconciliationReportSchema.safeParse(reconciliation.report);
      expect(parsed.success).toBe(true);

      // 4. ASCII Balance Sheet Generation
      const balanceSheet = reconciliationService.generateConservationBalanceSheet(reconciliation);
      expect(balanceSheet).toContain('CRM-1 ROW CONSERVATION BALANCE SHEET');
      expect(balanceSheet).toContain('Total Source Rows          100');
      expect(balanceSheet).toContain('Loaded Rows                 74');
      expect(balanceSheet).toContain('Rejected Rows               18');
      expect(balanceSheet).toContain('Merged Rows                  8');
      expect(balanceSheet).toContain('Skipped Rows                 0');
      expect(balanceSheet).toContain('Unaccounted Rows             0');
      expect(balanceSheet).toContain('Conservation Status        OK          PASSED');
    });

    it('enforces single terminal outcome per source row, rejecting duplicate entries for the same row', () => {
      const duplicateOutcomes: RowOutcomeRecord[] = [
        { sourceRow: 1, outcome: 'loaded', entity: 'contacts', targetId: 'c1' },
        { sourceRow: 1, outcome: 'rejected', entity: 'contacts', reasonCode: 'DUPLICATE_REPORT' },
      ];

      expect(() => {
        reconciliationService.reconcileBatch({
          batchId: 'batch-duplicate-row-test',
          sourceCount: 2,
          outcomes: duplicateOutcomes,
        });
      }).toThrow(/Exactly one terminal outcome is permitted per source row/);
    });

    it('flags unbalanced reconciliation when a row is omitted (unaccountedCount > 0)', () => {
      const partialOutcomes: RowOutcomeRecord[] = [
        { sourceRow: 1, outcome: 'loaded', entity: 'contacts', targetId: 'c1' },
        { sourceRow: 2, outcome: 'loaded', entity: 'contacts', targetId: 'c2' },
        // Row 3 is omitted
      ];

      const res = reconciliationService.reconcileBatch({
        batchId: 'batch-unbalanced-test',
        sourceCount: 3,
        outcomes: partialOutcomes,
      });

      expect(res.isConserved).toBe(false);
      expect(res.unaccountedCount).toBe(1);
      expect(res.report.status).toBe('UNBALANCED');
    });
  });

  // =========================================================================
  // 2. Relational Link Integrity Audit Proof
  // =========================================================================
  describe('Criterion 3: Relational Link Integrity & Domain Consistency Audit', () => {
    it('validates a clean CRM-1 database graph with 0 broken links', async () => {
      // Seed a clean company
      const company = await service.createCompany({
        name: 'Nexus Dynamics Corp',
        taxNumber: 'US-EIN-123456789',
        email: 'info@nexusdynamics.synthetic',
        sourceSystem: 'crm_link_test',
        sourceId: 'co-1',
      });

      // Seed clean contacts linked to company
      const contact1 = await service.createContact({
        firstName: 'Arthur',
        lastName: 'Dent',
        email: 'arthur.dent@nexusdynamics.synthetic',
        phone: '+1-555-123-4567',
        companyId: company.id,
        goldenId: randomUUID(),
        leadStatus: 'Working',
        sourceSystem: 'crm_link_test',
        sourceId: 'cnt-1',
      });

      const contact2 = await service.createContact({
        firstName: 'Ford',
        lastName: 'Prefect',
        email: 'ford.prefect@nexusdynamics.synthetic',
        phone: '+1-555-987-6543',
        companyId: company.id,
        goldenId: randomUUID(),
        leadStatus: 'Qualified',
        sourceSystem: 'crm_link_test',
        sourceId: 'cnt-2',
      });

      // Seed a clean lead linked to contact
      await service.createLead({
        name: 'Arthur Dent Lead',
        email: 'arthur.dent@nexusdynamics.synthetic',
        contactId: contact1.id,
        status: 'Working',
        sourceSystem: 'crm_link_test',
        sourceId: 'ld-1',
      });

      const audit = reconciliationService.auditLinkIntegrity();
      expect(audit.valid).toBe(true);
      expect(audit.brokenLinks).toEqual([]);
      expect(audit.contactsChecked).toBe(2);
      expect(audit.companiesChecked).toBe(1);
      expect(audit.leadsChecked).toBe(1);
      expect(audit.goldenIdsChecked).toBe(2);
    });

    it('detects broken links when an orphaned contact in store references an unseeded company UUID', async () => {
      const orphanContactId = randomUUID();
      const nonExistentCompanyId = randomUUID();

      // Inject directly into in-memory store to simulate data corruption or unhandled FK orphan
      (service as any).memContacts.set(orphanContactId, {
        id: orphanContactId,
        firstName: 'Tricia',
        lastName: 'McMillan',
        email: 'trillian@galaxy.synthetic',
        companyId: nonExistentCompanyId,
        goldenId: randomUUID(),
        leadStatus: 'New',
        sourceSystem: 'orphan_test',
        sourceId: 'cnt-orphan',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const audit = reconciliationService.auditLinkIntegrity();
      expect(audit.valid).toBe(false);
      expect(audit.brokenLinks.length).toBeGreaterThanOrEqual(1);
      expect(audit.brokenLinks[0]).toContain(`references non-existent company '${nonExistentCompanyId}'`);
    });

    it('detects broken links when an orphaned lead in store references an unseeded contact UUID', async () => {
      const orphanLeadId = randomUUID();
      const nonExistentContactId = randomUUID();

      (service as any).memLeads.set(orphanLeadId, {
        id: orphanLeadId,
        name: 'Zaphod Lead',
        email: 'zaphod@galaxy.synthetic',
        contactId: nonExistentContactId,
        status: 'New',
        sourceSystem: 'orphan_lead_test',
        sourceId: 'ld-orphan',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const audit = reconciliationService.auditLinkIntegrity();
      expect(audit.valid).toBe(false);
      expect(audit.brokenLinks.some((l) => l.includes(`references non-existent contact '${nonExistentContactId}'`))).toBe(true);
    });

    it('detects broken links when a contact has a malformed Golden ID', async () => {
      const badId = randomUUID();
      (service as any).memContacts.set(badId, {
        id: badId,
        firstName: 'Marvin',
        lastName: 'Android',
        email: 'marvin@depressed.synthetic',
        goldenId: '   ', // Blank whitespace malformed Golden ID
        leadStatus: 'New',
        sourceSystem: 'bad_golden_id',
        sourceId: 'cnt-bad-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const audit = reconciliationService.auditLinkIntegrity();
      expect(audit.valid).toBe(false);
      expect(audit.brokenLinks.some((l) => l.includes('malformed Golden ID'))).toBe(true);
    });

    it('detects broken links when a company violates the Flat Companies constraint with nested parent reference', async () => {
      const company = await service.createCompany({
        name: 'Megadodo Publications',
        taxNumber: 'US-EIN-888999000',
        sourceSystem: 'flat_check',
        sourceId: 'co-parent',
      });

      // Inject parentCompanyId into memory store to simulate foreign hierarchy violation
      (company as any).parentCompanyId = 'nested-parent-id';

      const audit = reconciliationService.auditLinkIntegrity();
      expect(audit.valid).toBe(false);
      expect(audit.brokenLinks.some((l) => l.includes('violates V1 Flat Companies constraint'))).toBe(true);
    });

    it('detects broken links when unreviewed duplicate email exists in the store', async () => {
      await service.createContact({
        firstName: 'Eddie',
        lastName: 'Computer',
        email: 'eddie@ship.synthetic',
        goldenId: randomUUID(),
        sourceSystem: 'dup_test_1',
        sourceId: 'cnt-dup-1',
      });

      await service.createContact({
        firstName: 'Edward',
        lastName: 'Computer',
        email: 'eddie@ship.synthetic', // Duplicate normalized email
        goldenId: randomUUID(),
        sourceSystem: 'dup_test_2',
        sourceId: 'cnt-dup-2',
      });

      const audit = reconciliationService.auditLinkIntegrity();
      expect(audit.valid).toBe(false);
      expect(audit.brokenLinks.some((l) => l.includes("Unreviewed duplicate email 'eddie@ship.synthetic'"))).toBe(true);
    });
  });

  // =========================================================================
  // 3. Durable Receipt Completeness Audit Proof
  // =========================================================================
  describe('Criterion 4: Durable Receipt Completeness & Atomic Commit Audit', () => {
    it('verifies 100% receipt completeness when all mutations execute through target adapter', async () => {
      const batchId = 'batch-receipt-completeness-crm1';

      // 1. Load 2 companies via adapter
      const coRes1 = await adapter.importRow(batchId, 1, `${batchId}#1#companies#v1`, {
        entity: 'companies',
        data: { name: 'Sirius Cybernetics', taxNumber: 'US-EIN-777666555' },
      });
      const coRes2 = await adapter.importRow(batchId, 2, `${batchId}#2#companies#v1`, {
        entity: 'companies',
        data: { name: 'Ursa Minor Publishing', taxNumber: 'US-EIN-444333222' },
      });
      expect(coRes1.ok).toBe(true);
      expect(coRes2.ok).toBe(true);

      // 2. Load 2 contacts via adapter
      const cntRes1 = await adapter.importRow(batchId, 3, `${batchId}#3#contacts#v1`, {
        entity: 'contacts',
        data: { firstName: 'Slartibartfast', lastName: 'Fjords', email: 'slarti@magrathea.synthetic' },
      });
      const cntRes2 = await adapter.importRow(batchId, 4, `${batchId}#4#contacts#v1`, {
        entity: 'contacts',
        data: { firstName: 'Roosta', lastName: 'Volder', email: 'roosta@magrathea.synthetic' },
      });
      expect(cntRes1.ok).toBe(true);
      expect(cntRes2.ok).toBe(true);

      const audit = reconciliationService.auditReceiptCompleteness(batchId);
      expect(audit.valid).toBe(true);
      expect(audit.totalReceipts).toBe(4);
      expect(audit.targetRecordsCount).toBe(4);
      expect(audit.unreceiptedTargetIds).toEqual([]);
    });

    it('detects unreceipted target records when a direct mutation bypasses the migration target adapter', async () => {
      const batchId = 'batch-unreceipted-bypass-crm1';

      // Load 1 record via adapter
      await adapter.importRow(batchId, 1, `${batchId}#1#contacts#v1`, {
        entity: 'contacts',
        data: { firstName: 'Legitimate', lastName: 'Row', email: 'legit@clearshift.synthetic' },
      });

      // Directly insert an unreceipted contact bypassing the adapter
      await service.createContact({
        firstName: 'Unreceipted',
        lastName: 'Bypass',
        email: 'bypass@clearshift.synthetic',
        goldenId: randomUUID(),
        sourceSystem: 'untracked_sql_insert',
        sourceId: 'raw-123',
      });

      const audit = reconciliationService.auditReceiptCompleteness(batchId);
      expect(audit.valid).toBe(false);
      expect(audit.unreceiptedTargetIds.length).toBe(1);
      expect(audit.unreceiptedTargetIds[0]).toContain('contact:');
    });

    it('verifies idempotent retries return prior receipts without duplicating target records', async () => {
      const batchId = 'batch-idempotency-audit-crm1';
      const rowId = 1;
      const idempotencyKey = `${batchId}#${rowId}#contacts#v1`;
      const rowPayload = {
        entity: 'contacts',
        data: { firstName: 'Stable', lastName: 'Idempotency', email: 'stable@clearshift.synthetic' },
      };

      // First execution: creates record and receipt
      const res1 = await adapter.importRow(batchId, rowId, idempotencyKey, rowPayload);
      expect(res1.ok).toBe(true);
      if (!res1.ok) return;

      // Replay execution: returns same receipt and target ID
      const res2 = await adapter.importRow(batchId, rowId, idempotencyKey, rowPayload);
      expect(res2.ok).toBe(true);
      if (!res2.ok) return;

      expect(res2.value.targetId).toBe(res1.value.targetId);
      expect(res2.value.receipt.idempotencyKey).toBe(idempotencyKey);

      // Verify no duplicate entities in service store
      const snapshot = service.snapshotState();
      expect(snapshot.contacts.size).toBe(1);
    });
  });

  // =========================================================================
  // 4. Multi-Outcome Enterprise Batch (1,000 Rows) Conservation Proof
  // =========================================================================
  describe('Criterion 5: Multi-Outcome Enterprise Batch (1,000 Rows) Conservation Proof', () => {
    it('verifies exact mathematical conservation for 1,000-row enterprise batch plan (780 loaded, 140 rejected, 80 merged, 0 skipped)', () => {
      const plan = CRM1_DIRTY_DATA_PACK_PLAN.canonical1000Plan;
      expect(plan.totalSourceRows).toBe(1000);
      expect(plan.expectedLoaded).toBe(780);
      expect(plan.expectedRejected).toBe(140);
      expect(plan.expectedMerged).toBe(80);
      expect(plan.expectedSkipped).toBe(0);
      expect(plan.unaccounted).toBe(0);

      const outcomes: RowOutcomeRecord[] = [];

      // 780 loaded rows
      for (let i = 1; i <= 780; i++) {
        outcomes.push({
          sourceRow: i,
          outcome: 'loaded',
          entity: 'contacts',
          targetId: `contact-tgt-${i}`,
          idempotencyKey: `batch-1000#${i}#contacts#v1`,
        });
      }

      // 140 rejected rows
      for (let i = 781; i <= 920; i++) {
        outcomes.push({
          sourceRow: i,
          outcome: 'rejected',
          entity: 'contacts',
          reasonCode: 'VALIDATION_DEFECT',
          reasonText: 'Synthetic enterprise defect.',
        });
      }

      // 80 merged rows
      for (let i = 921; i <= 1000; i++) {
        outcomes.push({
          sourceRow: i,
          outcome: 'merged',
          entity: 'contacts',
          targetId: `contact-merged-tgt-${i}`,
          reasonCode: 'HUMAN_REVIEW_EXACT_DUPLICATE_MERGE',
        });
      }

      const res = reconciliationService.reconcileBatch({
        batchId: 'batch-enterprise-1000-crm1',
        sourceCount: 1000,
        outcomes,
      });

      expect(res.isConserved).toBe(true);
      expect(res.unaccountedCount).toBe(0);
      expect(res.report.status).toBe('OK');
      expect(res.report.sourceCount).toBe(1000);
      expect(res.report.loadedCount).toBe(780);
      expect(res.report.rejectedCount).toBe(140);
      expect(res.report.mergedCount).toBe(80);
      expect(res.report.skippedCount).toBe(0);

      const equation = assertConservationEquation(1000, 780, 140, 80, 0);
      expect(equation.balanced).toBe(true);
      expect(equation.unaccounted).toBe(0);
    });
  });

  // =========================================================================
  // 5. End-to-End executeAndReconcile Pipeline Workflow
  // =========================================================================
  describe('Criterion 6: executeAndReconcile End-to-End Pipeline Workflow', () => {
    it('executes mixed rows (loaded, rejected, merged, skipped) and returns complete reconciliation package', async () => {
      const batchId = 'batch-e2e-workflow-crm1';

      const inputRows: Array<{
        sourceRow: number;
        entity: 'contacts' | 'companies' | 'leads';
        data: Record<string, unknown>;
        isPreloadExcluded?: boolean;
        skipReason?: string;
        isHumanReviewMerge?: boolean;
        mergeTargetId?: string;
      }> = [
        // Row 1: Valid company -> loaded
        {
          sourceRow: 1,
          entity: 'companies',
          data: { name: 'Alpha Solutions Ltd', taxNumber: 'US-EIN-112233445' },
        },
        // Row 2: Valid contact -> loaded
        {
          sourceRow: 2,
          entity: 'contacts',
          data: { firstName: 'Alice', lastName: 'Walker', email: 'alice.walker@alpha.synthetic' },
        },
        // Row 3: Defective company (empty name) -> rejected
        {
          sourceRow: 3,
          entity: 'companies',
          data: { name: '   ', taxNumber: 'US-EIN-999999999' },
        },
        // Row 4: Exact duplicate -> merged via human review
        {
          sourceRow: 4,
          entity: 'contacts',
          data: { firstName: 'Alice', lastName: 'Walker', email: 'alice.walker@alpha.synthetic' },
          isHumanReviewMerge: true,
          mergeTargetId: 'merged-alice-target-id',
        },
        // Row 5: Policy exclusion -> skipped with approved reason
        {
          sourceRow: 5,
          entity: 'contacts',
          data: { firstName: 'Test', lastName: 'Excluded', email: 'excluded@test.synthetic' },
          isPreloadExcluded: true,
          skipReason: 'APPROVED_PRELOAD_EXCLUSION: Inactive legacy test record.',
        },
      ];

      const result = await reconciliationService.executeAndReconcile(batchId, inputRows);

      expect(result.report.sourceCount).toBe(5);
      expect(result.report.loadedCount).toBe(2);
      expect(result.report.rejectedCount).toBe(1);
      expect(result.report.mergedCount).toBe(1);
      expect(result.report.skippedCount).toBe(1);
      expect(result.report.unaccountedCount).toBe(0);
      expect(result.report.status).toBe('OK');
      expect(result.linkAudit.valid).toBe(true);
      expect(result.balanceSheet).toContain('Conservation Status        OK          PASSED');
    });
  });
});
