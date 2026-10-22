import { z } from 'zod';
import { HttpStatusCodes, StandardErrorCodes } from './common.js';

/**
 * [PLT-06] Central Role & Field-Level Authorization Matrix
 *
 * Traceability:
 * - ClearShift Project Plan v3.0 §§9.3-9.6, 17
 * - SDS ClearShift CRM v2.0 §4 / §7.1
 * - SDS ClearShift Migration Kit v2.0 §4 / §7.1
 * - ClearShift V1 Master Architecture Spec §4.2 (RBAC Capability Matrix)
 */

/**
 * Standard ClearShift V1 Roles.
 * Role matrix is fixed across all modules and platform services.
 */
export const ClearShiftRoles = {
  VIEWER: 'viewer',
  EDITOR: 'editor',
  MIGRATION_RUNNER: 'migration_runner',
  ANALYST: 'analyst',
  ADMIN: 'admin',
} as const;

export const Roles = ClearShiftRoles;

export type ClearShiftRole = (typeof ClearShiftRoles)[keyof typeof ClearShiftRoles];
export type RoleType = ClearShiftRole;

export const ALL_ROLES: readonly RoleType[] = [
  ClearShiftRoles.VIEWER,
  ClearShiftRoles.EDITOR,
  ClearShiftRoles.MIGRATION_RUNNER,
  ClearShiftRoles.ANALYST,
  ClearShiftRoles.ADMIN,
] as const;

export const RoleSchema = z.enum([
  ClearShiftRoles.VIEWER,
  ClearShiftRoles.EDITOR,
  ClearShiftRoles.MIGRATION_RUNNER,
  ClearShiftRoles.ANALYST,
  ClearShiftRoles.ADMIN,
]);

/**
 * Standard ClearShift Actions.
 */
export const ClearShiftActions = {
  READ: 'read',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  BULK_LOAD: 'bulk_load',
  APPROVE: 'approve',
  ADMIN: 'admin',
  EXPORT: 'export',
} as const;

export type ActionType = (typeof ClearShiftActions)[keyof typeof ClearShiftActions];

/**
 * Field-level Data Sensitivity Classifications.
 * Governs server-side masking before JSON serialization and export.
 */
export const FieldSensitivity = {
  PUBLIC: 'PUBLIC',
  PROTECTED: 'PROTECTED',
  SENSITIVE_FINANCIAL: 'SENSITIVE_FINANCIAL', // salary, wage, compensation
  SENSITIVE_PII: 'SENSITIVE_PII',             // bank details, government identifiers, SSN, tax ID
  SECRET: 'SECRET',                           // credentials, passwords, tokens, API keys
} as const;

export type FieldSensitivityLevel = (typeof FieldSensitivity)[keyof typeof FieldSensitivity];

/**
 * Route Permission Policy Specification.
 */
export interface RoutePermissionPolicy {
  /**
   * Route path identifier or pattern (e.g., '/api/v1/crm-contacts/contacts')
   */
  path: string;
  /**
   * HTTP method or 'ALL'
   */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'ALL';
  /**
   * If true, route is public and requires no authentication.
   * Default: false (Default Deny).
   */
  isPublic?: boolean;
  /**
   * Explicit roles allowed to access this route.
   * If undefined/empty and not isPublic, access is denied to everyone (Default Deny).
   */
  allowedRoles?: readonly RoleType[];
  /**
   * Specific business capability required (e.g., 'module.read', 'kit.run')
   */
  capability?: string;
  /**
   * Whether this endpoint is a merge or skip decision requiring approval separation
   * (Migration Runner is prohibited from self-approving).
   */
  isApprovalDecision?: boolean;
  /**
   * Whether this endpoint is a bulk load endpoint (Migration Runner only).
   */
  isBulkLoad?: boolean;
  /**
   * Human-readable description
   */
  description?: string;
}

/**
 * Central Route Group Identifiers.
 */
export const RouteGroups = {
  HUB_AUTH: 'hub.auth',
  HUB_JWKS: 'hub.jwks',
  HUB_HEALTH: 'hub.health',
  HUB_IDENTITY_MAP: 'hub.id_map',
  HUB_ADMIN: 'hub.admin',
  CRM_CONTACTS_READ: 'crm.contacts.read',
  CRM_CONTACTS_WRITE: 'crm.contacts.write',
  CRM_COMPANIES_READ: 'crm.companies.read',
  CRM_COMPANIES_WRITE: 'crm.companies.write',
  CRM_LEADS_READ: 'crm.leads.read',
  CRM_LEADS_WRITE: 'crm.leads.write',
  CRM_REPORTS_READ: 'crm.reports.read',
  ERP_PRODUCTS_READ: 'erp.products.read',
  ERP_PRODUCTS_WRITE: 'erp.products.write',
  ERP_VENDORS_READ: 'erp.vendors.read',
  ERP_VENDORS_WRITE: 'erp.vendors.write',
  ERP_INVOICES_READ: 'erp.invoices.read',
  ERP_INVOICES_WRITE: 'erp.invoices.write',
  ERP_FINANCE_REPORTS: 'erp.finance.reports',
  ERP_FINANCE_JOURNAL: 'erp.finance.journal',
  ERP_FINANCE_BULK_OPENING: 'erp.finance.bulk_opening',
  ERP_HR_EMPLOYEES_READ: 'erp.hr.employees.read',
  ERP_HR_EMPLOYEES_WRITE: 'erp.hr.employees.write',
  ERP_HR_PAYROLL_BULK: 'erp.hr.payroll.bulk',
  KIT_PIPELINE_READ: 'kit.pipeline.read',
  KIT_PIPELINE_RUN: 'kit.pipeline.run',
  KIT_BULK_LOAD: 'kit.bulk_load',
  KIT_MERGE_SKIP_APPROVAL: 'kit.merge_skip_approval',
  KIT_ADMIN: 'kit.admin',
} as const;

/**
 * Master Role Capability Definition:
 * Central matrix encoding non-negotiable rules from Project Plan v3.0 §§9.3-9.6, 17:
 * - Viewer: reads business records/reports only where SDS permits;
 * - Editor: creates/edits business records;
 * - Migration Runner: may execute import/load and opening-balance/payroll-total bulk endpoints
 *   but not approve its own merge/skip decisions;
 * - Analyst: reads quality/control-center, trial-balance, and CRM-5 dashboards/reports;
 * - Admin: administrative route rights but does not bypass field-level masking.
 */
export const CENTRAL_ROLE_CAPABILITY_MATRIX: Record<
  string,
  {
    description: string;
    allowedRoles: readonly RoleType[];
    isPublic?: boolean;
    isApprovalDecision?: boolean;
    isBulkLoad?: boolean;
  }
> = {
  // Public Hub & Health Endpoints
  [RouteGroups.HUB_AUTH]: {
    description: 'Hub user authentication / login',
    allowedRoles: ALL_ROLES,
    isPublic: true,
  },
  [RouteGroups.HUB_JWKS]: {
    description: 'EdDSA JWKS public key verification endpoint',
    allowedRoles: ALL_ROLES,
    isPublic: true,
  },
  [RouteGroups.HUB_HEALTH]: {
    description: 'Health liveness and readiness probes',
    allowedRoles: ALL_ROLES,
    isPublic: true,
  },

  // Hub Protected Endpoints
  [RouteGroups.HUB_IDENTITY_MAP]: {
    description: 'Golden ID lookup and idempotent upsert',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.MIGRATION_RUNNER,
      ClearShiftRoles.ADMIN,
    ],
  },
  [RouteGroups.HUB_ADMIN]: {
    description: 'Administrative token generation and credential management',
    allowedRoles: [ClearShiftRoles.ADMIN],
  },

  // CRM Read Endpoints (Viewer, Editor, Analyst, Admin)
  [RouteGroups.CRM_CONTACTS_READ]: {
    description: 'Read CRM contacts list and details',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ANALYST,
      ClearShiftRoles.ADMIN,
    ],
  },
  [RouteGroups.CRM_COMPANIES_READ]: {
    description: 'Read CRM companies list and details',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ADMIN,
    ],
  },
  [RouteGroups.CRM_LEADS_READ]: {
    description: 'Read CRM leads list and details',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ADMIN,
    ],
  },
  [RouteGroups.CRM_REPORTS_READ]: {
    description: 'Read CRM-5 reports, profiling analytics, and dashboards',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.ANALYST,
      ClearShiftRoles.ADMIN,
    ],
  },

  // CRM Write / Patch Endpoints (Editor, Admin - CRUD PATCH inherits resource Editor roles)
  [RouteGroups.CRM_CONTACTS_WRITE]: {
    description: 'Create or update contacts',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
  },
  [RouteGroups.CRM_COMPANIES_WRITE]: {
    description: 'Create or update companies',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
  },
  [RouteGroups.CRM_LEADS_WRITE]: {
    description: 'Create or update leads',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
  },

  // ERP Read Endpoints
  [RouteGroups.ERP_PRODUCTS_READ]: {
    description: 'Read ERP-1 products and inventory',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ADMIN,
    ],
  },
  [RouteGroups.ERP_VENDORS_READ]: {
    description: 'Read ERP-2 vendors and bills',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ADMIN,
    ],
  },
  [RouteGroups.ERP_INVOICES_READ]: {
    description: 'Read ERP-3 invoices and payments',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ADMIN,
    ],
  },
  [RouteGroups.ERP_FINANCE_REPORTS]: {
    description: 'Read ERP-4 trial-balance, ledger, and financial reports',
    allowedRoles: [
      ClearShiftRoles.ANALYST,
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.ADMIN,
    ],
  },
  [RouteGroups.ERP_HR_EMPLOYEES_READ]: {
    description: 'Read ERP-5 employees list and departments',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ADMIN,
    ],
  },

  // ERP Domain Mutations (Editor, Admin)
  [RouteGroups.ERP_PRODUCTS_WRITE]: {
    description: 'Create or edit ERP products',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
  },
  [RouteGroups.ERP_VENDORS_WRITE]: {
    description: 'Create or edit ERP vendors',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
  },
  [RouteGroups.ERP_INVOICES_WRITE]: {
    description: 'Create or edit ERP invoices',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
  },
  [RouteGroups.ERP_FINANCE_JOURNAL]: {
    description: 'Post balanced journal entry',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
  },
  [RouteGroups.ERP_HR_EMPLOYEES_WRITE]: {
    description: 'Create or edit ERP employee records',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
  },

  // Bulk Load Routes (Migration Runner only)
  [RouteGroups.KIT_BULK_LOAD]: {
    description: 'Execute Migration Kit bulk load step into target module',
    allowedRoles: [ClearShiftRoles.MIGRATION_RUNNER],
    isBulkLoad: true,
  },
  [RouteGroups.ERP_FINANCE_BULK_OPENING]: {
    description: 'Bulk load opening balance financial figures',
    allowedRoles: [ClearShiftRoles.MIGRATION_RUNNER],
    isBulkLoad: true,
  },
  [RouteGroups.ERP_HR_PAYROLL_BULK]: {
    description: 'Bulk load payroll totals',
    allowedRoles: [ClearShiftRoles.MIGRATION_RUNNER],
    isBulkLoad: true,
  },

  // Migration Kit Operations
  [RouteGroups.KIT_PIPELINE_READ]: {
    description: 'Read migration batches, logs, profiling, and reconciliation status',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.MIGRATION_RUNNER,
      ClearShiftRoles.ANALYST,
      ClearShiftRoles.ADMIN,
    ],
  },
  [RouteGroups.KIT_PIPELINE_RUN]: {
    description: 'Execute pipeline extract, clean, map, and dry-run steps',
    allowedRoles: [ClearShiftRoles.MIGRATION_RUNNER, ClearShiftRoles.ADMIN],
  },
  [RouteGroups.KIT_MERGE_SKIP_APPROVAL]: {
    description: 'Approve or reject candidate merge / skip decisions (Migration Runner cannot self-approve)',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    isApprovalDecision: true,
  },
  [RouteGroups.KIT_ADMIN]: {
    description: 'Administer cleaning rules and mapping templates',
    allowedRoles: [ClearShiftRoles.ADMIN],
  },
};

/**
 * Standard Deny Codes.
 */
export const DenyCodes = {
  UNAUTHENTICATED: StandardErrorCodes.UNAUTHENTICATED,
  FORBIDDEN: StandardErrorCodes.FORBIDDEN,
  SELF_APPROVAL_FORBIDDEN: 'SELF_APPROVAL_FORBIDDEN',
  DEFAULT_DENY: 'DEFAULT_DENY',
} as const;

export type DenyCode = (typeof DenyCodes)[keyof typeof DenyCodes];

/**
 * Checks if user's role set grants access to the specified allowed roles.
 * Default is deny: returns false if userRoles is undefined, empty, or has no intersection.
 */
export function isUserRoleAllowed(
  userRoles: readonly RoleType[] | undefined,
  allowedRoles: readonly RoleType[]
): boolean {
  if (!userRoles || userRoles.length === 0) {
    return false;
  }
  return userRoles.some((role) => allowedRoles.includes(role));
}

/**
 * Normalizes a URL path for parameterized matching.
 * e.g., '/api/v1/crm-contacts/contacts/123e4567-e89b-12d3-a456-426614174000' -> '/api/v1/crm-contacts/contacts/:id'
 */
export function normalizePathPattern(path: string): string {
  const clean = path.split('?')[0] ?? path;
  return clean
    .replace(/\/batches\/[0-9a-fA-F-]{36}/g, '/batches/:id')
    .replace(/\/imports\/[0-9a-fA-F-]{36}/g, '/imports/:batch')
    .replace(/\/[0-9a-fA-F-]{36}/g, '/:id');
}

/**
 * Central Route Policies covering all standard ClearShift endpoints.
 */
export const CENTRAL_ROUTE_POLICIES: readonly RoutePermissionPolicy[] = [
  // Hub
  {
    path: '/api/v1/hub/auth/login',
    method: 'POST',
    isPublic: true,
    description: 'Hub user login',
  },
  {
    path: '/api/v1/hub/.well-known/jwks.json',
    method: 'GET',
    isPublic: true,
    description: 'EdDSA JWKS public key set endpoint',
  },
  {
    path: '/api/v1/hub/health/live',
    method: 'GET',
    isPublic: true,
    description: 'Liveness probe',
  },
  {
    path: '/api/v1/hub/health/ready',
    method: 'GET',
    isPublic: true,
    description: 'Readiness probe',
  },
  {
    path: '/api/v1/hub/id-map',
    method: 'POST',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.MIGRATION_RUNNER,
      ClearShiftRoles.ADMIN,
    ],
    description: 'Idempotent source identity upsert',
  },
  {
    path: '/api/v1/hub/id-map',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.MIGRATION_RUNNER,
      ClearShiftRoles.ADMIN,
    ],
    description: 'Lookup source identity by GID or source ID',
  },
  {
    path: '/api/v1/hub/id-map/evidence',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ANALYST,
      ClearShiftRoles.ADMIN,
    ],
    description: 'Resolve Golden ID evidence graph',
  },
  {
    path: '/api/v1/hub/id-map/merge',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.ADMIN],
    isApprovalDecision: true,
    description: 'Admin approval for human Golden ID merge',
  },
  {
    path: '/api/v1/hub/admin/service-tokens',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.ADMIN],
    description: 'Issue scoped service account tokens',
  },
  {
    path: '/api/v1/hub/admin/audit-logs',
    method: 'GET',
    allowedRoles: [ClearShiftRoles.ADMIN],
    description: 'Query append-only audit trail logs',
  },

  // CRM
  {
    path: '/api/v1/crm-contacts/contacts',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ANALYST,
      ClearShiftRoles.ADMIN,
    ],
    description: 'List CRM contacts',
  },
  {
    path: '/api/v1/crm-contacts/contacts/:id',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ANALYST,
      ClearShiftRoles.ADMIN,
    ],
    description: 'Get CRM contact by ID',
  },
  {
    path: '/api/v1/crm-contacts/contacts',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    description: 'Create contact record',
  },
  {
    path: '/api/v1/crm-contacts/contacts/:id',
    method: 'PATCH',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    description: 'Update contact record',
  },
  {
    path: '/api/v1/crm-contacts/companies',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ADMIN,
    ],
    description: 'List CRM companies',
  },
  {
    path: '/api/v1/crm-contacts/companies/:id',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ADMIN,
    ],
    description: 'Get CRM company by ID',
  },
  {
    path: '/api/v1/crm-contacts/companies',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    description: 'Create company record',
  },
  {
    path: '/api/v1/crm-contacts/companies/:id',
    method: 'PATCH',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    description: 'Update company record',
  },
  {
    path: '/api/v1/crm-contacts/leads',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ADMIN,
    ],
    description: 'List CRM leads',
  },
  {
    path: '/api/v1/crm-contacts/leads/:id',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ADMIN,
    ],
    description: 'Get CRM lead by ID',
  },
  {
    path: '/api/v1/crm-contacts/leads',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    description: 'Create lead record',
  },
  {
    path: '/api/v1/crm-contacts/leads/:id',
    method: 'PATCH',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    description: 'Update lead record',
  },
  {
    path: '/api/v1/crm-contacts/reports',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.ANALYST,
      ClearShiftRoles.ADMIN,
    ],
    description: 'CRM-5 analytics and profiling dashboard reports',
  },
  {
    path: '/api/v1/crm-contacts/imports',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.MIGRATION_RUNNER],
    isBulkLoad: true,
    description: 'CRM-1 direct batch load ingestion (Migration Runner only)',
  },
  {
    path: '/api/v1/crm-contacts/imports/:batch',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.ANALYST,
      ClearShiftRoles.ADMIN,
    ],
    description: 'Check batch execution status and committed receipts',
  },
  {
    path: '/api/v1/crm-contacts/imports/:batch/rejects',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.ANALYST,
      ClearShiftRoles.ADMIN,
    ],
    description: 'Retrieve paginated rejected rows for review',
  },

  // ERP
  {
    path: '/api/v1/erp-inventory/products',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ADMIN,
    ],
    description: 'Read ERP-1 products and inventory levels',
  },
  {
    path: '/api/v1/erp-inventory/products',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    description: 'Create ERP-1 product',
  },
  {
    path: '/api/v1/erp-inventory/products/:id',
    method: 'PATCH',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    description: 'Update ERP-1 product',
  },
  {
    path: '/api/v1/erp-finance/vendors',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ADMIN,
    ],
    description: 'Read ERP-2 vendors',
  },
  {
    path: '/api/v1/erp-finance/vendors',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    description: 'Create ERP-2 vendor',
  },
  {
    path: '/api/v1/erp-finance/vendors/:id',
    method: 'PATCH',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    description: 'Update ERP-2 vendor',
  },
  {
    path: '/api/v1/erp-finance/invoices',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ADMIN,
    ],
    description: 'Read ERP-3 invoices',
  },
  {
    path: '/api/v1/erp-finance/invoices',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    description: 'Create ERP-3 invoice',
  },
  {
    path: '/api/v1/erp-finance/invoices/:id',
    method: 'PATCH',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    description: 'Update ERP-3 invoice',
  },
  {
    path: '/api/v1/erp-finance/journal',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.ANALYST,
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.ADMIN,
    ],
    description: 'Read posted journal entries',
  },
  {
    path: '/api/v1/erp-finance/journal',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    description: 'Post atomic balanced journal entry (ERP-4)',
  },
  {
    path: '/api/v1/erp-finance/trial-balance',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.ANALYST,
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.ADMIN,
    ],
    description: 'Read trial-balance and general ledger reports',
  },
  {
    path: '/api/v1/erp-finance/opening-balances/bulk',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.MIGRATION_RUNNER],
    isBulkLoad: true,
    description: 'Bulk load opening balance financial figures (Migration Runner only)',
  },
  {
    path: '/api/v1/erp-hr/employees',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ADMIN,
    ],
    description: 'List employees with field-level masking applied',
  },
  {
    path: '/api/v1/erp-hr/employees/:id',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ADMIN,
    ],
    description: 'Get employee details with field-level masking applied',
  },
  {
    path: '/api/v1/erp-hr/employees',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    description: 'Create employee record',
  },
  {
    path: '/api/v1/erp-hr/employees/:id',
    method: 'PATCH',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    description: 'Update employee record',
  },
  {
    path: '/api/v1/erp-hr/departments',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.ADMIN,
    ],
    description: 'List HR departments',
  },
  {
    path: '/api/v1/erp-hr/payroll-totals/bulk',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.MIGRATION_RUNNER],
    isBulkLoad: true,
    description: 'Bulk load payroll totals (Migration Runner only)',
  },

  // Migration Kit
  {
    path: '/api/v1/migration-kit/batches',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.MIGRATION_RUNNER,
      ClearShiftRoles.ANALYST,
      ClearShiftRoles.ADMIN,
    ],
    description: 'List migration batches and state machine ledgers',
  },
  {
    path: '/api/v1/migration-kit/batches',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.MIGRATION_RUNNER, ClearShiftRoles.ADMIN],
    description: 'Create migration batch and stream source file upload',
  },
  {
    path: '/api/v1/migration-kit/batches/:id',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.EDITOR,
      ClearShiftRoles.MIGRATION_RUNNER,
      ClearShiftRoles.ANALYST,
      ClearShiftRoles.ADMIN,
    ],
    description: 'Get batch state and step counts',
  },
  {
    path: '/api/v1/migration-kit/batches/:id/profile',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.MIGRATION_RUNNER, ClearShiftRoles.ADMIN],
    description: 'Execute Step 2 profiling',
  },
  {
    path: '/api/v1/migration-kit/batches/:id/clean',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.MIGRATION_RUNNER, ClearShiftRoles.ADMIN],
    description: 'Execute Step 3 cleaning rule pipeline',
  },
  {
    path: '/api/v1/migration-kit/batches/:id/map',
    method: 'GET',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    description: 'Get field mapping template configuration',
  },
  {
    path: '/api/v1/migration-kit/batches/:id/map',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    description: 'Save field mapping template',
  },
  {
    path: '/api/v1/migration-kit/batches/:id/dry-run',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.MIGRATION_RUNNER, ClearShiftRoles.ADMIN],
    description: 'Execute dry run without database mutation',
  },
  {
    path: '/api/v1/migration-kit/batches/:id/load',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.MIGRATION_RUNNER],
    isBulkLoad: true,
    description: 'Execute Step 5 target database bulk load (Migration Runner only)',
  },
  {
    path: '/api/v1/migration-kit/batches/:id/reconcile',
    method: 'GET',
    allowedRoles: [
      ClearShiftRoles.VIEWER,
      ClearShiftRoles.ANALYST,
      ClearShiftRoles.ADMIN,
    ],
    description: 'Verify 4-term reconciliation equation (source = loaded + rejected + merged + skipped)',
  },
  {
    path: '/api/v1/migration-kit/batches/:id/merge',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    isApprovalDecision: true,
    description: 'Approve duplicate merge candidate (Migration Runner CANNOT approve)',
  },
  {
    path: '/api/v1/migration-kit/batches/:id/skip',
    method: 'POST',
    allowedRoles: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
    isApprovalDecision: true,
    description: 'Approve skip record candidate with reason (Migration Runner CANNOT approve)',
  },
];

/**
 * Finds a matching RoutePermissionPolicy for a given HTTP method and path.
 */
export function findRoutePolicy(
  method: string,
  rawPath: string
): RoutePermissionPolicy | undefined {
  const normalized = normalizePathPattern(rawPath);
  return CENTRAL_ROUTE_POLICIES.find(
    (p) =>
      (p.method === method.toUpperCase() || p.method === 'ALL') &&
      (p.path === normalized || p.path === rawPath)
  );
}
