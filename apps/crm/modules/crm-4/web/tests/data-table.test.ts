import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import {
  DataTableController,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../table/DataTableController.js';
import {
  MARKETING_LISTS_COLUMNS,
  CAMPAIGNS_COLUMNS,
  MEMBERS_COLUMNS,
  CONSENTS_COLUMNS,
  IMPORTS_COLUMNS,
} from '../table/columns.js';
import { DataTable } from '../src/components/DataTable.js';
import { MarketingListsTable } from '../src/components/MarketingListsTable.js';
import { MarketingListsPage } from '../src/pages/MarketingListsPage.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asEl = (node: unknown): any => node as any;

describe('Issue #170 [CRM4-17] CRM-4 Marketing Automation Main Paginated Data Table', () => {
  beforeEach(() => {
    const dispatcher = {
      useState: (initial: unknown) => [
        typeof initial === 'function' ? (initial as () => unknown)() : initial,
        vi.fn(),
      ],
      useId: () => ':crm4-test-id:',
      useCallback: (fn: unknown) => fn,
      useEffect: () => {},
      useTransition: () => [false, (fn: () => void) => fn()],
      useMemo: (fn: () => unknown) => fn(),
      useRef: (initial: unknown) => ({ current: initial }),
    };

    const ReactSharedInternals =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

    if (ReactSharedInternals) {
      ReactSharedInternals.H = dispatcher;
      ReactSharedInternals.ReactCurrentDispatcher = { current: dispatcher };
    }
  });

  describe('1. Column Definitions & Data Dictionary Alignment (AC 1)', () => {
    it('defines stable columns for Marketing Lists matching Data Dictionary §2.1', () => {
      const keys = MARKETING_LISTS_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'id',
        'name',
        'description',
        'campaignCount',
        'memberCount',
        'createdAt',
        'updatedAt',
      ]);

      const sortableKeys = MARKETING_LISTS_COLUMNS.filter((c) => c.sortable).map((c) => c.key);
      expect(sortableKeys).toContain('id');
      expect(sortableKeys).toContain('name');
      expect(sortableKeys).toContain('campaignCount');
      expect(sortableKeys).toContain('memberCount');
      expect(sortableKeys).toContain('createdAt');
      expect(sortableKeys).toContain('updatedAt');

      // Description is non-sortable free text
      const descCol = MARKETING_LISTS_COLUMNS.find((c) => c.key === 'description');
      expect(descCol?.sortable).toBe(false);
    });

    it('defines stable columns for Campaigns matching Data Dictionary §2.2', () => {
      const keys = CAMPAIGNS_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'id',
        'name',
        'campaignDate',
        'listId',
        'memberCount',
        'createdAt',
        'updatedAt',
      ]);

      const sortableKeys = CAMPAIGNS_COLUMNS.filter((c) => c.sortable).map((c) => c.key);
      expect(sortableKeys).toContain('id');
      expect(sortableKeys).toContain('name');
      expect(sortableKeys).toContain('campaignDate');
      expect(sortableKeys).toContain('listId');
      expect(sortableKeys).toContain('memberCount');
      expect(sortableKeys).toContain('createdAt');
    });

    it('defines stable columns for Campaign Members matching Data Dictionary §2.3', () => {
      const keys = MEMBERS_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'id',
        'campaignId',
        'contactId',
        'status',
        'unsubscribed',
        'createdAt',
      ]);

      const statusCol = MEMBERS_COLUMNS.find((c) => c.key === 'status');
      expect(statusCol?.align).toBe('center');

      const unsubCol = MEMBERS_COLUMNS.find((c) => c.key === 'unsubscribed');
      expect(unsubCol?.align).toBe('center');
    });

    it('defines stable columns for Consent Records matching Data Dictionary §2.4', () => {
      const keys = CONSENTS_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'id',
        'contactId',
        'status',
        'consentDate',
        'source',
        'createdAt',
        'updatedAt',
      ]);

      const sortableKeys = CONSENTS_COLUMNS.filter((c) => c.sortable).map((c) => c.key);
      expect(sortableKeys).toContain('id');
      expect(sortableKeys).toContain('contactId');
      expect(sortableKeys).toContain('status');
      expect(sortableKeys).toContain('consentDate');
      expect(sortableKeys).toContain('source');
    });

    it('defines stable columns for Migration Import Receipts matching Data Dictionary §2.6', () => {
      const keys = IMPORTS_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'id',
        'batchId',
        'sourceRow',
        'entity',
        'sourceSystem',
        'sourceId',
        'targetId',
        'createdAt',
      ]);
      const rowCol = IMPORTS_COLUMNS.find((c) => c.key === 'sourceRow');
      expect(rowCol?.align).toBe('right');
    });
  });

  describe('2. Server-side Pagination & Bounded Controls (AC 2 & AC 4)', () => {
    it('initializes with default page size 25 and page 1', () => {
      const controller = new DataTableController({
        columns: MARKETING_LISTS_COLUMNS,
      });

      const pagination = controller.getPagination();
      expect(pagination.page).toBe(1);
      expect(pagination.pageSize).toBe(DEFAULT_PAGE_SIZE);
      expect(pagination.total).toBe(0);
      expect(pagination.totalPages).toBe(1);
    });

    it('enforces maximum page size of 100 to prevent DOM degradation', () => {
      const controller = new DataTableController({
        columns: MARKETING_LISTS_COLUMNS,
        initialPageSize: 500, // Attempt exceeding limit
      });

      expect(controller.getPagination().pageSize).toBe(MAX_PAGE_SIZE);

      controller.setPageSize(250);
      expect(controller.getPagination().pageSize).toBe(MAX_PAGE_SIZE);
    });

    it('computes totalPages correctly and clamps page navigation within bounds', () => {
      const onQueryChange = vi.fn();
      const controller = new DataTableController({
        columns: MARKETING_LISTS_COLUMNS,
        initialPageSize: 25,
        onQueryChange,
      });

      controller.setTotal(120);
      const pagination = controller.getPagination();
      expect(pagination.total).toBe(120);
      expect(pagination.totalPages).toBe(5); // ceil(120 / 25) = 5

      // Navigate within bounds
      controller.setPage(3);
      expect(controller.getPagination().page).toBe(3);
      expect(onQueryChange).toHaveBeenCalledWith(
        expect.objectContaining({ page: '3', pageSize: '25' })
      );

      // Attempt navigating beyond upper bound
      controller.setPage(10);
      expect(controller.getPagination().page).toBe(5);

      // Attempt navigating below lower bound
      controller.setPage(-1);
      expect(controller.getPagination().page).toBe(1);
    });

    it('supports sequential nextPage and previousPage navigation', () => {
      const controller = new DataTableController({
        columns: MARKETING_LISTS_COLUMNS,
        initialPageSize: 20,
      });
      controller.setTotal(60); // 3 pages

      expect(controller.getPagination().page).toBe(1);

      expect(controller.previousPage()).toBe(false); // Can't go below page 1
      expect(controller.getPagination().page).toBe(1);

      expect(controller.nextPage()).toBe(true);
      expect(controller.getPagination().page).toBe(2);

      expect(controller.nextPage()).toBe(true);
      expect(controller.getPagination().page).toBe(3);

      expect(controller.nextPage()).toBe(false); // Can't go beyond totalPages (3)
      expect(controller.getPagination().page).toBe(3);

      expect(controller.previousPage()).toBe(true);
      expect(controller.getPagination().page).toBe(2);
    });

    it('automatically resets page to 1 when page size changes', () => {
      const controller = new DataTableController({
        columns: MARKETING_LISTS_COLUMNS,
        initialPageSize: 10,
      });
      controller.setTotal(100);
      controller.setPage(5);
      expect(controller.getPagination().page).toBe(5);

      controller.setPageSize(50);
      expect(controller.getPagination().pageSize).toBe(50);
      expect(controller.getPagination().page).toBe(1);
    });
  });

  describe('3. Sortable Headers & Direction Toggling (AC 3)', () => {
    it('toggles sort direction predictably: asc -> desc -> asc', () => {
      const onQueryChange = vi.fn();
      const controller = new DataTableController({
        columns: MARKETING_LISTS_COLUMNS,
        onQueryChange,
      });

      // First click on 'name' activates asc
      let sort = controller.toggleSort('name');
      expect(sort).toEqual({ columnKey: 'name', direction: 'asc' });
      expect(controller.getSort()).toEqual({ columnKey: 'name', direction: 'asc' });

      // Second click on 'name' toggles to desc
      sort = controller.toggleSort('name');
      expect(sort).toEqual({ columnKey: 'name', direction: 'desc' });

      // Third click on 'name' toggles back to asc
      sort = controller.toggleSort('name');
      expect(sort).toEqual({ columnKey: 'name', direction: 'asc' });
    });

    it('starts with asc when switching to a different sort column', () => {
      const controller = new DataTableController({
        columns: MARKETING_LISTS_COLUMNS,
      });

      controller.toggleSort('name'); // asc
      controller.toggleSort('name'); // desc
      expect(controller.getSort()).toEqual({ columnKey: 'name', direction: 'desc' });

      // Switching to 'campaignCount' starts with 'asc'
      const sort = controller.toggleSort('campaignCount');
      expect(sort).toEqual({ columnKey: 'campaignCount', direction: 'asc' });
    });

    it('ignores sorting for non-sortable columns', () => {
      const controller = new DataTableController({
        columns: MARKETING_LISTS_COLUMNS,
      });

      controller.toggleSort('name');
      expect(controller.getSort()?.columnKey).toBe('name');

      // 'description' is sortable: false
      controller.toggleSort('description');
      expect(controller.getSort()?.columnKey).toBe('name');
    });

    it('resets page to 1 whenever sort is changed', () => {
      const controller = new DataTableController({
        columns: MARKETING_LISTS_COLUMNS,
      });
      controller.setTotal(100);
      controller.setPage(4);
      expect(controller.getPagination().page).toBe(4);

      controller.toggleSort('createdAt');
      expect(controller.getPagination().page).toBe(1);
    });
  });

  describe('4. Filter Integration & Query Parameters Serialization', () => {
    it('resets page to 1 when search or filter is mutated', () => {
      const controller = new DataTableController({
        columns: MARKETING_LISTS_COLUMNS,
      });
      controller.setTotal(100);
      controller.setPage(3);

      controller.setFilter('search', 'Enterprise');
      expect(controller.getPagination().page).toBe(1);
      expect(controller.getFilters()['search']).toBe('Enterprise');
    });

    it('serializes all query parameters correctly', () => {
      const controller = new DataTableController({
        columns: MARKETING_LISTS_COLUMNS,
        initialPageSize: 25,
      });
      controller.setTotal(100);
      controller.setSort('createdAt', 'desc');
      controller.setFilter('search', 'VIP');
      controller.setFilter('status', 'subscribed');
      controller.setPage(2);

      const params = controller.toQueryParams();
      expect(params).toEqual({
        page: '2',
        pageSize: '25',
        sortBy: 'createdAt',
        sortDirection: 'desc',
        search: 'VIP',
        status: 'subscribed',
      });
    });

    it('clears individual and all filters correctly', () => {
      const controller = new DataTableController({
        columns: MARKETING_LISTS_COLUMNS,
      });
      controller.setFilter('search', 'test');
      controller.setFilter('status', 'sent');
      expect(controller.hasActiveFilters()).toBe(true);

      controller.clearFilter('search');
      expect(controller.getFilters()['search']).toBeUndefined();
      expect(controller.getFilters()['status']).toBe('sent');

      controller.clearAllFilters();
      expect(controller.hasActiveFilters()).toBe(false);
      expect(controller.getFilters()).toEqual({});
    });
  });

  describe('5. Component Rendering & Accessibility Semantics', () => {
    const syntheticData = [
      {
        id: '40000000-0000-4000-8000-000000000001',
        name: 'Enterprise VIP Accounts',
        description: 'Tier-1 clients',
        campaignCount: 5,
        memberCount: 150,
        createdAt: '2026-10-01T10:00:00Z',
        updatedAt: '2026-10-01T10:00:00Z',
      },
    ];

    it('renders DataTable with proper aria-sort attributes on column headers', () => {
      const onSortChange = vi.fn();
      const element = asEl(
        DataTable({
          columns: MARKETING_LISTS_COLUMNS,
          data: syntheticData,
          sort: { columnKey: 'name', direction: 'asc' },
          onSortChange,
        })
      );

      expect(element).toBeDefined();

      // Find Table in the wrapper
      const tableWrapper = asEl(element.props.children[0]);
      const table = asEl(tableWrapper.props.children);
      expect(table.props['aria-label']).toBe('CRM Data Table');

      // TableHeader -> TableRow -> TableHead array
      const [tableHeader] = table.props.children;
      const headerRow = asEl(tableHeader.props.children);
      const heads = headerRow.props.children;

      // 'name' column is sorted asc -> aria-sort="ascending"
      const nameHead = asEl(heads[1]);
      expect(nameHead.props['aria-sort']).toBe('ascending');

      // 'campaignCount' is sortable but not current sort -> aria-sort="none"
      const campHead = asEl(heads[3]);
      expect(campHead.props['aria-sort']).toBe('none');

      // 'description' is non-sortable -> aria-sort=undefined
      const descHead = asEl(heads[2]);
      expect(descHead.props['aria-sort']).toBeUndefined();
    });

    it('renders sortable header button with accessible label and click trigger', () => {
      const onSortChange = vi.fn();
      const element = asEl(
        DataTable({
          columns: MARKETING_LISTS_COLUMNS,
          data: syntheticData,
          sort: { columnKey: 'name', direction: 'desc' },
          onSortChange,
        })
      );

      const tableWrapper = asEl(element.props.children[0]);
      const table = asEl(tableWrapper.props.children);
      const [tableHeader] = table.props.children;
      const headerRow = asEl(tableHeader.props.children);
      const nameHead = asEl(headerRow.props.children[1]);

      const sortBtn = asEl(nameHead.props.children);
      expect(sortBtn.type).toBe('button');
      expect(sortBtn.props['aria-label']).toBe('Sort by List Name, currently descending');

      // Trigger sort click
      sortBtn.props.onClick();
      expect(onSortChange).toHaveBeenCalledWith('name');
    });

    it('renders bounded pagination controls with navigation semantics', () => {
      const onPageChange = vi.fn();
      const onPageSizeChange = vi.fn();

      const element = asEl(
        DataTable({
          columns: MARKETING_LISTS_COLUMNS,
          data: syntheticData,
          pagination: {
            page: 2,
            pageSize: 25,
            total: 100,
            totalPages: 4,
          },
          onPageChange,
          onPageSizeChange,
        })
      );

      const paginationContainer = asEl(element.props.children[1]);
      expect(paginationContainer.props.role).toBe('navigation');
      expect(paginationContainer.props['aria-label']).toBe('Table pagination');

      // Range indicator: Showing 26 to 50 of 100 records
      const rangeText = asEl(paginationContainer.props.children[0]);
      expect(rangeText.props['aria-live']).toBe('polite');

      // Controls container
      const controls = asEl(paginationContainer.props.children[1]);
      const pageSizeSelect = asEl(controls.props.children[0].props.children[1]);
      expect(pageSizeSelect.type).toBe('select');
      expect(pageSizeSelect.props.value).toBe(25);

      // Trigger page size change
      pageSizeSelect.props.onChange({ target: { value: '50' } });
      expect(onPageSizeChange).toHaveBeenCalledWith(50);
    });

    it('renders accessible loading and empty states in DataTable', () => {
      const loadingEl = asEl(
        DataTable({
          columns: MARKETING_LISTS_COLUMNS,
          data: [],
          loading: true,
        })
      );
      expect(loadingEl.props.role).toBe('status');
      expect(loadingEl.props['aria-label']).toBe('Loading table data');

      const emptyEl = asEl(
        DataTable({
          columns: MARKETING_LISTS_COLUMNS,
          data: [],
          loading: false,
          emptyTitle: 'No campaigns recorded',
          emptyDescription: 'Zero campaigns found matching current query.',
        })
      );
      expect(emptyEl.props.role).toBe('status');
      expect(emptyEl.props['aria-label']).toBe('No records found');
      expect(asEl(emptyEl.props.children[0]).props.children).toBe('No campaigns recorded');
    });

    it('renders error state with accessible Retry action', () => {
      const onRetry = vi.fn();
      const errorEl = asEl(
        DataTable({
          columns: MARKETING_LISTS_COLUMNS,
          data: [],
          error: new Error('Network timeout during query'),
          onRetry,
        })
      );

      expect(errorEl.props.role).toBe('region');
      expect(errorEl.props['aria-label']).toBe('Table Error Banner');

      const alert = asEl(errorEl.props.children);
      expect(alert.props.title).toBe('Unable to load table data');

      const retryBtn = asEl(alert.props.children[1].props.children);
      expect(retryBtn.props['aria-label']).toBe('Retry loading table data');

      retryBtn.props.onClick();
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe('6. MarketingListsTable & MarketingListsPage Integration', () => {
    it('MarketingListsTable passes sort and pagination props cleanly', () => {
      const onSortChange = vi.fn();
      const onPageChange = vi.fn();

      const element = asEl(
        MarketingListsTable({
          lists: [
            {
              id: '40000000-0000-4000-8000-000000000001',
              name: 'Enterprise VIPs',
              description: 'Tier-1 clients',
              campaignCount: 3,
              memberCount: 80,
              createdAt: '2026-10-01T00:00:00Z',
              updatedAt: '2026-10-01T00:00:00Z',
            },
          ],
          sort: { columnKey: 'name', direction: 'asc' },
          onSortChange,
          pagination: {
            page: 1,
            pageSize: 25,
            total: 1,
            totalPages: 1,
          },
          onPageChange,
        })
      );

      expect(element).toBeDefined();
      const table = asEl(element.props.children[0]);
      const [tableHeader] = table.props.children;
      const headerRow = asEl(tableHeader.props.children);

      // Name header has aria-sort="ascending"
      const nameHead = asEl(headerRow.props.children[0]);
      expect(nameHead.props['aria-sort']).toBe('ascending');

      // Click sort button
      const sortBtn = asEl(nameHead.props.children);
      expect(sortBtn.type).toBe('button');
      sortBtn.props.onClick();
      expect(onSortChange).toHaveBeenCalledWith('name');
    });

    it('MarketingListsPage accepts initialSort and wires handleSortChange', () => {
      const onSortChange = vi.fn();
      const element = asEl(
        MarketingListsPage({
          initialLists: [
            {
              id: '40000000-0000-4000-8000-000000000001',
              name: 'Enterprise VIPs',
              description: null,
              campaignCount: 2,
              memberCount: 50,
              createdAt: '2026-10-01T00:00:00Z',
              updatedAt: '2026-10-01T00:00:00Z',
            },
          ],
          initialSort: { columnKey: 'name', direction: 'asc' },
          onSortChange,
        })
      );

      const tableCard = asEl(element.props.children[4]);
      const tableComponent = asEl(tableCard.props.children[0]);
      expect(tableComponent.props.sort).toEqual({ columnKey: 'name', direction: 'asc' });
      expect(typeof tableComponent.props.onSortChange).toBe('function');

      // Trigger sort change via tableComponent
      tableComponent.props.onSortChange('campaignCount');
      expect(onSortChange).toHaveBeenCalledWith({
        columnKey: 'campaignCount',
        direction: 'asc',
      });
    });
  });
});
