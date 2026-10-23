import type {
  KitDuplicateCandidate,
  KitDuplicateCandidateStatus,
  ExactMatchingRuleType,
  DuplicateReviewDecisionType,
  MergeDecisionPayload,
  MergeReceipt,
} from '@clearshift/contracts';

export type DuplicateCandidate = KitDuplicateCandidate;
export type DuplicateCandidateStatus = KitDuplicateCandidateStatus;

export type {
  KitDuplicateCandidate,
  KitDuplicateCandidateStatus,
  ExactMatchingRuleType,
  DuplicateReviewDecisionType,
  MergeDecisionPayload,
  MergeReceipt,
};

/**
 * Normalized comparison result for an exact duplicate match evaluation.
 */
export interface ExactMatchEvaluation {
  isMatch: boolean;
  matchingRule?: ExactMatchingRuleType;
  matchingRuleVersion: string;
  evidence?: string;
  reason: string;
}

/**
 * Storage interface for duplicate candidates and review decisions.
 */
export interface IDuplicateCandidateRepository {
  saveCandidate(candidate: DuplicateCandidate): Promise<DuplicateCandidate>;
  getCandidateById(id: string): Promise<DuplicateCandidate | null>;
  listPendingByBatchId(batchId: string): Promise<DuplicateCandidate[]>;
  updateCandidateStatus(
    id: string,
    status: 'pending_review' | 'resolved_keep_both' | 'resolved_merge'
  ): Promise<void>;
  saveMergeReceipt(receipt: MergeReceipt): Promise<void>;
  getMergeReceiptByCandidateId(candidateId: string): Promise<MergeReceipt | null>;
  getMergeReceiptByIdempotencyKey(key: string): Promise<MergeReceipt | null>;
}
