import type { FastifyRequest } from 'fastify';
import { Roles, type RoleType, type HubTokenClaims } from '@cs/identity';
import { AppError } from '@cs/kernel';

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
 * Standard RBAC capabilities for CRM-3 endpoints.
 */
export const CRM3_ENDPOINT_CAPABILITIES = {
  TICKETS_LIST: 'module.read',
  TICKETS_READ: 'module.read',
  TICKETS_CREATE: 'module.write',
  TICKETS_UPDATE: 'module.write',
  NOTES_LIST: 'module.read',
  NOTES_CREATE: 'module.write',
  IMPORTS_START: 'kit.run',
  IMPORTS_STATUS: 'kit.read',
} as const;

/**
 * List of system-managed or immutable ticket fields that non-admin callers cannot mutate directly.
 */
export const IMMUTABLE_MUTATION_FIELDS = [
  'id',
  'createdAt',
  'updatedAt',
  'sourceSystem',
  'sourceId',
] as const;

export interface AuthenticatedUser extends HubTokenClaims {
  disabled?: boolean | undefined;
  tenant_id?: string | undefined;
  tenantId?: string | undefined;
  org_id?: string | undefined;
  employee_id?: string | undefined;
}

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

/**
 * Extracts the tenant ID from token claims or request header.
 */
export function extractTenantId(
  user?: Partial<AuthenticatedUser>,
  req?: FastifyRequest
): string | undefined {
  if (user) {
    const fromUser = user.tenant_id || user.tenantId || user.org_id;
    if (fromUser) return fromUser;
  }
  if (req?.headers) {
    const fromHeader = req.headers['x-tenant-id'];
    if (typeof fromHeader === 'string' && fromHeader.trim().length > 0) {
      return fromHeader.trim();
    }
  }
  return undefined;
}

/**
 * Asserts multi-tenant isolation. Throws 403 FORBIDDEN if token tenant does not match resource tenant.
 */
export function assertTenantIsolation(
  user: AuthenticatedUser | undefined,
  resourceTenantId: string,
  _headerTenantId?: string
): void {
  if (!user) {
    throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
  }
  if (user.roles?.includes(Roles.ADMIN)) {
    return;
  }
  const userTenant = user.tenant_id || user.tenantId || user.org_id;
  if (userTenant && userTenant !== resourceTenantId) {
    throw new AppError(
      'FORBIDDEN',
      `Multi-tenant boundary violation: cross-tenant record mutation forbidden (user tenant: '${userTenant}', target tenant: '${resourceTenantId}')`,
      403
    );
  }
}

/**
 * Enforces cross-user record ownership.
 * Admin can operate across all records; regular users cannot mutate records owned by another author.
 */
export function assertRecordOwnership(
  user: AuthenticatedUser | undefined,
  recordOwnerId: string
): void {
  if (!user) {
    throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
  }
  if (user.roles?.includes(Roles.ADMIN)) {
    return;
  }
  const isOwner =
    user.sub === recordOwnerId ||
    user.employee_id === recordOwnerId;

  if (!isOwner) {
    throw new AppError(
      'FORBIDDEN',
      `unauthorized cross-user mutation: user '${user.sub}' is not permitted to mutate record owned by '${recordOwnerId}'`,
      403
    );
  }
}

/**
 * Blocks callers from modifying immutable fields in ticket updates.
 */
export function assertNoImmutableFieldMutation(
  user: AuthenticatedUser | undefined,
  patchPayload: Record<string, unknown>,
  _isUpdate = true
): void {
  if (user?.roles?.includes(Roles.ADMIN)) {
    return;
  }
  for (const field of IMMUTABLE_MUTATION_FIELDS) {
    if (field in patchPayload && patchPayload[field] !== undefined) {
      throw new AppError(
        'FORBIDDEN',
        `modification of immutable field '${field}' is strictly forbidden`,
        403
      );
    }
  }
}
