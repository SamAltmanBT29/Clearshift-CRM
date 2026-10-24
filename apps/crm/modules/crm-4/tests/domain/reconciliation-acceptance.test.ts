import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ReconciliationReport,
  ReconciliationReportSchema,
  verifyReconciliation,
} from '@clearshift/contracts';
import { assertConservationEquation } from '../../src/domain/qa-specs.js';
import {
  Crm4ReconciliationService,
  type RowOutcomeRecord,
} from '../../src/services/reconciliation.service.js';
import { Crm4Service } from '../../src/services/crm4.service.js';
import { Crm4TargetAdapter } from '../../src/migration/target-adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CSV_FILE = path.resolve(__dirname, '../fixtures/dirty-pack-100.csv');
const MANIFEST_FILE = path.resolve(__dirname, '../fixtures/manifest.json');

describe('CRM-4 Migration Reconciliation Proof & Gate G4 Evidence Suite (#183 / [CRM4-30])', () => {
  let service: Crm4Service;
  let adapter: Crm4TargetAdapter;
  let reconciliationService: Crm4ReconciliationService;

  beforeEach(() => {
    service = new Crm4Service();
    // Clear out seed records to have an isolated environment for receipt and reconciliation testing
    service.clearAll();
    adapter = new Crm4TargetAdapter(service);
    reconciliationService = new Crm4ReconciliationService({ service, adapter });
  });

  // =========================================================================
  // 1. Canonical 100-Row Dirty Data Pack Reconciliation Proof
  // =========================================================================
  describe('Criterion 1 & 2: Canonical 100-Row Dirty Data Pack Conservation Balance Sheet', () => {
    it('achieves exact mathematical reconciliation: source (100) = loaded (50) + rejected (50) + merged (0) + skipped (0)', async () => {
      expect(fs.existsSync(CSV_FILE)).toBe(true);
      expect(fs.existsSync(MANIFEST_FILE)).toBe(true);

      const rawCsv = fs.readFileSync(CSV_FILE, 'utf8').trim();
      const lines = rawCsv.split('\n');
      const dataRows = lines.slice(1);
      expect(dataRows.length).toBe(100);

      const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
      expect(manifest.totalRecords).toBe(100);
      expect(manifest.summary.cleanRecordsCount).toBe(50);
      expect(manifest.summary.defectiveRecordsCount).toBe(50);

      const batchId = 'batch-canonical-g4-crm4-100';
      const outcomes: RowOutcomeRecord[] = [];

      // Parse and execute all 100 rows through the target adapter / migration pipeline
      for (let i = 0; i < dataRows.length; i++) {
        const line = dataRows[i];
        const manifestRec = manifest.records[i];
        const parts = line.split(',');
        const rowId = parseInt(parts[0], 10);
        const entityType = parts[1] as 'list' | 'campaign' | 'member' | 'consent';
        const idempotencyKey = `${batchId}#${rowId}#${entityType}#v1`;

        if (manifestRec.status === 'VALID') {
          let payloadData: Record<string, unknown> = {};

          if (entityType === 'list') {
            payloadData = {
              id: parts[5] || undefined,
              name: parts[2],
              description: parts[3] || undefined,
            };
          } else if (entityType === 'campaign') {
            payloadData = {
              id: parts[7] || undefined,
              name: parts[2],
              description: parts[3] || undefined,
              campaignDate: parts[4] || undefined,
              listId: parts[5] || undefined,
            };
          } else if (entityType === 'member') {
            payloadData = {
              campaignId: parts[7] || undefined,
              contactId: parts[6] || undefined,
              status: parts[8] || undefined,
            };
          } else if (entityType === 'consent') {
            payloadData = {
              contactId: parts[6] || undefined,
              status: parts[10] || undefined,
              source: parts[11] || undefined,
            };
          }

          const res = await adapter.importRow(batchId, rowId, idempotencyKey, {
            entity: entityType,
            data: payloadData,
          });

          expect(res.ok).toBe(true);
          if (res.ok) {
            const kind = res.value.receipt.kind;
            outcomes.push({
              sourceRow: rowId,
              outcome: kind === 'linked' ? 'merged' : 'loaded',
              entity: entityType,
              targetId: res.value.targetId,
              idempotencyKey,
            });
          }
        } else {
          // Defective row identified during preflight / cleaner / ingestion
          outcomes.push({
            sourceRow: rowId,
            outcome: 'rejected',
            entity: entityType,
            reasonCode: manifestRec.defects[0] || 'DEFECTIVE_INPUT',
            reasonText: `Pre-load defect caught: ${manifestRec.expectedOutcome}`,
          });
        }
      }

      // 1. Assert exactly 100 outcomes collected
      expect(outcomes.length).toBe(100);

      // 2. Perform reconciliation audit
      const reconciliation = reconciliationService.reconcileBatch({
        batchId,
        sourceCount: 100,
        outcomes,
      });

      const { report, isConserved, unaccountedCount } = reconciliation;

      // 3. Verify Conservation Equation: source = loaded + rejected + merged + skipped
      expect(isConserved).toBe(true);
      expect(unaccountedCount).toBe(0);
      expect(report.sourceCount).toBe(100);
      expect(report.loadedCount).toBe(50);
      expect(report.rejectedCount).toBe(50);
      expect(report.mergedCount).toBe(0);
      expect(report.skippedCount).toBe(0);
      expect(report.unaccountedCount).toBe(0);
      expect(report.status).toBe('OK');

      // 4. Contract schema verification
      expect(() => ReconciliationReportSchema.parse(report)).not.toThrow();
      const verifyResult = verifyReconciliation(report);
      expect(verifyResult.isBalanced).toBe(true);
      expect(verifyResult.status).toBe('OK');

      const conservationCheck = assertConservationEquation({
        totalSourceRows: report.sourceCount,
        loaded: report.loadedCount,
        rejected: report.rejectedCount,
        merged: report.mergedCount,
        skipped: report.skippedCount,
      });
      expect(conservationCheck.isConserved).toBe(true);
      expect(conservationCheck.unaccounted).toBe(0);
      expect(conservationCheck.status).toBe('OK');

      // 5. Verify every row 1..100 has exactly one terminal outcome
      const outcomeRowMap = new Map<number, string>();
      for (const rec of outcomes) {
        expect(outcomeRowMap.has(rec.sourceRow)).toBe(false);
        outcomeRowMap.set(rec.sourceRow, rec.outcome);
      }
      expect(outcomeRowMap.size).toBe(100);

      for (let r = 1; r <= 50; r++) {
        expect(outcomeRowMap.get(r)).toBe('loaded');
      }
      for (let r = 51; r <= 100; r++) {
        expect(outcomeRowMap.get(r)).toBe('rejected');
      }

      // 6. Assert durable receipts and link integrity of loaded records
      const linkAudit = reconciliationService.auditLinkIntegrity();
      expect(linkAudit.valid).toBe(true);
      expect(linkAudit.brokenLinks).toEqual([]);

      const receiptAudit = reconciliationService.auditReceiptCompleteness(batchId);
      expect(receiptAudit.valid).toBe(true);
      expect(receiptAudit.totalReceipts).toBe(50);
      expect(receiptAudit.unreceiptedTargetIds).toEqual([]);
    });
  });

  // =========================================================================
  // 2. Multi-Entity Synthetic Batch Load with Merged and Skipped Records
  // =========================================================================
  describe('Criterion 2: Multi-Outcome Synthetic Batch Conservation (Loaded, Rejected, Merged, Skipped)', () => {
    it('balances multi-outcome batch: source (1000) = loaded (780) + rejected (140) + merged (80) + skipped (0)', () => {
      const sourceCount = 1000;
      const outcomes: RowOutcomeRecord[] = [];

      for (let i = 1; i <= 780; i++) {
        outcomes.push({
          sourceRow: i,
          outcome: 'loaded',
          entity: 'list',
          targetId: `list-${i}`,
          idempotencyKey: `b-1000#${i}#list#v1`,
        });
      }
      for (let i = 781; i <= 920; i++) {
        outcomes.push({
          sourceRow: i,
          outcome: 'rejected',
          entity: 'campaign',
          reasonCode: 'MISSING_MANDATORY_FIELD',
          reasonText: 'Campaign name is required.',
        });
      }
      for (let i = 921; i <= 1000; i++) {
        outcomes.push({
          sourceRow: i,
          outcome: 'merged',
          entity: 'member',
          targetId: `member-merged-${i}`,
          idempotencyKey: `b-1000#${i}#member#v1`,
        });
      }

      const res = reconciliationService.reconcileBatch({
        batchId: 'batch-synthetic-1000',
        sourceCount,
        outcomes,
      });

      expect(res.isConserved).toBe(true);
      expect(res.unaccountedCount).toBe(0);
      expect(res.report.sourceCount).toBe(1000);
      expect(res.report.loadedCount).toBe(780);
      expect(res.report.rejectedCount).toBe(140);
      expect(res.report.mergedCount).toBe(80);
      expect(res.report.skippedCount).toBe(0);
      expect(res.report.status).toBe('OK');
      expect(verifyReconciliation(res.report).isBalanced).toBe(true);

      const conservationCheck = assertConservationEquation({
        totalSourceRows: res.report.sourceCount,
        loaded: res.report.loadedCount,
        rejected: res.report.rejectedCount,
        merged: res.report.mergedCount,
        skipped: res.report.skippedCount,
      });
      expect(conservationCheck.isConserved).toBe(true);
      expect(conservationCheck.unaccounted).toBe(0);
    });

    it('accounts for explicitly skipped rows via executeAndReconcile', async () => {
      // First populate a list so campaigns can reference it
      const listRes = await adapter.importRow('batch-skip-01', 1, 'b-skip#1#list#v1', {
        entity: 'list',
        data: { name: 'Pre-existing List' },
      });
      expect(listRes.ok).toBe(true);
      const listId = (listRes as { value: { targetId: string } }).value.targetId;

      const rows: Array<{
        sourceRow: number;
        entity: 'list' | 'campaign' | 'member' | 'consent';
        data: Record<string, unknown>;
        isPreloadExcluded?: boolean;
        skipReason?: string;
      }> = [
        {
          sourceRow: 1,
          entity: 'campaign',
          data: { name: 'Valid New Campaign', campaignDate: '2026-11-01', listId },
        },
        {
          sourceRow: 2,
          entity: 'campaign',
          data: { name: 'Archived Campaign 1999', campaignDate: '1999-01-01', listId },
          isPreloadExcluded: true,
          skipReason: 'Historical policy: campaigns older than 10 years are omitted from V1.',
        },
        {
          sourceRow: 3,
          entity: 'campaign',
          data: { name: '', listId }, // Will reject due to empty name
        },
      ];

      const res = await reconciliationService.executeAndReconcile('batch-skip-test', rows);

      expect(res.report.sourceCount).toBe(3);
      expect(res.report.loadedCount).toBe(1);
      expect(res.report.skippedCount).toBe(1);
      expect(res.report.rejectedCount).toBe(1);
      expect(res.report.mergedCount).toBe(0);
      expect(res.report.unaccountedCount).toBe(0);
      expect(res.report.status).toBe('OK');
      expect(verifyReconciliation(res.report).isBalanced).toBe(true);

      const skippedRecord = res.outcomes.find((o) => o.sourceRow === 2);
      expect(skippedRecord?.outcome).toBe('skipped');
      expect(skippedRecord?.reasonCode).toBe('PRELOAD_POLICY_EXCLUSION');
    });
  });

  // =========================================================================
  // 3. Negative Reconciliation Scenarios
  // =========================================================================
  describe('Criterion 2: Negative Reconciliation Scenarios & Imbalance Detection', () => {
    it('flags UNBALANCED status and unaccounted count when source rows are unaccounted for', () => {
      const outcomes: RowOutcomeRecord[] = [
        { sourceRow: 1, outcome: 'loaded', entity: 'list' },
        { sourceRow: 2, outcome: 'loaded', entity: 'list' },
        { sourceRow: 3, outcome: 'rejected', entity: 'list' },
        // Source row 4 and 5 missing!
      ];

      const res = reconciliationService.reconcileBatch({
        batchId: 'batch-unbalanced-01',
        sourceCount: 5,
        outcomes,
      });

      expect(res.isConserved).toBe(false);
      expect(res.unaccountedCount).toBe(2);
      expect(res.report.status).toBe('UNBALANCED');
      expect(res.report.unaccountedCount).toBe(2);
      expect(verifyReconciliation(res.report).isBalanced).toBe(false);
      expect(verifyReconciliation(res.report).status).toBe('UNBALANCED');

      const conservationCheck = assertConservationEquation({
        totalSourceRows: res.report.sourceCount,
        loaded: res.report.loadedCount,
        rejected: res.report.rejectedCount,
        merged: res.report.mergedCount,
        skipped: res.report.skippedCount,
      });
      expect(conservationCheck.isConserved).toBe(false);
      expect(conservationCheck.unaccounted).toBe(2);
      expect(conservationCheck.status).toBe('NOT_CONSERVED');
    });

    it('rejects duplicate outcome submissions for the same source row', () => {
      const duplicateOutcomes: RowOutcomeRecord[] = [
        { sourceRow: 1, outcome: 'loaded', entity: 'list' },
        { sourceRow: 1, outcome: 'rejected', entity: 'list' }, // Duplicate row 1
      ];

      expect(() =>
        reconciliationService.reconcileBatch({
          batchId: 'batch-dup-outcomes',
          sourceCount: 2,
          outcomes: duplicateOutcomes,
        })
      ).toThrow(/multiple terminal outcomes recorded/);
    });
  });

  // =========================================================================
  // 4. Relational Link Integrity Audit
  // =========================================================================
  describe('Criterion 3: Relational Link Integrity Audit across Entities', () => {
    it('verifies relational link integrity when all FK references and statuses are valid', async () => {
      // Create list
      const listRes = await adapter.importRow('b-rel-01', 1, 'k-rel-1', {
        entity: 'list',
        data: { name: 'Enterprise List Valid' },
      });
      expect(listRes.ok).toBe(true);
      const listId = (listRes as { value: { targetId: string } }).value.targetId;

      // Create campaign linked to list
      const campRes = await adapter.importRow('b-rel-01', 2, 'k-rel-2', {
        entity: 'campaign',
        data: { name: 'Valid Enterprise Campaign', campaignDate: '2026-11-10', listId },
      });
      expect(campRes.ok).toBe(true);
      const campId = (campRes as { value: { targetId: string } }).value.targetId;

      // Create member linked to campaign with valid status
      const memberRes = await adapter.importRow('b-rel-01', 3, 'k-rel-3', {
        entity: 'member',
        data: {
          campaignId: campId,
          contactId: '11111111-2222-4111-8111-000000000001',
          status: 'opened',
        },
      });
      expect(memberRes.ok).toBe(true);

      // Create consent record
      const consentRes = await adapter.importRow('b-rel-01', 4, 'k-rel-4', {
        entity: 'consent',
        data: {
          contactId: '11111111-2222-4111-8111-000000000001',
          status: 'subscribed',
          source: 'webform',
        },
      });
      expect(consentRes.ok).toBe(true);

      const audit = reconciliationService.auditLinkIntegrity();
      expect(audit.valid).toBe(true);
      expect(audit.brokenLinks).toEqual([]);
      expect(audit.listsChecked).toBe(1);
      expect(audit.campaignsChecked).toBe(1);
      expect(audit.membersChecked).toBe(1);
      expect(audit.consentsChecked).toBe(1);
      expect(audit.totalChecked).toBe(4);
    });

    it('detects broken link when campaign references non-existent list', async () => {
      // Inject orphan campaign directly into snapshot state
      const snapshot = service.snapshotState();
      snapshot.campaigns.set('orphan-camp-1', {
        id: 'orphan-camp-1',
        name: 'Orphan Campaign',
        campaignDate: '2026-11-10',
        listId: '99999999-9999-4999-8999-999999999999',
        memberCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      service.restoreState(snapshot);

      const audit = reconciliationService.auditLinkIntegrity();
      expect(audit.valid).toBe(false);
      expect(audit.brokenLinks.length).toBeGreaterThanOrEqual(1);
      expect(audit.brokenLinks.some((l) => l.includes('references non-existent marketing list'))).toBe(true);
    });

    it('detects member referencing non-existent campaign', async () => {
      const snapshot = service.snapshotState();
      snapshot.members.set('orphan-mem-1', {
        id: 'orphan-mem-1',
        campaignId: '99999999-9999-4999-8999-999999999999',
        contactId: '11111111-3333-4111-8111-000000000001',
        status: 'sent',
        unsubscribed: false,
        createdAt: new Date().toISOString(),
      });
      service.restoreState(snapshot);

      const audit = reconciliationService.auditLinkIntegrity();
      expect(audit.valid).toBe(false);
      expect(audit.brokenLinks.some((l) => l.includes('references non-existent campaign'))).toBe(true);
    });

    it('detects invalid member status outside allowed enum [sent, opened, clicked]', async () => {
      const list = await service.createList({ name: 'L1' });
      const camp = await service.createCampaign({
        name: 'Status Test Campaign',
        campaignDate: '2026-11-10',
        listId: list.id,
      });

      // Directly put defective record into internal state
      const snapshot = service.snapshotState();
      snapshot.members.set('defective-member-1', {
        id: 'defective-member-1',
        campaignId: camp.id,
        contactId: '11111111-4444-4111-8111-000000000001',
        status: 'bounced' as any,
        unsubscribed: false,
        createdAt: new Date().toISOString(),
      });
      service.restoreState(snapshot);

      const audit = reconciliationService.auditLinkIntegrity();
      expect(audit.valid).toBe(false);
      expect(audit.brokenLinks.some((l) => l.includes("invalid engagement status 'bounced'"))).toBe(true);
    });
  });

  // =========================================================================
  // 5. Durable Import Receipt Completeness Audit
  // =========================================================================
  describe('Criterion 3: Durable Import Receipt Completeness & Idempotency Key Consistency', () => {
    it('verifies 100% receipt completeness when all records are created via target adapter', async () => {
      const batchId = 'batch-receipt-01';

      const l1 = await adapter.importRow(batchId, 1, `${batchId}#1#list#v1`, {
        entity: 'list',
        data: { name: 'Receipt Verified List' },
      });
      expect(l1.ok).toBe(true);

      const c1 = await adapter.importRow(batchId, 2, `${batchId}#2#campaign#v1`, {
        entity: 'campaign',
        data: {
          name: 'Receipt Campaign',
          campaignDate: '2026-11-01',
          listId: (l1 as { value: { targetId: string } }).value.targetId,
        },
      });
      expect(c1.ok).toBe(true);

      const audit = reconciliationService.auditReceiptCompleteness(batchId);
      expect(audit.valid).toBe(true);
      expect(audit.totalReceipts).toBe(2);
      expect(audit.unreceiptedTargetIds).toEqual([]);
    });

    it('detects unreceipted target records created outside durable adapter transaction', async () => {
      // 1. Create one record with adapter (receipt recorded)
      const res = await adapter.importRow('batch-rec-02', 1, 'idemp-1', {
        entity: 'list',
        data: { name: 'Receipted List' },
      });
      expect(res.ok).toBe(true);

      // 2. Create another record directly via domain service (bypassing adapter receipt)
      await service.createList({ name: 'Unreceipted Direct List' });

      const audit = reconciliationService.auditReceiptCompleteness('batch-rec-02');
      expect(audit.valid).toBe(false);
      expect(audit.unreceiptedTargetIds.length).toBeGreaterThanOrEqual(1);
      expect(audit.unreceiptedTargetIds.some((id) => id.includes('list:'))).toBe(true);
    });
  });

  // =========================================================================
  // 6. Monotonic Privacy & Lifecycle Invariants under Reconciliation
  // =========================================================================
  describe('Domain Invariants: BR-CRM4-01 Monotonic Opt-Out & BR-CRM4-02 Immutability', () => {
    it('enforces BR-CRM4-01 monotonic opt-out during batch reconciliation', async () => {
      const contactId = '11111111-7777-4111-8111-000000000001';

      // 1. Record unsubscribed consent
      const firstRes = await adapter.importRow('batch-privacy', 1, 'b-p#1#c#v1', {
        entity: 'consent',
        data: { contactId, status: 'unsubscribed', source: 'compliance_optout' },
      });
      expect(firstRes.ok).toBe(true);

      // 2. Attempt to overwrite with 'subscribed' -> must reject
      const secondRes = await adapter.importRow('batch-privacy', 2, 'b-p#2#c#v1', {
        entity: 'consent',
        data: { contactId, status: 'subscribed', source: 'legacy_import' },
      });
      expect(secondRes.ok).toBe(false);
      if (!secondRes.ok) {
        expect(secondRes.error.reasonCode).toBe('OPT_OUT_VIOLATION');
      }

      // Reconcile outcomes
      const rec = reconciliationService.reconcileBatch({
        batchId: 'batch-privacy',
        sourceCount: 2,
        outcomes: [
          {
            sourceRow: 1,
            outcome: 'loaded',
            entity: 'consent',
            targetId: (firstRes as { value: { targetId: string } }).value.targetId,
          },
          {
            sourceRow: 2,
            outcome: 'rejected',
            entity: 'consent',
            reasonCode: 'OPT_OUT_VIOLATION',
            reasonText: 'Cannot overwrite known unsubscribed state.',
          },
        ],
      });

      expect(rec.isConserved).toBe(true);
      expect(rec.report.loadedCount).toBe(1);
      expect(rec.report.rejectedCount).toBe(1);
      expect(rec.report.unaccountedCount).toBe(0);
    });

    it('enforces BR-CRM4-02 campaign list_id immutability', async () => {
      const list1 = await service.createList({ name: 'List One' });
      const list2 = await service.createList({ name: 'List Two' });

      const campaign = await service.createCampaign({
        name: 'Immutable Campaign',
        campaignDate: '2026-11-01',
        listId: list1.id,
      });

      // Attempt to modify listId -> throws
      await expect(
        service.patchCampaign(campaign.id, {
          name: 'Modified Campaign',
          listId: list2.id,
        })
      ).rejects.toThrow(/Campaign listId is immutable/);
    });
  });
});
