import React from 'react';

export interface TicketsListPageProps {
  data?: Record<string, unknown>[];
  isLoading?: boolean;
}

export const TicketsListPage: React.FC<TicketsListPageProps> = ({
  data = [],
  isLoading = false,
}) => {
  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Support Tickets Queue</h2>
        <p className="cs-page-desc">
          Manage inbound support tickets, assignments, status transitions, and customer issue resolution.
        </p>
      </div>

      <div className="cs-page-card">
        {isLoading ? (
          <p>Loading tickets...</p>
        ) : data.length === 0 ? (
          <p>No support tickets currently found.</p>
        ) : (
          <p>{data.length} tickets loaded.</p>
        )}
      </div>
    </div>
  );
};
