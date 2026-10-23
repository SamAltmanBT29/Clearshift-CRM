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
export const DecimalStringSchema = z.string().regex(/^\d{1,12}(\.\d{1,4})?$/, {
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
  source_system: z.string().nullable().optional(),
  source_id: z.string().nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Deal = z.infer<typeof DealSchema>;

// Create Deal Input Schema
export const CreateDealInputSchema = z.object({
  name: z.string().trim().min(1, 'Deal name is required').max(255),
  contact_id: z.string().uuid('Invalid Contact UUID').nullable().optional(),
  value: DecimalStringSchema,
  currency: CurrencyCodeSchema.default('USD'),
  stage_name: Crm2StageNameSchema.default('New'),
  close_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Close date must be in YYYY-MM-DD format',
  }),
  source_system: z.string().max(64).nullable().optional(),
  source_id: z.string().max(128).nullable().optional(),
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
  quote_number: z.string().min(1, 'Quote number is required'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Quote date must be in YYYY-MM-DD format',
  }),
  amount: DecimalStringSchema,
  currency: CurrencyCodeSchema,
  note: z.string().nullable().optional(),
  source_system: z.string().nullable().optional(),
  source_id: z.string().nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Quote = z.infer<typeof QuoteSchema>;

// Create Quote Input Schema
export const CreateQuoteInputSchema = z.object({
  deal_id: z.string().uuid('Invalid Deal UUID'),
  quote_number: z.string().min(1, 'Quote number is required'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Quote date must be in YYYY-MM-DD format',
  }),
  amount: DecimalStringSchema,
  currency: CurrencyCodeSchema.default('USD'),
  note: z.string().nullable().optional(),
  source_system: z.string().max(64).nullable().optional(),
  source_id: z.string().max(128).nullable().optional(),
});
export type CreateQuoteInput = z.infer<typeof CreateQuoteInputSchema>;

// Update Quote Input Schema
export const UpdateQuoteInputSchema = CreateQuoteInputSchema.partial();
export type UpdateQuoteInput = z.infer<typeof UpdateQuoteInputSchema>;

// Quote Line Schema
export const QuoteLineSchema = z.object({
  id: z.string().uuid(),
  quote_id: z.string().uuid(),
  line_number: z.number().int().positive(),
  product_id: z.string().uuid().nullable().optional(),
  description: z.string().min(1, 'Description is required'),
  quantity: z.string().default('1.0000'),
  unit_price: DecimalStringSchema,
  line_total: DecimalStringSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type QuoteLine = z.infer<typeof QuoteLineSchema>;

// Create Quote Line Input Schema
export const CreateQuoteLineInputSchema = z.object({
  quote_id: z.string().uuid('Invalid Quote UUID'),
  line_number: z.number().int().positive('line_number must be > 0'),
  product_id: z.string().uuid().nullable().optional(),
  description: z.string().min(1, 'Description is required'),
  quantity: z.string().regex(/^\d+(\.\d{1,4})?$/).default('1.0000'),
  unit_price: DecimalStringSchema,
  line_total: DecimalStringSchema.optional(),
});
export type CreateQuoteLineInput = z.infer<typeof CreateQuoteLineInputSchema>;


/**
 * Standard Contract Labels, Helper Text and Error Messages for CRM-2
 * Guarantees field-level UX alignment between frontend forms and OpenAPI contract.
 */
export const CRM2_FIELD_CONTRACT = {
  deal: {
    name: {
      label: 'Deal Name',
      helperText: 'Enter a descriptive title for this sales opportunity.',
      required: true,
      errorRequired: 'Deal name is required',
    },
    contact_id: {
      label: 'Contact UUID',
      helperText: 'Optional link to CRM-1 contact. Leave blank for an Orphan Deal.',
      orphanWarning: 'Orphan Deal: No contact is linked. This deal will be visibly flagged in the pipeline.',
      required: false,
    },
    value: {
      label: 'Deal Value',
      helperText: 'Non-negative decimal monetary amount (e.g. 50000.00).',
      required: true,
      errorInvalid: 'Value must be a valid non-negative decimal string',
    },
    currency: {
      label: 'Currency',
      helperText: 'Explicit 3-letter uppercase ISO 4217 currency code.',
      required: true,
      errorInvalid: 'Currency must be an explicit 3-letter uppercase ISO code (e.g. USD, EUR, GBP)',
    },
    stage_name: {
      label: 'Pipeline Stage',
      helperText: 'Fixed V1 pipeline stage progression.',
      required: true,
      errorInvalid: 'Stage must be one of: New, Qualified, Proposal, Negotiation, Won, Lost',
    },
    close_date: {
      label: 'Target Close Date',
      helperText: 'Projected or actual closing date in YYYY-MM-DD format.',
      required: true,
      errorInvalid: 'Close date must be in YYYY-MM-DD format',
    },
  },
  quote: {
    quote_number: {
      label: 'Quote Number',
      helperText: 'Unique quote reference code (e.g. Q-2026-001).',
      required: true,
      errorRequired: 'Quote number is required',
      errorConflict: 'Domain Invariant Violation: Quote number must be unique.',
    },
    deal_id: {
      label: 'Linked Deal',
      helperText: 'Parent sales deal to which this quote belongs.',
      required: true,
      errorRequired: 'Deal link is required',
    },
    date: {
      label: 'Quote Date',
      helperText: 'Issuance date in YYYY-MM-DD format.',
      required: true,
      errorInvalid: 'Quote date must be in YYYY-MM-DD format',
    },
    amount: {
      label: 'Quote Amount',
      helperText: 'Non-negative decimal quote total amount.',
      required: true,
      errorInvalid: 'Amount must be a valid non-negative decimal string',
    },
    currency: {
      label: 'Currency',
      helperText: 'Explicit 3-letter uppercase ISO code.',
      required: true,
      errorInvalid: 'Currency must be an explicit 3-letter uppercase ISO code (e.g. USD, EUR, GBP)',
    },
    note: {
      label: 'Scope / Terms Note',
      helperText: 'Optional notes, deliverables summary, or commercial terms.',
      required: false,
    },
  },
} as const;

// Health Check Schema
export const Crm2HealthResponseSchema = z.object({
  status: z.literal('ok'),
  module: z.literal('crm-2'),
  name: z.string(),
  version: z.string(),
});
export type Crm2HealthResponse = z.infer<typeof Crm2HealthResponseSchema>;

// Deals Query Filter Schema
export const DealsQuerySchema = z
  .object({
    page: z.coerce
      .number()
      .int({ message: 'page must be an integer' })
      .min(1, { message: 'page must be >= 1' })
      .default(1),
    pageSize: z.coerce
      .number()
      .int({ message: 'pageSize must be an integer' })
      .min(1, { message: 'pageSize must be >= 1' })
      .max(100, { message: 'pageSize cannot exceed 100' })
      .optional(),
    limit: z.coerce
      .number()
      .int({ message: 'limit must be an integer' })
      .min(1, { message: 'limit must be >= 1' })
      .max(100, { message: 'limit cannot exceed 100' })
      .optional(),
    search: z.string().optional(),
    stage: Crm2StageNameSchema.optional(),
  })
  .transform((data) => {
    const size = data.pageSize ?? data.limit ?? 10;
    return {
      page: data.page,
      pageSize: size,
      limit: size,
      ...(data.search !== undefined ? { search: data.search } : {}),
      ...(data.stage !== undefined ? { stage: data.stage } : {}),
    };
  });
export type DealsQuery = z.infer<typeof DealsQuerySchema>;
export type DealsQueryInput = z.input<typeof DealsQuerySchema>;

// CRM-2 Pagination Metadata Schema
export const Crm2PaginationMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  limit: z.number().int().optional(),
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
export const QuotesQuerySchema = z
  .object({
    deal_id: z.string().uuid({ message: 'deal_id must be a valid UUID' }).optional(),
    page: z.coerce
      .number()
      .int({ message: 'page must be an integer' })
      .min(1, { message: 'page must be >= 1' })
      .default(1),
    pageSize: z.coerce
      .number()
      .int({ message: 'pageSize must be an integer' })
      .min(1, { message: 'pageSize must be >= 1' })
      .max(100, { message: 'pageSize cannot exceed 100' })
      .optional(),
    limit: z.coerce
      .number()
      .int({ message: 'limit must be an integer' })
      .min(1, { message: 'limit must be >= 1' })
      .max(100, { message: 'limit cannot exceed 100' })
      .optional(),
  })
  .transform((data) => {
    const size = data.pageSize ?? data.limit ?? 10;
    return {
      page: data.page,
      pageSize: size,
      limit: size,
      ...(data.deal_id !== undefined ? { deal_id: data.deal_id } : {}),
    };
  });
export type QuotesQuery = z.infer<typeof QuotesQuerySchema>;
export type QuotesQueryInput = z.input<typeof QuotesQuerySchema>;

// Quotes List Response Schema
export const QuotesListResponseSchema = z.object({
  items: z.array(QuoteSchema),
  pagination: Crm2PaginationMetaSchema,
});
export type QuotesListResponse = z.infer<typeof QuotesListResponseSchema>;

// CRM-2 Import Ingestion Schemas (KIT Integration & Mutation API)
export const Crm2ImportRowSchema = z.object({
  batchId: z.string().min(1, 'batchId is required').max(128),
  sourceRow: z.number().int().positive(),
  sourceSystem: z.string().min(1).default('kit_import'),
  entity: z.enum(['deal', 'quote', 'stage', 'quote_line', 'deals', 'quotes', 'stages', 'quote_lines']),
  idempotencyKey: z.string().min(1),
  data: z.record(z.unknown()),
});
export type Crm2ImportRow = z.infer<typeof Crm2ImportRowSchema>;

export const Crm2ImportBatchSchema = z.object({
  batchId: z.string().min(1, 'batchId is required').max(128),
  sourceSystem: z.string().min(1).default('kit_import'),
  rows: z.array(Crm2ImportRowSchema),
});
export type Crm2ImportBatch = z.infer<typeof Crm2ImportBatchSchema>;

export const Crm2ImportReceiptSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().min(1).max(128),
  sourceRow: z.number().int().positive(),
  entity: z.enum(['deal', 'quote', 'stage', 'quote_line', 'deals', 'quotes', 'stages', 'quote_lines']),
  sourceSystem: z.string().min(1),
  sourceId: z.string().min(1),
  targetId: z.string().uuid(),
  idempotencyKey: z.string().min(1),
  payloadHash: z.string(),
  kind: z.enum(['created', 'linked']).optional(),
  outcome: z.enum(['created', 'linked']).optional(),
  createdAt: z.string(),
});
export type Crm2ImportReceipt = z.infer<typeof Crm2ImportReceiptSchema>;

// CRM-2 Shared Error Envelope Schema
export const Crm2ErrorDetailSchema = z.object({
  field: z.string().optional(),
  message: z.string(),
  code: z.string().optional(),
});
export type Crm2ErrorDetail = z.infer<typeof Crm2ErrorDetailSchema>;

export const Crm2ErrorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.array(Crm2ErrorDetailSchema).default([]),
  correlation_id: z.string().optional(),
});
export type Crm2ErrorEnvelope = z.infer<typeof Crm2ErrorEnvelopeSchema>;

export { Crm2TargetEntitySchema, type Crm2TargetEntity } from './import-target.js';

// ---------------------------------------------------------------------------
// CRM-2 Chunked Batch Ingestion & Idempotent Retry Contracts (CRM2-13)
// ---------------------------------------------------------------------------

export const CRM2_DEFAULT_CHUNK_SIZE = 500;
export const CRM2_DEFAULT_FAILURE_THRESHOLD = 0.10;
export const CRM2_DEFAULT_MIN_ATTEMPTED_ROWS = 50;
export const CRM2_DEFAULT_MAX_RETRIES = 3;

export const Crm2BatchExecutionStatusSchema = z.enum([
  'COMPLETED',
  'STOPPED_EXCESSIVE_FAILURES',
  'FAILED',
]);
export type Crm2BatchExecutionStatus = z.infer<typeof Crm2BatchExecutionStatusSchema>;

export const Crm2BatchRecordInputSchema = z.object({
  sourceRow: z.number().int({ message: 'sourceRow must be an integer' }).min(1),
  idempotencyKey: z.string().min(1, 'idempotencyKey is required').max(128),
  data: z.record(z.string(), z.unknown()),
});
export type Crm2BatchRecordInput = z.infer<typeof Crm2BatchRecordInputSchema>;

export const Crm2ExecuteBatchLoadInputSchema = z.object({
  batchId: z.string().min(1, 'batchId is required').max(128),
  module: z.enum(['crm-1', 'crm-2', 'crm-3', 'crm-4', 'crm-5']).default('crm-2'),
  step: z.enum(['extract', 'profile', 'clean', 'map', 'load', 'validate', 'reconcile']).default('load'),
  chunkSize: z.number().int().min(1).max(1000).default(500),
  maxRetries: z.number().int().min(0).max(5).default(3),
  failureThreshold: z.number().min(0).max(1).default(0.10),
  minAttemptedRows: z.number().int().min(1).default(50),
  records: z.array(Crm2BatchRecordInputSchema).min(1, 'records must not be empty'),
});
export type Crm2ExecuteBatchLoadInput = z.input<typeof Crm2ExecuteBatchLoadInputSchema>;
export type Crm2ExecuteBatchLoadOutput = z.infer<typeof Crm2ExecuteBatchLoadInputSchema>;

export const Crm2BatchReceiptSchema = z.object({
  batchId: z.string(),
  sourceRow: z.number().int(),
  idempotencyKey: z.string(),
  targetId: z.string(),
  kind: z.enum(['created', 'linked']).default('created'),
  committedAt: z.coerce.date(),
});
export type Crm2BatchReceipt = z.infer<typeof Crm2BatchReceiptSchema>;

export const Crm2FailedRowSchema = z.object({
  sourceRow: z.number().int(),
  idempotencyKey: z.string(),
  errorCode: z.string(),
  errorMessage: z.string(),
  retryAttempts: z.number().int(),
  payloadHash: z.string().optional(),
});
export type Crm2FailedRow = z.infer<typeof Crm2FailedRowSchema>;

export const Crm2BatchExecutionReportSchema = z.object({
  batchId: z.string(),
  module: z.enum(['crm-1', 'crm-2', 'crm-3', 'crm-4', 'crm-5']),
  step: z.enum(['extract', 'profile', 'clean', 'map', 'load', 'validate', 'reconcile']),
  status: Crm2BatchExecutionStatusSchema,
  totalRecords: z.number().int().nonnegative(),
  attemptedRecords: z.number().int().nonnegative(),
  committedRecords: z.number().int().nonnegative(),
  failedRecords: z.number().int().nonnegative(),
  chunksProcessed: z.number().int().nonnegative(),
  chunkSize: z.number().int(),
  failureRate: z.number().min(0).max(1),
  haltReason: z.string().nullable().optional(),
  committedReceipts: z.array(Crm2BatchReceiptSchema),
  failedRows: z.array(Crm2FailedRowSchema),
  executedAt: z.coerce.date(),
});
export type Crm2BatchExecutionReport = z.infer<typeof Crm2BatchExecutionReportSchema>;

// CRM-2 Exact Duplicate Key Policy Contracts & Normalizers (CRM2-12)
export * from './crm-2-duplicates.js';

