import React from 'react';
import { DataTable } from '../components/DataTable.js';
import { IMPORTS_COLUMNS } from '../table/columns.js';
import type { TableSortState, TablePaginationState } from '../table/types.js';

export interface ImportsOverviewPageProps {
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
 * Imports and Rejections Overview Page Shell
 * Integrates with /api/v1/crm-contacts/imports and paginated DataTable
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
}) => {
  const displayData = isEmpty ? [] : data;

  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Import Batches & Receipts</h2>
        <p className="cs-page-desc">
          Monitor source batch progress, durable import receipts, and row-level rejection audits.
        </p>
      </div>

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
          emptyTitle="No records found"
          emptyDescription="No migration import batches recorded. Upload CSV or XLSX files via the migration wizard to begin."
          sort={sort}
          onSortChange={onSortChange}
          pagination={pagination}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
};
