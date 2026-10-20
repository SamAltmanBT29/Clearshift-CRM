import { describe, it, expect, vi } from 'vitest';
import { Capabilities } from '@cs/rbac';
import { Roles } from '@cs/identity';
import {
  CRM5_BASE_PATH,
  MODULE_TITLE,
  CRM5_ROUTES,
  getAllCrm5Routes,
  findRouteByPath,
  formatBrowserTitle,
  getRouteBreadcrumbs,
} from '../../web/routes.js';
import {
  checkRouteAuth,
  HUB_LOGIN_PATH,
  ACCESS_DENIED_PATH,
} from '../../web/auth/route-guard.js';
import { Crm5ShellController } from '../../web/shell/Crm5Shell.js';
import type { UserSession } from '../../web/types.js';

describe('CRM-5 Frontend Navigation & Routes (Issue #189)', () => {
  describe('Route Definitions & Hierarchy', () => {
    it('defines all 5 required CRM-5 sub-routes', () => {
      const routes = getAllCrm5Routes();
      expect(routes).toHaveLength(5);

      const routeKeys = Object.keys(CRM5_ROUTES);
      expect(routeKeys).toEqual(['runs', 'scores', 'rejects', 'reconciliation', 'duplicates']);
    });

    it('has standard metadata and Capabilities.CONTROL_READ for all routes', () => {
      for (const route of getAllCrm5Routes()) {
        expect(route.id).toMatch(/^crm5-/);
        expect(route.fullPath).toBe(`${CRM5_BASE_PATH}/${route.path}`);
        expect(route.requiredCapability).toBe(Capabilities.CONTROL_READ);
        expect(route.breadcrumbs.length).toBeGreaterThanOrEqual(3);
        expect(route.breadcrumbs[0]?.label).toBe('ClearShift');
      }
    });

    it('findRouteByPath matches exact and trailing-slash paths', () => {
      const runRoute = findRouteByPath('/crm-5/runs');
      expect(runRoute).toBeDefined();
      expect(runRoute?.id).toBe('crm5-runs');

      const trailingSlashRoute = findRouteByPath('/crm-5/scores/');
      expect(trailingSlashRoute).toBeDefined();
      expect(trailingSlashRoute?.id).toBe('crm5-scores');

      const unknownRoute = findRouteByPath('/crm-5/unknown');
      expect(unknownRoute).toBeUndefined();
    });

    it('formats browser document titles correctly', () => {
      expect(formatBrowserTitle()).toBe(`ClearShift | ${MODULE_TITLE}`);
      expect(formatBrowserTitle('Data Quality Scores')).toBe(
        'ClearShift | CRM-5 - Data Quality Scores'
      );
    });

    it('resolves breadcrumbs for valid and fallback route keys', () => {
      const runsBreadcrumbs = getRouteBreadcrumbs('runs');
      expect(runsBreadcrumbs).toHaveLength(4);
      expect(runsBreadcrumbs[3]?.label).toBe('Runs');

      const fallbackBreadcrumbs = getRouteBreadcrumbs('unknown-key');
      expect(fallbackBreadcrumbs).toHaveLength(3);
      expect(fallbackBreadcrumbs[2]?.label).toBe('Migration Control Center');
    });
  });

  describe('Route Guard & Hub Authentication', () => {
    it('redirects unauthenticated users (null session) to Hub login with returnUrl', () => {
      const result = checkRouteAuth(null, '/crm-5/runs', Capabilities.CONTROL_READ);
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('UNAUTHENTICATED');
      expect(result.redirectTo).toBe(
        `${HUB_LOGIN_PATH}?returnUrl=${encodeURIComponent('/crm-5/runs')}`
      );
    });

    it('redirects unauthenticated users (empty session) to Hub login', () => {
      const result = checkRouteAuth({} as UserSession, '/crm-5/scores');
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('UNAUTHENTICATED');
      expect(result.redirectTo).toContain(HUB_LOGIN_PATH);
    });

    it('redirects expired sessions to Hub login with expired flag', () => {
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      const expiredSession: UserSession = {
        userId: 'usr-123',
        roles: [Roles.MIGRATION_OPERATOR],
        expiresAt: pastTime,
      };

      const result = checkRouteAuth(expiredSession, '/crm-5/rejects');
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('UNAUTHENTICATED');
      expect(result.redirectTo).toBe(
        `${HUB_LOGIN_PATH}?returnUrl=${encodeURIComponent('/crm-5/rejects')}&reason=expired`
      );
    });

    it('redirects unauthorized users to access-denied when capability is missing', () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      const sessionWithoutPerms: UserSession = {
        userId: 'usr-guest',
        roles: ['guest' as any],
        expiresAt: futureTime,
      };

      const result = checkRouteAuth(
        sessionWithoutPerms,
        '/crm-5/duplicates',
        Capabilities.CONTROL_READ
      );
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('INSUFFICIENT_PERMISSIONS');
      expect(result.redirectTo).toBe(
        `${ACCESS_DENIED_PATH}?required=${encodeURIComponent(Capabilities.CONTROL_READ)}`
      );
    });

    it('allows access for valid authenticated sessions with required capability', () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      const validSession: UserSession = {
        userId: 'usr-admin',
        roles: [Roles.ADMIN],
        expiresAt: futureTime,
      };

      const result = checkRouteAuth(validSession, '/crm-5/runs', Capabilities.CONTROL_READ);
      expect(result.isAllowed).toBe(true);
      expect(result.redirectTo).toBeUndefined();
    });
  });

  describe('Crm5ShellController & Keyboard Navigation', () => {
    it('manages active tab selection and invokes onTabSelect listener', () => {
      const onSelect = vi.fn();
      const controller = new Crm5ShellController({
        activeTabKey: 'runs',
        onTabSelect: onSelect,
      });

      expect(controller.getActiveRoute().id).toBe('crm5-runs');

      controller.selectTab('scores');
      expect(controller.getActiveRoute().id).toBe('crm5-scores');
      expect(onSelect).toHaveBeenCalledWith('scores');
    });

    it('cycles tabs via ArrowRight and ArrowLeft keyboard controls', () => {
      const controller = new Crm5ShellController({ activeTabKey: 'runs' });

      // ArrowRight from 0 -> 1
      let nextIndex = controller.handleKeyNavigation('ArrowRight', 0);
      expect(nextIndex).toBe(1);
      expect(controller.getActiveRoute().path).toBe('scores');

      // ArrowLeft from 1 -> 0
      nextIndex = controller.handleKeyNavigation('ArrowLeft', 1);
      expect(nextIndex).toBe(0);
      expect(controller.getActiveRoute().path).toBe('runs');

      // ArrowLeft wrap around from 0 -> 4
      nextIndex = controller.handleKeyNavigation('ArrowLeft', 0);
      expect(nextIndex).toBe(4);
      expect(controller.getActiveRoute().path).toBe('duplicates');

      // ArrowRight wrap around from 4 -> 0
      nextIndex = controller.handleKeyNavigation('ArrowRight', 4);
      expect(nextIndex).toBe(0);
      expect(controller.getActiveRoute().path).toBe('runs');
    });

    it('jumps to Home and End tabs', () => {
      const controller = new Crm5ShellController({ activeTabKey: 'rejects' });

      const homeIndex = controller.handleKeyNavigation('Home', 2);
      expect(homeIndex).toBe(0);
      expect(controller.getActiveRoute().path).toBe('runs');

      const endIndex = controller.handleKeyNavigation('End', 0);
      expect(endIndex).toBe(4);
      expect(controller.getActiveRoute().path).toBe('duplicates');
    });

    it('renders accessible HTML markup conforming to WAI-ARIA and landmark guidelines', () => {
      const controller = new Crm5ShellController({ activeTabKey: 'scores' });
      const html = controller.renderHtml('<div class="test-content">Table Content</div>');

      expect(html).toContain('href="#main-content"');
      expect(html).toContain('class="cs-skip-link"');
      expect(html).toContain('role="banner"');
      expect(html).toContain('role="tablist"');
      expect(html).toContain('role="tab"');
      expect(html).toContain('id="tab-crm5-scores"');
      expect(html).toContain('aria-selected="true"');
      expect(html).toContain('tabindex="0"');
      expect(html).toContain('id="tab-crm5-runs"');
      expect(html).toContain('aria-selected="false"');
      expect(html).toContain('tabindex="-1"');
      expect(html).toContain('id="main-content"');
      expect(html).toContain('role="main"');
      expect(html).toContain('role="tabpanel"');
      expect(html).toContain('class="test-content"');
    });
  });
});
