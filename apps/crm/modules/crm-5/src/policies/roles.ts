import { Roles, type RoleType } from '@cs/identity';
import { Capabilities, type CapabilityType, hasCapability } from '@cs/rbac';

/**
 * Exact Role Capability Matrix for CRM-5 Endpoints according to SDS ClearShift CRM v2.0 §4.8 & V1 Specs:
 * - GET  /runs: viewer, analyst, admin
 * - GET  /scores: analyst, admin
 * - GET  /rejects: analyst, admin
 * - GET  /reconciliation/:batch: analyst, admin
 * - GET  /batches/:batch: viewer, analyst, admin
 * - POST /runs: migration_runner, admin
 * - POST /scores: migration_runner, admin
 * - POST /reconciliation: migration_runner, admin
 * - POST /rejects: migration_runner, admin
 * - POST /duplicates/detect: analyst, migration_runner, admin
 * - GET  /duplicates/held: analyst, admin
 * - POST /duplicates/resolve: editor, analyst, admin
 * - GET  /duplicates/audit: analyst, admin
 * - POST /batches/execute-load: migration_runner, admin
 * - POST /import/row and /import: migration_runner, admin
 * - GET  /import/receipts: viewer, analyst, admin
 */
export const CRM5_ENDPOINT_ROLES = {
  RUNS_LIST: [Roles.VIEWER, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  SCORES_LIST: [Roles.ANALYST, Roles.ADMIN] as RoleType[],
  REJECTS_LIST: [Roles.ANALYST, Roles.ADMIN] as RoleType[],
  RECONCILIATION_READ: [Roles.ANALYST, Roles.ADMIN] as RoleType[],
  BATCH_SUMMARY: [Roles.VIEWER, Roles.ANALYST, Roles.ADMIN] as RoleType[],

  RUNS_CREATE: [Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],
  SCORES_CREATE: [Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],
  RECONCILIATION_CREATE: [Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],
  REJECTS_CREATE: [Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],

  DUPLICATES_DETECT: [Roles.ANALYST, Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],
  DUPLICATES_HELD: [Roles.ANALYST, Roles.ADMIN] as RoleType[],
  DUPLICATES_RESOLVE: [Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  DUPLICATES_AUDIT: [Roles.ANALYST, Roles.ADMIN] as RoleType[],

  BATCH_EXECUTE_LOAD: [Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],
  IMPORT_ROW: [Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],
  IMPORT_RECEIPTS: [Roles.VIEWER, Roles.ANALYST, Roles.ADMIN] as RoleType[],
} as const;

export type Crm5EndpointKey = keyof typeof CRM5_ENDPOINT_ROLES;

/**
 * Corresponding RBAC Capabilities for CRM-5 Endpoints per SDS Section 4.3.
 */
export const CRM5_ENDPOINT_CAPABILITIES: Record<Crm5EndpointKey, CapabilityType[]> = {
  RUNS_LIST: [Capabilities.CONTROL_READ, Capabilities.MODULE_READ],
  SCORES_LIST: [Capabilities.CONTROL_READ],
  REJECTS_LIST: [Capabilities.CONTROL_READ],
  RECONCILIATION_READ: [Capabilities.CONTROL_READ],
  BATCH_SUMMARY: [Capabilities.CONTROL_READ, Capabilities.MODULE_READ],

  RUNS_CREATE: [Capabilities.KIT_RUN, Capabilities.HUB_ADMIN],
  SCORES_CREATE: [Capabilities.KIT_RUN, Capabilities.HUB_ADMIN],
  RECONCILIATION_CREATE: [Capabilities.KIT_RUN, Capabilities.HUB_ADMIN],
  REJECTS_CREATE: [Capabilities.KIT_RUN, Capabilities.HUB_ADMIN],

  DUPLICATES_DETECT: [Capabilities.KIT_RUN, Capabilities.CONTROL_READ, Capabilities.KIT_ADMIN],
  DUPLICATES_HELD: [Capabilities.CONTROL_READ, Capabilities.KIT_ADMIN],
  DUPLICATES_RESOLVE: [Capabilities.KIT_REVIEW, Capabilities.KIT_ADMIN],
  DUPLICATES_AUDIT: [Capabilities.CONTROL_READ, Capabilities.KIT_ADMIN],

  BATCH_EXECUTE_LOAD: [Capabilities.KIT_RUN, Capabilities.KIT_ADMIN],
  IMPORT_ROW: [Capabilities.KIT_RUN, Capabilities.KIT_ADMIN],
  IMPORT_RECEIPTS: [Capabilities.CONTROL_READ, Capabilities.MODULE_READ],
};

/**
 * Checks if the user roles contain at least one of the allowed roles.
 * Admin role is universally permitted across all administrative actions.
 */
export function isRoleAllowed(userRoles: RoleType[] | undefined, allowedRoles: readonly RoleType[]): boolean {
  if (!userRoles || userRoles.length === 0) {
    return false;
  }
  if (userRoles.includes(Roles.ADMIN)) {
    return true;
  }
  return userRoles.some((role) => allowedRoles.includes(role));
}

/**
 * Checks if user roles satisfy the RBAC capability requirement for the given endpoint.
 */
export function isCapabilityAllowed(userRoles: RoleType[] | undefined, endpoint: Crm5EndpointKey): boolean {
  if (!userRoles || userRoles.length === 0) {
    return false;
  }
  if (userRoles.includes(Roles.ADMIN)) {
    return true;
  }
  const requiredCaps = CRM5_ENDPOINT_CAPABILITIES[endpoint];
  if (!requiredCaps || requiredCaps.length === 0) {
    return false;
  }
  return requiredCaps.some((cap) => hasCapability(userRoles, cap));
}
