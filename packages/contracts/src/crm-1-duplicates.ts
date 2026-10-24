import { z } from 'zod';
import {
  normalizeEmail,
  normalizePhone,
  normalizeName,
  normalizeSku,
  normalizeTaxNumber,
} from '@cs/core';
import {
  CRM1LeadStatusSchema,
  type CRM1LeadStatus,
} from './crm-1.js';
import {
  DuplicateCandidateStatusSchema,
  DuplicateReviewDecisionSchema,
  type DuplicateCandidateStatus,
  type DuplicateReviewDecision,
} from './crm-5.js';

export {
  DuplicateCandidateStatusSchema,
  DuplicateReviewDecisionSchema,
  type DuplicateCandidateStatus,
  type DuplicateReviewDecision,
};

// ---------------------------------------------------------------------------
// 1. Exact Key Builders
// ---------------------------------------------------------------------------

/**
 * Builds normalized exact email key for contacts.
 */
export function buildContactExactEmailKey(email: string | null | undefined): string | null {
  if (!email || !email.trim()) return null;
  return normalizeEmail(email);
}

/**
 * Builds normalized exact combined key (phone + name) for contacts.
 */
export function buildContactExactPhoneNameKey(
  phone: string | null | undefined,
  firstName: string | null | undefined,
  lastName: string | null | undefined
): string | null {
  if (!phone || !phone.trim() || !firstName || !lastName) return null;
  const normPhone = normalizePhone(phone);
  const normName = normalizeName(`${firstName.trim()} ${lastName.trim()}`);
  if (!normPhone || !normName) return null;
  return `${normPhone}#${normName}`;
}

/**
 * Builds normalized exact tax number key for companies.
 */
export function buildCompanyExactTaxKey(taxNumber: string | null | undefined): string | null {
  if (!taxNumber || !taxNumber.trim()) return null;
  return normalizeTaxNumber(taxNumber);
}

// ---------------------------------------------------------------------------
// 2. Exact Duplicate Policy & Human Review Invariants
// ---------------------------------------------------------------------------

export const DuplicateMatchOutcomeSchema = z.enum([
  'NO_MATCH',
  'EXACT_MATCH',
  'AMBIGUOUS_REVIEW_REQUIRED',
]);
export type DuplicateMatchOutcome = z.infer<typeof DuplicateMatchOutcomeSchema>;

export interface ContactCandidate {
  id?: string | null | undefined;
  firstName: string;
  lastName: string;
  email?: string | null | undefined;
  phone?: string | null | undefined;
}

export interface ExistingContactRecord {
  id: string;
  goldenId?: string | null | undefined;
  firstName: string;
  lastName: string;
  email?: string | null | undefined;
  phone?: string | null | undefined;
}

export interface DuplicateEvaluationResult {
  outcome: DuplicateMatchOutcome;
  matchedId?: string | undefined;
  matchedGoldenId?: string | undefined;
  matchingKeys: string[];
  candidateMatches: Array<{ id: string; goldenId?: string | null | undefined; matchedKey: string }>;
  requiresHumanReview: boolean;
  reason: string;
}

export interface CompanyCandidate {
  id?: string | null | undefined;
  name: string;
  taxNumber?: string | null | undefined;
}

export interface ExistingCompanyRecord {
  id: string;
  name: string;
  taxNumber?: string | null | undefined;
}

export interface CompanyDuplicateEvaluationResult {
  outcome: DuplicateMatchOutcome;
  matchedId?: string | undefined;
  matchingKeys: string[];
  candidateMatches: Array<{ id: string; matchedKey: string }>;
  requiresHumanReview: boolean;
  reason: string;
}

/**
 * Evaluates contact duplicates strictly using deterministic exact-key matching.
 * Invariant: Fuzzy auto-merge is prohibited. Ambiguous matches require explicit human review.
 */
export function evaluateContactDuplicate(
  candidate: ContactCandidate,
  pool: readonly ExistingContactRecord[]
): DuplicateEvaluationResult {
  const emailKey = buildContactExactEmailKey(candidate.email);
  const phoneNameKey = buildContactExactPhoneNameKey(
    candidate.phone,
    candidate.firstName,
    candidate.lastName
  );

  const matchesByEmail: ExistingContactRecord[] = [];
  const matchesByPhoneName: ExistingContactRecord[] = [];

  for (const existing of pool) {
    if (candidate.id && existing.id === candidate.id) {
      continue;
    }

    if (emailKey && buildContactExactEmailKey(existing.email) === emailKey) {
      matchesByEmail.push(existing);
    }

    if (
      phoneNameKey &&
      buildContactExactPhoneNameKey(existing.phone, existing.firstName, existing.lastName) ===
        phoneNameKey
    ) {
      matchesByPhoneName.push(existing);
    }
  }

  const allMatchedIds = new Set<string>();
  const candidateMatches: Array<{ id: string; goldenId?: string | null | undefined; matchedKey: string }> = [];

  matchesByEmail.forEach((m) => {
    allMatchedIds.add(m.id);
    const matchItem: { id: string; goldenId?: string | null | undefined; matchedKey: string } = {
      id: m.id,
      matchedKey: `email:${emailKey}`,
    };
    if (m.goldenId !== undefined) matchItem.goldenId = m.goldenId;
    candidateMatches.push(matchItem);
  });

  matchesByPhoneName.forEach((m) => {
    allMatchedIds.add(m.id);
    const matchItem: { id: string; goldenId?: string | null | undefined; matchedKey: string } = {
      id: m.id,
      matchedKey: `phone_name:${phoneNameKey}`,
    };
    if (m.goldenId !== undefined) matchItem.goldenId = m.goldenId;
    candidateMatches.push(matchItem);
  });

  if (allMatchedIds.size === 0) {
    return {
      outcome: 'NO_MATCH',
      matchingKeys: [],
      candidateMatches: [],
      requiresHumanReview: false,
      reason: 'No exact matches found',
    };
  }

  // If multiple distinct entities match, this is ambiguous and MUST NOT auto-merge
  if (allMatchedIds.size > 1) {
    return {
      outcome: 'AMBIGUOUS_REVIEW_REQUIRED',
      matchingKeys: Array.from(new Set(candidateMatches.map((c) => c.matchedKey))),
      candidateMatches,
      requiresHumanReview: true,
      reason: `Ambiguous match: candidate matches ${allMatchedIds.size} different contacts. Human review required.`,
    };
  }

  // Exactly one distinct existing contact matched
  const singleMatch = matchesByEmail[0] ?? matchesByPhoneName[0]!;
  const matchedKeys: string[] = [];
  if (matchesByEmail.length > 0) matchedKeys.push(`email:${emailKey}`);
  if (matchesByPhoneName.length > 0) matchedKeys.push(`phone_name:${phoneNameKey}`);

  const result: DuplicateEvaluationResult = {
    outcome: 'EXACT_MATCH',
    matchedId: singleMatch.id,
    matchingKeys: matchedKeys,
    candidateMatches,
    requiresHumanReview: false,
    reason: `Deterministic exact match on [${matchedKeys.join(', ')}]`,
  };
  if (singleMatch.goldenId !== undefined && singleMatch.goldenId !== null) {
    result.matchedGoldenId = singleMatch.goldenId;
  }
  return result;
}

/**
 * Evaluates company duplicates strictly using deterministic exact tax number matching.
 * Invariant: Ambiguous matches require explicit human review. Zero fuzzy auto-merge.
 */
export function evaluateCompanyDuplicate(
  candidate: CompanyCandidate,
  pool: readonly ExistingCompanyRecord[]
): CompanyDuplicateEvaluationResult {
  const taxKey = buildCompanyExactTaxKey(candidate.taxNumber);

  if (!taxKey) {
    return {
      outcome: 'NO_MATCH',
      matchingKeys: [],
      candidateMatches: [],
      requiresHumanReview: false,
      reason: 'No normalized tax number present on candidate company',
    };
  }

  const matches: ExistingCompanyRecord[] = [];
  for (const existing of pool) {
    if (candidate.id && existing.id === candidate.id) {
      continue;
    }
    if (buildCompanyExactTaxKey(existing.taxNumber) === taxKey) {
      matches.push(existing);
    }
  }

  if (matches.length === 0) {
    return {
      outcome: 'NO_MATCH',
      matchingKeys: [],
      candidateMatches: [],
      requiresHumanReview: false,
      reason: 'No exact tax number match found',
    };
  }

  const candidateMatches = matches.map((m) => ({
    id: m.id,
    matchedKey: `tax_number:${taxKey}`,
  }));

  if (matches.length > 1) {
    return {
      outcome: 'AMBIGUOUS_REVIEW_REQUIRED',
      matchingKeys: [`tax_number:${taxKey}`],
      candidateMatches,
      requiresHumanReview: true,
      reason: `Ambiguous match: tax number matches ${matches.length} different company records. Human review required.`,
    };
  }

  const singleMatch = matches[0]!;
  return {
    outcome: 'EXACT_MATCH',
    matchedId: singleMatch.id,
    matchingKeys: [`tax_number:${taxKey}`],
    candidateMatches,
    requiresHumanReview: false,
    reason: `Deterministic exact match on tax number [${taxKey}]`,
  };
}

// ---------------------------------------------------------------------------
// 3. Lead Status Transitions (SDS Allowlist)
// ---------------------------------------------------------------------------

/**
 * Strict Lead Workflow Status Transitions:
 * New -> [Working, Qualified, Closed]
 * Working -> [Qualified, Closed]
 * Qualified -> [Closed]
 * Closed -> [] (Terminal state)
 */
export const ALLOWED_LEAD_TRANSITIONS: Record<CRM1LeadStatus, readonly CRM1LeadStatus[]> = {
  New: ['Working', 'Qualified', 'Closed'],
  Working: ['Qualified', 'Closed'],
  Qualified: ['Closed'],
  Closed: [],
};

/**
 * Checks if a proposed lead status transition is permitted by the CRM SDS allowlist.
 */
export function canTransitionLeadStatus(
  currentStatus: CRM1LeadStatus,
  targetStatus: CRM1LeadStatus
): boolean {
  if (currentStatus === targetStatus) {
    return true; // No-op transition
  }
  const allowed = ALLOWED_LEAD_TRANSITIONS[currentStatus];
  return allowed ? allowed.includes(targetStatus) : false;
}

/**
 * Asserts that a lead status transition is valid, throwing an error if disallowed.
 */
export function assertValidLeadTransition(
  currentStatus: CRM1LeadStatus,
  targetStatus: CRM1LeadStatus
): void {
  if (!canTransitionLeadStatus(currentStatus, targetStatus)) {
    throw new Error(
      `Invalid lead status transition from '${currentStatus}' to '${targetStatus}'. Permitted transitions: [${
        ALLOWED_LEAD_TRANSITIONS[currentStatus]?.join(', ') || 'none (terminal state)'
      }]`
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Exact Key Types and Normalizers for CRM-1
// ---------------------------------------------------------------------------

export const Crm1ExactKeyTypeSchema = z.enum([
  'email',
  'phone_name',
  'tax_number',
  'tax_id',
  'phone',
  'sku',
  'composite',
  'source_key',
]);
export type Crm1ExactKeyType = z.infer<typeof Crm1ExactKeyTypeSchema>;

/**
 * Dispatches key normalization based on declared key type for CRM-1.
 */
export function normalizeCrm1ExactKey(type: Crm1ExactKeyType | string, value: string): string {
  switch (type) {
    case 'email':
      return normalizeEmail(value);
    case 'tax_number':
    case 'tax_id':
      return normalizeTaxNumber(value);
    case 'phone':
      return normalizePhone(value);
    case 'sku':
      return normalizeSku(value);
    case 'phone_name':
      return value.trim().toLowerCase().replace(/\s+/g, ' ');
    case 'source_key':
      return value.trim().toLowerCase();
    case 'composite':
      return value.trim().toLowerCase();
    default:
      return value.trim();
  }
}

// ---------------------------------------------------------------------------
// 5. API Schemas & DTOs for Duplicates & Human Review
// ---------------------------------------------------------------------------

export const Crm1RecordWithKeySchema = z.object({
  id: z.string().min(1),
  keyValue: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
});
export type Crm1RecordWithKey = z.infer<typeof Crm1RecordWithKeySchema>;

export const Crm1DetectDuplicatesInputSchema = z.object({
  batchId: z.string().max(128).optional(),
  entity: z.enum(['contact', 'company', 'lead']).default('contact'),
  keyType: Crm1ExactKeyTypeSchema,
  autoMerge: z.boolean().optional(),
  records: z.array(Crm1RecordWithKeySchema).min(1, 'records array must contain at least 1 record'),
});
export type Crm1DetectDuplicatesInput = z.infer<typeof Crm1DetectDuplicatesInputSchema>;

export const Crm1DuplicateCandidateSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().optional(),
  module: z.literal('crm-1').default('crm-1'),
  entity: z.string().default('contact'),
  keyType: Crm1ExactKeyTypeSchema,
  normalizedKey: z.string().min(1),
  recordIds: z.array(z.string()).min(2),
  status: DuplicateCandidateStatusSchema,
  detectedAt: z.coerce.date(),
  metadata: z.record(z.unknown()).optional(),
});
export type Crm1DuplicateCandidate = z.infer<typeof Crm1DuplicateCandidateSchema>;

export const Crm1ResolveDuplicateInputSchema = z
  .object({
    candidateId: z.string().min(1, 'candidateId is required'),
    decision: DuplicateReviewDecisionSchema,
    actorId: z.string().min(1, 'actorId is required'),
    keptId: z.string().min(1, 'keptId is required'),
    mergedId: z.string().min(1, 'mergedId is required'),
    reason: z.string().min(1, 'reason is required'),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine(
    (data) => {
      if (data.decision === 'MERGE') {
        return data.keptId !== data.mergedId;
      }
      return true;
    },
    {
      message: 'keptId and mergedId cannot be the same entity for MERGE decisions',
      path: ['mergedId'],
    }
  );
export type Crm1ResolveDuplicateInput = z.infer<typeof Crm1ResolveDuplicateInputSchema>;

export const Crm1DuplicateAuditLogEntrySchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),
  decision: DuplicateReviewDecisionSchema,
  actorId: z.string().min(1),
  timestamp: z.coerce.date(),
  keptId: z.string().min(1),
  mergedId: z.string().min(1),
  reason: z.string().min(1),
  keyType: Crm1ExactKeyTypeSchema,
  normalizedKey: z.string().min(1),
  entity: z.string().default('contact'),
  metadata: z.record(z.unknown()).optional(),
});
export type Crm1DuplicateAuditLogEntry = z.infer<typeof Crm1DuplicateAuditLogEntrySchema>;

export const Crm1EvaluateContactDuplicateInputSchema = z.object({
  id: z.string().uuid().optional(),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
});
export type Crm1EvaluateContactDuplicateInput = z.infer<typeof Crm1EvaluateContactDuplicateInputSchema>;

export const Crm1EvaluateCompanyDuplicateInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, 'Company name is required'),
  taxNumber: z.string().nullable().optional(),
});
export type Crm1EvaluateCompanyDuplicateInput = z.infer<typeof Crm1EvaluateCompanyDuplicateInputSchema>;
