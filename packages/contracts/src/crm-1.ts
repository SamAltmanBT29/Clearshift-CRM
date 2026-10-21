import { z } from "zod";

export const CRM1_API_PREFIX = "/api/v1/crm-contacts";

export const CRM1LeadStatusSchema = z.enum(["New", "Working", "Qualified", "Closed"]);
export const CRM1ConsentStatusSchema = z.enum(["unknown", "granted", "withdrawn"]);
export const CRM1EntityTypeSchema = z.enum(["contact", "company", "lead"]);
export const CRM1ImportStatusSchema = z.enum(["pending", "processing", "completed", "failed"]);

const sourceIdentity = {
  sourceSystem: z.string().trim().min(1).optional().nullable(),
  sourceId: z.string().trim().min(1).optional().nullable()
};

type SourceIdentityValue = {
  sourceSystem?: string | null | undefined;
  sourceId?: string | null | undefined;
};

function requirePairedSourceIdentity(
  value: SourceIdentityValue,
  context: z.RefinementCtx
): void {
  if ((value.sourceSystem == null) !== (value.sourceId == null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "sourceSystem and sourceId must be supplied together",
      path: ["sourceSystem"]
    });
  }
}

function requirePairedPatchSourceIdentity(
  value: SourceIdentityValue,
  context: z.RefinementCtx
): void {
  const hasSourceSystem = Object.hasOwn(value, "sourceSystem");
  const hasSourceId = Object.hasOwn(value, "sourceId");
  if (hasSourceSystem !== hasSourceId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "sourceSystem and sourceId must be patched together",
      path: [hasSourceSystem ? "sourceId" : "sourceSystem"]
    });
  }
  requirePairedSourceIdentity(value, context);
}

export const CRM1ContactSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  companyId: z.string().uuid().nullable(),
  leadStatus: CRM1LeadStatusSchema.nullable(),
  goldenId: z.string().min(1),
  sourceSystem: z.string().nullable(),
  sourceId: z.string().nullable(),
  consentStatus: CRM1ConsentStatusSchema,
  consentUpdatedAt: z.string().datetime().nullable(),
  unsubscribed: z.boolean(),
  unsubscribedUpdatedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

const CRM1ContactInputSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().trim().min(1).optional().nullable(),
  address: z.string().trim().min(1).optional().nullable(),
  companyId: z.string().uuid().optional().nullable(),
  leadStatus: CRM1LeadStatusSchema.optional().nullable(),
  goldenId: z.string().trim().min(1).optional(),
  ...sourceIdentity
});

export const CRM1ContactCreateSchema = CRM1ContactInputSchema.superRefine(
  requirePairedSourceIdentity
);

export const CRM1ContactPatchSchema = CRM1ContactInputSchema.partial()
  .extend({
    consentStatus: CRM1ConsentStatusSchema.optional(),
    consentUpdatedAt: z.string().datetime().optional().nullable(),
    unsubscribed: z.boolean().optional(),
    unsubscribedUpdatedAt: z.string().datetime().optional().nullable()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided")
  .superRefine((value, context) => {
    requirePairedPatchSourceIdentity(value, context);
    if (Object.hasOwn(value, "consentStatus") !== Object.hasOwn(value, "consentUpdatedAt")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "consentStatus and consentUpdatedAt must be patched together",
        path: ["consentUpdatedAt"]
      });
    }
    if (Object.hasOwn(value, "unsubscribed") !== Object.hasOwn(value, "unsubscribedUpdatedAt")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "unsubscribed and unsubscribedUpdatedAt must be patched together",
        path: ["unsubscribedUpdatedAt"]
      });
    }
  });

export const CRM1CompanySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  taxNumber: z.string().nullable(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  sourceSystem: z.string().nullable(),
  sourceId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

const CRM1CompanyInputSchema = z.object({
  name: z.string().trim().min(1),
  taxNumber: z.string().trim().min(1).optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().trim().min(1).optional().nullable(),
  address: z.string().trim().min(1).optional().nullable(),
  ...sourceIdentity
});

export const CRM1CompanyCreateSchema = CRM1CompanyInputSchema.superRefine(
  requirePairedSourceIdentity
);

export const CRM1CompanyPatchSchema = CRM1CompanyInputSchema.partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided")
  .superRefine(requirePairedPatchSourceIdentity);

export const CRM1LeadSchema = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid(),
  status: CRM1LeadStatusSchema,
  sourceSystem: z.string().nullable(),
  sourceId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

const CRM1LeadInputSchema = z.object({
  contactId: z.string().uuid(),
  status: CRM1LeadStatusSchema,
  ...sourceIdentity
});

export const CRM1LeadCreateSchema = CRM1LeadInputSchema.superRefine(
  requirePairedSourceIdentity
);

export const CRM1LeadPatchSchema = CRM1LeadInputSchema.partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided")
  .superRefine(requirePairedPatchSourceIdentity);

export const CRM1ListQuerySchema = z.object({
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().default(25)
});

export const CRM1ListResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative()
  });

const CRM1ContactImportDataSchema = CRM1ContactInputSchema
  .omit({ sourceSystem: true, sourceId: true })
  .extend({ sourceId: z.string().trim().min(1) });
const CRM1CompanyImportDataSchema = CRM1CompanyInputSchema
  .omit({ sourceSystem: true, sourceId: true })
  .extend({ sourceId: z.string().trim().min(1) });
const CRM1LeadImportDataSchema = CRM1LeadInputSchema
  .omit({ sourceSystem: true, sourceId: true })
  .extend({ sourceId: z.string().trim().min(1) });

export const CRM1ImportRowSchema = z.discriminatedUnion("entity", [
  z.object({
    entity: z.literal("contact"),
    sourceRow: z.number().int().positive(),
    data: CRM1ContactImportDataSchema
  }),
  z.object({
    entity: z.literal("company"),
    sourceRow: z.number().int().positive(),
    data: CRM1CompanyImportDataSchema
  }),
  z.object({
    entity: z.literal("lead"),
    sourceRow: z.number().int().positive(),
    data: CRM1LeadImportDataSchema
  })
]);

export const CRM1ImportCreateSchema = z.object({
  sourceSystem: z.string().trim().min(1),
  rows: z.array(CRM1ImportRowSchema).min(1)
}).superRefine((value, context) => {
  const seenRows = new Set<string>();
  value.rows.forEach((row, index) => {
    const key = `${row.sourceRow}:${row.entity}`;
    if (seenRows.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each source row and entity can be imported only once per batch",
        path: ["rows", index, "sourceRow"]
      });
    }
    seenRows.add(key);
  });
});

export const CRM1ImportBatchSchema = z.object({
  id: z.string().uuid(),
  sourceSystem: z.string().min(1),
  status: CRM1ImportStatusSchema,
  loadedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable()
});

export const CRM1ImportRejectSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().uuid(),
  sourceRow: z.number().int().positive(),
  entity: CRM1EntityTypeSchema,
  reasonCode: z.string().min(1),
  message: z.string().min(1),
  createdAt: z.string().datetime()
});

export const CRM1ImportBatchDetailSchema = CRM1ImportBatchSchema.extend({
  receipts: z.array(
    z.object({
      sourceRow: z.number().int().positive(),
      entity: CRM1EntityTypeSchema,
      targetId: z.string().uuid(),
      createdAt: z.string().datetime()
    })
  )
});

export const CRM1ImportRejectListSchema = CRM1ListResponseSchema(CRM1ImportRejectSchema);

export type CRM1Contact = z.infer<typeof CRM1ContactSchema>;
export type CRM1ContactCreate = z.infer<typeof CRM1ContactCreateSchema>;
export type CRM1ContactPatch = z.infer<typeof CRM1ContactPatchSchema>;
export type CRM1Company = z.infer<typeof CRM1CompanySchema>;
export type CRM1CompanyCreate = z.infer<typeof CRM1CompanyCreateSchema>;
export type CRM1CompanyPatch = z.infer<typeof CRM1CompanyPatchSchema>;
export type CRM1Lead = z.infer<typeof CRM1LeadSchema>;
export type CRM1LeadCreate = z.infer<typeof CRM1LeadCreateSchema>;
export type CRM1LeadPatch = z.infer<typeof CRM1LeadPatchSchema>;
export type CRM1ImportCreate = z.infer<typeof CRM1ImportCreateSchema>;
export type CRM1ImportRow = z.infer<typeof CRM1ImportRowSchema>;

/**
 * CRM-1 Contacts, Companies and Leads — API Contracts & Zod Schemas
 * Strictly validates requests, responses, and domain invariants.
 */

// ---------------------------------------------------------------------------
// 1. Enums & Common Schemas
// ---------------------------------------------------------------------------

export const LeadStatusSchema = z.enum(['New', 'Working', 'Qualified', 'Closed']);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

export const Crm1ImportStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'halted',
]);
export type Crm1ImportStatus = z.infer<typeof Crm1ImportStatusSchema>;

// Base pagination query: bounded page (>= 1) and pageSize (1..100)
export const BaseContactsPaginationQuerySchema = z.object({
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
});

export const ContactsPaginationQuerySchema = BaseContactsPaginationQuerySchema.transform((data) => {
  const size = data.pageSize ?? data.limit ?? 25;
  return {
    page: data.page,
    pageSize: size,
    limit: size,
  };
});
export type ContactsPaginationQuery = z.infer<typeof ContactsPaginationQuerySchema>;

export const BaseGenericPaginationQuerySchema = z.object({
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
});

export const GenericPaginationQuerySchema = BaseGenericPaginationQuerySchema.transform((data) => {
  const size = data.pageSize ?? data.limit ?? 20;
  return {
    page: data.page,
    pageSize: size,
    limit: size,
  };
});
export type GenericPaginationQuery = z.infer<typeof GenericPaginationQuerySchema>;

// ---------------------------------------------------------------------------
// 2. Contacts Schemas
// ---------------------------------------------------------------------------

export const ContactSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(255),
  phone: z.string().max(50).nullable().optional(),
  addressLine: z.string().max(255).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  companyId: z.string().uuid().nullable().optional(),
  leadStatus: LeadStatusSchema,
  goldenId: z.string().max(128),
  sourceSystem: z.string().max(64),
  sourceId: z.string().max(128),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const ContactsQuerySchema = BaseContactsPaginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  email: z.string().trim().max(255).optional(),
  leadStatus: LeadStatusSchema.optional(),
  companyId: z.string().uuid().optional(),
}).transform((data) => {
  const size = data.pageSize ?? data.limit ?? 25;
  return {
    page: data.page,
    pageSize: size,
    limit: size,
    ...(data.search !== undefined ? { search: data.search } : {}),
    ...(data.email !== undefined ? { email: data.email } : {}),
    ...(data.leadStatus !== undefined ? { leadStatus: data.leadStatus } : {}),
    ...(data.companyId !== undefined ? { companyId: data.companyId } : {}),
  };
});
export type ContactsQuery = z.infer<typeof ContactsQuerySchema>;

export const PaginatedContactsResponseSchema = z.object({
  items: z.array(ContactSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});
export type PaginatedContactsResponse = z.infer<typeof PaginatedContactsResponseSchema>;

export const CreateContactInputSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  email: z.string().trim().email('Valid email is required').max(255),
  phone: z.string().trim().max(50).nullable().optional(),
  addressLine: z.string().trim().max(255).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  companyId: z.string().uuid('companyId must be a valid UUID').nullable().optional(),
  leadStatus: LeadStatusSchema.default('New'),
  goldenId: z.string().trim().max(128).optional(),
  sourceSystem: z.string().trim().max(64).default('clearshift_api'),
  sourceId: z.string().trim().max(128).optional(),
});
export type CreateContactInput = z.infer<typeof CreateContactInputSchema>;

export const UpdateContactInputSchema = CreateContactInputSchema.partial();
export type UpdateContactInput = z.infer<typeof UpdateContactInputSchema>;

// ---------------------------------------------------------------------------
// 3. Companies Schemas
// ---------------------------------------------------------------------------

export const CompanySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  taxNumber: z.string().min(1).max(64),
  email: z.string().email().max(255).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  addressLine: z.string().max(255).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  sourceSystem: z.string().max(64),
  sourceId: z.string().max(128),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Company = z.infer<typeof CompanySchema>;

export const CompaniesQuerySchema = BaseGenericPaginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  taxNumber: z.string().trim().max(64).optional(),
}).transform((data) => {
  const size = data.pageSize ?? data.limit ?? 20;
  return {
    page: data.page,
    pageSize: size,
    limit: size,
    ...(data.search !== undefined ? { search: data.search } : {}),
    ...(data.taxNumber !== undefined ? { taxNumber: data.taxNumber } : {}),
  };
});
export type CompaniesQuery = z.infer<typeof CompaniesQuerySchema>;

export const PaginatedCompaniesResponseSchema = z.object({
  items: z.array(CompanySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});
export type PaginatedCompaniesResponse = z.infer<typeof PaginatedCompaniesResponseSchema>;

export const CreateCompanyInputSchema = z.object({
  name: z.string().trim().min(1, 'Company name is required').max(255),
  taxNumber: z.string().trim().min(1, 'Tax number is required').max(64),
  email: z.string().trim().email('Valid company email is required').max(255).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  addressLine: z.string().trim().max(255).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  sourceSystem: z.string().trim().max(64).default('clearshift_api'),
  sourceId: z.string().trim().max(128).optional(),
});
export type CreateCompanyInput = z.infer<typeof CreateCompanyInputSchema>;

export const UpdateCompanyInputSchema = CreateCompanyInputSchema.partial();
export type UpdateCompanyInput = z.infer<typeof UpdateCompanyInputSchema>;

// ---------------------------------------------------------------------------
// 4. Leads Schemas
// ---------------------------------------------------------------------------

export const LeadSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  status: LeadStatusSchema,
  contactId: z.string().uuid().nullable().optional(),
  sourceSystem: z.string().max(64),
  sourceId: z.string().max(128),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Lead = z.infer<typeof LeadSchema>;

export const LeadsQuerySchema = BaseGenericPaginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: LeadStatusSchema.optional(),
  contactId: z.string().uuid().optional(),
}).transform((data) => {
  const size = data.pageSize ?? data.limit ?? 20;
  return {
    page: data.page,
    pageSize: size,
    limit: size,
    ...(data.search !== undefined ? { search: data.search } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
    ...(data.contactId !== undefined ? { contactId: data.contactId } : {}),
  };
});
export type LeadsQuery = z.infer<typeof LeadsQuerySchema>;

export const PaginatedLeadsResponseSchema = z.object({
  items: z.array(LeadSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});
export type PaginatedLeadsResponse = z.infer<typeof PaginatedLeadsResponseSchema>;

export const CreateLeadInputSchema = z.object({
  name: z.string().trim().min(1, 'Lead name is required').max(255),
  email: z.string().trim().email('Valid lead email is required').max(255),
  status: LeadStatusSchema.default('New'),
  contactId: z.string().uuid().nullable().optional(),
  sourceSystem: z.string().trim().max(64).default('clearshift_api'),
  sourceId: z.string().trim().max(128).optional(),
});
export type CreateLeadInput = z.infer<typeof CreateLeadInputSchema>;

export const UpdateLeadInputSchema = CreateLeadInputSchema.partial();
export type UpdateLeadInput = z.infer<typeof UpdateLeadInputSchema>;

// ---------------------------------------------------------------------------
// 5. Imports & Rejects Schemas
// ---------------------------------------------------------------------------

export const Crm1ImportRunSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().min(1).max(128),
  module: z.literal('crm-1'),
  status: Crm1ImportStatusSchema,
  recordsIn: z.number().int().nonnegative(),
  recordsOut: z.number().int().nonnegative(),
  recordsRejected: z.number().int().nonnegative(),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Crm1ImportRun = z.infer<typeof Crm1ImportRunSchema>;

export const CreateCrm1ImportInputSchema = z.object({
  batchId: z.string().trim().min(1, 'batchId is required').max(128),
  sourceSystem: z.string().trim().min(1, 'sourceSystem is required').max(64),
  filename: z.string().trim().min(1, 'filename is required').max(255).optional(),
  mapping: z.record(z.string(), z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateCrm1ImportInput = z.infer<typeof CreateCrm1ImportInputSchema>;

export const Crm1RejectSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().min(1).max(128),
  module: z.literal('crm-1'),
  rowIndex: z.number().int().min(1),
  errorCode: z.string().max(64),
  errorMessage: z.string(),
  rawPayloadHash: z.string().max(64),
  createdAt: z.coerce.date(),
});
export type Crm1Reject = z.infer<typeof Crm1RejectSchema>;

export const Crm1RejectsQuerySchema = BaseGenericPaginationQuerySchema.extend({
  batchId: z.string().trim().min(1).optional(),
  errorCode: z.string().trim().max(64).optional(),
}).transform((data) => {
  const size = data.pageSize ?? data.limit ?? 20;
  return {
    page: data.page,
    pageSize: size,
    limit: size,
    ...(data.batchId !== undefined ? { batchId: data.batchId } : {}),
    ...(data.errorCode !== undefined ? { errorCode: data.errorCode } : {}),
  };
});
export type Crm1RejectsQuery = z.infer<typeof Crm1RejectsQuerySchema>;

export const PaginatedCrm1RejectsResponseSchema = z.object({
  items: z.array(Crm1RejectSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});
export type PaginatedCrm1RejectsResponse = z.infer<typeof PaginatedCrm1RejectsResponseSchema>;
