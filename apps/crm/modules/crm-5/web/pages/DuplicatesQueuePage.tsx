import React from 'react';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';

export interface DuplicatesQueuePageProps {
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

/**
 * Duplicate Candidate Review Queue Page Shell
 * Integrates with /api/v1/crm-control/duplicates/held and /duplicates/resolve
 * Conforms to ClearShift V1 Issue #192 (CRM5-19).
 */
export const DuplicatesQueuePage: React.FC<DuplicatesQueuePageProps> = ({
  data = [],
  isLoading = false,
  isEmpty = false,
  error = null,
  onRetry,
  httpStatus,
  isAccessDenied = false,
  requiredCapability = 'control:read',
  requiredRole,
  currentRole,
  emptyActionLabel = 'Refresh Queue',
  onEmptyAction,
}) => {
  const accessForbidden = isAccessDenied || httpStatus === 403;
  const hasNoData = isEmpty || data.length === 0;

  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Duplicate Candidate Review Queue</h2>
        <p className="cs-page-desc">
          Exact matching duplicates held for authorized human review. Automated fuzzy merging is strictly prohibited.
        </p>
      </div>

      {accessForbidden ? (
        <AccessDeniedView
          requiredCapability={requiredCapability}
          requiredRole={requiredRole}
          currentRole={currentRole}
          resourceName="Duplicate Review Queue"
        />
      ) : (
        <>
          {error && (
            <div className="cs-error-container" style={{ marginBottom: '16px' }}>
              <ErrorAlert error={error} onRetry={onRetry} />
            </div>
          )}

          {isLoading ? (
            <TableSkeleton
              rowCount={4}
              columnCount={5}
              ariaLabel="Loading duplicate review candidates..."
            />
          ) : !error && hasNoData ? (
            <div className="cs-table-card" role="status">
              <EmptyState
                icon="👥"
                title="No duplicate candidates held"
                description="No duplicate candidates held for review. All candidate records are unique or already resolved."
                actionLabel={onEmptyAction ? emptyActionLabel : undefined}
                onAction={onEmptyAction}
              />
            </div>
          ) : !error && (
            <div className="cs-content-placeholder" id="duplicates-container">
              <p className="cs-ready-notice">Ready for duplicate review queue integration.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};
