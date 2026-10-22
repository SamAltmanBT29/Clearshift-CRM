import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import * as jose from 'jose';
import { AppError } from '@cs/kernel';
import { verifyAccessToken, type HubTokenClaims, type RoleType } from '@cs/identity';
import { isRoleAllowed } from '../policies/roles.js';

export interface AuthenticatedUser extends HubTokenClaims {
  disabled?: boolean | undefined;
}

/**
 * Fastify plugin for CRM-1 authentication.
 * Validates EdDSA/JWKS Hub Identity access tokens and decorates requests with verified claims.
 */
const crm1AuthPluginAsync: FastifyPluginAsync = async (fastify) => {
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
      request.user = claims;
    } catch (err: any) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError('UNAUTHORIZED', `Token verification failed: ${err.message || 'invalid token'}`, 401);
    }
  };

  if (!fastify.hasDecorator('authenticate')) {
    fastify.decorate('authenticate', authenticate);
  }
};

export const crm1AuthPlugin = fp(crm1AuthPluginAsync, {
  name: 'crm1-auth-plugin',
  fastify: '5.x',
});

/**
 * Creates a route preHandler that enforces endpoint-level role permissions based on the SDS matrix.
 */
export function requireRoles(allowedRoles: readonly RoleType[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
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

    if (!isRoleAllowed(user.roles, allowedRoles)) {
      throw new AppError(
        'FORBIDDEN',
        `Access denied. Allowed roles for this endpoint: [${allowedRoles.join(', ')}]`,
        403
      );
    }
  };
}
