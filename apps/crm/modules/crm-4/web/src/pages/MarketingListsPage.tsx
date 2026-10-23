import React, { useState, useEffect, useCallback, useTransition, useMemo } from 'react';
import {
  Card,
  Input,
  Button,
  Pagination,
  Alert,
} from '@cs/ui';
import type { CRM4List } from '@clearshift/contracts';
import type { TableSortState, TableFilterState, FilterFacet, ActiveFilterPill } from '../../table/types.js';
import { CRM4_MARKETING_LISTS_FACETS } from '../../table/facets.js';
import { SearchFilterController, SEARCH_DEBOUNCE_MS } from '../../table/SearchFilterController.js';
import { ActiveFilterPills } from '../components/ActiveFilterPills.js';
import { getMarketingLists, Crm4ApiError } from '../api/crm-4.js';
import { MarketingListsTable } from '../components/MarketingListsTable.js';

export interface MarketingListsPageProps {
  simulatePermissionDenied?: boolean;
  simulateError?: boolean;
  onCreateList?: () => void;
  onSelectList?: (list: CRM4List) => void;
  onViewCampaigns?: (list: CRM4List) => void;
  initialLists?: CRM4List[] | undefined;
  initialTotalCount?: number | undefined;
  initialTotalPages?: number | undefined;
  initialSort?: TableSortState | undefined;
  initialFilters?: TableFilterState | undefined;
  facets?: FilterFacet[] | undefined;
  onSortChange?: ((sort: TableSortState) => void) | undefined;
  onFilterChange?: ((filters: TableFilterState) => void) | undefined;
  onQueryChange?: ((params: Record<string, string>) => void) | undefined;
  getMarketingListsFn?: typeof getMarketingLists | undefined;
  forceLoading?: boolean | undefined;
  forceError?: Error | Crm4ApiError | null | undefined;
  forcePermissionDenied?: boolean | undefined;
  debounceMs?: number | undefined;
}

export function MarketingListsPage({
  simulatePermissionDenied = false,
  simulateError = false,
  onCreateList,
  onSelectList,
  onViewCampaigns,
  initialLists,
  initialTotalCount,
  initialTotalPages,
  initialSort,
  initialFilters,
  facets = CRM4_MARKETING_LISTS_FACETS,
  onSortChange: onSortChangeProp,
  onFilterChange: onFilterChangeProp,
  onQueryChange: onQueryChangeProp,
  getMarketingListsFn = getMarketingLists,
  forceLoading,
  forceError,
  forcePermissionDenied,
  debounceMs = SEARCH_DEBOUNCE_MS,
}: MarketingListsPageProps) {
  // Query state
  const [search, setSearch] = useState(initialFilters?.search ?? '');
  const [filters, setFilters] = useState<TableFilterState>(() => {
    const init = { ...initialFilters };
    delete init.search;
    return init;
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [sort, setSort] = useState<TableSortState | undefined>(initialSort);
  const pageSize = 10;

  // SearchFilterController instance for bidirectional sync and pills
  const controller = useMemo(() => {
    return new SearchFilterController({
      initialSearch: search,
      initialFilters: filters,
      debounceMs,
      onSearchChange: (val) => setSearch(val),
      onFilterChange: (f) => {
        setFilters(f);
        onFilterChangeProp?.(f);
      },
      onQueryChange: (params) => onQueryChangeProp?.(params),
    });
  }, [debounceMs]);

  // Data state
  const [lists, setLists] = useState<CRM4List[]>(initialLists ?? []);
  const [totalCount, setTotalCount] = useState(initialTotalCount ?? (initialLists ? initialLists.length : 0));
  const [totalPages, setTotalPages] = useState(initialTotalPages ?? (initialLists ? (initialLists.length > 0 ? 1 : 0) : 1));

  // Status state
  const [isLoading, setIsLoading] = useState(
    forceLoading !== undefined ? forceLoading : initialLists === undefined
  );
  const [error, setError] = useState<Crm4ApiError | null>(() => {
    if (forceError) {
      return forceError instanceof Crm4ApiError
        ? forceError
        : new Crm4ApiError(500, 'UNEXPECTED_ERROR', forceError.message);
    }
    if (forcePermissionDenied || simulatePermissionDenied) {
      return new Crm4ApiError(403, 'FORBIDDEN', 'Access denied. Required capability: module.read');
    }
    return null;
  });
  const [, startTransition] = useTransition();

  // Active filter pills calculation
  const activePills: ActiveFilterPill[] = useMemo(() => {
    return controller.getActiveFilterPills(facets);
  }, [controller, search, filters, facets]);

  const hasActiveFilters = search.trim().length > 0 || Object.values(filters).some((v) => !!v && v.trim().length > 0);

  // Filter in-memory lists when initialLists fixture is provided
  const filteredInitialLists = useMemo(() => {
    if (!initialLists) return null;
    let res = [...initialLists];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      res = res.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          (item.description && item.description.toLowerCase().includes(q))
      );
    }

    if (filters['memberRange']) {
      const mr = filters['memberRange'];
      if (mr === 'empty') res = res.filter((item) => item.memberCount === 0);
      else if (mr === 'small') res = res.filter((item) => item.memberCount >= 1 && item.memberCount <= 50);
      else if (mr === 'medium') res = res.filter((item) => item.memberCount >= 51 && item.memberCount <= 250);
      else if (mr === 'large') res = res.filter((item) => item.memberCount > 250);
    }

    if (filters['campaignActivity']) {
      const ca = filters['campaignActivity'];
      if (ca === 'active') res = res.filter((item) => item.campaignCount > 0);
      else if (ca === 'none') res = res.filter((item) => item.campaignCount === 0);
    }

    return res;
  }, [initialLists, search, filters]);

  // Fetch marketing lists from server
  const loadLists = useCallback(async () => {
    if (initialLists !== undefined) {
      if (filteredInitialLists) {
        setLists(filteredInitialLists);
        setTotalCount(filteredInitialLists.length);
        setTotalPages(filteredInitialLists.length > 0 ? Math.ceil(filteredInitialLists.length / pageSize) : 0);
      }
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await getMarketingListsFn(
        {
          page: currentPage,
          pageSize,
          search: search || undefined,
        },
        {
          simulatePermissionDenied,
          simulateError,
        }
      );

      setLists(response.items);
      setTotalCount(response.pagination.totalCount);
      setTotalPages(response.pagination.totalPages);
    } catch (err: any) {
      if (err instanceof Crm4ApiError) {
        setError(err);
      } else {
        setError(
          new Crm4ApiError(
            500,
            'UNEXPECTED_ERROR',
            err.message || 'An unexpected error occurred while loading marketing lists.'
          )
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, pageSize, search, simulatePermissionDenied, simulateError, initialLists, filteredInitialLists, getMarketingListsFn]);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  // Search input handler
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    startTransition(() => {
      setSearch(val);
      controller.setSearch(val, true);
      setCurrentPage(1); // Requirement: search/filter changes reset pagination to first page
    });
  };

  const handleClearSearch = () => {
    startTransition(() => {
      setSearch('');
      controller.clearSearch();
      setCurrentPage(1);
    });
  };

  const handleFilterChange = (key: string, value: string) => {
    startTransition(() => {
      const nextFilters = { ...filters };
      if (!value || value.trim() === '') {
        delete nextFilters[key];
      } else {
        nextFilters[key] = value.trim();
      }
      setFilters(nextFilters);
      controller.setFilter(key, value);
      setCurrentPage(1);
      onFilterChangeProp?.(nextFilters);
    });
  };

  const handleRemoveFilter = (key: string) => {
    if (key === 'search') {
      handleClearSearch();
      return;
    }
    handleFilterChange(key, '');
  };

  const handleClearAll = () => {
    startTransition(() => {
      setSearch('');
      setFilters({});
      controller.clearAll();
      setCurrentPage(1);
      onFilterChangeProp?.({});
    });
  };

  const handleSortChange = (columnKey: string) => {
    let nextSort: TableSortState;
    if (sort?.columnKey === columnKey) {
      nextSort = {
        columnKey,
        direction: sort.direction === 'asc' ? 'desc' : 'asc',
      };
    } else {
      nextSort = { columnKey, direction: 'asc' };
    }
    setSort(nextSort);
    setCurrentPage(1);
    onSortChangeProp?.(nextSort);
  };

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Marketing Lists &amp; Segmentation
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            ClearShift CRM-4: Manage audience segments, campaign recipient history, and contact consent state.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={loadLists}
            disabled={isLoading}
            aria-label="Refresh marketing lists from server"
          >
            Refresh
          </Button>
          {onCreateList && (
            <Button
              variant="primary"
              size="sm"
              onClick={onCreateList}
              aria-label="Create new marketing list"
            >
              + New List
            </Button>
          )}
        </div>
      </div>

      {/* Search and Filters Bar */}
      <Card className="p-4 bg-slate-50/50">
        <form
          role="search"
          aria-label="Filter Marketing Lists"
          onSubmit={(e) => e.preventDefault()}
          className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end"
        >
          <div className="sm:col-span-2">
            <Input
              id="marketing-lists-search"
              label="Search Marketing Lists"
              placeholder="Search by list name or audience..."
              value={search}
              onChange={handleSearchChange}
              aria-label="Search marketing lists by name"
            />
          </div>

          <div className="flex items-center gap-2">
            {search && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearSearch}
                aria-label="Clear active search filter"
                className="text-slate-600"
              >
                Clear Search
              </Button>
            )}
            <span className="text-xs text-slate-400 font-mono ml-auto" aria-live="polite">
              {totalCount} {totalCount === 1 ? 'list' : 'lists'} found
            </span>
          </div>

          {/* Faceted Filters Group */}
          {facets.length > 0 && (
            <div className="sm:col-span-3 flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200/60">
              {facets.map((facet) => {
                const currentVal = filters[facet.paramKey] ?? '';
                return (
                  <div key={facet.id} className="cs-filter-facet">
                    <label htmlFor={`filter-${facet.id}`} className="cs-facet-label">
                      {facet.label}:
                    </label>
                    <select
                      id={`filter-${facet.id}`}
                      className="cs-facet-select text-xs"
                      value={currentVal}
                      onChange={(e) => handleFilterChange(facet.paramKey, e.target.value)}
                      data-facet={facet.paramKey}
                      aria-label={`Filter by ${facet.label}`}
                    >
                      {facet.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}

          {/* Active Filter Pill Tags */}
          {activePills.length > 0 && (
            <div className="sm:col-span-3">
              <ActiveFilterPills
                pills={activePills}
                onRemoveFilter={handleRemoveFilter}
                onClearAll={handleClearAll}
              />
            </div>
          )}
        </form>
      </Card>

      {/* Permission-Denied State (403) */}
      {error && error.isPermissionDenied && (
        <Alert
          variant="error"
          title="Access Restricted"
          className="border-red-200 bg-red-50"
        >
          <div className="flex flex-col gap-2">
            <p className="text-sm text-red-700">
              You do not have the required role or capability (<code>module.read</code>) to view Marketing Lists.
            </p>
            <p className="text-xs text-red-500">
              Please contact your ClearShift Hub administrator to request marketing view permissions.
            </p>
          </div>
        </Alert>
      )}

      {/* Recoverable Error State */}
      {error && !error.isPermissionDenied && (
        <Alert
          variant="error"
          title="Failed to Load Marketing Lists"
          className="border-red-200 bg-red-50"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-red-700">{error.message}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={loadLists}
              className="text-xs shrink-0 bg-white"
              aria-label="Retry loading marketing lists from server"
            >
              Retry
            </Button>
          </div>
        </Alert>
      )}

      {/* Data Table */}
      {!error && (
        <Card className="overflow-hidden border border-slate-200 shadow-sm">
          <MarketingListsTable
            lists={filteredInitialLists ?? lists}
            loading={isLoading}
            emptyTitle={hasActiveFilters ? 'No matching marketing lists' : 'No marketing lists recorded'}
            emptyDescription={
              search
                ? `No marketing lists match the query "${search}". Try adjusting your search term.`
                : hasActiveFilters
                ? 'No marketing lists match the active filter criteria. Try resetting your filters.'
                : 'No marketing lists are currently registered in CRM-4.'
            }
            emptyActionLabel={onCreateList ? '+ New List' : undefined}
            onEmptyAction={onCreateList}
            onSelectList={onSelectList}
            onViewCampaigns={onViewCampaigns}
            sort={sort}
            onSortChange={handleSortChange}
          />

          {/* Bounded Server Pagination */}
          {!isLoading && totalPages > 1 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalCount={totalCount}
              pageSize={pageSize}
              onPageChange={(page) => setCurrentPage(page)}
            />
          )}
        </Card>
      )}
    </div>
  );
}

export default MarketingListsPage;
