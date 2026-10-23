import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { AppError } from '@cs/kernel';
import { Roles, type RoleType, type HubTokenClaims } from '@cs/identity';
import { Capabilities, type CapabilityType } from '@cs/rbac';
import { isRoleAllowed, CRM4_ENDPOINT_ROLES, type Crm4EndpointKey } from '../policies/roles.js';

/**
 * Extended token claims supporting multi-tenant isolation and user identity.
 */
export interface Crm4TokenClaims extends HubTokenClaims {
  tenant_id?: string;
  tenantId?: string;
  org_id?: string;
  disabled?: boolean;
}

/**
 * ClearShift Architecture Spec §4.2 RBAC Capability Mapping for CRM-4 Endpoints:
 * - Module Read (module.read): Lists, Campaigns, Members, Consents (List & Read)
 * - Module Write (module.write): Lists, Campaigns, Members, Consents (Create & Update)
 */
export const CRM4_ENDPOINT_CAPABILITIES: Record<Crm4EndpointKey, CapabilityType> = {
  LISTS_LIST: Capabilities.MODULE_READ,
  LISTS_READ: Capabilities.MODULE_READ,
  LISTS_CREATE: Capabilities.MODULE_WRITE,
  LISTS_UPDATE: Capabilities.MODULE_WRITE,

  CAMPAIGNS_LIST: Capabilities.MODULE_READ,
  CAMPAIGNS_READ: Capabilities.MODULE_READ,
  CAMPAIGNS_CREATE: Capabilities.MODULE_WRITE,
  CAMPAIGNS_UPDATE: Capabilities.MODULE_WRITE,

  MEMBERS_LIST: Capabilities.MODULE_READ,
  MEMBERS_CREATE: Capabilities.MODULE_WRITE,
  MEMBERS_UPDATE: Capabilities.MODULE_WRITE,

  CONSENTS_READ: Capabilities.MODULE_READ,
  CONSENTS_SET: Capabilities.MODULE_WRITE,

  MAPPINGS_READ: Capabilities.MODULE_READ,
  MAPPINGS_EXECUTE: Capabilities.MODULE_WRITE,
};

/**
 * Immutable domain fields that cannot be tampered with or overwritten by standard mutations.
 * In particular, campaign listId is IMMUTABLE after creation.
 */
export const IMMUTABLE_MUTATION_FIELDS = [
  'listId',
  'list_id',
  'createdAt',
  'created_at',
  'updatedAt',
  'updated_at',
  'campaignCount',
  'campaign_count',
  'memberCount',
  'member_count',
  'id',
] as const;

export interface ObjectAuthorizationContext {
  resourceType: 'list' | 'campaign' | 'member' | 'consent';
  resourceId?: string | undefined;
  resourceOwnerId?: string | undefined;
  resourceTenantId?: string | undefined;
  payload?: Record<string, unknown> | undefined;
  isUpdate?: boolean | undefined;
}

/**
 * Extracts normalized tenant ID from token claims or request headers.
 */
export function extractTenantId(
  user: Crm4TokenClaims | undefined,
  request?: FastifyRequest | undefined
): string | undefined {
  if (user) {
    if (user.tenant_id) return user.tenant_id;
    if (user.tenantId) return user.tenantId;
    if (user.org_id) return user.org_id;
  }
  if (request) {
    const headerTenant =
      request.headers['x-tenant-id'] ||
      request.headers['x-organization-id'] ||
      request.headers['x-org-id'];
    if (typeof headerTenant === 'string' && headerTenant.trim().length > 0) {
      return headerTenant.trim();
    }
  }
  return undefined;
}

/**
 * Object-level guard: Enforces multi-tenant isolation.
 * Prevents cross-tenant queries, mutations, or header-token tenant mismatches.
 */
export function assertTenantIsolation(
  user: Crm4TokenClaims,
  resourceTenantId?: string | undefined,
  request?: FastifyRequest | undefined
): void {
  // 1. Verify header tenant vs claim tenant consistency
  const tokenTenant = user.tenant_id || user.tenantId || user.org_id;
  if (request) {
    const headerTenant =
      (request.headers['x-tenant-id'] as string | undefined) ||
      (request.headers['x-organization-id'] as string | undefined) ||
      (request.headers['x-org-id'] as string | undefined);
    if (tokenTenant && headerTenant && tokenTenant !== headerTenant) {
      throw new AppError(
        'FORBIDDEN',
        `Multi-tenant boundary violation: token tenant '${tokenTenant}' does not match request tenant header '${headerTenant}'`,
        403
      );
    }
  }

  // 2. If resource is tagged with a tenant and caller has tenant context, ensure exact match
  if (tokenTenant && resourceTenantId && tokenTenant !== resourceTenantId) {
    throw new AppError(
      'FORBIDDEN',
      `Access denied: cross-tenant record mutation forbidden (caller: '${tokenTenant}', resource: '${resourceTenantId}')`,
      403
    );
  }
}

/**
 * Object-level guard: Enforces record ownership and prevents unauthorized cross-user mutations.
 * Administrators have universal override authority.
 */
export function assertRecordOwnership(
  user: Crm4TokenClaims,
  resourceOwnerId?: string | undefined
): void {
  if (user.roles && user.roles.includes(Roles.ADMIN)) {
    return;
  }

  if (resourceOwnerId) {
    const callerId = user.employee_id || user.sub;
    if (callerId && callerId !== resourceOwnerId) {
      throw new AppError(
        'FORBIDDEN',
        `Access denied: unauthorized cross-user mutation for record owned by '${resourceOwnerId}'`,
        403
      );
    }
  }
}

/**
 * Object-level guard: Prevents unauthorized modification of immutable fields.
 */
export function assertNoImmutableFieldMutation(
  user: Crm4TokenClaims,
  payload?: Record<string, unknown> | undefined,
  isUpdate = true
): void {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  if (user.roles && user.roles.includes(Roles.ADMIN)) {
    return;
  }

  if (isUpdate) {
    for (const field of IMMUTABLE_MUTATION_FIELDS) {
      if (field in payload && payload[field] !== undefined) {
        throw new AppError(
          'FORBIDDEN',
          `Access denied: modification of immutable field '${field}' is strictly prohibited`,
          403
        );
      }
    }
  }
}

/**
 * Options for configuring an endpoint's authorization policy.
 */
export interface EndpointAuthOptions {
  endpointKey: Crm4EndpointKey;
  requireObjectGuard?: boolean | undefined;
}

/**
 * Creates route preHandlers that enforce:
 * 1. Hub JWT signature & expiration validation (401 on failure)
 * 2. Active account verification (401 on disabled account)
 * 3. Role Capability Matrix enforcement per SDS ClearShift CRM v2.0 (403 on insufficient permissions)
 * 4. Multi-tenant header validation & cross-tenant prevention (403 on mismatch)
 */
export function createEndpointAuthPreHandlers(
  fastify: FastifyInstance,
  options: EndpointAuthOptions | Crm4EndpointKey
) {
  const opts: EndpointAuthOptions =
    typeof options === 'string' ? { endpointKey: options } : options;

  const allowedRoles = CRM4_ENDPOINT_ROLES[opts.endpointKey];

  return [
    fastify.authenticate,
    async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7).trim();
        try {
          const decoded = jose.decodeJwt(token);
          if (decoded) {
            if (decoded['disabled'] === true || decoded['status'] === 'disabled') {
              throw new AppError('UNAUTHORIZED', 'User account is disabled', 401);
            }
            if (request.user) {
              const u = request.user as Crm4TokenClaims;
              if (typeof decoded['tenant_id'] === 'string') u.tenant_id = decoded['tenant_id'];
              if (typeof decoded['tenantId'] === 'string') u.tenantId = decoded['tenantId'];
              if (typeof decoded['org_id'] === 'string') u.org_id = decoded['org_id'];
              if (typeof decoded['employee_id'] === 'string' && !u.employee_id) {
                u.employee_id = decoded['employee_id'];
              }
            }
          }
        } catch (e) {
          if (e instanceof AppError) throw e;
        }
      }

      const user = request.user as Crm4TokenClaims | undefined;
      if (!user) {
        throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
      }

      if (user.disabled) {
        throw new AppError('UNAUTHORIZED', 'User account is disabled', 401);
      }

      assertTenantIsolation(user, undefined, request);

      if (!isRoleAllowed(user.roles, allowedRoles)) {
        throw new AppError(
          'FORBIDDEN',
          `Access denied. Allowed roles for this endpoint: [${allowedRoles.join(', ')}]`,
          403
        );
      }

      if (opts.requireObjectGuard && request.body && typeof request.body === 'object') {
        assertNoImmutableFieldMutation(user, request.body as Record<string, unknown>, true);
      }
    },
  ];
}
