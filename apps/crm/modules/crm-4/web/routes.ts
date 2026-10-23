import { Capabilities } from '@cs/rbac';
import type { Crm4RouteDefinition, BreadcrumbItem } from './types.js';

export const CRM4_BASE_PATH = '/crm-4';
export const MODULE_TITLE = 'CRM-4 Marketing Lists and Campaign History';

export const CRM4_ROUTES: Record<string, Crm4RouteDefinition> = {
  lists: {
    id: 'crm4-lists',
    path: 'lists',
    fullPath: `${CRM4_BASE_PATH}/lists`,
    title: 'Marketing Lists Directory',
    navLabel: 'Marketing Lists',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Marketing & Campaigns', href: CRM4_BASE_PATH },
      { label: 'Marketing Lists' },
    ],
  },
  campaigns: {
    id: 'crm4-campaigns',
    path: 'campaigns',
    fullPath: `${CRM4_BASE_PATH}/campaigns`,
    title: 'Campaign History & Recording',
    navLabel: 'Campaign History',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Marketing & Campaigns', href: CRM4_BASE_PATH },
      { label: 'Campaign History' },
    ],
  },
  members: {
    id: 'crm4-members',
    path: 'members',
    fullPath: `${CRM4_BASE_PATH}/members`,
    title: 'Campaign Activity & Membership',
    navLabel: 'Campaign Members',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Marketing & Campaigns', href: CRM4_BASE_PATH },
      { label: 'Campaign Members' },
    ],
  },
  consents: {
    id: 'crm4-consents',
    path: 'consents',
    fullPath: `${CRM4_BASE_PATH}/consents`,
    title: 'Consent State & Monotonic Opt-Out',
    navLabel: 'Consent Records',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Marketing & Campaigns', href: CRM4_BASE_PATH },
      { label: 'Consent Records' },
    ],
  },
  imports: {
    id: 'crm4-imports',
    path: 'imports',
    fullPath: `${CRM4_BASE_PATH}/imports`,
    title: 'Marketing Import Batches & Receipts',
    navLabel: 'Imports',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Marketing & Campaigns', href: CRM4_BASE_PATH },
      { label: 'Imports' },
    ],
  },
};

export function getAllCrm4Routes(): Crm4RouteDefinition[] {
  return Object.values(CRM4_ROUTES);
}

export function findRouteByPath(path: string): Crm4RouteDefinition | undefined {
  const normalized = path.replace(/\/+$/, '');
  return getAllCrm4Routes().find(
    (r) => r.fullPath === normalized || `${CRM4_BASE_PATH}/${r.path}` === normalized
  );
}

export function formatBrowserTitle(subTitle?: string | undefined): string {
  if (!subTitle) {
    return `ClearShift | ${MODULE_TITLE}`;
  }
  return `ClearShift | CRM-4 - ${subTitle}`;
}

export function getRouteBreadcrumbs(subRouteKey: string): BreadcrumbItem[] {
  const route = CRM4_ROUTES[subRouteKey];
  if (route) {
    return route.breadcrumbs;
  }
  return [
    { label: 'ClearShift', href: '/' },
    { label: 'CRM Modules', href: '/crm' },
    { label: 'Marketing & Campaigns' },
  ];
}
