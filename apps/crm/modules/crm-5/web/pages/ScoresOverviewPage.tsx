import React from 'react';

export interface ScoresOverviewPageProps {
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | null;
}

/**
 * Quality Scores Overview Page Shell
 * Integrates with /api/v1/crm-control/scores
 */
export const ScoresOverviewPage: React.FC<ScoresOverviewPageProps> = ({
  isLoading = false,
  isEmpty = false,
  error = null,
}) => {
  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Data Quality Scores</h2>
        <p className="cs-page-desc">
          5-dimension data quality score cards and module average score benchmarks.
        </p>
      </div>

      {isLoading && (
        <div className="cs-skeleton-container" aria-busy="true" aria-label="Loading quality scores">
          <div className="cs-skeleton-line" style={{ width: '100%' }} />
          <div className="cs-skeleton-line" style={{ width: '75%' }} />
          <p className="cs-loading-text">Loading quality score cards...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="cs-error-card" role="alert">
          <p className="cs-error-message">Error loading scores: {error}</p>
        </div>
      )}

      {!isLoading && !error && isEmpty && (
        <div className="cs-empty-state" role="status">
          <h3 className="cs-empty-title">No records found</h3>
          <p className="cs-empty-text">
            No quality scores available yet. Scored batches will appear here with completeness, validity, and reject metrics.
          </p>
        </div>
      )}

      {!isLoading && !error && !isEmpty && (
        <div className="cs-content-placeholder" id="scores-container">
          <p className="cs-ready-notice">Ready for quality scores grid integration.</p>
        </div>
      )}
    </div>
  );
};
