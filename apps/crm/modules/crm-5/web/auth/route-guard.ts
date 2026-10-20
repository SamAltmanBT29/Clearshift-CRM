import { hasCapability, type CapabilityType } from '@cs/rbac';
import type { UserSession, AuthGuardResult } from '../types.js';

export const HUB_LOGIN_PATH = '/login';
export const ACCESS_DENIED_PATH = '/access-denied';

/**
 * Route guard enforcing Hub authentication and capability-based authorization.
 * Unauthenticated users are redirected to the Hub login screen with a returnUrl.
 * Unauthorized users are redirected to access-denied.
 */
export function checkRouteAuth(
  session: UserSession | null | undefined,
  currentPath: string,
  requiredCapability?: CapabilityType | undefined
): AuthGuardResult {
  if (!session || !session.userId) {
    const encodedReturn = encodeURIComponent(currentPath);
    return {
      isAllowed: false,
      redirectTo: `${HUB_LOGIN_PATH}?returnUrl=${encodedReturn}`,
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

  if (requiredCapability) {
    const isAuthorized = hasCapability(session.roles, requiredCapability);
    if (!isAuthorized) {
      return {
        isAllowed: false,
        redirectTo: `${ACCESS_DENIED_PATH}?required=${encodeURIComponent(requiredCapability)}`,
        reason: 'INSUFFICIENT_PERMISSIONS',
      };
    }
  }

  return { isAllowed: true };
}
