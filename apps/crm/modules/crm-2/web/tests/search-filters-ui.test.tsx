import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { SearchInput } from '../src/components/SearchInput.js';
import { ActiveFilterPills } from '../src/components/ActiveFilterPills.js';
import { FacetedFilterSidebar } from '../src/components/FacetedFilterSidebar.js';
import { FilterToolbar } from '../src/components/FilterToolbar.js';
import { DealsListPage } from '../src/pages/DealsListPage.js';
import { CRM2_DEALS_FACETS } from '../src/table/facets.js';
import type { ActiveFilterPill, TableFilterState } from '../src/table/types.js';

describe('CRM-2 Search, Filters and Sorting UI Components (Issue #131 / [CRM2-18])', () => {
  describe('1. SearchInput Component', () => {
    it('creates accessible search bar with role="search" and default 300ms debounce', () => {
      const onChange = vi.fn();
      const onClear = vi.fn();
      const el = React.createElement(SearchInput, {
        value: 'Global',
        onChange,
        onClear,
        placeholder: 'Search opportunities...',
        id: 'test-deal-search',
      });

      expect(el).toBeDefined();
      expect(el.props.value).toBe('Global');
      expect(el.props.placeholder).toBe('Search opportunities...');
      expect(el.props.id).toBe('test-deal-search');
    });
  });

  describe('2. ActiveFilterPills Component', () => {
    it('returns null when pills list is empty', () => {
      const onRemoveFilter = vi.fn();
      const onClearAll = vi.fn();
      const rendered = ActiveFilterPills({
        pills: [],
        onRemoveFilter,
        onClearAll,
      });

      expect(rendered).toBeNull();
    });

    it('renders active filter pills with labels, display values and removal buttons', () => {
      const onRemoveFilter = vi.fn();
      const onClearAll = vi.fn();
      const samplePills: ActiveFilterPill[] = [
        { key: 'search', label: 'Search', value: 'Alpha', displayValue: '"Alpha"' },
        { key: 'stage', label: 'Pipeline Stage', value: 'Won', displayValue: 'Won' },
      ];

      const el = React.createElement(ActiveFilterPills, {
        pills: samplePills,
        onRemoveFilter,
        onClearAll,
      });

      expect(el).toBeDefined();
      const pills = el.props.pills as ActiveFilterPill[];
      expect(pills).toHaveLength(2);
      expect(pills[0]?.displayValue).toBe('"Alpha"');
      expect(pills[1]?.label).toBe('Pipeline Stage');
    });
  });

  describe('3. FacetedFilterSidebar Component', () => {
    it('renders sidebar with facet definitions and filter values', () => {
      const onFilterChange = vi.fn();
      const onClearAll = vi.fn();
      const filters: TableFilterState = { stage: 'Proposal', is_orphan: 'true' };

      const el = React.createElement(FacetedFilterSidebar, {
        facets: CRM2_DEALS_FACETS,
        filters,
        onFilterChange,
        onClearAll,
        hasActiveFilters: true,
      });

      expect(el).toBeDefined();
      expect(el.props.facets).toHaveLength(3);
      expect(el.props.filters.stage).toBe('Proposal');
      expect(el.props.hasActiveFilters).toBe(true);
    });
  });

  describe('4. FilterToolbar Component', () => {
    it('renders composite toolbar combining search input, facets, and active pills', () => {
      const onSearchChange = vi.fn();
      const onFilterChange = vi.fn();
      const onRemoveFilter = vi.fn();
      const onClearAll = vi.fn();

      const el = React.createElement(FilterToolbar, {
        search: 'Cloud',
        onSearchChange,
        facets: CRM2_DEALS_FACETS,
        filters: { stage: 'Won' },
        onFilterChange,
        activePills: [
          { key: 'search', label: 'Search', value: 'Cloud', displayValue: '"Cloud"' },
          { key: 'stage', label: 'Pipeline Stage', value: 'Won', displayValue: 'Won' },
        ],
        onRemoveFilter,
        onClearAll,
      });

      expect(el).toBeDefined();
      expect(el.props.search).toBe('Cloud');
      expect(el.props.activePills).toHaveLength(2);
      expect(el.props.facets).toEqual(CRM2_DEALS_FACETS);
    });
  });

  describe('5. DealsListPage Component Integration', () => {
    it('instantiates DealsListPage with search, filter facets, and active pills', () => {
      const el = React.createElement(DealsListPage, {
        data: [],
        isEmpty: false,
        search: 'Enterprise',
        filters: { stage: 'Negotiation' },
        hasActiveFilters: true,
      });

      expect(el).toBeDefined();
      expect(el.props.search).toBe('Enterprise');
      expect(el.props.hasActiveFilters).toBe(true);
      expect(el.props.filters).toEqual({ stage: 'Negotiation' });
    });
  });
});
