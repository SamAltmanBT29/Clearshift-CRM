import { z } from 'zod';
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
// 1. Exact Key Types and Normalizers for CRM-4
// ---------------------------------------------------------------------------

export const Crm4ExactKeyTypeSchema = z.enum([
  'list_source',
  'list_name',
  'campaign_composite',
  'member_composite',
  'consent_contact',
]);
export type Crm4ExactKeyType = z.infer<typeof Crm4ExactKeyTypeSchema>;

/**
 * Normalizes a marketing list source deduplication key:
 * ${trimmedLowerSourceSystem}#${trimmedLowerSourceId}
 * (BR-CRM4-DUP-01)
 */
export function buildListExactKey(sourceSystem: string, sourceId: string): string {
  return `${(sourceSystem || '').trim().toLowerCase()}#${(sourceId || '').trim().toLowerCase()}`;
}

/**
 * Normalizes a marketing list business deduplication key based on name:
 * Lowercased, trimmed, whitespace collapsed.
 */
export function buildListBusinessKey(name: string): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Normalizes a campaign composite deduplication key:
 * ${normalizedName}#${normalizedListId}#${trimmedCampaignDate}
 * (BR-CRM4-DUP-02)
 */
export function buildCampaignExactKey(
  name: string,
  listId: string,
  campaignDate: string
): string {
  const normName = (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const normList = (listId || '').trim().toLowerCase();
  const normDate = (campaignDate || '').trim();
  return `${normName}#${normList}#${normDate}`;
}

/**
 * Normalizes a campaign member uniqueness key:
 * ${normalizedCampaignId}#${normalizedContactId}
 * (BR-CRM4-DUP-03)
 */
export function buildMemberExactKey(campaignId: string, contactId: string): string {
  return `${(campaignId || '').trim().toLowerCase()}#${(contactId || '').trim().toLowerCase()}`;
}

/**
 * Normalizes contact consent exact key:
 * strictly contactId 1:1
 */
export function buildConsentExactKey(contactId: string): string {
  return (contactId || '').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// 2. Candidate & Record Interfaces for CRM-4 Entities
// ---------------------------------------------------------------------------

export interface ListCandidate {
  id?: string | null | undefined;
  name: string;
  sourceSystem?: string | null | undefined;
  sourceId?: string | null | undefined;
}

export interface ExistingListRecord {
  id: string;
  name: string;
  sourceSystem?: string | null | undefined;
  sourceId?: string | null | undefined;
}

export interface CampaignCandidate {
  id?: string | null | undefined;
  name: string;
  listId: string;
  campaignDate: string;
}

export interface ExistingCampaignRecord {
  id: string;
  name: string;
  listId: string;
  campaignDate: string;
}

export interface Crm4DuplicateEvaluationResult {
  outcome: DuplicateMatchOutcome;
  matchedId?: string | undefined;
  matchingKeys: string[];
  candidateMatches: Array<{ id: string; matchedKey: string }>;
  requiresHumanReview: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// 3. Deterministic Duplicate Evaluators (Zero Fuzzy Auto-Merge)
// ---------------------------------------------------------------------------

/**
 * Evaluates a Marketing List duplicate candidate deterministically.
 * Checks source key (sourceSystem + sourceId) and normalized name.
 * Ambiguous matches trigger human review.
 */
export function evaluateListDuplicate(
  candidate: ListCandidate,
  pool: readonly ExistingListRecord[]
): Crm4DuplicateEvaluationResult {
  const normName = buildListBusinessKey(candidate.name);
  if (!normName) {
    return {
      outcome: 'NO_MATCH',
      matchingKeys: [],
      candidateMatches: [],
      requiresHumanReview: false,
      reason: 'Empty candidate list name; cannot match',
    };
  }

  const sourceKey =
    candidate.sourceSystem && candidate.sourceId
      ? buildListExactKey(candidate.sourceSystem, candidate.sourceId)
      : null;

  const matchesBySourceKey: ExistingListRecord[] = [];
  const matchesByName: ExistingListRecord[] = [];

  for (const existing of pool) {
    if (candidate.id && existing.id === candidate.id) {
      continue;
    }

    if (
      sourceKey &&
      existing.sourceSystem &&
      existing.sourceId &&
      buildListExactKey(existing.sourceSystem, existing.sourceId) === sourceKey
    ) {
      matchesBySourceKey.push(existing);
    }

    if (buildListBusinessKey(existing.name) === normName) {
      matchesByName.push(existing);
    }
  }

  const allMatchedIds = new Set<string>([
    ...matchesBySourceKey.map((m) => m.id),
    ...matchesByName.map((m) => m.id),
  ]);

  if (allMatchedIds.size === 0) {
    return {
      outcome: 'NO_MATCH',
      matchingKeys: [],
      candidateMatches: [],
      requiresHumanReview: false,
      reason: 'No exact matches found',
    };
  }

  const candidateMatches: Array<{ id: string; matchedKey: string }> = [];
  matchesBySourceKey.forEach((m) => {
    candidateMatches.push({ id: m.id, matchedKey: `source_key:${sourceKey}` });
  });
  matchesByName.forEach((m) => {
    candidateMatches.push({ id: m.id, matchedKey: `list_name:${normName}` });
  });

  if (allMatchedIds.size > 1) {
    return {
      outcome: 'AMBIGUOUS_REVIEW_REQUIRED',
      matchingKeys: Array.from(new Set(candidateMatches.map((c) => c.matchedKey))),
      candidateMatches,
      requiresHumanReview: true,
      reason: `Ambiguous match: list matches ${allMatchedIds.size} different records. Human review required.`,
    };
  }

  const singleMatch = matchesBySourceKey[0] ?? matchesByName[0]!;
  const matchedKeys: string[] = [];
  if (matchesBySourceKey.length > 0) matchedKeys.push(`source_key:${sourceKey}`);
  if (matchesByName.length > 0) matchedKeys.push(`list_name:${normName}`);

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
 * Evaluates a Campaign duplicate candidate deterministically.
 * Matches normalized name + listId + campaignDate composite.
 */
export function evaluateCampaignDuplicate(
  candidate: CampaignCandidate,
  pool: readonly ExistingCampaignRecord[]
): Crm4DuplicateEvaluationResult {
  const compositeKey = buildCampaignExactKey(
    candidate.name,
    candidate.listId,
    candidate.campaignDate
  );

  const matches: ExistingCampaignRecord[] = [];
  for (const existing of pool) {
    if (candidate.id && existing.id === candidate.id) {
      continue;
    }
    if (
      buildCampaignExactKey(existing.name, existing.listId, existing.campaignDate) === compositeKey
    ) {
      matches.push(existing);
    }
  }

  if (matches.length === 0) {
    return {
      outcome: 'NO_MATCH',
      matchingKeys: [],
      candidateMatches: [],
      requiresHumanReview: false,
      reason: 'No exact campaign composite match found',
    };
  }

  const candidateMatches = matches.map((m) => ({
    id: m.id,
    matchedKey: `campaign_composite:${compositeKey}`,
  }));

  if (matches.length > 1) {
    return {
      outcome: 'AMBIGUOUS_REVIEW_REQUIRED',
      matchingKeys: [`campaign_composite:${compositeKey}`],
      candidateMatches,
      requiresHumanReview: true,
      reason: `Ambiguous match: campaign composite matches ${matches.length} different records. Human review required.`,
    };
  }

  const singleMatch = matches[0]!;
  return {
    outcome: 'EXACT_MATCH',
    matchedId: singleMatch.id,
    matchingKeys: [`campaign_composite:${compositeKey}`],
    candidateMatches,
    requiresHumanReview: false,
    reason: `Deterministic exact match on campaign composite [${compositeKey}]`,
  };
}

// ---------------------------------------------------------------------------
// 4. API Schemas & DTOs for Duplicates & Human Review
// ---------------------------------------------------------------------------

export const Crm4RecordWithKeySchema = z.object({
  id: z.string().min(1),
  keyValue: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
});
export type Crm4RecordWithKey = z.infer<typeof Crm4RecordWithKeySchema>;

export const Crm4DetectDuplicatesInputSchema = z.object({
  batchId: z.string().max(128).optional(),
  entity: z.enum(['list', 'campaign', 'member', 'consent']).default('list'),
  keyType: Crm4ExactKeyTypeSchema,
  autoMerge: z.boolean().optional(),
  records: z.array(Crm4RecordWithKeySchema).min(1, 'records array must contain at least 1 record'),
});
export type Crm4DetectDuplicatesInput = z.infer<typeof Crm4DetectDuplicatesInputSchema>;

export const Crm4DuplicateCandidateSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().optional(),
  module: z.literal('crm-4').default('crm-4'),
  entity: z.enum(['list', 'campaign', 'member', 'consent']).default('list'),
  keyType: Crm4ExactKeyTypeSchema,
  normalizedKey: z.string().min(1),
  recordIds: z.array(z.string()).min(2),
  status: DuplicateCandidateStatusSchema,
  detectedAt: z.coerce.date(),
  metadata: z.record(z.unknown()).optional(),
});
export type Crm4DuplicateCandidate = z.infer<typeof Crm4DuplicateCandidateSchema>;

export const Crm4ResolveDuplicateInputSchema = z
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
export type Crm4ResolveDuplicateInput = z.infer<typeof Crm4ResolveDuplicateInputSchema>;

export const Crm4DuplicateAuditLogEntrySchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),
  decision: DuplicateReviewDecisionSchema,
  actorId: z.string().min(1),
  timestamp: z.coerce.date(),
  keptId: z.string().min(1),
  mergedId: z.string().min(1),
  reason: z.string().min(1),
  keyType: Crm4ExactKeyTypeSchema,
  normalizedKey: z.string().min(1),
  entity: z.enum(['list', 'campaign', 'member', 'consent']).default('list'),
  metadata: z.record(z.unknown()).optional(),
});
export type Crm4DuplicateAuditLogEntry = z.infer<typeof Crm4DuplicateAuditLogEntrySchema>;
