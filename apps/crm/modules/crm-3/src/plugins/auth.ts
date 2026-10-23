import type { FastifyRequest } from 'fastify';
import { AppError } from '@cs/kernel';
import type { RoleType } from '@cs/identity';

export function isRoleAllowed(
  userRoles: readonly string[] = [],
  allowedRoles: readonly string[] = []
): boolean {
  if (userRoles.includes('admin')) return true;
  return userRoles.some((role) => allowedRoles.includes(role));
}

export function requireRoles(allowedRoles: readonly RoleType[] | readonly string[]) {
  return async (request: FastifyRequest): Promise<void> => {
    if (!request.user) {
      throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
    }

    const userRoles = request.user.roles || [];
    if (!isRoleAllowed(userRoles, allowedRoles)) {
      throw new AppError(
        'FORBIDDEN',
        `Access denied. Allowed roles for this endpoint: [${allowedRoles.join(', ')}]`,
        403
      );
    }
  };
}
