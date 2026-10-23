import { Capabilities } from '@cs/rbac';
import type { Crm5RouteDefinition, BreadcrumbItem } from './types.js';

export const CRM5_BASE_PATH = '/crm-5';
export const MODULE_TITLE = 'CRM-5 Migration Control Center & Reports';

export const CRM5_ROUTES: Record<string, Crm5RouteDefinition> = {
  runs: {
    id: 'crm5-runs',
    path: 'runs',
    fullPath: `${CRM5_BASE_PATH}/runs`,
    title: 'Migration Run Projections',
    navLabel: 'Runs',
    requiredCapability: Capabilities.CONTROL_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Migration Control', href: CRM5_BASE_PATH },
      { label: 'Runs' },
    ],
  },
  scores: {
    id: 'crm5-scores',
    path: 'scores',
    fullPath: `${CRM5_BASE_PATH}/scores`,
    title: 'Data Quality Scores',
    navLabel: 'Quality Scores',
    requiredCapability: Capabilities.CONTROL_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Migration Control', href: CRM5_BASE_PATH },
      { label: 'Quality Scores' },
    ],
  },
  rejects: {
    id: 'crm5-rejects',
    path: 'rejects',
    fullPath: `${CRM5_BASE_PATH}/rejects`,
    title: 'Row-Level Rejection Audit',
    navLabel: 'Rejections',
    requiredCapability: Capabilities.CONTROL_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Migration Control', href: CRM5_BASE_PATH },
      { label: 'Rejections' },
    ],
  },
  reconciliation: {
    id: 'crm5-reconciliation',
    path: 'reconciliation',
    fullPath: `${CRM5_BASE_PATH}/reconciliation`,
    title: 'Conservation Balance Sheet',
    navLabel: 'Reconciliation',
    requiredCapability: Capabilities.CONTROL_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Migration Control', href: CRM5_BASE_PATH },
      { label: 'Reconciliation' },
    ],
  },
  duplicates: {
    id: 'crm5-duplicates',
    path: 'duplicates',
    fullPath: `${CRM5_BASE_PATH}/duplicates`,
    title: 'Exact Duplicate Candidate Review',
    navLabel: 'Duplicate Review',
    requiredCapability: Capabilities.CONTROL_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Migration Control', href: CRM5_BASE_PATH },
      { label: 'Duplicate Review' },
    ],
  },
};

export const CRM5_DETAIL_ROUTES: Record<string, Crm5RouteDefinition> = {
  runDetail: {
    id: 'crm5-run-detail',
    path: 'runs/:id',
    fullPath: `${CRM5_BASE_PATH}/runs/:id`,
    title: 'Migration Run Detail',
    navLabel: 'Run Detail',
    requiredCapability: Capabilities.CONTROL_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Migration Control', href: CRM5_BASE_PATH },
      { label: 'Runs', href: `${CRM5_BASE_PATH}/runs` },
      { label: 'Run Detail' },
    ],
  },
};

export function getAllCrm5Routes(): Crm5RouteDefinition[] {
  return Object.values(CRM5_ROUTES);
}

export function findRouteByPath(path: string): Crm5RouteDefinition | undefined {
  const normalized = path.replace(/\/+$/, '');
  const allRoutes = [...getAllCrm5Routes(), ...Object.values(CRM5_DETAIL_ROUTES)];
  return allRoutes.find(
    (r) => r.fullPath === normalized || `${CRM5_BASE_PATH}/${r.path}` === normalized
  );
}

export function formatBrowserTitle(subTitle?: string | undefined): string {
  if (!subTitle) {
    return `ClearShift | ${MODULE_TITLE}`;
  }
  return `ClearShift | CRM-5 - ${subTitle}`;
}

export function getRouteBreadcrumbs(subRouteKey: string): BreadcrumbItem[] {
  const route = CRM5_ROUTES[subRouteKey] || CRM5_DETAIL_ROUTES[subRouteKey];
  if (route) {
    return route.breadcrumbs;
  }
  return [
    { label: 'ClearShift', href: '/' },
    { label: 'CRM Modules', href: '/crm' },
    { label: 'Migration Control Center' },
  ];
}
