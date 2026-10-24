import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import {
  SearchFilterController,
  SEARCH_DEBOUNCE_MS,
} from '../table/SearchFilterController.js';
import {
  DataTableController,
  DEFAULT_PAGE_SIZE,
} from '../table/DataTableController.js';
import {
  MARKETING_LISTS_COLUMNS,
  CAMPAIGNS_COLUMNS,
  MEMBERS_COLUMNS,
  CONSENTS_COLUMNS,
} from '../table/columns.js';
import {
  CRM4_MARKETING_LISTS_FACETS,
  CRM4_CAMPAIGNS_FACETS,
  CRM4_MEMBERS_FACETS,
  CRM4_CONSENTS_FACETS,
} from '../table/facets.js';
import { SearchInput } from '../src/components/SearchInput.js';
import { ActiveFilterPills } from '../src/components/ActiveFilterPills.js';
import { FacetedFilterSidebar } from '../src/components/FacetedFilterSidebar.js';
import { FilterToolbar } from '../src/components/FilterToolbar.js';
import { MarketingListsPage } from '../src/pages/MarketingListsPage.js';
import type { CRM4List } from '@clearshift/contracts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asEl = (node: unknown): any => node as any;

describe('Issue #171 [CRM4-18] CRM-4 Search, Filters and Sorting Controls', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    const dispatcher = {
      useState: (initial: unknown) => [
        typeof initial === 'function' ? (initial as () => unknown)() : initial,
        vi.fn(),
      ],
      useId: () => ':crm4-search-test-id:',
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. Acceptance Criteria 1: 300ms Debounced Keystroke Protocol
  // ---------------------------------------------------------------------------
  describe('1. Debounced Keystrokes (300ms Protocol) (AC 1)', () => {
    it('debounces rapid keystrokes by exactly 300ms before emitting search change', () => {
      const onSearchChange = vi.fn();
      const onQueryChange = vi.fn();
      const controller = new SearchFilterController({
        onSearchChange,
        onQueryChange,
      });

      // User types 'E'
      controller.setSearch('E');
      expect(onSearchChange).not.toHaveBeenCalled();

      // After 100ms, user types 'En'
      vi.advanceTimersByTime(100);
      controller.setSearch('En');
      expect(onSearchChange).not.toHaveBeenCalled();

      // After 100ms, user types 'Enterprise'
      vi.advanceTimersByTime(100);
      controller.setSearch('Enterprise');
      expect(onSearchChange).not.toHaveBeenCalled();

      // Advance by 200ms (total 200ms < 300ms debounce)
      vi.advanceTimersByTime(200);
      expect(onSearchChange).not.toHaveBeenCalled();

      // Complete the 300ms timer
      vi.advanceTimersByTime(100);
      expect(onSearchChange).toHaveBeenCalledTimes(1);
      expect(onSearchChange).toHaveBeenCalledWith('Enterprise');
      expect(onQueryChange).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'Enterprise' })
      );
    });

    it('flushes pending debounced search immediately on flushSearch()', () => {
      const onSearchChange = vi.fn();
      const controller = new SearchFilterController({ onSearchChange });

      controller.setSearch('Q4-Product-Blitz');
      expect(onSearchChange).not.toHaveBeenCalled();

      controller.flushSearch();
      expect(onSearchChange).toHaveBeenCalledTimes(1);
      expect(onSearchChange).toHaveBeenCalledWith('Q4-Product-Blitz');

      // Advancing time further should not re-trigger
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      expect(onSearchChange).toHaveBeenCalledTimes(1);
    });

    it('cancels pending debounce on cancelSearch() without notifying listeners', () => {
      const onSearchChange = vi.fn();
      const controller = new SearchFilterController({ onSearchChange });

      controller.setSearch('aborted-keystroke');
      controller.cancelSearch();

      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
      expect(onSearchChange).not.toHaveBeenCalled();
    });

    it('clears search immediately on clearSearch() with immediate callback execution', () => {
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
  // 2. Acceptance Criteria 2: Faceted Filters & URL Query State
  // ---------------------------------------------------------------------------
  describe('2. Faceted Filters & URL Query State Synchronization (AC 2)', () => {
    it('sets individual faceted filters and notifies subscribers', () => {
      const onFilterChange = vi.fn();
      const onQueryChange = vi.fn();
      const controller = new SearchFilterController({
        onFilterChange,
        onQueryChange,
      });

      controller.setFilter('memberRange', 'large');
      expect(onFilterChange).toHaveBeenCalledWith({ memberRange: 'large' });
      expect(onQueryChange).toHaveBeenCalledWith({ memberRange: 'large' });

      controller.setFilter('campaignActivity', 'active');
      expect(controller.getFilters()).toEqual({
        memberRange: 'large',
        campaignActivity: 'active',
      });
      expect(onQueryChange).toHaveBeenCalledWith({
        memberRange: 'large',
        campaignActivity: 'active',
      });
    });

    it('removes empty or whitespace-only filter values from active filter map', () => {
      const controller = new SearchFilterController({
        initialFilters: { memberRange: 'small', campaignActivity: 'active' },
      });

      controller.setFilter('memberRange', '');
      expect(controller.getFilters()).toEqual({ campaignActivity: 'active' });

      controller.setFilter('campaignActivity', '   ');
      expect(controller.getFilters()).toEqual({});
      expect(controller.hasActiveFilters()).toBe(false);
    });

    it('serializes search and faceted filters into query strings and params', () => {
      const controller = new SearchFilterController({
        initialSearch: 'Enterprise',
        initialFilters: { memberRange: 'medium', campaignActivity: 'active' },
      });

      const params = controller.toQueryParams();
      expect(params['search']).toBe('Enterprise');
      expect(params['memberRange']).toBe('medium');
      expect(params['campaignActivity']).toBe('active');

      const queryStr = controller.toQueryString();
      expect(queryStr).toContain('search=Enterprise');
      expect(queryStr).toContain('memberRange=medium');
      expect(queryStr).toContain('campaignActivity=active');
    });

    it('restores state bidirectionally from URLSearchParams', () => {
      const controller = new SearchFilterController();
      const urlParams = new URLSearchParams(
        'search=Webinar&memberRange=large&campaignActivity=active&page=2'
      );

      controller.fromQueryParams(urlParams);
      expect(controller.getSearch()).toBe('Webinar');
      expect(controller.getFilters()).toEqual({
        memberRange: 'large',
        campaignActivity: 'active',
      });
      expect(controller.hasActiveFilters()).toBe(true);
    });

    it('resets pagination to page 1 in DataTableController when filter is changed', () => {
      const onQueryChange = vi.fn();
      const tableController = new DataTableController({
        columns: MARKETING_LISTS_COLUMNS,
        initialPage: 3,
        onQueryChange,
      });

      tableController.setTotal(100);
      expect(tableController.getPagination().page).toBe(3);

      tableController.setFilter('memberRange', 'large');
      // Invariant: Changing filter MUST reset to page 1 to prevent out-of-bounds pagination
      expect(tableController.getPagination().page).toBe(1);
      expect(tableController.getFilters()).toEqual({ memberRange: 'large' });

      const queryParams = tableController.toQueryParams();
      expect(queryParams['page']).toBe('1');
      expect(queryParams['memberRange']).toBe('large');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Acceptance Criteria 3: Active Filter Pills & Clear All
  // ---------------------------------------------------------------------------
  describe('3. Active Filter Pill Tags & Removal Lifecycle (AC 3)', () => {
    it('constructs descriptive active filter pills for search and CRM-4 facets', () => {
      const controller = new SearchFilterController({
        initialSearch: 'Tier-1',
        initialFilters: { memberRange: 'large', campaignActivity: 'active' },
      });

      const pills = controller.getActiveFilterPills(CRM4_MARKETING_LISTS_FACETS);
      expect(pills).toHaveLength(3);

      expect(pills[0]).toEqual({
        key: 'search',
        label: 'Search',
        value: 'Tier-1',
        displayValue: '"Tier-1"',
      });

      const sizePill = pills.find((p) => p.key === 'memberRange');
      expect(sizePill).toBeDefined();
      expect(sizePill?.label).toBe('Audience Size');
      expect(sizePill?.displayValue).toBe('250+ Members');

      const activityPill = pills.find((p) => p.key === 'campaignActivity');
      expect(activityPill).toBeDefined();
      expect(activityPill?.label).toBe('Campaign Activity');
      expect(activityPill?.displayValue).toBe('With Campaigns (>0)');
    });

    it('removes individual filter tags without clearing other active filters', () => {
      const controller = new SearchFilterController({
        initialSearch: 'Enterprise',
        initialFilters: { memberRange: 'small', campaignActivity: 'active' },
      });

      expect(controller.getActiveFilterPills()).toHaveLength(3);

      // Remove only the 'memberRange' pill
      controller.removeFilter('memberRange');
      expect(controller.getFilter('memberRange')).toBeUndefined();
      expect(controller.getFilter('campaignActivity')).toBe('active');
      expect(controller.getSearch()).toBe('Enterprise');

      const updatedPills = controller.getActiveFilterPills();
      expect(updatedPills).toHaveLength(2);
      expect(updatedPills.map((p) => p.key)).toEqual(['search', 'campaignActivity']);

      // Remove search pill
      controller.removeFilter('search');
      expect(controller.getSearch()).toBe('');
      expect(controller.getActiveFilterPills()).toHaveLength(1);
    });

    it('clears all active filters and search at once via clearAll()', () => {
      const onFilterChange = vi.fn();
      const onSearchChange = vi.fn();
      const controller = new SearchFilterController({
        initialSearch: 'active-query',
        initialFilters: { memberRange: 'empty', campaignActivity: 'none' },
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
  // 4. Acceptance Criteria 4: Empty Search/Filter State
  // ---------------------------------------------------------------------------
  describe('4. Empty Search/Filter State Contract (AC 4)', () => {
    const syntheticLists: CRM4List[] = [
      {
        id: '40000000-0000-4000-8000-000000000001',
        name: 'Enterprise VIP Accounts',
        description: 'Fortune 500 accounts',
        campaignCount: 3,
        memberCount: 150,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      },
    ];

    it('renders informative empty state message when search query yields zero matches', () => {
      const element = asEl(
        MarketingListsPage({
          initialLists: syntheticLists,
          initialFilters: { search: 'NonExistentString123' },
        })
      );

      const [, , , , dataCard] = element.props.children;
      expect(dataCard).toBeDefined();

      const tableComponent = asEl(dataCard.props.children[0]);
      expect(tableComponent.props.lists).toHaveLength(0);
      expect(tableComponent.props.emptyTitle).toBe('No matching marketing lists');
      expect(tableComponent.props.emptyDescription).toContain('No marketing lists match');
    });

    it('renders informative empty state message when faceted filter yields zero matches', () => {
      const element = asEl(
        MarketingListsPage({
          initialLists: syntheticLists,
          initialFilters: { memberRange: 'empty' }, // syntheticLists has memberCount=150
        })
      );

      const [, , , , dataCard] = element.props.children;
      const tableComponent = asEl(dataCard.props.children[0]);
      expect(tableComponent.props.lists).toHaveLength(0);
      expect(tableComponent.props.emptyTitle).toBe('No matching marketing lists');
      expect(tableComponent.props.emptyDescription).toContain('No marketing lists match the active filter criteria');
    });

    it('renders standard empty state when no filters are active and table is legitimately empty', () => {
      const element = asEl(
        MarketingListsPage({
          initialLists: [],
        })
      );

      const [, , , , dataCard] = element.props.children;
      const tableComponent = asEl(dataCard.props.children[0]);
      expect(tableComponent.props.lists).toHaveLength(0);
      expect(tableComponent.props.emptyTitle).toBe('No marketing lists recorded');
      expect(tableComponent.props.emptyDescription).toBe('No marketing lists are currently registered in CRM-4.');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Component Props & WAI-ARIA Markup Specifications
  // ---------------------------------------------------------------------------
  describe('5. Component Rendering & WAI-ARIA Semantics', () => {
    it('SearchInput renders accessible search markup with role="search"', () => {
      const onClear = vi.fn();
      const element = asEl(
        SearchInput({
          value: 'test query',
          onClear,
        })
      );

      expect(element.props.role).toBe('search');
      expect(element.props.className).toContain('cs-search-bar');

      const [, inputWrapper] = element.props.children;
      const [, inputEl, clearBtn] = inputWrapper.props.children;

      expect(inputEl.props['aria-label']).toBe('Search records');
      expect(inputEl.props.value).toBe('test query');
      expect(clearBtn.props['aria-label']).toBe('Clear search');

      // Click clear button
      clearBtn.props.onClick();
      expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('ActiveFilterPills renders region with accessible removal buttons and Clear All', () => {
      const onRemoveFilter = vi.fn();
      const onClearAll = vi.fn();
      const pills = [
        { key: 'search', label: 'Search', value: 'Alpha', displayValue: '"Alpha"' },
        { key: 'status', label: 'Status', value: 'sent', displayValue: 'Sent' },
      ];

      const element = asEl(
        ActiveFilterPills({
          pills,
          onRemoveFilter,
          onClearAll,
        })
      );

      expect(element.props.role).toBe('region');
      expect(element.props['aria-label']).toBe('Active filters');

      const [, pillsList] = element.props.children;
      const [pillItems, clearAllBtn] = pillsList.props.children;

      expect(pillItems).toHaveLength(2);
      expect(clearAllBtn.props['aria-label']).toBe('Clear all active filters');

      // Trigger pill remove
      const firstPillRemoveBtn = asEl(pillItems[0].props.children[1]);
      firstPillRemoveBtn.props.onClick();
      expect(onRemoveFilter).toHaveBeenCalledWith('search');

      // Trigger Clear All
      clearAllBtn.props.onClick();
      expect(onClearAll).toHaveBeenCalledTimes(1);
    });

    it('ActiveFilterPills returns null when no pills are present', () => {
      const element = ActiveFilterPills({
        pills: [],
        onRemoveFilter: () => {},
        onClearAll: () => {},
      });
      expect(element).toBeNull();
    });

    it('FacetedFilterSidebar renders accessible aside landmark with category selects', () => {
      const onFilterChange = vi.fn();
      const onClearAll = vi.fn();

      const element = asEl(
        FacetedFilterSidebar({
          facets: CRM4_MARKETING_LISTS_FACETS,
          filters: { memberRange: 'large' },
          onFilterChange,
          onClearAll,
          hasActiveFilters: true,
        })
      );

      expect(element.type).toBe('aside');
      expect(element.props['aria-label']).toBe('Faceted Filters');

      const [header, facetsContainer] = element.props.children;
      expect(header.props.children[1].props['aria-label']).toBe('Reset all filters');

      // 2 facet groups
      expect(facetsContainer.props.children).toHaveLength(2);
    });

    it('FilterToolbar renders composite search, facet select, and pills', () => {
      const element = asEl(
        FilterToolbar({
          search: 'Launch',
          onSearchChange: vi.fn(),
          facets: CRM4_CAMPAIGNS_FACETS,
          filters: { status: 'sent' },
          onFilterChange: vi.fn(),
          activePills: [
            { key: 'status', label: 'Campaign Status', value: 'sent', displayValue: 'Sent / Completed' },
          ],
          onRemoveFilter: vi.fn(),
          onClearAll: vi.fn(),
        })
      );

      expect(element.props.className).toContain('cs-filter-toolbar');
      const [topBar, pillsEl] = element.props.children;
      expect(topBar.props.className).toContain('cs-filter-toolbar-top');
      expect(pillsEl).toBeDefined();
    });

    it('Controller renders accessible WAI-ARIA HTML string with search, facets and pills', () => {
      const controller = new SearchFilterController({
        initialSearch: 'Enterprise',
        initialFilters: { memberRange: 'large' },
      });

      const html = controller.renderHtml(CRM4_MARKETING_LISTS_FACETS);
      expect(html).toContain('role="search"');
      expect(html).toContain('class="cs-filter-toolbar"');
      expect(html).toContain('class="cs-filter-pill"');
      expect(html).toContain('Audience Size:');
      expect(html).toContain('250+ Members');
      expect(html).toContain('Clear All');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Domain Invariant Enforcement (BR-CRM4-01 & Allowlist Verification)
  // ---------------------------------------------------------------------------
  describe('6. Domain Invariant Enforcement & Multi-Entity Facets (BR-CRM4-01)', () => {
    it('verifies consent facet includes unsubscribed opt-out option (BR-CRM4-01)', () => {
      const consentFacet = CRM4_CONSENTS_FACETS.find((f) => f.id === 'consentStatus');
      expect(consentFacet).toBeDefined();

      const unsubscribedOption = consentFacet?.options.find((o) => o.value === 'unsubscribed');
      expect(unsubscribedOption).toBeDefined();
      expect(unsubscribedOption?.label).toBe('Unsubscribed (Opted Out)');
    });

    it('verifies member status facet is strictly restricted to allowlist [sent, opened, clicked]', () => {
      const memberFacet = CRM4_MEMBERS_FACETS.find((f) => f.id === 'status');
      expect(memberFacet).toBeDefined();

      const optionValues = memberFacet?.options
        .map((o) => o.value)
        .filter((v) => v !== '');

      expect(optionValues).toEqual(['sent', 'opened', 'clicked']);
      expect(optionValues).not.toContain('bounced');
      expect(optionValues).not.toContain('delivered');
      expect(optionValues).not.toContain('queued');
    });

    it('verifies member opt-out facet explicitly exposes unsubscribed states', () => {
      const unsubFacet = CRM4_MEMBERS_FACETS.find((f) => f.id === 'unsubscribed');
      expect(unsubFacet).toBeDefined();
      expect(unsubFacet?.options.map((o) => o.value)).toEqual(['', 'false', 'true']);
    });
  });
});
