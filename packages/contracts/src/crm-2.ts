import { z } from 'zod';

/**
 * CRM-2 Deals, Pipeline and Quotes Contract Baseline
 * SDS ClearShift CRM v2.0, V1: FR-CRM2-01..05
 */

export const CRM2_API_PREFIX = '/api/v1/crm-deals';

// Domain Invariant: Stage set is exactly New, Qualified, Proposal, Negotiation, Won, Lost
export const CRM2_STAGES = [
  'New',
  'Qualified',
  'Proposal',
  'Negotiation',
  'Won',
  'Lost',
] as const;

export type Crm2StageName = (typeof CRM2_STAGES)[number];

export const Crm2StageNameSchema = z.enum(CRM2_STAGES);

/**
 * Validates whether a given string is an approved CRM-2 stage name.
 * Throws an Error if the stage is not in the fixed set.
 */
export function assertValidStageName(stage: string): asserts stage is Crm2StageName {
  const result = Crm2StageNameSchema.safeParse(stage);
  if (!result.success) {
    throw new Error(
      `Domain Invariant Violation: Stage '${stage}' is not permitted. Stage set is exactly: ${CRM2_STAGES.join(', ')}`
    );
  }
}

/**
 * Deal Stage Transition Matrix (FR-CRM2-03 & CRM2-06)
 * Forward-only pipeline lifecycle with immediate Lost transitions.
 * Terminal stages ('Won', 'Lost') cannot transition to any other stage.
 */
export const CRM2_DEAL_STAGE_TRANSITIONS: Readonly<
  Record<Crm2StageName, readonly Crm2StageName[]>
> = {
  New: ['Qualified', 'Lost'],
  Qualified: ['Proposal', 'Lost'],
  Proposal: ['Negotiation', 'Lost'],
  Negotiation: ['Won', 'Lost'],
  Won: [],
  Lost: [],
};

/**
 * Checks whether a transition between two deal stages is permitted.
 * Idempotent updates (current === next) are permitted.
 */
export function isDealStageTransitionAllowed(
  current: Crm2StageName,
  next: Crm2StageName
): boolean {
  if (current === next) {
    return true;
  }
  const allowed = CRM2_DEAL_STAGE_TRANSITIONS[current];
  return allowed ? allowed.includes(next) : false;
}

/**
 * Asserts that a deal stage transition is valid, throwing an AppError (422) if forbidden.
 */
export function assertDealStageTransition(
  current: Crm2StageName,
  next: Crm2StageName,
  field = 'stage_name'
): void {
  if (!isDealStageTransitionAllowed(current, next)) {
    const error = new Error(
      `Deal stage cannot transition from ${current} to ${next}`
    ) as Error & { code: string; statusCode: number; details: unknown };
    error.name = 'AppError';
    error.code = 'INVALID_DEAL_STAGE_TRANSITION';
    error.statusCode = 422;
    error.details = [
      {
        field,
        message: 'Move the deal to an allowed pipeline stage',
        code: 'invalid_transition',
      },
    ];
    throw error;
  }
}

/**
 * Canonical Seeded Stage Records (crm2.crm2_stages)
 */
export interface StageSeed {
  id: string;
  name: Crm2StageName;
  order: number;
  is_closed_won: boolean;
  is_closed_lost: boolean;
}

export const CRM2_STAGE_SEEDS: readonly StageSeed[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'New',
    order: 1,
    is_closed_won: false,
    is_closed_lost: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Qualified',
    order: 2,
    is_closed_won: false,
    is_closed_lost: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Proposal',
    order: 3,
    is_closed_won: false,
    is_closed_lost: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    name: 'Negotiation',
    order: 4,
    is_closed_won: false,
    is_closed_lost: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    name: 'Won',
    order: 5,
    is_closed_won: true,
    is_closed_lost: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000006',
    name: 'Lost',
    order: 6,
    is_closed_won: false,
    is_closed_lost: true,
  },
] as const;

/**
 * ISO 4217 Currency Code pattern (3 uppercase letters)
 */
export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, {
  message: 'Currency must be an explicit 3-letter uppercase ISO code (e.g. USD, EUR, GBP)',
});

/**
 * Decimal string validation (ensures explicit decimal number, e.g. "15000.00" or "0.50")
 */
export const DecimalStringSchema = z.string().regex(/^\d+(\.\d{1,4})?$/, {
  message: 'Value must be a valid non-negative decimal string',
});

// Stage Schema
export const StageSchema = z.object({
  id: z.string().uuid(),
  name: Crm2StageNameSchema,
  order: z.number().int().min(1).max(6),
  is_closed_won: z.boolean(),
  is_closed_lost: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Stage = z.infer<typeof StageSchema>;

// Deal Schema
export const DealSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'Deal name is required').max(255),
  contact_id: z.string().uuid().nullable(),
  contact_name: z.string().nullable().optional(),
  value: DecimalStringSchema,
  currency: CurrencyCodeSchema,
  stage_id: z.string().uuid(),
  stage_name: Crm2StageNameSchema,
  close_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Close date must be in YYYY-MM-DD format',
  }),
  is_orphan: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Deal = z.infer<typeof DealSchema>;

// Create Deal Input Schema
export const CreateDealInputSchema = z.object({
  name: z.string().min(1, 'Deal name is required').max(255),
  contact_id: z.string().uuid().nullable().optional(),
  value: DecimalStringSchema,
  currency: CurrencyCodeSchema.default('USD'),
  stage_name: Crm2StageNameSchema.default('New'),
  close_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CreateDealInput = z.infer<typeof CreateDealInputSchema>;

// Update Deal Input Schema
export const UpdateDealInputSchema = CreateDealInputSchema.partial();
export type UpdateDealInput = z.infer<typeof UpdateDealInputSchema>;

// Quote Schema
export const QuoteSchema = z.object({
  id: z.string().uuid(),
  deal_id: z.string().uuid(),
  deal_name: z.string().optional(),
  quote_number: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: DecimalStringSchema,
  currency: CurrencyCodeSchema,
  note: z.string().nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Quote = z.infer<typeof QuoteSchema>;

// Create Quote Input Schema
export const CreateQuoteInputSchema = z.object({
  deal_id: z.string().uuid(),
  quote_number: z.string().min(1, 'Quote number is required'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: DecimalStringSchema,
  currency: CurrencyCodeSchema.default('USD'),
  note: z.string().nullable().optional(),
});
export type CreateQuoteInput = z.infer<typeof CreateQuoteInputSchema>;

// Update Quote Input Schema
export const UpdateQuoteInputSchema = CreateQuoteInputSchema.partial();
export type UpdateQuoteInput = z.infer<typeof UpdateQuoteInputSchema>;

// Deals Query Filter Schema
export const DealsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().optional(),
  stage: Crm2StageNameSchema.optional(),
});
export type DealsQuery = z.infer<typeof DealsQuerySchema>;
export type DealsQueryInput = z.input<typeof DealsQuerySchema>;

// CRM-2 Pagination Metadata Schema
export const Crm2PaginationMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  totalCount: z.number().int(),
  totalPages: z.number().int(),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
});
export type Crm2PaginationMeta = z.infer<typeof Crm2PaginationMetaSchema>;

// Deals List Response Schema
export const DealsListResponseSchema = z.object({
  items: z.array(DealSchema),
  pagination: Crm2PaginationMetaSchema,
});
export type DealsListResponse = z.infer<typeof DealsListResponseSchema>;

// Stages List Response Schema
export const StagesListResponseSchema = z.object({
  items: z.array(StageSchema),
});
export type StagesListResponse = z.infer<typeof StagesListResponseSchema>;

// Quotes Query Filter Schema
export const QuotesQuerySchema = z.object({
  deal_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});
export type QuotesQuery = z.infer<typeof QuotesQuerySchema>;
export type QuotesQueryInput = z.input<typeof QuotesQuerySchema>;

// Quotes List Response Schema
export const QuotesListResponseSchema = z.object({
  items: z.array(QuoteSchema),
  pagination: Crm2PaginationMetaSchema,
});
export type QuotesListResponse = z.infer<typeof QuotesListResponseSchema>;
