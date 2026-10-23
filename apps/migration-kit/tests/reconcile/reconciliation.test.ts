import { describe, it, expect, beforeEach } from 'vitest';
import {
  DuplicateRowOutcomeError,
  InvalidSkipApprovalError,
  ReconciliationInvariantError,
} from '@clearshift/contracts';
import {
  InMemoryRowOutcomeLedger,
  ReconciliationService,
} from '../../src/reconcile/index.js';

describe('KIT-09: Terminal Outcome Ledger and Mathematically Exact Reconciliation', () => {
  let ledger: InMemoryRowOutcomeLedger;
  let service: ReconciliationService;

  beforeEach(() => {
    ledger = new InMemoryRowOutcomeLedger();
    service = new ReconciliationService(ledger);
  });

  describe('1. Uniqueness & Single Terminal Outcome Constraint', () => {
    it('blocks recording a second terminal outcome for the same source row', async () => {
      const batchId = 'batch-rec-01';
      const sourceRow = 1;

      // First terminal outcome: loaded
      await ledger.recordOutcome({
        batchId,
        sourceRow,
        outcome: 'loaded',
        targetId: '550e8400-e29b-41d4-a716-446655440000',
      });

      // Attempt to record a second terminal outcome: rejected
      await expect(
        ledger.recordOutcome({
          batchId,
          sourceRow,
          outcome: 'rejected',
          reasonCode: 'LATE_VALIDATION_ERROR',
        })
      ).rejects.toThrow(DuplicateRowOutcomeError);

      // Verify the ledger still holds only the original outcome
      const outcome = await ledger.getOutcome(batchId, sourceRow);
      expect(outcome?.outcome).toBe('loaded');
    });

    it('allows different source rows in the same batch to have distinct outcomes', async () => {
      const batchId = 'batch-rec-02';

      await ledger.recordOutcome({ batchId, sourceRow: 1, outcome: 'loaded' });
      await ledger.recordOutcome({ batchId, sourceRow: 2, outcome: 'rejected', reasonCode: 'INVALID_EMAIL' });
      await ledger.recordOutcome({ batchId, sourceRow: 3, outcome: 'merged', targetId: '550e8400-e29b-41d4-a716-446655440001' });

      const counts = await ledger.getCountsByBatchId(batchId);
      expect(counts.loaded).toBe(1);
      expect(counts.rejected).toBe(1);
      expect(counts.merged).toBe(1);
      expect(counts.skipped).toBe(0);
      expect(counts.total).toBe(3);
    });
  });

  describe('2. Operator-Approved Skip Row Policy', () => {
    it('allows Editor or Admin to approve a row skip with >= 10 char reason before load', async () => {
      const batchId = 'batch-skip-01';
      const sourceRow = 7;

      const { outcome, dryRunInvalidated } = await ledger.recordSkipApproval(
        {
          batchId,
          sourceRow,
          reason: 'Duplicate legacy record confirmed obsolete by client',
          actor: 'editor_sarah',
          actorRole: 'editor',
        },
        'mapped' // Pre-load phase
      );

      expect(outcome.outcome).toBe('skipped');
      expect(outcome.policyCode).toBe('operator_approved_skip');
      expect(outcome.actor).toBe('editor_sarah');
      expect(outcome.approvedBy).toBe('editor_sarah');
      expect(outcome.reasonMessage).toBe('Duplicate legacy record confirmed obsolete by client');
      expect(dryRunInvalidated).toBe(false);
    });

    it('rejects row skip approval from a Migration Runner role (self-approval prohibited)', async () => {
      const batchId = 'batch-skip-02';

      await expect(
        ledger.recordSkipApproval(
          {
            batchId,
            sourceRow: 12,
            reason: 'Self-diagnosed invalid test row from runner',
            actor: 'runner_john',
            actorRole: 'runner',
          },
          'cleaned'
        )
      ).rejects.toThrow(InvalidSkipApprovalError);
    });

    it('rejects row skip if reason is fewer than 10 non-whitespace characters', async () => {
      const batchId = 'batch-skip-03';

      await expect(
        ledger.recordSkipApproval(
          {
            batchId,
            sourceRow: 5,
            reason: 'Bad data   ', // 8 non-whitespace chars
            actor: 'admin_dave',
            actorRole: 'migration_admin',
          },
          'cleaned'
        )
      ).rejects.toThrow(/10 non-whitespace/);
    });

    it('prohibits row skip after real load phase has commenced', async () => {
      const batchId = 'batch-skip-04';

      await expect(
        ledger.recordSkipApproval(
          {
            batchId,
            sourceRow: 9,
            reason: 'Trying to skip row while batch is already loading into target',
            actor: 'admin_dave',
            actorRole: 'migration_admin',
          },
          'loading' // Prohibited post-load phase
        )
      ).rejects.toThrow(/permitted only before real load/);
    });

    it('invalidates dry-run token if row is skipped after dry_run_passed', async () => {
      const batchId = 'batch-skip-05';

      const { outcome, dryRunInvalidated } = await ledger.recordSkipApproval(
        {
          batchId,
          sourceRow: 14,
          reason: 'Post-dry-run discovered exception needing omission',
          actor: 'admin_dave',
          actorRole: 'platform_admin',
        },
        'dry_run_passed'
      );

      expect(outcome.outcome).toBe('skipped');
      expect(dryRunInvalidated).toBe(true);
    });
  });

  describe('3. Mathematically Exact Reconciliation Math', () => {
    it('computes exact match when source equals sum of all terminal states (unaccounted = 0)', async () => {
      const batchId = 'batch-reconciled-ok';
      const totalSourceRows = 100;

      // Seed 70 loaded, 15 rejected, 10 merged, 5 skipped = 100 total
      for (let i = 1; i <= 70; i++) {
        await ledger.recordOutcome({ batchId, sourceRow: i, outcome: 'loaded' });
      }
      for (let i = 71; i <= 85; i++) {
        await ledger.recordOutcome({ batchId, sourceRow: i, outcome: 'rejected', reasonCode: 'VALIDATION_FAILED' });
      }
      for (let i = 86; i <= 95; i++) {
        await ledger.recordOutcome({ batchId, sourceRow: i, outcome: 'merged' });
      }
      for (let i = 96; i <= 100; i++) {
        await ledger.recordOutcome({
          batchId,
          sourceRow: i,
          outcome: 'skipped',
          policyCode: 'operator_approved_skip',
          reasonMessage: 'Excluded per client contract specification',
          approvedBy: 'admin_lead',
        });
      }

      const report = await service.reconcileBatch(batchId, totalSourceRows);

      expect(report.sourceCount).toBe(100);
      expect(report.loadedCount).toBe(70);
      expect(report.rejectedCount).toBe(15);
      expect(report.mergedCount).toBe(10);
      expect(report.skippedCount).toBe(5);
      expect(report.unaccountedCount).toBe(0);
      expect(report.status).toBe('OK');
      expect(report.isBalanced).toBe(true);

      // Signoff assertion passes without throwing
      expect(() => service.assertCanSignoff(report)).not.toThrow();
    });

    it('rejects reconciliation when unaccounted rows exist and blocks signoff', async () => {
      const batchId = 'batch-missing-rows';
      const totalSourceRows = 50;

      // Only seed 45 rows (5 unaccounted rows)
      for (let i = 1; i <= 40; i++) {
        await ledger.recordOutcome({ batchId, sourceRow: i, outcome: 'loaded' });
      }
      for (let i = 41; i <= 45; i++) {
        await ledger.recordOutcome({ batchId, sourceRow: i, outcome: 'rejected', reasonCode: 'MALFORMED' });
      }

      const report = await service.reconcileBatch(batchId, totalSourceRows);

      expect(report.sourceCount).toBe(50);
      expect(report.loadedCount).toBe(40);
      expect(report.rejectedCount).toBe(5);
      expect(report.unaccountedCount).toBe(5); // 50 - 45 = 5 unaccounted
      expect(report.status).toBe('UNBALANCED');
      expect(report.isBalanced).toBe(false);

      // Signoff assertion MUST throw ReconciliationInvariantError
      expect(() => service.assertCanSignoff(report)).toThrow(ReconciliationInvariantError);
    });

    it('rejects double-count fixture where accounted rows exceed source rows', async () => {
      const batchId = 'batch-double-count';
      const totalSourceRows = 10;

      // Seed 12 rows (e.g. from flawed ledger simulation or corrupt fixture)
      for (let i = 1; i <= 12; i++) {
        await ledger.recordOutcome({ batchId, sourceRow: i, outcome: 'loaded' });
      }

      const report = await service.reconcileBatch(batchId, totalSourceRows);

      expect(report.sourceCount).toBe(10);
      expect(report.loadedCount).toBe(12);
      expect(report.unaccountedCount).toBe(-2); // Discrepancy: negative unaccounted
      expect(report.status).toBe('UNBALANCED');
      expect(report.isBalanced).toBe(false);

      expect(() => service.assertCanSignoff(report)).toThrow(ReconciliationInvariantError);
    });

    it('guarantees that ignored columns do not silently skip rows', async () => {
      const batchId = 'batch-ignored-cols';
      const totalSourceRows = 2;

      // Row 1 has unmapped columns but is validly loaded
      await ledger.recordOutcome({
        batchId,
        sourceRow: 1,
        outcome: 'loaded',
        metadata: { ignoredColumns: ['fax', 'pager', 'custom_legacy_col'] },
      });

      // Row 2 is explicitly rejected
      await ledger.recordOutcome({
        batchId,
        sourceRow: 2,
        outcome: 'rejected',
        reasonCode: 'MISSING_EMAIL',
        metadata: { ignoredColumns: ['fax'] },
      });

      const report = await service.reconcileBatch(batchId, totalSourceRows);

      expect(report.loadedCount).toBe(1);
      expect(report.rejectedCount).toBe(1);
      expect(report.skippedCount).toBe(0); // Zero skipped rows!
      expect(report.unaccountedCount).toBe(0);
      expect(report.status).toBe('OK');
    });
  });
});
