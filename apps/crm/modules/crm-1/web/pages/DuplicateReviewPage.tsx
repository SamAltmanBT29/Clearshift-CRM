import React from 'react';
import { DataTable } from '../components/DataTable.js';
import { FilterToolbar } from '../components/FilterToolbar.js';
import { DUPLICATES_COLUMNS } from '../table/columns.js';
import { CRM1_DUPLICATES_FACETS } from '../table/facets.js';
import type {
  TableSortState,
  TablePaginationState,
  TableFilterState,
  ActiveFilterPill,
  FilterFacet,
} from '../table/types.js';

export interface DuplicateReviewPageProps {
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
 * Duplicate Candidate Review Page Shell
 * Enforces exact key matches and human-reviewed resolution (no fuzzy auto-merging).
 * Integrates with FilterToolbar and paginated DataTable.
 * Conforms to ClearShift V1 Issue #111 (CRM1-18).
 */
export const DuplicateReviewPage: React.FC<DuplicateReviewPageProps> = ({
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
  facets = CRM1_DUPLICATES_FACETS,
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
        <h2>Exact Duplicate Candidate Review</h2>
        <p className="cs-page-desc">
          Deterministic exact matches held for human review: normalized email, phone + name, or tax number. Fuzzy auto-merges are strictly prohibited.
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
          searchPlaceholder="Search candidates by name, email, or rule..."
        />
      )}

      {isLoading && (
        <div className="cs-skeleton-container" aria-busy="true" aria-label="Loading duplicate review candidates">
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <p className="cs-loading-text">Loading candidate records...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="cs-error-card" role="alert">
          <p className="cs-error-message">Error loading duplicate candidates: {error}</p>
        </div>
      )}

      {!isLoading && !error && (
        <DataTable
          columns={DUPLICATES_COLUMNS}
          data={displayData}
          loading={false}
          emptyTitle={isFiltersActive ? 'No matching records found' : 'No records found'}
          emptyDescription={
            isFiltersActive
              ? 'No duplicate review candidates match your search and filter criteria. Try adjusting your search term or clearing filters.'
              : 'No duplicate candidates requiring human resolution. All entities are distinct and reconciled.'
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
