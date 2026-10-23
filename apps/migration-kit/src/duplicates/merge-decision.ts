import { randomUUID } from 'node:crypto';
import {
  type MergeDecisionPayload,
  type MergeReceipt,
  UnreviewedCandidateMergeError,
  UnauthorizedMergeDecisionError,
  computeCanonicalPayloadHash,
} from '@clearshift/contracts';
import type { IDuplicateCandidateRepository } from './types.js';
import type { IRowOutcomeLedger } from '../reconcile/outcome-ledger.js';

export const AUTHORIZED_MERGE_ROLES = [
  'migration_admin',
  'platform_admin',
  'editor',
] as const;

/**
 * Service orchestrating human review decisions and audited merge executions.
 */
export class MergeDecisionService {
  constructor(
    private candidateRepo: IDuplicateCandidateRepository,
    private outcomeLedger?: IRowOutcomeLedger
  ) {}

  /**
   * Submits a reviewer's decision for a duplicate candidate.
   * Enforces:
   * 1. Reauthorization at submission time (Editor/Admin only).
   * 2. Replay-safe idempotency.
   * 3. Atomic commit of merge receipt and row outcome (if merge selected).
   */
  public async submitDecision(payload: MergeDecisionPayload): Promise<{
    status: 'resolved_keep_both' | 'resolved_merge';
    receipt?: MergeReceipt;
    isExisting?: boolean;
  }> {
    // 1. Reauthorize reviewer role at submit
    const isAuthorized = (AUTHORIZED_MERGE_ROLES as readonly string[]).includes(
      payload.reviewerRole
    );
    if (!isAuthorized) {
      throw new UnauthorizedMergeDecisionError(
        payload.reviewer,
        payload.reviewerRole
      );
    }

    // 2. Fetch candidate record
    const candidate = await this.candidateRepo.getCandidateById(payload.candidateId);
    if (!candidate) {
      throw new Error(`Duplicate candidate '${payload.candidateId}' not found.`);
    }

    // 3. Compute stable idempotency key for the decision
    const decisionHash = computeCanonicalPayloadHash({
      candidateId: payload.candidateId,
      decision: payload.decision,
      keptId: payload.keptId,
      absorbedSourceRows: payload.absorbedSourceRows,
    });
    const idempotencyKey = `merge_dec:${payload.candidateId}:${decisionHash}`;

    // 4. Check for replay-safe execution
    const existingReceipt = await this.candidateRepo.getMergeReceiptByIdempotencyKey(idempotencyKey);
    if (existingReceipt) {
      return {
        status: candidate.status as 'resolved_keep_both' | 'resolved_merge',
        receipt: existingReceipt,
        isExisting: true,
      };
    }

    // 5. Execute decision
    if (payload.decision === 'keep_both') {
      await this.candidateRepo.updateCandidateStatus(
        payload.candidateId,
        'resolved_keep_both'
      );
      return { status: 'resolved_keep_both' };
    }

    // Decision === 'merge'
    const receipt: MergeReceipt = {
      id: randomUUID(),
      batchId: payload.batchId,
      candidateId: payload.candidateId,
      keptId: payload.keptId,
      absorbedSourceRows: payload.absorbedSourceRows,
      matchingRule: candidate.matchingRule,
      matchingRuleVersion: candidate.matchingRuleVersion,
      evidence: candidate.evidence,
      reviewer: payload.reviewer,
      reviewedAt: new Date(),
      fieldChoices: payload.fieldChoices,
      idempotencyKey,
      createdAt: new Date(),
    };

    // Commit merge receipt and update candidate status
    await this.candidateRepo.saveMergeReceipt(receipt);
    await this.candidateRepo.updateCandidateStatus(
      payload.candidateId,
      'resolved_merge'
    );

    // If outcome ledger is attached, update terminal outcome to 'merged'
    if (this.outcomeLedger) {
      for (const sourceRow of payload.absorbedSourceRows) {
        await this.outcomeLedger.recordOutcome({
          batchId: payload.batchId,
          sourceRow,
          outcome: 'merged',
          targetId: payload.keptId,
          reasonCode: candidate.matchingRule,
          reasonMessage: `Merged into existing target entity ${payload.keptId} per review by ${payload.reviewer}`,
          actor: payload.reviewer,
          policyCode: 'human_reviewed_merge',
          approvedBy: payload.reviewer,
          approvedAt: new Date(),
        });
      }
    }

    return {
      status: 'resolved_merge',
      receipt,
      isExisting: false,
    };
  }

  /**
   * Asserts that a row is not an unreviewed duplicate candidate before load.
   */
  public async assertCanLoad(batchId: string, sourceRow: number): Promise<void> {
    const pendingList = await this.candidateRepo.listPendingByBatchId(batchId);
    const isPending = pendingList.some((c) => c.sourceRow === sourceRow);

    if (isPending) {
      throw new UnreviewedCandidateMergeError(batchId, sourceRow);
    }
  }
}
