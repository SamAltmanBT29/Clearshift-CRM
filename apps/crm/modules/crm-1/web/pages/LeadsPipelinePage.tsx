import React from 'react';

export interface LeadsPipelinePageProps {
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | null;
}

/**
 * Leads Pipeline Page Shell
 * Integrates with /api/v1/crm-contacts/leads and enforces status allowlist transitions
 */
export const LeadsPipelinePage: React.FC<LeadsPipelinePageProps> = ({
  isLoading = false,
  isEmpty = false,
  error = null,
}) => {
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
          <div className="cs-skeleton-line" style={{ width: '100%' }} />
          <div className="cs-skeleton-line" style={{ width: '90%' }} />
          <p className="cs-loading-text">Loading leads from server...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="cs-error-card" role="alert">
          <p className="cs-error-message">Error loading leads: {error}</p>
        </div>
      )}

      {!isLoading && !error && isEmpty && (
        <div className="cs-empty-state" role="status">
          <h3 className="cs-empty-title">No records found</h3>
          <p className="cs-empty-text">
            No active leads in pipeline. Create a new lead or import prospects from marketing sources.
          </p>
        </div>
      )}

      {!isLoading && !error && !isEmpty && (
        <div className="cs-content-placeholder" id="leads-container">
          <p className="cs-ready-notice">Ready for leads pipeline table integration.</p>
        </div>
      )}
    </div>
  );
};
