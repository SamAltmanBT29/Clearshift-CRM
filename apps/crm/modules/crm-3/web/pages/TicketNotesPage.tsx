import React from 'react';

export interface TicketNotesPageProps {
  data?: Record<string, unknown>[];
  isLoading?: boolean;
}

export const TicketNotesPage: React.FC<TicketNotesPageProps> = ({
  data = [],
  isLoading = false,
}) => {
  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Internal Ticket Notes</h2>
        <p className="cs-page-desc">
          Review append-only internal notes recorded on tickets in newest-first order.
        </p>
      </div>

      <div className="cs-page-card">
        {isLoading ? (
          <p>Loading ticket notes...</p>
        ) : data.length === 0 ? (
          <p>No internal notes recorded.</p>
        ) : (
          <p>{data.length} notes recorded.</p>
        )}
      </div>
    </div>
  );
};
