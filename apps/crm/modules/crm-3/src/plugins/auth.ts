import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import * as jose from 'jose';
import { AppError } from '@cs/kernel';
import { verifyAccessToken, type RoleType } from '@cs/identity';
import { isRoleAllowed, type AuthenticatedUser } from '../policies/roles.js';

export { isRoleAllowed };
export type { AuthenticatedUser };

/**
 * Fastify plugin for CRM-3 authentication.
 * Validates EdDSA/JWKS Hub Identity access tokens and decorates requests with verified claims.
 */
const crm3AuthPluginAsync: FastifyPluginAsync = async (fastify) => {
  if (!fastify.hasRequestDecorator('user')) {
    fastify.decorateRequest('user', undefined);
  }

  const authenticate = async (request: FastifyRequest): Promise<void> => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('UNAUTHORIZED', 'Missing or invalid Authorization header', 401);
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new AppError('UNAUTHORIZED', 'Missing Bearer token payload', 401);
    }

    try {
      const claims = (await verifyAccessToken(token)) as AuthenticatedUser;
      const decoded = jose.decodeJwt(token);
      if (decoded && (decoded['disabled'] === true || decoded['status'] === 'disabled')) {
        claims.disabled = true;
        throw new AppError('UNAUTHORIZED', 'User account is disabled', 401);
      }
      if (decoded) {
        if (typeof decoded['tenant_id'] === 'string') {
          claims.tenant_id = decoded['tenant_id'];
        }
        if (typeof decoded['tenantId'] === 'string') {
          claims.tenantId = decoded['tenantId'];
        }
        if (typeof decoded['org_id'] === 'string') {
          claims.org_id = decoded['org_id'];
        }
        if (typeof decoded['employee_id'] === 'string' && !claims.employee_id) {
          claims.employee_id = decoded['employee_id'];
        }
      }
      request.user = claims;
    } catch (err: any) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError(
        'UNAUTHORIZED',
        `Token verification failed: ${err.message || 'invalid token'}`,
        401
      );
    }
  };

  if (!fastify.hasDecorator('authenticate')) {
    fastify.decorate('authenticate', authenticate);
  }
};

export const crm3AuthPlugin = fp(crm3AuthPluginAsync, {
  name: 'crm3-auth-plugin',
  fastify: '5.x',
});

/**
 * Creates a route preHandler that enforces endpoint-level role permissions based on the SDS matrix.
 */
export function requireRoles(allowedRoles: readonly RoleType[] | readonly string[]) {
  return async (request: FastifyRequest, _reply?: FastifyReply): Promise<void> => {
    if (!request.user) {
      throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
    }

    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      try {
        const decoded = jose.decodeJwt(token);
        if (decoded && (decoded['disabled'] === true || decoded['status'] === 'disabled')) {
          throw new AppError('UNAUTHORIZED', 'User account is disabled', 401);
        }
      } catch (e) {
        if (e instanceof AppError) throw e;
      }
    }

    const user = request.user as AuthenticatedUser;
    if (user.disabled) {
      throw new AppError('UNAUTHORIZED', 'User account is disabled', 401);
    }

    // Check multi-tenant consistency between token and request headers
    const tokenTenant = user.tenant_id || user.tenantId || user.org_id;
    const headerTenant = request.headers['x-tenant-id'] as string | undefined;
    if (tokenTenant && headerTenant && tokenTenant !== headerTenant) {
      throw new AppError(
        'FORBIDDEN',
        `Multi-tenant boundary violation: token tenant '${tokenTenant}' does not match request tenant header '${headerTenant}'`,
        403
      );
    }

    const userRoles = user.roles || [];
    if (!isRoleAllowed(userRoles, allowedRoles)) {
      throw new AppError(
        'FORBIDDEN',
        `Access denied. Allowed roles for this endpoint: [${allowedRoles.join(', ')}]`,
        403
      );
    }
  };
}

/**
 * Resolves the note author for an authenticated request. The author is always the token
 * subject; a body authorId that names someone else is rejected so one user cannot write a
 * note as another. Without an authenticated user (enforceAuth: false), the body value is used.
 */
export function resolveNoteAuthor(request: FastifyRequest, bodyAuthorId?: string): string {
  const subject = request.user?.sub;
  if (subject) {
    if (bodyAuthorId !== undefined && bodyAuthorId !== subject) {
      throw new AppError(
        'AUTHOR_MISMATCH',
        'Note author must be the authenticated user',
        403,
        [
          {
            field: 'authorId',
            message: 'authorId must match the authenticated user or be omitted',
            code: 'author_mismatch',
          },
        ]
      );
    }
    return subject;
  }
  return bodyAuthorId || 'authenticated-user';
}
