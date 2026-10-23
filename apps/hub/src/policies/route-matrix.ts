import {
  ClearShiftRoles,
  type RoleType,
  type RoutePermissionPolicy,
} from '@clearshift/contracts';

/**
 * [PLT-06] Central Route Authorization Policy Registry
 *
 * Defines explicit permissions for all routes across ClearShift Monorepo.
 * Any route not explicitly registered or annotated is subject to DEFAULT DENY.
 */

export const CENTRAL_ROUTE_POLICIES: readonly RoutePermissionPolicy[] = [
  // ---------------------------------------------------------------------------
  // 1. Hub Identity & Platform Core
  // ---------------------------------------------------------------------------
  {
    path: '/api/v1/hub/auth/login',
    method: 'POST',
    isPublic: true,
    description: 'User login and token issuance (argon2id)',
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

  // ---------------------------------------------------------------------------
  // 2. CRM Modules (CRM-1 .. CRM-5)
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // 3. ERP Modules (ERP-1 .. ERP-5)
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // 4. Migration Kit Routes
  // ---------------------------------------------------------------------------
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
 * Normalizes a URL path for parameterized matching.
 * e.g., '/api/v1/crm-contacts/contacts/123e4567-e89b-12d3-a456-426614174000' -> '/api/v1/crm-contacts/contacts/:id'
 */
export function normalizePathPattern(path: string): string {
  // Strip query string
  const clean = path.split('?')[0] ?? path;
  return clean
    // Replace UUIDs with :id or :batch
    .replace(/\/batches\/[0-9a-fA-F-]{36}/g, '/batches/:id')
    .replace(/\/imports\/[0-9a-fA-F-]{36}/g, '/imports/:batch')
    .replace(/\/[0-9a-fA-F-]{36}/g, '/:id');
}

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
