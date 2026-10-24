import React from 'react';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';

export interface TicketsListPageProps {
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

export const TICKETS_COLUMNS = [
  { key: 'id', label: 'Ticket ID', width: '140px' },
  { key: 'subject', label: 'Subject', width: '250px' },
  { key: 'status', label: 'Status', width: '120px' },
  { key: 'priority', label: 'Priority', width: '110px' },
  { key: 'contact_id', label: 'Contact', width: '160px' },
  { key: 'order_ref', label: 'Order Ref', width: '130px' },
  { key: 'created_at', label: 'Created At', width: '180px' },
];

export const TicketsListPage: React.FC<TicketsListPageProps> = ({
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
  emptyActionLabel = 'Create Ticket',
  onEmptyAction,
}) => {
  const displayData = isEmpty ? [] : data;
  const accessForbidden = isAccessDenied || httpStatus === 403;

  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Support Tickets Queue</h2>
        <p className="cs-page-desc">
          Manage inbound support tickets, assignments, status transitions, and customer issue resolution.
        </p>
      </div>

      {accessForbidden ? (
        <AccessDeniedView
          requiredCapability={requiredCapability}
          requiredRole={requiredRole}
          currentRole={currentRole}
          resourceName="Support Tickets Queue"
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
              columnCount={TICKETS_COLUMNS.length}
              ariaLabel="Loading support tickets from queue..."
            />
          ) : !error && (
            displayData.length === 0 ? (
              <EmptyState
                title="No support tickets found"
                description="There are currently no support tickets in the queue. Create a new ticket to get started."
                icon="🎫"
                actionLabel={emptyActionLabel}
                onAction={onEmptyAction}
              />
            ) : (
              <div className="cs-page-card">
                <p>{displayData.length} tickets loaded.</p>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
};
