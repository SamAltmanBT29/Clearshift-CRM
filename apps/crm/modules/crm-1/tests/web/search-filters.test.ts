import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SearchFilterController,
  SEARCH_DEBOUNCE_MS,
} from '../../web/table/SearchFilterController.js';
import {
  DataTableController,
  DEFAULT_PAGE_SIZE,
} from '../../web/table/DataTableController.js';
import { CONTACTS_COLUMNS } from '../../web/table/columns.js';
import {
  CRM1_CONTACTS_FACETS,
  CRM1_COMPANIES_FACETS,
  CRM1_LEADS_FACETS,
  CRM1_DUPLICATES_FACETS,
  CRM1_IMPORTS_FACETS,
} from '../../web/table/facets.js';

describe('CRM-1 Search, Filters, and Sorting Controls (Issue #111 / CRM1-18)', () => {
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

      controller.setSearch('j');
      expect(onSearchChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      controller.setSearch('jo');
      expect(onSearchChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      controller.setSearch('joh');
      expect(onSearchChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(200);
      expect(onSearchChange).not.toHaveBeenCalled(); // 200ms < 300ms

      vi.advanceTimersByTime(100); // 300ms elapsed since last keystroke 'joh'
      expect(onSearchChange).toHaveBeenCalledTimes(1);
      expect(onSearchChange).toHaveBeenCalledWith('joh');
      expect(onQueryChange).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'joh' })
      );
    });

    it('flushes pending search immediately on Enter / flushSearch()', () => {
      const onSearchChange = vi.fn();
      const controller = new SearchFilterController({ onSearchChange });

      controller.setSearch('alex.smith@example.com');
      expect(onSearchChange).not.toHaveBeenCalled();

      controller.flushSearch();
      expect(onSearchChange).toHaveBeenCalledTimes(1);
      expect(onSearchChange).toHaveBeenCalledWith('alex.smith@example.com');

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

      controller.setFilter('leadStatus', 'Qualified');
      expect(onFilterChange).toHaveBeenCalledWith({ leadStatus: 'Qualified' });
      expect(onQueryChange).toHaveBeenCalledWith({ leadStatus: 'Qualified' });

      controller.setFilter('consentStatus', 'granted');
      expect(controller.getFilters()).toEqual({
        leadStatus: 'Qualified',
        consentStatus: 'granted',
      });
      expect(onQueryChange).toHaveBeenCalledWith({
        leadStatus: 'Qualified',
        consentStatus: 'granted',
      });
    });

    it('removes empty or whitespace-only filter values from active filter map', () => {
      const controller = new SearchFilterController({
        initialFilters: { leadStatus: 'New', consentStatus: 'withdrawn' },
      });

      controller.setFilter('leadStatus', '');
      expect(controller.getFilters()).toEqual({ consentStatus: 'withdrawn' });

      controller.setFilter('consentStatus', '   ');
      expect(controller.getFilters()).toEqual({});
      expect(controller.hasActiveFilters()).toBe(false);
    });

    it('serializes search and faceted filters into standard URL query strings', () => {
      const controller = new SearchFilterController({
        initialSearch: 'Sarah',
        initialFilters: { leadStatus: 'Working', consentStatus: 'granted' },
      });

      const params = controller.toQueryParams();
      expect(params['search']).toBe('Sarah');
      expect(params['leadStatus']).toBe('Working');
      expect(params['consentStatus']).toBe('granted');

      const queryString = controller.toQueryString();
      expect(queryString).toContain('search=Sarah');
      expect(queryString).toContain('leadStatus=Working');
      expect(queryString).toContain('consentStatus=granted');
    });

    it('restores state bidirectionally from URL query parameters (URLSearchParams)', () => {
      const controller = new SearchFilterController();
      const urlParams = new URLSearchParams(
        'search=Morgan&leadStatus=Closed&consentStatus=unknown&page=2&pageSize=25'
      );

      controller.fromQueryParams(urlParams);
      expect(controller.getSearch()).toBe('Morgan');
      expect(controller.getFilters()).toEqual({
        leadStatus: 'Closed',
        consentStatus: 'unknown',
      });
      expect(controller.hasActiveFilters()).toBe(true);
    });

    it('integrates filters with DataTableController and resets page to 1 on filter mutation', () => {
      const onQueryChange = vi.fn();
      const tableController = new DataTableController({
        columns: CONTACTS_COLUMNS,
        initialPage: 4,
        onQueryChange,
      });

      tableController.setTotal(100);
      expect(tableController.getPagination().page).toBe(4);

      tableController.setFilter('leadStatus', 'Working');
      // Invariant: Changing filter MUST reset page to 1 to avoid phantom pagination out-of-bounds
      expect(tableController.getPagination().page).toBe(1);
      expect(tableController.getFilters()).toEqual({ leadStatus: 'Working' });

      const queryParams = tableController.toQueryParams();
      expect(queryParams['page']).toBe('1');
      expect(queryParams['leadStatus']).toBe('Working');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Active Filter Pill Tags & Removal Lifecycle
  // ---------------------------------------------------------------------------
  describe('3. Active Filter Pill Tags & Lifecycle', () => {
    it('constructs descriptive active filter pills for search and facets', () => {
      const controller = new SearchFilterController({
        initialSearch: 'Wayne',
        initialFilters: { leadStatus: 'Qualified', consentStatus: 'granted' },
      });

      const pills = controller.getActiveFilterPills(CRM1_CONTACTS_FACETS);
      expect(pills).toHaveLength(3);

      expect(pills[0]).toEqual({
        key: 'search',
        label: 'Search',
        value: 'Wayne',
        displayValue: '"Wayne"',
      });

      const leadStatusPill = pills.find((p) => p.key === 'leadStatus');
      expect(leadStatusPill).toBeDefined();
      expect(leadStatusPill?.label).toBe('Lead Status');
      expect(leadStatusPill?.displayValue).toBe('Qualified');

      const consentPill = pills.find((p) => p.key === 'consentStatus');
      expect(consentPill).toBeDefined();
      expect(consentPill?.label).toBe('Consent');
      expect(consentPill?.displayValue).toBe('Granted');
    });

    it('removes individual filter tags without clearing other active filters', () => {
      const controller = new SearchFilterController({
        initialSearch: 'Enterprise',
        initialFilters: { leadStatus: 'New', unsubscribed: 'false' },
      });

      expect(controller.getActiveFilterPills()).toHaveLength(3);

      // Remove only the 'leadStatus' filter tag
      controller.removeFilter('leadStatus');
      expect(controller.getFilter('leadStatus')).toBeUndefined();
      expect(controller.getFilter('unsubscribed')).toBe('false');
      expect(controller.getSearch()).toBe('Enterprise');

      const updatedPills = controller.getActiveFilterPills();
      expect(updatedPills).toHaveLength(2);
      expect(updatedPills.map((p) => p.key)).toEqual(['search', 'unsubscribed']);

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
        initialFilters: { leadStatus: 'New', consentStatus: 'withdrawn' },
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
        columns: CONTACTS_COLUMNS,
        initialFilters: { leadStatus: 'Qualified', search: 'nonexistent' },
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
        columns: CONTACTS_COLUMNS,
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
        initialFilters: { leadStatus: 'New' },
      });

      const html = controller.renderHtml(CRM1_CONTACTS_FACETS);

      expect(html).toContain('role="search"');
      expect(html).toContain('aria-label="Search records"');
      expect(html).toContain('class="cs-search-clear-btn"');
      expect(html).toContain('role="region" aria-label="Active filters"');
      expect(html).toContain('class="cs-filter-pill"');
      expect(html).toContain('aria-label="Remove filter: Search &quot;Acme&quot;"');
      expect(html).toContain('aria-label="Remove filter: Lead Status New"');
      expect(html).toContain('class="cs-clear-all-filters-btn"');
    });

    it('renders clean toolbar when no active filters or search exist', () => {
      const controller = new SearchFilterController();
      const html = controller.renderHtml(CRM1_CONTACTS_FACETS);

      expect(html).toContain('role="search"');
      expect(html).not.toContain('cs-active-filter-pills');
      expect(html).not.toContain('cs-filter-pill');
      expect(html).not.toContain('cs-search-clear-btn');
    });

    it('renders facet options for all entity definitions (companies, leads, duplicates, imports)', () => {
      const controller = new SearchFilterController();

      const companiesHtml = controller.renderHtml(CRM1_COMPANIES_FACETS);
      expect(companiesHtml).toContain('Source System');
      expect(companiesHtml).toContain('HubSpot');

      const leadsHtml = controller.renderHtml(CRM1_LEADS_FACETS);
      expect(leadsHtml).toContain('Status');
      expect(leadsHtml).toContain('Marketing Campaign');

      const duplicatesHtml = controller.renderHtml(CRM1_DUPLICATES_FACETS);
      expect(duplicatesHtml).toContain('Entity Type');
      expect(duplicatesHtml).toContain('Pending Review');

      const importsHtml = controller.renderHtml(CRM1_IMPORTS_FACETS);
      expect(importsHtml).toContain('Batch Status');
      expect(importsHtml).toContain('Processing');
    });
  });
});
