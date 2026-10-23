import { Capabilities } from '@cs/rbac';
import type { Crm2RouteDefinition, BreadcrumbItem } from './types.js';

export const CRM2_BASE_PATH = '/crm-2';
export const MODULE_TITLE = 'CRM-2 Deals, Pipeline and Quotes';

export interface Crm2RoutesMap {
  deals: Crm2RouteDefinition;
  pipeline: Crm2RouteDefinition;
  quotes: Crm2RouteDefinition;
  dealCreate: Crm2RouteDefinition;
  dealDetail: Crm2RouteDefinition;
  dealEdit: Crm2RouteDefinition;
  quoteCreate: Crm2RouteDefinition;
  quoteDetail: Crm2RouteDefinition;
  quoteEdit: Crm2RouteDefinition;
  [key: string]: Crm2RouteDefinition | undefined;
}

export const CRM2_ROUTES: Crm2RoutesMap = {
  deals: {
    id: 'crm2-deals',
    path: 'deals',
    fullPath: `${CRM2_BASE_PATH}/deals`,
    title: 'Deals & Opportunities Directory',
    navLabel: 'Deals',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Deals & Quotes', href: CRM2_BASE_PATH },
      { label: 'Deals' },
    ],
  },
  pipeline: {
    id: 'crm2-pipeline',
    path: 'pipeline',
    fullPath: `${CRM2_BASE_PATH}/pipeline`,
    title: 'Sales Pipeline & Stage Overview',
    navLabel: 'Pipeline',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Deals & Quotes', href: CRM2_BASE_PATH },
      { label: 'Pipeline' },
    ],
  },
  quotes: {
    id: 'crm2-quotes',
    path: 'quotes',
    fullPath: `${CRM2_BASE_PATH}/quotes`,
    title: 'Commercial Quotes Directory',
    navLabel: 'Quotes',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Deals & Quotes', href: CRM2_BASE_PATH },
      { label: 'Quotes' },
    ],
  },
  dealCreate: {
    id: 'crm2-deals-create',
    path: 'deals/new',
    fullPath: `${CRM2_BASE_PATH}/deals/new`,
    title: 'Create Sales Opportunity',
    navLabel: 'New Deal',
    requiredCapability: Capabilities.MODULE_WRITE,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Deals & Quotes', href: CRM2_BASE_PATH },
      { label: 'Deals', href: `${CRM2_BASE_PATH}/deals` },
      { label: 'New Deal' },
    ],
  },
  dealDetail: {
    id: 'crm2-deals-detail',
    path: 'deals/:id',
    fullPath: `${CRM2_BASE_PATH}/deals/:id`,
    title: 'Deal Opportunity Details',
    navLabel: 'Deal Details',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Deals & Quotes', href: CRM2_BASE_PATH },
      { label: 'Deals', href: `${CRM2_BASE_PATH}/deals` },
      { label: 'Detail' },
    ],
  },
  dealEdit: {
    id: 'crm2-deals-edit',
    path: 'deals/:id/edit',
    fullPath: `${CRM2_BASE_PATH}/deals/:id/edit`,
    title: 'Edit Sales Opportunity',
    navLabel: 'Edit Deal',
    requiredCapability: Capabilities.MODULE_WRITE,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Deals & Quotes', href: CRM2_BASE_PATH },
      { label: 'Deals', href: `${CRM2_BASE_PATH}/deals` },
      { label: 'Edit Deal' },
    ],
  },
  quoteCreate: {
    id: 'crm2-quotes-create',
    path: 'quotes/new',
    fullPath: `${CRM2_BASE_PATH}/quotes/new`,
    title: 'Create Commercial Quote',
    navLabel: 'New Quote',
    requiredCapability: Capabilities.MODULE_WRITE,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Deals & Quotes', href: CRM2_BASE_PATH },
      { label: 'Quotes', href: `${CRM2_BASE_PATH}/quotes` },
      { label: 'New Quote' },
    ],
  },
  quoteDetail: {
    id: 'crm2-quotes-detail',
    path: 'quotes/:id',
    fullPath: `${CRM2_BASE_PATH}/quotes/:id`,
    title: 'Commercial Quote Details',
    navLabel: 'Quote Details',
    requiredCapability: Capabilities.MODULE_READ,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Deals & Quotes', href: CRM2_BASE_PATH },
      { label: 'Quotes', href: `${CRM2_BASE_PATH}/quotes` },
      { label: 'Detail' },
    ],
  },
  quoteEdit: {
    id: 'crm2-quotes-edit',
    path: 'quotes/:id/edit',
    fullPath: `${CRM2_BASE_PATH}/quotes/:id/edit`,
    title: 'Edit Commercial Quote',
    navLabel: 'Edit Quote',
    requiredCapability: Capabilities.MODULE_WRITE,
    breadcrumbs: [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Deals & Quotes', href: CRM2_BASE_PATH },
      { label: 'Quotes', href: `${CRM2_BASE_PATH}/quotes` },
      { label: 'Edit Quote' },
    ],
  },
};

/**
 * Returns the primary module navigation tab routes (Deals, Pipeline, Quotes)
 */
export function getAllCrm2Routes(): Crm2RouteDefinition[] {
  return [CRM2_ROUTES['deals'], CRM2_ROUTES['pipeline'], CRM2_ROUTES['quotes']];
}

/**
 * Returns all registered route definitions including CRUD sub-routes
 */
export function getAllSubRoutes(): Crm2RouteDefinition[] {
  return [
    CRM2_ROUTES['deals'],
    CRM2_ROUTES['pipeline'],
    CRM2_ROUTES['quotes'],
    CRM2_ROUTES['dealCreate'],
    CRM2_ROUTES['dealDetail'],
    CRM2_ROUTES['dealEdit'],
    CRM2_ROUTES['quoteCreate'],
    CRM2_ROUTES['quoteDetail'],
    CRM2_ROUTES['quoteEdit'],
  ];
}

/**
 * Resolves a route definition from a path, supporting exact, trailing-slash,
 * and parameterized routes (e.g. `/crm-2/deals/uuid`).
 */
export function findRouteByPath(rawPath: string): Crm2RouteDefinition | undefined {
  const normalized = rawPath.replace(/\/+$/, '') || '/';

  // 1. Exact match on fullPath or relative path
  for (const route of getAllSubRoutes()) {
    if (route.fullPath === normalized || `${CRM2_BASE_PATH}/${route.path}` === normalized) {
      return route;
    }
  }

  // 2. Parameterized pattern matching
  // Matches `/crm-2/deals/:id/edit`
  if (/^\/crm-2\/deals\/[^/]+\/edit$/.test(normalized)) {
    return CRM2_ROUTES['dealEdit'];
  }
  // Matches `/crm-2/deals/:id`
  if (/^\/crm-2\/deals\/[^/]+$/.test(normalized)) {
    return CRM2_ROUTES['dealDetail'];
  }
  // Matches `/crm-2/quotes/:id/edit`
  if (/^\/crm-2\/quotes\/[^/]+\/edit$/.test(normalized)) {
    return CRM2_ROUTES['quoteEdit'];
  }
  // Matches `/crm-2/quotes/:id`
  if (/^\/crm-2\/quotes\/[^/]+$/.test(normalized)) {
    return CRM2_ROUTES['quoteDetail'];
  }

  return undefined;
}

/**
 * Formats standardized document title for browser tabs
 */
export function formatBrowserTitle(subTitle?: string | undefined): string {
  if (!subTitle) {
    return `ClearShift | ${MODULE_TITLE}`;
  }
  return `ClearShift | CRM-2 - ${subTitle}`;
}

export interface BreadcrumbParams {
  dealId?: string | undefined;
  dealName?: string | undefined;
  quoteId?: string | undefined;
  quoteNumber?: string | undefined;
}

/**
 * Resolves contextual breadcrumbs with optional entity labels
 */
export function getRouteBreadcrumbs(
  subRouteKey: string,
  params?: BreadcrumbParams | undefined
): BreadcrumbItem[] {
  const route = CRM2_ROUTES[subRouteKey];
  if (!route) {
    return [
      { label: 'ClearShift', href: '/' },
      { label: 'CRM Modules', href: '/crm' },
      { label: 'Deals & Quotes' },
    ];
  }

  const crumbs = [...route.breadcrumbs];
  if (params?.dealName && (subRouteKey === 'dealDetail' || subRouteKey === 'dealEdit')) {
    crumbs[crumbs.length - 1] = { label: params.dealName };
  } else if (params?.quoteNumber && (subRouteKey === 'quoteDetail' || subRouteKey === 'quoteEdit')) {
    crumbs[crumbs.length - 1] = { label: params.quoteNumber };
  }

  return crumbs;
}
