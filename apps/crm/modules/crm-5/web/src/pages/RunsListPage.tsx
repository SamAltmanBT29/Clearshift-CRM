import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  MigrationRun,
  PaginatedRunsResponse,
  CrmModule,
  MigrationRunStatus,
} from '@clearshift/contracts';
import { Pagination } from '@cs/ui';
import { getRuns, Crm5ApiError, type RequestOptions } from '../api/crm-5.js';
import { RunsTable } from '../components/RunsTable.js';
import { TableSkeleton } from '../../components/TableSkeleton.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ErrorAlert } from '../../components/ErrorAlert.js';
import { AccessDeniedView } from '../../components/AccessDeniedView.js';
import type { TableSortState } from '../../table/types.js';

export interface RunsListPageProps {
  initialRuns?: PaginatedRunsResponse | undefined;
  getRunsFn?: typeof getRuns | undefined;
  options?: RequestOptions | undefined;
  defaultPageSize?: number | undefined;
  initialBatchId?: string | undefined;
  initialModule?: CrmModule | '' | undefined;
  initialStatus?: MigrationRunStatus | '' | undefined;
  onRunSelect?: ((run: MigrationRun) => void) | undefined;
  className?: string | undefined;
  forceLoading?: boolean | undefined;
  forceError?: Error | Crm5ApiError | null | undefined;
  forcePermissionDenied?: boolean | undefined;
}

const MODULE_OPTIONS: { value: CrmModule | ''; label: string }[] = [
  { value: '', label: 'All Modules' },
  { value: 'crm-1', label: 'CRM-1 (Contacts & Accounts)' },
  { value: 'crm-2', label: 'CRM-2 (Deals & Pipelines)' },
  { value: 'crm-3', label: 'CRM-3 (Activities & Tasks)' },
  { value: 'crm-4', label: 'CRM-4 (Analytics & Insights)' },
  { value: 'crm-5', label: 'CRM-5 (Migration Control)' },
];

const STATUS_OPTIONS: { value: MigrationRunStatus | ''; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'halted', label: 'Halted' },
];

/**
 * Migration Runs List Page Component (Issue #49 / CRM5-04).
 * Primary V1 Migration Control Center run list screen connecting to /api/v1/crm-control/runs.
 * Enforces server-side pagination, debounced/on-change query parameter mutations that reset
 * pagination to page 1, and distinct Loading, Empty, Recoverable Error, and 403 Forbidden states.
 */
export const RunsListPage: React.FC<RunsListPageProps> = ({
  initialRuns,
  getRunsFn = getRuns,
  options = {},
  defaultPageSize = 20,
  initialBatchId = '',
  initialModule = '',
  initialStatus = '',
  onRunSelect,
  className = '',
  forceLoading,
  forceError,
  forcePermissionDenied,
}) => {
  // Query parameters state
  const [search, setSearch] = useState<string>(initialBatchId);
  const [selectedModule, setSelectedModule] = useState<CrmModule | ''>(initialModule);
  const [selectedStatus, setSelectedStatus] = useState<MigrationRunStatus | ''>(initialStatus);
  const [page, setPage] = useState<number>(initialRuns?.page ?? 1);
  const [pageSize, setPageSize] = useState<number>(initialRuns?.pageSize ?? defaultPageSize);
  const [sort, setSort] = useState<TableSortState | undefined>(undefined);

  // Data & execution states
  const [runs, setRuns] = useState<MigrationRun[]>(initialRuns?.items ?? []);
  const [total, setTotal] = useState<number>(initialRuns?.total ?? 0);
  const [totalPages, setTotalPages] = useState<number>(initialRuns?.totalPages ?? 0);
  const [isLoading, setIsLoading] = useState<boolean>(
    forceLoading !== undefined
      ? forceLoading
      : !initialRuns && !options.simulateError && !options.simulatePermissionDenied
  );
  const [error, setError] = useState<Error | Crm5ApiError | null>(
    forceError !== undefined ? forceError : null
  );
  const [isPermissionDenied, setIsPermissionDenied] = useState<boolean>(
    forcePermissionDenied !== undefined
      ? forcePermissionDenied
      : Boolean(options.simulatePermissionDenied)
  );

  const hasActiveFilters = useMemo(
    () => Boolean(search.trim() || selectedModule || selectedStatus),
    [search, selectedModule, selectedStatus]
  );

  // Fetch logic connecting to real or mock getRuns API
  const fetchRunsData = useCallback(
    async (
      targetPage: number,
      targetSearch: string,
      targetModule: CrmModule | '',
      targetStatus: MigrationRunStatus | ''
    ) => {
      setIsLoading(true);
      setError(null);
      setIsPermissionDenied(false);

      try {
        const queryParams = {
          page: targetPage,
          pageSize,
          batchId: targetSearch.trim() || undefined,
          module: targetModule || undefined,
          status: targetStatus || undefined,
        };

        const res = await getRunsFn(queryParams, options);
        setRuns(res.items);
        setTotal(res.total);
        setPage(res.page);
        setPageSize(res.pageSize);
        setTotalPages(res.totalPages);
      } catch (err: unknown) {
        if (
          err instanceof Crm5ApiError &&
          (err.isPermissionDenied || err.statusCode === 403)
        ) {
          setIsPermissionDenied(true);
        } else if (
          typeof err === 'object' &&
          err !== null &&
          'statusCode' in err &&
          (err as { statusCode: number }).statusCode === 403
        ) {
          setIsPermissionDenied(true);
        }
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setIsLoading(false);
      }
    },
    [getRunsFn, options, pageSize]
  );

  // Initial fetch on mount if initial data was not provided
  useEffect(() => {
    if (!initialRuns) {
      void fetchRunsData(page, search, selectedModule, selectedStatus);
    }
  }, []); // Run once on mount

  // Handlers for search/filters — Non-negotiable requirement: Resets page to 1
  const handleSearchSubmit = useCallback(
    (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      setPage(1);
      void fetchRunsData(1, search, selectedModule, selectedStatus);
    },
    [fetchRunsData, search, selectedModule, selectedStatus]
  );

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  }, []);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        setPage(1);
        void fetchRunsData(1, search, selectedModule, selectedStatus);
      }
    },
    [fetchRunsData, search, selectedModule, selectedStatus]
  );

  const handleModuleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value as CrmModule | '';
      setSelectedModule(val);
      setPage(1);
      void fetchRunsData(1, search, val, selectedStatus);
    },
    [fetchRunsData, search, selectedStatus]
  );

  const handleStatusChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value as MigrationRunStatus | '';
      setSelectedStatus(val);
      setPage(1);
      void fetchRunsData(1, search, selectedModule, val);
    },
    [fetchRunsData, search, selectedModule]
  );

  const handleClearFilters = useCallback(() => {
    setSearch('');
    setSelectedModule('');
    setSelectedStatus('');
    setPage(1);
    void fetchRunsData(1, '', '', '');
  }, [fetchRunsData]);

  const handlePageChange = useCallback(
    (newPage: number) => {
      setPage(newPage);
      void fetchRunsData(newPage, search, selectedModule, selectedStatus);
    },
    [fetchRunsData, search, selectedModule, selectedStatus]
  );

  const handleRetry = useCallback(() => {
    void fetchRunsData(page, search, selectedModule, selectedStatus);
  }, [fetchRunsData, page, search, selectedModule, selectedStatus]);

  const handleSortChange = useCallback((columnKey: string) => {
    setSort((prev) => {
      if (prev?.columnKey === columnKey) {
        return {
          columnKey,
          direction: prev.direction === 'asc' ? 'desc' : 'asc',
        };
      }
      return { columnKey, direction: 'asc' };
    });
  }, []);

  // Sorted runs (client-side sort within the current server page)
  const displayRuns = useMemo(() => {
    if (!sort) return runs;
    return [...runs].sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sort.columnKey];
      const bVal = (b as unknown as Record<string, unknown>)[sort.columnKey];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sort.direction === 'asc' ? -1 : 1;
      if (bVal == null) return sort.direction === 'asc' ? 1 : -1;
      if (aVal < bVal) return sort.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sort.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [runs, sort]);

  return (
    <main
      className={`cs-runs-list-page p-6 max-w-7xl mx-auto space-y-6 ${className}`.trim()}
      role="main"
      aria-label="Migration Runs List Page"
    >
      {/* 1. Header Section */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Migration Control Center — Runs
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time telemetry and projection snapshots of migration batches across all CRM modules.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200"
            aria-live="polite"
          >
            Total Runs: <strong className="ml-1 font-semibold">{total}</strong>
          </span>
        </div>
      </header>

      {/* 2. Search & Filter Controls Toolbar */}
      <section
        className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4"
        aria-label="Search and Filter Controls"
      >
        <form
          onSubmit={handleSearchSubmit}
          className="flex flex-col md:flex-row items-stretch md:items-center gap-3"
        >
          {/* Search by Batch ID */}
          <div className="flex-1 relative">
            <label htmlFor="crm5-runs-search-input" className="sr-only">
              Search by Batch ID
            </label>
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <span aria-hidden="true">🔍</span>
            </div>
            <input
              id="crm5-runs-search-input"
              type="search"
              className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 placeholder-slate-400"
              placeholder="Search by batch ID (e.g. batch-001)..."
              value={search}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
            />
            {search && (
              <button
                type="button"
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none"
                onClick={() => {
                  setSearch('');
                  setPage(1);
                  void fetchRunsData(1, '', selectedModule, selectedStatus);
                }}
                aria-label="Clear batch ID search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Module Filter */}
          <div className="w-full md:w-52">
            <label htmlFor="crm5-runs-module-select" className="sr-only">
              Filter by Module
            </label>
            <select
              id="crm5-runs-module-select"
              className="w-full py-2 px-3 text-sm rounded-lg border border-slate-300 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              value={selectedModule}
              onChange={handleModuleChange}
              aria-label="Filter runs by module"
            >
              {MODULE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="w-full md:w-44">
            <label htmlFor="crm5-runs-status-select" className="sr-only">
              Filter by Status
            </label>
            <select
              id="crm5-runs-status-select"
              className="w-full py-2 px-3 text-sm rounded-lg border border-slate-300 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              value={selectedStatus}
              onChange={handleStatusChange}
              aria-label="Filter runs by status"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Submit Search button for explicit keyboard operation */}
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors shadow-sm"
          >
            Search
          </button>

          {/* Clear Filters button */}
          {hasActiveFilters && (
            <button
              type="button"
              className="px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400 transition-colors"
              onClick={handleClearFilters}
              aria-label="Reset all search and filter values"
            >
              Reset
            </button>
          )}
        </form>

        {/* Active Filter Badges */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
            <span className="text-slate-500 font-medium">Active Filters:</span>
            {search && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-800 border border-slate-200">
                Batch: <strong className="font-semibold">{search}</strong>
                <button
                  type="button"
                  className="hover:text-rose-600 ml-1"
                  onClick={() => {
                    setSearch('');
                    setPage(1);
                    void fetchRunsData(1, '', selectedModule, selectedStatus);
                  }}
                  aria-label="Remove batch ID filter"
                >
                  ✕
                </button>
              </span>
            )}
            {selectedModule && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-800 border border-slate-200">
                Module: <strong className="font-semibold">{selectedModule}</strong>
                <button
                  type="button"
                  className="hover:text-rose-600 ml-1"
                  onClick={() => {
                    setSelectedModule('');
                    setPage(1);
                    void fetchRunsData(1, search, '', selectedStatus);
                  }}
                  aria-label="Remove module filter"
                >
                  ✕
                </button>
              </span>
            )}
            {selectedStatus && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-800 border border-slate-200">
                Status: <strong className="font-semibold">{selectedStatus}</strong>
                <button
                  type="button"
                  className="hover:text-rose-600 ml-1"
                  onClick={() => {
                    setSelectedStatus('');
                    setPage(1);
                    void fetchRunsData(1, search, selectedModule, '');
                  }}
                  aria-label="Remove status filter"
                >
                  ✕
                </button>
              </span>
            )}
          </div>
        )}
      </section>

      {/* 3. Primary Data Display & State Machine */}
      <section aria-label="Migration Runs Content" aria-live="polite">
        {/* State A: 403 Forbidden Access-Denied */}
        {isPermissionDenied && (
          <AccessDeniedView
            requiredCapability="control:read"
            resourceName="Migration Control Center"
            onBack={handleRetry}
          />
        )}

        {/* State B: Recoverable API Error State */}
        {!isPermissionDenied && error && (
          <ErrorAlert
            error={error}
            title="Unable to load migration run projections"
            onRetry={handleRetry}
            retryLabel="Retry Connection"
          />
        )}

        {/* State C: Distinct Loading Skeleton */}
        {!isPermissionDenied && !error && isLoading && (
          <TableSkeleton
            rowCount={5}
            columnCount={9}
            ariaLabel="Fetching migration run projections..."
          />
        )}

        {/* State D: Distinct Empty State */}
        {!isPermissionDenied && !error && !isLoading && displayRuns.length === 0 && (
          <EmptyState
            title={hasActiveFilters ? 'No matching migration runs' : 'No migration runs recorded'}
            description={
              hasActiveFilters
                ? 'No migration runs match your current search and filter criteria. Try clearing or relaxing the filters.'
                : 'There are currently no migration runs registered in the system. Runs will appear once migration batches begin processing.'
            }
            actionLabel={hasActiveFilters ? 'Clear All Filters' : undefined}
            onAction={hasActiveFilters ? handleClearFilters : undefined}
            className={hasActiveFilters ? 'cs-empty-filter-state' : ''}
          />
        )}

        {/* State E: Populated Runs Table & Server-side Pagination */}
        {!isPermissionDenied && !error && !isLoading && displayRuns.length > 0 && (
          <div className="space-y-4">
            <RunsTable
              runs={displayRuns}
              sort={sort}
              onSortChange={handleSortChange}
              onRowClick={onRunSelect}
            />

            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalCount={total}
              pageSize={pageSize}
              onPageChange={handlePageChange}
            />
          </div>
        )}
      </section>
    </main>
  );
};
