import {
  normalizeEmail,
  normalizePhone,
  normalizeTaxNumber,
  normalizeName,
  normalizeSku,
} from '@cs/core';
import {
  EntityType,
  IdentityEvidence,
  IdentityReviewCandidate,
  GoldenRecord,
  SourceIdentityMapRecord,
} from '@clearshift/contracts';

export interface EvidenceKeys {
  normalizedEmail?: string;
  normalizedPhone?: string;
  normalizedTaxNumber?: string;
  normalizedName?: string;
  normalizedSku?: string;
}

/**
 * Normalizes evidence using shared per-key deterministic normalizers.
 */
export function normalizeEvidence(evidence?: IdentityEvidence): EvidenceKeys {
  if (!evidence) return {};
  const result: EvidenceKeys = {};

  if (evidence.email && evidence.email.trim()) {
    result.normalizedEmail = normalizeEmail(evidence.email);
  }
  if (evidence.phone && evidence.phone.trim()) {
    result.normalizedPhone = normalizePhone(evidence.phone);
  }
  if (evidence.taxNumber && evidence.taxNumber.trim()) {
    result.normalizedTaxNumber = normalizeTaxNumber(evidence.taxNumber);
  }
  if (evidence.name && evidence.name.trim()) {
    result.normalizedName = normalizeName(evidence.name);
  }
  if (evidence.sku && evidence.sku.trim()) {
    result.normalizedSku = normalizeSku(evidence.sku);
  }

  return result;
}

export interface ConflictEvaluation {
  hasConflict: boolean;
  reviewCandidate?: IdentityReviewCandidate;
}

/**
 * Evaluates candidate identity evidence against existing matched records for the entity type.
 * Invariants (Non-Negotiable):
 * - Conflicting tax/email/phone evidence opens review and does not auto-merge.
 * - Exact matches produce review candidates where destructive merge is possible; zero fuzzy auto-merge.
 */
export function evaluateEvidenceConflict(params: {
  entityType: EntityType;
  sourceSystem: string;
  sourceId: string;
  candidateEvidence?: IdentityEvidence;
  matches: Array<{ record: GoldenRecord; mapping?: SourceIdentityMapRecord; matchedKey: string }>;
}): ConflictEvaluation {
  const { entityType, candidateEvidence, matches } = params;

  if (!matches || matches.length === 0 || !candidateEvidence) {
    return { hasConflict: false };
  }

  const normCandidate = normalizeEvidence(candidateEvidence);

  // 1. Multiple distinct Golden Records match -> Ambiguous match conflict
  const distinctGoldenIds = Array.from(new Set(matches.map((m) => m.record.id)));
  if (distinctGoldenIds.length > 1) {
    const firstMatch = matches[0]!;
    return {
      hasConflict: true,
      reviewCandidate: {
        conflictType: 'ambiguous_match',
        conflictingGoldenRecordId: firstMatch.record.id,
        conflictingDisplayGid: firstMatch.record.displayGid,
        matchedKey: matches.map((m) => m.matchedKey).join(', '),
        reason: `Ambiguous match: evidence matches ${distinctGoldenIds.length} distinct Golden Records. Manual review required; auto-merge prohibited.`,
        candidateEvidence,
        openedAt: new Date().toISOString(),
      },
    };
  }

  // 2. Single Golden Record matched by evidence, but has conflicting secondary evidence
  const matched = matches[0]!;
  const existingMapping = matched.mapping;
  const existingEvidence = existingMapping?.metadata?.['evidence'] as IdentityEvidence | undefined;
  const normExisting = normalizeEvidence(existingEvidence);

  // Check Tax Number Conflict
  if (
    normCandidate.normalizedTaxNumber &&
    normExisting.normalizedTaxNumber &&
    normCandidate.normalizedTaxNumber !== normExisting.normalizedTaxNumber
  ) {
    return {
      hasConflict: true,
      reviewCandidate: {
        conflictType: 'tax_conflict',
        conflictingGoldenRecordId: matched.record.id,
        conflictingDisplayGid: matched.record.displayGid,
        matchedKey: `taxNumber:${normCandidate.normalizedTaxNumber} != ${normExisting.normalizedTaxNumber}`,
        reason: `Conflicting tax number detected for existing Golden Record (${matched.record.displayGid}). Manual review required.`,
        candidateEvidence,
        existingEvidence,
        openedAt: new Date().toISOString(),
      },
    };
  }

  // Check Email Conflict
  if (
    normCandidate.normalizedEmail &&
    normExisting.normalizedEmail &&
    normCandidate.normalizedEmail !== normExisting.normalizedEmail
  ) {
    return {
      hasConflict: true,
      reviewCandidate: {
        conflictType: 'email_conflict',
        conflictingGoldenRecordId: matched.record.id,
        conflictingDisplayGid: matched.record.displayGid,
        matchedKey: `email:${normCandidate.normalizedEmail} != ${normExisting.normalizedEmail}`,
        reason: `Conflicting email detected for existing Golden Record (${matched.record.displayGid}). Manual review required.`,
        candidateEvidence,
        existingEvidence,
        openedAt: new Date().toISOString(),
      },
    };
  }

  // Check Phone Conflict
  if (
    normCandidate.normalizedPhone &&
    normExisting.normalizedPhone &&
    normCandidate.normalizedPhone !== normExisting.normalizedPhone
  ) {
    return {
      hasConflict: true,
      reviewCandidate: {
        conflictType: 'phone_conflict',
        conflictingGoldenRecordId: matched.record.id,
        conflictingDisplayGid: matched.record.displayGid,
        matchedKey: `phone:${normCandidate.normalizedPhone} != ${normExisting.normalizedPhone}`,
        reason: `Conflicting phone number detected for existing Golden Record (${matched.record.displayGid}). Manual review required.`,
        candidateEvidence,
        existingEvidence,
        openedAt: new Date().toISOString(),
      },
    };
  }

  // Cross-system match candidate: same tax/email across systems, but destructive merge requires explicit human path
  return { hasConflict: false };
}
