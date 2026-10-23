import React from 'react';
import { DataTable } from '../components/DataTable.js';
import { FilterToolbar } from '../components/FilterToolbar.js';
import { LEADS_COLUMNS } from '../table/columns.js';
import { CRM1_LEADS_FACETS } from '../table/facets.js';
import type {
  TableSortState,
  TablePaginationState,
  TableFilterState,
  ActiveFilterPill,
  FilterFacet,
} from '../table/types.js';

export interface LeadsPipelinePageProps {
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
 * Leads Pipeline Page Shell
 * Integrates with /api/v1/crm-contacts/leads, FilterToolbar, and paginated DataTable.
 * Conforms to ClearShift V1 Issue #111 (CRM1-18).
 */
export const LeadsPipelinePage: React.FC<LeadsPipelinePageProps> = ({
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
  facets = CRM1_LEADS_FACETS,
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
        <h2>Leads Pipeline</h2>
        <p className="cs-page-desc">
          Track prospective sales opportunities through verified lifecycle stages: New, Working, Qualified, and Closed.
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
          searchPlaceholder="Search leads by name, email, or company..."
        />
      )}

      {isLoading && (
        <div className="cs-skeleton-container" aria-busy="true" aria-label="Loading leads pipeline">
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <p className="cs-loading-text">Loading leads from server...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="cs-error-card" role="alert">
          <p className="cs-error-message">Error loading leads: {error}</p>
        </div>
      )}

      {!isLoading && !error && (
        <DataTable
          columns={LEADS_COLUMNS}
          data={displayData}
          loading={false}
          emptyTitle={isFiltersActive ? 'No matching records found' : 'No records found'}
          emptyDescription={
            isFiltersActive
              ? 'No leads match your search and filter criteria. Try adjusting your search term or clearing filters.'
              : 'No active leads in pipeline. Create a new lead or import prospects from marketing sources.'
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
