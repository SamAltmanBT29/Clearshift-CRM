import React from 'react';
import { DataTable } from '../components/DataTable.js';
import { FilterToolbar } from '../components/FilterToolbar.js';
import { IMPORTS_COLUMNS } from '../table/columns.js';
import { CRM1_IMPORTS_FACETS } from '../table/facets.js';
import type {
  TableSortState,
  TablePaginationState,
  TableFilterState,
  ActiveFilterPill,
  FilterFacet,
} from '../table/types.js';

export interface ImportsOverviewPageProps {
  data?: Record<string, unknown>[];
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | null;
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

/**
 * Imports and Rejections Overview Page Shell
 * Integrates with /api/v1/crm-contacts/imports, FilterToolbar, and paginated DataTable.
 * Conforms to ClearShift V1 Issue #111 (CRM1-18).
 */
export const ImportsOverviewPage: React.FC<ImportsOverviewPageProps> = ({
  data = [],
  isLoading = false,
  isEmpty = false,
  error = null,
  sort,
  onSortChange,
  pagination = { page: 1, pageSize: 25, total: 0, totalPages: 1 },
  onPageChange,
  search = '',
  onSearchChange,
  filters = {},
  onFilterChange,
  onRemoveFilter,
  onClearAllFilters,
  activePills = [],
  facets = CRM1_IMPORTS_FACETS,
  hasActiveFilters = false,
}) => {
  const displayData = isEmpty ? [] : data;
  const isFiltersActive =
    hasActiveFilters ||
    Boolean(search.trim().length > 0) ||
    Object.values(filters).some((v) => v !== undefined && v.trim().length > 0) ||
    activePills.length > 0;

  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Import Batches & Receipts</h2>
        <p className="cs-page-desc">
          Monitor source batch progress, durable import receipts, and row-level rejection audits.
        </p>
      </div>

      {onSearchChange && onFilterChange && (
        <FilterToolbar
          search={search}
          onSearchChange={onSearchChange}
          facets={facets}
          filters={filters}
          onFilterChange={onFilterChange}
          activePills={activePills}
          onRemoveFilter={onRemoveFilter ?? (() => {})}
          onClearAll={onClearAllFilters ?? (() => {})}
          searchPlaceholder="Search imports by batch ID or filename..."
        />
      )}

      {isLoading && (
        <div className="cs-skeleton-container" aria-busy="true" aria-label="Loading import history">
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <p className="cs-loading-text">Loading import history...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="cs-error-card" role="alert">
          <p className="cs-error-message">Error loading import batches: {error}</p>
        </div>
      )}

      {!isLoading && !error && (
        <DataTable
          columns={IMPORTS_COLUMNS}
          data={displayData}
          loading={false}
          emptyTitle={isFiltersActive ? 'No matching records found' : 'No records found'}
          emptyDescription={
            isFiltersActive
              ? 'No import batches match your search and filter criteria. Try adjusting your search term or clearing filters.'
              : 'No migration import batches recorded. Upload CSV or XLSX files via the migration wizard to begin.'
          }
          hasActiveFilters={isFiltersActive}
          onClearFilters={onClearAllFilters}
          sort={sort}
          onSortChange={onSortChange}
          pagination={pagination}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
};
