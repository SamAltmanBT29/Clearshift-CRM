import { hasCapability, type CapabilityType } from '@cs/rbac';
import type { RoleType } from '@cs/identity';
import type { UserSession, AuthGuardResult } from '../types.js';

export const HUB_LOGIN_PATH = '/login';
export const ACCESS_DENIED_PATH = '/access-denied';

/**
 * Route guard enforcing Hub authentication and capability/role-based authorization for CRM-2.
 * Unauthenticated or expired users are redirected to the Hub login screen with a returnUrl.
 * Disabled users are redirected to login with reason=disabled.
 * Unauthorized users are redirected to access-denied.
 */
export function checkRouteAuth(
  session: UserSession | null | undefined,
  currentPath: string,
  requirement?: CapabilityType | readonly RoleType[] | undefined
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

  if (requirement) {
    if (typeof requirement === 'string') {
      const isAuthorized = hasCapability(session.roles, requirement);
      if (!isAuthorized) {
        return {
          isAllowed: false,
          redirectTo: `${ACCESS_DENIED_PATH}?required=${encodeURIComponent(requirement)}`,
          reason: 'INSUFFICIENT_PERMISSIONS',
        };
      }
    } else if (Array.isArray(requirement) && requirement.length > 0) {
      const isAuthorized = session.roles.some((r) => requirement.includes(r));
      if (!isAuthorized) {
        return {
          isAllowed: false,
          redirectTo: `${ACCESS_DENIED_PATH}?required=${encodeURIComponent(requirement.join(','))}`,
          reason: 'INSUFFICIENT_PERMISSIONS',
        };
      }
    }
  }

  return { isAllowed: true };
}
