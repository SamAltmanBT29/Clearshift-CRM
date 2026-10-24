import { describe, it, expect, vi } from 'vitest';
import {
  DataTableController,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../web/table/DataTableController.js';
import {
  TICKETS_COLUMNS,
  TICKET_NOTES_COLUMNS,
  TICKET_IMPORTS_COLUMNS,
} from '../../web/table/columns.js';
import { DataTable } from '../../web/components/DataTable.js';
import { TicketsListPage } from '../../web/pages/TicketsListPage.js';

describe('CRM-3 Main Paginated Data Table (Issue #150 / [CRM3-17])', () => {
  // ---------------------------------------------------------------------------
  // 1. Column Definitions & Data Dictionary Alignment
  // ---------------------------------------------------------------------------
  describe('1. Column Definitions & Data Dictionary Alignment', () => {
    it('defines stable columns for Tickets Queue matching CRM-3 data dictionary', () => {
      const keys = TICKETS_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'id',
        'subject',
        'status',
        'priority',
        'contactName',
        'orderRef',
        'createdAt',
        'updatedAt',
      ]);

      const sortableKeys = TICKETS_COLUMNS.filter((c) => c.sortable).map((c) => c.key);
      expect(sortableKeys).toContain('id');
      expect(sortableKeys).toContain('subject');
      expect(sortableKeys).toContain('status');
      expect(sortableKeys).toContain('priority');
      expect(sortableKeys).toContain('orderRef');
      expect(sortableKeys).toContain('createdAt');
      expect(sortableKeys).toContain('updatedAt');
      expect(sortableKeys).not.toContain('contactName'); // logical link projection
    });

    it('defines stable columns for Ticket Internal Notes matching CRM-3 data dictionary', () => {
      const keys = TICKET_NOTES_COLUMNS.map((c) => c.key);
      expect(keys).toEqual([
        'id',
        'ticketId',
        'authorId',
        'noteText',
        'createdAt',
      ]);

      const sortableKeys = TICKET_NOTES_COLUMNS.filter((c) => c.sortable).map((c) => c.key);
      expect(sortableKeys).toContain('id');
      expect(sortableKeys).toContain('ticketId');
      expect(sortableKeys).toContain('createdAt');
      expect(sortableKeys).not.toContain('noteText');
      expect(sortableKeys).not.toContain('authorId');
    });

    it('defines stable columns for Import Batches & Receipts matching data dictionary', () => {
      const keys = TICKET_IMPORTS_COLUMNS.map((c) => c.key);
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

  // ---------------------------------------------------------------------------
  // 2. Bounded Pagination & Navigation
  // ---------------------------------------------------------------------------
  describe('2. Bounded Pagination & Navigation', () => {
    it('initializes with default bounded pagination values', () => {
      const controller = new DataTableController({ columns: TICKETS_COLUMNS });
      const pagination = controller.getPagination();

      expect(pagination.page).toBe(1);
      expect(pagination.pageSize).toBe(DEFAULT_PAGE_SIZE);
      expect(pagination.total).toBe(0);
      expect(pagination.totalPages).toBe(1);
    });

    it('calculates totalPages accurately when total is updated', () => {
      const controller = new DataTableController({
        columns: TICKETS_COLUMNS,
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
        columns: TICKETS_COLUMNS,
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
        columns: TICKETS_COLUMNS,
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
        columns: TICKETS_COLUMNS,
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
        columns: TICKETS_COLUMNS,
        initialPageSize: 25,
      });
      controller.setTotal(100); // 4 pages
      controller.setPage(4);

      controller.setTotal(25); // Now only 1 page
      expect(controller.getPagination().page).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Column Header Sorting Logic
  // ---------------------------------------------------------------------------
  describe('3. Column Header Sorting Logic', () => {
    it('toggles sort direction from asc to desc on subsequent clicks', () => {
      const controller = new DataTableController({ columns: TICKETS_COLUMNS });

      expect(controller.getSort()).toBeUndefined();

      controller.toggleSort('subject');
      expect(controller.getSort()).toEqual({ columnKey: 'subject', direction: 'asc' });

      controller.toggleSort('subject');
      expect(controller.getSort()).toEqual({ columnKey: 'subject', direction: 'desc' });

      controller.toggleSort('subject');
      expect(controller.getSort()).toEqual({ columnKey: 'subject', direction: 'asc' });
    });

    it('switches column and defaults to asc direction', () => {
      const controller = new DataTableController({
        columns: TICKETS_COLUMNS,
        initialSort: { columnKey: 'priority', direction: 'desc' },
      });

      controller.toggleSort('status');
      expect(controller.getSort()).toEqual({ columnKey: 'status', direction: 'asc' });
    });

    it('ignores sort toggle on non-sortable columns', () => {
      const controller = new DataTableController({
        columns: TICKETS_COLUMNS,
        initialSort: { columnKey: 'subject', direction: 'asc' },
      });

      controller.toggleSort('contactName'); // contactName is sortable: false
      expect(controller.getSort()).toEqual({ columnKey: 'subject', direction: 'asc' });
    });

    it('resets page to 1 upon sort toggle', () => {
      const controller = new DataTableController({
        columns: TICKETS_COLUMNS,
        initialPageSize: 25,
      });
      controller.setTotal(100);
      controller.setPage(3);

      controller.toggleSort('createdAt');
      expect(controller.getPagination().page).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Query Parameter Synchronization
  // ---------------------------------------------------------------------------
  describe('4. Query Parameter Synchronization', () => {
    it('emits query parameter change events on pagination, sort, and filter edits', () => {
      const onQueryChange = vi.fn();
      const controller = new DataTableController({
        columns: TICKETS_COLUMNS,
        onQueryChange,
      });
      controller.setTotal(100); // 4 pages

      controller.setPage(2);
      expect(onQueryChange).toHaveBeenCalledWith(
        expect.objectContaining({ page: '2', pageSize: '25' })
      );

      controller.toggleSort('priority');
      expect(onQueryChange).toHaveBeenCalledWith(
        expect.objectContaining({ page: '1', sort: 'priority', dir: 'asc' })
      );

      controller.setFilter('status', 'Open');
      expect(onQueryChange).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Open', page: '1' })
      );
    });

    it('clears empty filter values from generated query parameters', () => {
      const controller = new DataTableController({
        columns: TICKETS_COLUMNS,
        initialFilters: { status: 'Open', priority: 'High' },
      });

      controller.setFilter('priority', '  '); // clearing
      const params = controller.toQueryParams();
      expect(params['status']).toBe('Open');
      expect(params['priority']).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. DataTable Component & WAI-ARIA Accessibility
  // ---------------------------------------------------------------------------
  describe('5. DataTable Component & WAI-ARIA Accessibility', () => {
    const mockTickets = [
      {
        id: '30000000-0000-4000-8000-000000000001',
        subject: 'Cannot login to account',
        status: 'Open',
        priority: 'Urgent',
        contactName: 'Sarah Connor',
        orderRef: 'ORD-1001',
        createdAt: '2026-10-24T10:00:00Z',
        updatedAt: '2026-10-24T10:30:00Z',
      },
      {
        id: '30000000-0000-4000-8000-000000000002',
        subject: 'Invoice inquiry',
        status: 'Solved',
        priority: 'Normal',
        contactName: 'Lars Lindqvist',
        orderRef: null,
        createdAt: '2026-10-24T09:00:00Z',
        updatedAt: '2026-10-24T09:15:00Z',
      },
    ];

    it('renders table elements with proper semantic roles and ARIA attributes', () => {
      const element = DataTable({
        columns: TICKETS_COLUMNS,
        data: mockTickets,
        sort: { columnKey: 'createdAt', direction: 'desc' },
        pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1 },
      });

      expect(element).toBeDefined();
      const responsiveDiv = element.props.children[0];
      const table = responsiveDiv.props.children;
      expect(table.props.role).toBe('table');
      expect(table.props['aria-label']).toBe('Support Tickets Data Table');

      const thead = table.props.children[0];
      const thList = thead.props.children.props.children;
      expect(thList).toHaveLength(TICKETS_COLUMNS.length);

      // Check aria-sort on sorted column
      const createdAtTh = thList.find((th: any) => th.key === 'createdAt');
      expect(createdAtTh.props['aria-sort']).toBe('descending');

      // Check aria-sort on unsorted sortable column
      const statusTh = thList.find((th: any) => th.key === 'status');
      expect(statusTh.props['aria-sort']).toBe('none');

      // Check non-sortable column has no aria-sort
      const contactTh = thList.find((th: any) => th.key === 'contactName');
      expect(contactTh.props['aria-sort']).toBeUndefined();
    });

    it('triggers onSortChange callback when column header sort button is clicked', () => {
      const onSortChange = vi.fn();
      const element = DataTable({
        columns: TICKETS_COLUMNS,
        data: mockTickets,
        onSortChange,
      });

      const table = element.props.children[0].props.children;
      const thead = table.props.children[0];
      const thList = thead.props.children.props.children;
      const subjectTh = thList.find((th: any) => th.key === 'subject');
      const sortBtn = subjectTh.props.children;

      expect(sortBtn.type).toBe('button');
      sortBtn.props.onClick();
      expect(onSortChange).toHaveBeenCalledWith('subject');
    });

    it('triggers onPageChange callback when pagination buttons are activated', () => {
      const onPageChange = vi.fn();
      const element = DataTable({
        columns: TICKETS_COLUMNS,
        data: mockTickets,
        pagination: { page: 2, pageSize: 25, total: 100, totalPages: 4 },
        onPageChange,
      });

      const nav = element.props.children[1];
      expect(nav.props['aria-label']).toBe('Table Pagination');

      const controls = nav.props.children[1];
      const [firstBtn, prevBtn, _pageSpan, nextBtn, lastBtn] = controls.props.children;

      firstBtn.props.onClick();
      expect(onPageChange).toHaveBeenCalledWith(1);

      prevBtn.props.onClick();
      expect(onPageChange).toHaveBeenCalledWith(1);

      nextBtn.props.onClick();
      expect(onPageChange).toHaveBeenCalledWith(3);

      lastBtn.props.onClick();
      expect(onPageChange).toHaveBeenCalledWith(4);
    });

    it('triggers onSelectRow callback when a row is clicked', () => {
      const onSelectRow = vi.fn();
      const element = DataTable({
        columns: TICKETS_COLUMNS,
        data: mockTickets,
        onSelectRow,
      });

      const tbody = element.props.children[0].props.children.props.children[1];
      const firstRow = tbody.props.children[0];
      expect(firstRow.props.className).toContain('cs-tr-clickable');

      firstRow.props.onClick();
      expect(onSelectRow).toHaveBeenCalledWith(mockTickets[0]);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. TicketsListPage Integration with DataTable
  // ---------------------------------------------------------------------------
  describe('6. TicketsListPage Integration with DataTable', () => {
    it('passes columns, data, sorting, and pagination props to DataTable when loaded', () => {
      const onSortChange = vi.fn();
      const onPageChange = vi.fn();
      const tickets = [
        { id: '1', subject: 'Fix bug', status: 'New', priority: 'High', contactName: 'Sarah Connor' },
      ];

      const element = TicketsListPage({
        data: tickets,
        sort: { columnKey: 'status', direction: 'asc' },
        pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
        onSortChange,
        onPageChange,
      });

      const content = element.props.children[1];
      const dataTable = content.props.children[2];
      expect(dataTable.type).toBe(DataTable);
      expect(dataTable.props.data).toEqual(tickets);
      expect(dataTable.props.sort).toEqual({ columnKey: 'status', direction: 'asc' });
      expect(dataTable.props.onSortChange).toBe(onSortChange);
      expect(dataTable.props.onPageChange).toBe(onPageChange);
    });
  });
});
