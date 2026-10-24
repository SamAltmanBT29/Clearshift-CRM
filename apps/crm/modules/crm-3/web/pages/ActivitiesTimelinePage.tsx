import React from 'react';

export interface ActivitiesTimelinePageProps {
  data?: Record<string, unknown>[];
  isLoading?: boolean;
}

export const ActivitiesTimelinePage: React.FC<ActivitiesTimelinePageProps> = ({
  data = [],
  isLoading = false,
}) => {
  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Customer Activity Timeline</h2>
        <p className="cs-page-desc">
          Audit chronological timeline of customer interactions, support calls, emails, and meetings.
        </p>
      </div>

      <div className="cs-page-card">
        {isLoading ? (
          <p>Loading activity timeline...</p>
        ) : data.length === 0 ? (
          <p>No activity records logged.</p>
        ) : (
          <p>{data.length} activities logged.</p>
        )}
      </div>
    </div>
  );
};
