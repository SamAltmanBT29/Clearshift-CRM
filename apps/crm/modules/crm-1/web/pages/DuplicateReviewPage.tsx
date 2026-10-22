import React from 'react';

export interface DuplicateReviewPageProps {
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | null;
}

/**
 * Duplicate Candidate Review Page Shell
 * Enforces exact key matches and human-reviewed resolution (no fuzzy auto-merging)
 */
export const DuplicateReviewPage: React.FC<DuplicateReviewPageProps> = ({
  isLoading = false,
  isEmpty = false,
  error = null,
}) => {
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
          <div className="cs-skeleton-line" style={{ width: '100%' }} />
          <div className="cs-skeleton-line" style={{ width: '90%' }} />
          <p className="cs-loading-text">Loading candidate records...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="cs-error-card" role="alert">
          <p className="cs-error-message">Error loading duplicate candidates: {error}</p>
        </div>
      )}

      {!isLoading && !error && isEmpty && (
        <div className="cs-empty-state" role="status">
          <h3 className="cs-empty-title">No records found</h3>
          <p className="cs-empty-text">
            No duplicate candidates requiring human resolution. All entities are distinct and reconciled.
          </p>
        </div>
      )}

      {!isLoading && !error && !isEmpty && (
        <div className="cs-content-placeholder" id="duplicate-review-container">
          <p className="cs-ready-notice">Ready for duplicate candidate review queue integration.</p>
        </div>
      )}
    </div>
  );
};
