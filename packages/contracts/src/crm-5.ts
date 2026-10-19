import { z } from 'zod';

/**
 * CRM-5 Migration Control Center and Reports — API Contracts & Zod Schemas
 * Strictly validates requests, responses, and calculation formulas.
 */

// ---------------------------------------------------------------------------
// 1. Enums & Primitive Schemas
// ---------------------------------------------------------------------------

export const CrmModuleSchema = z.enum(['crm-1', 'crm-2', 'crm-3', 'crm-4', 'crm-5']);
export type CrmModule = z.infer<typeof CrmModuleSchema>;

export const MigrationStepSchema = z.enum([
  'extract',
  'profile',
  'clean',
  'map',
  'load',
  'validate',
  'reconcile',
]);
export type MigrationStep = z.infer<typeof MigrationStepSchema>;

export const MigrationRunStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'halted',
]);
export type MigrationRunStatus = z.infer<typeof MigrationRunStatusSchema>;

export const ReconciliationStatusSchema = z.enum(['OK', 'UNBALANCED']);
export type ReconciliationStatus = z.infer<typeof ReconciliationStatusSchema>;

// Bounded Pagination Query
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

// ---------------------------------------------------------------------------
// 2. Migration Run Schemas
// ---------------------------------------------------------------------------

export const MigrationRunSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().min(1).max(128),
  module: CrmModuleSchema,
  step: MigrationStepSchema,
  status: MigrationRunStatusSchema,
  recordsIn: z.number().int().nonnegative(),
  recordsOut: z.number().int().nonnegative(),
  recordsRejected: z.number().int().nonnegative(),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type MigrationRun = z.infer<typeof MigrationRunSchema>;

export const RunsQuerySchema = PaginationQuerySchema.extend({
  module: CrmModuleSchema.optional(),
  batchId: z.string().optional(),
  status: MigrationRunStatusSchema.optional(),
});
export type RunsQuery = z.infer<typeof RunsQuerySchema>;

export const PaginatedRunsResponseSchema = z.object({
  items: z.array(MigrationRunSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});
export type PaginatedRunsResponse = z.infer<typeof PaginatedRunsResponseSchema>;

// ---------------------------------------------------------------------------
// 3. Quality Score Schemas & Exact Formula
// ---------------------------------------------------------------------------

export const QualityScoreComponentsSchema = z.object({
  completeness: z.number().min(0).max(1).nullable().optional(),
  validity: z.number().min(0).max(1).nullable().optional(),
  duplicateRate: z.number().min(0).max(1).nullable().optional(),
  rejectRate: z.number().min(0).max(1).nullable().optional(),
  linkIntegrity: z.number().min(0).max(1).nullable().optional(),
});
export type QualityScoreComponents = z.infer<typeof QualityScoreComponentsSchema>;

export const QualityScoreSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().min(1).max(128),
  module: CrmModuleSchema,
  completeness: z.number().min(0).max(1).nullable(),
  validity: z.number().min(0).max(1).nullable(),
  duplicateRate: z.number().min(0).max(1).nullable(),
  rejectRate: z.number().min(0).max(1).nullable(),
  linkIntegrity: z.number().min(0).max(1).nullable(),
  score: z.number().min(0).max(100).nullable(),
  isFullyScored: z.boolean(),
  scoredAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});
export type QualityScore = z.infer<typeof QualityScoreSchema>;

export const ScoresQuerySchema = PaginationQuerySchema.extend({
  module: CrmModuleSchema.optional(),
  batchId: z.string().optional(),
});
export type ScoresQuery = z.infer<typeof ScoresQuerySchema>;

export const ScoresResponseSchema = z.object({
  items: z.array(QualityScoreSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  averageScore: z.number().min(0).max(100).nullable(),
});
export type ScoresResponse = z.infer<typeof ScoresResponseSchema>;

/**
 * Exact Quality Score Calculation:
 * Score = 100 * (completeness + validity + (1 - duplicate_rate) + (1 - reject_rate) + link_integrity) / 5
 * Rounded to 2 decimal places. Returns null if any of the 5 components is missing/unavailable.
 */
export function computeQualityScore(c: QualityScoreComponents): number | null {
  if (
    c.completeness == null ||
    c.validity == null ||
    c.duplicateRate == null ||
    c.rejectRate == null ||
    c.linkIntegrity == null
  ) {
    return null;
  }
  const raw =
    100 *
    (c.completeness +
      c.validity +
      (1 - c.duplicateRate) +
      (1 - c.rejectRate) +
      c.linkIntegrity) /
    5;
  return Math.round(raw * 100) / 100;
}

// ---------------------------------------------------------------------------
// 4. Migration Rejects Schemas
// ---------------------------------------------------------------------------

export const MigrationRejectSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().min(1).max(128),
  module: CrmModuleSchema,
  rowIndex: z.number().int().positive(),
  errorCode: z.string().min(1).max(64),
  errorMessage: z.string().min(1),
  rawPayloadHash: z.string().length(64),
  createdAt: z.coerce.date(),
});
export type MigrationReject = z.infer<typeof MigrationRejectSchema>;

export const RejectsQuerySchema = PaginationQuerySchema.extend({
  module: CrmModuleSchema.optional(),
  batchId: z.string().optional(),
});
export type RejectsQuery = z.infer<typeof RejectsQuerySchema>;

export const PaginatedRejectsResponseSchema = z.object({
  items: z.array(MigrationRejectSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
});
export type PaginatedRejectsResponse = z.infer<typeof PaginatedRejectsResponseSchema>;

// ---------------------------------------------------------------------------
// 5. Reconciliation Report Schemas & Exact Conservation Invariant
// ---------------------------------------------------------------------------

export const ReconciliationReportSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().min(1).max(128),
  module: CrmModuleSchema,
  sourceCount: z.number().int().nonnegative(),
  loadedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  mergedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  unaccountedCount: z.number().int().nonnegative(),
  status: ReconciliationStatusSchema,
  reconciledAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});
export type ReconciliationReport = z.infer<typeof ReconciliationReportSchema>;

export interface ReconciliationInput {
  sourceCount: number;
  loadedCount: number;
  rejectedCount: number;
  mergedCount: number;
  skippedCount: number;
}

export interface ReconciliationVerification {
  unaccountedCount: number;
  status: ReconciliationStatus;
  isBalanced: boolean;
}

/**
 * Exact Reconciliation Verification:
 * Source = Loaded + Rejected + Merged + Skipped + Unaccounted
 * OK only if unaccounted = 0 and equation balances.
 */
export function verifyReconciliation(input: ReconciliationInput): ReconciliationVerification {
  const accounted =
    input.loadedCount +
    input.rejectedCount +
    input.mergedCount +
    input.skippedCount;
  const unaccounted = Math.max(0, input.sourceCount - accounted);
  const isBalanced = unaccounted === 0 && input.sourceCount === accounted;
  return {
    unaccountedCount: unaccounted,
    status: isBalanced ? 'OK' : 'UNBALANCED',
    isBalanced,
  };
}

/**
 * Formula Injection Defense for CSV/Spreadsheet Exports:
 * Neutralizes leading '=', '+', '-', '@', '\t', '\r' by prepending a single quote.
 */
export function sanitizeCsvFormula(value: string): string {
  if (typeof value !== 'string') return String(value);
  const trimmed = value.trim();
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    return `'${value}`;
  }
  return value;
}
