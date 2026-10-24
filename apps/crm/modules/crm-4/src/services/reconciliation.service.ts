import { randomUUID } from 'node:crypto';
import {
  type ReconciliationReport,
  type ReconciliationStatus,
  ReconciliationReportSchema,
  verifyReconciliation,
} from '@clearshift/contracts';
import { Crm4Service, crm4Service } from './crm4.service.js';
import { Crm4TargetAdapter } from '../migration/target-adapter.js';

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
  listsChecked: number;
  campaignsChecked: number;
  membersChecked: number;
  consentsChecked: number;
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

/**
 * CRM-4 Reconciliation & Gate G4 Acceptance Audit Service ([CRM4-30] / Issue #183)
 *
 * Implements canonical V1 reconciliation and audit guarantees:
 * 1. Every source row receives exactly one terminal outcome: loaded, rejected, merged, or skipped.
 * 2. Strict conservation equation: source = loaded + rejected + merged + skipped (unaccounted = 0).
 * 3. Relational link integrity validation across lists, campaigns, members, and consents.
 * 4. Durable receipt completeness and idempotency verification.
 */
export class Crm4ReconciliationService {
  private service: Crm4Service;
  private adapter: Crm4TargetAdapter;

  constructor(options?: { service?: Crm4Service; adapter?: Crm4TargetAdapter }) {
    this.service = options?.service ?? crm4Service;
    this.adapter = options?.adapter ?? new Crm4TargetAdapter(this.service);
  }

  public getService(): Crm4Service {
    return this.service;
  }

  public getAdapter(): Crm4TargetAdapter {
    return this.adapter;
  }

  /**
   * Evaluates terminal outcomes and compiles a formal ReconciliationReport conforming to ReconciliationReportSchema.
   */
  public reconcileBatch(input: {
    batchId: string;
    sourceCount: number;
    outcomes: RowOutcomeRecord[];
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
      module: 'crm-4',
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
   * Audits link integrity across all in-memory or persisted CRM-4 target records.
   * Asserts:
   * - Every campaign points to a known existing marketing list (BR-CRM4-02).
   * - Every campaign member points to a known existing campaign.
   * - Every member status belongs strictly to ['sent', 'opened', 'clicked'].
   * - No duplicate membership (campaignId#contactId).
   * - Consents maintain 1:1 contact mapping.
   */
  public auditLinkIntegrity(): LinkIntegrityAuditResult {
    const snapshot = this.service.snapshotState();
    const brokenLinks: string[] = [];

    let listsChecked = snapshot.lists.size;
    let campaignsChecked = 0;
    let membersChecked = 0;
    let consentsChecked = 0;

    // 1. Audit Campaigns -> Lists (N:1)
    for (const [campaignId, campaign] of snapshot.campaigns.entries()) {
      campaignsChecked += 1;
      if (!snapshot.lists.has(campaign.listId)) {
        brokenLinks.push(
          `Campaign '${campaignId}' references non-existent marketing list '${campaign.listId}'.`
        );
      }
    }

    // 2. Audit Campaign Members -> Campaigns & Allowlist
    const memberUniqueKeys = new Set<string>();
    for (const [memberId, member] of snapshot.members.entries()) {
      membersChecked += 1;
      if (!snapshot.campaigns.has(member.campaignId)) {
        brokenLinks.push(
          `Member '${memberId}' references non-existent campaign '${member.campaignId}'.`
        );
      }

      if (!['sent', 'opened', 'clicked'].includes(member.status)) {
        brokenLinks.push(
          `Member '${memberId}' has invalid engagement status '${member.status}'. Permitted: sent, opened, clicked.`
        );
      }

      const exactKey = `${member.campaignId}#${member.contactId}`;
      if (memberUniqueKeys.has(exactKey)) {
        brokenLinks.push(
          `Duplicate member insertion detected for campaign '${member.campaignId}' and contact '${member.contactId}'.`
        );
      }
      memberUniqueKeys.add(exactKey);
    }

    // 3. Audit Consents (1:1 per contact)
    const consentContacts = new Set<string>();
    for (const [contactId, consent] of snapshot.consents.entries()) {
      consentsChecked += 1;
      if (consentContacts.has(consent.contactId)) {
        brokenLinks.push(`Duplicate consent record detected for contact '${consent.contactId}'.`);
      }
      consentContacts.add(consent.contactId);
    }

    const totalChecked = listsChecked + campaignsChecked + membersChecked + consentsChecked;
    const valid = brokenLinks.length === 0;

    return {
      valid,
      totalChecked,
      listsChecked,
      campaignsChecked,
      membersChecked,
      consentsChecked,
      brokenLinks,
    };
  }

  /**
   * Audits that every loaded/merged target record has a durable receipt.
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

    const snapshot = this.service.snapshotState();
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

    // Check lists
    for (const id of snapshot.lists.keys()) {
      if (!receiptTargetIds.has(id)) {
        unreceiptedTargetIds.push(`list:${id}`);
      }
    }
    // Check campaigns
    for (const id of snapshot.campaigns.keys()) {
      if (!receiptTargetIds.has(id)) {
        unreceiptedTargetIds.push(`campaign:${id}`);
      }
    }
    // Check members
    for (const id of snapshot.members.keys()) {
      if (!receiptTargetIds.has(id)) {
        unreceiptedTargetIds.push(`member:${id}`);
      }
    }
    // Check consents
    for (const [contactId, consent] of snapshot.consents.entries()) {
      if (!receiptTargetIds.has(consent.id)) {
        unreceiptedTargetIds.push(`consent:${consent.id} (contact:${contactId})`);
      }
    }

    const targetRecordsCount =
      snapshot.lists.size + snapshot.campaigns.size + snapshot.members.size + snapshot.consents.size;

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
      entity: 'list' | 'campaign' | 'member' | 'consent';
      data: Record<string, unknown>;
      isPreloadExcluded?: boolean;
      skipReason?: string;
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

export const crm4ReconciliationService = new Crm4ReconciliationService();
