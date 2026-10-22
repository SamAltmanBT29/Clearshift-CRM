import { describe, it, expect, vi } from 'vitest';
import { Capabilities } from '@cs/rbac';
import { Roles } from '@cs/identity';
import {
  CRM1_BASE_PATH,
  MODULE_TITLE,
  CRM1_ROUTES,
  getAllCrm1Routes,
  findRouteByPath,
  formatBrowserTitle,
  getRouteBreadcrumbs,
} from '../../web/routes.js';
import {
  checkRouteAuth,
  HUB_LOGIN_PATH,
  ACCESS_DENIED_PATH,
} from '../../web/auth/route-guard.js';
import { Crm1ShellController } from '../../web/shell/Crm1Shell.js';
import type { UserSession } from '../../web/types.js';

describe('CRM-1 Frontend Navigation & Routes (Issue #109 / [CRM1-16])', () => {
  describe('Route Definitions & Hierarchy', () => {
    it('defines all 5 required CRM-1 sub-routes', () => {
      const routes = getAllCrm1Routes();
      expect(routes).toHaveLength(5);

      const routeKeys = Object.keys(CRM1_ROUTES);
      expect(routeKeys).toEqual(['contacts', 'companies', 'leads', 'duplicates', 'imports']);
    });

    it('has standard metadata and Capabilities.MODULE_READ for all routes', () => {
      for (const route of getAllCrm1Routes()) {
        expect(route.id).toMatch(/^crm1-/);
        expect(route.fullPath).toBe(`${CRM1_BASE_PATH}/${route.path}`);
        expect(route.requiredCapability).toBe(Capabilities.MODULE_READ);
        expect(route.breadcrumbs.length).toBeGreaterThanOrEqual(3);
        expect(route.breadcrumbs[0]?.label).toBe('ClearShift');
      }
    });

    it('findRouteByPath matches exact and trailing-slash paths', () => {
      const contactsRoute = findRouteByPath('/crm-1/contacts');
      expect(contactsRoute).toBeDefined();
      expect(contactsRoute?.id).toBe('crm1-contacts');

      const trailingSlashRoute = findRouteByPath('/crm-1/companies/');
      expect(trailingSlashRoute).toBeDefined();
      expect(trailingSlashRoute?.id).toBe('crm1-companies');

      const leadsRoute = findRouteByPath('/crm-1/leads');
      expect(leadsRoute).toBeDefined();
      expect(leadsRoute?.id).toBe('crm1-leads');

      const unknownRoute = findRouteByPath('/crm-1/unknown');
      expect(unknownRoute).toBeUndefined();
    });

    it('formats browser document titles correctly', () => {
      expect(formatBrowserTitle()).toBe(`ClearShift | ${MODULE_TITLE}`);
      expect(formatBrowserTitle('Contacts Directory')).toBe(
        'ClearShift | CRM-1 - Contacts Directory'
      );
      expect(formatBrowserTitle('Leads Pipeline')).toBe(
        'ClearShift | CRM-1 - Leads Pipeline'
      );
    });

    it('resolves breadcrumbs for valid and fallback route keys', () => {
      const contactsBreadcrumbs = getRouteBreadcrumbs('contacts');
      expect(contactsBreadcrumbs).toHaveLength(4);
      expect(contactsBreadcrumbs[3]?.label).toBe('Contacts');

      const fallbackBreadcrumbs = getRouteBreadcrumbs('unknown-key');
      expect(fallbackBreadcrumbs).toHaveLength(3);
      expect(fallbackBreadcrumbs[2]?.label).toBe('Contacts & Accounts');
    });
  });

  describe('Route Guard & Hub Authentication', () => {
    it('redirects unauthenticated users (null session) to Hub login with returnUrl', () => {
      const result = checkRouteAuth(null, '/crm-1/contacts', Capabilities.MODULE_READ);
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('UNAUTHENTICATED');
      expect(result.redirectTo).toBe(
        `${HUB_LOGIN_PATH}?returnUrl=${encodeURIComponent('/crm-1/contacts')}`
      );
    });

    it('redirects unauthenticated users (empty session) to Hub login', () => {
      const result = checkRouteAuth({} as UserSession, '/crm-1/leads');
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

      const result = checkRouteAuth(expiredSession, '/crm-1/companies');
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('UNAUTHENTICATED');
      expect(result.redirectTo).toBe(
        `${HUB_LOGIN_PATH}?returnUrl=${encodeURIComponent('/crm-1/companies')}&reason=expired`
      );
    });

    it('redirects unauthorized users to access-denied when capability is missing', () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      const sessionWithoutPerms: UserSession = {
        userId: 'usr-runner',
        roles: [Roles.MIGRATION_RUNNER], // MIGRATION_RUNNER only has KIT_READ, KIT_RUN
        expiresAt: futureTime,
      };

      const result = checkRouteAuth(
        sessionWithoutPerms,
        '/crm-1/contacts',
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

      const result = checkRouteAuth(validSession, '/crm-1/contacts', Capabilities.MODULE_READ);
      expect(result.isAllowed).toBe(true);
      expect(result.redirectTo).toBeUndefined();
    });
  });

  describe('Crm1ShellController & Keyboard Navigation', () => {
    it('manages active tab selection and invokes onTabSelect listener', () => {
      const onSelect = vi.fn();
      const controller = new Crm1ShellController({
        activeTabKey: 'contacts',
        onTabSelect: onSelect,
      });

      expect(controller.getActiveRoute().id).toBe('crm1-contacts');

      controller.selectTab('companies');
      expect(controller.getActiveRoute().id).toBe('crm1-companies');
      expect(onSelect).toHaveBeenCalledWith('companies');
    });

    it('cycles tabs via ArrowRight and ArrowLeft keyboard controls', () => {
      const controller = new Crm1ShellController({ activeTabKey: 'contacts' });

      // ArrowRight from 0 -> 1
      let nextIndex = controller.handleKeyNavigation('ArrowRight', 0);
      expect(nextIndex).toBe(1);
      expect(controller.getActiveRoute().path).toBe('companies');

      // ArrowLeft from 1 -> 0
      nextIndex = controller.handleKeyNavigation('ArrowLeft', 1);
      expect(nextIndex).toBe(0);
      expect(controller.getActiveRoute().path).toBe('contacts');

      // ArrowLeft wrap around from 0 -> 4
      nextIndex = controller.handleKeyNavigation('ArrowLeft', 0);
      expect(nextIndex).toBe(4);
      expect(controller.getActiveRoute().path).toBe('imports');

      // ArrowRight wrap around from 4 -> 0
      nextIndex = controller.handleKeyNavigation('ArrowRight', 4);
      expect(nextIndex).toBe(0);
      expect(controller.getActiveRoute().path).toBe('contacts');
    });

    it('jumps to Home and End tabs', () => {
      const controller = new Crm1ShellController({ activeTabKey: 'leads' });

      const homeIndex = controller.handleKeyNavigation('Home', 2);
      expect(homeIndex).toBe(0);
      expect(controller.getActiveRoute().path).toBe('contacts');

      const endIndex = controller.handleKeyNavigation('End', 0);
      expect(endIndex).toBe(4);
      expect(controller.getActiveRoute().path).toBe('imports');
    });

    it('renders accessible HTML markup conforming to WAI-ARIA and landmark guidelines', () => {
      const controller = new Crm1ShellController({ activeTabKey: 'companies' });
      const html = controller.renderHtml('<div class="test-content">Table Content</div>');

      expect(html).toContain('href="#main-content"');
      expect(html).toContain('class="cs-skip-link"');
      expect(html).toContain('role="banner"');
      expect(html).toContain('role="tablist"');
      expect(html).toContain('role="tab"');
      expect(html).toContain('id="tab-crm1-companies"');
      expect(html).toContain('aria-selected="true"');
      expect(html).toContain('tabindex="0"');
      expect(html).toContain('id="tab-crm1-contacts"');
      expect(html).toContain('aria-selected="false"');
      expect(html).toContain('tabindex="-1"');
      expect(html).toContain('id="main-content"');
      expect(html).toContain('role="main"');
      expect(html).toContain('role="tabpanel"');
      expect(html).toContain('class="test-content"');
    });
  });
});
