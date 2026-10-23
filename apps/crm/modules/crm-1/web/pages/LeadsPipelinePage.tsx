import React from 'react';
import { DataTable } from '../components/DataTable.js';
import { LEADS_COLUMNS } from '../table/columns.js';
import type { TableSortState, TablePaginationState } from '../table/types.js';

export interface LeadsPipelinePageProps {
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
 * Leads Pipeline Page Shell
 * Integrates with /api/v1/crm-contacts/leads and paginated DataTable
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
}) => {
  const displayData = isEmpty ? [] : data;

  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Leads Pipeline</h2>
        <p className="cs-page-desc">
          Track prospective sales opportunities through verified lifecycle stages: New, Working, Qualified, and Closed.
        </p>
      </div>

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
          emptyTitle="No records found"
          emptyDescription="No active leads in pipeline. Create a new lead or import prospects from marketing sources."
          sort={sort}
          onSortChange={onSortChange}
          pagination={pagination}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
};
