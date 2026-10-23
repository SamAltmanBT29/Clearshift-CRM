import React from 'react';

export interface ImportsOverviewPageProps {
  data?: Record<string, unknown>[];
  isLoading?: boolean;
}

export const ImportsOverviewPage: React.FC<ImportsOverviewPageProps> = ({
  data = [],
  isLoading = false,
}) => {
  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Import Batches & Receipts</h2>
        <p className="cs-page-desc">
          Audit Migration Kit support ticket batch jobs, row reconciliations, and durable import receipts.
        </p>
      </div>

      <div className="cs-page-card">
        {isLoading ? (
          <p>Loading import batches...</p>
        ) : data.length === 0 ? (
          <p>No import batches currently recorded.</p>
        ) : (
          <p>{data.length} import batches processed.</p>
        )}
      </div>
    </div>
  );
};
