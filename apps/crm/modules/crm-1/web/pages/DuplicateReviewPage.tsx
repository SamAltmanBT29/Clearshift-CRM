import React from 'react';
import { DataTable } from '../components/DataTable.js';
import { DUPLICATES_COLUMNS } from '../table/columns.js';
import type { TableSortState, TablePaginationState } from '../table/types.js';

export interface DuplicateReviewPageProps {
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
 * Duplicate Candidate Review Page Shell
 * Enforces exact key matches and human-reviewed resolution (no fuzzy auto-merging)
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
}) => {
  const displayData = isEmpty ? [] : data;

  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Exact Duplicate Candidate Review</h2>
        <p className="cs-page-desc">
          Deterministic exact matches held for human review: normalized email, phone + name, or tax number. Fuzzy auto-merges are strictly prohibited.
        </p>
      </div>

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
          emptyTitle="No records found"
          emptyDescription="No duplicate candidates requiring human resolution. All entities are distinct and reconciled."
          sort={sort}
          onSortChange={onSortChange}
          pagination={pagination}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
};
