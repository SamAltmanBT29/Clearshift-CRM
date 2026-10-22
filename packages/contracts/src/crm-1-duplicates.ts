import { z } from 'zod';
import {
  normalizeEmail,
  normalizePhone,
  normalizeName,
  normalizeTaxNumber,
} from '@cs/core';
import {
  CRM1LeadStatusSchema,
  type CRM1LeadStatus,
} from './crm-1.js';

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
