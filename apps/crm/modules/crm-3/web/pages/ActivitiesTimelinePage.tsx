import React from 'react';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';

export interface ActivitiesTimelinePageProps {
  data?: Record<string, unknown>[];
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | Error | { code?: string; message?: string; details?: unknown } | null;
  onRetry?: (() => void) | undefined;
  httpStatus?: number;
  isAccessDenied?: boolean;
  requiredCapability?: string;
  requiredRole?: string;
  currentRole?: string;
  emptyActionLabel?: string;
  onEmptyAction?: (() => void) | undefined;
}

export const ActivitiesTimelinePage: React.FC<ActivitiesTimelinePageProps> = ({
  data = [],
  isLoading = false,
  isEmpty = false,
  error = null,
  onRetry,
  httpStatus,
  isAccessDenied = false,
  requiredCapability = 'module.read',
  requiredRole,
  currentRole,
  emptyActionLabel = 'Log Activity',
  onEmptyAction,
}) => {
  const displayData = isEmpty ? [] : data;
  const accessForbidden = isAccessDenied || httpStatus === 403;

  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Customer Activity Timeline</h2>
        <p className="cs-page-desc">
          Audit chronological timeline of customer interactions, support calls, emails, and meetings.
        </p>
      </div>

      {accessForbidden ? (
        <AccessDeniedView
          requiredCapability={requiredCapability}
          requiredRole={requiredRole}
          currentRole={currentRole}
          resourceName="Customer Activity Timeline"
        />
      ) : (
        <>
          {error && (
            <div className="cs-error-container">
              <ErrorAlert error={error} onRetry={onRetry} />
            </div>
          )}

          {isLoading ? (
            <TableSkeleton
              rowCount={5}
              columnCount={5}
              ariaLabel="Loading customer activities..."
            />
          ) : !error && (
            displayData.length === 0 ? (
              <EmptyState
                title="No activity records logged"
                description="There are currently no customer activities recorded in the timeline."
                icon="⏱️"
                actionLabel={emptyActionLabel}
                onAction={onEmptyAction}
              />
            ) : (
              <div className="cs-page-card">
                <p>{displayData.length} activities logged.</p>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
};
