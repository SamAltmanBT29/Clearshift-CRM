/**
 * @clearshift/contracts — CRM-4 Marketing Lists and Campaign History
 * SDS ClearShift CRM v2.0, V1: FR-CRM4-01..05; BR-CRM4-01
 *
 * Owned tables: crm4_lists, crm4_campaigns, crm4_members, crm4_consents
 * API base: /api/v1/crm-marketing
 */
import { z } from 'zod';
import { ClearShiftRoles, type RoleType } from './roles.js';

// ---------------------------------------------------------------------------
// 1. Enums & Domain Invariants (FR-CRM4-01..05, BR-CRM4-01)
// ---------------------------------------------------------------------------

export const CRM4_MEMBER_STATUSES = ['sent', 'opened', 'clicked'] as const;
export const CRM4MemberStatusSchema = z.enum(CRM4_MEMBER_STATUSES);
export type CRM4MemberStatus = z.infer<typeof CRM4MemberStatusSchema>;

export const CRM4_CONSENT_STATUSES = ['subscribed', 'unsubscribed'] as const;
export const CRM4ConsentStatusSchema = z.enum(CRM4_CONSENT_STATUSES);
export type CRM4ConsentStatus = z.infer<typeof CRM4ConsentStatusSchema>;

/**
 * Validates that member status is one of the strictly permitted values (sent, opened, clicked).
 */
export function assertValidMemberStatus(status: string): asserts status is CRM4MemberStatus {
  const result = CRM4MemberStatusSchema.safeParse(status);
  if (!result.success) {
    throw new Error(
      `Domain Invariant Violation: Member status '${status}' is not permitted. Permitted statuses are: ${CRM4_MEMBER_STATUSES.join(', ')}`
    );
  }
}

/**
 * Validates that consent status is one of the strictly permitted values (subscribed, unsubscribed).
 */
export function assertValidConsentStatus(status: string): asserts status is CRM4ConsentStatus {
  const result = CRM4ConsentStatusSchema.safeParse(status);
  if (!result.success) {
    throw new Error(
      `Domain Invariant Violation: Consent status '${status}' is not permitted. Permitted statuses are: ${CRM4_CONSENT_STATUSES.join(', ')}`
    );
  }
}

/**
 * Enforces BR-CRM4-01: A known opt-out / unsubscribe is strictly monotonic.
 * Import, update, or bulk action may NEVER overwrite a known no-consent/unsubscribed status with consent/subscribed.
 */
export function assertMonotonicOptOut(currentStatus: string | null | undefined, newStatus: string): void {
  if (currentStatus === 'unsubscribed' && newStatus === 'subscribed') {
    throw new Error(
      'Domain Invariant Violation (BR-CRM4-01): A known opt-out/unsubscribe is strictly monotonic and cannot be overwritten with consent.'
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Core Entities: Lists, Campaigns, Members, Consents
// ---------------------------------------------------------------------------

export const CRM4ListSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'List name cannot be empty').max(255, 'List name cannot exceed 255 characters'),
  description: z.string().nullable().optional(),
  campaignCount: z.number().int().nonnegative().default(0),
  memberCount: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CRM4List = z.infer<typeof CRM4ListSchema>;

export const CRM4CampaignSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Campaign name cannot be empty').max(255, 'Campaign name cannot exceed 255 characters'),
  campaignDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted YYYY-MM-DD'),
  listId: z.string().uuid(),
  listName: z.string().optional(),
  memberCount: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CRM4Campaign = z.infer<typeof CRM4CampaignSchema>;

export const CRM4MemberSchema = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  contactId: z.string().uuid(),
  status: CRM4MemberStatusSchema,
  unsubscribed: z.boolean().default(false),
  createdAt: z.string().datetime(),
});
export type CRM4Member = z.infer<typeof CRM4MemberSchema>;

export const CRM4ConsentSchema = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid(),
  status: CRM4ConsentStatusSchema,
  consentDate: z.string().datetime(),
  source: z.string().trim().min(1, 'Consent source cannot be empty'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CRM4Consent = z.infer<typeof CRM4ConsentSchema>;

// ---------------------------------------------------------------------------
// 3. Request Payloads (Create / Patch / Set)
// ---------------------------------------------------------------------------

export const CRM4ListCreateSchema = z.object({
  name: z.string().trim().min(1, 'List name is required').max(255, 'List name cannot exceed 255 characters'),
  description: z.string().trim().optional().nullable(),
}).strict();
export type CRM4ListCreate = z.infer<typeof CRM4ListCreateSchema>;

export const CRM4ListPatchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().optional().nullable(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update',
});
export type CRM4ListPatch = z.infer<typeof CRM4ListPatchSchema>;

export const CRM4CampaignCreateSchema = z.object({
  name: z.string().trim().min(1, 'Campaign name is required').max(255, 'Campaign name cannot exceed 255 characters'),
  campaignDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted YYYY-MM-DD'),
  listId: z.string().uuid('A valid marketing list must be selected'),
}).strict();
export type CRM4CampaignCreate = z.infer<typeof CRM4CampaignCreateSchema>;

export const CRM4CampaignPatchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  campaignDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update',
});
export type CRM4CampaignPatch = z.infer<typeof CRM4CampaignPatchSchema>;

export const CRM4MemberCreateSchema = z.object({
  campaignId: z.string().uuid(),
  contactId: z.string().uuid('A valid contact ID (UUID) is required'),
  status: CRM4MemberStatusSchema.default('sent'),
  unsubscribed: z.boolean().optional().default(false),
}).strict();
export type CRM4MemberCreate = z.infer<typeof CRM4MemberCreateSchema>;

export const CRM4MemberPatchSchema = z.object({
  status: CRM4MemberStatusSchema.optional(),
  unsubscribed: z.boolean().optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update',
});
export type CRM4MemberPatch = z.infer<typeof CRM4MemberPatchSchema>;

export const CRM4ConsentSetSchema = z.object({
  contactId: z.string().uuid('A valid contact ID (UUID) is required'),
  status: CRM4ConsentStatusSchema,
  consentDate: z.string().datetime().optional(),
  source: z.string().trim().min(1, 'Consent source is required'),
}).strict();
export type CRM4ConsentSet = z.infer<typeof CRM4ConsentSetSchema>;

// ---------------------------------------------------------------------------
// 4. Query & Pagination Schemas
// ---------------------------------------------------------------------------

export const CRM4PaginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalCount: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export type CRM4Pagination = z.infer<typeof CRM4PaginationSchema>;

export const CRM4ListQuerySchema = z.object({
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
export type CRM4ListQuery = z.infer<typeof CRM4ListQuerySchema>;

export const CRM4ListResponseSchema = z.object({
  items: z.array(CRM4ListSchema),
  pagination: CRM4PaginationSchema,
});
export type CRM4ListResponse = z.infer<typeof CRM4ListResponseSchema>;

export const CRM4CampaignQuerySchema = z.object({
  listId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
export type CRM4CampaignQuery = z.infer<typeof CRM4CampaignQuerySchema>;

export const CRM4CampaignListResponseSchema = z.object({
  items: z.array(CRM4CampaignSchema),
  pagination: CRM4PaginationSchema,
});
export type CRM4CampaignListResponse = z.infer<typeof CRM4CampaignListResponseSchema>;

export const CRM4MemberQuerySchema = z.object({
  campaignId: z.string().uuid().optional(),
  status: CRM4MemberStatusSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
export type CRM4MemberQuery = z.infer<typeof CRM4MemberQuerySchema>;

export const CRM4MemberListResponseSchema = z.object({
  items: z.array(CRM4MemberSchema),
  pagination: CRM4PaginationSchema,
});
export type CRM4MemberListResponse = z.infer<typeof CRM4MemberListResponseSchema>;

// ---------------------------------------------------------------------------
// 5. Route Prefix and Role Capability Matrix (SDS v2.0 §4 / §7.1)
// ---------------------------------------------------------------------------

export const CRM4_API_PREFIX = '/api/v1/crm-marketing' as const;

export const CRM4_ENDPOINT_ROLES = {
  LISTS_LIST: [ClearShiftRoles.VIEWER, ClearShiftRoles.EDITOR, ClearShiftRoles.ANALYST, ClearShiftRoles.ADMIN] as RoleType[],
  LISTS_READ: [ClearShiftRoles.VIEWER, ClearShiftRoles.EDITOR, ClearShiftRoles.ANALYST, ClearShiftRoles.ADMIN] as RoleType[],
  LISTS_CREATE: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN] as RoleType[],
  LISTS_UPDATE: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN] as RoleType[],

  CAMPAIGNS_LIST: [ClearShiftRoles.VIEWER, ClearShiftRoles.EDITOR, ClearShiftRoles.ANALYST, ClearShiftRoles.ADMIN] as RoleType[],
  CAMPAIGNS_READ: [ClearShiftRoles.VIEWER, ClearShiftRoles.EDITOR, ClearShiftRoles.ANALYST, ClearShiftRoles.ADMIN] as RoleType[],
  CAMPAIGNS_CREATE: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN] as RoleType[],
  CAMPAIGNS_UPDATE: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN] as RoleType[],

  MEMBERS_LIST: [ClearShiftRoles.VIEWER, ClearShiftRoles.EDITOR, ClearShiftRoles.ANALYST, ClearShiftRoles.ADMIN] as RoleType[],
  MEMBERS_CREATE: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN] as RoleType[],
  MEMBERS_UPDATE: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN] as RoleType[],

  CONSENTS_READ: [ClearShiftRoles.VIEWER, ClearShiftRoles.EDITOR, ClearShiftRoles.ANALYST, ClearShiftRoles.ADMIN] as RoleType[],
  CONSENTS_SET: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN] as RoleType[],
} as const;

export type CRM4EndpointKey = keyof typeof CRM4_ENDPOINT_ROLES;
