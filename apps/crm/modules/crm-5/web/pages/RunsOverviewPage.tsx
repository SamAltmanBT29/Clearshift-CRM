import React from 'react';
import { DataTable } from '../components/DataTable.js';
import { FilterToolbar } from '../components/FilterToolbar.js';
import { RUNS_COLUMNS } from '../table/columns.js';
import { CRM5_RUNS_FACETS } from '../table/facets.js';
import type {
  TableSortState,
  TablePaginationState,
  TableFilterState,
  ActiveFilterPill,
  FilterFacet,
} from '../table/types.js';

export interface RunsOverviewPageProps {
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
 * Migration Runs Overview Page Shell
 * Integrates with /api/v1/crm-control/runs, FilterToolbar, and paginated DataTable.
 * Conforms to ClearShift V1 Issue #191 (CRM5-18).
 */
export const RunsOverviewPage: React.FC<RunsOverviewPageProps> = ({
  data = [],
  isLoading = false,
  isEmpty = false,
  error = null,
  sort,
  onSortChange,
  pagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 },
  onPageChange,
  search = '',
  onSearchChange,
  filters = {},
  onFilterChange,
  onRemoveFilter,
  onClearAllFilters,
  activePills = [],
  facets = CRM5_RUNS_FACETS,
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
        <h2>Migration Run Projections</h2>
        <p className="cs-page-desc">
          Inspect batch execution events and progression through migration lifecycle steps.
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
          searchPlaceholder="Search runs by batch ID..."
        />
      )}

      {isLoading && (
        <div className="cs-skeleton-container" aria-busy="true" aria-label="Loading run projections">
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <p className="cs-loading-text">Loading migration runs from server...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="cs-error-card" role="alert">
          <p className="cs-error-message">Error loading runs: {error}</p>
        </div>
      )}

      {!isLoading && !error && (
        <DataTable
          columns={RUNS_COLUMNS}
          data={displayData}
          loading={false}
          emptyTitle={isFiltersActive ? 'No matching records found' : 'No records found'}
          emptyDescription={
            isFiltersActive
              ? 'No migration run projections match your search and filter criteria. Try adjusting your query or resetting filters.'
              : 'No migration run projections currently recorded. Run events will project here automatically.'
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


