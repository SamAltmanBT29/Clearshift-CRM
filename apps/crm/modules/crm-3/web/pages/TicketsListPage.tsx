import React from 'react';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';
import { DataTable } from '../components/DataTable.js';
import { TICKETS_COLUMNS } from '../table/columns.js';
import type {
  DataTableColumn,
  TableSortState,
  TablePaginationState,
} from '../table/types.js';

export { TICKETS_COLUMNS };

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
  columns?: DataTableColumn[];
  sort?: TableSortState | undefined;
  onSortChange?: ((columnKey: string) => void) | undefined;
  pagination?: TablePaginationState | undefined;
  onPageChange?: ((newPage: number) => void) | undefined;
  onSelectTicket?: ((ticket: Record<string, unknown>) => void) | undefined;
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'New': return 'cs-badge cs-badge-new';
    case 'Open': return 'cs-badge cs-badge-open';
    case 'Waiting': return 'cs-badge cs-badge-waiting';
    case 'Solved': return 'cs-badge cs-badge-solved';
    case 'Closed': return 'cs-badge cs-badge-closed';
    default: return 'cs-badge';
  }
}

function getPriorityBadgeClass(priority: string): string {
  switch (priority) {
    case 'Low': return 'cs-badge cs-badge-low';
    case 'Normal': return 'cs-badge cs-badge-normal';
    case 'High': return 'cs-badge cs-badge-high';
    case 'Urgent': return 'cs-badge cs-badge-urgent';
    default: return 'cs-badge';
  }
}

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
  columns = TICKETS_COLUMNS,
  sort,
  onSortChange,
  pagination,
  onPageChange,
  onSelectTicket,
}) => {
  const displayData = isEmpty ? [] : data;
  const accessForbidden = isAccessDenied || httpStatus === 403;

  const renderCustomCell = (columnKey: string, row: Record<string, unknown>, value: unknown) => {
    if (columnKey === 'status') {
      const statusStr = String(value || 'New');
      return (
        <span className={getStatusBadgeClass(statusStr)} data-testid={`status-badge-${row['id']}`}>
          {statusStr}
        </span>
      );
    }
    if (columnKey === 'priority') {
      const priorityStr = String(value || 'Normal');
      return (
        <span className={getPriorityBadgeClass(priorityStr)} data-testid={`priority-badge-${row['id']}`}>
          {priorityStr}
        </span>
      );
    }
    if (columnKey === 'contactName') {
      return (
        <span className="cs-font-semibold" data-testid={`contact-name-${row['id']}`}>
          {String(value || row['contact_id'] || '—')}
        </span>
      );
    }
    return undefined;
  };

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
              columnCount={columns.length}
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

          {!isLoading && !error && !accessForbidden && displayData.length > 0 && (
            <DataTable
              columns={columns}
              data={displayData}
              loading={false}
              sort={sort}
              onSortChange={onSortChange}
              pagination={
                pagination ?? {
                  page: 1,
                  pageSize: 25,
                  total: displayData.length,
                  totalPages: Math.max(1, Math.ceil(displayData.length / 25)),
                }
              }
              onPageChange={onPageChange}
              onSelectRow={onSelectTicket}
              renderCustomCell={renderCustomCell}
              tableAriaLabel="Support Tickets Queue"
            />
          )}
        </>
      )}
    </div>
  );
};
