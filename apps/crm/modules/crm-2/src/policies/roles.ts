import { Roles, type RoleType } from '@cs/identity';
import { Capabilities, type CapabilityType, hasCapability } from '@cs/rbac';

/**
 * Exact Role Capability Matrix for CRM-2 Endpoints according to SDS ClearShift CRM v2.0 §4 / §7.2:
 * - GET  /deals: viewer, editor, analyst, admin
 * - GET  /deals/:id: viewer, editor, analyst, admin
 * - POST /deals: editor, migration_runner, admin
 * - PATCH /deals/:id: editor, migration_runner, admin
 * - GET  /stages: viewer, editor, analyst, admin
 * - GET  /quotes: viewer, editor, analyst, admin
 * - GET  /quotes/:id: viewer, editor, analyst, admin
 * - POST /quotes: editor, migration_runner, admin
 * - PATCH /quotes/:id: editor, migration_runner, admin
 * - POST /import: migration_runner, admin
 * - GET  /import/receipts: viewer, analyst, admin
 */
export const CRM2_ENDPOINT_ROLES = {
  DEALS_LIST: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  DEALS_READ: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  DEALS_CREATE: [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],
  DEALS_UPDATE: [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],

  STAGES_LIST: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],

  QUOTES_LIST: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  QUOTES_READ: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  QUOTES_CREATE: [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],
  QUOTES_UPDATE: [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],

  IMPORT_WRITE: [Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],
  IMPORT_RECEIPTS: [Roles.VIEWER, Roles.ANALYST, Roles.ADMIN] as RoleType[],

  // Exact duplicate candidate review and audited merge decisions (CRM2-12 / KIT-10)
  DUPLICATES_DETECT: [Roles.ANALYST, Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],
  DUPLICATES_HELD: [Roles.VIEWER, Roles.ANALYST, Roles.EDITOR, Roles.ADMIN] as RoleType[],
  DUPLICATES_RESOLVE: [Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  DUPLICATES_AUDIT: [Roles.VIEWER, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  DEALS_EVALUATE: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  QUOTES_EVALUATE: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
} as const;

export type Crm2EndpointKey = keyof typeof CRM2_ENDPOINT_ROLES;

/**
 * Corresponding RBAC Capabilities for CRM-2 Endpoints per SDS Section 4.3.
 */
export const CRM2_ENDPOINT_CAPABILITIES: Record<Crm2EndpointKey, CapabilityType[]> = {
  DEALS_LIST: [Capabilities.MODULE_READ],
  DEALS_READ: [Capabilities.MODULE_READ],
  DEALS_CREATE: [Capabilities.MODULE_WRITE, Capabilities.KIT_RUN],
  DEALS_UPDATE: [Capabilities.MODULE_WRITE, Capabilities.KIT_RUN],

  STAGES_LIST: [Capabilities.MODULE_READ],

  QUOTES_LIST: [Capabilities.MODULE_READ],
  QUOTES_READ: [Capabilities.MODULE_READ],
  QUOTES_CREATE: [Capabilities.MODULE_WRITE, Capabilities.KIT_RUN],
  QUOTES_UPDATE: [Capabilities.MODULE_WRITE, Capabilities.KIT_RUN],

  IMPORT_WRITE: [Capabilities.KIT_RUN, Capabilities.KIT_ADMIN],
  IMPORT_RECEIPTS: [Capabilities.MODULE_READ, Capabilities.CONTROL_READ],

  DUPLICATES_DETECT: [Capabilities.CONTROL_READ, Capabilities.KIT_RUN, Capabilities.KIT_ADMIN],
  DUPLICATES_HELD: [Capabilities.MODULE_READ, Capabilities.CONTROL_READ],
  DUPLICATES_RESOLVE: [Capabilities.KIT_REVIEW, Capabilities.KIT_ADMIN],
  DUPLICATES_AUDIT: [Capabilities.MODULE_READ, Capabilities.CONTROL_READ],
  DEALS_EVALUATE: [Capabilities.MODULE_READ],
  QUOTES_EVALUATE: [Capabilities.MODULE_READ],
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
export function isCapabilityAllowed(userRoles: RoleType[] | undefined, endpoint: Crm2EndpointKey): boolean {
  if (!userRoles || userRoles.length === 0) {
    return false;
  }
  if (userRoles.includes(Roles.ADMIN)) {
    return true;
  }
  const requiredCaps = CRM2_ENDPOINT_CAPABILITIES[endpoint];
  if (!requiredCaps || requiredCaps.length === 0) {
    return false;
  }
  return requiredCaps.some((cap) => hasCapability(userRoles, cap));
}

