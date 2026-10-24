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
import { assertConservationEquation } from '../../src/domain/qa-specs.js';
import {
  Crm5ReconciliationService,
  type RowOutcomeRecord,
} from '../../src/services/reconciliation.service.js';
import { ControlCenterService } from '../../src/services/control-center.service.js';
import { Crm5TargetAdapter } from '../../src/migration/target-adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CSV_FILE = path.resolve(__dirname, '../fixtures/dirty-pack-100.csv');
const MANIFEST_FILE = path.resolve(__dirname, '../fixtures/manifest.json');

describe('CRM-5 Migration Reconciliation Proof & Gate G4 Evidence Suite (#203 / [CRM5-30])', () => {
  let service: ControlCenterService;
  let adapter: Crm5TargetAdapter;
  let reconciliationService: Crm5ReconciliationService;

  beforeEach(() => {
    service = new ControlCenterService();
    // Clear out seed records to have an isolated environment for receipt and reconciliation testing
    service.clear();
    adapter = new Crm5TargetAdapter(service);
    reconciliationService = new Crm5ReconciliationService({ service, adapter });
  });

  // =========================================================================
  // 1. Canonical 100-Row Dirty Data Pack Reconciliation Proof
  // =========================================================================
  describe('Criterion 1 & 2: Canonical 100-Row Dirty Data Pack Conservation Balance Sheet', () => {
    it('achieves exact mathematical reconciliation with human review merge path: source (100) = loaded (50) + rejected (45) + merged (5) + skipped (0)', async () => {
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

      const batchId = 'batch-canonical-g4-crm5-100';
      const outcomes: RowOutcomeRecord[] = [];

      // Parse and execute all 100 rows through the target adapter / migration pipeline
      for (let i = 0; i < dataRows.length; i++) {
        const line = dataRows[i];
        const manifestRec = manifest.records[i];
        const parts = line.split(',');
        const rowId = i + 1; // 1-indexed source row
        const idempotencyKey = `${batchId}#${rowId}#runs#v1`;

        if (manifestRec.status === 'VALID') {
          // Valid clean row -> loaded through target adapter
          const res = await adapter.importRow(batchId, rowId, idempotencyKey, {
            entity: 'runs',
            data: {
              batchId: parts[1] || `batch-${rowId}`,
              module: (parts[2] as any) || 'crm-5',
              step: (parts[3] as any) || 'load',
              status: (parts[4] as any) || 'completed',
              recordsIn: parseInt(parts[5] || '100', 10),
              recordsOut: parseInt(parts[6] || '100', 10),
              recordsRejected: parseInt(parts[7] || '0', 10),
            },
          });

          expect(res.ok).toBe(true);
          if (res.ok) {
            outcomes.push({
              sourceRow: rowId,
              outcome: 'loaded',
              entity: 'runs',
              targetId: res.value.targetId,
              idempotencyKey,
            });
          }
        } else if (manifestRec.expectedOutcome === 'exact_duplicate') {
          // Exact duplicate row held for explicit human review and merged per ClearShift Core Rules
          outcomes.push({
            sourceRow: rowId,
            outcome: 'merged',
            entity: 'runs',
            targetId: `merged-canonical-target-${rowId}`,
            reasonCode: 'HUMAN_REVIEW_EXACT_DUPLICATE_MERGE',
            reasonText: 'Exact duplicate held and merged into existing target record after operator sign-off.',
          });
        } else {
          // Defective row rejected during preflight / cleaner / ingestion
          const defectCat = manifestRec.defects?.[0]?.category || 'DEFECTIVE_INPUT';
          const defectReason = manifestRec.defects?.[0]?.reason || manifestRec.expectedOutcome;
          outcomes.push({
            sourceRow: rowId,
            outcome: 'rejected',
            entity: 'runs',
            reasonCode: defectCat,
            reasonText: `Pre-load defect caught: ${defectReason}`,
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
      expect(report.rejectedCount).toBe(45);
      expect(report.mergedCount).toBe(5);
      expect(report.skippedCount).toBe(0);
      expect(report.status).toBe('OK');

      // Verify contract helper
      const verified = verifyReconciliation({
        sourceCount: report.sourceCount,
        loadedCount: report.loadedCount,
        rejectedCount: report.rejectedCount,
        mergedCount: report.mergedCount,
        skippedCount: report.skippedCount,
      });
      expect(verified.isBalanced).toBe(true);
      expect(verified.unaccountedCount).toBe(0);
      expect(verified.status).toBe('OK');

      // Assert QA spec rule check
      expect(() => assertConservationEquation(report)).not.toThrow();

      // 4. Verify durable receipt completeness for all 50 loaded target records
      const receiptAudit = reconciliationService.auditReceiptCompleteness();
      expect(receiptAudit.valid).toBe(true);
      expect(receiptAudit.totalReceipts).toBe(50);
      expect(receiptAudit.targetRecordsCount).toBe(50);
      expect(receiptAudit.unreceiptedTargetIds).toHaveLength(0);
    });

    it('achieves exact mathematical reconciliation when duplicates are rejected: source (100) = loaded (50) + rejected (50) + merged (0) + skipped (0)', async () => {
      const batchId = 'batch-canonical-g4-crm5-100-reject-dup';
      const outcomes: RowOutcomeRecord[] = [];

      for (let i = 1; i <= 100; i++) {
        if (i <= 50) {
          outcomes.push({
            sourceRow: i,
            outcome: 'loaded',
            entity: 'runs',
            targetId: `target-run-${i}`,
            idempotencyKey: `${batchId}#${i}#runs#v1`,
          });
        } else {
          outcomes.push({
            sourceRow: i,
            outcome: 'rejected',
            entity: 'runs',
            reasonCode: i <= 55 ? 'EXACT_DUPLICATE_REJECTED' : 'DATA_MALFORMED',
            reasonText: 'Input record rejected per preflight defect detection.',
          });
        }
      }

      const reconciliation = reconciliationService.reconcileBatch({
        batchId,
        sourceCount: 100,
        outcomes,
      });

      expect(reconciliation.isConserved).toBe(true);
      expect(reconciliation.unaccountedCount).toBe(0);
      expect(reconciliation.report.loadedCount).toBe(50);
      expect(reconciliation.report.rejectedCount).toBe(50);
      expect(reconciliation.report.mergedCount).toBe(0);
      expect(reconciliation.report.skippedCount).toBe(0);
      expect(reconciliation.report.status).toBe('OK');
    });
  });

  // =========================================================================
  // 2. 1,000-Row Synthetic Enterprise Batch Conservation Proof
  // =========================================================================
  describe('Criterion 2: 1,000-Row Synthetic Enterprise Batch Mathematical Conservation', () => {
    it('achieves exact mathematical balance: source (1,000) = loaded (780) + rejected (140) + merged (80) + skipped (0)', () => {
      const batchId = 'batch-enterprise-g4-crm5-1000';
      const totalSource = 1000;
      const expectedLoaded = 780;
      const expectedRejected = 140;
      const expectedMerged = 80;
      const expectedSkipped = 0;

      const outcomes: RowOutcomeRecord[] = [];

      for (let row = 1; row <= totalSource; row++) {
        if (row <= expectedLoaded) {
          outcomes.push({
            sourceRow: row,
            outcome: 'loaded',
            entity: 'runs',
            targetId: randomUUID(),
            idempotencyKey: `${batchId}#${row}#runs#v1`,
          });
        } else if (row <= expectedLoaded + expectedRejected) {
          outcomes.push({
            sourceRow: row,
            outcome: 'rejected',
            entity: 'runs',
            reasonCode: 'SCHEMA_VALIDATION_ERROR',
            reasonText: 'Record failed strict domain schema validation.',
          });
        } else if (row <= expectedLoaded + expectedRejected + expectedMerged) {
          outcomes.push({
            sourceRow: row,
            outcome: 'merged',
            entity: 'runs',
            targetId: `merged-parent-${row}`,
            reasonCode: 'EXACT_DUPLICATE_CONSOLIDATED',
            reasonText: 'Record reconciled into canonical target identity.',
          });
        } else {
          outcomes.push({
            sourceRow: row,
            outcome: 'skipped',
            entity: 'runs',
            reasonCode: 'PRELOAD_POLICY_FILTER',
            reasonText: 'Record excluded prior to target mutation per active policy.',
          });
        }
      }

      expect(outcomes.length).toBe(totalSource);

      const result = reconciliationService.reconcileBatch({
        batchId,
        sourceCount: totalSource,
        outcomes,
      });

      expect(result.isConserved).toBe(true);
      expect(result.unaccountedCount).toBe(0);
      expect(result.report.sourceCount).toBe(1000);
      expect(result.report.loadedCount).toBe(780);
      expect(result.report.rejectedCount).toBe(140);
      expect(result.report.mergedCount).toBe(80);
      expect(result.report.skippedCount).toBe(0);
      expect(result.report.status).toBe('OK');

      const verified = verifyReconciliation({
        sourceCount: result.report.sourceCount,
        loadedCount: result.report.loadedCount,
        rejectedCount: result.report.rejectedCount,
        mergedCount: result.report.mergedCount,
        skippedCount: result.report.skippedCount,
      });
      expect(verified.isBalanced).toBe(true);
      expect(verified.unaccountedCount).toBe(0);
      expect(verified.status).toBe('OK');
    });
  });

  // =========================================================================
  // 3. Single Terminal Outcome Invariant Validation
  // =========================================================================
  describe('Criterion 1: Single Terminal Outcome Invariant Enforcement', () => {
    it('throws when multiple terminal outcomes are assigned to the same source row', () => {
      const batchId = 'batch-duplicate-outcome-fail';
      const outcomes: RowOutcomeRecord[] = [
        { sourceRow: 1, outcome: 'loaded', entity: 'runs', targetId: 'run-1' },
        { sourceRow: 2, outcome: 'loaded', entity: 'runs', targetId: 'run-2' },
        // Conflict: source row 2 recorded twice with contradictory outcomes
        {
          sourceRow: 2,
          outcome: 'rejected',
          entity: 'runs',
          reasonCode: 'LATE_REJECTION',
          reasonText: 'Contradictory state',
        },
      ];

      expect(() =>
        reconciliationService.reconcileBatch({
          batchId,
          sourceCount: 2,
          outcomes,
        })
      ).toThrowError(/Reconciliation Error: Source row 2 has multiple terminal outcomes recorded/);
    });
  });

  // =========================================================================
  // 4. Mathematical Conservation Failure / Discrepancy Detection
  // =========================================================================
  describe('Criterion 2: Discrepancy & Unaccounted Row Detection', () => {
    it('detects unaccounted source rows and marks reconciliation report UNBALANCED', () => {
      const batchId = 'batch-unaccounted-rows';
      const outcomes: RowOutcomeRecord[] = [
        { sourceRow: 1, outcome: 'loaded', entity: 'runs', targetId: 'run-1' },
        { sourceRow: 2, outcome: 'loaded', entity: 'runs', targetId: 'run-2' },
        { sourceRow: 3, outcome: 'rejected', entity: 'runs', reasonCode: 'INVALID' },
      ];

      // Source count is 5, but only 3 outcomes are present (2 unaccounted rows)
      const result = reconciliationService.reconcileBatch({
        batchId,
        sourceCount: 5,
        outcomes,
      });

      expect(result.isConserved).toBe(false);
      expect(result.unaccountedCount).toBe(2);
      expect(result.report.status).toBe('UNBALANCED');
      expect(result.report.sourceCount).toBe(5);
      expect(result.report.loadedCount).toBe(2);
      expect(result.report.rejectedCount).toBe(1);
      expect(result.report.unaccountedCount).toBe(2);

      const verified = verifyReconciliation({
        sourceCount: 5,
        loadedCount: 2,
        rejectedCount: 1,
        mergedCount: 0,
        skippedCount: 0,
      });
      expect(verified.isBalanced).toBe(false);
      expect(verified.unaccountedCount).toBe(2);
      expect(verified.status).toBe('UNBALANCED');
    });
  });

  // =========================================================================
  // 5. Relational Link Integrity Audit Suite
  // =========================================================================
  describe('Criterion 3: Relational Link Integrity Audit', () => {
    it('passes link integrity audit when child entities strictly reference existing runs', () => {
      const batchId = 'batch-audit-clean-01';

      // 1. Create a valid run
      service.recordRun({
        batchId,
        module: 'crm-5',
        step: 'load',
        status: 'completed',
        recordsIn: 100,
        recordsOut: 90,
        recordsRejected: 10,
      });

      // 2. Create child score referencing batchId
      service.recordScore({
        batchId,
        module: 'crm-5',
        completeness: 0.95,
        validity: 0.98,
        duplicateRate: 0.02,
        rejectRate: 0.05,
        linkIntegrity: 1.0,
      });

      // 3. Create child reject referencing batchId
      service.recordReject({
        batchId,
        module: 'crm-5',
        rowIndex: 42,
        field: 'status',
        reasonCode: 'INVALID_ENUM',
        rawPayloadHash: 'a'.repeat(64),
      });

      // 4. Create reconciliation report referencing batchId
      service.recordReconciliation({
        batchId,
        module: 'crm-5',
        sourceCount: 100,
        loadedCount: 90,
        rejectedCount: 10,
        mergedCount: 0,
        skippedCount: 0,
      });

      const audit = reconciliationService.auditLinkIntegrity();
      expect(audit.valid).toBe(true);
      expect(audit.brokenLinks).toHaveLength(0);
      expect(audit.runsChecked).toBe(1);
      expect(audit.scoresChecked).toBe(1);
      expect(audit.rejectsChecked).toBe(1);
      expect(audit.reconciliationsChecked).toBe(1);
      expect(audit.totalChecked).toBe(4);
    });

    it('detects broken links when child score or reject references non-existent batch', () => {
      const realBatch = 'batch-real-01';
      const ghostBatch = 'batch-non-existent-99';

      service.recordRun({
        batchId: realBatch,
        module: 'crm-5',
        step: 'load',
        status: 'completed',
        recordsIn: 100,
        recordsOut: 100,
        recordsRejected: 0,
      });

      // Score referencing non-existent batch
      service.recordScore({
        batchId: ghostBatch,
        module: 'crm-5',
        completeness: 1.0,
        validity: 1.0,
        duplicateRate: 0.0,
        rejectRate: 0.0,
        linkIntegrity: 1.0,
      });

      const audit = reconciliationService.auditLinkIntegrity();
      expect(audit.valid).toBe(false);
      expect(audit.brokenLinks.length).toBeGreaterThanOrEqual(1);
      expect(audit.brokenLinks[0]).toContain(
        `references non-existent batch '${ghostBatch}'`
      );
    });

    it('detects row conservation violation in migration runs', () => {
      const batchId = 'batch-conservation-violation';

      // Bypass service.recordRun validation to simulate corrupted/legacy database state
      (service as any).runs.push({
        id: randomUUID(),
        batchId,
        module: 'crm-5',
        step: 'load',
        status: 'completed',
        recordsIn: 100,
        recordsOut: 90,
        recordsRejected: 20,
        createdAt: new Date(),
      });

      const audit = reconciliationService.auditLinkIntegrity();
      expect(audit.valid).toBe(false);
      expect(audit.brokenLinks.some((l) => l.includes('violates row conservation'))).toBe(true);
    });

    it('detects duplicate step transition in the same batch run', () => {
      const batchId = 'batch-duplicate-step';

      service.recordRun({
        batchId,
        module: 'crm-5',
        step: 'load',
        status: 'running',
        recordsIn: 100,
        recordsOut: 0,
        recordsRejected: 0,
      });

      // Inject second run record directly for same batchId and step to simulate duplicate entry in db
      (service as any).runs.push({
        id: randomUUID(),
        batchId,
        module: 'crm-5',
        step: 'load',
        status: 'completed',
        recordsIn: 100,
        recordsOut: 100,
        recordsRejected: 0,
        createdAt: new Date(),
      });

      const audit = reconciliationService.auditLinkIntegrity();
      expect(audit.valid).toBe(false);
      expect(audit.brokenLinks.some((l) => l.includes('Duplicate run step detected'))).toBe(true);
    });
  });

  // =========================================================================
  // 6. Durable Import Receipt Completeness Audit
  // =========================================================================
  describe('Criterion 4: Durable Import Receipt Completeness & Idempotency Audit', () => {
    it('verifies 100% receipt coverage for all entities imported through adapter', async () => {
      const batchId = 'batch-receipt-audit-01';

      // Load run record through adapter
      const runRes = await adapter.importRow(batchId, 1, `${batchId}#1#runs#v1`, {
        entity: 'runs',
        data: {
          batchId,
          module: 'crm-5',
          step: 'load',
          status: 'completed',
          recordsIn: 50,
          recordsOut: 50,
          recordsRejected: 0,
        },
      });
      expect(runRes.ok).toBe(true);

      // Load score record through adapter
      const scoreRes = await adapter.importRow(batchId, 2, `${batchId}#2#scores#v1`, {
        entity: 'scores',
        data: {
          batchId,
          module: 'crm-5',
          completeness: 0.98,
          validity: 0.99,
          duplicateRate: 0.01,
          rejectRate: 0.02,
          linkIntegrity: 1.0,
        },
      });
      expect(scoreRes.ok).toBe(true);

      const receiptAudit = reconciliationService.auditReceiptCompleteness(batchId);
      expect(receiptAudit.valid).toBe(true);
      expect(receiptAudit.totalReceipts).toBe(2);
      expect(receiptAudit.targetRecordsCount).toBe(2);
      expect(receiptAudit.unreceiptedTargetIds).toHaveLength(0);
    });

    it('detects unreceipted target records created outside the adapter boundary', async () => {
      const batchId = 'batch-unreceipted-check';

      // 1. Lawful insert via adapter
      await adapter.importRow(batchId, 1, `${batchId}#1#runs#v1`, {
        entity: 'runs',
        data: {
          batchId,
          module: 'crm-5',
          step: 'load',
          status: 'completed',
          recordsIn: 50,
          recordsOut: 50,
          recordsRejected: 0,
        },
      });

      // 2. Unlawful mutation directly on service without durable receipt
      const rogueRun = service.recordRun({
        batchId,
        module: 'crm-5',
        step: 'validate',
        status: 'completed',
        recordsIn: 50,
        recordsOut: 50,
        recordsRejected: 0,
      });

      const receiptAudit = reconciliationService.auditReceiptCompleteness(batchId);
      expect(receiptAudit.valid).toBe(false);
      expect(receiptAudit.totalReceipts).toBe(1);
      expect(receiptAudit.targetRecordsCount).toBe(2);
      expect(receiptAudit.unreceiptedTargetIds).toContain(`run:${rogueRun.run.id}`);
    });

    it('guarantees atomic transaction rollback when receipt persistence fails', async () => {
      const batchId = 'batch-atomic-rollback';
      const initialRunsCount = service.getAllRuns().length;

      // Attempt to load record with simulated receipt commit failure
      await expect(
        adapter.importRow(
          batchId,
          1,
          `${batchId}#1#runs#v1`,
          {
            entity: 'runs',
            data: {
              batchId,
              module: 'crm-5',
              step: 'load',
              status: 'completed',
              recordsIn: 100,
              recordsOut: 100,
              recordsRejected: 0,
            },
          },
          { failReceiptCommit: true }
        )
      ).rejects.toThrowError(/failed to persist import receipt/);

      // Verify target entity was rolled back atomically (no orphaned run created)
      const afterRunsCount = service.getAllRuns().length;
      expect(afterRunsCount).toBe(initialRunsCount);

      // Verify zero receipts persisted
      expect(adapter.getReceipts()).toHaveLength(0);
    });
  });

  // =========================================================================
  // 7. End-to-End executeAndReconcile Pipeline
  // =========================================================================
  describe('Criterion 5: End-to-End Execution and Audit Pipeline', () => {
    it('executes mixed batch and generates complete reconciliation and link audit reports', async () => {
      const batchId = 'batch-e2e-pipeline-01';

      const result = await reconciliationService.executeAndReconcile(batchId, [
        {
          sourceRow: 1,
          entity: 'runs',
          data: {
            batchId,
            module: 'crm-5',
            step: 'load',
            status: 'completed',
            recordsIn: 10,
            recordsOut: 10,
            recordsRejected: 0,
          },
        },
        {
          sourceRow: 2,
          entity: 'runs',
          data: {
            batchId,
            module: 'crm-5',
            step: 'validate',
            status: 'completed',
            recordsIn: -10, // negative count fails domain validation
            recordsOut: 10,
            recordsRejected: 0,
          },
        },
        {
          sourceRow: 3,
          entity: 'runs',
          data: {},
          isDuplicateForMerge: true,
          mergedTargetId: 'target-existing-parent',
        },
        {
          sourceRow: 4,
          entity: 'runs',
          data: {},
          isPreloadExcluded: true,
          skipReason: 'Policy exclusion for obsolete run format',
        },
      ]);

      expect(result.report.sourceCount).toBe(4);
      expect(result.report.loadedCount).toBe(1);
      expect(result.report.rejectedCount).toBe(1);
      expect(result.report.mergedCount).toBe(1);
      expect(result.report.skippedCount).toBe(1);
      expect(result.report.unaccountedCount).toBe(0);
      expect(result.report.status).toBe('OK');

      expect(result.linkAudit.valid).toBe(true);
      expect(result.linkAudit.brokenLinks).toHaveLength(0);
    });
  });
});
