import { randomUUID } from 'node:crypto';
import type {
  DuplicateCandidate,
  IDuplicateCandidateRepository,
  MergeReceipt,
} from './types.js';
import { evaluateExactMatch, MATCHING_RULE_VERSION } from './exact-rules.js';

/**
 * In-Memory repository for duplicate candidates and audited merge receipts.
 */
export class InMemoryDuplicateCandidateRepository implements IDuplicateCandidateRepository {
  private candidates: Map<string, DuplicateCandidate> = new Map();
  private receiptsByCandidate: Map<string, MergeReceipt> = new Map();
  private receiptsByIdempotencyKey: Map<string, MergeReceipt> = new Map();

  public async saveCandidate(candidate: DuplicateCandidate): Promise<DuplicateCandidate> {
    this.candidates.set(candidate.id, candidate);
    return candidate;
  }

  public async getCandidateById(id: string): Promise<DuplicateCandidate | null> {
    return this.candidates.get(id) ?? null;
  }

  public async listPendingByBatchId(batchId: string): Promise<DuplicateCandidate[]> {
    return Array.from(this.candidates.values()).filter(
      (c) => c.batchId === batchId && c.status === 'pending_review'
    );
  }

  public async updateCandidateStatus(
    id: string,
    status: 'pending_review' | 'resolved_keep_both' | 'resolved_merge'
  ): Promise<void> {
    const candidate = this.candidates.get(id);
    if (candidate) {
      candidate.status = status;
    }
  }

  public async saveMergeReceipt(receipt: MergeReceipt): Promise<void> {
    this.receiptsByCandidate.set(receipt.candidateId, receipt);
    this.receiptsByIdempotencyKey.set(receipt.idempotencyKey, receipt);
  }

  public async getMergeReceiptByCandidateId(candidateId: string): Promise<MergeReceipt | null> {
    return this.receiptsByCandidate.get(candidateId) ?? null;
  }

  public async getMergeReceiptByIdempotencyKey(key: string): Promise<MergeReceipt | null> {
    return this.receiptsByIdempotencyKey.get(key) ?? null;
  }

  public clear(): void {
    this.candidates.clear();
    this.receiptsByCandidate.clear();
    this.receiptsByIdempotencyKey.clear();
  }
}

/**
 * Service for identifying duplicate candidates and managing the review queue.
 */
export class DuplicateCandidateService {
  constructor(private repo: IDuplicateCandidateRepository) {}

  /**
   * Evaluates incoming source rows against existing target pool using V1 exact rules.
   * Target matches are placed in the human review queue.
   */
  public async scanForTargetDuplicates(
    batchId: string,
    entity: string,
    sourceRows: Array<{ sourceRow: number; data: Record<string, unknown> }>,
    targetPool: Array<{ id: string; data: Record<string, unknown> }>
  ): Promise<DuplicateCandidate[]> {
    const discoveredCandidates: DuplicateCandidate[] = [];

    for (const source of sourceRows) {
      for (const target of targetPool) {
        const evalResult = evaluateExactMatch(source.data, target.data, entity);

        if (evalResult.isMatch && evalResult.matchingRule) {
          const candidate: DuplicateCandidate = {
            id: randomUUID(),
            batchId,
            sourceRow: source.sourceRow,
            entity,
            sourceRecord: source.data,
            targetRecord: target.data,
            targetId: target.id,
            matchingRule: evalResult.matchingRule,
            matchingRuleVersion: evalResult.matchingRuleVersion || MATCHING_RULE_VERSION,
            evidence: evalResult.evidence || evalResult.reason,
            status: 'pending_review',
            createdAt: new Date(),
          };

          await this.repo.saveCandidate(candidate);
          discoveredCandidates.push(candidate);
          break; // Stop after first target match per source row
        }
      }
    }

    return discoveredCandidates;
  }

  public async getPendingReview(batchId: string): Promise<DuplicateCandidate[]> {
    return this.repo.listPendingByBatchId(batchId);
  }

  public async getCandidateById(candidateId: string): Promise<DuplicateCandidate | null> {
    return this.repo.getCandidateById(candidateId);
  }
}
