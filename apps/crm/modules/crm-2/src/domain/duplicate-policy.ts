import { randomUUID } from 'node:crypto';
import {
  type Crm2ExactKeyType,
  type Crm2DuplicateCandidate,
  type Crm2ResolveDuplicateInput,
  type Crm2DuplicateAuditLogEntry,
  type Crm2RecordWithKey,
  buildQuoteExactKey,
  normalizeCrm2ExactKey,
} from '@clearshift/contracts';
import {
  normalizeEmail,
  normalizePhone,
  normalizeSku,
  normalizeTaxNumber,
} from '@cs/core';
import {
  AutoMergeForbiddenError,
  DuplicateCandidateNotFoundError,
  DomainValidationError,
} from './errors.js';

/**
 * Key Normalizer Function Type
 */
export type KeyNormalizerFn = (value: string) => string;

/**
 * Registry of deterministic key normalizers for CRM-2.
 * Supports domain keys: 'deal_business', 'deal_name_contact', 'quote_number',
 * 'quote_line_sku', 'source_key', plus standard shared keys ('email', 'tax_id', 'sku', 'phone', 'composite').
 */
export class ExactKeyRegistry {
  private normalizers: Map<string, KeyNormalizerFn> = new Map();

  constructor() {
    this.register('deal_business', (val) => normalizeCrm2ExactKey('deal_business', val));
    this.register('deal_name_contact', (val) => normalizeCrm2ExactKey('deal_name_contact', val));
    this.register('quote_number', (val) => buildQuoteExactKey(val));
    this.register('quote_line_sku', (val) => normalizeCrm2ExactKey('quote_line_sku', val));
    this.register('sku', (val) => normalizeSku(val));
    this.register('email', (val) => normalizeEmail(val));
    this.register('tax_id', (val) => normalizeTaxNumber(val));
    this.register('phone', (val) => normalizePhone(val));
    this.register('composite', (val) => normalizeCrm2ExactKey('composite', val));
    this.register('source_key', (val) => normalizeCrm2ExactKey('source_key', val));
  }

  public register(keyType: string, fn: KeyNormalizerFn): void {
    this.normalizers.set(keyType.toLowerCase(), fn);
  }

  public normalize(keyType: string, value: string): string {
    const fn = this.normalizers.get(keyType.toLowerCase());
    if (fn) {
      return fn(value);
    }
    return normalizeCrm2ExactKey(keyType as Crm2ExactKeyType, value);
  }

  public has(keyType: string): boolean {
    return this.normalizers.has(keyType.toLowerCase());
  }
}

export const defaultKeyRegistry = new ExactKeyRegistry();

export interface DuplicateDetectionResult {
  uniqueRecords: Crm2RecordWithKey[];
  duplicateCandidates: Crm2DuplicateCandidate[];
  summary: {
    totalRecords: number;
    uniqueCount: number;
    duplicateGroupCount: number;
    duplicateRecordCount: number;
  };
}

/**
 * Deterministic Exact Duplicate Candidate Detector for CRM-2.
 * Flags exact matches based on normalized key.
 *
 * Rules:
 * 1. Identical normalized keys are flagged deterministically as duplicate candidates.
 * 2. Automatic merging is strictly forbidden in V1; if autoMerge is requested,
 *    AutoMergeForbiddenError (422) is thrown.
 * 3. All duplicate groups are created in 'held_for_review' status.
 */
export function detectExactDuplicates(
  records: Crm2RecordWithKey[],
  keyType: Crm2ExactKeyType,
  options?: {
    batchId?: string | undefined;
    entity?: 'deal' | 'quote' | 'quote_line' | string | undefined;
    registry?: ExactKeyRegistry | undefined;
    autoMerge?: boolean | undefined;
  }
): DuplicateDetectionResult {
  if (options?.autoMerge) {
    throw new AutoMergeForbiddenError(
      'Automatic fuzzy or unreviewed merging is forbidden in V1. Duplicate candidates must be held for authorized human review.'
    );
  }

  const registry = options?.registry ?? defaultKeyRegistry;
  const groups = new Map<string, Crm2RecordWithKey[]>();

  for (const record of records) {
    const normalized = registry.normalize(keyType, record.keyValue);
    const existing = groups.get(normalized);
    if (existing) {
      existing.push(record);
    } else {
      groups.set(normalized, [record]);
    }
  }

  const uniqueRecords: Crm2RecordWithKey[] = [];
  const duplicateCandidates: Crm2DuplicateCandidate[] = [];
  let duplicateRecordCount = 0;

  for (const [normalizedKey, recs] of groups.entries()) {
    if (recs.length === 1) {
      uniqueRecords.push(recs[0]!);
    } else {
      duplicateRecordCount += recs.length;
      duplicateCandidates.push({
        id: randomUUID(),
        batchId: options?.batchId,
        module: 'crm-2',
        entity: options?.entity || 'deal',
        keyType,
        normalizedKey,
        recordIds: recs.map((r) => r.id),
        status: 'held_for_review',
        detectedAt: new Date(),
        metadata: {
          originalKeys: recs.map((r) => r.keyValue),
        },
      });
    }
  }

  return {
    uniqueRecords,
    duplicateCandidates,
    summary: {
      totalRecords: records.length,
      uniqueCount: uniqueRecords.length,
      duplicateGroupCount: duplicateCandidates.length,
      duplicateRecordCount,
    },
  };
}

/**
 * Human Review Queue and Merge Decision Audit Logger for CRM-2.
 * Holds duplicate candidates for authorized human resolution.
 * Durably records merge decisions with actor ID, timestamp, kept ID, and merged ID.
 */
export class DuplicateReviewQueue {
  private candidates: Map<string, Crm2DuplicateCandidate> = new Map();
  private auditLog: Crm2DuplicateAuditLogEntry[] = [];

  public addCandidate(candidate: Crm2DuplicateCandidate): void {
    this.candidates.set(candidate.id, { ...candidate });
  }

  public addCandidates(candidates: Crm2DuplicateCandidate[]): void {
    for (const c of candidates) {
      this.addCandidate(c);
    }
  }

  public getCandidate(id: string): Crm2DuplicateCandidate | undefined {
    return this.candidates.get(id);
  }

  public listHeld(query?: {
    batchId?: string | undefined;
    keyType?: string | undefined;
    entity?: string | undefined;
  }): Crm2DuplicateCandidate[] {
    let list = Array.from(this.candidates.values()).filter(
      (c) => c.status === 'held_for_review'
    );

    if (query?.batchId) {
      list = list.filter((c) => c.batchId === query.batchId);
    }
    if (query?.keyType) {
      list = list.filter((c) => c.keyType === query.keyType);
    }
    if (query?.entity) {
      list = list.filter((c) => c.entity === query.entity);
    }

    return list.sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
  }

  /**
   * Resolves a candidate via authorized human decision.
   * Enforces:
   * 1. Candidate must exist in queue.
   * 2. keptId !== mergedId for MERGE decisions.
   * 3. actorId must not be blank.
   * 4. Audit log entry is generated immutably.
   */
  public resolve(input: Crm2ResolveDuplicateInput): Crm2DuplicateAuditLogEntry {
    const candidate = this.candidates.get(input.candidateId);
    if (!candidate) {
      throw new DuplicateCandidateNotFoundError(input.candidateId);
    }

    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new DomainValidationError('actorId is required for duplicate review decisions');
    }

    if (input.decision === 'MERGE' && input.keptId === input.mergedId) {
      throw new DomainValidationError(
        'keptId and mergedId cannot be the same entity for MERGE decisions'
      );
    }

    // Verify keptId and mergedId belong to candidate recordIds if decision is MERGE
    if (input.decision === 'MERGE') {
      const ids = candidate.recordIds;
      if (!ids.includes(input.keptId)) {
        throw new DomainValidationError(
          `keptId '${input.keptId}' does not belong to candidate recordIds: [${ids.join(', ')}]`
        );
      }
      if (!ids.includes(input.mergedId)) {
        throw new DomainValidationError(
          `mergedId '${input.mergedId}' does not belong to candidate recordIds: [${ids.join(', ')}]`
        );
      }
    }

    // Mark candidate resolved
    candidate.status = 'resolved';

    // Record immutable audit entry
    const auditEntry: Crm2DuplicateAuditLogEntry = {
      id: randomUUID(),
      candidateId: candidate.id,
      decision: input.decision,
      actorId: input.actorId.trim(),
      timestamp: new Date(),
      keptId: input.keptId,
      mergedId: input.mergedId,
      reason: input.reason.trim(),
      keyType: candidate.keyType,
      normalizedKey: candidate.normalizedKey,
      entity: candidate.entity,
      metadata: input.metadata,
    };

    this.auditLog.push(auditEntry);
    return auditEntry;
  }

  public getAuditLogs(query?: {
    candidateId?: string | undefined;
    actorId?: string | undefined;
    entity?: string | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
  }): {
    items: Crm2DuplicateAuditLogEntry[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } {
    let list = [...this.auditLog];

    if (query?.candidateId) {
      list = list.filter((a) => a.candidateId === query.candidateId);
    }
    if (query?.actorId) {
      list = list.filter((a) => a.actorId === query.actorId);
    }
    if (query?.entity) {
      list = list.filter((a) => a.entity === query.entity);
    }

    list.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const page = query?.page && query.page > 0 ? query.page : 1;
    const pageSize = query?.pageSize && query.pageSize > 0 ? query.pageSize : 20;
    const total = list.length;
    const totalPages = Math.ceil(total / pageSize) || (total === 0 ? 0 : 1);
    const start = (page - 1) * pageSize;
    const items = list.slice(start, start + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  public clear(): void {
    this.candidates.clear();
    this.auditLog = [];
  }
}
