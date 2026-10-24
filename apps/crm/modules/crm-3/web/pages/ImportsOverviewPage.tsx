import React from 'react';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';

export interface ImportsOverviewPageProps {
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

export const ImportsOverviewPage: React.FC<ImportsOverviewPageProps> = ({
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
  emptyActionLabel = 'Start Migration',
  onEmptyAction,
}) => {
  const displayData = isEmpty ? [] : data;
  const accessForbidden = isAccessDenied || httpStatus === 403;

  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Import Batches & Receipts</h2>
        <p className="cs-page-desc">
          Audit Migration Kit support ticket batch jobs, row reconciliations, and durable import receipts.
        </p>
      </div>

      {accessForbidden ? (
        <AccessDeniedView
          requiredCapability={requiredCapability}
          requiredRole={requiredRole}
          currentRole={currentRole}
          resourceName="Import Batches & Receipts"
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
              columnCount={6}
              ariaLabel="Loading import batches..."
            />
          ) : !error && (
            displayData.length === 0 ? (
              <EmptyState
                title="No import batches currently recorded"
                description="No Migration Kit support ticket batch imports have been executed yet."
                icon="📦"
                actionLabel={emptyActionLabel}
                onAction={onEmptyAction}
              />
            ) : (
              <div className="cs-page-card">
                <p>{displayData.length} import batches processed.</p>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
};
