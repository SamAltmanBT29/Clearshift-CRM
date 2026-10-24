import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import type { CRM1LeadRead } from '@clearshift/contracts';
import {
  LeadsListPage,
  LeadsTable,
  getLeads,
  getLeadById,
  createLead,
  updateLead,
  Crm1ApiError,
} from '../src/index.js';
import { TableSkeleton } from '../components/TableSkeleton.js';

// Helper to access virtual React element props safely in TypeScript strict mode
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asEl = (node: unknown): any => node as any;

const createSyntheticLead = (overrides: Partial<CRM1LeadRead> = {}): CRM1LeadRead => ({
  id: '550e8400-e29b-41d4-a716-446655440055',
  contactId: '550e8400-e29b-41d4-a716-446655440001',
  contactName: 'Jane Doe',
  contactEmail: 'jane.doe@clearshift.internal',
  status: 'Qualified',
  sourceSystem: 'crm_legacy',
  sourceId: 'LEGACY_LEAD_55',
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  ...overrides,
});

describe('Issue #9 [CRM1-04] Leads List Screen, Pipeline Stages, and UI States', () => {
  beforeEach(() => {
    const dispatcher = {
      useState: (initial: unknown) => [
        typeof initial === 'function' ? (initial as () => unknown)() : initial,
        vi.fn(),
      ],
      useId: () => ':crm1-test-id:',
      useEffect: (effect: () => void | (() => void)) => {
        const cleanup = effect();
        if (typeof cleanup === 'function') {
          // cleanup
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

  describe('1. API Client Contract & Error Handling', () => {
    it('throws Crm1ApiError with isPermissionDenied=true when 403 simulated for leads', async () => {
      await expect(
        getLeads({}, { simulatePermissionDenied: true })
      ).rejects.toThrow(Crm1ApiError);

      try {
        await getLeads({}, { simulatePermissionDenied: true });
      } catch (err: unknown) {
        const apiErr = err as Crm1ApiError;
        expect(apiErr.status).toBe(403);
        expect(apiErr.isPermissionDenied()).toBe(true);
        expect(apiErr.code).toBe('FORBIDDEN');
      }
    });

    it('throws Crm1ApiError with status=500 when server failure simulated', async () => {
      await expect(
        getLeads({}, { simulateError: true })
      ).rejects.toThrow(Crm1ApiError);

      try {
        await getLeads({}, { simulateError: true });
      } catch (err: unknown) {
        const apiErr = err as Crm1ApiError;
        expect(apiErr.status).toBe(500);
        expect(apiErr.isPermissionDenied()).toBe(false);
      }
    });
  });

  describe('2. LeadsTable Component & 4 Pipeline Lifecycle Stages', () => {
    it('renders SDS-required columns: Associated Contact, Pipeline Stage, Contact ID, Created, Actions', () => {
      const lead = createSyntheticLead({ status: 'Working' });
      const onSelect = vi.fn();
      const onEdit = vi.fn();

      const el = asEl(
        LeadsTable({
          leads: [lead],
          onSelectLead: onSelect,
          onEditLead: onEdit,
        })
      );

      expect(el).toBeDefined();
      const table = asEl(el.props.children);
      const [thead, tbody] = table.props.children;
      const headerRow = asEl(thead.props.children);
      const ths = headerRow.props.children;

      // 5 SDS columns: Associated Contact, Pipeline Stage, Contact ID, Created, Actions
      expect(ths).toHaveLength(5);
      expect(ths[0].props.children).toBe('Associated Contact');
      expect(ths[1].props.children).toBe('Pipeline Stage');
      expect(ths[2].props.children).toBe('Contact ID');
      expect(ths[3].props.children).toBe('Created');
      expect(ths[4].props.children).toBe('Actions');

      // Verify row values
      const bodyRows = tbody.props.children;
      expect(bodyRows).toHaveLength(1);
      const row = asEl(bodyRows[0]);
      const cells = row.props.children;

      // Contact name interactive link
      const contactCell = asEl(cells[0]);
      const contactBtn = asEl(contactCell.props.children);
      expect(contactBtn.props.children).toBe('Jane Doe');
      contactBtn.props.onClick();
      expect(onSelect).toHaveBeenCalledWith(lead);

      // Status badge matches 'Working'
      const statusBadge = asEl(cells[1].props.children);
      expect(statusBadge.props.children).toBe('Working');

      // Action buttons
      const actionsCell = asEl(cells[4]);
      const actionBtns = actionsCell.props.children.props.children;
      expect(actionBtns).toHaveLength(2);
      const advanceBtn = asEl(actionBtns[1]);
      advanceBtn.props.onClick();
      expect(onEdit).toHaveBeenCalledWith(lead);
    });

    it('enforces the 4 approved lifecycle lead statuses: New, Working, Qualified, Closed', () => {
      const statuses: ('New' | 'Working' | 'Qualified' | 'Closed')[] = [
        'New',
        'Working',
        'Qualified',
        'Closed',
      ];

      for (const st of statuses) {
        const lead = createSyntheticLead({ status: st });
        const el = asEl(LeadsTable({ leads: [lead] }));
        const table = asEl(el.props.children);
        const tbody = table.props.children[1];
        const row = asEl(tbody.props.children[0]);
        const statusBadge = asEl(row.props.children[1].props.children);
        expect(statusBadge.props.children).toBe(st);
      }
    });

    it('renders empty table fallback row when leads list is empty', () => {
      const el = asEl(LeadsTable({ leads: [] }));
      const table = asEl(el.props.children);
      const tbody = table.props.children[1];
      const emptyRow = asEl(tbody.props.children);
      expect(emptyRow.props.children.props.children).toContain('No records found');
    });
  });

  describe('3. LeadsListPage Vertical Slice & UI States', () => {
    it('renders loading skeleton when isLoading=true with accessible aria-busy attribute', () => {
      const el = asEl(
        LeadsListPage({
          isLoading: true,
          data: [],
        })
      );

      expect(el).toBeDefined();
      expect(el.props['data-testid']).toBe('leads-list-page');

      const children = el.props.children;
      const skeletonContainer = children.find(
        (c: any) => c && c.props && c.props['data-testid'] === 'leads-skeleton-loading'
      );
      expect(skeletonContainer).toBeDefined();
      const skeleton = asEl(skeletonContainer.props.children);
      expect(skeleton.props.ariaLabel).toBe('Loading leads pipeline from server...');
      const renderedSkeleton = asEl(TableSkeleton(skeleton.props));
      expect(renderedSkeleton.props['aria-busy']).toBe('true');
    });

    it('renders empty state when data is empty and not loading', () => {
      const onAdd = vi.fn();
      const el = asEl(
        LeadsListPage({
          isLoading: false,
          isEmpty: true,
          data: [],
          onAddLead: onAdd,
        })
      );

      const children = el.props.children;
      const emptyContainer = children.find(
        (c: any) => c && c.props && c.props['data-testid'] === 'leads-empty-state'
      );
      expect(emptyContainer).toBeDefined();
      const emptyState = asEl(emptyContainer.props.children);
      expect(emptyState.props.title).toBe('No leads created');

      emptyState.props.onAction();
      expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it('renders empty state with Clear filters action when status filter is active', () => {
      const onClearAll = vi.fn();
      const el = asEl(
        LeadsListPage({
          isLoading: false,
          data: [],
          filters: { status: 'Closed' },
          onClearAllFilters: onClearAll,
        })
      );

      const children = el.props.children;
      const emptyContainer = children.find(
        (c: any) => c && c.props && c.props['data-testid'] === 'leads-empty-state'
      );
      expect(emptyContainer).toBeDefined();
      const emptyState = asEl(emptyContainer.props.children);
      expect(emptyState.props.title).toBe('No matching leads found');
    });

    it('renders error alert with retry button when error is present', () => {
      const onRetry = vi.fn();
      const el = asEl(
        LeadsListPage({
          isLoading: false,
          data: [],
          error: 'Leads pipeline failed to load from database',
          onRetry,
        })
      );

      const children = el.props.children;
      const errorBanner = children.find(
        (c: any) => c && c.props && c.props['data-testid'] === 'crm1-error-state'
      );
      expect(errorBanner).toBeDefined();
      const errorAlert = asEl(errorBanner.props.children);
      expect(errorAlert.props.error).toBe('Leads pipeline failed to load from database');

      errorAlert.props.onRetry();
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('renders access denied view when permission is forbidden (403)', () => {
      const el = asEl(
        LeadsListPage({
          isAccessDenied: true,
          httpStatus: 403,
          requiredCapability: 'crm1.leads.read',
          currentRole: 'guest',
        })
      );

      expect(el.props['data-testid']).toBe('leads-access-denied');
      const accessView = asEl(el.props.children);
      expect(accessView.props.resourceName).toBe('Leads Pipeline');
      expect(accessView.props.requiredCapability).toBe('crm1.leads.read');
    });

    it('renders server-side pagination with default 25 pageSize and page navigation', () => {
      const onPageChange = vi.fn();
      const leads = [
        createSyntheticLead({ id: 'lead-1' }),
        createSyntheticLead({ id: 'lead-2' }),
      ];

      const el = asEl(
        LeadsListPage({
          isLoading: false,
          data: leads,
          pagination: {
            page: 2,
            pageSize: 25,
            total: 50,
            totalPages: 2,
          },
          onPageChange,
        })
      );

      const children = el.props.children;
      const tableWrapper = children.find(
        (c: any) => c && c.props && c.props['data-testid'] === 'leads-table-wrapper'
      );
      expect(tableWrapper).toBeDefined();

      const paginationNav = tableWrapper.props.children[1];
      expect(paginationNav.props.role).toBe('navigation');
      expect(paginationNav.props['aria-label']).toBe('Leads pagination navigation');

      const controls = paginationNav.props.children[1];
      const [prevBtn, pageIndicator, nextBtn] = controls.props.children;

      expect(pageIndicator.props.children).toEqual(['Page ', 2, ' of ', 2]);

      prevBtn.props.onClick();
      expect(onPageChange).toHaveBeenCalledWith(1);

      // Next button is disabled on page 2 of 2
      expect(nextBtn.props.disabled).toBe(true);
    });

    it('resets pagination to page 1 when filter changes', () => {
      const onFilterChange = vi.fn();
      const el = asEl(
        LeadsListPage({
          filters: { status: 'New' },
          onFilterChange,
          pagination: { page: 3, pageSize: 25, total: 100, totalPages: 4 },
        })
      );

      const toolbarContainer = el.props.children[1];
      const filterToolbar = asEl(toolbarContainer.props.children);

      filterToolbar.props.onFilterChange('status', 'Working');
      expect(onFilterChange).toHaveBeenCalledWith('status', 'Working');
    });
  });
});
