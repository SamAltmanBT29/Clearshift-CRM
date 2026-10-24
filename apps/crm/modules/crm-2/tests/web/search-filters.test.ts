import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SearchFilterController,
  SEARCH_DEBOUNCE_MS,
} from '../../web/src/table/SearchFilterController.js';
import {
  DataTableController,
  DEFAULT_PAGE_SIZE,
} from '../../web/src/table/DataTableController.js';
import { DEALS_COLUMNS, QUOTES_COLUMNS } from '../../web/src/table/columns.js';
import {
  CRM2_DEALS_FACETS,
  CRM2_QUOTES_FACETS,
  CRM2_DUPLICATES_FACETS,
} from '../../web/src/table/facets.js';

describe('CRM-2 Deals, Pipeline and Quotes: Search, Filters, and Sorting Controls (Issue #131 / CRM2-18)', () => {
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

      controller.setSearch('e');
      expect(onSearchChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      controller.setSearch('en');
      expect(onSearchChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      controller.setSearch('ent');
      expect(onSearchChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(200);
      expect(onSearchChange).not.toHaveBeenCalled(); // 200ms < 300ms

      vi.advanceTimersByTime(100); // 300ms elapsed since last keystroke 'ent'
      expect(onSearchChange).toHaveBeenCalledTimes(1);
      expect(onSearchChange).toHaveBeenCalledWith('ent');
      expect(onQueryChange).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'ent' })
      );
    });

    it('flushes pending search immediately on Enter / flushSearch()', () => {
      const onSearchChange = vi.fn();
      const controller = new SearchFilterController({ onSearchChange });

      controller.setSearch('enterprise-deal-q4');
      expect(onSearchChange).not.toHaveBeenCalled();

      controller.flushSearch();
      expect(onSearchChange).toHaveBeenCalledTimes(1);
      expect(onSearchChange).toHaveBeenCalledWith('enterprise-deal-q4');

      // Advancing timer further should not trigger duplicate callback
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      expect(onSearchChange).toHaveBeenCalledTimes(1);
    });

    it('cancels pending debounce timer on cancelSearch() without triggering callback', () => {
      const onSearchChange = vi.fn();
      const controller = new SearchFilterController({ onSearchChange });

      controller.setSearch('aborted-search');
      controller.cancelSearch();

      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
      expect(onSearchChange).not.toHaveBeenCalled();
    });

    it('clears search immediately on clearSearch() with immediate callback', () => {
      const onSearchChange = vi.fn();
      const controller = new SearchFilterController({
        initialSearch: 'pre-existing',
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

      controller.setFilter('stage', 'Proposal');
      expect(onFilterChange).toHaveBeenCalledWith({ stage: 'Proposal' });
      expect(onQueryChange).toHaveBeenCalledWith({ stage: 'Proposal' });

      controller.setFilter('is_orphan', 'true');
      expect(controller.getFilters()).toEqual({
        stage: 'Proposal',
        is_orphan: 'true',
      });
      expect(onQueryChange).toHaveBeenCalledWith({
        stage: 'Proposal',
        is_orphan: 'true',
      });
    });

    it('removes empty or whitespace-only filter values from active filter map', () => {
      const controller = new SearchFilterController({
        initialFilters: { stage: 'Qualified', source_system: 'hubspot' },
      });

      controller.setFilter('stage', '');
      expect(controller.getFilters()).toEqual({ source_system: 'hubspot' });

      controller.setFilter('source_system', '   ');
      expect(controller.getFilters()).toEqual({});
      expect(controller.hasActiveFilters()).toBe(false);
    });

    it('serializes search and faceted filters into standard URL query strings', () => {
      const controller = new SearchFilterController({
        initialSearch: 'Global Logistics',
        initialFilters: { stage: 'Negotiation', is_orphan: 'false' },
      });

      const params = controller.toQueryParams();
      expect(params['search']).toBe('Global Logistics');
      expect(params['stage']).toBe('Negotiation');
      expect(params['is_orphan']).toBe('false');

      const queryString = controller.toQueryString();
      expect(queryString).toContain('search=Global+Logistics');
      expect(queryString).toContain('stage=Negotiation');
      expect(queryString).toContain('is_orphan=false');
    });

    it('restores state bidirectionally from URL query parameters (URLSearchParams)', () => {
      const controller = new SearchFilterController();
      const urlParams = new URLSearchParams(
        'search=Apex&stage=Won&is_orphan=true&page=2&pageSize=10&sort=value&order=desc'
      );

      controller.fromQueryParams(urlParams);
      expect(controller.getSearch()).toBe('Apex');
      expect(controller.getFilters()).toEqual({
        stage: 'Won',
        is_orphan: 'true',
      });
      expect(controller.hasActiveFilters()).toBe(true);
    });

    it('integrates filters with DataTableController and resets page to 1 on filter mutation', () => {
      const onQueryChange = vi.fn();
      const tableController = new DataTableController({
        columns: DEALS_COLUMNS,
        initialPage: 3,
        initialPageSize: 10,
        onQueryChange,
      });

      tableController.setTotal(80);
      expect(tableController.getPagination().page).toBe(3);

      tableController.setFilter('stage', 'Proposal');
      // Invariant: Changing filter MUST reset page to 1 to avoid phantom pagination out-of-bounds
      expect(tableController.getPagination().page).toBe(1);
      expect(tableController.getFilters()).toEqual({ stage: 'Proposal' });

      const queryParams = tableController.toQueryParams();
      expect(queryParams['page']).toBe('1');
      expect(queryParams['stage']).toBe('Proposal');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Active Filter Pill Tags & Removal Lifecycle
  // ---------------------------------------------------------------------------
  describe('3. Active Filter Pill Tags & Lifecycle', () => {
    it('constructs descriptive active filter pills for search and facets', () => {
      const controller = new SearchFilterController({
        initialSearch: 'Cloud Migration',
        initialFilters: { stage: 'Won', is_orphan: 'true', source_system: 'salesforce' },
      });

      const pills = controller.getActiveFilterPills(CRM2_DEALS_FACETS);
      expect(pills).toHaveLength(4);

      expect(pills[0]).toEqual({
        key: 'search',
        label: 'Search',
        value: 'Cloud Migration',
        displayValue: '"Cloud Migration"',
      });

      const stagePill = pills.find((p) => p.key === 'stage');
      expect(stagePill).toBeDefined();
      expect(stagePill?.label).toBe('Pipeline Stage');
      expect(stagePill?.displayValue).toBe('Won');

      const orphanPill = pills.find((p) => p.key === 'is_orphan');
      expect(orphanPill).toBeDefined();
      expect(orphanPill?.label).toBe('Orphan Status');
      expect(orphanPill?.displayValue).toBe('Orphan (Unlinked)');

      const sourcePill = pills.find((p) => p.key === 'source_system');
      expect(sourcePill).toBeDefined();
      expect(sourcePill?.label).toBe('Source System');
      expect(sourcePill?.displayValue).toBe('Salesforce');
    });

    it('removes individual filter tags without clearing other active filters', () => {
      const controller = new SearchFilterController({
        initialSearch: 'Enterprise',
        initialFilters: { stage: 'New', source_system: 'hubspot' },
      });

      expect(controller.getActiveFilterPills()).toHaveLength(3);

      // Remove only the 'stage' filter tag
      controller.removeFilter('stage');
      expect(controller.getFilter('stage')).toBeUndefined();
      expect(controller.getFilter('source_system')).toBe('hubspot');
      expect(controller.getSearch()).toBe('Enterprise');

      const updatedPills = controller.getActiveFilterPills();
      expect(updatedPills).toHaveLength(2);
      expect(updatedPills.map((p) => p.key)).toEqual(['search', 'source_system']);

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
        initialFilters: { stage: 'Proposal', is_orphan: 'true' },
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
  // 4. Empty Search/Filter State Contract & Reset Recovery
  // ---------------------------------------------------------------------------
  describe('4. Empty Search/Filter State Contract & Reset Recovery', () => {
    it('renders informative empty state message and reset button when active filters yield zero rows', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
        initialFilters: { stage: 'Won', search: 'nonexistent-deal-key' },
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
        columns: DEALS_COLUMNS,
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
        initialSearch: 'Acme',
        initialFilters: { stage: 'Qualified' },
      });

      const html = controller.renderHtml(CRM2_DEALS_FACETS);

      expect(html).toContain('role="search"');
      expect(html).toContain('aria-label="Search records"');
      expect(html).toContain('class="cs-search-clear-btn"');
      expect(html).toContain('role="region" aria-label="Active filters"');
      expect(html).toContain('class="cs-filter-pill"');
      expect(html).toContain('aria-label="Remove filter: Search &quot;Acme&quot;"');
      expect(html).toContain('aria-label="Remove filter: Pipeline Stage Qualified"');
      expect(html).toContain('class="cs-clear-all-filters-btn"');
    });

    it('renders clean toolbar when no active filters or search exist', () => {
      const controller = new SearchFilterController();
      const html = controller.renderHtml(CRM2_DEALS_FACETS);

      expect(html).toContain('role="search"');
      expect(html).not.toContain('cs-active-filter-pills');
      expect(html).not.toContain('cs-filter-pill');
      expect(html).not.toContain('cs-search-clear-btn');
    });

    it('renders facet options for CRM-2 deals, quotes, and duplicate candidates', () => {
      const controller = new SearchFilterController();

      const dealsHtml = controller.renderHtml(CRM2_DEALS_FACETS);
      expect(dealsHtml).toContain('Pipeline Stage');
      expect(dealsHtml).toContain('Orphan Status');
      expect(dealsHtml).toContain('Source System');

      const quotesHtml = controller.renderHtml(CRM2_QUOTES_FACETS);
      expect(quotesHtml).toContain('Source System');
      expect(quotesHtml).toContain('ERP Sync');

      const duplicatesHtml = controller.renderHtml(CRM2_DUPLICATES_FACETS);
      expect(duplicatesHtml).toContain('Entity Type');
      expect(duplicatesHtml).toContain('Resolution Status');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Sorting Controls Predictability
  // ---------------------------------------------------------------------------
  describe('6. Sorting Controls Predictability', () => {
    it('toggles column sort direction deterministically and binds to query params', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
      });

      controller.toggleSort('name');
      expect(controller.getSort()).toEqual({ columnKey: 'name', direction: 'asc' });
      expect(controller.toQueryParams()['sort']).toBe('name');
      expect(controller.toQueryParams()['order']).toBe('asc');

      controller.toggleSort('name');
      expect(controller.getSort()).toEqual({ columnKey: 'name', direction: 'desc' });
      expect(controller.toQueryParams()['order']).toBe('desc');

      // Switching column resets direction to asc
      controller.toggleSort('value');
      expect(controller.getSort()).toEqual({ columnKey: 'value', direction: 'asc' });
    });

    it('client-side fallback accurately sorts and filters deal records', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
        initialSort: { columnKey: 'value', direction: 'desc' },
        initialFilters: { stage: 'Won' },
      });

      const sampleDeals = [
        { id: '1', name: 'Alpha', value: '10000.00', stage_name: 'Won' },
        { id: '2', name: 'Beta', value: '50000.00', stage_name: 'Won' },
        { id: '3', name: 'Gamma', value: '30000.00', stage_name: 'Proposal' },
      ];

      const result = controller.applyClientSide(sampleDeals);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('2'); // 50000 > 10000
      expect(result.items[1].id).toBe('1');
    });
  });
});
