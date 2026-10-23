import { z } from 'zod';
import { createHash } from 'node:crypto';

/**
 * Target Entities owned by CRM-5 Migration Control Center & Reports
 */
export const Crm5TargetEntitySchema = z.enum([
  'runs',
  'scores',
  'rejects',
  'reconciliation',
]);
export type Crm5TargetEntity = z.infer<typeof Crm5TargetEntitySchema>;

/**
 * Target Entities owned by CRM-1 Contacts, Companies and Leads
 */
export const Crm1TargetEntitySchema = z.enum([
  'contacts',
  'companies',
  'leads',
  'contact',
  'company',
  'lead',
]);
export type Crm1TargetEntity = z.infer<typeof Crm1TargetEntitySchema>;

/**
 * Target Entities owned by CRM-2 Deals, Pipeline and Quotes
 */
export const Crm2TargetEntitySchema = z.enum([
  'deals',
  'quotes',
  'stages',
  'quote_lines',
  'quoteLines',
  'deal',
  'quote',
  'stage',
  'quote_line',
]);
export type Crm2TargetEntity = z.infer<typeof Crm2TargetEntitySchema>;

export const GenericTargetEntitySchema = z.union([
  Crm5TargetEntitySchema,
  Crm1TargetEntitySchema,
  Crm2TargetEntitySchema,
  z.string().min(1).max(64),
]);
export type GenericTargetEntity = z.infer<typeof GenericTargetEntitySchema>;

/**
 * Outcome classification for imported rows (KIT-08)
 */
export const RowOutcomeClassificationSchema = z.enum([
  'created',
  'linked',
  'rejected',
  'skipped',
]);
export type RowOutcomeClassification = z.infer<typeof RowOutcomeClassificationSchema>;

/**
 * Incoming mapped V1 row request schema for module target adapter
 */
export const ImportRowInputSchema = z.object({
  batchId: z.string().min(1, 'batchId is required').max(128),
  sourceRow: z.number().int({ message: 'sourceRow must be an integer' }).min(1, 'sourceRow must be >= 1'),
  sourceSystem: z.string().max(64).optional(),
  sourceId: z.string().max(128).optional(),
  entity: GenericTargetEntitySchema,
  data: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(1, 'idempotencyKey is required').max(256),
  correlationId: z.string().max(128).optional(),
  schemaVersion: z.number().int().min(1).default(1),
});
export type ImportRowInput = z.infer<typeof ImportRowInputSchema>;

/**
 * Durable Import Receipt Schema (stored in crm5_import_receipts)
 */
export const ImportReceiptContractSchema = z.object({
  id: z.string().uuid().optional(),
  batchId: z.string().min(1).max(128),
  sourceRow: z.number().int().min(1),
  sourceSystem: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
  entity: z.string().min(1).max(64),
  schemaVersion: z.number().int().default(1),
  idempotencyKey: z.string().min(1).max(256),
  payloadHash: z.string().length(64),
  targetId: z.string().uuid(),
  kind: z.enum(['created', 'linked']).default('created'),
  outcome: RowOutcomeClassificationSchema.default('created'),
  createdAt: z.coerce.date(),
});
export type ImportReceiptContract = z.infer<typeof ImportReceiptContractSchema>;

/**
 * Successful Target Adapter / Import Row Response Schema
 */
export const ImportRowResponseSchema = z.object({
  targetId: z.string().uuid(),
  version: z.number().int().default(1),
  outcome: RowOutcomeClassificationSchema,
  receipt: ImportReceiptContractSchema,
  isExisting: z.boolean().default(false),
});
export type ImportRowResponse = z.infer<typeof ImportRowResponseSchema>;

/**
 * Structured Target Adapter Error / Rejection
 */
export const TargetAdapterErrorDetailSchema = z.object({
  reasonCode: z.string(),
  message: z.string(),
  field: z.string().optional(),
  retryable: z.boolean().default(false),
});
export type TargetAdapterErrorDetail = z.infer<typeof TargetAdapterErrorDetailSchema>;

/**
 * Deterministically serialize any object with sorted keys
 */
export function canonicalJsonStringify(data: unknown): string {
  if (data === null || typeof data !== 'object') {
    return JSON.stringify(data);
  }

  if (Array.isArray(data)) {
    return '[' + data.map((item) => canonicalJsonStringify(item)).join(',') + ']';
  }

  const record = data as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const entries = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJsonStringify(record[key])}`
  );
  return '{' + entries.join(',') + '}';
}

/**
 * Computes a deterministic SHA-256 hash of a payload
 */
export function computeCanonicalPayloadHash(data: unknown): string {
  const canonical = canonicalJsonStringify(data);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
