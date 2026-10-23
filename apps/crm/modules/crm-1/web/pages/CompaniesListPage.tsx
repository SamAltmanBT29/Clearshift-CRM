import React from 'react';
import { DataTable } from '../components/DataTable.js';
import { COMPANIES_COLUMNS } from '../table/columns.js';
import type { TableSortState, TablePaginationState } from '../table/types.js';

export interface CompaniesListPageProps {
  data?: Record<string, unknown>[];
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | null;
  sort?: TableSortState | undefined;
  onSortChange?: ((columnKey: string) => void) | undefined;
  pagination?: TablePaginationState | undefined;
  onPageChange?: ((newPage: number) => void) | undefined;
}

/**
 * Companies List Page Shell
 * Integrates with /api/v1/crm-contacts/companies and paginated DataTable
 */
export const CompaniesListPage: React.FC<CompaniesListPageProps> = ({
  data = [],
  isLoading = false,
  isEmpty = false,
  error = null,
  sort,
  onSortChange,
  pagination = { page: 1, pageSize: 25, total: 0, totalPages: 1 },
  onPageChange,
}) => {
  const displayData = isEmpty ? [] : data;

  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Companies Directory</h2>
        <p className="cs-page-desc">
          Browse and manage accounts, tax numbers, contact affiliations, and corporate addresses.
        </p>
      </div>

      {isLoading && (
        <div className="cs-skeleton-container" aria-busy="true" aria-label="Loading companies list">
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <p className="cs-loading-text">Loading companies from server...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="cs-error-card" role="alert">
          <p className="cs-error-message">Error loading companies: {error}</p>
        </div>
      )}

      {!isLoading && !error && (
        <DataTable
          columns={COMPANIES_COLUMNS}
          data={displayData}
          loading={false}
          emptyTitle="No records found"
          emptyDescription="No company records currently registered. Register an account or import accounts from source files."
          sort={sort}
          onSortChange={onSortChange}
          pagination={pagination}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
};
