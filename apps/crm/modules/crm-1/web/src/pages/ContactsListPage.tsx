import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@clearshift/ui';
import type { CRM1ContactRead } from '@clearshift/contracts';
import { getContacts, Crm1ApiError } from '../api/crm-1.js';
import { ContactsTable } from '../components/ContactsTable.js';
import { FilterToolbar } from '../../components/FilterToolbar.js';
import { TableSkeleton } from '../../components/TableSkeleton.js';
import { ErrorAlert } from '../../components/ErrorAlert.js';
import { AccessDeniedView } from '../../components/AccessDeniedView.js';
import { EmptyState } from '../../components/EmptyState.js';
import { CRM1_CONTACTS_FACETS } from '../../table/facets.js';
import type {
  TablePaginationState,
  TableFilterState,
  ActiveFilterPill,
  FilterFacet,
} from '../../table/types.js';

export interface ContactsListPageProps {
  data?: CRM1ContactRead[] | undefined;
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
  onSelectContact?: ((contact: CRM1ContactRead) => void) | undefined;
  onEditContact?: ((contact: CRM1ContactRead) => void) | undefined;
  onAddContact?: (() => void) | undefined;
}

export function ContactsListPage({
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
  emptyActionLabel = '+ Add Contact',
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
  facets = CRM1_CONTACTS_FACETS,
  hasActiveFilters: hasActiveFiltersProp,
  simulatePermissionDenied = false,
  simulateError = false,
  onSelectContact,
  onEditContact,
  onAddContact,
}: ContactsListPageProps) {
  const isControlled = dataProp !== undefined;

  // Internal autonomous state
  const [internalData, setInternalData] = useState<CRM1ContactRead[]>([]);
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

    try {
      const res = await getContacts(
        {
          page,
          pageSize,
          search: search.trim() || undefined,
          leadStatus: filters['leadStatus'] || undefined,
          companyId: filters['companyId'] || undefined,
        },
        { simulatePermissionDenied, simulateError }
      );
      setInternalData(res.items);
      setTotalCount(res.total);
    } catch (err: unknown) {
      if (err instanceof Crm1ApiError && err.isPermissionDenied()) {
        setInternalAccessDenied(true);
      } else {
        const msg = err instanceof Error ? err.message : 'Failed to fetch contacts';
        setInternalError(msg);
      }
    } finally {
      setInternalLoading(false);
    }
  }, [page, pageSize, search, filters, isControlled, simulatePermissionDenied, simulateError]);

  useEffect(() => {
    if (!isControlled) {
      loadData();
    }
  }, [loadData, isControlled]);

  // Derived effective values
  const effectiveData = isControlled ? dataProp ?? [] : internalData;
  const effectiveLoading = isControlled ? isLoadingProp ?? false : internalLoading;
  const effectiveError = isControlled ? errorProp : internalError;
  const effectiveAccessDenied =
    isControlled
      ? isAccessDeniedProp || httpStatus === 403 || simulatePermissionDenied
      : internalAccessDenied;
  const effectivePage = isControlled ? paginationProp?.page ?? 1 : page;
  const effectiveTotal = isControlled ? paginationProp?.total ?? effectiveData.length : totalCount;
  const totalPages = Math.max(1, Math.ceil(effectiveTotal / pageSize));

  const effectiveSearch = isControlled ? searchProp ?? '' : search;
  const effectiveFilters = isControlled ? filtersProp ?? {} : filters;

  const isFiltersActive = useMemo(() => {
    if (hasActiveFiltersProp !== undefined) return hasActiveFiltersProp;
    if (effectiveSearch.trim().length > 0) return true;
    return Object.values(effectiveFilters).some((v) => v !== undefined && v.trim().length > 0);
  }, [hasActiveFiltersProp, effectiveSearch, effectiveFilters]);

  // Handlers
  const handleSearchChange = (term: string) => {
    if (onSearchChangeProp) {
      onSearchChangeProp(term);
    }
    if (!isControlled) {
      setSearch(term);
      setPage(1); // Reset to page 1 on search
    }
  };

  const handleFilterChange = (key: string, value: string) => {
    if (onFilterChangeProp) {
      onFilterChangeProp(key, value);
    }
    if (!isControlled) {
      setFilters((prev) => ({ ...prev, [key]: value }));
      setPage(1); // Reset to page 1 on filter
    }
  };

  const handleRemoveFilter = (key: string) => {
    if (onRemoveFilterProp) {
      onRemoveFilterProp(key);
    }
    if (!isControlled) {
      setFilters((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setPage(1);
    }
  };

  const handleClearAll = () => {
    if (onClearAllFiltersProp) {
      onClearAllFiltersProp();
    }
    if (!isControlled) {
      setSearch('');
      setFilters({});
      setPage(1);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (onPageChangeProp) {
      onPageChangeProp(newPage);
    }
    if (!isControlled) {
      setPage(newPage);
    }
  };

  const handleRetry = () => {
    if (onRetryProp) {
      onRetryProp();
    } else if (!isControlled) {
      loadData();
    }
  };

  // Compute active pills
  const activePills: ActiveFilterPill[] = useMemo(() => {
    if (activePillsProp) return activePillsProp;
    const pills: ActiveFilterPill[] = [];
    for (const [key, val] of Object.entries(effectiveFilters)) {
      if (val && val.trim().length > 0) {
        const facet = facets.find((f) => f.paramKey === key || f.id === key);
        const opt = facet?.options.find((o) => o.value === val);
        pills.push({
          key,
          label: facet?.label || key,
          value: val,
          displayValue: opt?.label || val,
        });
      }
    }
    return pills;
  }, [activePillsProp, effectiveFilters, facets]);

  if (effectiveAccessDenied) {
    return (
      <div className="crm1-page-container crm1-contacts-page" data-testid="contacts-access-denied">
        <AccessDeniedView
          requiredCapability={requiredCapability}
          requiredRole={requiredRole}
          currentRole={currentRole}
          resourceName="Contacts Directory"
        />
      </div>
    );
  }

  const isSearchOrFilterActive = Boolean(
    hasActiveFiltersProp ||
    effectiveSearch.trim().length > 0 ||
    Object.values(effectiveFilters).some((val) => val !== undefined && val.trim().length > 0) ||
    activePills.length > 0
  );

  const effectiveIsEmpty =
    isEmptyProp !== undefined ? isEmptyProp : !effectiveLoading && effectiveData.length === 0;

  return (
    <div className="crm1-page-container crm1-contacts-page" data-testid="contacts-list-page">
      {/* Page Header */}
      <div className="crm1-page-header">
        <div className="crm1-page-header-text">
          <h1 className="crm1-page-title" tabIndex={-1}>
            Contacts Directory
          </h1>
          <p className="crm1-page-subtitle">
            Server-paged contacts directory matching name and email with golden identity resolution.
          </p>
        </div>
        <div className="crm1-page-header-actions">
          <Button
            variant="primary"
            onClick={onAddContact ?? onEmptyAction}
            aria-label="Add a new contact"
          >
            {emptyActionLabel}
          </Button>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div className="crm1-toolbar-container">
        <FilterToolbar
          search={effectiveSearch}
          onSearchChange={handleSearchChange}
          facets={facets}
          filters={effectiveFilters}
          onFilterChange={handleFilterChange}
          activePills={activePills}
          onRemoveFilter={handleRemoveFilter}
          onClearAll={handleClearAll}
          searchPlaceholder="Search contacts by name, email, or key..."
        />
      </div>

      {/* Error State */}
      {effectiveError && (
        <div className="crm1-error-banner" data-testid="crm1-error-state">
          <ErrorAlert
            error={effectiveError}
            onRetry={handleRetry}
            retryLabel="Retry fetching contacts"
          />
        </div>
      )}

      {/* Loading Skeleton */}
      {effectiveLoading && (
        <div className="crm1-loading-skeleton" data-testid="contacts-skeleton-loading">
          <TableSkeleton
            rowCount={8}
            columnCount={8}
            ariaLabel="Loading contacts from server..."
          />
        </div>
      )}

      {/* Empty State */}
      {!effectiveLoading && !effectiveError && effectiveIsEmpty && (
        <div className="crm1-empty-container" data-testid="contacts-empty-state">
          <EmptyState
            title={isSearchOrFilterActive ? 'No matching contact records found' : 'No contacts registered'}
            description={
              isSearchOrFilterActive
                ? `No contacts matched the current search query "${effectiveSearch}" or active filter criteria. Clear filters to see all contacts.`
                : 'No contact records have been registered or loaded. Add a contact or ingest records via Migration Kit.'
            }
            actionLabel={isSearchOrFilterActive ? 'Clear search & filters' : emptyActionLabel}
            onAction={isSearchOrFilterActive ? handleClearAll : (onAddContact ?? onEmptyAction)}
            secondaryActionLabel={isSearchOrFilterActive ? emptyActionLabel : undefined}
            onSecondaryAction={isSearchOrFilterActive ? (onAddContact ?? onEmptyAction) : undefined}
          />
        </div>
      )}

      {/* Connected Table */}
      {!effectiveLoading && !effectiveError && !effectiveIsEmpty && (
        <div className="crm1-table-wrapper" data-testid="contacts-table-wrapper">
          <ContactsTable
            contacts={effectiveData}
            onSelectContact={onSelectContact}
            onEditContact={onEditContact}
          />

          {/* Server-side Pagination Footer */}
          <nav
            className="crm1-pagination-footer"
            role="navigation"
            aria-label="Contacts pagination navigation"
          >
            <div className="crm1-pagination-info" aria-live="polite">
              Showing{' '}
              <strong>
                {Math.min(effectiveTotal, (effectivePage - 1) * pageSize + 1)}
              </strong>{' '}
              to{' '}
              <strong>
                {Math.min(effectiveTotal, effectivePage * pageSize)}
              </strong>{' '}
              of <strong>{effectiveTotal}</strong> contacts
            </div>

            <div className="crm1-pagination-controls">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(Math.max(1, effectivePage - 1))}
                disabled={effectivePage <= 1}
                aria-label="Previous page"
              >
                Previous
              </Button>
              <span className="crm1-page-indicator" aria-current="page">
                Page {effectivePage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(Math.min(totalPages, effectivePage + 1))}
                disabled={effectivePage >= totalPages}
                aria-label="Next page"
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

