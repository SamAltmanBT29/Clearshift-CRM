import { z } from 'zod';
import {
  normalizeEmail,
  normalizePhone,
  normalizeName,
  normalizeSku,
  normalizeTaxNumber,
} from '@cs/core';
import {
  DuplicateMatchOutcomeSchema,
  type DuplicateMatchOutcome,
} from './crm-1-duplicates.js';
import {
  DuplicateCandidateStatusSchema,
  DuplicateReviewDecisionSchema,
  type DuplicateCandidateStatus,
  type DuplicateReviewDecision,
} from './crm-5.js';

export {
  DuplicateMatchOutcomeSchema,
  type DuplicateMatchOutcome,
  DuplicateCandidateStatusSchema,
  DuplicateReviewDecisionSchema,
  type DuplicateCandidateStatus,
  type DuplicateReviewDecision,
};

// ---------------------------------------------------------------------------
// 1. Exact Key Types and Normalizers for CRM-2
// ---------------------------------------------------------------------------

export const Crm2ExactKeyTypeSchema = z.enum([
  'deal_business',
  'deal_name_contact',
  'quote_number',
  'quote_line_sku',
  'sku',
  'email',
  'tax_id',
  'phone',
  'composite',
  'source_key',
]);
export type Crm2ExactKeyType = z.infer<typeof Crm2ExactKeyTypeSchema>;

/**
 * Normalizes a deal business duplicate key:
 * ${trimmedDealName}#${stageId}#${contactId || 'orphan'}
 * - Deals matching identical normalized name, stage, and contact link are flagged deterministically.
 */
export function buildDealExactBusinessKey(deal: {
  name: string;
  stageId: string;
  contactId?: string | null | undefined;
}): string {
  const normName = normalizeName(deal.name);
  const stage = (deal.stageId || '').trim().toLowerCase();
  const contact = (deal.contactId || '').trim().toLowerCase() || 'orphan';
  return `${normName}#${stage}#${contact}`;
}

/**
 * Normalizes a deal name + contact link key:
 * ${trimmedDealName}#${contactId || 'orphan'}
 */
export function buildDealNameContactKey(
  name: string,
  contactId?: string | null | undefined
): string {
  const normName = normalizeName(name);
  const contact = (contactId || '').trim().toLowerCase() || 'orphan';
  return `${normName}#${contact}`;
}

/**
 * Normalizes quote unique reference:
 * Trimmed uppercase quote number (e.g. "Q-2026-001")
 */
export function buildQuoteExactKey(quoteNumber: string): string {
  if (typeof quoteNumber !== 'string') return '';
  return quoteNumber.trim().toUpperCase();
}

/**
 * Normalizes quote line item SKU key within a quote:
 * ${quoteId}#${normalizedSku}
 */
export function buildQuoteLineExactKey(quoteId: string, sku: string): string {
  const normQuoteId = (quoteId || '').trim().toLowerCase();
  const normSku = normalizeSku(sku);
  return `${normQuoteId}#${normSku}`;
}

/**
 * Normalizes Migration Kit source system pair key:
 * ${sourceSystem}:${sourceId}
 */
export function buildSourcePairKey(sourceSystem: string, sourceId: string): string {
  const sys = (sourceSystem || '').trim().toLowerCase();
  const id = (sourceId || '').trim();
  return `${sys}:${id}`;
}

/**
 * Dispatches key normalization based on declared key type.
 */
export function normalizeCrm2ExactKey(type: Crm2ExactKeyType | string, value: string): string {
  switch (type) {
    case 'quote_number':
      return buildQuoteExactKey(value);
    case 'sku':
      return normalizeSku(value);
    case 'email':
      return normalizeEmail(value);
    case 'tax_id':
      return normalizeTaxNumber(value);
    case 'phone':
      return normalizePhone(value);
    case 'deal_name_contact':
      return value.trim().toLowerCase().replace(/\s+/g, ' ');
    case 'deal_business':
      return value.trim().toLowerCase().replace(/\s+/g, ' ');
    case 'quote_line_sku':
      return value.trim().toUpperCase();
    case 'source_key':
      return value.trim().toLowerCase();
    case 'composite':
      return value.trim().toLowerCase();
    default:
      return value.trim();
  }
}

// ---------------------------------------------------------------------------
// 2. Candidate & Record Interfaces for Evaluation
// ---------------------------------------------------------------------------

export interface DealCandidate {
  id?: string | null | undefined;
  name: string;
  stageId?: string | undefined;
  stageName?: string | undefined;
  contactId?: string | null | undefined;
  value?: string | number | undefined;
  currency?: string | undefined;
}

export interface ExistingDealRecord {
  id: string;
  name: string;
  stageId: string;
  stageName?: string | undefined;
  contactId?: string | null | undefined;
  value?: string | undefined;
  currency?: string | undefined;
}

export interface DealDuplicateEvaluationResult {
  outcome: DuplicateMatchOutcome;
  matchedId?: string | undefined;
  matchingKeys: string[];
  candidateMatches: Array<{ id: string; matchedKey: string }>;
  requiresHumanReview: boolean;
  reason: string;
}

export interface QuoteCandidate {
  id?: string | null | undefined;
  quoteNumber: string;
  dealId?: string | undefined;
  amount?: string | number | undefined;
  currency?: string | undefined;
}

export interface ExistingQuoteRecord {
  id: string;
  quoteNumber: string;
  dealId: string;
  amount?: string | undefined;
  currency?: string | undefined;
}

export interface QuoteDuplicateEvaluationResult {
  outcome: DuplicateMatchOutcome;
  matchedId?: string | undefined;
  matchingKeys: string[];
  candidateMatches: Array<{ id: string; matchedKey: string }>;
  requiresHumanReview: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// 3. Deterministic Exact Duplicate Evaluation Functions
// ---------------------------------------------------------------------------

/**
 * Evaluates a Deal duplicate candidate deterministically against a pool of existing deals.
 * Invariant: Fuzzy auto-merge is prohibited. Ambiguous matches require explicit human review.
 */
export function evaluateDealDuplicate(
  candidate: DealCandidate,
  pool: readonly ExistingDealRecord[]
): DealDuplicateEvaluationResult {
  const normName = normalizeName(candidate.name);
  if (!normName) {
    return {
      outcome: 'NO_MATCH',
      matchingKeys: [],
      candidateMatches: [],
      requiresHumanReview: false,
      reason: 'Empty candidate deal name; cannot match',
    };
  }

  // 1. Compute deterministic keys
  const nameContactKey = buildDealNameContactKey(candidate.name, candidate.contactId);
  const businessKey = candidate.stageId
    ? buildDealExactBusinessKey({
        name: candidate.name,
        stageId: candidate.stageId,
        contactId: candidate.contactId,
      })
    : null;

  const matchesByBusinessKey: ExistingDealRecord[] = [];
  const matchesByNameContact: ExistingDealRecord[] = [];

  for (const existing of pool) {
    if (candidate.id && existing.id === candidate.id) {
      continue;
    }

    if (
      businessKey &&
      buildDealExactBusinessKey({
        name: existing.name,
        stageId: existing.stageId,
        contactId: existing.contactId,
      }) === businessKey
    ) {
      matchesByBusinessKey.push(existing);
    }

    if (
      buildDealNameContactKey(existing.name, existing.contactId) === nameContactKey
    ) {
      matchesByNameContact.push(existing);
    }
  }

  const allMatchedIds = new Set<string>();
  const candidateMatches: Array<{ id: string; matchedKey: string }> = [];

  for (const m of matchesByBusinessKey) {
    allMatchedIds.add(m.id);
    candidateMatches.push({
      id: m.id,
      matchedKey: `deal_business:${businessKey}`,
    });
  }

  for (const m of matchesByNameContact) {
    allMatchedIds.add(m.id);
    candidateMatches.push({
      id: m.id,
      matchedKey: `deal_name_contact:${nameContactKey}`,
    });
  }

  if (allMatchedIds.size === 0) {
    return {
      outcome: 'NO_MATCH',
      matchingKeys: [],
      candidateMatches: [],
      requiresHumanReview: false,
      reason: 'No exact duplicate deal matches found',
    };
  }

  if (allMatchedIds.size > 1) {
    const keys = Array.from(new Set(candidateMatches.map((c) => c.matchedKey)));
    return {
      outcome: 'AMBIGUOUS_REVIEW_REQUIRED',
      matchingKeys: keys,
      candidateMatches,
      requiresHumanReview: true,
      reason: `Ambiguous match: candidate matches ${allMatchedIds.size} different deal records. Human review required.`,
    };
  }

  const singleMatch = matchesByBusinessKey[0] ?? matchesByNameContact[0]!;
  const matchedKeys: string[] = [];
  if (matchesByBusinessKey.length > 0 && businessKey) {
    matchedKeys.push(`deal_business:${businessKey}`);
  }
  if (matchesByNameContact.length > 0) {
    matchedKeys.push(`deal_name_contact:${nameContactKey}`);
  }

  return {
    outcome: 'EXACT_MATCH',
    matchedId: singleMatch.id,
    matchingKeys: matchedKeys,
    candidateMatches,
    requiresHumanReview: false,
    reason: `Deterministic exact match on [${matchedKeys.join(', ')}]`,
  };
}

/**
 * Evaluates a Quote duplicate candidate deterministically against a pool of existing quotes.
 * Invariant: Quote numbers are globally unique in CRM-2.
 */
export function evaluateQuoteDuplicate(
  candidate: QuoteCandidate,
  pool: readonly ExistingQuoteRecord[]
): QuoteDuplicateEvaluationResult {
  const normQuoteNumber = buildQuoteExactKey(candidate.quoteNumber);
  if (!normQuoteNumber) {
    return {
      outcome: 'NO_MATCH',
      matchingKeys: [],
      candidateMatches: [],
      requiresHumanReview: false,
      reason: 'Empty quote number; cannot match',
    };
  }

  const matches: ExistingQuoteRecord[] = [];
  for (const existing of pool) {
    if (candidate.id && existing.id === candidate.id) {
      continue;
    }
    if (buildQuoteExactKey(existing.quoteNumber) === normQuoteNumber) {
      matches.push(existing);
    }
  }

  if (matches.length === 0) {
    return {
      outcome: 'NO_MATCH',
      matchingKeys: [],
      candidateMatches: [],
      requiresHumanReview: false,
      reason: 'No exact quote number match found',
    };
  }

  const candidateMatches = matches.map((m) => ({
    id: m.id,
    matchedKey: `quote_number:${normQuoteNumber}`,
  }));

  if (matches.length > 1) {
    return {
      outcome: 'AMBIGUOUS_REVIEW_REQUIRED',
      matchingKeys: [`quote_number:${normQuoteNumber}`],
      candidateMatches,
      requiresHumanReview: true,
      reason: `Ambiguous match: quote number matches ${matches.length} different records. Human review required.`,
    };
  }

  const singleMatch = matches[0]!;
  return {
    outcome: 'EXACT_MATCH',
    matchedId: singleMatch.id,
    matchingKeys: [`quote_number:${normQuoteNumber}`],
    candidateMatches,
    requiresHumanReview: false,
    reason: `Deterministic exact match on quote_number [${normQuoteNumber}]`,
  };
}

// ---------------------------------------------------------------------------
// 4. API Schemas & DTOs for Duplicates & Human Review
// ---------------------------------------------------------------------------

export const Crm2RecordWithKeySchema = z.object({
  id: z.string().min(1),
  keyValue: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
});
export type Crm2RecordWithKey = z.infer<typeof Crm2RecordWithKeySchema>;

export const Crm2DetectDuplicatesInputSchema = z.object({
  batchId: z.string().max(128).optional(),
  entity: z.enum(['deal', 'quote', 'quote_line']).default('deal'),
  keyType: Crm2ExactKeyTypeSchema,
  autoMerge: z.boolean().optional(),
  records: z.array(Crm2RecordWithKeySchema).min(1, 'records array must contain at least 1 record'),
});
export type Crm2DetectDuplicatesInput = z.infer<typeof Crm2DetectDuplicatesInputSchema>;

export const Crm2DuplicateCandidateSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().optional(),
  module: z.literal('crm-2').default('crm-2'),
  entity: z.string().default('deal'),
  keyType: Crm2ExactKeyTypeSchema,
  normalizedKey: z.string().min(1),
  recordIds: z.array(z.string()).min(2),
  status: DuplicateCandidateStatusSchema,
  detectedAt: z.coerce.date(),
  metadata: z.record(z.unknown()).optional(),
});
export type Crm2DuplicateCandidate = z.infer<typeof Crm2DuplicateCandidateSchema>;

export const Crm2ResolveDuplicateInputSchema = z
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
export type Crm2ResolveDuplicateInput = z.infer<typeof Crm2ResolveDuplicateInputSchema>;

export const Crm2DuplicateAuditLogEntrySchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),
  decision: DuplicateReviewDecisionSchema,
  actorId: z.string().min(1),
  timestamp: z.coerce.date(),
  keptId: z.string().min(1),
  mergedId: z.string().min(1),
  reason: z.string().min(1),
  keyType: Crm2ExactKeyTypeSchema,
  normalizedKey: z.string().min(1),
  entity: z.string().default('deal'),
  metadata: z.record(z.unknown()).optional(),
});
export type Crm2DuplicateAuditLogEntry = z.infer<typeof Crm2DuplicateAuditLogEntrySchema>;

export const Crm2EvaluateDealDuplicateInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, 'Deal name is required'),
  stageId: z.string().optional(),
  stageName: z.string().optional(),
  contactId: z.string().nullable().optional(),
  value: z.union([z.string(), z.number()]).optional(),
  currency: z.string().optional(),
});
export type Crm2EvaluateDealDuplicateInput = z.infer<typeof Crm2EvaluateDealDuplicateInputSchema>;

export const Crm2EvaluateQuoteDuplicateInputSchema = z.object({
  id: z.string().uuid().optional(),
  quoteNumber: z.string().min(1, 'Quote number is required'),
  dealId: z.string().optional(),
  amount: z.union([z.string(), z.number()]).optional(),
  currency: z.string().optional(),
});
export type Crm2EvaluateQuoteDuplicateInput = z.infer<typeof Crm2EvaluateQuoteDuplicateInputSchema>;
