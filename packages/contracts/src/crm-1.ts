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
