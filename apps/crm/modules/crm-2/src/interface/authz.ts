import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { AppError } from '@cs/kernel';
import { Roles, type RoleType, type HubTokenClaims } from '@cs/identity';
import { Capabilities, hasCapability, type CapabilityType } from '@cs/rbac';
import {
  isRoleAllowed,
  isCapabilityAllowed,
  CRM2_ENDPOINT_ROLES,
  CRM2_ENDPOINT_CAPABILITIES,
  type Crm2EndpointKey,
} from '../policies/roles.js';
import {
  assertTenantIsolation,
  assertRecordOwnership,
  type AuthenticatedUser,
} from '../plugins/auth.js';

/**
 * Extended token claims supporting multi-tenant isolation and user identity for CRM-2.
 */
export type Crm2TokenClaims = AuthenticatedUser;

/**
 * Immutable domain fields that cannot be tampered with or overwritten by standard mutations (updates).
 * In particular, primary UUID, source lineage, creation dates, and quote numbers are immutable.
 */
export const IMMUTABLE_MUTATION_FIELDS = [
  'id',
  'goldenId',
  'golden_id',
  'sourceSystem',
  'source_system',
  'sourceId',
  'source_id',
  'quoteNumber',
  'quote_number',
  'createdAt',
  'created_at',
  'updatedAt',
  'updated_at',
] as const;

/**
 * Identity fields that cannot be forged during creation by non-admin callers.
 */
export const IMMUTABLE_CREATION_FIELDS = [
  'goldenId',
  'golden_id',
] as const;

export interface ObjectAuthorizationContext {
  resourceType: 'deal' | 'stage' | 'quote' | 'quote_line' | 'import_batch';
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
  user: Crm2TokenClaims | undefined,
  request?: FastifyRequest | undefined
): string | undefined {
  if (user) {
    if (user.tenant_id) return user.tenant_id;
    if (user.tenantId) return user.tenantId;
    if (user.org_id) return user.org_id;
    if (user.organizationId) return user.organizationId;
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
 * Object-level guard: Prevents unauthorized modification of immutable identity/system fields.
 */
export function assertNoImmutableFieldMutation(
  user: Crm2TokenClaims,
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
  user: Crm2TokenClaims,
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
  endpointKey: Crm2EndpointKey;
  requireObjectGuard?: boolean | undefined;
}

/**
 * Creates route preHandlers that enforce:
 * 1. Hub JWT signature & expiration validation (401 on failure)
 * 2. Active account verification (401 on disabled account)
 * 3. Role Capability Matrix enforcement per SDS ClearShift CRM v2.0 §4 / §7.2 (403 on insufficient permissions)
 * 4. Multi-tenant header validation & cross-tenant prevention (403 on mismatch)
 * 5. Optional object guard verifying immutable fields are not modified
 */
export function createEndpointAuthPreHandlers(
  fastify: FastifyInstance,
  options: EndpointAuthOptions | Crm2EndpointKey
) {
  const opts: EndpointAuthOptions =
    typeof options === 'string' ? { endpointKey: options } : options;

  const allowedRoles = CRM2_ENDPOINT_ROLES[opts.endpointKey];

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
              const u = request.user as Crm2TokenClaims;
              if (typeof decoded['tenant_id'] === 'string') u.tenant_id = decoded['tenant_id'];
              if (typeof decoded['tenantId'] === 'string') u.tenantId = decoded['tenantId'];
              if (typeof decoded['org_id'] === 'string') u.org_id = decoded['org_id'];
              if (typeof decoded['organizationId'] === 'string') u.organizationId = decoded['organizationId'];
              if (typeof decoded['employee_id'] === 'string' && !u.employee_id) {
                u.employee_id = decoded['employee_id'];
              }
            }
          }
        } catch (e) {
          if (e instanceof AppError) throw e;
        }
      }

      const user = request.user as Crm2TokenClaims | undefined;
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

export {
  assertTenantIsolation,
  assertRecordOwnership,
  isRoleAllowed,
  isCapabilityAllowed,
  CRM2_ENDPOINT_ROLES,
  CRM2_ENDPOINT_CAPABILITIES,
};
