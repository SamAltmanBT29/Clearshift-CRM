import {
  normalizeEmail,
  normalizePhone,
  normalizeName,
  normalizeTaxNumber,
} from '@cs/core';
import type { ExactMatchEvaluation } from './types.js';

export const MATCHING_RULE_VERSION = '1.0.0';

/**
 * Builds normalized exact email key.
 */
export function buildNormalizedEmailKey(email: string | null | undefined): string | null {
  if (!email || !email.trim()) return null;
  return normalizeEmail(email);
}

/**
 * Builds normalized exact phone + name key.
 */
export function buildNormalizedPhoneNameKey(
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
 * Builds normalized exact tax number key within entity/jurisdiction scope.
 */
export function buildNormalizedTaxKey(
  taxNumber: string | null | undefined,
  jurisdiction?: string | null | undefined
): string | null {
  if (!taxNumber || !taxNumber.trim()) return null;
  const normTax = normalizeTaxNumber(taxNumber);
  if (!normTax) return null;
  const jur = jurisdiction && jurisdiction.trim() ? jurisdiction.trim().toUpperCase() : 'DEFAULT';
  return `${normTax}@${jur}`;
}

/**
 * Evaluates whether a source record matches a target record under V1 exact normalized rules.
 *
 * Rules:
 * 1. Exact normalized email (contacts / leads)
 * 2. Exact normalized phone + name (contacts / leads)
 * 3. Exact normalized tax number within jurisdiction scope (companies)
 *
 * Invariant: Shared company name alone NEVER constitutes a duplicate match!
 * Invariant: Fuzzy matching is prohibited.
 */
export function evaluateExactMatch(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  entity: string
): ExactMatchEvaluation {
  const normalizedEntity = entity.toLowerCase();

  // 1. Company Matching: STRICTLY by normalized tax number in jurisdiction scope
  if (normalizedEntity === 'company' || normalizedEntity === 'companies') {
    const sourceTax = String(source['tax_number'] ?? source['taxNumber'] ?? source['vatNumber'] ?? '');
    const targetTax = String(target['tax_number'] ?? target['taxNumber'] ?? target['vatNumber'] ?? '');
    const sourceJur = String(source['jurisdiction'] ?? source['country'] ?? '');
    const targetJur = String(target['jurisdiction'] ?? target['country'] ?? '');

    const sourceTaxKey = buildNormalizedTaxKey(sourceTax, sourceJur);
    const targetTaxKey = buildNormalizedTaxKey(targetTax, targetJur);

    if (sourceTaxKey && targetTaxKey && sourceTaxKey === targetTaxKey) {
      return {
        isMatch: true,
        matchingRule: 'exact_tax_number',
        matchingRuleVersion: MATCHING_RULE_VERSION,
        evidence: `Normalized tax key '${sourceTaxKey}' matches target`,
        reason: 'Exact normalized tax number match within jurisdiction scope',
      };
    }

    // Crucial Invariant: Shared company name alone does NOT match
    return {
      isMatch: false,
      matchingRuleVersion: MATCHING_RULE_VERSION,
      reason: 'COMPANY_NAME_ONLY_MATCH_KEPT_SEPARATE',
    };
  }

  // 2. Contact / Lead Matching: Exact normalized email OR (exact normalized phone + name)
  const sourceEmail = String(source['email'] ?? '');
  const targetEmail = String(target['email'] ?? '');
  const sourceEmailKey = buildNormalizedEmailKey(sourceEmail);
  const targetEmailKey = buildNormalizedEmailKey(targetEmail);

  if (sourceEmailKey && targetEmailKey && sourceEmailKey === targetEmailKey) {
    return {
      isMatch: true,
      matchingRule: 'exact_email',
      matchingRuleVersion: MATCHING_RULE_VERSION,
      evidence: `Normalized email '${sourceEmailKey}' matches target`,
      reason: 'Exact normalized email match',
    };
  }

  const sourcePhone = String(source['phone'] ?? source['phoneNumber'] ?? '');
  const targetPhone = String(target['phone'] ?? target['phoneNumber'] ?? '');
  const sourceFirst = String(source['first_name'] ?? source['firstName'] ?? '');
  const targetFirst = String(target['first_name'] ?? target['firstName'] ?? '');
  const sourceLast = String(source['last_name'] ?? source['lastName'] ?? '');
  const targetLast = String(target['last_name'] ?? target['lastName'] ?? '');

  const sourcePhoneNameKey = buildNormalizedPhoneNameKey(sourcePhone, sourceFirst, sourceLast);
  const targetPhoneNameKey = buildNormalizedPhoneNameKey(targetPhone, targetFirst, targetLast);

  if (sourcePhoneNameKey && targetPhoneNameKey && sourcePhoneNameKey === targetPhoneNameKey) {
    return {
      isMatch: true,
      matchingRule: 'exact_phone_name',
      matchingRuleVersion: MATCHING_RULE_VERSION,
      evidence: `Normalized phone + name '${sourcePhoneNameKey}' matches target`,
      reason: 'Exact normalized phone and name combination match',
    };
  }

  return {
    isMatch: false,
    matchingRuleVersion: MATCHING_RULE_VERSION,
    reason: 'No exact normalized rule match found',
  };
}
