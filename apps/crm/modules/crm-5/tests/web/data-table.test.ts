import { describe, it, expect, vi } from 'vitest';
import {
  DataTableController,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../web/table/DataTableController.js';
import {
  RUNS_COLUMNS,
  SCORES_COLUMNS,
  REJECTS_COLUMNS,
  RECONCILIATION_COLUMNS,
} from '../../web/table/columns.js';

describe('CRM-5 Main Paginated Data Table (Issue #190)', () => {
  describe('1. Column Definitions & Data Dictionary Alignment', () => {
    it('defines stable columns for Migration Runs matching CRM-5 data dictionary', () => {
      const keys = RUNS_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'batchId',
        'module',
        'step',
        'status',
        'recordsIn',
        'recordsOut',
        'recordsRejected',
        'startedAt',
        'completedAt',
      ]);

      const sortableKeys = RUNS_COLUMNS.filter((c) => c.sortable).map((c) => c.key);
      expect(sortableKeys).toContain('batchId');
      expect(sortableKeys).toContain('status');
      expect(sortableKeys).toContain('recordsIn');
      expect(sortableKeys).toContain('startedAt');
    });

    it('defines stable columns for Quality Scores matching CRM-5 data dictionary', () => {
      const keys = SCORES_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'batchId',
        'module',
        'score',
        'completeness',
        'validity',
        'duplicateRate',
        'rejectRate',
        'linkIntegrity',
        'isFullyScored',
        'scoredAt',
      ]);
    });

    it('defines stable columns for Rejections matching CRM-5 data dictionary', () => {
      const keys = REJECTS_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'id',
        'batchId',
        'module',
        'rowIndex',
        'errorCode',
        'errorMessage',
        'rawPayloadHash',
        'createdAt',
      ]);
    });

    it('defines stable columns for Reconciliation Balance Sheet matching CRM-5 data dictionary', () => {
      const keys = RECONCILIATION_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'batchId',
        'module',
        'sourceCount',
        'loadedCount',
        'rejectedCount',
        'mergedCount',
        'skippedCount',
        'unaccountedCount',
        'status',
        'reconciledAt',
      ]);
    });
  });

  describe('2. Bounded Pagination & Navigation', () => {
    it('initializes with default bounded pagination values', () => {
      const controller = new DataTableController({ columns: RUNS_COLUMNS });
      const pagination = controller.getPagination();

      expect(pagination.page).toBe(1);
      expect(pagination.pageSize).toBe(DEFAULT_PAGE_SIZE);
      expect(pagination.total).toBe(0);
      expect(pagination.totalPages).toBe(1);
    });

    it('calculates totalPages accurately when total is updated', () => {
      const controller = new DataTableController({
        columns: RUNS_COLUMNS,
        initialPageSize: 20,
      });

      controller.setTotal(45);
      expect(controller.getPagination().totalPages).toBe(3); // 20 + 20 + 5 = 3 pages

      controller.setTotal(0);
      expect(controller.getPagination().totalPages).toBe(1);
    });

    it('clamps page index between 1 and totalPages', () => {
      const controller = new DataTableController({
        columns: RUNS_COLUMNS,
        initialPageSize: 10,
      });
      controller.setTotal(50); // totalPages = 5

      controller.setPage(3);
      expect(controller.getPagination().page).toBe(3);

      controller.setPage(999); // Clamps to totalPages (5)
      expect(controller.getPagination().page).toBe(5);

      controller.setPage(-5); // Clamps to 1
      expect(controller.getPagination().page).toBe(1);
    });

    it('navigates through nextPage, prevPage, firstPage, and lastPage', () => {
      const controller = new DataTableController({
        columns: RUNS_COLUMNS,
        initialPageSize: 10,
      });
      controller.setTotal(30); // 3 pages

      expect(controller.nextPage()).toBe(true);
      expect(controller.getPagination().page).toBe(2);

      expect(controller.nextPage()).toBe(true);
      expect(controller.getPagination().page).toBe(3);

      // At last page: nextPage returns false and stays on page 3
      expect(controller.nextPage()).toBe(false);
      expect(controller.getPagination().page).toBe(3);

      expect(controller.prevPage()).toBe(true);
      expect(controller.getPagination().page).toBe(2);

      controller.lastPage();
      expect(controller.getPagination().page).toBe(3);

      controller.firstPage();
      expect(controller.getPagination().page).toBe(1);

      // At first page: prevPage returns false
      expect(controller.prevPage()).toBe(false);
    });

    it('enforces maximum page size ceiling (MAX_PAGE_SIZE = 100) to prevent DOM degradation', () => {
      const controller = new DataTableController({
        columns: RUNS_COLUMNS,
        initialPageSize: 500, // exceeds ceiling
      });
      expect(controller.getPagination().pageSize).toBe(MAX_PAGE_SIZE);

      controller.setPageSize(250);
      expect(controller.getPagination().pageSize).toBe(MAX_PAGE_SIZE);

      controller.setPageSize(50);
      expect(controller.getPagination().pageSize).toBe(50);

      controller.setPageSize(-10);
      expect(controller.getPagination().pageSize).toBe(1);
    });

    it('resets page to 1 on pageSize change', () => {
      const controller = new DataTableController({
        columns: RUNS_COLUMNS,
        initialPageSize: 10,
      });
      controller.setTotal(100);
      controller.setPage(4);

      controller.setPageSize(25);
      expect(controller.getPagination().page).toBe(1);
    });
  });

  describe('3. Sorting Header Toggling & State Cycle', () => {
    it('toggles column sort between asc and desc, resetting page to 1', () => {
      const controller = new DataTableController({
        columns: RUNS_COLUMNS,
        initialPageSize: 10,
      });
      controller.setTotal(50);
      controller.setPage(3);

      // 1. Initial sort on batchId -> asc
      controller.toggleSort('batchId');
      expect(controller.getSort()).toEqual({ columnKey: 'batchId', direction: 'asc' });
      expect(controller.getPagination().page).toBe(1);

      // 2. Second sort on same column -> desc
      controller.toggleSort('batchId');
      expect(controller.getSort()).toEqual({ columnKey: 'batchId', direction: 'desc' });

      // 3. Third sort on same column -> asc
      controller.toggleSort('batchId');
      expect(controller.getSort()).toEqual({ columnKey: 'batchId', direction: 'asc' });

      // 4. Switching column -> asc on new column
      controller.toggleSort('recordsIn');
      expect(controller.getSort()).toEqual({ columnKey: 'recordsIn', direction: 'asc' });
    });

    it('ignores toggleSort on non-sortable columns', () => {
      const controller = new DataTableController({ columns: RUNS_COLUMNS });
      // completedAt has sortable: false
      controller.toggleSort('completedAt');
      expect(controller.getSort()).toBeUndefined();
    });
  });

  describe('4. Server-Side Query Parameter Serialization', () => {
    it('serializes page, pageSize, limit, sort, and filters to query parameters', () => {
      const onQueryChange = vi.fn();
      const controller = new DataTableController({
        columns: RUNS_COLUMNS,
        initialPage: 2,
        initialPageSize: 20,
        initialSort: { columnKey: 'startedAt', direction: 'desc' },
        initialFilters: { module: 'crm-1', status: 'running' },
        onQueryChange,
      });

      const params = controller.toQueryParams();
      expect(params).toEqual({
        page: '2',
        pageSize: '20',
        limit: '20',
        sort: 'startedAt',
        order: 'desc',
        module: 'crm-1',
        status: 'running',
      });

      const queryString = controller.toQueryString();
      expect(queryString).toContain('page=2');
      expect(queryString).toContain('pageSize=20');
      expect(queryString).toContain('sort=startedAt');
      expect(queryString).toContain('order=desc');
      expect(queryString).toContain('module=crm-1');
      expect(queryString).toContain('status=running');

      controller.setTotal(100);
      controller.setPage(3);
      expect(onQueryChange).toHaveBeenCalledWith(expect.objectContaining({ page: '3' }));
    });
  });

  describe('5. Accessible WAI-ARIA Table Markup & States', () => {
    it('renders loading skeleton state with role="status"', () => {
      const controller = new DataTableController({ columns: RUNS_COLUMNS });
      const html = controller.renderHtml([], { loading: true });

      expect(html).toContain('class="cs-skeleton-container"');
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-label="Loading table data"');
    });

    it('renders empty state card when data array is empty and not loading', () => {
      const controller = new DataTableController({ columns: RUNS_COLUMNS });
      const html = controller.renderHtml([], {
        emptyTitle: 'No migration runs',
        emptyDescription: 'Zero batch records matching criteria',
      });

      expect(html).toContain('class="cs-empty-state"');
      expect(html).toContain('No migration runs');
      expect(html).toContain('Zero batch records matching criteria');
    });

    it('renders accessible data table with sortable button headers and aria-sort', () => {
      const controller = new DataTableController({
        columns: RUNS_COLUMNS,
        initialSort: { columnKey: 'batchId', direction: 'asc' },
      });
      controller.setTotal(2);

      const mockData = [
        {
          id: '1',
          batchId: 'batch-001',
          module: 'crm-1',
          step: 'load',
          status: 'completed',
          recordsIn: 100,
          recordsOut: 100,
          recordsRejected: 0,
          startedAt: '2026-10-20 10:00:00',
          completedAt: '2026-10-20 10:05:00',
        },
      ];

      const html = controller.renderHtml(mockData);

      // Semantic table elements
      expect(html).toContain('role="table"');
      expect(html).toContain('<table class="cs-table"');
      expect(html).toContain('<thead class="cs-thead"');
      expect(html).toContain('<tbody class="cs-tbody"');

      // Sortable headers & WAI-ARIA aria-sort
      expect(html).toContain('aria-sort="ascending"');
      expect(html).toContain('class="cs-th-sort-btn"');
      expect(html).toContain('data-key="batchId"');
      expect(html).toContain('aria-label="Sort by Batch ID"');

      // Row cells
      expect(html).toContain('batch-001');
      expect(html).toContain('crm-1');
      expect(html).toContain('100');

      // Pagination toolbar
      expect(html).toContain('aria-label="Table Pagination"');
      expect(html).toContain('Showing <span class="cs-font-semibold">1</span>');
      expect(html).toContain('disabled aria-disabled="true"'); // First page disabled
    });
  });
});
