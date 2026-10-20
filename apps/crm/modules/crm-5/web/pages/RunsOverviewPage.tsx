import React from 'react';

export interface RunsOverviewPageProps {
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | null;
}

/**
 * Migration Runs Overview Page Shell
 * Integrates with /api/v1/crm-control/runs
 */
export const RunsOverviewPage: React.FC<RunsOverviewPageProps> = ({
  isLoading = false,
  isEmpty = false,
  error = null,
}) => {
  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Migration Run Projections</h2>
        <p className="cs-page-desc">
          Inspect batch execution events and progression through migration lifecycle steps.
        </p>
      </div>

      {isLoading && (
        <div className="cs-skeleton-container" aria-busy="true" aria-label="Loading run projections">
          <div className="cs-skeleton-line" style={{ width: '100%' }} />
          <div className="cs-skeleton-line" style={{ width: '80%' }} />
          <div className="cs-skeleton-line" style={{ width: '60%' }} />
          <p className="cs-loading-text">Loading migration runs from server...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="cs-error-card" role="alert">
          <p className="cs-error-message">Error loading runs: {error}</p>
        </div>
      )}

      {!isLoading && !error && isEmpty && (
        <div className="cs-empty-state" role="status">
          <h3 className="cs-empty-title">No records found</h3>
          <p className="cs-empty-text">
            No migration run projections currently recorded. Run events will project here automatically.
          </p>
        </div>
      )}

      {!isLoading && !error && !isEmpty && (
        <div className="cs-content-placeholder" id="runs-table-container">
          {/* Table container for Issue #190 */}
          <p className="cs-ready-notice">Ready for paginated data table integration.</p>
        </div>
      )}
    </div>
  );
};
