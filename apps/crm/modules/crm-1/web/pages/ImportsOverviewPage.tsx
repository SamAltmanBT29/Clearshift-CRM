import React from 'react';
import type { CRM1ImportBatchDetail, CRM1ImportReject } from '@clearshift/contracts/crm-1';

export interface ImportsOverviewPageProps {
  batch?: CRM1ImportBatchDetail | null;
  rejects?: readonly CRM1ImportReject[];
  totalRejects?: number;
  rejectPage?: number;
  rejectPageSize?: number;
  isLoading?: boolean;
  error?: string | null;
  onRejectPageChange?: (page: number) => void;
}

export const ImportsOverviewPage: React.FC<ImportsOverviewPageProps> = ({
  batch = null,
  rejects = [],
  totalRejects,
  rejectPage = 1,
  rejectPageSize = 25,
  isLoading = false,
  error = null,
  onRejectPageChange,
}) => {
  const rejectCount = totalRejects ?? batch?.rejectedCount ?? 0;
  const rejectPageCount = Math.max(1, Math.ceil(rejectCount / rejectPageSize));

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

      {!isLoading && !error && batch === null && (
        <div className="cs-empty-state" role="status">
          <h3 className="cs-empty-title">No records found</h3>
          <p className="cs-empty-text">
            Select an import batch to review its persisted receipts and rejected rows.
          </p>
        </div>
      )}

      {!isLoading && !error && batch && (
        <section id="imports-container" aria-label={`Import batch ${batch.id}`}>
          <dl className="cs-import-summary">
            <div><dt>Batch</dt><dd>{batch.id}</dd></div>
            <div><dt>Source system</dt><dd>{batch.sourceSystem}</dd></div>
            <div><dt>Status</dt><dd>{batch.status}</dd></div>
            <div><dt>Loaded</dt><dd>{batch.loadedCount}</dd></div>
            <div><dt>Rejected</dt><dd>{batch.rejectedCount}</dd></div>
          </dl>
          <h3>Accepted rows</h3>
          {batch.receipts.length === 0 ? (
            <p role="status">No accepted rows.</p>
          ) : (
            <div className="cs-table-scroll">
              <table className="cs-data-table">
                <thead>
                  <tr>
                    <th scope="col">Source row</th>
                    <th scope="col">Entity</th>
                    <th scope="col">Target ID</th>
                    <th scope="col">Committed at</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.receipts.map((receipt) => (
                    <tr key={`${receipt.sourceRow}-${receipt.entity}`}>
                      <th scope="row">{receipt.sourceRow}</th>
                      <td>{receipt.entity}</td>
                      <td>{receipt.targetId}</td>
                      <td>{receipt.createdAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3>Rejected rows</h3>
          {rejectCount === 0 ? (
            <p role="status">No rejected rows.</p>
          ) : rejects.length === 0 ? (
            <p role="status">Rejected rows exist, but none are loaded for this page.</p>
          ) : (
            <div className="cs-table-scroll">
              <table className="cs-data-table">
                <thead>
                  <tr>
                    <th scope="col">Source row</th>
                    <th scope="col">Entity</th>
                    <th scope="col">Reason code</th>
                    <th scope="col">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rejects.map((reject) => (
                    <tr key={reject.id}>
                      <th scope="row">{reject.sourceRow}</th>
                      <td>{reject.entity}</td>
                      <td>{reject.reasonCode}</td>
                      <td>{reject.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {onRejectPageChange && rejectCount > 0 && (
            <nav className="cs-pagination" aria-label="Import reject pages">
              <button
                type="button"
                className="cs-action-button"
                disabled={rejectPage <= 1}
                onClick={() => onRejectPageChange(rejectPage - 1)}
              >
                Previous
              </button>
              <span>Page {rejectPage} of {rejectPageCount}</span>
              <button
                type="button"
                className="cs-action-button"
                disabled={rejectPage >= rejectPageCount}
                onClick={() => onRejectPageChange(rejectPage + 1)}
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
