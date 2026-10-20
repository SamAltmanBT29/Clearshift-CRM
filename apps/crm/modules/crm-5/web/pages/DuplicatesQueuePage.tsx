import React from 'react';

export interface DuplicatesQueuePageProps {
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | null;
}

/**
 * Duplicate Candidate Review Queue Page Shell
 * Integrates with /api/v1/crm-control/duplicates/held and /duplicates/resolve
 */
export const DuplicatesQueuePage: React.FC<DuplicatesQueuePageProps> = ({
  isLoading = false,
  isEmpty = false,
  error = null,
}) => {
  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Duplicate Candidate Review Queue</h2>
        <p className="cs-page-desc">
          Exact matching duplicates held for authorized human review. Automated fuzzy merging is strictly prohibited.
        </p>
      </div>

      {isLoading && (
        <div className="cs-skeleton-container" aria-busy="true" aria-label="Loading duplicate review queue">
          <div className="cs-skeleton-line" style={{ width: '100%' }} />
          <div className="cs-skeleton-line" style={{ width: '90%' }} />
          <p className="cs-loading-text">Loading duplicate review candidates...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="cs-error-card" role="alert">
          <p className="cs-error-message">Error loading duplicates: {error}</p>
        </div>
      )}

      {!isLoading && !error && isEmpty && (
        <div className="cs-empty-state" role="status">
          <h3 className="cs-empty-title">No records found</h3>
          <p className="cs-empty-text">
            No duplicate candidates held for review. All candidate records are unique or already resolved.
          </p>
        </div>
      )}

      {!isLoading && !error && !isEmpty && (
        <div className="cs-content-placeholder" id="duplicates-container">
          <p className="cs-ready-notice">Ready for duplicate review queue integration.</p>
        </div>
      )}
    </div>
  );
};
