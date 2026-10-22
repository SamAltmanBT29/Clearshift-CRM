import React from 'react';

export interface CompaniesListPageProps {
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | null;
}

/**
 * Companies List Page Shell
 * Integrates with /api/v1/crm-contacts/companies
 */
export const CompaniesListPage: React.FC<CompaniesListPageProps> = ({
  isLoading = false,
  isEmpty = false,
  error = null,
}) => {
  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Companies Directory</h2>
        <p className="cs-page-desc">
          Browse and manage accounts, tax numbers, contact affiliations, and corporate addresses.
        </p>
      </div>

      {isLoading && (
        <div className="cs-skeleton-container" aria-busy="true" aria-label="Loading companies list">
          <div className="cs-skeleton-line" style={{ width: '100%' }} />
          <div className="cs-skeleton-line" style={{ width: '90%' }} />
          <p className="cs-loading-text">Loading companies from server...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="cs-error-card" role="alert">
          <p className="cs-error-message">Error loading companies: {error}</p>
        </div>
      )}

      {!isLoading && !error && isEmpty && (
        <div className="cs-empty-state" role="status">
          <h3 className="cs-empty-title">No records found</h3>
          <p className="cs-empty-text">
            No company records currently registered. Register an account or import accounts from source files.
          </p>
        </div>
      )}

      {!isLoading && !error && !isEmpty && (
        <div className="cs-content-placeholder" id="companies-container">
          <p className="cs-ready-notice">Ready for companies data table integration.</p>
        </div>
      )}
    </div>
  );
};
