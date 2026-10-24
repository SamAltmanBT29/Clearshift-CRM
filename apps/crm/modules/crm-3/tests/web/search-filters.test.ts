import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SearchFilterController,
  SEARCH_DEBOUNCE_MS,
} from '../../web/table/SearchFilterController.js';
import {
  DataTableController,
  DEFAULT_PAGE_SIZE,
} from '../../web/table/DataTableController.js';
import { TICKETS_COLUMNS } from '../../web/table/columns.js';
import {
  CRM3_TICKETS_FACETS,
  CRM3_IMPORTS_FACETS,
} from '../../web/table/facets.js';

describe('CRM-3 Support Tickets Search, Filters, and Sorting Controls (Issue #151 / [CRM3-18])', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. Search Input Debouncing (300ms Protocol)
  // ---------------------------------------------------------------------------
  describe('1. Search Input Debouncing (300ms Protocol)', () => {
    it('debounces keystrokes by exactly 300ms before triggering onSearchChange', () => {
      const onSearchChange = vi.fn();
      const onQueryChange = vi.fn();
      const controller = new SearchFilterController({
        onSearchChange,
        onQueryChange,
      });

      controller.setSearch('c');
      expect(onSearchChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      controller.setSearch('ca');
      expect(onSearchChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      controller.setSearch('can');
      expect(onSearchChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(200);
      expect(onSearchChange).not.toHaveBeenCalled(); // 200ms < 300ms

      vi.advanceTimersByTime(100); // 300ms elapsed since last keystroke 'can'
      expect(onSearchChange).toHaveBeenCalledTimes(1);
      expect(onSearchChange).toHaveBeenCalledWith('can');
      expect(onQueryChange).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'can' })
      );
    });

    it('flushes pending search immediately on Enter / flushSearch()', () => {
      const onSearchChange = vi.fn();
      const controller = new SearchFilterController({ onSearchChange });

      controller.setSearch('Cannot login to account');
      expect(onSearchChange).not.toHaveBeenCalled();

      controller.flushSearch();
      expect(onSearchChange).toHaveBeenCalledTimes(1);
      expect(onSearchChange).toHaveBeenCalledWith('Cannot login to account');

      // Advancing timer further should not trigger duplicate callback
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      expect(onSearchChange).toHaveBeenCalledTimes(1);
    });

    it('cancels pending debounce timer on cancelSearch() without triggering callback', () => {
      const onSearchChange = vi.fn();
      const controller = new SearchFilterController({ onSearchChange });

      controller.setSearch('aborted-search-term');
      controller.cancelSearch();

      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
      expect(onSearchChange).not.toHaveBeenCalled();
    });

    it('clears search immediately on clearSearch() with immediate callback', () => {
      const onSearchChange = vi.fn();
      const controller = new SearchFilterController({
        initialSearch: 'existing query',
        onSearchChange,
      });

      controller.clearSearch();
      expect(onSearchChange).toHaveBeenCalledWith('');
      expect(controller.getSearch()).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Faceted Filters & URL Query State Synchronization
  // ---------------------------------------------------------------------------
  describe('2. Faceted Filters & URL Query State Synchronization', () => {
    it('sets individual faceted filters and triggers query state notifications', () => {
      const onFilterChange = vi.fn();
      const onQueryChange = vi.fn();
      const controller = new SearchFilterController({
        onFilterChange,
        onQueryChange,
      });

      controller.setFilter('status', 'Open');
      expect(onFilterChange).toHaveBeenCalledWith({ status: 'Open' });
      expect(onQueryChange).toHaveBeenCalledWith({ status: 'Open' });

      controller.setFilter('priority', 'Urgent');
      expect(controller.getFilters()).toEqual({
        status: 'Open',
        priority: 'Urgent',
      });
      expect(onQueryChange).toHaveBeenCalledWith({
        status: 'Open',
        priority: 'Urgent',
      });
    });

    it('removes empty or whitespace-only filter values from active filter map', () => {
      const controller = new SearchFilterController({
        initialFilters: { status: 'New', priority: 'High' },
      });

      controller.setFilter('status', '');
      expect(controller.getFilters()).toEqual({ priority: 'High' });

      controller.setFilter('priority', '   ');
      expect(controller.getFilters()).toEqual({});
      expect(controller.hasActiveFilters()).toBe(false);
    });

    it('serializes search and faceted filters into standard URL query strings', () => {
      const controller = new SearchFilterController({
        initialSearch: 'billing',
        initialFilters: { status: 'Waiting', priority: 'Urgent' },
      });

      const params = controller.toQueryParams();
      expect(params['search']).toBe('billing');
      expect(params['status']).toBe('Waiting');
      expect(params['priority']).toBe('Urgent');

      const queryString = controller.toQueryString();
      expect(queryString).toContain('search=billing');
      expect(queryString).toContain('status=Waiting');
      expect(queryString).toContain('priority=Urgent');
    });

    it('restores state bidirectionally from URL query parameters (URLSearchParams)', () => {
      const controller = new SearchFilterController();
      const urlParams = new URLSearchParams(
        'search=password&status=Solved&priority=Normal&page=2&pageSize=25'
      );

      controller.fromQueryParams(urlParams);
      expect(controller.getSearch()).toBe('password');
      expect(controller.getFilters()).toEqual({
        status: 'Solved',
        priority: 'Normal',
      });
      expect(controller.hasActiveFilters()).toBe(true);
    });

    it('integrates filters with DataTableController and resets page to 1 on filter mutation', () => {
      const onQueryChange = vi.fn();
      const tableController = new DataTableController({
        columns: TICKETS_COLUMNS,
        initialPage: 4,
        onQueryChange,
      });

      tableController.setTotal(100);
      expect(tableController.getPagination().page).toBe(4);

      tableController.setFilter('status', 'Open');
      // Invariant: Changing filter MUST reset page to 1 to avoid phantom pagination out-of-bounds
      expect(tableController.getPagination().page).toBe(1);
      expect(tableController.getFilters()).toEqual({ status: 'Open' });

      const queryParams = tableController.toQueryParams();
      expect(queryParams['page']).toBe('1');
      expect(queryParams['status']).toBe('Open');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Active Filter Pill Tags & Removal Lifecycle
  // ---------------------------------------------------------------------------
  describe('3. Active Filter Pill Tags & Lifecycle', () => {
    it('constructs descriptive active filter pills for search and facets', () => {
      const controller = new SearchFilterController({
        initialSearch: 'ORD-1001',
        initialFilters: { status: 'Open', priority: 'High' },
      });

      const pills = controller.getActiveFilterPills(CRM3_TICKETS_FACETS);
      expect(pills).toHaveLength(3);

      expect(pills[0]).toEqual({
        key: 'search',
        label: 'Search',
        value: 'ORD-1001',
        displayValue: '"ORD-1001"',
      });

      const statusPill = pills.find((p) => p.key === 'status');
      expect(statusPill).toBeDefined();
      expect(statusPill?.label).toBe('Status');
      expect(statusPill?.displayValue).toBe('Open');

      const priorityPill = pills.find((p) => p.key === 'priority');
      expect(priorityPill).toBeDefined();
      expect(priorityPill?.label).toBe('Priority');
      expect(priorityPill?.displayValue).toBe('High');
    });

    it('removes individual filter tags without clearing other active filters', () => {
      const controller = new SearchFilterController({
        initialSearch: 'crash',
        initialFilters: { status: 'New', priority: 'Urgent' },
      });

      expect(controller.getActiveFilterPills()).toHaveLength(3);

      // Remove only the 'status' filter tag
      controller.removeFilter('status');
      expect(controller.getFilter('status')).toBeUndefined();
      expect(controller.getFilter('priority')).toBe('Urgent');
      expect(controller.getSearch()).toBe('crash');

      const updatedPills = controller.getActiveFilterPills();
      expect(updatedPills).toHaveLength(2);
      expect(updatedPills.map((p) => p.key)).toEqual(['search', 'priority']);

      // Remove search pill tag
      controller.removeFilter('search');
      expect(controller.getSearch()).toBe('');
      expect(controller.getActiveFilterPills()).toHaveLength(1);
    });

    it('clears all active filters and search at once via clearAll()', () => {
      const onFilterChange = vi.fn();
      const onSearchChange = vi.fn();
      const controller = new SearchFilterController({
        initialSearch: 'active-query',
        initialFilters: { status: 'New', priority: 'Low' },
        onFilterChange,
        onSearchChange,
      });

      expect(controller.hasActiveFilters()).toBe(true);

      controller.clearAll();
      expect(controller.getSearch()).toBe('');
      expect(controller.getFilters()).toEqual({});
      expect(controller.hasActiveFilters()).toBe(false);
      expect(controller.getActiveFilterPills()).toHaveLength(0);
      expect(onSearchChange).toHaveBeenCalledWith('');
      expect(onFilterChange).toHaveBeenCalledWith({});
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Empty Search/Filter State
  // ---------------------------------------------------------------------------
  describe('4. Empty Search/Filter State Contract & Reset Recovery', () => {
    it('renders informative empty state message and reset button when active filters yield zero rows', () => {
      const controller = new DataTableController({
        columns: TICKETS_COLUMNS,
        initialFilters: { status: 'Closed', search: 'nonexistent' },
      });

      const html = controller.renderHtml([]);

      expect(html).toContain('cs-empty-filter-state');
      expect(html).toContain('No matching records found');
      expect(html).toContain(
        'No records matched your search and filter criteria. Try adjusting your search term or clearing filters.'
      );
      expect(html).toContain('Reset All Filters');
      expect(html).toContain('data-action="clear-all-filters"');
    });

    it('renders standard empty state without reset button when no filters are active and table is empty', () => {
      const controller = new DataTableController({
        columns: TICKETS_COLUMNS,
      });

      const html = controller.renderHtml([]);

      expect(html).not.toContain('cs-empty-filter-state');
      expect(html).not.toContain('Reset All Filters');
      expect(html).toContain('No records found');
      expect(html).toContain(
        'There are no records matching your current filter criteria.'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Accessible WAI-ARIA Markup & Controller HTML Rendering
  // ---------------------------------------------------------------------------
  describe('5. Accessible WAI-ARIA Markup & HTML Generation', () => {
    it('generates accessible search bar and faceted filter toolbar markup', () => {
      const controller = new SearchFilterController({
        initialSearch: 'Invoice issue',
        initialFilters: { status: 'Open' },
      });

      const html = controller.renderHtml(CRM3_TICKETS_FACETS);

      expect(html).toContain('role="search"');
      expect(html).toContain('aria-label="Search records"');
      expect(html).toContain('class="cs-search-clear-btn"');
      expect(html).toContain('role="region" aria-label="Active filters"');
      expect(html).toContain('class="cs-filter-pill"');
      expect(html).toContain('aria-label="Remove filter: Search &quot;Invoice issue&quot;"');
      expect(html).toContain('aria-label="Remove filter: Status Open"');
      expect(html).toContain('class="cs-clear-all-filters-btn"');
    });

    it('renders clean toolbar when no active filters or search exist', () => {
      const controller = new SearchFilterController();
      const html = controller.renderHtml(CRM3_TICKETS_FACETS);

      expect(html).toContain('role="search"');
      expect(html).not.toContain('cs-active-filter-pills');
      expect(html).not.toContain('cs-filter-pill');
      expect(html).not.toContain('cs-search-clear-btn');
    });

    it('renders facet options for all entity definitions (tickets, imports)', () => {
      const controller = new SearchFilterController();

      const ticketsHtml = controller.renderHtml(CRM3_TICKETS_FACETS);
      expect(ticketsHtml).toContain('Status');
      expect(ticketsHtml).toContain('Priority');
      expect(ticketsHtml).toContain('Urgent');

      const importsHtml = controller.renderHtml(CRM3_IMPORTS_FACETS);
      expect(importsHtml).toContain('Batch Status');
      expect(importsHtml).toContain('Processing');
    });
  });
});
