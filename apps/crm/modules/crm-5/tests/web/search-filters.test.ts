import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SearchFilterController,
  SEARCH_DEBOUNCE_MS,
} from '../../web/table/SearchFilterController.js';
import {
  DataTableController,
  DEFAULT_PAGE_SIZE,
} from '../../web/table/DataTableController.js';
import { RUNS_COLUMNS } from '../../web/table/columns.js';
import { CRM5_RUNS_FACETS } from '../../web/table/facets.js';

describe('CRM-5 Search, Filters, and Sorting Controls (Issue #191 / CRM5-18)', () => {
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

      controller.setSearch('b');
      expect(onSearchChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      controller.setSearch('ba');
      expect(onSearchChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      controller.setSearch('bat');
      expect(onSearchChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(200);
      expect(onSearchChange).not.toHaveBeenCalled(); // 200ms < 300ms

      vi.advanceTimersByTime(100); // 300ms elapsed since last keystroke 'bat'
      expect(onSearchChange).toHaveBeenCalledTimes(1);
      expect(onSearchChange).toHaveBeenCalledWith('bat');
      expect(onQueryChange).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'bat', batchId: 'bat' })
      );
    });

    it('flushes pending search immediately on Enter / flushSearch()', () => {
      const onSearchChange = vi.fn();
      const controller = new SearchFilterController({ onSearchChange });

      controller.setSearch('batch-contacts-01');
      expect(onSearchChange).not.toHaveBeenCalled();

      controller.flushSearch();
      expect(onSearchChange).toHaveBeenCalledTimes(1);
      expect(onSearchChange).toHaveBeenCalledWith('batch-contacts-01');

      // Advancing timer further should not trigger duplicate callback
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      expect(onSearchChange).toHaveBeenCalledTimes(1);
    });

    it('cancels pending debounce timer on cancelSearch() without triggering callback', () => {
      const onSearchChange = vi.fn();
      const controller = new SearchFilterController({ onSearchChange });

      controller.setSearch('aborted-query');
      controller.cancelSearch();

      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
      expect(onSearchChange).not.toHaveBeenCalled();
    });

    it('clears search immediately on clearSearch() with immediate callback', () => {
      const onSearchChange = vi.fn();
      const controller = new SearchFilterController({
        initialSearch: 'existing',
        onSearchChange,
      });

      controller.clearSearch();
      expect(onSearchChange).toHaveBeenCalledWith('');
      expect(controller.getSearch()).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Faceted Filters & URL Query State
  // ---------------------------------------------------------------------------
  describe('2. Faceted Filters & URL Query State Synchronization', () => {
    it('sets individual faceted filters and triggers query state notifications', () => {
      const onFilterChange = vi.fn();
      const onQueryChange = vi.fn();
      const controller = new SearchFilterController({
        onFilterChange,
        onQueryChange,
      });

      controller.setFilter('module', 'crm-1');
      expect(onFilterChange).toHaveBeenCalledWith({ module: 'crm-1' });
      expect(onQueryChange).toHaveBeenCalledWith({ module: 'crm-1' });

      controller.setFilter('status', 'running');
      expect(controller.getFilters()).toEqual({
        module: 'crm-1',
        status: 'running',
      });
      expect(onQueryChange).toHaveBeenCalledWith({
        module: 'crm-1',
        status: 'running',
      });
    });

    it('removes empty or whitespace-only filter values from active filter map', () => {
      const controller = new SearchFilterController({
        initialFilters: { module: 'crm-2', status: 'completed' },
      });

      controller.setFilter('module', '');
      expect(controller.getFilters()).toEqual({ status: 'completed' });

      controller.setFilter('status', '   ');
      expect(controller.getFilters()).toEqual({});
      expect(controller.hasActiveFilters()).toBe(false);
    });

    it('serializes search and faceted filters into standard URL query strings', () => {
      const controller = new SearchFilterController({
        initialSearch: 'batch-01',
        initialFilters: { module: 'crm-3', status: 'completed', step: 'load' },
      });

      const params = controller.toQueryParams();
      expect(params['search']).toBe('batch-01');
      expect(params['batchId']).toBe('batch-01'); // Server-side substring filter fallback
      expect(params['module']).toBe('crm-3');
      expect(params['status']).toBe('completed');
      expect(params['step']).toBe('load');

      const queryString = controller.toQueryString();
      expect(queryString).toContain('search=batch-01');
      expect(queryString).toContain('module=crm-3');
      expect(queryString).toContain('status=completed');
      expect(queryString).toContain('step=load');
    });

    it('restores state bidirectionally from URL query parameters (URLSearchParams)', () => {
      const controller = new SearchFilterController();
      const urlParams = new URLSearchParams(
        'search=batch-leads&module=crm-1&status=failed&page=2&pageSize=20'
      );

      controller.fromQueryParams(urlParams);
      expect(controller.getSearch()).toBe('batch-leads');
      expect(controller.getFilters()).toEqual({
        module: 'crm-1',
        status: 'failed',
      });
      expect(controller.hasActiveFilters()).toBe(true);
    });

    it('integrates filters with DataTableController and resets page to 1 on filter mutation', () => {
      const onQueryChange = vi.fn();
      const tableController = new DataTableController({
        columns: RUNS_COLUMNS,
        initialPage: 4,
        onQueryChange,
      });

      tableController.setTotal(100);
      expect(tableController.getPagination().page).toBe(4);

      tableController.setFilter('module', 'crm-4');
      // Invariant: Changing filter MUST reset page to 1 to avoid phantom pagination out-of-bounds
      expect(tableController.getPagination().page).toBe(1);
      expect(tableController.getFilters()).toEqual({ module: 'crm-4' });

      const queryParams = tableController.toQueryParams();
      expect(queryParams['page']).toBe('1');
      expect(queryParams['module']).toBe('crm-4');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Active Filter Pill Tags & Removal Lifecycle
  // ---------------------------------------------------------------------------
  describe('3. Active Filter Pill Tags & Lifecycle', () => {
    it('constructs descriptive active filter pills for search and facets', () => {
      const controller = new SearchFilterController({
        initialSearch: 'batch-99',
        initialFilters: { module: 'crm-5', status: 'halted' },
      });

      const pills = controller.getActiveFilterPills(CRM5_RUNS_FACETS);
      expect(pills).toHaveLength(3);

      expect(pills[0]).toEqual({
        key: 'search',
        label: 'Search',
        value: 'batch-99',
        displayValue: '"batch-99"',
      });

      const modulePill = pills.find((p) => p.key === 'module');
      expect(modulePill).toBeDefined();
      expect(modulePill?.label).toBe('Module');
      expect(modulePill?.displayValue).toBe('CRM-5 (Migration Control)');

      const statusPill = pills.find((p) => p.key === 'status');
      expect(statusPill).toBeDefined();
      expect(statusPill?.label).toBe('Status');
      expect(statusPill?.displayValue).toBe('Halted');
    });

    it('removes individual filter tags without clearing other active filters', () => {
      const controller = new SearchFilterController({
        initialSearch: 'test',
        initialFilters: { module: 'crm-1', status: 'running' },
      });

      expect(controller.getActiveFilterPills()).toHaveLength(3);

      // Remove only the 'module' filter tag
      controller.removeFilter('module');
      expect(controller.getFilter('module')).toBeUndefined();
      expect(controller.getFilter('status')).toBe('running');
      expect(controller.getSearch()).toBe('test');

      const updatedPills = controller.getActiveFilterPills();
      expect(updatedPills).toHaveLength(2);
      expect(updatedPills.map((p) => p.key)).toEqual(['search', 'status']);

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
        initialFilters: { module: 'crm-2', status: 'pending', step: 'clean' },
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
        columns: RUNS_COLUMNS,
        initialFilters: { module: 'crm-5', status: 'failed' },
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
        columns: RUNS_COLUMNS,
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
        initialSearch: 'batch-contacts',
        initialFilters: { module: 'crm-1' },
      });

      const html = controller.renderHtml(CRM5_RUNS_FACETS);

      expect(html).toContain('role="search"');
      expect(html).toContain('aria-label="Search records"');
      expect(html).toContain('class="cs-search-clear-btn"');
      expect(html).toContain('role="region" aria-label="Active filters"');
      expect(html).toContain('class="cs-filter-pill"');
      expect(html).toContain('aria-label="Remove filter: Search &quot;batch-contacts&quot;"');
      expect(html).toContain('aria-label="Remove filter: Module CRM-1 (Contacts &amp; Accounts)"');
      expect(html).toContain('class="cs-clear-all-filters-btn"');
    });

    it('renders clean toolbar when no active filters or search exist', () => {
      const controller = new SearchFilterController();
      const html = controller.renderHtml(CRM5_RUNS_FACETS);

      expect(html).toContain('role="search"');
      expect(html).not.toContain('cs-active-filter-pills');
      expect(html).not.toContain('cs-filter-pill');
      expect(html).not.toContain('cs-search-clear-btn');
    });
  });
});


