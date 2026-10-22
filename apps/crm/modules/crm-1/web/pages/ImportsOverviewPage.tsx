import React from 'react';

export interface ImportsOverviewPageProps {
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | null;
}

/**
 * Imports and Rejections Overview Page Shell
 * Integrates with /api/v1/crm-contacts/imports and /imports/:batch/rejects
 */
export const ImportsOverviewPage: React.FC<ImportsOverviewPageProps> = ({
  isLoading = false,
  isEmpty = false,
  error = null,
}) => {
  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Import Batches & Receipts</h2>
        <p className="cs-page-desc">
          Monitor source batch progress, durable import receipts, and row-level rejection reasons.
        </p>
      </div>

      {isLoading && (
        <div className="cs-skeleton-container" aria-busy="true" aria-label="Loading import batches">
          <div className="cs-skeleton-line" style={{ width: '100%' }} />
          <div className="cs-skeleton-line" style={{ width: '90%' }} />
          <p className="cs-loading-text">Loading import history...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="cs-error-card" role="alert">
          <p className="cs-error-message">Error loading import batches: {error}</p>
        </div>
      )}

      {!isLoading && !error && isEmpty && (
        <div className="cs-empty-state" role="status">
          <h3 className="cs-empty-title">No records found</h3>
          <p className="cs-empty-text">
            No migration import batches recorded. Upload CSV or XLSX files via the migration wizard to begin.
          </p>
        </div>
      )}

      {!isLoading && !error && !isEmpty && (
        <div className="cs-content-placeholder" id="imports-container">
          <p className="cs-ready-notice">Ready for import batches data table integration.</p>
        </div>
      )}
    </div>
  );
};
