import { describe, it, expect, vi } from 'vitest';
import {
  DataTableController,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
} from '../../web/src/table/DataTableController.js';
import {
  DEALS_COLUMNS,
  QUOTES_COLUMNS,
  STAGES_COLUMNS,
  QUOTE_LINES_COLUMNS,
  DUPLICATES_COLUMNS,
  IMPORTS_COLUMNS,
} from '../../web/src/table/columns.js';
import { formatCurrencyValue } from '../../web/src/components/DealsTable.js';
import { sanitizeErrorMessage } from '../../web/src/components/ErrorAlert.js';

describe('CRM-2 Deals, Pipeline and Quotes: Main Paginated Data Table (Issue #130 / [CRM2-17])', () => {
  describe('1. Column Definitions & Data Dictionary Alignment', () => {
    it('defines stable columns for Deals matching CRM-2 data dictionary (crm2.crm2_deals)', () => {
      const keys = DEALS_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'id',
        'name',
        'contact_name',
        'value',
        'currency',
        'stage_name',
        'close_date',
        'source_system',
        'created_at',
      ]);

      const sortableKeys = DEALS_COLUMNS.filter((c) => c.sortable).map((c) => c.key);
      expect(sortableKeys).toContain('id');
      expect(sortableKeys).toContain('name');
      expect(sortableKeys).toContain('contact_name');
      expect(sortableKeys).toContain('value');
      expect(sortableKeys).toContain('stage_name');
      expect(sortableKeys).toContain('close_date');
      expect(sortableKeys).toContain('source_system');
      expect(sortableKeys).toContain('created_at');

      const nonSortableKeys = DEALS_COLUMNS.filter((c) => c.sortable === false).map((c) => c.key);
      expect(nonSortableKeys).toContain('currency');
    });

    it('defines stable columns for Quotes matching CRM-2 data dictionary (crm2.crm2_quotes)', () => {
      const keys = QUOTES_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'id',
        'quote_number',
        'deal_id',
        'quote_date',
        'amount',
        'currency',
        'note',
        'source_system',
        'created_at',
      ]);

      const sortableKeys = QUOTES_COLUMNS.filter((c) => c.sortable).map((c) => c.key);
      expect(sortableKeys).toContain('id');
      expect(sortableKeys).toContain('quote_number');
      expect(sortableKeys).toContain('deal_id');
      expect(sortableKeys).toContain('quote_date');
      expect(sortableKeys).toContain('amount');
      expect(sortableKeys).toContain('source_system');
      expect(sortableKeys).toContain('created_at');

      const nonSortable = QUOTES_COLUMNS.filter((c) => c.sortable === false).map((c) => c.key);
      expect(nonSortable).toContain('currency');
      expect(nonSortable).toContain('note');
    });

    it('defines stable columns for Pipeline Stages matching CRM-2 data dictionary (crm2.crm2_stages)', () => {
      const keys = STAGES_COLUMNS.map((c) => c.key);
      expect(keys).toEqual(['id', 'position', 'name', 'is_won']);

      const sortableKeys = STAGES_COLUMNS.filter((c) => c.sortable).map((c) => c.key);
      expect(sortableKeys).toContain('position');
      expect(sortableKeys).toContain('name');
      expect(sortableKeys).toContain('is_won');
    });

    it('defines stable columns for Quote Lines matching CRM-2 data dictionary (crm2.crm2_quote_lines)', () => {
      const keys = QUOTE_LINES_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'id',
        'quote_id',
        'product_id',
        'description',
        'quantity',
        'unit_price',
        'total_price',
      ]);

      const sortableKeys = QUOTE_LINES_COLUMNS.filter((c) => c.sortable).map((c) => c.key);
      expect(sortableKeys).toContain('product_id');
      expect(sortableKeys).toContain('description');
      expect(sortableKeys).toContain('quantity');
      expect(sortableKeys).toContain('unit_price');
      expect(sortableKeys).toContain('total_price');
    });

    it('defines stable columns for Duplicate Candidate Review queue', () => {
      const keys = DUPLICATES_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'id',
        'entityType',
        'matchKey',
        'confidenceScore',
        'status',
        'detectedAt',
      ]);
    });

    it('defines stable columns for Import Batches and Receipts', () => {
      const keys = IMPORTS_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'id',
        'sourceSystem',
        'status',
        'loadedCount',
        'rejectedCount',
        'createdAt',
        'completedAt',
      ]);
    });
  });

  describe('2. Bounded Pagination & Navigation', () => {
    it('initializes with default bounded pagination values', () => {
      const controller = new DataTableController({ columns: DEALS_COLUMNS });
      const pagination = controller.getPagination();

      expect(pagination.page).toBe(1);
      expect(pagination.pageSize).toBe(DEFAULT_PAGE_SIZE);
      expect(pagination.total).toBe(0);
      expect(pagination.totalPages).toBe(1);
    });

    it('calculates totalPages accurately when total is updated', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
        initialPageSize: 25,
      });

      controller.setTotal(100);
      expect(controller.getPagination().totalPages).toBe(4);

      controller.setTotal(101);
      expect(controller.getPagination().totalPages).toBe(5);

      controller.setTotal(0);
      expect(controller.getPagination().totalPages).toBe(1);
    });

    it('clamps page navigation between 1 and totalPages', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
        initialPageSize: 25,
      });
      controller.setTotal(100); // 4 pages

      controller.setPage(3);
      expect(controller.getPagination().page).toBe(3);

      controller.setPage(10); // Clamped to 4
      expect(controller.getPagination().page).toBe(4);

      controller.setPage(-5); // Clamped to 1
      expect(controller.getPagination().page).toBe(1);
    });

    it('supports sequential nextPage, prevPage, firstPage, and lastPage', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
        initialPageSize: 25,
      });
      controller.setTotal(75); // 3 pages

      expect(controller.prevPage()).toBe(false); // Already at page 1
      expect(controller.nextPage()).toBe(true);
      expect(controller.getPagination().page).toBe(2);

      controller.lastPage();
      expect(controller.getPagination().page).toBe(3);
      expect(controller.nextPage()).toBe(false); // Already at last page

      controller.prevPage();
      expect(controller.getPagination().page).toBe(2);

      controller.firstPage();
      expect(controller.getPagination().page).toBe(1);
    });

    it('enforces pageSize ceiling at MAX_PAGE_SIZE (100) and MIN_PAGE_SIZE (1)', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
        initialPage: 3,
        initialPageSize: 25,
      });
      controller.setTotal(200);

      controller.setPageSize(50);
      expect(controller.getPagination().pageSize).toBe(50);
      expect(controller.getPagination().page).toBe(1); // Resets to page 1

      // Attempt to exceed MAX_PAGE_SIZE
      controller.setPageSize(500);
      expect(controller.getPagination().pageSize).toBe(MAX_PAGE_SIZE);

      // Attempt to go below MIN_PAGE_SIZE
      controller.setPageSize(0);
      expect(controller.getPagination().pageSize).toBe(MIN_PAGE_SIZE);
    });

    it('adjusts current page downwards if total shrinks below current page', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
        initialPageSize: 25,
      });
      controller.setTotal(100); // 4 pages
      controller.setPage(4);

      controller.setTotal(25); // Now only 1 page
      expect(controller.getPagination().page).toBe(1);
    });
  });

  describe('3. Predictable Column Header Sorting Logic', () => {
    it('toggles sort direction from asc to desc on subsequent clicks', () => {
      const controller = new DataTableController({ columns: DEALS_COLUMNS });

      expect(controller.getSort()).toBeUndefined();

      controller.toggleSort('name');
      expect(controller.getSort()).toEqual({ columnKey: 'name', direction: 'asc' });

      controller.toggleSort('name');
      expect(controller.getSort()).toEqual({ columnKey: 'name', direction: 'desc' });

      controller.toggleSort('name');
      expect(controller.getSort()).toEqual({ columnKey: 'name', direction: 'asc' });
    });

    it('switches column and defaults to asc direction', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
        initialSort: { columnKey: 'name', direction: 'desc' },
      });

      controller.toggleSort('value');
      expect(controller.getSort()).toEqual({ columnKey: 'value', direction: 'asc' });
    });

    it('ignores sort toggle on non-sortable columns', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
        initialSort: { columnKey: 'name', direction: 'asc' },
      });

      controller.toggleSort('currency'); // currency has sortable: false
      expect(controller.getSort()).toEqual({ columnKey: 'name', direction: 'asc' });
    });

    it('resets page to 1 upon sort toggle', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
        initialPageSize: 25,
      });
      controller.setTotal(100);
      controller.setPage(3);

      controller.toggleSort('name');
      expect(controller.getPagination().page).toBe(1);
    });

    it('generates predictable WAI-ARIA aria-sort values and button labels', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
        initialSort: { columnKey: 'name', direction: 'asc' },
      });

      expect(controller.getSortAriaSort('name')).toBe('ascending');
      expect(controller.getSortAriaSort('value')).toBe('none');

      controller.toggleSort('name');
      expect(controller.getSortAriaSort('name')).toBe('descending');

      expect(controller.getSortButtonLabel('value')).toBe('Sort by Opportunity Value');
      expect(controller.getSortButtonLabel('name')).toContain('currently sorted descending');
    });
  });

  describe('4. Server-Side Query Parameter Serialization & Binding', () => {
    it('serializes pagination and sorting to API query parameters', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
        initialPage: 2,
        initialPageSize: 25,
        initialSort: { columnKey: 'created_at', direction: 'desc' },
      });

      const params = controller.toQueryParams();
      expect(params).toEqual({
        page: '2',
        pageSize: '25',
        limit: '25',
        sort: 'created_at',
        order: 'desc',
      });

      expect(controller.toQueryString()).toBe('?page=2&pageSize=25&limit=25&sort=created_at&order=desc');
    });

    it('includes active filter criteria in serialized query parameters', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
        initialFilters: {
          search: 'Acme Cloud',
          stage: 'Proposal',
        },
      });

      const params = controller.toQueryParams();
      expect(params['search']).toBe('Acme Cloud');
      expect(params['stage']).toBe('Proposal');
    });

    it('restores controller state from query parameters via fromQueryParams', () => {
      const controller = new DataTableController({ columns: DEALS_COLUMNS });

      controller.fromQueryParams({
        page: '3',
        pageSize: '50',
        sort: 'value',
        order: 'desc',
        search: 'Enterprise Expansion',
        stage: 'Qualified',
      });

      expect(controller.getPagination().page).toBe(3);
      expect(controller.getPagination().pageSize).toBe(50);
      expect(controller.getSort()).toEqual({ columnKey: 'value', direction: 'desc' });
      expect(controller.getFilters()).toEqual({
        search: 'Enterprise Expansion',
        stage: 'Qualified',
      });
    });

    it('invokes onQueryChange callback when pagination, sort, or filters mutate', () => {
      const onQueryChange = vi.fn();
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
        onQueryChange,
      });

      controller.setTotal(100);
      controller.setPage(2);
      expect(onQueryChange).toHaveBeenCalledWith(
        expect.objectContaining({ page: '2', pageSize: '25' })
      );

      controller.toggleSort('name');
      expect(onQueryChange).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'name', order: 'asc', page: '1' })
      );

      controller.setFilters({ search: 'Acme' });
      expect(onQueryChange).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'Acme', page: '1' })
      );
    });
  });

  describe('5. Client-Side Query Application & Bounded Slicing', () => {
    const syntheticDeals = [
      { id: '1', name: 'Zeta Enterprise', stage_name: 'New', value: '10000.00', created_at: '2026-10-01T00:00:00Z' },
      { id: '2', name: 'Alpha Infrastructure', stage_name: 'Proposal', value: '50000.00', created_at: '2026-10-02T00:00:00Z' },
      { id: '3', name: 'Beta Analytics', stage_name: 'Qualified', value: '25000.00', created_at: '2026-10-03T00:00:00Z' },
      { id: '4', name: 'Gamma Cloud', stage_name: 'Proposal', value: '75000.00', created_at: '2026-10-04T00:00:00Z' },
    ];

    it('filters items by search term and stage', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
        initialFilters: { stage: 'Proposal' },
      });

      const { items } = controller.applyClientSide(syntheticDeals);
      expect(items.length).toBe(2);
      expect(items.every((d) => (d as any).stage_name === 'Proposal')).toBe(true);
    });

    it('sorts numeric value columns accurately in ascending and descending orders', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
        initialSort: { columnKey: 'value', direction: 'asc' },
      });

      const asc = controller.applyClientSide(syntheticDeals);
      expect((asc.items[0] as any).value).toBe('10000.00');
      expect((asc.items[3] as any).value).toBe('75000.00');

      controller.toggleSort('value'); // desc
      const desc = controller.applyClientSide(syntheticDeals);
      expect((desc.items[0] as any).value).toBe('75000.00');
      expect((desc.items[3] as any).value).toBe('10000.00');
    });

    it('slices bounded pagination without exceeding pageSize', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
        initialPage: 1,
        initialPageSize: 2,
      });

      const page1 = controller.applyClientSide(syntheticDeals);
      expect(page1.items.length).toBe(2);
      expect(page1.pagination.total).toBe(4);
      expect(page1.pagination.totalPages).toBe(2);

      controller.setPage(2);
      const page2 = controller.applyClientSide(syntheticDeals);
      expect(page2.items.length).toBe(2);
      expect((page2.items[0] as any).id).toBe('3');
    });
  });

  describe('6. WAI-ARIA Accessible Markup & Semantic UI States', () => {
    it('renders skeleton loading card when loading: true', () => {
      const controller = new DataTableController({ columns: DEALS_COLUMNS });
      const html = controller.renderHtml([], { loading: true });

      expect(html).toContain('class="cs-skeleton-container"');
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-label="Loading table data"');
      expect(html).toContain('cs-skeleton-header-cell');
      expect(html).toContain('cs-skeleton-cell');
    });

    it('renders empty state card when data collection is empty', () => {
      const controller = new DataTableController({ columns: DEALS_COLUMNS });
      const html = controller.renderHtml([], {
        loading: false,
        emptyTitle: 'No sales opportunities found',
        emptyDescription: 'Try modifying your search or filter options.',
      });

      expect(html).toContain('class="cs-empty-state"');
      expect(html).toContain('role="status"');
      expect(html).toContain('No sales opportunities found');
      expect(html).toContain('Try modifying your search or filter options.');
    });

    it('renders empty filter reset state when filters are active', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
        initialFilters: { search: 'Nonexistent Deal' },
      });
      const html = controller.renderHtml([], { loading: false });

      expect(html).toContain('cs-empty-filter-state');
      expect(html).toContain('Reset All Filters');
    });

    it('renders sanitized error alert banner without exposing internal stack traces', () => {
      const controller = new DataTableController({ columns: DEALS_COLUMNS });
      const rawError = new Error('Database connection failed at /Users/developer/node_modules/pg/client.js:12:4');
      const html = controller.renderHtml([], {
        error: rawError,
        onRetryAction: 'retry-deals',
      });

      expect(html).toContain('class="cs-error-banner"');
      expect(html).toContain('role="alert"');
      expect(html).not.toContain('/Users/developer/node_modules');
      expect(html).toContain('data-action="retry-deals"');
    });

    it('renders 403 Forbidden access-denied view with missing permissions', () => {
      const controller = new DataTableController({ columns: DEALS_COLUMNS });
      const html = controller.renderHtml([], {
        isAccessDenied: true,
        httpStatus: 403,
        requiredCapability: 'crm2.deals.read',
        requiredRole: 'editor',
        currentRole: 'viewer',
        resourceName: 'Deals and Pipeline Opportunities',
      });

      expect(html).toContain('403 Forbidden');
      expect(html).toContain('Access Denied');
      expect(html).toContain('crm2.deals.read');
      expect(html).toContain('editor');
      expect(html).toContain('viewer');
      expect(html).toContain('Return to Pipeline');
    });

    it('renders accessible semantic table with aria-sort on headers and pagination controls', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
        initialSort: { columnKey: 'name', direction: 'asc' },
        initialPage: 1,
        initialPageSize: 25,
      });
      controller.setTotal(50);

      const syntheticData = [
        {
          id: '11111111-1111-4000-8000-000000000001',
          name: 'Acme Cloud Modernization',
          contact_name: 'Sarah Connor',
          value: '75000.00',
          currency: 'USD',
          stage_name: 'Proposal',
          close_date: '2026-11-30',
          source_system: 'hubspot',
          created_at: '2026-10-01T00:00:00Z',
        },
      ];

      const html = controller.renderHtml(syntheticData, { loading: false });

      expect(html).toContain('role="table"');
      expect(html).toContain('class="cs-table"');
      expect(html).toContain('scope="col"');
      expect(html).toContain('aria-sort="ascending"');
      expect(html).toContain('aria-sort="none"');
      expect(html).toContain('aria-label="Sort by Deal Name"');
      expect(html).toContain('Acme Cloud Modernization');
      expect(html).toContain('Sarah Connor');
      expect(html).toContain('class="cs-pagination-toolbar"');
      expect(html).toContain('aria-label="Table Pagination"');
      expect(html).toContain('Showing <span class="cs-font-semibold">1</span> to <span class="cs-font-semibold">25</span> of <span class="cs-font-semibold">50</span> records');
      expect(html).toContain('Page 1 of 2');
    });
  });

  describe('7. Utility and Sanitization Functions', () => {
    it('safely formats currency and decimal values via formatCurrencyValue', () => {
      expect(formatCurrencyValue('75000.00', 'USD')).toContain('75,000.00');
      expect(formatCurrencyValue('42500.50', 'EUR')).toContain('42,500.50');
      expect(formatCurrencyValue('invalid', 'USD')).toBe('USD invalid');
    });

    it('sanitizes error messages to protect sensitive details', () => {
      expect(sanitizeErrorMessage(null)).toBe('An unexpected error occurred while communicating with the server.');
      expect(sanitizeErrorMessage({ code: 'ERR_TIMEOUT' })).toBe('Server returned error code: ERR_TIMEOUT');
      expect(sanitizeErrorMessage('Safe operational error message')).toBe('Safe operational error message');
    });
  });
});
