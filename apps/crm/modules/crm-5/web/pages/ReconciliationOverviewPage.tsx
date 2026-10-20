import React from 'react';

export interface ReconciliationOverviewPageProps {
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | null;
}

/**
 * Reconciliation Overview Page Shell
 * Integrates with /api/v1/crm-control/reconciliation/:batch
 */
export const ReconciliationOverviewPage: React.FC<ReconciliationOverviewPageProps> = ({
  isLoading = false,
  isEmpty = false,
  error = null,
}) => {
  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Conservation Balance Sheet</h2>
        <p className="cs-page-desc">
          Audits mathematical row-count conservation: Source = Loaded + Rejected + Merged + Skipped + Unaccounted.
        </p>
      </div>

      {isLoading && (
        <div className="cs-skeleton-container" aria-busy="true" aria-label="Loading reconciliation balance sheet">
          <div className="cs-skeleton-line" style={{ width: '100%' }} />
          <div className="cs-skeleton-line" style={{ width: '70%' }} />
          <p className="cs-loading-text">Loading reconciliation data...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="cs-error-card" role="alert">
          <p className="cs-error-message">Error loading reconciliation: {error}</p>
        </div>
      )}

      {!isLoading && !error && isEmpty && (
        <div className="cs-empty-state" role="status">
          <h3 className="cs-empty-title">No records found</h3>
          <p className="cs-empty-text">
            No reconciliation balance sheets currently available. Batch reports reconcile automatically upon step completion.
          </p>
        </div>
      )}

      {!isLoading && !error && !isEmpty && (
        <div className="cs-content-placeholder" id="reconciliation-container">
          <p className="cs-ready-notice">Ready for conservation balance sheet integration.</p>
        </div>
      )}
    </div>
  );
};
