import { randomUUID } from 'node:crypto';
import {
  type Crm1ExactKeyType,
  type Crm1DuplicateCandidate,
  type Crm1ResolveDuplicateInput,
  type Crm1DuplicateAuditLogEntry,
  type Crm1RecordWithKey,
  normalizeCrm1ExactKey,
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
 * Registry of deterministic key normalizers for CRM-1.
 * Supports domain keys: 'email', 'phone_name', 'tax_number', 'tax_id', 'phone', 'sku', 'composite', 'source_key'.
 * Allows registering custom key normalizers.
 */
export class ExactKeyRegistry {
  private normalizers: Map<string, KeyNormalizerFn> = new Map();

  constructor() {
    this.register('email', (val) => normalizeEmail(val));
    this.register('tax_number', (val) => normalizeTaxNumber(val));
    this.register('tax_id', (val) => normalizeTaxNumber(val));
    this.register('phone', (val) => normalizePhone(val));
    this.register('sku', (val) => normalizeSku(val));
    this.register('phone_name', (val) => normalizeCrm1ExactKey('phone_name', val));
    this.register('source_key', (val) => normalizeCrm1ExactKey('source_key', val));
    this.register('composite', (val) => normalizeCrm1ExactKey('composite', val));
  }

  public register(keyType: string, fn: KeyNormalizerFn): void {
    this.normalizers.set(keyType.toLowerCase(), fn);
  }

  public normalize(keyType: string, value: string): string {
    const fn = this.normalizers.get(keyType.toLowerCase());
    if (fn) {
      return fn(value);
    }
    return normalizeCrm1ExactKey(keyType as Crm1ExactKeyType, value);
  }

  public has(keyType: string): boolean {
    return this.normalizers.has(keyType.toLowerCase());
  }
}

export const defaultKeyRegistry = new ExactKeyRegistry();

export interface DuplicateDetectionResult {
  uniqueRecords: Crm1RecordWithKey[];
  duplicateCandidates: Crm1DuplicateCandidate[];
  summary: {
    totalRecords: number;
    uniqueCount: number;
    duplicateGroupCount: number;
    duplicateRecordCount: number;
  };
}

/**
 * Deterministic Exact Duplicate Candidate Detector for CRM-1.
 * Flags exact matches based on normalized key.
 *
 * Rules:
 * 1. Identical normalized keys are flagged deterministically as duplicate candidates.
 * 2. Automatic merging is strictly forbidden in V1; if autoMerge is requested,
 *    AutoMergeForbiddenError (422) is thrown.
 * 3. All duplicate groups are created in 'held_for_review' status.
 */
export function detectExactDuplicates(
  records: Crm1RecordWithKey[],
  keyType: Crm1ExactKeyType,
  options?: {
    batchId?: string | undefined;
    entity?: 'contact' | 'company' | 'lead' | string | undefined;
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
  const groups = new Map<string, Crm1RecordWithKey[]>();

  for (const record of records) {
    const normalized = registry.normalize(keyType, record.keyValue);
    const existing = groups.get(normalized);
    if (existing) {
      existing.push(record);
    } else {
      groups.set(normalized, [record]);
    }
  }

  const uniqueRecords: Crm1RecordWithKey[] = [];
  const duplicateCandidates: Crm1DuplicateCandidate[] = [];
  let duplicateRecordCount = 0;

  for (const [normalizedKey, recs] of groups.entries()) {
    if (recs.length === 1) {
      uniqueRecords.push(recs[0]!);
    } else {
      duplicateRecordCount += recs.length;
      duplicateCandidates.push({
        id: randomUUID(),
        batchId: options?.batchId,
        module: 'crm-1',
        entity: (options?.entity as string) ?? 'contact',
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
 * Human Review Queue and Merge Decision Audit Logger for CRM-1.
 * Holds duplicate candidates for authorized human resolution.
 * Durably records merge decisions with actor ID, timestamp, kept ID, and merged ID.
 */
export class DuplicateReviewQueue {
  private candidates: Map<string, Crm1DuplicateCandidate> = new Map();
  private auditLog: Crm1DuplicateAuditLogEntry[] = [];

  public addCandidate(candidate: Crm1DuplicateCandidate): void {
    this.candidates.set(candidate.id, { ...candidate });
  }

  public addCandidates(candidates: Crm1DuplicateCandidate[]): void {
    for (const c of candidates) {
      this.addCandidate(c);
    }
  }

  public getCandidate(id: string): Crm1DuplicateCandidate | undefined {
    return this.candidates.get(id);
  }

  public listHeld(query?: {
    batchId?: string | undefined;
    keyType?: string | undefined;
    entity?: string | undefined;
  }): Crm1DuplicateCandidate[] {
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
   * 4. Audit log entry is generated immutably with actor ID, timestamp, kept ID, merged ID, and reason.
   */
  public resolve(input: Crm1ResolveDuplicateInput): Crm1DuplicateAuditLogEntry {
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
    const auditEntry: Crm1DuplicateAuditLogEntry = {
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
      entity: candidate.entity ?? 'contact',
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
    items: Crm1DuplicateAuditLogEntry[];
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
