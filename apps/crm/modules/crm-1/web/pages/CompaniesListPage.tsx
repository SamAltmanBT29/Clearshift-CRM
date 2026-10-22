import React from 'react';
import type { CRM1Company } from '@clearshift/contracts/crm-1';

export interface CompaniesListPageProps {
  companies?: readonly CRM1Company[];
  total?: number;
  page?: number;
  pageSize?: number;
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | null;
  onPageChange?: (page: number) => void;
}

export const CompaniesListPage: React.FC<CompaniesListPageProps> = ({
  companies,
  total,
  page = 1,
  pageSize = 25,
  isLoading = false,
  isEmpty = companies === undefined || companies.length === 0,
  error = null,
  onPageChange,
}) => {
  const rows = companies ?? [];
  const resultCount = total ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(resultCount / pageSize));
  const empty = companies === undefined ? isEmpty : companies.length === 0;

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

      {!isLoading && !error && empty && (
        <div className="cs-empty-state" role="status">
          <h3 className="cs-empty-title">No records found</h3>
          <p className="cs-empty-text">
            No company records currently registered. Register an account or import accounts from source files.
          </p>
        </div>
      )}

      {!isLoading && !error && !empty && (
        <section id="companies-container" aria-label="Companies">
          <p className="cs-result-count">{resultCount} companies</p>
          <div className="cs-table-scroll">
            <table className="cs-data-table">
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Tax number</th>
                  <th scope="col">Email</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Address</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((company) => (
                  <tr key={company.id}>
                    <th scope="row">{company.name}</th>
                    <td>{company.taxNumber ?? 'Not provided'}</td>
                    <td>{company.email ?? 'Not provided'}</td>
                    <td>{company.phone ?? 'Not provided'}</td>
                    <td>{company.address ?? 'Not provided'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {onPageChange && (
            <nav className="cs-pagination" aria-label="Company list pages">
              <button type="button" className="cs-action-button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                Previous
              </button>
              <span>Page {page} of {pageCount}</span>
              <button
                type="button"
                className="cs-action-button"
                disabled={page >= pageCount}
                onClick={() => onPageChange(page + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </section>
      )}
    </div>
  );
};
