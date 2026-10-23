import { describe, it, expect, vi } from 'vitest';
import {
  DataTableController,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../web/table/DataTableController.js';
import {
  CONTACTS_COLUMNS,
  COMPANIES_COLUMNS,
  LEADS_COLUMNS,
  DUPLICATES_COLUMNS,
  IMPORTS_COLUMNS,
} from '../../web/table/columns.js';

describe('CRM-1 Main Paginated Data Table (Issue #110 / [CRM1-17])', () => {
  describe('1. Column Definitions & Data Dictionary Alignment', () => {
    it('defines stable columns for Contacts matching CRM-1 data dictionary', () => {
      const keys = CONTACTS_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'id',
        'firstName',
        'lastName',
        'email',
        'phone',
        'address',
        'companyName',
        'leadStatus',
        'goldenId',
        'sourceSystem',
        'sourceId',
        'consentStatus',
        'unsubscribed',
        'createdAt',
      ]);

      const sortableKeys = CONTACTS_COLUMNS.filter((c) => c.sortable).map((c) => c.key);
      expect(sortableKeys).toContain('id');
      expect(sortableKeys).toContain('firstName');
      expect(sortableKeys).toContain('lastName');
      expect(sortableKeys).toContain('email');
      expect(sortableKeys).toContain('leadStatus');
      expect(sortableKeys).toContain('goldenId');
      expect(sortableKeys).toContain('createdAt');
    });

    it('defines stable columns for Companies matching CRM-1 data dictionary', () => {
      const keys = COMPANIES_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'id',
        'name',
        'taxNumber',
        'email',
        'phone',
        'address',
        'sourceSystem',
        'sourceId',
        'createdAt',
      ]);

      const sortableKeys = COMPANIES_COLUMNS.filter((c) => c.sortable).map((c) => c.key);
      expect(sortableKeys).toContain('id');
      expect(sortableKeys).toContain('name');
      expect(sortableKeys).toContain('taxNumber');
      expect(sortableKeys).toContain('sourceSystem');
      expect(sortableKeys).toContain('createdAt');
    });

    it('defines stable columns for Leads matching CRM-1 data dictionary', () => {
      const keys = LEADS_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'id',
        'contactName',
        'contactEmail',
        'contactId',
        'status',
        'sourceSystem',
        'sourceId',
        'createdAt',
      ]);

      const sortableKeys = LEADS_COLUMNS.filter((c) => c.sortable).map((c) => c.key);
      expect(sortableKeys).toContain('id');
      expect(sortableKeys).toContain('contactId');
      expect(sortableKeys).toContain('status');
      expect(sortableKeys).toContain('createdAt');
    });

    it('defines stable columns for Duplicate Candidate Review queue', () => {
      const keys = DUPLICATES_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'id',
        'entity',
        'matchKey',
        'matchType',
        'existingId',
        'incomingId',
        'status',
        'detectedAt',
      ]);
    });

    it('defines stable columns for Import Batches & Receipts', () => {
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
      const controller = new DataTableController({ columns: CONTACTS_COLUMNS });
      const pagination = controller.getPagination();

      expect(pagination.page).toBe(1);
      expect(pagination.pageSize).toBe(DEFAULT_PAGE_SIZE);
      expect(pagination.total).toBe(0);
      expect(pagination.totalPages).toBe(1);
    });

    it('calculates totalPages accurately when total is updated', () => {
      const controller = new DataTableController({
        columns: CONTACTS_COLUMNS,
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
        columns: CONTACTS_COLUMNS,
        initialPageSize: 25,
      });
      controller.setTotal(100); // 4 pages

      controller.setPage(3);
      expect(controller.getPagination().page).toBe(3);

      controller.setPage(10); // Clamp to 4
      expect(controller.getPagination().page).toBe(4);

      controller.setPage(-5); // Clamp to 1
      expect(controller.getPagination().page).toBe(1);
    });

    it('supports sequential nextPage, prevPage, firstPage, and lastPage', () => {
      const controller = new DataTableController({
        columns: CONTACTS_COLUMNS,
        initialPageSize: 25,
      });
      controller.setTotal(75); // 3 pages

      expect(controller.prevPage()).toBe(false); // Already at 1
      expect(controller.nextPage()).toBe(true);
      expect(controller.getPagination().page).toBe(2);

      controller.lastPage();
      expect(controller.getPagination().page).toBe(3);
      expect(controller.nextPage()).toBe(false); // Already at last

      controller.prevPage();
      expect(controller.getPagination().page).toBe(2);

      controller.firstPage();
      expect(controller.getPagination().page).toBe(1);
    });

    it('enforces pageSize ceiling at MAX_PAGE_SIZE (100) and resets page to 1', () => {
      const controller = new DataTableController({
        columns: CONTACTS_COLUMNS,
        initialPage: 3,
        initialPageSize: 25,
      });
      controller.setTotal(200);

      controller.setPageSize(50);
      expect(controller.getPagination().pageSize).toBe(50);
      expect(controller.getPagination().page).toBe(1);

      // Attempt to exceed MAX_PAGE_SIZE
      controller.setPageSize(500);
      expect(controller.getPagination().pageSize).toBe(MAX_PAGE_SIZE);
    });

    it('adjusts current page downwards if total shrinks below current page', () => {
      const controller = new DataTableController({
        columns: CONTACTS_COLUMNS,
        initialPageSize: 25,
      });
      controller.setTotal(100); // 4 pages
      controller.setPage(4);

      controller.setTotal(25); // Now only 1 page
      expect(controller.getPagination().page).toBe(1);
    });
  });

  describe('3. Column Header Sorting Logic', () => {
    it('toggles sort direction from asc to desc on subsequent clicks', () => {
      const controller = new DataTableController({ columns: CONTACTS_COLUMNS });

      expect(controller.getSort()).toBeUndefined();

      controller.toggleSort('email');
      expect(controller.getSort()).toEqual({ columnKey: 'email', direction: 'asc' });

      controller.toggleSort('email');
      expect(controller.getSort()).toEqual({ columnKey: 'email', direction: 'desc' });

      controller.toggleSort('email');
      expect(controller.getSort()).toEqual({ columnKey: 'email', direction: 'asc' });
    });

    it('switches column and defaults to asc direction', () => {
      const controller = new DataTableController({
        columns: CONTACTS_COLUMNS,
        initialSort: { columnKey: 'firstName', direction: 'desc' },
      });

      controller.toggleSort('lastName');
      expect(controller.getSort()).toEqual({ columnKey: 'lastName', direction: 'asc' });
    });

    it('ignores sort toggle on non-sortable columns', () => {
      const controller = new DataTableController({
        columns: CONTACTS_COLUMNS,
        initialSort: { columnKey: 'email', direction: 'asc' },
      });

      controller.toggleSort('phone'); // phone is sortable: false
      expect(controller.getSort()).toEqual({ columnKey: 'email', direction: 'asc' });
    });

    it('resets page to 1 upon sort toggle', () => {
      const controller = new DataTableController({
        columns: CONTACTS_COLUMNS,
        initialPageSize: 25,
      });
      controller.setTotal(100);
      controller.setPage(3);

      controller.toggleSort('firstName');
      expect(controller.getPagination().page).toBe(1);
    });
  });

  describe('4. Server-Side Query Parameter Serialization', () => {
    it('serializes pagination and sorting to API query parameters', () => {
      const controller = new DataTableController({
        columns: CONTACTS_COLUMNS,
        initialPage: 2,
        initialPageSize: 25,
        initialSort: { columnKey: 'createdAt', direction: 'desc' },
      });

      const params = controller.toQueryParams();
      expect(params).toEqual({
        page: '2',
        pageSize: '25',
        limit: '25',
        sort: 'createdAt',
        order: 'desc',
      });

      expect(controller.toQueryString()).toBe('?page=2&pageSize=25&limit=25&sort=createdAt&order=desc');
    });

    it('includes active filter criteria in serialized query parameters', () => {
      const controller = new DataTableController({
        columns: CONTACTS_COLUMNS,
        initialFilters: {
          search: 'alice@clearshift.internal',
          leadStatus: 'Qualified',
        },
      });

      const params = controller.toQueryParams();
      expect(params['search']).toBe('alice@clearshift.internal');
      expect(params['leadStatus']).toBe('Qualified');
    });

    it('invokes onQueryChange callback when pagination, sort, or filters mutate', () => {
      const onQueryChange = vi.fn();
      const controller = new DataTableController({
        columns: CONTACTS_COLUMNS,
        onQueryChange,
      });

      controller.setTotal(100);
      controller.setPage(2);
      expect(onQueryChange).toHaveBeenCalledWith(
        expect.objectContaining({ page: '2', pageSize: '25' })
      );

      controller.toggleSort('lastName');
      expect(onQueryChange).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'lastName', order: 'asc', page: '1' })
      );

      controller.setFilters({ search: 'test query' });
      expect(onQueryChange).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'test query', page: '1' })
      );
    });
  });

  describe('5. WAI-ARIA Accessible HTML Rendering', () => {
    it('renders skeleton loading card when loading: true', () => {
      const controller = new DataTableController({ columns: CONTACTS_COLUMNS });
      const html = controller.renderHtml([], { loading: true });

      expect(html).toContain('class="cs-skeleton-container"');
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-label="Loading table data"');
    });

    it('renders empty state card when data is empty', () => {
      const controller = new DataTableController({ columns: CONTACTS_COLUMNS });
      const html = controller.renderHtml([], {
        loading: false,
        emptyTitle: 'No contacts found',
        emptyDescription: 'Try modifying your search or filter options.',
      });

      expect(html).toContain('class="cs-empty-state"');
      expect(html).toContain('role="status"');
      expect(html).toContain('No contacts found');
      expect(html).toContain('Try modifying your search or filter options.');
    });

    it('renders accessible semantic table with aria-sort on headers and pagination controls', () => {
      const controller = new DataTableController({
        columns: CONTACTS_COLUMNS,
        initialSort: { columnKey: 'email', direction: 'asc' },
        initialPage: 1,
        initialPageSize: 25,
      });
      controller.setTotal(50);

      const syntheticData = [
        {
          id: '11111111-1111-4111-8111-111111111111',
          firstName: 'Alice',
          lastName: 'Smith',
          email: 'alice@clearshift.internal',
          phone: '+1-555-0101',
          companyId: null,
          leadStatus: 'Working',
          goldenId: 'GID-001',
          consentStatus: 'granted',
          unsubscribed: false,
          createdAt: '2026-10-01T12:00:00Z',
        },
      ];

      const html = controller.renderHtml(syntheticData, { loading: false });

      expect(html).toContain('role="table"');
      expect(html).toContain('class="cs-table"');
      expect(html).toContain('scope="col"');
      expect(html).toContain('aria-sort="ascending"'); // On sorted email column
      expect(html).toContain('aria-sort="none"'); // On sortable non-active columns
      expect(html).toContain('aria-label="Sort by Email"');
      expect(html).toContain('alice@clearshift.internal');
      expect(html).toContain('Alice');
      expect(html).toContain('class="cs-pagination-toolbar"');
      expect(html).toContain('aria-label="Table Pagination"');
      expect(html).toContain('Showing <span class="cs-font-semibold">1</span> to <span class="cs-font-semibold">25</span> of <span class="cs-font-semibold">50</span> records');
      expect(html).toContain('Page 1 of 2');
    });
  });
});
