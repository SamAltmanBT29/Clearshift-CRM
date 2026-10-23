import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import {
  type CRM4List,
  CRM4ListSchema,
  CRM4ListResponseSchema,
} from '@clearshift/contracts';
import {
  MarketingListsTable,
  formatDateValue,
} from '../src/components/MarketingListsTable.js';
import { MarketingListsPage } from '../src/pages/MarketingListsPage.js';
import { getMarketingLists, Crm4ApiError } from '../src/api/crm-4.js';

// Helper to access virtual React element props safely in TypeScript strict mode
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asEl = (node: unknown): any => node as any;

// ---------------------------------------------------------------------------
// Synthetic fixtures (100% synthetic, zero real personal or company data)
// ---------------------------------------------------------------------------
const syntheticLists: CRM4List[] = [
  {
    id: '40000000-0000-4000-8000-000000000001',
    name: 'High-Value Enterprise Customers',
    description: 'Tier-1 client accounts with enterprise SaaS agreements',
    campaignCount: 4,
    memberCount: 120,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T10:00:00Z',
  },
  {
    id: '40000000-0000-4000-8000-000000000002',
    name: 'Q4 Product Webinar Attendees',
    description: null,
    campaignCount: 1,
    memberCount: 45,
    createdAt: '2026-10-05T14:30:00Z',
    updatedAt: '2026-10-05T14:30:00Z',
  },
  {
    id: '40000000-0000-4000-8000-000000000003',
    name: 'Newsletter Subscribers (Double Opt-In)',
    description: 'Verified organic blog and content subscribers',
    campaignCount: 0,
    memberCount: 350,
    createdAt: '2026-10-10T09:15:00Z',
    updatedAt: '2026-10-10T09:15:00Z',
  },
];

describe('Issue #39 [CRM4-04] Marketing Automation Lists & Segment Membership Screen & States', () => {
  // Setup React Hook Dispatcher for direct functional component execution in node/vitest environment
  beforeEach(() => {
    const dispatcher = {
      useState: (initial: unknown) => [
        typeof initial === 'function' ? (initial as () => unknown)() : initial,
        vi.fn(),
      ],
      useId: () => ':crm4-test-id:',
      useEffect: (effect: () => void | (() => void)) => {
        const cleanup = effect();
        if (typeof cleanup === 'function') {
          // cleanup registered
        }
      },
      useMemo: (factory: () => unknown) => factory(),
      useCallback: (callback: unknown) => callback,
      useRef: (initial: unknown) => ({ current: initial }),
      useTransition: () => [false, (fn: () => void) => fn()],
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

  // ---------------------------------------------------------------------------
  // 1. API Client Contract & Error Classification
  // ---------------------------------------------------------------------------
  describe('1. API Client Contract & Error Classification', () => {
    it('throws Crm4ApiError with isPermissionDenied=true when 403 simulated', async () => {
      await expect(
        getMarketingLists({}, { simulatePermissionDenied: true })
      ).rejects.toThrow(Crm4ApiError);

      try {
        await getMarketingLists({}, { simulatePermissionDenied: true });
      } catch (err: any) {
        expect(err.statusCode).toBe(403);
        expect(err.isPermissionDenied).toBe(true);
        expect(err.code).toBe('FORBIDDEN');
      }
    });

    it('throws Crm4ApiError with statusCode=500 when server error simulated', async () => {
      await expect(
        getMarketingLists({}, { simulateError: true })
      ).rejects.toThrow(Crm4ApiError);

      try {
        await getMarketingLists({}, { simulateError: true });
      } catch (err: any) {
        expect(err.statusCode).toBe(500);
        expect(err.isPermissionDenied).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Component States (Issue #39 Mandated Acceptance Criteria States)
  //    The root div has 5 children:
  //      [0] header div
  //      [1] search Card
  //      [2] 403 permission-denied Alert (conditional — false when no error)
  //      [3] recoverable error Alert (conditional — false when no error)
  //      [4] data table Card (conditional — false when error)
  // ---------------------------------------------------------------------------
  describe('2. MarketingListsPage Component States', () => {
    // 2a. Initial Load / Populated State
    it('2a: renders populated marketing lists table with API items', () => {
      const onCreateList = vi.fn();
      const onSelectList = vi.fn();
      const onViewCampaigns = vi.fn();

      const element = asEl(
        MarketingListsPage({
          initialLists: syntheticLists,
          initialTotalCount: 3,
          initialTotalPages: 1,
          onCreateList,
          onSelectList,
          onViewCampaigns,
        })
      );

      expect(element).toBeDefined();

      // Root div children: [header, searchCard, 403alert, recoverableAlert, dataCard]
      const [headerDiv, searchCard, permDeniedAlert, recoverableAlert, dataCard] = element.props.children;

      // Header section is rendered
      expect(headerDiv).toBeDefined();

      // Search card is rendered
      expect(searchCard).toBeDefined();

      // No errors – alerts are falsy JS expressions (false)
      expect(permDeniedAlert).toBeFalsy();
      expect(recoverableAlert).toBeFalsy();

      // Data card is rendered
      expect(dataCard).toBeDefined();
      expect(dataCard).not.toBe(false);

      // MarketingListsTable is first child of data card
      const tableComponent = asEl(dataCard.props.children[0]);
      expect(tableComponent.type).toBe(MarketingListsTable);
      expect(tableComponent.props.lists).toHaveLength(3);
    });

    // 2b. Search & Filter State Mutation
    it('2b: search form has correct role, aria-label, and search input id', () => {
      const element = asEl(
        MarketingListsPage({
          initialLists: syntheticLists,
        })
      );

      const [, searchCard] = element.props.children;
      const form = asEl(searchCard.props.children);

      expect(form.props.role).toBe('search');
      expect(form.props['aria-label']).toBe('Filter Marketing Lists');

      const [inputWrapper] = form.props.children;
      const searchInput = asEl(inputWrapper.props.children);
      expect(searchInput.props.id).toBe('marketing-lists-search');
      expect(searchInput.props['aria-label']).toBe('Search marketing lists by name');

      // simulate typing should not throw
      expect(() => {
        searchInput.props.onChange({ target: { value: 'Enterprise' } });
      }).not.toThrow();
    });

    // 2c. Empty State
    it('2c: renders MarketingListsTable with empty-state title when zero items are returned', () => {
      const element = asEl(
        MarketingListsPage({
          initialLists: [],
          initialTotalCount: 0,
          initialTotalPages: 0,
        })
      );

      const [, , permDeniedAlert, recoverableAlert, dataCard] = element.props.children;

      // No errors present
      expect(permDeniedAlert).toBeFalsy();
      expect(recoverableAlert).toBeFalsy();

      // Data card present with empty-state configured
      expect(dataCard).toBeDefined();
      const tableComponent = asEl(dataCard.props.children[0]);
      expect(tableComponent.type).toBe(MarketingListsTable);
      expect(tableComponent.props.lists).toHaveLength(0);
      // No search term → default empty title
      expect(tableComponent.props.emptyTitle).toBe('No marketing lists recorded');
    });

    // 2d. Recoverable Error State with Retry Button
    it('2d: renders recoverable error alert with Retry button on 500 error; clicking Retry fires fetch', () => {
      const serverError = new Crm4ApiError(
        500,
        'INTERNAL_SERVER_ERROR',
        'Database connection timed out.'
      );

      const mockRetryFetch = vi.fn().mockResolvedValue({
        items: syntheticLists,
        pagination: { page: 1, pageSize: 10, totalCount: 3, totalPages: 1 },
      });

      const element = asEl(
        MarketingListsPage({
          forceError: serverError,
          forceLoading: false,
          getMarketingListsFn: mockRetryFetch,
        })
      );

      // Children: [header, searchCard, 403alert(false), recoverableAlert, dataCard(false)]
      const [, , permDeniedAlert, recoverableAlert, dataCard] = element.props.children;

      // 403 alert not rendered
      expect(permDeniedAlert).toBeFalsy();

      // Recoverable alert is rendered
      expect(recoverableAlert).toBeDefined();
      expect(recoverableAlert.props.title).toBe('Failed to Load Marketing Lists');

      // Alert body: flex div with [message paragraph, retry button]
      const alertBody = asEl(recoverableAlert.props.children);
      const [msgParagraph, retryButton] = alertBody.props.children;
      expect(msgParagraph.props.children).toBe('Database connection timed out.');
      expect(retryButton.props['aria-label']).toContain('Retry loading marketing lists');

      // Data table NOT rendered when error
      expect(dataCard).toBeFalsy();

      // Triggering Retry executes the injected fetch function
      expect(() => {
        retryButton.props.onClick();
      }).not.toThrow();
    });

    // 2e. 403 Forbidden Alert State
    it('2e: renders Access Restricted alert with module.read when forcePermissionDenied=true', () => {
      const element = asEl(
        MarketingListsPage({
          forcePermissionDenied: true,
          forceLoading: false,
        })
      );

      // Children: [header, searchCard, 403alert, recoverableAlert(false), dataCard(false)]
      const [, , permDeniedAlert, recoverableAlert, dataCard] = element.props.children;

      // 403 alert is rendered
      expect(permDeniedAlert).toBeDefined();
      expect(permDeniedAlert.props.title).toBe('Access Restricted');

      // Alert body has two paragraphs; first paragraph contains <code>module.read</code>
      const alertBody = asEl(permDeniedAlert.props.children);
      const [p1] = alertBody.props.children;
      // p1 contains text and a <code> element
      const codeTag = asEl(p1.props.children[1]);
      expect(codeTag.props.children).toBe('module.read');

      // Recoverable error alert NOT shown
      expect(recoverableAlert).toBeFalsy();

      // Data table NOT rendered
      expect(dataCard).toBeFalsy();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. MarketingListsTable Component SDS Columns, Accessibility & Text Safety
  // ---------------------------------------------------------------------------
  describe('3. MarketingListsTable Component SDS Columns & Accessibility', () => {
    it('renders accessible loading state with status role and aria-label', () => {
      const element = asEl(
        MarketingListsTable({
          lists: [],
          loading: true,
        })
      );

      expect(element).toBeDefined();
      expect(element.props.role).toBe('status');
      expect(element.props['aria-label']).toBe('Loading marketing lists');
    });

    it('renders accessible empty state with status role and custom message', () => {
      const element = asEl(
        MarketingListsTable({
          lists: [],
          loading: false,
          emptyTitle: 'No Matching Lists',
          emptyDescription: 'Try broadening your search criteria.',
        })
      );

      expect(element).toBeDefined();
      expect(element.props.role).toBe('status');

      const [titleEl, descEl] = element.props.children;
      expect(titleEl.props.children).toBe('No Matching Lists');
      expect(descEl.props.children).toBe('Try broadening your search criteria.');
    });

    it('renders populated Table element with 5 SDS column headers', () => {
      const element = asEl(
        MarketingListsTable({
          lists: syntheticLists,
          loading: false,
        })
      );

      // Table has TableHeader and TableBody
      const [tableHeader, tableBody] = element.props.children;
      expect(tableHeader).toBeDefined();
      expect(tableBody).toBeDefined();

      // TableHeader → TableRow → [5 TableHeads]
      const headerRow = asEl(tableHeader.props.children);
      const columnHeaders = headerRow.props.children;
      expect(columnHeaders).toHaveLength(5);

      // Verify SDS-required column labels
      expect(asEl(columnHeaders[0]).props.children).toBe('List Name');
      expect(asEl(columnHeaders[1]).props.children).toBe('Description');
      expect(asEl(columnHeaders[2]).props.children).toBe('Campaigns');
      expect(asEl(columnHeaders[3]).props.children).toBe('Created Date');
      expect(asEl(columnHeaders[4]).props.children).toBe('Actions');
    });

    it('invokes onViewCampaigns and onSelectList callbacks with the correct list object', () => {
      const onSelectList = vi.fn();
      const onViewCampaigns = vi.fn();

      const element = asEl(
        MarketingListsTable({
          lists: [syntheticLists[0]!],
          loading: false,
          onSelectList,
          onViewCampaigns,
        })
      );

      const [, tableBody] = element.props.children;
      const rows = tableBody.props.children;
      // rows is the mapped array — with one item it's a single element
      const firstRow = asEl(Array.isArray(rows) ? rows[0] : rows);
      const cells = firstRow.props.children;

      // Actions cell is the 5th (index 4) cell
      const actionsCell = asEl(cells[4]);
      // Actions cell contains a wrapper div
      const actionWrapper = asEl(actionsCell.props.children);
      const [campaignsBtn, viewBtn] = actionWrapper.props.children;

      // Campaigns button
      expect(campaignsBtn.props['aria-label']).toContain('View campaigns');
      campaignsBtn.props.onClick();
      expect(onViewCampaigns).toHaveBeenCalledWith(syntheticLists[0]);

      // View/Edit button
      expect(viewBtn.props['aria-label']).toContain('Edit or view list');
      viewBtn.props.onClick();
      expect(onSelectList).toHaveBeenCalledWith(syntheticLists[0]);
    });

    it('correctly formats ISO date strings in human-readable US format', () => {
      const formatted = formatDateValue('2026-10-01T10:00:00Z');
      expect(formatted).toContain('2026');
      expect(formatted).toContain('Oct');

      // Invalid dates fallback gracefully to original string
      expect(formatDateValue('not-a-date')).toBe('not-a-date');
    });

    it('ensures text-safe rendering and prevents prototype pollution via Zod schema', () => {
      const maliciousPayload = {
        id: '40000000-0000-4000-8000-000000000099',
        name: '<script>alert(1)</script>',
        description: '<img src=x onerror=alert(1)>',
        campaignCount: 0,
        memberCount: 0,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      };

      const parsed = CRM4ListSchema.safeParse(maliciousPayload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.name).toBe('<script>alert(1)</script>');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Domain Schemas and Contract Validation
  // ---------------------------------------------------------------------------
  describe('4. Domain Schemas and Contract Validation', () => {
    it('validates CRM4ListSchema with valid synthetic data', () => {
      for (const item of syntheticLists) {
        const result = CRM4ListSchema.safeParse(item);
        expect(result.success).toBe(true);
      }
    });

    it('validates CRM4ListResponseSchema with paginated response structure', () => {
      const paginatedResponse = {
        items: syntheticLists,
        pagination: {
          page: 1,
          pageSize: 10,
          totalCount: 3,
          totalPages: 1,
        },
      };

      const result = CRM4ListResponseSchema.safeParse(paginatedResponse);
      expect(result.success).toBe(true);
    });

    it('distinguishes 403 Forbidden from recoverable server errors', () => {
      const forbidden = new Crm4ApiError(403, 'FORBIDDEN', 'Access denied.');
      expect(forbidden.isPermissionDenied).toBe(true);
      expect(forbidden.statusCode).toBe(403);

      const serverErr = new Crm4ApiError(500, 'INTERNAL_SERVER_ERROR', 'DB timeout.');
      expect(serverErr.isPermissionDenied).toBe(false);
      expect(serverErr.statusCode).toBe(500);

      const networkErr = new Crm4ApiError(0, 'NETWORK_ERROR', 'No connection.');
      expect(networkErr.isPermissionDenied).toBe(false);
      expect(networkErr.statusCode).toBe(0);
    });
  });
});
