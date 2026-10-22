import { z } from 'zod';

/**
 * Typed entity namespaces for Golden ID mappings (PLT-07).
 * Enforces strict domain isolation so different entity types never collide.
 */
export const EntityTypeSchema = z.enum([
  'contact',
  'company',
  'customer',
  'product',
  'vendor',
  'employee',
]);

export type EntityType = z.infer<typeof EntityTypeSchema>;

export const GoldenIdStatusSchema = z.enum(['active', 'merged', 'flagged']);
export type GoldenIdStatus = z.infer<typeof GoldenIdStatusSchema>;

/**
 * Golden Record Identity schema.
 * Hub owns UUID primary identity and display-only GID-... values.
 * Display GID is NEVER used as a primary or foreign key (Non-Negotiable Invariant).
 */
export const GoldenRecordSchema = z.object({
  id: z.string().uuid({ message: 'Primary Golden identity must be a valid UUID' }),
  displayGid: z.string().regex(/^GID-[A-Z0-9-]+$/, {
    message: 'Display GID must follow GID-... formatting convention',
  }),
  entityType: EntityTypeSchema,
  status: GoldenIdStatusSchema.default('active'),
  mergedIntoId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type GoldenRecord = z.infer<typeof GoldenRecordSchema>;

/**
 * Source mapping record linking (entity_type, source_system, source_id) to a Golden UUID.
 * Source identifiers are stored strictly as text strings without lossy numeric coercion.
 */
export const SourceIdentityMapRecordSchema = z.object({
  id: z.string().uuid(),
  goldenRecordId: z.string().uuid(),
  displayGid: z.string(),
  entityType: EntityTypeSchema,
  sourceSystem: z.string().min(1, 'sourceSystem is required'),
  sourceId: z.string().min(1, 'sourceId is required'),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
});

export type SourceIdentityMapRecord = z.infer<typeof SourceIdentityMapRecordSchema>;

/**
 * Evidence supplied during identity resolution or ingestion.
 */
export const IdentityEvidenceSchema = z.object({
  email: z.string().optional(),
  phone: z.string().optional(),
  taxNumber: z.string().optional(),
  name: z.string().optional(),
  sku: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type IdentityEvidence = z.infer<typeof IdentityEvidenceSchema>;

/**
 * Upsert Request Schema for Source Identity.
 */
export const UpsertSourceIdentityRequestSchema = z.object({
  entityType: EntityTypeSchema,
  sourceSystem: z.string().min(1, 'sourceSystem is required'),
  sourceId: z.string().min(1, 'sourceId is required'),
  evidence: IdentityEvidenceSchema.optional(),
});

export type UpsertSourceIdentityRequest = z.infer<typeof UpsertSourceIdentityRequestSchema>;

/**
 * Conflict / Review Candidate details when evidence conflicts are detected.
 * Exact matches produce review candidates where destructive merge is possible; no fuzzy auto-merge.
 */
export const IdentityConflictTypeSchema = z.enum([
  'tax_conflict',
  'email_conflict',
  'phone_conflict',
  'ambiguous_match',
]);

export type IdentityConflictType = z.infer<typeof IdentityConflictTypeSchema>;

export const IdentityReviewCandidateSchema = z.object({
  conflictType: IdentityConflictTypeSchema,
  conflictingGoldenRecordId: z.string().uuid(),
  conflictingDisplayGid: z.string(),
  matchedKey: z.string(),
  reason: z.string(),
  candidateEvidence: IdentityEvidenceSchema.optional(),
  existingEvidence: IdentityEvidenceSchema.optional(),
  openedAt: z.string().datetime(),
});

export type IdentityReviewCandidate = z.infer<typeof IdentityReviewCandidateSchema>;

/**
 * Upsert Response Schema.
 */
export const UpsertSourceIdentityResponseSchema = z.object({
  goldenRecordId: z.string().uuid(),
  displayGid: z.string(),
  entityType: EntityTypeSchema,
  sourceSystem: z.string(),
  sourceId: z.string(),
  status: z.enum(['created', 'existing', 'review_required']),
  reviewCandidate: IdentityReviewCandidateSchema.optional(),
  createdAt: z.string().datetime(),
});

export type UpsertSourceIdentityResponse = z.infer<typeof UpsertSourceIdentityResponseSchema>;

/**
 * Lookup query parameters for source mapping.
 */
export const LookupSourceIdentityQuerySchema = z.object({
  entityType: EntityTypeSchema,
  sourceSystem: z.string().min(1),
  sourceId: z.string().min(1),
});

export type LookupSourceIdentityQuery = z.infer<typeof LookupSourceIdentityQuerySchema>;

/**
 * Lookup by Golden ID path parameter.
 * Enforces UUID format; rejects display GID.
 */
export const LookupGoldenIdParamsSchema = z.object({
  goldenRecordId: z.string().uuid({
    message: 'Primary identity lookup requires a valid UUID. Display GIDs (e.g. GID-...) are not permitted as lookup keys.',
  }),
});

export type LookupGoldenIdParams = z.infer<typeof LookupGoldenIdParamsSchema>;

/**
 * Resolve Request Schema for looking up by normalized evidence.
 */
export const ResolveEvidenceRequestSchema = z.object({
  entityType: EntityTypeSchema,
  email: z.string().optional(),
  phone: z.string().optional(),
  taxNumber: z.string().optional(),
});

export type ResolveEvidenceRequest = z.infer<typeof ResolveEvidenceRequestSchema>;

/**
 * Human-governed Merge Request Schema.
 * Invariant: Destructive merges require explicit human review; zero automatic merge.
 */
export const MergeGoldenIdRequestSchema = z.object({
  targetGoldenRecordId: z.string().uuid({ message: 'targetGoldenRecordId must be a valid UUID' }),
  sourceGoldenRecordId: z.string().uuid({ message: 'sourceGoldenRecordId must be a valid UUID' }),
  actor: z.string().min(1, 'actor is required for audit trail'),
  reason: z.string().min(1, 'reason is required for merge audit trail'),
});

export type MergeGoldenIdRequest = z.infer<typeof MergeGoldenIdRequestSchema>;

/**
 * Mapping History Entry Schema.
 */
export const GoldenIdHistoryRecordSchema = z.object({
  id: z.string().uuid(),
  goldenRecordId: z.string().uuid(),
  sourceSystem: z.string(),
  sourceId: z.string(),
  action: z.enum(['mapped', 'repointed', 'conflict_flagged', 'merged']),
  timestamp: z.string().datetime(),
  actor: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type GoldenIdHistoryRecord = z.infer<typeof GoldenIdHistoryRecordSchema>;

/**
 * Full Golden Record detail with associated source mappings.
 */
export const GoldenRecordDetailResponseSchema = z.object({
  record: GoldenRecordSchema,
  mappings: z.array(SourceIdentityMapRecordSchema),
  history: z.array(GoldenIdHistoryRecordSchema).optional(),
});

export type GoldenRecordDetailResponse = z.infer<typeof GoldenRecordDetailResponseSchema>;
