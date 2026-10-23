import { Roles, type RoleType } from '@cs/identity';

/**
 * Exact Role Capability Matrix for CRM-4 Endpoints according to SDS ClearShift CRM v2.0 §4 / §7.1:
 * - GET   /lists: viewer, editor, analyst, admin
 * - POST  /lists: editor, admin
 * - GET   /lists/:id: viewer, editor, analyst, admin
 * - PATCH /lists/:id: editor, admin
 * - GET   /campaigns: viewer, editor, analyst, admin
 * - POST  /campaigns: editor, admin
 * - GET   /campaigns/:id: viewer, editor, analyst, admin
 * - PATCH /campaigns/:id: editor, admin
 * - GET   /campaigns/:id/members: viewer, editor, analyst, admin
 * - POST  /campaigns/:id/members: editor, admin
 * - GET   /consents/:contact: viewer, editor, analyst, admin
 * - POST  /consents: editor, admin
 */
export const CRM4_ENDPOINT_ROLES = {
  LISTS_LIST: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  LISTS_READ: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  LISTS_CREATE: [Roles.EDITOR, Roles.ADMIN] as RoleType[],
  LISTS_UPDATE: [Roles.EDITOR, Roles.ADMIN] as RoleType[],

  CAMPAIGNS_LIST: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  CAMPAIGNS_READ: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  CAMPAIGNS_CREATE: [Roles.EDITOR, Roles.ADMIN] as RoleType[],
  CAMPAIGNS_UPDATE: [Roles.EDITOR, Roles.ADMIN] as RoleType[],

  MEMBERS_LIST: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  MEMBERS_CREATE: [Roles.EDITOR, Roles.ADMIN] as RoleType[],
  MEMBERS_UPDATE: [Roles.EDITOR, Roles.ADMIN] as RoleType[],

  CONSENTS_READ: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  CONSENTS_SET: [Roles.EDITOR, Roles.ADMIN] as RoleType[],

  MAPPINGS_READ: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  MAPPINGS_EXECUTE: [Roles.EDITOR, Roles.ADMIN] as RoleType[],
} as const;

export type Crm4EndpointKey = keyof typeof CRM4_ENDPOINT_ROLES;

/**
 * Checks if the user roles contain at least one of the allowed roles.
 * Admin role possesses universal override authority across all administrative actions.
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
