import { describe, it, expect, vi } from 'vitest';
import { Capabilities } from '@cs/rbac';
import { Roles } from '@cs/identity';
import {
  CRM4_BASE_PATH,
  MODULE_TITLE,
  CRM4_ROUTES,
  getAllCrm4Routes,
  findRouteByPath,
  formatBrowserTitle,
  getRouteBreadcrumbs,
} from '../../web/routes.js';
import {
  checkRouteAuth,
  HUB_LOGIN_PATH,
  ACCESS_DENIED_PATH,
} from '../../web/auth/route-guard.js';
import { Crm4ShellController } from '../../web/shell/Crm4Shell.js';
import type { UserSession } from '../../web/types.js';

describe('CRM-4 Frontend Navigation & Routes (Issue #169 / [CRM4-16])', () => {
  describe('Route Definitions & Hierarchy', () => {
    it('defines all 5 required CRM-4 sub-routes', () => {
      const routes = getAllCrm4Routes();
      expect(routes).toHaveLength(5);

      const routeKeys = Object.keys(CRM4_ROUTES);
      expect(routeKeys).toEqual(['lists', 'campaigns', 'members', 'consents', 'imports']);
    });

    it('has standard metadata and Capabilities.MODULE_READ for all routes', () => {
      for (const route of getAllCrm4Routes()) {
        expect(route.id).toMatch(/^crm4-/);
        expect(route.fullPath).toBe(`${CRM4_BASE_PATH}/${route.path}`);
        expect(route.requiredCapability).toBe(Capabilities.MODULE_READ);
        expect(route.breadcrumbs.length).toBeGreaterThanOrEqual(3);
        expect(route.breadcrumbs[0]?.label).toBe('ClearShift');
      }
    });

    it('findRouteByPath matches exact and trailing-slash paths', () => {
      const listsRoute = findRouteByPath('/crm-4/lists');
      expect(listsRoute).toBeDefined();
      expect(listsRoute?.id).toBe('crm4-lists');

      const trailingSlashRoute = findRouteByPath('/crm-4/campaigns/');
      expect(trailingSlashRoute).toBeDefined();
      expect(trailingSlashRoute?.id).toBe('crm4-campaigns');

      const consentsRoute = findRouteByPath('/crm-4/consents');
      expect(consentsRoute).toBeDefined();
      expect(consentsRoute?.id).toBe('crm4-consents');

      const unknownRoute = findRouteByPath('/crm-4/unknown');
      expect(unknownRoute).toBeUndefined();
    });

    it('formats browser document titles correctly', () => {
      expect(formatBrowserTitle()).toBe(`ClearShift | ${MODULE_TITLE}`);
      expect(formatBrowserTitle('Marketing Lists Directory')).toBe(
        'ClearShift | CRM-4 - Marketing Lists Directory'
      );
      expect(formatBrowserTitle('Consent State & Monotonic Opt-Out')).toBe(
        'ClearShift | CRM-4 - Consent State & Monotonic Opt-Out'
      );
    });

    it('resolves breadcrumbs for valid and fallback route keys', () => {
      const listsBreadcrumbs = getRouteBreadcrumbs('lists');
      expect(listsBreadcrumbs).toHaveLength(4);
      expect(listsBreadcrumbs[3]?.label).toBe('Marketing Lists');

      const fallbackBreadcrumbs = getRouteBreadcrumbs('unknown-key');
      expect(fallbackBreadcrumbs).toHaveLength(3);
      expect(fallbackBreadcrumbs[2]?.label).toBe('Marketing & Campaigns');
    });

    it('enforces CRM-4 domain scope and business rule labels (BR-CRM4-01)', () => {
      const consentRoute = CRM4_ROUTES.consents;
      expect(consentRoute.title).toContain('Consent State');
      expect(consentRoute.navLabel).toBe('Consent Records');

      const campaignRoute = CRM4_ROUTES.campaigns;
      expect(campaignRoute.title).toContain('Campaign History & Recording');
    });
  });

  describe('Route Guard & Hub Authentication', () => {
    it('redirects unauthenticated users (null session) to Hub login with returnUrl', () => {
      const result = checkRouteAuth(null, '/crm-4/lists', Capabilities.MODULE_READ);
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('UNAUTHENTICATED');
      expect(result.redirectTo).toBe(
        `${HUB_LOGIN_PATH}?returnUrl=${encodeURIComponent('/crm-4/lists')}`
      );
    });

    it('redirects unauthenticated users (empty session) to Hub login', () => {
      const result = checkRouteAuth({} as UserSession, '/crm-4/campaigns');
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('UNAUTHENTICATED');
      expect(result.redirectTo).toContain(HUB_LOGIN_PATH);
    });

    it('redirects disabled users to Hub login with disabled flag', () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      const disabledSession: UserSession = {
        userId: 'usr-disabled',
        roles: [Roles.VIEWER],
        expiresAt: futureTime,
        disabled: true,
      };

      const result = checkRouteAuth(disabledSession, '/crm-4/consents');
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('UNAUTHENTICATED');
      expect(result.redirectTo).toBe(
        `${HUB_LOGIN_PATH}?returnUrl=${encodeURIComponent('/crm-4/consents')}&reason=disabled`
      );
    });

    it('redirects expired sessions to Hub login with expired flag', () => {
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      const expiredSession: UserSession = {
        userId: 'usr-123',
        roles: [Roles.VIEWER],
        expiresAt: pastTime,
      };

      const result = checkRouteAuth(expiredSession, '/crm-4/campaigns');
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('UNAUTHENTICATED');
      expect(result.redirectTo).toBe(
        `${HUB_LOGIN_PATH}?returnUrl=${encodeURIComponent('/crm-4/campaigns')}&reason=expired`
      );
    });

    it('redirects unauthorized users to access-denied when capability is missing', () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      const sessionWithoutPerms: UserSession = {
        userId: 'usr-runner',
        roles: [Roles.MIGRATION_RUNNER], // MIGRATION_RUNNER has KIT_READ, KIT_RUN; lacks MODULE_READ
        expiresAt: futureTime,
      };

      const result = checkRouteAuth(
        sessionWithoutPerms,
        '/crm-4/lists',
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
      const viewerSession: UserSession = {
        userId: 'usr-viewer',
        roles: [Roles.VIEWER],
        expiresAt: futureTime,
      };

      const result = checkRouteAuth(viewerSession, '/crm-4/lists', Capabilities.MODULE_READ);
      expect(result.isAllowed).toBe(true);
      expect(result.redirectTo).toBeUndefined();

      const editorSession: UserSession = {
        userId: 'usr-editor',
        roles: [Roles.EDITOR],
        expiresAt: futureTime,
      };
      expect(checkRouteAuth(editorSession, '/crm-4/consents', Capabilities.MODULE_READ).isAllowed).toBe(true);
    });
  });

  describe('Crm4ShellController & Keyboard Navigation', () => {
    it('manages active tab selection and invokes onTabSelect listener', () => {
      const onSelect = vi.fn();
      const controller = new Crm4ShellController({
        activeTabKey: 'lists',
        onTabSelect: onSelect,
      });

      expect(controller.getActiveRoute().id).toBe('crm4-lists');

      controller.selectTab('campaigns');
      expect(controller.getActiveRoute().id).toBe('crm4-campaigns');
      expect(onSelect).toHaveBeenCalledWith('campaigns');
    });

    it('cycles tabs via ArrowRight and ArrowLeft keyboard controls', () => {
      const controller = new Crm4ShellController({ activeTabKey: 'lists' });

      // ArrowRight from 0 -> 1
      let nextIndex = controller.handleKeyNavigation('ArrowRight', 0);
      expect(nextIndex).toBe(1);
      expect(controller.getActiveRoute().path).toBe('campaigns');

      // ArrowLeft from 1 -> 0
      nextIndex = controller.handleKeyNavigation('ArrowLeft', 1);
      expect(nextIndex).toBe(0);
      expect(controller.getActiveRoute().path).toBe('lists');

      // ArrowLeft wrap around from 0 -> 4
      nextIndex = controller.handleKeyNavigation('ArrowLeft', 0);
      expect(nextIndex).toBe(4);
      expect(controller.getActiveRoute().path).toBe('imports');

      // ArrowRight wrap around from 4 -> 0
      nextIndex = controller.handleKeyNavigation('ArrowRight', 4);
      expect(nextIndex).toBe(0);
      expect(controller.getActiveRoute().path).toBe('lists');
    });

    it('jumps to Home and End tabs', () => {
      const controller = new Crm4ShellController({ activeTabKey: 'members' });

      const homeIndex = controller.handleKeyNavigation('Home', 2);
      expect(homeIndex).toBe(0);
      expect(controller.getActiveRoute().path).toBe('lists');

      const endIndex = controller.handleKeyNavigation('End', 0);
      expect(endIndex).toBe(4);
      expect(controller.getActiveRoute().path).toBe('imports');
    });

    it('renders accessible HTML markup conforming to WAI-ARIA and landmark guidelines', () => {
      const controller = new Crm4ShellController({ activeTabKey: 'campaigns' });
      const html = controller.renderHtml('<div class="test-content">Table Content</div>');

      expect(html).toContain('href="#main-content"');
      expect(html).toContain('class="cs-skip-link"');
      expect(html).toContain('role="banner"');
      expect(html).toContain('role="tablist"');
      expect(html).toContain('role="tab"');
      expect(html).toContain('id="tab-crm4-campaigns"');
      expect(html).toContain('aria-selected="true"');
      expect(html).toContain('tabindex="0"');
      expect(html).toContain('id="tab-crm4-lists"');
      expect(html).toContain('aria-selected="false"');
      expect(html).toContain('tabindex="-1"');
      expect(html).toContain('id="main-content"');
      expect(html).toContain('role="main"');
      expect(html).toContain('role="tabpanel"');
      expect(html).toContain('class="test-content"');
    });
  });
});
