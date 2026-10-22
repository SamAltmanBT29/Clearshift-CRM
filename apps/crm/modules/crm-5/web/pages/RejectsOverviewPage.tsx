import React from 'react';

export interface RejectsOverviewPageProps {
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | null;
}

/**
 * Rejections Overview Page Shell
 * Integrates with /api/v1/crm-control/rejects
 */
export const RejectsOverviewPage: React.FC<RejectsOverviewPageProps> = ({
  isLoading = false,
  isEmpty = false,
  error = null,
}) => {
  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Row-Level Rejection Audit</h2>
        <p className="cs-page-desc">
          Failed row inspections with sanitized error reasons and cryptographic payload hashes.
        </p>
      </div>

      {isLoading && (
        <div className="cs-skeleton-container" aria-busy="true" aria-label="Loading rejections">
          <div className="cs-skeleton-line" style={{ width: '100%' }} />
          <div className="cs-skeleton-line" style={{ width: '85%' }} />
          <p className="cs-loading-text">Loading rejection records...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="cs-error-card" role="alert">
          <p className="cs-error-message">Error loading rejections: {error}</p>
        </div>
      )}

      {!isLoading && !error && isEmpty && (
        <div className="cs-empty-state" role="status">
          <h3 className="cs-empty-title">No records found</h3>
          <p className="cs-empty-text">
            No rejected rows detected. All migration batch rows passed validation cleanly.
          </p>
        </div>
      )}

      {!isLoading && !error && !isEmpty && (
        <div className="cs-content-placeholder" id="rejects-container">
          <p className="cs-ready-notice">Ready for rejects inspection table integration.</p>
        </div>
      )}
    </div>
  );
};
