import React, { useState, useEffect, useCallback, useTransition, useMemo } from 'react';
import {
  Card,
  Input,
  Select,
  Button,
  Pagination,
} from '@clearshift/ui';
import {
  type Deal,
  type Stage,
  type Crm2StageName,
  CRM2_STAGES,
} from '@clearshift/contracts';
import { getDeals, getStages, Crm2ApiError } from '../api/crm-2.js';
import { DealsTable } from '../components/DealsTable.js';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';
import type {
  TableSortState,
  TablePaginationState,
} from '../table/types.js';

export interface DealsListPageProps {
  data?: Deal[];
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | Error | { code?: string; message?: string; details?: unknown } | null;
  onRetry?: (() => void) | undefined;
  httpStatus?: number;
  isAccessDenied?: boolean;
  requiredCapability?: string;
  requiredRole?: string;
  currentRole?: string;
  emptyActionLabel?: string;
  onEmptyAction?: (() => void) | undefined;
  simulatePermissionDenied?: boolean;
  simulateError?: boolean;
  onCreateDeal?: () => void;
  onSelectDeal?: (deal: Deal) => void;
  onViewQuotes?: (deal: Deal) => void;
  initialSort?: TableSortState;
  initialPage?: number;
  initialPageSize?: number;
  initialSearch?: string;
  sort?: TableSortState | undefined;
  onSortChange?: ((columnKey: string) => void) | undefined;
  pagination?: TablePaginationState | undefined;
  onPageChange?: ((newPage: number) => void) | undefined;
  search?: string;
  onSearchChange?: ((term: string) => void) | undefined;
  selectedStage?: Crm2StageName | '';
  onStageChange?: ((stage: Crm2StageName | '') => void) | undefined;
  onClearFilters?: (() => void) | undefined;
  hasActiveFilters?: boolean;
  stages?: Stage[];
}

/**
 * Main CRM-2 Deals & Pipeline List Page
 * Conforms to ClearShift V1 Issue #130 (CRM2-17).
 * Features server-side pagination, predictable header sorting,
 * distinct loading skeleton, empty states, and 403 Forbidden access-denied UI.
 */
export function DealsListPage({
  data: dataProp,
  isLoading: isLoadingProp,
  isEmpty: isEmptyProp,
  error: errorProp,
  onRetry: onRetryProp,
  httpStatus,
  isAccessDenied: isAccessDeniedProp,
  requiredCapability = 'module.read',
  requiredRole,
  currentRole,
  emptyActionLabel = '+ New Opportunity',
  onEmptyAction,
  simulatePermissionDenied = false,
  simulateError = false,
  onCreateDeal,
  onSelectDeal,
  onViewQuotes,
  initialSort,
  initialPage = 1,
  initialPageSize = 10,
  initialSearch = '',
  sort: sortProp,
  onSortChange: onSortChangeProp,
  pagination: paginationProp,
  onPageChange: onPageChangeProp,
  search: searchProp,
  onSearchChange: onSearchChangeProp,
  selectedStage: selectedStageProp,
  onStageChange: onStageChangeProp,
  onClearFilters: onClearFiltersProp,
  hasActiveFilters: hasActiveFiltersProp,
  stages: stagesProp,
}: DealsListPageProps) {
  // Read initial values from URL query string if present
  const urlParams = useMemo(() => {
    if (typeof window === 'undefined') return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, []);

  const initSearch = searchProp ?? initialSearch ?? (urlParams.get('search') || '');
  const initSort: TableSortState | undefined =
    sortProp ??
    initialSort ??
    (urlParams.get('sort')
      ? {
          columnKey: urlParams.get('sort')!,
          direction: (urlParams.get('order') as 'asc' | 'desc') || 'asc',
        }
      : undefined);
  const initPage = paginationProp?.page ?? initialPage ?? parseInt(urlParams.get('page') || '1', 10);
  const initPageSize = paginationProp?.pageSize ?? initialPageSize ?? parseInt(urlParams.get('pageSize') || '10', 10);
  const initStage = selectedStageProp ?? (urlParams.get('stage') as Crm2StageName) ?? '';

  // Internal Query State
  const [search, setSearch] = useState<string>(initSearch);
  const [selectedStage, setSelectedStage] = useState<Crm2StageName | ''>(initStage);
  const [currentPage, setCurrentPage] = useState<number>(initPage);
  const pageSize = paginationProp?.pageSize ?? initialPageSize ?? initPageSize;
  const [sort, setSort] = useState<TableSortState | undefined>(initSort);

  // Data State
  const [deals, setDeals] = useState<Deal[]>([]);
  const [stages, setStages] = useState<Stage[]>(stagesProp || []);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);

  // Status State
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Crm2ApiError | null>(null);
  const [, startTransition] = useTransition();

  // Synchronize URL query params
  const syncUrlParams = useCallback(
    (newSearch: string, newStage: string, newSort?: TableSortState, newPage?: number) => {
      if (typeof window === 'undefined' || !window.history?.replaceState) return;
      const params = new URLSearchParams();
      if (newSearch && newSearch.trim()) {
        params.set('search', newSearch.trim());
      }
      if (newStage && newStage.trim()) {
        params.set('stage', newStage.trim());
      }
      if (newSort) {
        params.set('sort', newSort.columnKey);
        params.set('order', newSort.direction);
      }
      if (newPage && newPage > 1) {
        params.set('page', String(newPage));
      }
      const newQuery = params.toString();
      const newUrl = newQuery ? `${window.location.pathname}?${newQuery}` : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    },
    []
  );

  // Load available stages on mount if not provided via props
  useEffect(() => {
    if (stagesProp && stagesProp.length > 0) {
      setStages(stagesProp);
      return;
    }
    let isSubscribed = true;
    getStages()
      .then((res) => {
        if (isSubscribed) {
          setStages(res.items);
        }
      })
      .catch((err) => {
        console.warn('Failed to load stages from API:', err);
      });

    return () => {
      isSubscribed = false;
    };
  }, [stagesProp]);

  // Fetch deals from server
  const loadDeals = useCallback(async () => {
    // Skip remote fetch if controlled data is provided
    if (dataProp !== undefined) return;

    setIsLoading(true);
    setError(null);

    const activeSort = sortProp ?? sort;
    const activeSearch = searchProp ?? search;
    const activeStage = selectedStageProp ?? selectedStage;
    const activePage = paginationProp?.page ?? currentPage;

    try {
      const response = await getDeals(
        {
          page: activePage,
          pageSize,
          search: activeSearch || undefined,
          stage: activeStage || undefined,
          sort: activeSort?.columnKey,
          order: activeSort?.direction,
        },
        {
          simulatePermissionDenied,
          simulateError,
        }
      );

      setDeals(response.items);
      setTotalCount(response.pagination.totalCount);
      setTotalPages(response.pagination.totalPages);
    } catch (err: unknown) {
      if (err instanceof Crm2ApiError) {
        setError(err);
      } else {
        const msg = err instanceof Error ? err.message : 'An unexpected error occurred.';
        setError(new Crm2ApiError(500, 'UNEXPECTED_ERROR', msg));
      }
    } finally {
      setIsLoading(false);
    }
  }, [
    dataProp,
    sortProp,
    sort,
    searchProp,
    search,
    selectedStageProp,
    selectedStage,
    paginationProp?.page,
    currentPage,
    pageSize,
    simulatePermissionDenied,
    simulateError,
  ]);

  useEffect(() => {
    loadDeals();
  }, [loadDeals]);

  // Sorting Handler
  const handleSortChange = (columnKey: string) => {
    if (onSortChangeProp) {
      onSortChangeProp(columnKey);
      return;
    }
    const currentSort = sortProp ?? sort;
    let nextSort: TableSortState;
    if (currentSort?.columnKey === columnKey) {
      nextSort = {
        columnKey,
        direction: currentSort.direction === 'asc' ? 'desc' : 'asc',
      };
    } else {
      nextSort = { columnKey, direction: 'asc' };
    }
    setSort(nextSort);
    setCurrentPage(1);
    syncUrlParams(search, selectedStage, nextSort, 1);
  };

  // Pagination Handler
  const handlePageChange = (newPage: number) => {
    if (onPageChangeProp) {
      onPageChangeProp(newPage);
      return;
    }
    setCurrentPage(newPage);
    syncUrlParams(search, selectedStage, sort, newPage);
  };

  // Search Handler
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (onSearchChangeProp) {
      onSearchChangeProp(val);
      return;
    }
    startTransition(() => {
      setSearch(val);
      setCurrentPage(1);
      syncUrlParams(val, selectedStage, sort, 1);
    });
  };

  // Stage Filter Handler
  const handleStageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as Crm2StageName | '';
    if (onStageChangeProp) {
      onStageChangeProp(val);
      return;
    }
    startTransition(() => {
      setSelectedStage(val);
      setCurrentPage(1);
      syncUrlParams(search, val, sort, 1);
    });
  };

  // Reset Filters Handler
  const handleClearFilters = () => {
    if (onClearFiltersProp) {
      onClearFiltersProp();
      return;
    }
    startTransition(() => {
      setSearch('');
      setSelectedStage('');
      setCurrentPage(1);
      syncUrlParams('', '', sort, 1);
    });
  };

  // Controlled vs Uncontrolled Resolution
  const isControlledLoading = isLoadingProp !== undefined;
  const isControlledError = errorProp !== undefined;
  const isControlledAccess = isAccessDeniedProp !== undefined;

  const loading = isControlledLoading ? isLoadingProp : isLoading;
  const activeError = isControlledError ? errorProp : error;
  const accessForbidden = isControlledAccess
    ? isAccessDeniedProp || httpStatus === 403
    : httpStatus === 403 || error?.isPermissionDenied || false;

  const displayData = isEmptyProp ? [] : dataProp !== undefined ? dataProp : deals;
  const total = paginationProp?.total ?? totalCount;
  const pages = paginationProp?.totalPages ?? totalPages;
  const page = paginationProp?.page ?? currentPage;
  const activeSort = sortProp ?? sort;
  const isFiltersActive =
    hasActiveFiltersProp ?? Boolean((searchProp ?? search) || (selectedStageProp ?? selectedStage));

  const stageOptions = (stages.length > 0 ? stages.map((s) => s.name) : CRM2_STAGES).map(
    (stageName) => ({
      label: stageName,
      value: stageName,
    })
  );

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 cs-deals-page">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Deals &amp; Pipeline
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            ClearShift CRM-2: Monitor pipeline opportunities, stage progressions, and sales quotes.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onRetryProp || loadDeals}
            disabled={loading}
            aria-label="Refresh deals list from server"
          >
            Refresh
          </Button>
          {(onCreateDeal || onEmptyAction) && (
            <Button
              variant="primary"
              size="sm"
              onClick={onCreateDeal || onEmptyAction}
              aria-label="Create new deal opportunity"
            >
              {emptyActionLabel}
            </Button>
          )}
        </div>
      </div>

      {accessForbidden ? (
        <AccessDeniedView
          requiredCapability={requiredCapability}
          requiredRole={requiredRole}
          currentRole={currentRole}
          resourceName="Deals & Pipeline Directory"
        />
      ) : (
        <>
          {/* Controls Bar: Search, Stage Filter, Reset */}
          <Card>
            <form
              onSubmit={(e) => e.preventDefault()}
              className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end"
              role="search"
              aria-label="Filter opportunities by keyword or stage"
            >
              <div className="sm:col-span-2">
                <Input
                  id="deals-search-input"
                  label="Search Opportunities"
                  placeholder="Search by deal name or contact..."
                  value={searchProp ?? search}
                  onChange={handleSearchChange}
                  aria-label="Search deals by name or contact"
                />
              </div>

              <div>
                <Select
                  id="deals-stage-filter"
                  label="Filter by Stage"
                  placeholder="All Stages"
                  options={stageOptions}
                  value={selectedStageProp ?? selectedStage}
                  onChange={handleStageChange}
                  aria-label="Filter deals by pipeline stage"
                />
              </div>

              <div className="flex items-center gap-2">
                {isFiltersActive && (
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={handleClearFilters}
                    className="w-full sm:w-auto"
                    aria-label="Reset search and filters"
                  >
                    Clear Filters
                  </Button>
                )}
              </div>
            </form>
          </Card>

          {/* Recoverable Error Banner */}
          {activeError && (
            <div className="mb-4" data-testid="recoverable-error-state">
              <ErrorAlert
                error={activeError}
                onRetry={onRetryProp || loadDeals}
              />
            </div>
          )}

          {/* Main View Area: Loading Skeleton, Empty States, or Data Table */}
          <Card>
            {loading ? (
              <TableSkeleton
                rowCount={5}
                columnCount={6}
                ariaLabel="Loading CRM deals from server..."
              />
            ) : displayData.length === 0 ? (
              /* Empty Results State */
              <div
                className="py-16 px-6 text-center"
                data-testid={isFiltersActive ? 'empty-filtered-state' : 'empty-results-state'}
              >
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 mb-4 text-xl">
                  {isFiltersActive ? '🔍' : '📂'}
                </div>
                <h3 className="text-base font-semibold text-slate-900">
                  {isFiltersActive ? 'No matching records found' : 'No deals found'}
                </h3>
                <p className="mt-1 text-sm text-slate-500 max-w-sm mx-auto cs-empty-text">
                  {isFiltersActive
                    ? 'No opportunities match your current filter criteria. Try clearing or modifying your filters.'
                    : 'No sales opportunities are currently recorded in the system.'}
                </p>
                {isFiltersActive ? (
                  <div className="mt-6">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleClearFilters}
                      className="cs-clear-all-filters-btn cs-empty-reset-btn"
                      data-action="clear-all-filters"
                      aria-label="Reset all search and filter criteria"
                    >
                      Reset All Filters
                    </Button>
                  </div>
                ) : (
                  (onCreateDeal || onEmptyAction) && (
                    <div className="mt-6">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={onCreateDeal || onEmptyAction}
                      >
                        {emptyActionLabel}
                      </Button>
                    </div>
                  )
                )}
              </div>
            ) : (
              /* Loaded Data Table View */
              <div>
                <DealsTable
                  deals={displayData}
                  onSelectDeal={onSelectDeal}
                  onViewQuotes={onViewQuotes}
                  sort={activeSort}
                  onSortChange={handleSortChange}
                />
                <Pagination
                  currentPage={page}
                  totalPages={pages}
                  totalCount={total}
                  pageSize={pageSize}
                  onPageChange={handlePageChange}
                />
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

export default DealsListPage;
