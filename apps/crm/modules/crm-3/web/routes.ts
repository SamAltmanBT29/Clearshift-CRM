import { Capabilities } from '@cs/rbac';
import type { Crm3RouteDefinition, BreadcrumbItem } from './types.js';

export const CRM3_BASE_PATH = '/crm-3';
export const MODULE_TITLE = 'CRM-3 Support Tickets and Activities';

export const CRM3_ROUTES: Record<string, Crm3RouteDefinition> = {
  tickets: {
    id: 'crm3-tickets',
    path: 'tickets',
    fullPath: `${CRM3_BASE_PATH}/tickets`,
    title: 'Support Tickets Queue',
    navLabel: 'Tickets',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Support & Tickets', href: CRM3_BASE_PATH },
      { label: 'Tickets' },
    ],
  },
  activities: {
    id: 'crm3-activities',
    path: 'activities',
    fullPath: `${CRM3_BASE_PATH}/activities`,
    title: 'Customer Activity Timeline',
    navLabel: 'Activities',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Support & Tickets', href: CRM3_BASE_PATH },
      { label: 'Activities' },
    ],
  },
  notes: {
    id: 'crm3-notes',
    path: 'notes',
    fullPath: `${CRM3_BASE_PATH}/notes`,
    title: 'Internal Ticket Notes',
    navLabel: 'Notes',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Support & Tickets', href: CRM3_BASE_PATH },
      { label: 'Notes' },
    ],
  },
  sla: {
    id: 'crm3-sla',
    path: 'sla',
    fullPath: `${CRM3_BASE_PATH}/sla`,
    title: 'SLA Tracking & Priority Escalations',
    navLabel: 'SLA Tracking',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Support & Tickets', href: CRM3_BASE_PATH },
      { label: 'SLA Tracking' },
    ],
  },
  imports: {
    id: 'crm3-imports',
    path: 'imports',
    fullPath: `${CRM3_BASE_PATH}/imports`,
    title: 'Import Batches & Receipts',
    navLabel: 'Imports',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Support & Tickets', href: CRM3_BASE_PATH },
      { label: 'Imports' },
    ],
  },
};

export function getAllCrm3Routes(): Crm3RouteDefinition[] {
  return Object.values(CRM3_ROUTES);
}

export function findRouteByPath(path: string): Crm3RouteDefinition | undefined {
  const normalized = path.replace(/\/+$/, '');
  return getAllCrm3Routes().find(
    (r) => r.fullPath === normalized || `${CRM3_BASE_PATH}/${r.path}` === normalized
  );
}

export function formatBrowserTitle(subTitle?: string | undefined): string {
  if (!subTitle) {
    return `ClearShift | ${MODULE_TITLE}`;
  }
  return `ClearShift | CRM-3 - ${subTitle}`;
}

export function getRouteBreadcrumbs(subRouteKey: string): BreadcrumbItem[] {
  const route = CRM3_ROUTES[subRouteKey];
  if (route) {
    return route.breadcrumbs;
  }
  return [
    { label: 'ClearShift', href: '/' },
    { label: 'CRM Modules', href: '/crm' },
    { label: 'Support & Tickets' },
  ];
}
