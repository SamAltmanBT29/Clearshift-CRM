import { Roles, type RoleType } from '@cs/identity';

/**
 * Exact Role Capability Matrix for CRM-1 Endpoints according to SDS ClearShift CRM v2.0 §4 / §7.1:
 * - GET  /contacts: viewer, editor, analyst, admin
 * - POST /contacts: editor, migration_runner, admin
 * - PATCH /contacts/:id: editor, migration_runner, admin
 * - GET  /companies: viewer, editor, admin
 * - POST /companies: editor, migration_runner, admin
 * - PATCH /companies/:id: editor, migration_runner, admin
 * - GET  /leads: viewer, editor, admin
 * - POST /leads: editor, migration_runner, admin
 * - PATCH /leads/:id: editor, migration_runner, admin
 * - POST /imports: migration_runner, admin
 * - GET  /imports/:batch: viewer, analyst, admin
 * - GET  /imports/:batch/rejects: viewer, analyst, admin
 */
export const CRM1_ENDPOINT_ROLES = {
  CONTACTS_LIST: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  CONTACTS_READ: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  CONTACTS_CREATE: [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],
  CONTACTS_UPDATE: [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],

  COMPANIES_LIST: [Roles.VIEWER, Roles.EDITOR, Roles.ADMIN] as RoleType[],
  COMPANIES_READ: [Roles.VIEWER, Roles.EDITOR, Roles.ADMIN] as RoleType[],
  COMPANIES_CREATE: [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],
  COMPANIES_UPDATE: [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],

  LEADS_LIST: [Roles.VIEWER, Roles.EDITOR, Roles.ADMIN] as RoleType[],
  LEADS_READ: [Roles.VIEWER, Roles.EDITOR, Roles.ADMIN] as RoleType[],
  LEADS_CREATE: [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],
  LEADS_UPDATE: [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],

  IMPORTS_START: [Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],
  IMPORTS_STATUS: [Roles.VIEWER, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  IMPORTS_REJECTS: [Roles.VIEWER, Roles.ANALYST, Roles.ADMIN] as RoleType[],

  DUPLICATES_DETECT: [Roles.ANALYST, Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],
  DUPLICATES_HELD: [Roles.VIEWER, Roles.ANALYST, Roles.EDITOR, Roles.ADMIN] as RoleType[],
  DUPLICATES_RESOLVE: [Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  DUPLICATES_AUDIT: [Roles.VIEWER, Roles.ANALYST, Roles.ADMIN] as RoleType[],
} as const;

export type Crm1EndpointKey = keyof typeof CRM1_ENDPOINT_ROLES;

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
