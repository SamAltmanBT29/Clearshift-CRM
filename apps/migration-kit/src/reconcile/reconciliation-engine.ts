import {
  type KitReconciliationReport,
  type KitBatchStatus,
  ReconciliationInvariantError,
  ReconciliationBlockedByBatchStateError,
} from '@clearshift/contracts';
import type { IRowOutcomeLedger } from './outcome-ledger.js';

/**
 * Reconciliation Service (KIT-09 / KIT-11 / SDS §11.8)
 * Derives counts strictly from the append-only outcome ledger (kit_row_outcomes),
 * NEVER from target table totals.
 *
 * Formula:
 * source = loaded + rejected + merged + skipped
 * unaccounted = source - (loaded + rejected + merged + skipped) = 0
 */
export class ReconciliationService {
  constructor(private ledger: IRowOutcomeLedger) {}

  /**
   * Reconciles a migration batch by deriving exact counts from the terminal outcome ledger.
   */
  public async reconcileBatch(
    batchId: string,
    totalSourceRows: number,
    batchStatus?: KitBatchStatus
  ): Promise<KitReconciliationReport> {
    if (
      batchStatus &&
      (batchStatus === 'load_failed_partial' ||
        batchStatus === 'failed' ||
        batchStatus === 'stopped_excessive_failures')
    ) {
      throw new ReconciliationBlockedByBatchStateError(batchId, batchStatus);
    }

    const counts = await this.ledger.getCountsByBatchId(batchId);

    const accounted =
      counts.loaded + counts.rejected + counts.merged + counts.skipped;
    const unaccounted = totalSourceRows - accounted;

    // Mathematically exact conservation: unaccounted must be exactly 0
    const isBalanced = unaccounted === 0 && accounted === totalSourceRows;
    const status = isBalanced ? 'OK' : 'UNBALANCED';

    return {
      batchId,
      sourceCount: totalSourceRows,
      loadedCount: counts.loaded,
      rejectedCount: counts.rejected,
      mergedCount: counts.merged,
      skippedCount: counts.skipped,
      unaccountedCount: unaccounted,
      status,
      isBalanced,
      timestamp: new Date(),
    };
  }

  /**
   * Asserts that a batch meets all mathematical reconciliation invariants for final signoff.
   * Throws:
   * - ReconciliationBlockedByBatchStateError if the batch is in load_failed_partial or failed
   * - ReconciliationInvariantError if unaccounted != 0 or status is UNBALANCED
   */
  public assertCanSignoff(report: KitReconciliationReport, batchStatus?: KitBatchStatus): void {
    if (
      batchStatus &&
      (batchStatus === 'load_failed_partial' ||
        batchStatus === 'failed' ||
        batchStatus === 'stopped_excessive_failures')
    ) {
      throw new ReconciliationBlockedByBatchStateError(report.batchId, batchStatus);
    }

    if (!report.isBalanced || report.status !== 'OK' || report.unaccountedCount !== 0) {
      const accounted =
        report.loadedCount +
        report.rejectedCount +
        report.mergedCount +
        report.skippedCount;
      throw new ReconciliationInvariantError(
        report.batchId,
        report.sourceCount,
        accounted,
        report.unaccountedCount
      );
    }
  }
}
