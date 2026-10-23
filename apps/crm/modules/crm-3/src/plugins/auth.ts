import type { FastifyRequest } from 'fastify';
import { AppError } from '@cs/kernel';
import type { RoleType } from '@cs/identity';
import { isRoleAllowed } from '../policies/roles.js';

export { isRoleAllowed };

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
