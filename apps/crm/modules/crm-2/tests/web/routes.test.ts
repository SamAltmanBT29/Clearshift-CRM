import { describe, it, expect } from 'vitest';
import { Capabilities } from '@cs/rbac';
import { Roles } from '@cs/identity';
import {
  CRM2_BASE_PATH,
  MODULE_TITLE,
  CRM2_ROUTES,
  getAllCrm2Routes,
  getAllSubRoutes,
  findRouteByPath,
  formatBrowserTitle,
  getRouteBreadcrumbs,
} from '../../web/src/routes.js';
import {
  checkRouteAuth,
  HUB_LOGIN_PATH,
  ACCESS_DENIED_PATH,
} from '../../web/src/auth/route-guard.js';
import { Crm2ShellController } from '../../web/src/shell/Crm2Shell.js';
import type { UserSession } from '../../web/src/types.js';

describe('CRM-2 Frontend Navigation & Routes (Issue #129 / [CRM2-16])', () => {
  describe('Route Definitions & Hierarchy', () => {
    it('defines primary navigation tab routes (deals, pipeline, quotes)', () => {
      const routes = getAllCrm2Routes();
      expect(routes).toHaveLength(3);

      const tabKeys = routes.map((r) => r.path);
      expect(tabKeys).toEqual(['deals', 'pipeline', 'quotes']);
    });

    it('defines full sub-route catalog including CRUD paths', () => {
      const allSubRoutes = getAllSubRoutes();
      expect(allSubRoutes.length).toBeGreaterThanOrEqual(9);

      const routeKeys = Object.keys(CRM2_ROUTES);
      expect(routeKeys).toContain('deals');
      expect(routeKeys).toContain('pipeline');
      expect(routeKeys).toContain('quotes');
      expect(routeKeys).toContain('dealCreate');
      expect(routeKeys).toContain('dealDetail');
      expect(routeKeys).toContain('dealEdit');
      expect(routeKeys).toContain('quoteCreate');
      expect(routeKeys).toContain('quoteDetail');
      expect(routeKeys).toContain('quoteEdit');
    });

    it('has standard metadata and Capabilities.MODULE_READ on list/overview routes', () => {
      for (const route of getAllCrm2Routes()) {
        expect(route.id).toMatch(/^crm2-/);
        expect(route.fullPath).toBe(`${CRM2_BASE_PATH}/${route.path}`);
        expect(route.requiredCapability).toBe(Capabilities.MODULE_READ);
        expect(route.breadcrumbs.length).toBeGreaterThanOrEqual(3);
        expect(route.breadcrumbs[0]?.label).toBe('ClearShift');
        expect(route.breadcrumbs[1]?.label).toBe('CRM Modules');
      }
    });

    it('enforces Capabilities.MODULE_WRITE on create and edit sub-routes', () => {
      expect(CRM2_ROUTES.dealCreate?.requiredCapability).toBe(Capabilities.MODULE_WRITE);
      expect(CRM2_ROUTES.dealEdit?.requiredCapability).toBe(Capabilities.MODULE_WRITE);
      expect(CRM2_ROUTES.quoteCreate?.requiredCapability).toBe(Capabilities.MODULE_WRITE);
      expect(CRM2_ROUTES.quoteEdit?.requiredCapability).toBe(Capabilities.MODULE_WRITE);
    });

    it('findRouteByPath matches exact, trailing-slash, and parameterized paths', () => {
      const dealsRoute = findRouteByPath('/crm-2/deals');
      expect(dealsRoute).toBeDefined();
      expect(dealsRoute?.id).toBe('crm2-deals');

      const trailingSlashRoute = findRouteByPath('/crm-2/pipeline/');
      expect(trailingSlashRoute).toBeDefined();
      expect(trailingSlashRoute?.id).toBe('crm2-pipeline');

      const quotesRoute = findRouteByPath('/crm-2/quotes');
      expect(quotesRoute).toBeDefined();
      expect(quotesRoute?.id).toBe('crm2-quotes');

      const dealDetailRoute = findRouteByPath('/crm-2/deals/90000000-0000-4000-8000-000000000001');
      expect(dealDetailRoute).toBeDefined();
      expect(dealDetailRoute?.id).toBe('crm2-deals-detail');

      const dealEditRoute = findRouteByPath('/crm-2/deals/90000000-0000-4000-8000-000000000001/edit');
      expect(dealEditRoute).toBeDefined();
      expect(dealEditRoute?.id).toBe('crm2-deals-edit');

      const quoteDetailRoute = findRouteByPath('/crm-2/quotes/80000000-0000-4000-8000-000000000001');
      expect(quoteDetailRoute).toBeDefined();
      expect(quoteDetailRoute?.id).toBe('crm2-quotes-detail');

      const quoteEditRoute = findRouteByPath('/crm-2/quotes/80000000-0000-4000-8000-000000000001/edit');
      expect(quoteEditRoute).toBeDefined();
      expect(quoteEditRoute?.id).toBe('crm2-quotes-edit');

      const unknownRoute = findRouteByPath('/crm-2/unknown-page');
      expect(unknownRoute).toBeUndefined();
    });

    it('formats browser document titles correctly', () => {
      expect(formatBrowserTitle()).toBe(`ClearShift | ${MODULE_TITLE}`);
      expect(formatBrowserTitle('Deals & Opportunities Directory')).toBe(
        'ClearShift | CRM-2 - Deals & Opportunities Directory'
      );
      expect(formatBrowserTitle('Sales Pipeline & Stage Overview')).toBe(
        'ClearShift | CRM-2 - Sales Pipeline & Stage Overview'
      );
    });

    it('resolves contextual breadcrumbs with entity labels', () => {
      const dealsBreadcrumbs = getRouteBreadcrumbs('deals');
      expect(dealsBreadcrumbs).toHaveLength(4);
      expect(dealsBreadcrumbs[3]?.label).toBe('Deals');

      const dealDetailBreadcrumbs = getRouteBreadcrumbs('dealDetail', {
        dealName: 'Acme Enterprise Upgrade',
      });
      expect(dealDetailBreadcrumbs).toHaveLength(5);
      expect(dealDetailBreadcrumbs[4]?.label).toBe('Acme Enterprise Upgrade');

      const quoteDetailBreadcrumbs = getRouteBreadcrumbs('quoteDetail', {
        quoteNumber: 'Q-2026-999',
      });
      expect(quoteDetailBreadcrumbs).toHaveLength(5);
      expect(quoteDetailBreadcrumbs[4]?.label).toBe('Q-2026-999');

      const fallbackBreadcrumbs = getRouteBreadcrumbs('unknown-key');
      expect(fallbackBreadcrumbs).toHaveLength(3);
      expect(fallbackBreadcrumbs[2]?.label).toBe('Deals & Quotes');
    });
  });

  describe('Route Guard & Hub Authentication', () => {
    it('redirects unauthenticated users (null session) to Hub login with returnUrl', () => {
      const result = checkRouteAuth(null, '/crm-2/deals', Capabilities.MODULE_READ);
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('UNAUTHENTICATED');
      expect(result.redirectTo).toBe(
        `${HUB_LOGIN_PATH}?returnUrl=${encodeURIComponent('/crm-2/deals')}`
      );
    });

    it('redirects unauthenticated users (empty session) to Hub login', () => {
      const result = checkRouteAuth({} as UserSession, '/crm-2/pipeline');
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('UNAUTHENTICATED');
      expect(result.redirectTo).toContain(HUB_LOGIN_PATH);
    });

    it('redirects expired sessions to Hub login with expired flag', () => {
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      const expiredSession: UserSession = {
        userId: 'usr-123',
        roles: [Roles.VIEWER],
        expiresAt: pastTime,
      };

      const result = checkRouteAuth(expiredSession, '/crm-2/deals');
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('UNAUTHENTICATED');
      expect(result.redirectTo).toBe(
        `${HUB_LOGIN_PATH}?returnUrl=${encodeURIComponent('/crm-2/deals')}&reason=expired`
      );
    });

    it('redirects disabled users to Hub login with disabled flag', () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      const disabledSession: UserSession = {
        userId: 'usr-123',
        roles: [Roles.VIEWER],
        expiresAt: futureTime,
        disabled: true,
      };

      const result = checkRouteAuth(disabledSession, '/crm-2/deals');
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('UNAUTHENTICATED');
      expect(result.redirectTo).toBe(
        `${HUB_LOGIN_PATH}?returnUrl=${encodeURIComponent('/crm-2/deals')}&reason=disabled`
      );
    });

    it('allows authenticated session with matching capability', () => {
      const validSession: UserSession = {
        userId: 'usr-valid',
        roles: [Roles.VIEWER],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };

      const result = checkRouteAuth(validSession, '/crm-2/deals', Capabilities.MODULE_READ);
      expect(result.isAllowed).toBe(true);
      expect(result.redirectTo).toBeUndefined();
    });

    it('rejects VIEWER role from MODULE_WRITE mutation routes and redirects to access-denied', () => {
      const viewerSession: UserSession = {
        userId: 'usr-viewer',
        roles: [Roles.VIEWER],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };

      const result = checkRouteAuth(viewerSession, '/crm-2/deals/new', Capabilities.MODULE_WRITE);
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('INSUFFICIENT_PERMISSIONS');
      expect(result.redirectTo).toBe(
        `${ACCESS_DENIED_PATH}?required=${encodeURIComponent(Capabilities.MODULE_WRITE)}`
      );
    });

    it('permits EDITOR and ADMIN roles on MODULE_WRITE mutation routes', () => {
      const editorSession: UserSession = {
        userId: 'usr-editor',
        roles: [Roles.EDITOR],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };

      const adminSession: UserSession = {
        userId: 'usr-admin',
        roles: [Roles.ADMIN],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };

      expect(checkRouteAuth(editorSession, '/crm-2/deals/new', Capabilities.MODULE_WRITE).isAllowed).toBe(true);
      expect(checkRouteAuth(adminSession, '/crm-2/deals/new', Capabilities.MODULE_WRITE).isAllowed).toBe(true);
    });
  });

  describe('Crm2ShellController & ARIA Keyboard Navigation', () => {
    it('initializes with active route and provides accessible metadata', () => {
      const controller = new Crm2ShellController({ activeTabKey: 'deals' });
      expect(controller.getActiveRoute().id).toBe('crm2-deals');
      expect(controller.getBreadcrumbs()).toHaveLength(4);
    });

    it('navigates cyclically with ArrowRight and ArrowLeft keyboard controls', () => {
      const controller = new Crm2ShellController({ activeTabKey: 'deals' });

      // ArrowRight: index 0 (deals) -> 1 (pipeline)
      const nextIdx = controller.handleKeyNavigation('ArrowRight', 0);
      expect(nextIdx).toBe(1);
      expect(controller.getActiveRoute().path).toBe('pipeline');

      // ArrowRight: index 1 (pipeline) -> 2 (quotes)
      const quotesIdx = controller.handleKeyNavigation('ArrowRight', 1);
      expect(quotesIdx).toBe(2);
      expect(controller.getActiveRoute().path).toBe('quotes');

      // ArrowRight from last wraps to 0 (deals)
      const wrapIdx = controller.handleKeyNavigation('ArrowRight', 2);
      expect(wrapIdx).toBe(0);
      expect(controller.getActiveRoute().path).toBe('deals');

      // ArrowLeft from 0 wraps to 2 (quotes)
      const leftWrap = controller.handleKeyNavigation('ArrowLeft', 0);
      expect(leftWrap).toBe(2);
      expect(controller.getActiveRoute().path).toBe('quotes');
    });

    it('jumps to first/last tab with Home and End keys', () => {
      const controller = new Crm2ShellController({ activeTabKey: 'pipeline' });

      const homeIdx = controller.handleKeyNavigation('Home', 1);
      expect(homeIdx).toBe(0);
      expect(controller.getActiveRoute().path).toBe('deals');

      const endIdx = controller.handleKeyNavigation('End', 0);
      expect(endIdx).toBe(2);
      expect(controller.getActiveRoute().path).toBe('quotes');
    });

    it('renders accessible HTML structure matching ARIA landmark requirements', () => {
      const controller = new Crm2ShellController({ activeTabKey: 'deals' });
      const html = controller.renderHtml('<div id="test-table">Table Data</div>');

      expect(html).toContain('role="banner"');
      expect(html).toContain('aria-label="Breadcrumb"');
      expect(html).toContain('role="tablist"');
      expect(html).toContain('role="tab"');
      expect(html).toContain('role="tabpanel"');
      expect(html).toContain('role="main"');
      expect(html).toContain('cs-skip-link');
      expect(html).toContain('id="tab-crm2-deals"');
      expect(html).toContain('aria-selected="true"');
      expect(html).toContain('aria-selected="false"');
    });
  });
});
