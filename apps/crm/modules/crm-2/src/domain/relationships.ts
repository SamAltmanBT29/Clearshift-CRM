import {
  CRM2_STAGES,
  type Crm2StageName,
  CRM2_DEAL_STAGE_TRANSITIONS,
  CRM2_STAGE_SEEDS,
  isDealStageTransitionAllowed,
  assertValidStageName,
  type Deal,
  type Quote,
  type Stage,
  type StageSeed,
} from '@clearshift/contracts';
import type { ReferenceResolver } from '@cs/kernel';
import {
  InvalidStageTransitionError,
  ReferenceNotFoundError,
  DuplicateRecordError,
  DomainValidationError,
} from './errors.js';

export {
  CRM2_STAGES,
  type Crm2StageName,
  CRM2_DEAL_STAGE_TRANSITIONS,
  CRM2_STAGE_SEEDS,
  isDealStageTransitionAllowed,
  assertValidStageName,
  type Stage,
  type StageSeed,
};

/**
 * Asserts that a deal stage transition is valid, throwing an InvalidStageTransitionError (422) if forbidden.
 */
export function assertDealStageTransition(
  current: Crm2StageName,
  next: Crm2StageName,
  field = 'stage_name'
): void {
  if (!isDealStageTransitionAllowed(current, next)) {
    throw new InvalidStageTransitionError(current, next, [
      {
        field,
        message: 'Move the deal to an allowed pipeline stage',
        code: 'invalid_transition',
      },
    ]);
  }
}

/**
 * Checks if a pipeline stage is terminal (cannot transition further).
 */
export function isTerminalStage(stage: Crm2StageName): boolean {
  return CRM2_DEAL_STAGE_TRANSITIONS[stage].length === 0;
}

/**
 * Checks if a stage represents Closed Won.
 */
export function isWonStage(stage: Crm2StageName): boolean {
  return stage === 'Won';
}

/**
 * Checks if a stage represents Closed Lost.
 */
export function isLostStage(stage: Crm2StageName): boolean {
  return stage === 'Lost';
}

/**
 * Gets the list of valid next stages from the current stage.
 */
export function getAllowedNextStages(stage: Crm2StageName): readonly Crm2StageName[] {
  return CRM2_DEAL_STAGE_TRANSITIONS[stage] ?? [];
}

/**
 * Gets the canonical 1-based ordering position (1 to 6) for a stage.
 */
export function getStageOrder(stage: Crm2StageName): number {
  const seed = CRM2_STAGE_SEEDS.find((s) => s.name === stage);
  return seed ? seed.order : 0;
}

/**
 * Validates whether a contact reference is valid per SDS C7 / Section 4.1.
 * contact_id is nullable (orphan deals are permitted and flagged).
 * If contact_id is provided, validates that the contact exists in CRM-1.
 * Throws ReferenceNotFoundError (422) if invalid.
 */
export async function assertValidContactReference(
  contactId: string | null | undefined,
  resolver?: ReferenceResolver
): Promise<void> {
  if (contactId == null || contactId.trim() === '') {
    // Nullable contact is allowed; represents an orphan deal
    return;
  }

  if (resolver) {
    const exists = await resolver.exists('contact', contactId.trim());
    if (!exists) {
      throw new ReferenceNotFoundError('contact', contactId.trim(), 'contact_id');
    }
  }
}

/**
 * Validates that a referenced deal exists before committing quotes or operations.
 * Throws ReferenceNotFoundError (422) if deal is not found.
 */
export async function assertValidDealReference(
  dealId: string,
  dealExistsFn: (id: string) => Promise<boolean> | boolean
): Promise<void> {
  if (!dealId || dealId.trim() === '') {
    throw new DomainValidationError('Deal reference (deal_id) is required', [
      { field: 'deal_id', message: 'Deal reference is required', code: 'required' },
    ]);
  }

  const exists = await dealExistsFn(dealId.trim());
  if (!exists) {
    throw new ReferenceNotFoundError('deal', dealId.trim(), 'deal_id');
  }
}

/**
 * Validates quote number uniqueness before commit.
 * Throws DuplicateRecordError (409) if duplicate.
 */
export async function assertValidQuoteNumber(
  quoteNumber: string,
  isDuplicateFn: (num: string) => Promise<boolean> | boolean
): Promise<void> {
  const trimmed = quoteNumber?.trim();
  if (!trimmed) {
    throw new DomainValidationError('Quote number cannot be blank', [
      { field: 'quote_number', message: 'Quote number is required', code: 'non_empty' },
    ]);
  }

  const isDuplicate = await isDuplicateFn(trimmed);
  if (isDuplicate) {
    throw new DuplicateRecordError('Quote', 'quote_number', trimmed);
  }
}

/**
 * Determines whether a deal is an orphan deal (has no contact link).
 */
export function isOrphanDeal(deal: { contact_id?: string | null | undefined }): boolean {
  return deal.contact_id === null || deal.contact_id === undefined || deal.contact_id.trim() === '';
}

/**
 * Returns the approved warning message for orphan deals per FR-CRM2-05.
 * Never silently hides an orphan deal.
 */
export function getOrphanDealWarning(deal: { contact_id?: string | null | undefined }): string | null {
  if (isOrphanDeal(deal)) {
    return 'Warning: Deal has no linked contact (orphan deal)';
  }
  return null;
}

/**
 * Helper to sum decimal strings with exact two decimal places.
 */
function sumDecimalStrings(values: string[]): string {
  let totalCents = 0n;
  for (const v of values) {
    const trimmed = v.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('.');
    const whole = BigInt(parts[0] || '0');
    const frac = (parts[1] || '').padEnd(2, '0').slice(0, 2);
    const cents = whole * 100n + BigInt(frac);
    totalCents += cents;
  }
  const isNeg = totalCents < 0n;
  const absCents = isNeg ? -totalCents : totalCents;
  const wholePart = absCents / 100n;
  const fracPart = (absCents % 100n).toString().padStart(2, '0');
  return `${isNeg ? '-' : ''}${wholePart}.${fracPart}`;
}

export interface DealDerivedTotals {
  dealId: string;
  dealName: string;
  dealValue: string;
  dealCurrency: string;
  isOrphan: boolean;
  stageName: Crm2StageName;
  isWon: boolean;
  isLost: boolean;
  quotesCount: number;
  totalQuotesAmount: string;
  hasQuotes: boolean;
}

/**
 * Computes derived display values and totals for a deal and its linked quotes.
 * Computed from authoritative persisted state.
 */
export function calculateDealDerivedTotals(deal: Deal, quotes: Quote[]): DealDerivedTotals {
  const linkedQuotes = quotes.filter((q) => q.deal_id === deal.id);
  const totalQuotesAmount = sumDecimalStrings(linkedQuotes.map((q) => q.amount));

  return {
    dealId: deal.id,
    dealName: deal.name,
    dealValue: deal.value,
    dealCurrency: deal.currency,
    isOrphan: isOrphanDeal(deal),
    stageName: deal.stage_name,
    isWon: isWonStage(deal.stage_name),
    isLost: isLostStage(deal.stage_name),
    quotesCount: linkedQuotes.length,
    totalQuotesAmount,
    hasQuotes: linkedQuotes.length > 0,
  };
}

export interface StagePipelineSummary {
  count: number;
  totalValue: string;
}

export interface PipelineSummary {
  totalDeals: number;
  totalPipelineValue: string;
  orphanDealsCount: number;
  activeDealsCount: number;
  activePipelineValue: string;
  wonDealsCount: number;
  wonDealsValue: string;
  lostDealsCount: number;
  lostDealsValue: string;
  byStage: Record<Crm2StageName, StagePipelineSummary>;
}

/**
 * Computes aggregated pipeline report totals from authoritative deals list.
 */
export function calculatePipelineSummary(deals: Deal[]): PipelineSummary {
  const byStage: Record<Crm2StageName, StagePipelineSummary> = {
    New: { count: 0, totalValue: '0.00' },
    Qualified: { count: 0, totalValue: '0.00' },
    Proposal: { count: 0, totalValue: '0.00' },
    Negotiation: { count: 0, totalValue: '0.00' },
    Won: { count: 0, totalValue: '0.00' },
    Lost: { count: 0, totalValue: '0.00' },
  };

  const valuesByStage: Record<Crm2StageName, string[]> = {
    New: [],
    Qualified: [],
    Proposal: [],
    Negotiation: [],
    Won: [],
    Lost: [],
  };

  let orphanCount = 0;
  const allValues: string[] = [];
  const activeValues: string[] = [];
  let activeCount = 0;

  for (const deal of deals) {
    if (isOrphanDeal(deal)) {
      orphanCount++;
    }
    allValues.push(deal.value);

    const stage = deal.stage_name;
    if (valuesByStage[stage]) {
      valuesByStage[stage].push(deal.value);
    }

    if (stage !== 'Won' && stage !== 'Lost') {
      activeCount++;
      activeValues.push(deal.value);
    }
  }

  for (const stage of CRM2_STAGES) {
    byStage[stage] = {
      count: valuesByStage[stage].length,
      totalValue: sumDecimalStrings(valuesByStage[stage]),
    };
  }

  return {
    totalDeals: deals.length,
    totalPipelineValue: sumDecimalStrings(allValues),
    orphanDealsCount: orphanCount,
    activeDealsCount: activeCount,
    activePipelineValue: sumDecimalStrings(activeValues),
    wonDealsCount: byStage.Won.count,
    wonDealsValue: byStage.Won.totalValue,
    lostDealsCount: byStage.Lost.count,
    lostDealsValue: byStage.Lost.totalValue,
    byStage,
  };
}

/**
 * Protected system fields that must never be accepted as authoritative from browser/user edits.
 * "For user edits, never accept protected/system-maintained fields as authoritative from the browser."
 */
export const PROTECTED_DEAL_FIELDS = ['id', 'created_at', 'updated_at', 'is_orphan', 'stage_id'] as const;
export const PROTECTED_QUOTE_FIELDS = ['id', 'created_at', 'updated_at', 'deal_id'] as const;

export function sanitizeDealUserEdit<T extends Record<string, unknown>>(input: T): Omit<T, typeof PROTECTED_DEAL_FIELDS[number]> {
  const sanitized = { ...input };
  for (const field of PROTECTED_DEAL_FIELDS) {
    delete sanitized[field];
  }
  return sanitized;
}

export function sanitizeQuoteUserEdit<T extends Record<string, unknown>>(input: T): Omit<T, typeof PROTECTED_QUOTE_FIELDS[number]> {
  const sanitized = { ...input };
  for (const field of PROTECTED_QUOTE_FIELDS) {
    delete sanitized[field];
  }
  return sanitized;
}

