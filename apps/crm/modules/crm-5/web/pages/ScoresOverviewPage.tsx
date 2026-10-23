import React from 'react';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';

export interface ScoresOverviewPageProps {
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
 * Quality Scores Overview Page Shell
 * Integrates with /api/v1/crm-control/scores
 * Conforms to ClearShift V1 Issue #192 (CRM5-19).
 */
export const ScoresOverviewPage: React.FC<ScoresOverviewPageProps> = ({
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
  emptyActionLabel = 'Refresh Scores',
  onEmptyAction,
}) => {
  const accessForbidden = isAccessDenied || httpStatus === 403;
  const hasNoData = isEmpty || data.length === 0;

  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Data Quality Scores</h2>
        <p className="cs-page-desc">
          5-dimension data quality score cards and module average score benchmarks.
        </p>
      </div>

      {accessForbidden ? (
        <AccessDeniedView
          requiredCapability={requiredCapability}
          requiredRole={requiredRole}
          currentRole={currentRole}
          resourceName="Data Quality Scores"
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
              ariaLabel="Loading quality score cards..."
            />
          ) : !error && hasNoData ? (
            <div className="cs-table-card" role="status">
              <EmptyState
                icon="📊"
                title="No quality scores available"
                description="No quality scores available yet. Scored batches will appear here with completeness, validity, and reject metrics."
                actionLabel={onEmptyAction ? emptyActionLabel : undefined}
                onAction={onEmptyAction}
              />
            </div>
          ) : !error && (
            <div className="cs-content-placeholder" id="scores-container">
              <p className="cs-ready-notice">Ready for quality scores grid integration.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};
