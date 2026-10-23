import { Roles, type RoleType } from '@cs/identity';

/**
 * Role matrix for CRM-3 endpoints (SDS ClearShift CRM v2.0 API table, Project Plan §7.3).
 * Admin passes every check. Roles, not @cs/rbac capabilities, are the source of truth here
 * because the SDS lets migration_runner create tickets without the module.write capability.
 * - GET   /tickets, /tickets/:id, /tickets/:id/notes: viewer, editor, analyst, admin
 * - POST  /tickets: editor, migration_runner, admin
 * - PATCH /tickets/:id: editor, admin
 * - POST  /notes, /tickets/:id/notes: editor, admin
 */
export const CRM3_ENDPOINT_ROLES = {
  TICKETS_LIST: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  TICKETS_READ: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  TICKETS_CREATE: [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],
  TICKETS_UPDATE: [Roles.EDITOR, Roles.ADMIN] as RoleType[],
  NOTES_LIST: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],
  NOTES_CREATE: [Roles.EDITOR, Roles.ADMIN] as RoleType[],
} as const;

export type Crm3EndpointKey = keyof typeof CRM3_ENDPOINT_ROLES;

/**
 * Checks if the user roles contain at least one of the allowed roles.
 * Admin is permitted everywhere; no roles means no access.
 */
export function isRoleAllowed(
  userRoles: readonly string[] | undefined,
  allowedRoles: readonly string[]
): boolean {
  if (!userRoles || userRoles.length === 0) {
    return false;
  }
  if (userRoles.includes(Roles.ADMIN)) {
    return true;
  }
  return userRoles.some((role) => allowedRoles.includes(role));
}
