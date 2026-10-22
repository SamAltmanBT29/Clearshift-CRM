import { isRoleAllowed } from '../../src/policies/roles.js';
import type { RoleType } from '@cs/identity';
import type { UserSession, AuthGuardResult } from '../types.js';

export const HUB_LOGIN_PATH = '/login';
export const ACCESS_DENIED_PATH = '/access-denied';

/**
 * Route guard enforcing Hub authentication and role-based authorization for CRM-1 UI pages.
 * - Unauthenticated or expired sessions are redirected to the Hub login screen.
 * - Disabled users are redirected to login with reason=disabled.
 * - Authenticated users with insufficient roles are redirected to /access-denied.
 */
export function checkRouteAuth(
  session: UserSession | null | undefined,
  currentPath: string,
  allowedRoles?: readonly RoleType[] | undefined
): AuthGuardResult {
  if (!session || !session.userId) {
    const encodedReturn = encodeURIComponent(currentPath);
    return {
      isAllowed: false,
      redirectTo: `${HUB_LOGIN_PATH}?returnUrl=${encodedReturn}`,
      reason: 'UNAUTHENTICATED',
    };
  }

  if (session.disabled) {
    const encodedReturn = encodeURIComponent(currentPath);
    return {
      isAllowed: false,
      redirectTo: `${HUB_LOGIN_PATH}?returnUrl=${encodedReturn}&reason=disabled`,
      reason: 'UNAUTHENTICATED',
    };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (session.expiresAt && session.expiresAt <= nowSec) {
    const encodedReturn = encodeURIComponent(currentPath);
    return {
      isAllowed: false,
      redirectTo: `${HUB_LOGIN_PATH}?returnUrl=${encodedReturn}&reason=expired`,
      reason: 'UNAUTHENTICATED',
    };
  }

  if (allowedRoles && allowedRoles.length > 0) {
    const isAuthorized = isRoleAllowed(session.roles, allowedRoles);
    if (!isAuthorized) {
      return {
        isAllowed: false,
        redirectTo: `${ACCESS_DENIED_PATH}?required=${encodeURIComponent(allowedRoles.join(','))}`,
        reason: 'INSUFFICIENT_PERMISSIONS',
      };
    }
  }

  return { isAllowed: true };
}
