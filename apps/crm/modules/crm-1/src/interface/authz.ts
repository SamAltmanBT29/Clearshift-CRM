import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { AppError } from '@cs/kernel';
import { Roles, type RoleType, type HubTokenClaims } from '@cs/identity';
import { Capabilities, hasCapability, type CapabilityType } from '@cs/rbac';
import { isRoleAllowed, CRM1_ENDPOINT_ROLES, type Crm1EndpointKey } from '../policies/roles.js';

/**
 * Extended token claims supporting multi-tenant isolation and user identity.
 */
export interface Crm1TokenClaims extends HubTokenClaims {
  tenant_id?: string;
  tenantId?: string;
  org_id?: string;
  disabled?: boolean;
}

/**
 * ClearShift Architecture Spec §4.2 RBAC Capability Mapping for CRM-1 Endpoints:
 * - Module Read (module.read): Contacts, Companies, Leads (List & Read)
 * - Module Write (module.write): Contacts, Companies, Leads (Create & Update)
 * - Kit Run (kit.run): Import Run Execution
 * - Kit Read (kit.read): Import Run Status & Rejects Review
 */
export const CRM1_ENDPOINT_CAPABILITIES: Record<Crm1EndpointKey, CapabilityType> = {
  CONTACTS_LIST: Capabilities.MODULE_READ,
  CONTACTS_READ: Capabilities.MODULE_READ,
  CONTACTS_CREATE: Capabilities.MODULE_WRITE,
  CONTACTS_UPDATE: Capabilities.MODULE_WRITE,

  COMPANIES_LIST: Capabilities.MODULE_READ,
  COMPANIES_READ: Capabilities.MODULE_READ,
  COMPANIES_CREATE: Capabilities.MODULE_WRITE,
  COMPANIES_UPDATE: Capabilities.MODULE_WRITE,

  LEADS_LIST: Capabilities.MODULE_READ,
  LEADS_READ: Capabilities.MODULE_READ,
  LEADS_CREATE: Capabilities.MODULE_WRITE,
  LEADS_UPDATE: Capabilities.MODULE_WRITE,

  IMPORTS_START: Capabilities.KIT_RUN,
  IMPORTS_STATUS: Capabilities.KIT_READ,
  IMPORTS_REJECTS: Capabilities.KIT_READ,
};

/**
 * Immutable domain fields that cannot be tampered with or overwritten by standard mutations (updates).
 */
export const IMMUTABLE_MUTATION_FIELDS = [
  'goldenId',
  'golden_id',
  'sourceSystem',
  'source_system',
  'sourceId',
  'source_id',
  'createdAt',
  'created_at',
  'id',
] as const;

/**
 * Identity fields that cannot be forged during creation by non-admin callers.
 */
export const IMMUTABLE_CREATION_FIELDS = [
  'goldenId',
  'golden_id',
] as const;

export interface ObjectAuthorizationContext {
  resourceType: 'contact' | 'company' | 'lead' | 'import_batch';
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
  user: Crm1TokenClaims | undefined,
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
  user: Crm1TokenClaims,
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
  user: Crm1TokenClaims,
  resourceOwnerId?: string | undefined
): void {
  // Admin role possesses universal override
  if (user.roles && user.roles.includes(Roles.ADMIN)) {
    return;
  }

  // If resource has an explicit owner and caller is not that owner, deny
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
 * Object-level guard: Prevents unauthorized modification of immutable identity/system fields.
 */
export function assertNoImmutableFieldMutation(
  user: Crm1TokenClaims,
  payload?: Record<string, unknown> | undefined,
  isUpdate = true
): void {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  if (user.roles && user.roles.includes(Roles.ADMIN)) {
    // Admin has emergency maintenance privilege if necessary
    return;
  }

  const fieldsToCheck = isUpdate ? IMMUTABLE_MUTATION_FIELDS : IMMUTABLE_CREATION_FIELDS;

  for (const field of fieldsToCheck) {
    if (field in payload && payload[field] !== undefined) {
      throw new AppError(
        'FORBIDDEN',
        `Access denied: modification of immutable field '${field}' is strictly prohibited`,
        403
      );
    }
  }
}

/**
 * Combined object-level authorization guard validating tenant isolation,
 * record ownership, and field mutability invariants.
 */
export function assertObjectMutationAllowed(
  user: Crm1TokenClaims,
  ctx: ObjectAuthorizationContext,
  request?: FastifyRequest | undefined
): void {
  // 1. Multi-tenant boundary check
  assertTenantIsolation(user, ctx.resourceTenantId, request);

  // 2. Cross-user ownership check
  assertRecordOwnership(user, ctx.resourceOwnerId);

  // 3. Immutable field mutation guard
  assertNoImmutableFieldMutation(user, ctx.payload, ctx.isUpdate ?? true);
}

/**
 * Options for configuring an endpoint's authorization policy.
 */
export interface EndpointAuthOptions {
  endpointKey: Crm1EndpointKey;
  requireObjectGuard?: boolean | undefined;
}

/**
 * Creates route preHandlers that enforce:
 * 1. Hub JWT signature & expiration validation (401 on failure)
 * 2. Active account verification (401 on disabled account)
 * 3. Role Capability Matrix enforcement per Architecture Spec §4.2 & SDS ClearShift CRM v2.0 (403 on insufficient permissions)
 * 4. Multi-tenant header validation & cross-tenant prevention (403 on mismatch)
 */
export function createEndpointAuthPreHandlers(
  fastify: FastifyInstance,
  options: EndpointAuthOptions | Crm1EndpointKey
) {
  const opts: EndpointAuthOptions =
    typeof options === 'string' ? { endpointKey: options } : options;

  const allowedRoles = CRM1_ENDPOINT_ROLES[opts.endpointKey];

  return [
    fastify.authenticate,
    async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      // Decode JWT to extract extended claims (e.g. disabled status, tenant_id)
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
              const u = request.user as Crm1TokenClaims;
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

      const user = request.user as Crm1TokenClaims | undefined;
      if (!user) {
        throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
      }

      if (user.disabled) {
        throw new AppError('UNAUTHORIZED', 'User account is disabled', 401);
      }

      // Check tenant header consistency if present
      assertTenantIsolation(user, undefined, request);

      // Check role allowlist against SDS matrix
      if (!isRoleAllowed(user.roles, allowedRoles)) {
        throw new AppError(
          'FORBIDDEN',
          `Access denied. Allowed roles for this endpoint: [${allowedRoles.join(', ')}]`,
          403
        );
      }

      // If object-level body guard is requested, validate payload for immutable fields (for updates)
      if (opts.requireObjectGuard && request.body && typeof request.body === 'object') {
        assertNoImmutableFieldMutation(user, request.body as Record<string, unknown>, true);
      }
    },
  ];
}
