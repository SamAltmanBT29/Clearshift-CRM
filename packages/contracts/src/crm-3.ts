import { z } from "zod";

export const CRM3_API_PREFIX = "/api/v1/crm-tickets";

// ---------------------------------------------------------------------------
// 1. Enums & Statuses (FR-CRM3-03)
// ---------------------------------------------------------------------------

export const CRM3_TICKET_STATUSES = [
  "New",
  "Open",
  "Waiting",
  "Solved",
  "Closed"
] as const;

export const CRM3TicketStatusSchema = z.enum(CRM3_TICKET_STATUSES);
export type CRM3TicketStatus = z.infer<typeof CRM3TicketStatusSchema>;

export const CRM3_TICKET_PRIORITIES = [
  "Low",
  "Normal",
  "High",
  "Urgent"
] as const;

export const CRM3TicketPrioritySchema = z.enum(CRM3_TICKET_PRIORITIES);
export type CRM3TicketPriority = z.infer<typeof CRM3TicketPrioritySchema>;

export function assertValidTicketStatus(status: string): asserts status is CRM3TicketStatus {
  const result = CRM3TicketStatusSchema.safeParse(status);
  if (!result.success) {
    throw new Error(
      `Domain Invariant Violation: Ticket status '${status}' is not permitted. Status set is exactly: ${CRM3_TICKET_STATUSES.join(", ")}`
    );
  }
}

export function assertValidTicketPriority(priority: string): asserts priority is CRM3TicketPriority {
  const result = CRM3TicketPrioritySchema.safeParse(priority);
  if (!result.success) {
    throw new Error(
      `Domain Invariant Violation: Ticket priority '${priority}' is not permitted. Priority set is exactly: ${CRM3_TICKET_PRIORITIES.join(", ")}`
    );
  }
}

/**
 * Allowed ticket status transitions for user edits (PATCH). Closed is terminal;
 * Solved may be reopened. A same-status update is an idempotent no-op.
 * Migration imports may create a ticket in any valid status (historical data),
 * so this map applies to edits only.
 */
export const CRM3_TICKET_STATUS_TRANSITIONS: Readonly<
  Record<CRM3TicketStatus, readonly CRM3TicketStatus[]>
> = {
  New: ["Open"],
  Open: ["Waiting", "Solved"],
  Waiting: ["Open", "Solved"],
  Solved: ["Closed", "Open"],
  Closed: []
};

export function isTicketStatusTransitionAllowed(
  from: CRM3TicketStatus,
  to: CRM3TicketStatus
): boolean {
  if (from === to) return true;
  return CRM3_TICKET_STATUS_TRANSITIONS[from].includes(to);
}

export const CRM3EntityTypeSchema = z.enum(["ticket", "note"]);
export type CRM3EntityType = z.infer<typeof CRM3EntityTypeSchema>;

export const CRM3ImportStatusSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
  // Load halted on the 10% row-failure threshold (decision C9); committed rows are kept.
  "stopped_excessive_failures"
]);
export type CRM3ImportStatus = z.infer<typeof CRM3ImportStatusSchema>;

// Aliases matching root export style
export const TicketStatusSchema = CRM3TicketStatusSchema;
export const TicketPrioritySchema = CRM3TicketPrioritySchema;

// ---------------------------------------------------------------------------
// 2. Core Entities: Ticket & Note (FR-CRM3-01..05)
// ---------------------------------------------------------------------------

export const CRM3TicketSchema = z.object({
  id: z.string().uuid(),
  subject: z.string().min(1),
  status: CRM3TicketStatusSchema,
  priority: CRM3TicketPrioritySchema,
  contactId: z.string().uuid(),
  orderRef: z.string().nullable(),
  sourceSystem: z.string().nullable(),
  sourceId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type CRM3Ticket = z.infer<typeof CRM3TicketSchema>;

export const CRM3TicketReadSchema = CRM3TicketSchema.extend({
  contactName: z.string().nullable().optional(),
  contactEmail: z.string().email().nullable().optional()
});
export type CRM3TicketRead = z.infer<typeof CRM3TicketReadSchema>;

export const CRM3NoteSchema = z.object({
  id: z.string().uuid(),
  ticketId: z.string().uuid(),
  authorId: z.string().min(1),
  noteText: z.string().min(1),
  createdAt: z.string().datetime()
});
export type CRM3Note = z.infer<typeof CRM3NoteSchema>;

// ---------------------------------------------------------------------------
// 3. Request Payloads (Create / Patch)
// ---------------------------------------------------------------------------

export const CRM3TicketCreateSchema = z.object({
  subject: z.string().trim().min(1),
  status: CRM3TicketStatusSchema.default("New"),
  priority: CRM3TicketPrioritySchema.default("Normal"),
  contactId: z.string().uuid(),
  orderRef: z.string().trim().min(1).optional().nullable(),
  note: z.string().trim().min(1).optional(),
  sourceSystem: z.string().trim().min(1).optional().nullable(),
  sourceId: z.string().trim().min(1).optional().nullable()
}).strict();
export type CRM3TicketCreate = z.infer<typeof CRM3TicketCreateSchema>;

export const CRM3TicketPatchSchema = z.object({
  subject: z.string().trim().min(1).optional(),
  status: CRM3TicketStatusSchema.optional(),
  priority: CRM3TicketPrioritySchema.optional(),
  contactId: z.string().uuid().optional(),
  orderRef: z.string().trim().min(1).optional().nullable()
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: "At least one field must be provided for update"
});
export type CRM3TicketPatch = z.infer<typeof CRM3TicketPatchSchema>;

export const CRM3NoteCreateSchema = z.object({
  ticketId: z.string().uuid(),
  noteText: z.string().trim().min(1),
  authorId: z.string().trim().min(1).optional()
}).strict();
export type CRM3NoteCreate = z.infer<typeof CRM3NoteCreateSchema>;

// ---------------------------------------------------------------------------
// 4. Query & Pagination Schemas
// ---------------------------------------------------------------------------

export const CRM3TicketListQuerySchema = z.object({
  status: CRM3TicketStatusSchema.optional(),
  priority: CRM3TicketPrioritySchema.optional(),
  contactId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25)
});
export type CRM3TicketListQuery = z.infer<typeof CRM3TicketListQuerySchema>;

export const CRM3NoteListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25)
});
export type CRM3NoteListQuery = z.infer<typeof CRM3NoteListQuerySchema>;

export const CRM3ListResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative()
  });

export const CRM3TicketListResponseSchema = CRM3ListResponseSchema(CRM3TicketReadSchema);
export type CRM3TicketListResponse = z.infer<typeof CRM3TicketListResponseSchema>;

export const CRM3NoteListResponseSchema = CRM3ListResponseSchema(CRM3NoteSchema);
export type CRM3NoteListResponse = z.infer<typeof CRM3NoteListResponseSchema>;

// ---------------------------------------------------------------------------
// 5. Import Schemas (Migration Kit Integration)
// ---------------------------------------------------------------------------

export const CRM3ImportBatchSchema = z.object({
  id: z.string().uuid(),
  sourceSystem: z.string().min(1),
  status: CRM3ImportStatusSchema,
  idempotencyKey: z.string().nullable().optional(),
  requestHash: z.string().nullable().optional(),
  loadedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable()
});
export type CRM3ImportBatch = z.infer<typeof CRM3ImportBatchSchema>;

export const CRM3ImportReceiptSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().uuid(),
  sourceRow: z.number().int().positive(),
  entity: CRM3EntityTypeSchema,
  sourceSystem: z.string().min(1),
  sourceId: z.string().min(1),
  targetId: z.string().uuid(),
  idempotencyKey: z.string().min(1),
  createdAt: z.string().datetime()
});
export type CRM3ImportReceipt = z.infer<typeof CRM3ImportReceiptSchema>;

// ---------------------------------------------------------------------------
// 6. Security & Audit Schemas (Issue #34 / [CRM3-09])
// ---------------------------------------------------------------------------

export const CRM3AuditEventSchema = z.object({
  id: z.string().uuid(),
  actor: z.string().min(1),
  action: z.string().min(1),
  entity: z.string().min(1),
  entityId: z.string().uuid().nullable().optional(),
  batchId: z.string().nullable().optional(),
  result: z.enum(['success', 'failure', 'rejected', 'halted']),
  diffRedacted: z.record(z.string(), z.unknown()).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.coerce.date(),
});
export type CRM3AuditEvent = z.infer<typeof CRM3AuditEventSchema>;

export const CRM3ErrorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.array(z.unknown()).optional(),
  correlation_id: z.string().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.array(z.unknown()).optional(),
    })
    .optional(),
});
export type CRM3ErrorEnvelope = z.infer<typeof CRM3ErrorEnvelopeSchema>;
