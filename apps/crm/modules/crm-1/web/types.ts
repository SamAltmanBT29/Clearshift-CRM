import type { CapabilityType } from '@cs/rbac';
import type { RoleType } from '@cs/identity';

export interface BreadcrumbItem {
  label: string;
  href?: string | undefined;
}

export interface Crm1RouteDefinition {
  id: string;
  path: string;
  fullPath: string;
  title: string;
  navLabel: string;
  requiredCapability?: CapabilityType;
  allowedRoles?: readonly RoleType[];
  breadcrumbs: BreadcrumbItem[];
}

export interface UserSession {
  userId: string;
  roles: RoleType[];
  expiresAt: number; // Unix timestamp in seconds
  disabled?: boolean | undefined;
}

export interface AuthGuardResult {
  isAllowed: boolean;
  redirectTo?: string | undefined;
  reason?: 'UNAUTHENTICATED' | 'INSUFFICIENT_PERMISSIONS' | undefined;
}
