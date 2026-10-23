import React, { useState, useEffect, useCallback, useTransition, useMemo } from 'react';
import {
  Card,
  Button,
  Pagination,
} from '@clearshift/ui';
import {
  type Deal,
  type Stage,
  type CreateDealInput,
  CRM2_STAGES,
} from '@clearshift/contracts';
import { getDeals, getStages, createDeal, Crm2ApiError } from '../api/crm-2.js';
import { DealsTable } from '../components/DealsTable.js';
import { FilterToolbar } from '../components/FilterToolbar.js';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';
import { CreateDealModal } from '../components/CreateDealModal.js';
import { ConfirmationToast } from '../components/ConfirmationToast.js';
import { type CreateDealFormData } from '../components/CreateDealForm.js';
import { CRM2_DEALS_FACETS } from '../table/facets.js';
import { SearchFilterController } from '../table/SearchFilterController.js';
import { DataTableController } from '../table/DataTableController.js';
import { DEALS_COLUMNS } from '../table/columns.js';
import type {
  TableSortState,
  TablePaginationState,
  TableFilterState,
  ActiveFilterPill,
  FilterFacet,
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
  initialFilters?: TableFilterState;
  sort?: TableSortState | undefined;
  onSortChange?: ((columnKey: string) => void) | undefined;
  pagination?: TablePaginationState | undefined;
  onPageChange?: ((newPage: number) => void) | undefined;
  search?: string;
  onSearchChange?: ((term: string) => void) | undefined;
  filters?: TableFilterState;
  onFilterChange?: ((key: string, value: string) => void) | undefined;
  onRemoveFilter?: ((key: string) => void) | undefined;
  onClearAllFilters?: (() => void) | undefined;
  activePills?: ActiveFilterPill[];
  facets?: FilterFacet[];
  hasActiveFilters?: boolean;
}

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
  emptyActionLabel = '+ New Deal',
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
  initialFilters = {},
  sort: sortProp,
  onSortChange: onSortChangeProp,
  pagination: paginationProp,
  onPageChange: onPageChangeProp,
  search: searchProp,
  onSearchChange: onSearchChangeProp,
  filters: filtersProp,
  onFilterChange: onFilterChangeProp,
  onRemoveFilter: onRemoveFilterProp,
  onClearAllFilters: onClearAllFiltersProp,
  activePills: activePillsProp,
  facets: facetsProp = CRM2_DEALS_FACETS,
  hasActiveFilters: hasActiveFiltersProp,
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

  const initFilters: TableFilterState = useMemo(() => {
    if (filtersProp) return filtersProp;
    const f: TableFilterState = { ...initialFilters };
    if (urlParams.get('stage')) f.stage = urlParams.get('stage')!;
    if (urlParams.get('is_orphan')) f.is_orphan = urlParams.get('is_orphan')!;
    if (urlParams.get('source_system')) f.source_system = urlParams.get('source_system')!;
    return f;
  }, [filtersProp, initialFilters, urlParams]);

  // Query state (internal)
  const [search, setSearch] = useState<string>(initSearch);
  const [filters, setFilters] = useState<TableFilterState>(initFilters);
  const [currentPage, setCurrentPage] = useState<number>(initPage);
  const [pageSize, setPageSize] = useState<number>(initPageSize);
  const [sort, setSort] = useState<TableSortState | undefined>(initSort);

  // Data state
  const [deals, setDeals] = useState<Deal[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);

  // Modal & Toast states (CRM2-20)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [toast, setToast] = useState<{
    show: boolean;
    message: string;
    type?: 'success' | 'info' | 'warning' | 'error';
  }>({ show: false, message: '' });

  // Status state
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Crm2ApiError | null>(null);
  const [, startTransition] = useTransition();

  // DataTableController instance for managing bounded table cache (CRM2-20)
  const tableController = useMemo(() => {
    return new DataTableController<Deal>({
      columns: DEALS_COLUMNS as any,
      initialPage: currentPage,
      initialPageSize: pageSize,
      initialSort: sort,
      initialFilters: filters,
    });
  }, []);

  // Update controller cache whenever deals collection changes
  useEffect(() => {
    tableController.setCachedData(deals);
  }, [deals, tableController]);

  const handleCreateSubmit = async (values: CreateDealFormData) => {
    const payload: CreateDealInput = {
      name: values.name,
      contact_id: values.contactId || null,
      contact_email: values.contactEmail || null,
      contact_phone: values.contactPhone || null,
      probability: values.probability !== undefined ? values.probability : null,
      value: values.value,
      currency: values.currency,
      stage_name: values.stageName,
      close_date: values.closeDate,
      source_system: values.sourceSystem || null,
      source_id: values.sourceId || null,
    };
    return await createDeal(payload);
  };

  const handleCreateSuccess = (result: unknown) => {
    const createdDeal = result as Deal;
    tableController.addRecordToCache(createdDeal);
    setDeals((prev) => [createdDeal, ...prev]);
    setTotalCount((prev) => prev + 1);
    setToast({
      show: true,
      message: `Deal "${createdDeal.name}" was successfully created.`,
      type: 'success',
    });
  };

  // SearchFilterController instance for pill computation & state management
  const sfController = useMemo(() => {
    return new SearchFilterController({
      initialSearch: search,
      initialFilters: filters,
    });
  }, [search, filters]);

  // Synchronize URL query params
  const syncUrlParams = useCallback(
    (newSearch: string, newFilters: TableFilterState, newSort?: TableSortState, newPage?: number) => {
      if (typeof window === 'undefined' || !window.history?.replaceState) return;
      const params = new URLSearchParams();
      if (newSearch && newSearch.trim()) {
        params.set('search', newSearch.trim());
      }
      for (const [key, val] of Object.entries(newFilters)) {
        if (val && val.trim()) {
          params.set(key, val.trim());
        }
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

  // Load available stages on mount
  useEffect(() => {
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
  }, []);

  // Fetch deals from server
  const loadDeals = useCallback(async () => {
    // If external data is supplied, do not fetch
    if (dataProp !== undefined || isEmptyProp) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await getDeals(
        {
          page: currentPage,
          pageSize,
          search: search || undefined,
          stage: (filters.stage as any) || undefined,
          sort: sort?.columnKey,
          order: sort?.direction,
          is_orphan: filters.is_orphan !== undefined ? (filters.is_orphan === 'true' as any) : undefined,
          source_system: filters.source_system || undefined,
        } as any,
        {
          simulatePermissionDenied,
          simulateError,
        }
      );

      setDeals(response.items);
      setTotalCount(response.pagination.totalCount);
      setTotalPages(response.pagination.totalPages);
    } catch (err: any) {
      if (err instanceof Crm2ApiError) {
        setError(err);
      } else {
        setError(new Crm2ApiError(500, 'UNEXPECTED_ERROR', err.message || 'An unexpected error occurred.'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [
    dataProp,
    currentPage,
    pageSize,
    search,
    filters,
    sort,
    simulatePermissionDenied,
    simulateError,
  ]);

  useEffect(() => {
    loadDeals();
  }, [loadDeals]);

  // Handlers for sorting
  const handleSortChange = (columnKey: string) => {
    if (onSortChangeProp) {
      onSortChangeProp(columnKey);
      return;
    }

    startTransition(() => {
      const nextSort: TableSortState =
        sort?.columnKey === columnKey
          ? { columnKey, direction: sort.direction === 'asc' ? 'desc' : 'asc' }
          : { columnKey, direction: 'asc' };
      setSort(nextSort);
      setCurrentPage(1);
      syncUrlParams(search, filters, nextSort, 1);
    });
  };

  // Handlers for search debouncing (300ms)
  const handleSearchChange = (term: string) => {
    if (onSearchChangeProp) {
      onSearchChangeProp(term);
    }
    startTransition(() => {
      setSearch(term);
      setCurrentPage(1);
      syncUrlParams(term, filters, sort, 1);
    });
  };

  // Handlers for faceted filter modification
  const handleFilterChange = (key: string, value: string) => {
    if (onFilterChangeProp) {
      onFilterChangeProp(key, value);
    }
    startTransition(() => {
      const next = { ...filters };
      if (!value || value.trim() === '') {
        delete next[key];
      } else {
        next[key] = value.trim();
      }
      setFilters(next);
      setCurrentPage(1);
      syncUrlParams(search, next, sort, 1);
    });
  };

  // Handlers for active filter tag removal
  const handleRemoveFilter = (key: string) => {
    if (onRemoveFilterProp) {
      onRemoveFilterProp(key);
    }
    startTransition(() => {
      if (key === 'search') {
        setSearch('');
        setCurrentPage(1);
        syncUrlParams('', filters, sort, 1);
      } else {
        const next = { ...filters };
        delete next[key];
        setFilters(next);
        setCurrentPage(1);
        syncUrlParams(search, next, sort, 1);
      }
    });
  };

  // Handler for Clear All action
  const handleClearAllFilters = () => {
    if (onClearAllFiltersProp) {
      onClearAllFiltersProp();
    }
    startTransition(() => {
      setSearch('');
      setFilters({});
      setCurrentPage(1);
      syncUrlParams('', {}, sort, 1);
    });
  };

  // Compute active pills
  const activePills =
    activePillsProp ?? sfController.getActiveFilterPills(facetsProp);

  const isFiltersActive =
    hasActiveFiltersProp !== undefined
      ? hasActiveFiltersProp
      : Boolean(search.trim().length > 0) ||
        Object.values(filters).some((v) => v !== undefined && v.trim().length > 0) ||
        activePills.length > 0;

  const displayData = isEmptyProp ? [] : dataProp ?? deals;
  const loading = isLoadingProp !== undefined ? isLoadingProp : (dataProp !== undefined || isEmptyProp ? false : isLoading);
  const accessForbidden = isAccessDeniedProp || httpStatus === 403 || error?.isPermissionDenied || simulatePermissionDenied;
  const activeError = errorProp !== undefined ? errorProp : (simulateError ? 'An unexpected system error occurred' : error);

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 cs-page-container">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5 cs-page-header">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Deals &amp; Pipeline
          </h1>
          <p className="mt-1 text-sm text-slate-500 cs-page-desc">
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
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (onCreateDeal) {
                onCreateDeal();
              } else {
                setIsCreateModalOpen(true);
              }
            }}
            className="cs-create-deal-btn"
            aria-label="Create new deal opportunity"
          >
            {emptyActionLabel || '+ Create Deal'}
          </Button>
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
          {/* Composite Filter Toolbar: Debounced Search, Facet Selectors, Active Filter Pills */}
          <FilterToolbar
            search={search}
            onSearchChange={handleSearchChange}
            facets={facetsProp}
            filters={filters}
            onFilterChange={handleFilterChange}
            activePills={activePills}
            onRemoveFilter={handleRemoveFilter}
            onClearAll={handleClearAllFilters}
            searchPlaceholder="Search deals by name or contact..."
          />

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
                className={`py-16 px-6 text-center ${
                  isFiltersActive ? 'cs-empty-filter-state' : 'cs-empty-state'
                }`}
                data-testid="empty-results-state"
              >
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 mb-4 text-xl cs-empty-icon">
                  {isFiltersActive ? '🔍' : '📂'}
                </div>
                <h3 className="text-base font-semibold text-slate-900 cs-empty-title">
                  {isFiltersActive ? 'No matching deals found' : 'No deals found'}
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
                      onClick={handleClearAllFilters}
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
                  sort={sortProp ?? sort}
                  onSortChange={handleSortChange}
                />
                <Pagination
                  currentPage={paginationProp?.page ?? currentPage}
                  totalPages={paginationProp?.totalPages ?? totalPages}
                  totalCount={paginationProp?.total ?? totalCount}
                  pageSize={paginationProp?.pageSize ?? pageSize}
                  onPageChange={(page) => {
                    if (onPageChangeProp) {
                      onPageChangeProp(page);
                    } else {
                      setCurrentPage(page);
                      syncUrlParams(search, filters, sort, page);
                    }
                  }}
                />
              </div>
            )}
          </Card>
        </>
      )}

      {/* Entity Creation Modal with React Hook Form & Zod Validation (CRM2-20) */}
      <CreateDealModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreateSubmit}
        onSuccess={handleCreateSuccess}
        stages={stages}
      />

      {/* Confirmation Toast Notification (CRM2-20) */}
      <ConfirmationToast
        show={toast.show}
        message={toast.message}
        type={toast.type}
        onDismiss={() => setToast({ show: false, message: '' })}
      />
    </div>
  );
}

export default DealsListPage;

