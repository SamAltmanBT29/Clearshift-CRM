import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Crm3Shell } from '../shell/Crm3Shell.js';
import {
  TicketsListPage,
  TICKETS_COLUMNS,
  ActivitiesTimelinePage,
  TicketNotesPage,
  SlaTrackingPage,
  ImportsOverviewPage,
} from '../index.js';
import { CRM3_ROUTES, formatBrowserTitle, getAllCrm3Routes } from '../routes.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asEl = (node: unknown): any => node as any;

describe('CRM-3 Web Shell & Browser Journey Test Suite ([CRM3-10] / Issue #35)', () => {
  beforeEach(() => {
    const dispatcher = {
      useState: (initial: unknown) => [
        typeof initial === 'function' ? (initial as () => unknown)() : initial,
        vi.fn(),
      ],
      useId: () => ':crm3-journey-id:',
      useEffect: (effect: () => void | (() => void)) => {
        const cleanup = effect();
        if (typeof cleanup === 'function') {
          // cleanup registered
        }
      },
      useMemo: (factory: () => unknown) => factory(),
      useCallback: (callback: unknown) => callback,
      useRef: (initial: unknown) => ({ current: initial }),
    };

    const reactInternals = (React as unknown as {
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: {
        H?: unknown;
      };
    }).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

    if (reactInternals) {
      reactInternals.H = dispatcher;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. WAI-ARIA Landmark Structure & Layout Shell
  // =========================================================================
  describe('Journey 1: Layout Shell & Accessibility Landmarks', () => {
    it('renders skip link, banner, breadcrumbs, tablist, and main landmark', () => {
      const onTabSelect = vi.fn();
      const shell = Crm3Shell({
        activeTabKey: '/crm-3/tickets',
        onTabSelect,
        children: React.createElement('div', { id: 'page-child' }, 'Ticket content'),
      });

      expect(shell).toBeDefined();
      const rootDiv = asEl(shell);
      expect(rootDiv.props.className).toContain('cs-crm3-shell');

      // Verify skip link
      const skipLink = rootDiv.props.children[0];
      expect(skipLink.props.href).toBe('#main-content');
      expect(skipLink.props.className).toBe('cs-skip-link');

      // Verify header banner
      const header = rootDiv.props.children[1];
      expect(header.props.role).toBe('banner');
      expect(header.props.className).toContain('cs-shell-header');

      // Verify breadcrumb nav inside header
      const breadcrumbNav = header.props.children[0];
      expect(breadcrumbNav.props.role).toBeUndefined();
      expect(breadcrumbNav.props['aria-label']).toBe('Breadcrumb');

      // Verify tablist navigation
      const tabNav = rootDiv.props.children[2];
      expect(tabNav.props.role).toBe('tablist');
      expect(tabNav.props['aria-label']).toBe('Module Navigation');

      // Verify main content landmark
      const main = rootDiv.props.children[3];
      expect(main.props.role).toBe('main');
      expect(main.props.id).toBe('main-content');

      // Verify tabpanel section inside main
      const tabPanel = main.props.children;
      expect(tabPanel.props.role).toBe('tabpanel');
      expect(tabPanel.props['aria-labelledby']).toBe('tab-crm3-tickets');
    });

    it('renders all 5 registered navigation tabs with correct active states', () => {
      const onTabSelect = vi.fn();
      const shell = asEl(
        Crm3Shell({
          activeTabKey: '/crm-3/tickets',
          onTabSelect,
        })
      );

      const tabNav = shell.props.children[2];
      const tabs = tabNav.props.children;
      expect(tabs).toHaveLength(5);

      const expectedTabs = [
        { id: 'tab-crm3-tickets', label: 'Tickets', selected: true },
        { id: 'tab-crm3-activities', label: 'Activities', selected: false },
        { id: 'tab-crm3-notes', label: 'Notes', selected: false },
        { id: 'tab-crm3-sla', label: 'SLA Tracking', selected: false },
        { id: 'tab-crm3-imports', label: 'Imports', selected: false },
      ];

      for (let i = 0; i < expectedTabs.length; i++) {
        const btn = tabs[i];
        const expected = expectedTabs[i]!;
        expect(btn.props.role).toBe('tab');
        expect(btn.props.id).toBe(expected.id);
        expect(btn.props['aria-selected']).toBe(expected.selected);
      }
    });

    it('supports tab navigation callback when tab button is selected', () => {
      const onTabSelect = vi.fn();
      const shell = asEl(
        Crm3Shell({
          activeTabKey: '/crm-3/tickets',
          onTabSelect,
        })
      );

      const tabNav = shell.props.children[2];
      const activitiesTab = tabNav.props.children[1];
      activitiesTab.props.onClick();

      expect(onTabSelect).toHaveBeenCalledWith('activities');
    });

    it('formats browser title conforming to ClearShift standards', () => {
      expect(formatBrowserTitle('Support Tickets Queue')).toBe(
        'ClearShift | CRM-3 - Support Tickets Queue'
      );
      expect(formatBrowserTitle('Import Batches')).toBe(
        'ClearShift | CRM-3 - Import Batches'
      );
    });
  });

  // =========================================================================
  // 2. Tickets Queue Sub-View Browser Journey
  // =========================================================================
  describe('Journey 2: Support Tickets Queue Page Journey', () => {
    it('displays TableSkeleton when loading', () => {
      const page = asEl(TicketsListPage({ isLoading: true }));
      expect(page).toBeDefined();

      const skeletonContainer = page.props.children[1].props.children;
      expect(skeletonContainer).toBeDefined();
    });

    it('displays EmptyState with action when queue has no tickets', () => {
      const onEmptyAction = vi.fn();
      const page = asEl(
        TicketsListPage({
          isEmpty: true,
          emptyActionLabel: 'Create New Ticket',
          onEmptyAction,
        })
      );

      const emptyStateContainer = page.props.children[1].props.children;
      expect(emptyStateContainer).toBeDefined();
    });

    it('displays ErrorAlert with retry option when API error occurs', () => {
      const onRetry = vi.fn();
      const page = asEl(
        TicketsListPage({
          error: {
            code: 'GATEWAY_TIMEOUT',
            message: 'Failed to communicate with CRM tickets service',
          },
          onRetry,
        })
      );

      const errorSection = page.props.children[1].props.children[0];
      expect(errorSection.props.className).toBe('cs-error-container');
    });

    it('displays AccessDeniedView when user receives 403 Forbidden', () => {
      const page = asEl(
        TicketsListPage({
          httpStatus: 403,
          isAccessDenied: true,
          requiredRole: 'editor',
          currentRole: 'viewer',
        })
      );

      const accessDenied = page.props.children[1];
      expect(accessDenied.props.resourceName).toBe('Support Tickets Queue');
      expect(accessDenied.props.requiredRole).toBe('editor');
      expect(accessDenied.props.currentRole).toBe('viewer');
    });

    it('renders tickets table with expected column definitions when data is present', () => {
      const syntheticTickets = [
        {
          id: 'ticket-001',
          subject: 'Payment processing error on order ORD-123',
          status: 'Open',
          priority: 'High',
          contact_id: 'contact-001',
          order_ref: 'ORD-123',
          created_at: '2026-10-24T10:00:00Z',
        },
      ];

      const page = asEl(TicketsListPage({ data: syntheticTickets }));
      const cardSection = page.props.children[1].props.children[1];

      expect(cardSection.props.className).toBe('cs-page-card');
      expect(cardSection.props.children.props.children).toEqual([1, ' tickets loaded.']);
      expect(TICKETS_COLUMNS).toHaveLength(8);
      expect(TICKETS_COLUMNS[0]!.header).toBe('Ticket ID');
      expect(TICKETS_COLUMNS[1]!.header).toBe('Subject');
      expect(TICKETS_COLUMNS[2]!.header).toBe('Status');
      expect(TICKETS_COLUMNS[3]!.header).toBe('Priority');
    });
  });

  // =========================================================================
  // 3. Notes, Activities, SLA, and Imports Sub-Views
  // =========================================================================
  describe('Journey 3: Auxiliary Sub-views Contract & Landmark Verification', () => {
    it('renders ActivitiesTimelinePage layout and header', () => {
      const page = asEl(ActivitiesTimelinePage({}));
      expect(page.props.className).toBe('cs-page-container');
      const header = page.props.children[0];
      expect(header.props.children[0].props.children).toBe('Customer Activity Timeline');
    });

    it('renders TicketNotesPage with internal notes queue', () => {
      const page = asEl(TicketNotesPage({}));
      expect(page.props.className).toBe('cs-page-container');
      const header = page.props.children[0];
      expect(header.props.children[0].props.children).toBe('Internal Ticket Notes');
    });

    it('renders SlaTrackingPage with SLA tracking overview', () => {
      const page = asEl(SlaTrackingPage({}));
      expect(page.props.className).toBe('cs-page-container');
      const header = page.props.children[0];
      expect(header.props.children[0].props.children).toBe('SLA Tracking & Priority Escalations');
    });

    it('renders ImportsOverviewPage with migration batch monitoring', () => {
      const page = asEl(ImportsOverviewPage({}));
      expect(page.props.className).toBe('cs-page-container');
      const header = page.props.children[0];
      expect(header.props.children[0].props.children).toBe('Import Batches & Receipts');
    });
  });
});
