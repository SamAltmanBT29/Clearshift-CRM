import React from 'react';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';

export interface RejectsOverviewPageProps {
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
 * Rejections Overview Page Shell
 * Integrates with /api/v1/crm-control/rejects
 * Conforms to ClearShift V1 Issue #192 (CRM5-19).
 */
export const RejectsOverviewPage: React.FC<RejectsOverviewPageProps> = ({
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
  emptyActionLabel = 'Refresh Rejections',
  onEmptyAction,
}) => {
  const accessForbidden = isAccessDenied || httpStatus === 403;
  const hasNoData = isEmpty || data.length === 0;

  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Row-Level Rejection Audit</h2>
        <p className="cs-page-desc">
          Failed row inspections with sanitized error reasons and cryptographic payload hashes.
        </p>
      </div>

      {accessForbidden ? (
        <AccessDeniedView
          requiredCapability={requiredCapability}
          requiredRole={requiredRole}
          currentRole={currentRole}
          resourceName="Row-Level Rejection Audit"
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
              rowCount={5}
              columnCount={6}
              ariaLabel="Loading rejection records..."
            />
          ) : !error && hasNoData ? (
            <div className="cs-table-card" role="status">
              <EmptyState
                icon="🛡️"
                title="No rejected rows detected"
                description="No rejected rows detected. All migration batch rows passed validation cleanly."
                actionLabel={onEmptyAction ? emptyActionLabel : undefined}
                onAction={onEmptyAction}
              />
            </div>
          ) : !error && (
            <div className="cs-content-placeholder" id="rejects-container">
              <p className="cs-ready-notice">Ready for rejects inspection table integration.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};
