import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@clearshift/ui';
import type { CRM1CompanyRead } from '@clearshift/contracts';
import { getCompanies, Crm1ApiError } from '../api/crm-1.js';
import { CompaniesTable } from '../components/CompaniesTable.js';
import { FilterToolbar } from '../../components/FilterToolbar.js';
import { TableSkeleton } from '../../components/TableSkeleton.js';
import { ErrorAlert } from '../../components/ErrorAlert.js';
import { AccessDeniedView } from '../../components/AccessDeniedView.js';
import { EmptyState } from '../../components/EmptyState.js';
import { CRM1_COMPANIES_FACETS } from '../../table/facets.js';
import type {
  TablePaginationState,
  TableFilterState,
  ActiveFilterPill,
  FilterFacet,
} from '../../table/types.js';

export interface CompaniesListPageProps {
  data?: CRM1CompanyRead[] | undefined;
  isLoading?: boolean | undefined;
  isEmpty?: boolean | undefined;
  error?: string | Error | { code?: string; message?: string; details?: unknown } | null | undefined;
  onRetry?: (() => void) | undefined;
  httpStatus?: number | undefined;
  isAccessDenied?: boolean | undefined;
  requiredCapability?: string | undefined;
  requiredRole?: string | undefined;
  currentRole?: string | undefined;
  emptyActionLabel?: string | undefined;
  onEmptyAction?: (() => void) | undefined;
  pagination?: TablePaginationState | undefined;
  onPageChange?: ((newPage: number) => void) | undefined;
  search?: string | undefined;
  onSearchChange?: ((term: string) => void) | undefined;
  filters?: TableFilterState | undefined;
  onFilterChange?: ((key: string, value: string) => void) | undefined;
  onRemoveFilter?: ((key: string) => void) | undefined;
  onClearAllFilters?: (() => void) | undefined;
  activePills?: ActiveFilterPill[] | undefined;
  facets?: FilterFacet[] | undefined;
  hasActiveFilters?: boolean | undefined;
  simulatePermissionDenied?: boolean | undefined;
  simulateError?: boolean | undefined;
  onSelectCompany?: ((company: CRM1CompanyRead) => void) | undefined;
  onEditCompany?: ((company: CRM1CompanyRead) => void) | undefined;
  onAddCompany?: (() => void) | undefined;
}

export function CompaniesListPage({
  data: dataProp,
  isLoading: isLoadingProp,
  isEmpty: isEmptyProp,
  error: errorProp,
  onRetry: onRetryProp,
  httpStatus,
  isAccessDenied: isAccessDeniedProp = false,
  requiredCapability = 'module.read',
  requiredRole = 'viewer',
  currentRole,
  emptyActionLabel = '+ Register Company',
  onEmptyAction,
  pagination: paginationProp,
  onPageChange: onPageChangeProp,
  search: searchProp,
  onSearchChange: onSearchChangeProp,
  filters: filtersProp,
  onFilterChange: onFilterChangeProp,
  onRemoveFilter: onRemoveFilterProp,
  onClearAllFilters: onClearAllFiltersProp,
  activePills: activePillsProp,
  facets = CRM1_COMPANIES_FACETS,
  hasActiveFilters: hasActiveFiltersProp,
  simulatePermissionDenied = false,
  simulateError = false,
  onSelectCompany,
  onEditCompany,
  onAddCompany,
}: CompaniesListPageProps) {
  const isControlled = dataProp !== undefined;

  // Internal state for autonomous vertical slice mode
  const [internalData, setInternalData] = useState<CRM1CompanyRead[]>([]);
  const [internalLoading, setInternalLoading] = useState<boolean>(!isControlled);
  const [internalError, setInternalError] = useState<string | null>(null);
  const [internalAccessDenied, setInternalAccessDenied] = useState<boolean>(
    Boolean(isAccessDeniedProp || simulatePermissionDenied || httpStatus === 403)
  );
  const [page, setPage] = useState<number>(paginationProp?.page ?? 1);
  const pageSize = paginationProp?.pageSize ?? 25;
  const [totalCount, setTotalCount] = useState<number>(paginationProp?.total ?? 0);
  const [search, setSearch] = useState<string>(searchProp ?? '');
  const [filters, setFilters] = useState<TableFilterState>(filtersProp ?? {});

  const loadData = useCallback(async () => {
    if (isControlled) return;

    setInternalLoading(true);
    setInternalError(null);
    setInternalAccessDenied(false);

    if (simulatePermissionDenied) {
      setInternalLoading(false);
      setInternalAccessDenied(true);
      return;
    }

    if (simulateError) {
      setInternalLoading(false);
      setInternalError('Simulated network connectivity fault fetching companies directory.');
      return;
    }

    try {
      const response = await getCompanies({
        page,
        pageSize,
        search: search.trim() ? search.trim() : undefined,
      });
      setInternalData(response.items);
      setTotalCount(response.total);
    } catch (err) {
      if (err instanceof Crm1ApiError && (err.isPermissionDenied() || err.status === 403)) {
        setInternalAccessDenied(true);
      } else if (err instanceof Error) {
        setInternalError(err.message);
      } else {
        setInternalError('An unexpected error occurred while loading companies.');
      }
    } finally {
      setInternalLoading(false);
    }
  }, [isControlled, page, pageSize, search, simulatePermissionDenied, simulateError]);

  useEffect(() => {
    if (!isControlled) {
      void loadData();
    }
  }, [loadData, isControlled]);

  // Handle external search sync
  useEffect(() => {
    if (searchProp !== undefined) {
      setSearch(searchProp);
    }
  }, [searchProp]);

  // Handle external filters sync
  useEffect(() => {
    if (filtersProp !== undefined) {
      setFilters(filtersProp);
    }
  }, [filtersProp]);

  // Effective state resolution
  const effectiveData = isControlled ? dataProp ?? [] : internalData;
  const effectiveLoading = isControlled ? Boolean(isLoadingProp) : internalLoading;
  const effectiveError = isControlled ? errorProp : internalError;
  const effectiveAccessDenied =
    Boolean(isAccessDeniedProp) ||
    Boolean(internalAccessDenied) ||
    Boolean(simulatePermissionDenied) ||
    httpStatus === 403;

  const effectivePage = isControlled ? paginationProp?.page ?? 1 : page;
  const effectivePageSize = isControlled ? paginationProp?.pageSize ?? 25 : pageSize;
  const effectiveTotal = isControlled ? paginationProp?.total ?? effectiveData.length : totalCount;
  const effectiveTotalPages = Math.max(1, Math.ceil(effectiveTotal / effectivePageSize));

  const isSearchOrFilterActive = Boolean(
    hasActiveFiltersProp ||
    search.trim().length > 0 ||
    Object.values(filters).some((val) => val !== undefined && val.trim().length > 0) ||
    (activePillsProp && activePillsProp.length > 0)
  );

  const effectiveIsEmpty =
    isEmptyProp !== undefined ? isEmptyProp : !effectiveLoading && effectiveData.length === 0;

  // Handlers with search & filter reset-to-page-1 invariant
  const handleSearchChange = (term: string) => {
    if (!isControlled) {
      setSearch(term);
      setPage(1);
    }
    onSearchChangeProp?.(term);
  };

  const handleFilterChange = (key: string, value: string) => {
    if (!isControlled) {
      setFilters((prev) => ({ ...prev, [key]: value }));
      setPage(1);
    }
    onFilterChangeProp?.(key, value);
  };

  const handleRemoveFilter = (key: string) => {
    if (!isControlled) {
      setFilters((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setPage(1);
    }
    onRemoveFilterProp?.(key);
  };

  const handleClearAllFilters = () => {
    if (!isControlled) {
      setSearch('');
      setFilters({});
      setPage(1);
    }
    onClearAllFiltersProp?.();
  };

  const handlePageChange = (newPage: number) => {
    if (!isControlled) {
      setPage(newPage);
    }
    onPageChangeProp?.(newPage);
  };

  const handleRetry = () => {
    if (onRetryProp) {
      onRetryProp();
    } else if (!isControlled) {
      void loadData();
    }
  };

  // Convert active filters to pills if not supplied externally
  const computedActivePills: ActiveFilterPill[] = useMemo(() => {
    if (activePillsProp) return activePillsProp;
    const pills: ActiveFilterPill[] = [];
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value.trim()) {
        const facet = facets.find((f) => f.paramKey === key || f.id === key);
        pills.push({
          key,
          label: facet?.label ?? key,
          value,
          displayValue: value,
        });
      }
    });
    return pills;
  }, [activePillsProp, filters, facets]);

  if (effectiveAccessDenied) {
    return (
      <div className="crm1-page-container crm1-companies-page" data-testid="companies-access-denied">
        <AccessDeniedView
          requiredCapability={requiredCapability}
          requiredRole={requiredRole}
          currentRole={currentRole}
          resourceName="Companies Directory"
        />
      </div>
    );
  }

  return (
    <div className="crm1-page-container crm1-companies-page" data-testid="companies-list-page">
      {/* Page Header */}
      <div className="crm1-page-header">
        <div className="crm1-page-header-text">
          <h1 className="crm1-page-title" tabIndex={-1}>
            Companies Directory
          </h1>
          <p className="crm1-page-subtitle">
            Manage commercial accounts, verified tax numbers, corporate affiliations, and flat company records.
          </p>
        </div>
        <div className="crm1-page-header-actions">
          <Button
            variant="primary"
            onClick={onAddCompany ?? onEmptyAction}
            aria-label="Register new company"
          >
            {emptyActionLabel}
          </Button>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div className="crm1-toolbar-container">
        <FilterToolbar
          search={search}
          onSearchChange={handleSearchChange}
          facets={facets}
          filters={filters}
          onFilterChange={handleFilterChange}
          activePills={computedActivePills}
          onRemoveFilter={handleRemoveFilter}
          onClearAll={handleClearAllFilters}
          searchPlaceholder="Search companies by legal name, tax number, or origin..."
        />
      </div>

      {/* Error State */}
      {effectiveError && (
        <div className="crm1-error-banner" data-testid="crm1-error-state">
          <ErrorAlert
            error={effectiveError}
            onRetry={handleRetry}
            retryLabel="Retry fetching companies"
          />
        </div>
      )}

      {/* Loading Skeleton */}
      {effectiveLoading && (
        <div className="crm1-loading-skeleton" data-testid="companies-skeleton-loading">
          <TableSkeleton
            rowCount={8}
            columnCount={6}
            ariaLabel="Loading companies directory from server..."
          />
        </div>
      )}

      {/* Empty State */}
      {!effectiveLoading && !effectiveError && effectiveIsEmpty && (
        <div className="crm1-empty-container" data-testid="companies-empty-state">
          <EmptyState
            title={isSearchOrFilterActive ? 'No matching company records found' : 'No companies registered'}
            description={
              isSearchOrFilterActive
                ? `No companies matched the current search query "${search}" or active filter criteria. Clear filters to see all accounts.`
                : 'No company accounts have been registered or loaded. Register an account or ingest records via Migration Kit.'
            }
            actionLabel={isSearchOrFilterActive ? 'Clear search & filters' : emptyActionLabel}
            onAction={isSearchOrFilterActive ? handleClearAllFilters : (onAddCompany ?? onEmptyAction)}
            secondaryActionLabel={isSearchOrFilterActive ? emptyActionLabel : undefined}
            onSecondaryAction={isSearchOrFilterActive ? (onAddCompany ?? onEmptyAction) : undefined}
          />
        </div>
      )}

      {/* Connected Table */}
      {!effectiveLoading && !effectiveError && !effectiveIsEmpty && (
        <div className="crm1-table-wrapper" data-testid="companies-table-wrapper">
          <CompaniesTable
            companies={effectiveData}
            onSelectCompany={onSelectCompany}
            onEditCompany={onEditCompany}
          />

          {/* Server-side Pagination Footer */}
          <nav
            className="crm1-pagination-footer"
            role="navigation"
            aria-label="Companies pagination navigation"
          >
            <div className="crm1-pagination-info" aria-live="polite">
              Showing{' '}
              <strong>
                {Math.min(effectiveTotal, (effectivePage - 1) * effectivePageSize + 1)}
              </strong>{' '}
              to{' '}
              <strong>
                {Math.min(effectiveTotal, effectivePage * effectivePageSize)}
              </strong>{' '}
              of <strong>{effectiveTotal}</strong> companies
            </div>

            <div className="crm1-pagination-controls">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(Math.max(1, effectivePage - 1))}
                disabled={effectivePage <= 1}
                aria-label="Go to previous page of companies"
              >
                Previous
              </Button>
              <span className="crm1-page-indicator" aria-current="page">
                Page {effectivePage} of {effectiveTotalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(Math.min(effectiveTotalPages, effectivePage + 1))}
                disabled={effectivePage >= effectiveTotalPages}
                aria-label="Go to next page of companies"
              >
                Next
              </Button>
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}
