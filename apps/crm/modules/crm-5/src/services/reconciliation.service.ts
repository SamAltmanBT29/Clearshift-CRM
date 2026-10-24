import { randomUUID } from 'node:crypto';
import {
  type ReconciliationReport,
  type ReconciliationStatus,
  type CrmModule,
  ReconciliationReportSchema,
  verifyReconciliation,
  type MigrationRun,
  type QualityScore,
  type MigrationReject,
} from '@clearshift/contracts';
import { ControlCenterService, controlCenterService } from './control-center.service.js';
import { Crm5TargetAdapter } from '../migration/target-adapter.js';

export interface RowOutcomeRecord {
  sourceRow: number;
  outcome: 'loaded' | 'rejected' | 'merged' | 'skipped';
  entity: string;
  targetId?: string | undefined;
  idempotencyKey?: string | undefined;
  reasonCode?: string | undefined;
  reasonText?: string | undefined;
}

export interface LinkIntegrityAuditResult {
  valid: boolean;
  totalChecked: number;
  runsChecked: number;
  scoresChecked: number;
  rejectsChecked: number;
  reconciliationsChecked: number;
  brokenLinks: string[];
}

export interface ReceiptCompletenessResult {
  valid: boolean;
  totalReceipts: number;
  targetRecordsCount: number;
  unreceiptedTargetIds: string[];
}

export interface ReconcileBatchResult {
  report: ReconciliationReport;
  outcomes: RowOutcomeRecord[];
  isConserved: boolean;
  unaccountedCount: number;
}

const MODULE_ALLOWLIST: readonly CrmModule[] = ['crm-1', 'crm-2', 'crm-3', 'crm-4', 'crm-5'] as const;
const STEP_ALLOWLIST = [
  'extract',
  'profile',
  'clean',
  'map',
  'load',
  'validate',
  'reconcile',
  'transform',
] as const;
const STATUS_ALLOWLIST = [
  'pending',
  'running',
  'completed',
  'failed',
  'halted',
  'RUNNING',
  'COMPLETED',
  'FAILED',
] as const;

/**
 * CRM-5 Reconciliation & Gate G4 Acceptance Audit Service ([CRM5-30] / Issue #203)
 *
 * Implements canonical V1 reconciliation and audit guarantees:
 * 1. Every source row receives exactly one terminal outcome: loaded, rejected, merged, or skipped.
 * 2. Strict conservation equation: source = loaded + rejected + merged + skipped (unaccounted = 0).
 * 3. Relational link integrity validation across runs, scores, rejects, and reconciliation reports.
 * 4. Durable receipt completeness and idempotency verification.
 */
export class Crm5ReconciliationService {
  private service: ControlCenterService;
  private adapter: Crm5TargetAdapter;

  constructor(options?: { service?: ControlCenterService; adapter?: Crm5TargetAdapter }) {
    this.service = options?.service ?? controlCenterService;
    this.adapter = options?.adapter ?? new Crm5TargetAdapter(this.service);
  }

  public getService(): ControlCenterService {
    return this.service;
  }

  public getAdapter(): Crm5TargetAdapter {
    return this.adapter;
  }

  /**
   * Evaluates terminal outcomes and compiles a formal ReconciliationReport conforming to ReconciliationReportSchema.
   */
  public reconcileBatch(input: {
    batchId: string;
    sourceCount: number;
    outcomes: RowOutcomeRecord[];
    module?: CrmModule;
  }): ReconcileBatchResult {
    const { batchId, sourceCount, outcomes } = input;

    // Verify row distinctness & outcome uniqueness
    const seenRows = new Set<number>();
    for (const record of outcomes) {
      if (seenRows.has(record.sourceRow)) {
        throw new Error(
          `Reconciliation Error: Source row ${record.sourceRow} has multiple terminal outcomes recorded. Exactly one terminal outcome is permitted per source row.`
        );
      }
      seenRows.add(record.sourceRow);
    }

    const loadedCount = outcomes.filter((r) => r.outcome === 'loaded').length;
    const rejectedCount = outcomes.filter((r) => r.outcome === 'rejected').length;
    const mergedCount = outcomes.filter((r) => r.outcome === 'merged').length;
    const skippedCount = outcomes.filter((r) => r.outcome === 'skipped').length;

    const sumOfOutcomes = loadedCount + rejectedCount + mergedCount + skippedCount;
    const unaccountedCount = Math.max(0, sourceCount - sumOfOutcomes);
    const isConserved = unaccountedCount === 0 && sumOfOutcomes === sourceCount;
    const status: ReconciliationStatus = isConserved ? 'OK' : 'UNBALANCED';

    const report: ReconciliationReport = {
      id: randomUUID(),
      batchId,
      module: input.module ?? 'crm-5',
      sourceCount,
      loadedCount,
      rejectedCount,
      mergedCount,
      skippedCount,
      unaccountedCount,
      status,
      reconciledAt: new Date(),
      createdAt: new Date(),
    };

    // Strict schema check
    ReconciliationReportSchema.parse(report);

    return {
      report,
      outcomes,
      isConserved,
      unaccountedCount,
    };
  }

  /**
   * Audits link integrity across all in-memory or persisted CRM-5 target records.
   * Asserts:
   * - Every score references a known existing run via batchId.
   * - Every reject references a known existing run via batchId.
   * - Every reconciliation references a known existing run via batchId.
   * - Module allowlist (crm-1 .. crm-5).
   * - Step allowlist (extract, validate, transform, load, reconcile).
   * - Status allowlists (runs).
   * - Run row conservation: recordsOut + recordsRejected <= recordsIn.
   * - Unique (batchId, step) per run batch.
   */
  public auditLinkIntegrity(): LinkIntegrityAuditResult {
    const brokenLinks: string[] = [];

    const runs = this.service.getAllRuns();
    const scores = this.service.getAllScores();
    const rejects = this.service.getAllRejects();
    const reconciliations = this.service.getAllReconciliations();

    const runsByBatch = new Set<string>(runs.map((r) => r.batchId));
    const runBatchStepKeys = new Set<string>();

    // 1. Audit Runs
    for (const run of runs) {
      if (!MODULE_ALLOWLIST.includes(run.module as any)) {
        brokenLinks.push(
          `Run '${run.id}' has invalid module '${run.module}'. Permitted: ${MODULE_ALLOWLIST.join(', ')}.`
        );
      }
      if (!STEP_ALLOWLIST.includes(run.step as any)) {
        brokenLinks.push(
          `Run '${run.id}' has invalid step '${run.step}'. Permitted: ${STEP_ALLOWLIST.join(', ')}.`
        );
      }
      if (!STATUS_ALLOWLIST.includes(run.status as any)) {
        brokenLinks.push(
          `Run '${run.id}' has invalid status '${run.status}'. Permitted: ${STATUS_ALLOWLIST.join(', ')}.`
        );
      }
      if (run.recordsIn < 0 || run.recordsOut < 0 || run.recordsRejected < 0) {
        brokenLinks.push(
          `Run '${run.id}' has negative record counts: in=${run.recordsIn}, out=${run.recordsOut}, rejected=${run.recordsRejected}.`
        );
      }
      if (run.recordsOut + run.recordsRejected > run.recordsIn) {
        brokenLinks.push(
          `Run '${run.id}' violates row conservation: recordsOut (${run.recordsOut}) + recordsRejected (${run.recordsRejected}) > recordsIn (${run.recordsIn}).`
        );
      }

      const batchStepKey = `${run.batchId}#${run.step}`;
      if (runBatchStepKeys.has(batchStepKey)) {
        brokenLinks.push(
          `Duplicate run step detected for batch '${run.batchId}' and step '${run.step}'.`
        );
      }
      runBatchStepKeys.add(batchStepKey);
    }

    // 2. Audit Scores -> Runs (N:1 via batchId)
    for (const score of scores) {
      if (!runsByBatch.has(score.batchId)) {
        brokenLinks.push(
          `Score '${score.id}' references non-existent batch '${score.batchId}'.`
        );
      }
      if (!MODULE_ALLOWLIST.includes(score.module as any)) {
        brokenLinks.push(
          `Score '${score.id}' has invalid module '${score.module}'. Permitted: ${MODULE_ALLOWLIST.join(', ')}.`
        );
      }
      const dims = [
        { name: 'completeness', val: score.completeness },
        { name: 'validity', val: score.validity },
        { name: 'duplicateRate', val: score.duplicateRate },
        { name: 'rejectRate', val: score.rejectRate },
        { name: 'linkIntegrity', val: score.linkIntegrity },
      ];
      for (const dim of dims) {
        if (dim.val != null && (dim.val < 0 || dim.val > 1)) {
          brokenLinks.push(
            `Score '${score.id}' contains ${dim.name} (${dim.val}) outside normalized range [0, 1].`
          );
        }
      }
      if (score.score != null && (score.score < 0 || score.score > 100)) {
        brokenLinks.push(
          `Score '${score.id}' contains composite score (${score.score}) outside normalized range [0, 100].`
        );
      }
    }

    // 3. Audit Rejects -> Runs (N:1 via batchId)
    for (const reject of rejects) {
      if (!runsByBatch.has(reject.batchId)) {
        brokenLinks.push(
          `Reject '${reject.id}' references non-existent batch '${reject.batchId}'.`
        );
      }
      if (reject.rowIndex < 1) {
        brokenLinks.push(
          `Reject '${reject.id}' has invalid 1-indexed rowIndex: ${reject.rowIndex}.`
        );
      }
      if (!reject.rawPayloadHash || reject.rawPayloadHash.length === 0) {
        brokenLinks.push(
          `Reject '${reject.id}' is missing required cryptographic payload hash.`
        );
      }
    }

    // 4. Audit Reconciliations -> Runs (1:1 via batchId)
    for (const recon of reconciliations) {
      if (!runsByBatch.has(recon.batchId)) {
        brokenLinks.push(
          `Reconciliation report '${recon.id}' references non-existent batch '${recon.batchId}'.`
        );
      }
      const sumOutcomes = recon.loadedCount + recon.rejectedCount + recon.mergedCount + recon.skippedCount;
      if (recon.status === 'OK' && (recon.unaccountedCount !== 0 || sumOutcomes !== recon.sourceCount)) {
        brokenLinks.push(
          `Reconciliation report '${recon.id}' marked status OK but violates conservation: source=${recon.sourceCount}, sum=${sumOutcomes}, unaccounted=${recon.unaccountedCount}.`
        );
      }
    }

    const runsChecked = runs.length;
    const scoresChecked = scores.length;
    const rejectsChecked = rejects.length;
    const reconciliationsChecked = reconciliations.length;
    const totalChecked = runsChecked + scoresChecked + rejectsChecked + reconciliationsChecked;
    const valid = brokenLinks.length === 0;

    return {
      valid,
      totalChecked,
      runsChecked,
      scoresChecked,
      rejectsChecked,
      reconciliationsChecked,
      brokenLinks,
    };
  }

  /**
   * Audits that every loaded target record has a durable receipt.
   */
  public auditReceiptCompleteness(
    options?: string | { batchId?: string; targetIds?: string[] }
  ): ReceiptCompletenessResult {
    const batchId = typeof options === 'string' ? options : options?.batchId;
    const targetIds = typeof options === 'object' ? options.targetIds : undefined;

    const receipts = this.adapter.getReceipts();
    const filteredReceipts = batchId ? receipts.filter((r) => r.batchId === batchId) : receipts;
    const receiptTargetIds = new Set(
      filteredReceipts.map((r: any) => r.targetId ?? r.targetEntityId)
    );

    const unreceiptedTargetIds: string[] = [];

    if (targetIds && targetIds.length > 0) {
      for (const id of targetIds) {
        if (!receiptTargetIds.has(id)) {
          unreceiptedTargetIds.push(id);
        }
      }
      return {
        valid: unreceiptedTargetIds.length === 0,
        totalReceipts: filteredReceipts.length,
        targetRecordsCount: targetIds.length,
        unreceiptedTargetIds,
      };
    }

    const allRuns = this.service.getAllRuns();
    const allScores = this.service.getAllScores();
    const allRejects = this.service.getAllRejects();
    const allReconciliations = this.service.getAllReconciliations();

    const runsToCheck = batchId ? allRuns.filter((r) => r.batchId === batchId) : allRuns;
    const scoresToCheck = batchId ? allScores.filter((s) => s.batchId === batchId) : allScores;
    const rejectsToCheck = batchId ? allRejects.filter((r) => r.batchId === batchId) : allRejects;
    const reconciliationsToCheck = batchId
      ? allReconciliations.filter((rc) => rc.batchId === batchId)
      : allReconciliations;

    for (const run of runsToCheck) {
      if (!receiptTargetIds.has(run.id)) {
        unreceiptedTargetIds.push(`run:${run.id}`);
      }
    }
    for (const score of scoresToCheck) {
      if (!receiptTargetIds.has(score.id)) {
        unreceiptedTargetIds.push(`score:${score.id}`);
      }
    }
    for (const reject of rejectsToCheck) {
      if (!receiptTargetIds.has(reject.id)) {
        unreceiptedTargetIds.push(`reject:${reject.id}`);
      }
    }
    for (const recon of reconciliationsToCheck) {
      if (!receiptTargetIds.has(recon.id)) {
        unreceiptedTargetIds.push(`reconciliation:${recon.id}`);
      }
    }

    const targetRecordsCount =
      runsToCheck.length + scoresToCheck.length + rejectsToCheck.length + reconciliationsToCheck.length;

    return {
      valid: unreceiptedTargetIds.length === 0,
      totalReceipts: filteredReceipts.length,
      targetRecordsCount,
      unreceiptedTargetIds,
    };
  }

  /**
   * Executes end-to-end load of source rows, tracks terminal outcomes per row, and compiles reconciliation report.
   */
  public async executeAndReconcile(
    batchId: string,
    rows: Array<{
      sourceRow: number;
      entity: 'runs' | 'scores' | 'rejects' | 'reconciliation';
      data: Record<string, unknown>;
      isPreloadExcluded?: boolean;
      skipReason?: string;
      isDuplicateForMerge?: boolean;
      mergedTargetId?: string;
    }>
  ): Promise<{
    report: ReconciliationReport;
    outcomes: RowOutcomeRecord[];
    linkAudit: LinkIntegrityAuditResult;
  }> {
    const outcomes: RowOutcomeRecord[] = [];

    for (const row of rows) {
      if (row.isPreloadExcluded) {
        outcomes.push({
          sourceRow: row.sourceRow,
          outcome: 'skipped',
          entity: row.entity,
          reasonCode: 'PRELOAD_POLICY_EXCLUSION',
          reasonText: row.skipReason ?? 'Pre-load exclusion policy applied before target mutation.',
        });
        continue;
      }

      if (row.isDuplicateForMerge) {
        outcomes.push({
          sourceRow: row.sourceRow,
          outcome: 'merged',
          entity: row.entity,
          targetId: row.mergedTargetId,
          reasonCode: 'HUMAN_REVIEW_EXACT_DUPLICATE_MERGE',
          reasonText: 'Exact duplicate held and linked to canonical existing record per human review.',
        });
        continue;
      }

      const idempotencyKey = `${batchId}#${row.sourceRow}#${row.entity}#v1`;

      const result = await this.adapter.importRow(batchId, row.sourceRow, idempotencyKey, {
        entity: row.entity,
        data: row.data,
      });

      if (result.ok) {
        const receipt = result.value.receipt;
        const outcome: 'loaded' | 'merged' = receipt.kind === 'linked' ? 'merged' : 'loaded';
        outcomes.push({
          sourceRow: row.sourceRow,
          outcome,
          entity: row.entity,
          targetId: (receipt as any).targetId ?? (receipt as any).targetEntityId,
          idempotencyKey,
        });
      } else {
        outcomes.push({
          sourceRow: row.sourceRow,
          outcome: 'rejected',
          entity: row.entity,
          reasonCode: result.error.reasonCode,
          reasonText: result.error.message,
        });
      }
    }

    const reconciliation = this.reconcileBatch({
      batchId,
      sourceCount: rows.length,
      outcomes,
    });

    const linkAudit = this.auditLinkIntegrity();

    return {
      report: reconciliation.report,
      outcomes: reconciliation.outcomes,
      linkAudit,
    };
  }
}

export const crm5ReconciliationService = new Crm5ReconciliationService();
