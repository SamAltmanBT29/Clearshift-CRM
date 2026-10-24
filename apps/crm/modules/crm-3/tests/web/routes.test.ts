import { describe, it, expect, vi } from 'vitest';
import { Capabilities } from '@cs/rbac';
import { Roles } from '@cs/identity';
import {
  CRM3_BASE_PATH,
  MODULE_TITLE,
  CRM3_ROUTES,
  getAllCrm3Routes,
  findRouteByPath,
  formatBrowserTitle,
  getRouteBreadcrumbs,
} from '../../web/routes.js';
import {
  checkRouteAuth,
  HUB_LOGIN_PATH,
  ACCESS_DENIED_PATH,
} from '../../web/auth/route-guard.js';
import { Crm3ShellController } from '../../web/shell/Crm3Shell.js';
import type { UserSession } from '../../web/types.js';

describe('CRM-3 Frontend Navigation & Routes (Issue #149 / [CRM3-16])', () => {
  describe('Route Definitions & Hierarchy', () => {
    it('defines all 5 required CRM-3 sub-routes', () => {
      const routes = getAllCrm3Routes();
      expect(routes).toHaveLength(5);

      const routeKeys = Object.keys(CRM3_ROUTES);
      expect(routeKeys).toEqual(['tickets', 'activities', 'notes', 'sla', 'imports']);
    });

    it('has standard metadata and Capabilities.MODULE_READ for all routes', () => {
      for (const route of getAllCrm3Routes()) {
        expect(route.id).toMatch(/^crm3-/);
        expect(route.fullPath).toBe(`${CRM3_BASE_PATH}/${route.path}`);
        expect(route.requiredCapability).toBe(Capabilities.MODULE_READ);
        expect(route.breadcrumbs.length).toBeGreaterThanOrEqual(3);
        expect(route.breadcrumbs[0]?.label).toBe('ClearShift');
      }
    });

    it('findRouteByPath matches exact and trailing-slash paths', () => {
      const ticketsRoute = findRouteByPath('/crm-3/tickets');
      expect(ticketsRoute).toBeDefined();
      expect(ticketsRoute?.id).toBe('crm3-tickets');

      const trailingSlashRoute = findRouteByPath('/crm-3/activities/');
      expect(trailingSlashRoute).toBeDefined();
      expect(trailingSlashRoute?.id).toBe('crm3-activities');

      const notesRoute = findRouteByPath('/crm-3/notes');
      expect(notesRoute).toBeDefined();
      expect(notesRoute?.id).toBe('crm3-notes');

      const slaRoute = findRouteByPath('/crm-3/sla');
      expect(slaRoute).toBeDefined();
      expect(slaRoute?.id).toBe('crm3-sla');

      const unknownRoute = findRouteByPath('/crm-3/unknown');
      expect(unknownRoute).toBeUndefined();
    });

    it('formats browser document titles correctly', () => {
      expect(formatBrowserTitle()).toBe(`ClearShift | ${MODULE_TITLE}`);
      expect(formatBrowserTitle('Support Tickets Queue')).toBe(
        'ClearShift | CRM-3 - Support Tickets Queue'
      );
      expect(formatBrowserTitle('Customer Activity Timeline')).toBe(
        'ClearShift | CRM-3 - Customer Activity Timeline'
      );
    });

    it('resolves breadcrumbs for valid and fallback route keys', () => {
      const ticketsBreadcrumbs = getRouteBreadcrumbs('tickets');
      expect(ticketsBreadcrumbs).toHaveLength(4);
      expect(ticketsBreadcrumbs[3]?.label).toBe('Tickets');

      const fallbackBreadcrumbs = getRouteBreadcrumbs('unknown-key');
      expect(fallbackBreadcrumbs).toHaveLength(3);
      expect(fallbackBreadcrumbs[2]?.label).toBe('Support & Tickets');
    });
  });

  describe('Route Guard & Hub Authentication', () => {
    it('redirects unauthenticated users (null session) to Hub login with returnUrl', () => {
      const result = checkRouteAuth(null, '/crm-3/tickets', Capabilities.MODULE_READ);
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('UNAUTHENTICATED');
      expect(result.redirectTo).toBe(
        `${HUB_LOGIN_PATH}?returnUrl=${encodeURIComponent('/crm-3/tickets')}`
      );
    });

    it('redirects unauthenticated users (empty session) to Hub login', () => {
      const result = checkRouteAuth({} as UserSession, '/crm-3/activities');
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

      const result = checkRouteAuth(expiredSession, '/crm-3/notes');
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('UNAUTHENTICATED');
      expect(result.redirectTo).toBe(
        `${HUB_LOGIN_PATH}?returnUrl=${encodeURIComponent('/crm-3/notes')}&reason=expired`
      );
    });

    it('redirects disabled users to Hub login with disabled flag', () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      const disabledSession: UserSession = {
        userId: 'usr-disabled',
        roles: [Roles.VIEWER],
        expiresAt: futureTime,
        disabled: true,
      };

      const result = checkRouteAuth(disabledSession, '/crm-3/tickets');
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('UNAUTHENTICATED');
      expect(result.redirectTo).toBe(
        `${HUB_LOGIN_PATH}?returnUrl=${encodeURIComponent('/crm-3/tickets')}&reason=disabled`
      );
    });

    it('redirects unauthorized users to access-denied when capability is missing', () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      const sessionWithoutPerms: UserSession = {
        userId: 'usr-runner',
        roles: [Roles.MIGRATION_RUNNER], // MIGRATION_RUNNER has KIT_READ, KIT_RUN
        expiresAt: futureTime,
      };

      const result = checkRouteAuth(
        sessionWithoutPerms,
        '/crm-3/tickets',
        Capabilities.MODULE_READ
      );
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('INSUFFICIENT_PERMISSIONS');
      expect(result.redirectTo).toBe(
        `${ACCESS_DENIED_PATH}?required=${encodeURIComponent(Capabilities.MODULE_READ)}`
      );
    });

    it('allows access for valid authenticated sessions with required capability', () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      const validSession: UserSession = {
        userId: 'usr-viewer',
        roles: [Roles.VIEWER],
        expiresAt: futureTime,
      };

      const result = checkRouteAuth(validSession, '/crm-3/tickets', Capabilities.MODULE_READ);
      expect(result.isAllowed).toBe(true);
      expect(result.redirectTo).toBeUndefined();
    });
  });

  describe('Crm3ShellController & Keyboard Navigation', () => {
    it('manages active tab selection and invokes onTabSelect listener', () => {
      const onSelect = vi.fn();
      const controller = new Crm3ShellController({
        activeTabKey: 'tickets',
        onTabSelect: onSelect,
      });

      expect(controller.getActiveRoute().id).toBe('crm3-tickets');

      controller.selectTab('activities');
      expect(controller.getActiveRoute().id).toBe('crm3-activities');
      expect(onSelect).toHaveBeenCalledWith('activities');
    });

    it('cycles tabs via ArrowRight and ArrowLeft keyboard controls', () => {
      const controller = new Crm3ShellController({ activeTabKey: 'tickets' });

      // ArrowRight from 0 -> 1
      let nextIndex = controller.handleKeyNavigation('ArrowRight', 0);
      expect(nextIndex).toBe(1);
      expect(controller.getActiveRoute().path).toBe('activities');

      // ArrowLeft from 1 -> 0
      nextIndex = controller.handleKeyNavigation('ArrowLeft', 1);
      expect(nextIndex).toBe(0);
      expect(controller.getActiveRoute().path).toBe('tickets');

      // ArrowLeft wrap around from 0 -> 4
      nextIndex = controller.handleKeyNavigation('ArrowLeft', 0);
      expect(nextIndex).toBe(4);
      expect(controller.getActiveRoute().path).toBe('imports');

      // ArrowRight wrap around from 4 -> 0
      nextIndex = controller.handleKeyNavigation('ArrowRight', 4);
      expect(nextIndex).toBe(0);
      expect(controller.getActiveRoute().path).toBe('tickets');
    });

    it('jumps to Home and End tabs', () => {
      const controller = new Crm3ShellController({ activeTabKey: 'notes' });

      const homeIndex = controller.handleKeyNavigation('Home', 2);
      expect(homeIndex).toBe(0);
      expect(controller.getActiveRoute().path).toBe('tickets');

      const endIndex = controller.handleKeyNavigation('End', 0);
      expect(endIndex).toBe(4);
      expect(controller.getActiveRoute().path).toBe('imports');
    });

    it('renders accessible HTML markup conforming to WAI-ARIA and landmark guidelines', () => {
      const controller = new Crm3ShellController({ activeTabKey: 'activities' });
      const html = controller.renderHtml('<div class="test-content">Tickets Content</div>');

      expect(html).toContain('href="#main-content"');
      expect(html).toContain('class="cs-skip-link"');
      expect(html).toContain('role="banner"');
      expect(html).toContain('role="tablist"');
      expect(html).toContain('role="tab"');
      expect(html).toContain('id="tab-crm3-activities"');
      expect(html).toContain('aria-selected="true"');
      expect(html).toContain('tabindex="0"');
      expect(html).toContain('id="tab-crm3-tickets"');
      expect(html).toContain('aria-selected="false"');
      expect(html).toContain('tabindex="-1"');
      expect(html).toContain('id="main-content"');
      expect(html).toContain('role="main"');
      expect(html).toContain('role="tabpanel"');
      expect(html).toContain('class="test-content"');
    });
  });
});
