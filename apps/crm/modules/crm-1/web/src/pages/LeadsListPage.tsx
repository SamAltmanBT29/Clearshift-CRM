import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@clearshift/ui';
import type { CRM1LeadRead } from '@clearshift/contracts';
import { getLeads, Crm1ApiError } from '../api/crm-1.js';
import { LeadsTable } from '../components/LeadsTable.js';
import { FilterToolbar } from '../../components/FilterToolbar.js';
import { TableSkeleton } from '../../components/TableSkeleton.js';
import { ErrorAlert } from '../../components/ErrorAlert.js';
import { AccessDeniedView } from '../../components/AccessDeniedView.js';
import { EmptyState } from '../../components/EmptyState.js';
import { CRM1_LEADS_FACETS } from '../../table/facets.js';
import type {
  TablePaginationState,
  TableFilterState,
  ActiveFilterPill,
  FilterFacet,
} from '../../table/types.js';

export interface LeadsListPageProps {
  data?: CRM1LeadRead[] | undefined;
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
  onSelectLead?: ((lead: CRM1LeadRead) => void) | undefined;
  onEditLead?: ((lead: CRM1LeadRead) => void) | undefined;
  onAddLead?: (() => void) | undefined;
}

export function LeadsListPage({
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
  emptyActionLabel = '+ Create Lead',
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
  facets = CRM1_LEADS_FACETS,
  hasActiveFilters: hasActiveFiltersProp,
  simulatePermissionDenied = false,
  simulateError = false,
  onSelectLead,
  onEditLead,
  onAddLead,
}: LeadsListPageProps) {
  const isControlled = dataProp !== undefined;

  // Internal autonomous state
  const [internalData, setInternalData] = useState<CRM1LeadRead[]>([]);
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
      setInternalError('Simulated network connectivity fault fetching leads pipeline.');
      return;
    }

    try {
      const response = await getLeads({
        page,
        pageSize,
        status: (filters['status'] as 'New' | 'Working' | 'Qualified' | 'Closed') || undefined,
      });
      setInternalData(response.items);
      setTotalCount(response.total);
    } catch (err) {
      if (err instanceof Crm1ApiError && (err.isPermissionDenied() || err.status === 403)) {
        setInternalAccessDenied(true);
      } else if (err instanceof Error) {
        setInternalError(err.message);
      } else {
        setInternalError('An unexpected error occurred while loading leads.');
      }
    } finally {
      setInternalLoading(false);
    }
  }, [isControlled, page, pageSize, filters, simulatePermissionDenied, simulateError]);

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
      <div className="crm1-page-container crm1-leads-page" data-testid="leads-access-denied">
        <AccessDeniedView
          requiredCapability={requiredCapability}
          requiredRole={requiredRole}
          currentRole={currentRole}
          resourceName="Leads Pipeline"
        />
      </div>
    );
  }

  return (
    <div className="crm1-page-container crm1-leads-page" data-testid="leads-list-page">
      {/* Page Header */}
      <div className="crm1-page-header">
        <div className="crm1-page-header-text">
          <h1 className="crm1-page-title" tabIndex={-1}>
            Leads Pipeline
          </h1>
          <p className="crm1-page-subtitle">
            Track prospective sales opportunities through verified lifecycle stages: New, Working, Qualified, and Closed.
          </p>
        </div>
        <div className="crm1-page-header-actions">
          <Button
            variant="primary"
            onClick={onAddLead ?? onEmptyAction}
            aria-label="Create new lead"
          >
            {emptyActionLabel}
          </Button>
        </div>
      </div>

      {/* Filter Toolbar */}
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
          searchPlaceholder="Filter leads by contact identifier, title, or status..."
        />
      </div>

      {/* Error State */}
      {effectiveError && (
        <div className="crm1-error-banner" data-testid="crm1-error-state">
          <ErrorAlert
            error={effectiveError}
            onRetry={handleRetry}
            retryLabel="Retry fetching leads pipeline"
          />
        </div>
      )}

      {/* Loading Skeleton */}
      {effectiveLoading && (
        <div className="crm1-loading-skeleton" data-testid="leads-skeleton-loading">
          <TableSkeleton
            rowCount={8}
            columnCount={5}
            ariaLabel="Loading leads pipeline from server..."
          />
        </div>
      )}

      {/* Empty State */}
      {!effectiveLoading && !effectiveError && effectiveIsEmpty && (
        <div className="crm1-empty-container" data-testid="leads-empty-state">
          <EmptyState
            title={isSearchOrFilterActive ? 'No matching leads found' : 'No leads created'}
            description={
              isSearchOrFilterActive
                ? `No leads matched your filter criteria. Clear filters to see all pipeline opportunities.`
                : 'No sales prospects currently exist in the pipeline. Create a lead or ingest qualified prospects via Migration Kit.'
            }
            actionLabel={isSearchOrFilterActive ? 'Clear filters' : emptyActionLabel}
            onAction={isSearchOrFilterActive ? handleClearAllFilters : (onAddLead ?? onEmptyAction)}
            secondaryActionLabel={isSearchOrFilterActive ? emptyActionLabel : undefined}
            onSecondaryAction={isSearchOrFilterActive ? (onAddLead ?? onEmptyAction) : undefined}
          />
        </div>
      )}

      {/* Connected Table */}
      {!effectiveLoading && !effectiveError && !effectiveIsEmpty && (
        <div className="crm1-table-wrapper" data-testid="leads-table-wrapper">
          <LeadsTable
            leads={effectiveData}
            onSelectLead={onSelectLead}
            onEditLead={onEditLead}
          />

          {/* Server-side Pagination Footer */}
          <nav
            className="crm1-pagination-footer"
            role="navigation"
            aria-label="Leads pagination navigation"
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
              of <strong>{effectiveTotal}</strong> leads
            </div>

            <div className="crm1-pagination-controls">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(Math.max(1, effectivePage - 1))}
                disabled={effectivePage <= 1}
                aria-label="Go to previous page of leads"
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
                aria-label="Go to next page of leads"
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
