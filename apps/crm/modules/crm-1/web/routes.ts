import { Capabilities } from '@cs/rbac';
import type { Crm1RouteDefinition, BreadcrumbItem } from './types.js';

export const CRM1_BASE_PATH = '/crm-1';
export const MODULE_TITLE = 'CRM-1 Contacts, Companies and Leads';

export const CRM1_ROUTES: Record<string, Crm1RouteDefinition> = {
  contacts: {
    id: 'crm1-contacts',
    path: 'contacts',
    fullPath: `${CRM1_BASE_PATH}/contacts`,
    title: 'Contacts Directory',
    navLabel: 'Contacts',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Contacts & Accounts', href: CRM1_BASE_PATH },
      { label: 'Contacts' },
    ],
  },
  companies: {
    id: 'crm1-companies',
    path: 'companies',
    fullPath: `${CRM1_BASE_PATH}/companies`,
    title: 'Companies Directory',
    navLabel: 'Companies',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Contacts & Accounts', href: CRM1_BASE_PATH },
      { label: 'Companies' },
    ],
  },
  leads: {
    id: 'crm1-leads',
    path: 'leads',
    fullPath: `${CRM1_BASE_PATH}/leads`,
    title: 'Leads Pipeline',
    navLabel: 'Leads',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Contacts & Accounts', href: CRM1_BASE_PATH },
      { label: 'Leads' },
    ],
  },
  duplicates: {
    id: 'crm1-duplicates',
    path: 'duplicates',
    fullPath: `${CRM1_BASE_PATH}/duplicates`,
    title: 'Exact Duplicate Candidate Review',
    navLabel: 'Duplicate Review',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Contacts & Accounts', href: CRM1_BASE_PATH },
      { label: 'Duplicate Review' },
    ],
  },
  imports: {
    id: 'crm1-imports',
    path: 'imports',
    fullPath: `${CRM1_BASE_PATH}/imports`,
    title: 'Import Batches & Receipts',
    navLabel: 'Imports',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Contacts & Accounts', href: CRM1_BASE_PATH },
      { label: 'Imports' },
    ],
  },
};

export const CRM1_MAPPING_ROUTE: Crm1RouteDefinition = {
  id: 'crm1-mappings',
  path: 'mappings',
  fullPath: `${CRM1_BASE_PATH}/mappings`,
  title: 'Field Mapping & Enum Translation',
  navLabel: 'Field Mappings',
  requiredCapability: Capabilities.MODULE_READ,
  breadcrumbs: [
    { label: 'ClearShift', href: '/' },
    { label: 'CRM Modules', href: '/crm' },
    { label: 'Contacts & Accounts', href: CRM1_BASE_PATH },
    { label: 'Field Mappings' },
  ],
};

export const CRM1_CLEANING_ROUTE: Crm1RouteDefinition = {
  id: 'crm1-cleaning',
  path: 'cleaning',
  fullPath: `${CRM1_BASE_PATH}/cleaning`,
  title: 'Cleaning Rules & Field Audit',
  navLabel: 'Cleaning Audit',
  requiredCapability: Capabilities.MODULE_READ,
  breadcrumbs: [
    { label: 'ClearShift', href: '/' },
    { label: 'CRM Modules', href: '/crm' },
    { label: 'Contacts & Accounts', href: CRM1_BASE_PATH },
    { label: 'Cleaning Audit' },
  ],
};

export function getAllCrm1Routes(): Crm1RouteDefinition[] {
  return Object.values(CRM1_ROUTES);
}

export function findRouteByPath(path: string): Crm1RouteDefinition | undefined {
  const normalized = path.replace(/\/+$/, '');
  const all = [...getAllCrm1Routes(), CRM1_CLEANING_ROUTE, CRM1_MAPPING_ROUTE];
  return all.find(
    (r) => r.fullPath === normalized || `${CRM1_BASE_PATH}/${r.path}` === normalized
  );
}

export function formatBrowserTitle(subTitle?: string | undefined): string {
  if (!subTitle) {
    return `ClearShift | ${MODULE_TITLE}`;
  }
  return `ClearShift | CRM-1 - ${subTitle}`;
}

export function getRouteBreadcrumbs(subRouteKey: string): BreadcrumbItem[] {
  const route = CRM1_ROUTES[subRouteKey];
  if (route) {
    return route.breadcrumbs;
  }
  return [
    { label: 'ClearShift', href: '/' },
    { label: 'CRM Modules', href: '/crm' },
    { label: 'Contacts & Accounts' },
  ];
}
