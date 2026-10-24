import React from 'react';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';

export interface TicketNotesPageProps {
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

export const TicketNotesPage: React.FC<TicketNotesPageProps> = ({
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
  emptyActionLabel = 'Add Internal Note',
  onEmptyAction,
}) => {
  const displayData = isEmpty ? [] : data;
  const accessForbidden = isAccessDenied || httpStatus === 403;

  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Internal Ticket Notes</h2>
        <p className="cs-page-desc">
          Review append-only internal notes recorded on tickets in newest-first order.
        </p>
      </div>

      {accessForbidden ? (
        <AccessDeniedView
          requiredCapability={requiredCapability}
          requiredRole={requiredRole}
          currentRole={currentRole}
          resourceName="Internal Ticket Notes"
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
              rowCount={4}
              columnCount={4}
              ariaLabel="Loading internal notes..."
            />
          ) : !error && (
            displayData.length === 0 ? (
              <EmptyState
                title="No internal notes recorded"
                description="No internal notes have been appended to this ticket yet."
                icon="📝"
                actionLabel={emptyActionLabel}
                onAction={onEmptyAction}
              />
            ) : (
              <div className="cs-page-card">
                <p>{displayData.length} notes recorded.</p>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
};
