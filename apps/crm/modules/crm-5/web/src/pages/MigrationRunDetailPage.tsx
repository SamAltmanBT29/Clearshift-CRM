import React, { useState, useEffect, useCallback } from 'react';
import type { MigrationRun, MigrationRunStatus, BatchSummaryContract } from '@clearshift/contracts';
import { Crm5ApiClient, crm5Api } from '../api/crm-5.js';
import { ConfirmActionDialog } from '../components/forms/ConfirmActionDialog.js';

export interface MigrationRunDetailPageProps {
  runId: string;
  apiClient?: Crm5ApiClient;
  onBackToList?: () => void;
  onNavigateToEdit?: (id: string) => void;
}

/**
 * MigrationRunDetailPage
 * Detailed view of a single migration run projection and aggregated batch summary.
 * Links back to list context, enforces read-only protections for computed fields,
 * and provides confirmed transitions for destructive or terminal actions.
 */
export const MigrationRunDetailPage: React.FC<MigrationRunDetailPageProps> = ({
  runId,
  apiClient = crm5Api,
  onBackToList,
  onNavigateToEdit,
}) => {
  const [run, setRun] = useState<MigrationRun | null>(null);
  const [batchSummary, setBatchSummary] = useState<BatchSummaryContract | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog state for destructive/critical actions
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    targetStatus: MigrationRunStatus;
  }>({
    isOpen: false,
    title: '',
    message: '',
    targetStatus: 'halted',
  });

  const loadRunDetail = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const runRecord = await apiClient.getRunById(runId);
      setRun(runRecord);

      try {
        const summary = (await apiClient.getBatchSummary(runRecord.batchId)) as unknown as BatchSummaryContract;
        setBatchSummary(summary);
      } catch {
        // Non-critical: Batch summary may be partial or not yet linked
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [runId, apiClient]);

  useEffect(() => {
    loadRunDetail();
  }, [loadRunDetail]);

  const handleStatusTransition = async (newStatus: MigrationRunStatus) => {
    if (!run) return;
    try {
      const updated = await apiClient.transitionRunStatus(run.id, newStatus);
      setRun(updated);
      setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const getStatusBadgeStyle = (status: MigrationRunStatus): React.CSSProperties => {
    switch (status) {
      case 'completed':
        return { background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' };
      case 'running':
        return { background: '#dbeafe', color: '#1e40af', border: '1px solid #bfdbfe' };
      case 'failed':
        return { background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' };
      case 'halted':
        return { background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' };
      default:
        return { background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0' };
    }
  };

  if (isLoading) {
    return (
      <div className="cs-detail-container" role="status" aria-busy="true" style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
        <div className="cs-detail-header-card" style={{ background: '#ffffff', borderRadius: '12px', padding: '24px', border: '1px solid #e2e8f0' }}>
          <div className="cs-skeleton-title" style={{ height: '32px', width: '40%', background: '#e2e8f0', borderRadius: '4px' }} />
          <div
            className="cs-skeleton-row"
            style={{ height: '20px', width: '20%', marginTop: '12px', background: '#f1f5f9', borderRadius: '4px' }}
          />
        </div>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="cs-detail-container" style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
        <nav className="cs-breadcrumbs" aria-label="Breadcrumbs" style={{ marginBottom: '16px' }}>
          <ol className="cs-breadcrumb-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            <li className="cs-breadcrumb-item">
              <button
                type="button"
                className="cs-breadcrumb-link"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit', color: '#2563eb' }}
                onClick={onBackToList}
              >
                ← Back to Migration Runs
              </button>
            </li>
          </ol>
        </nav>

        <div className="cs-alert-card cs-alert-error" role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '20px' }}>
          <span className="cs-alert-icon" aria-hidden="true" style={{ fontSize: '24px' }}>
            ❌
          </span>
          <div className="cs-alert-content">
            <h2 className="cs-alert-title" style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#991b1b' }}>Unable to Load Migration Run</h2>
            <p className="cs-alert-desc" style={{ margin: '8px 0 0 0', fontSize: '14px', color: '#b91c1c' }}>{error ?? `Migration run '${runId}' not found.`}</p>
            <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="cs-btn cs-btn-secondary"
                onClick={loadRunDetail}
                style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer' }}
              >
                Retry
              </button>
              {onBackToList && (
                <button
                  type="button"
                  className="cs-btn cs-btn-primary"
                  onClick={onBackToList}
                  style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: '#2563eb', color: '#ffffff', cursor: 'pointer' }}
                >
                  Return to Runs List
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const numIn = run.recordsIn;
  const numOut = run.recordsOut;
  const numRej = run.recordsRejected;
  const totalProcessed = numOut + numRej;
  const completionPercentage =
    numIn > 0 ? Math.min(100, Math.round((totalProcessed / numIn) * 100)) : 0;

  return (
    <div className="cs-detail-container" style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Accessible Breadcrumbs linking back to list context */}
      <nav className="cs-breadcrumbs" aria-label="Breadcrumbs" style={{ marginBottom: '16px' }}>
        <ol className="cs-breadcrumb-list" style={{ display: 'flex', alignItems: 'center', gap: '8px', listStyle: 'none', padding: 0, margin: 0, fontSize: '13px', color: '#64748b' }}>
          <li className="cs-breadcrumb-item">
            <span className="cs-breadcrumb-link">ClearShift</span>
          </li>
          <li aria-hidden="true">/</li>
          <li className="cs-breadcrumb-item">
            <span className="cs-breadcrumb-link">CRM-5 Migration Control</span>
          </li>
          <li aria-hidden="true">/</li>
          <li className="cs-breadcrumb-item">
            {onBackToList ? (
              <button
                type="button"
                className="cs-breadcrumb-link"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#2563eb', font: 'inherit' }}
                onClick={onBackToList}
              >
                Runs
              </button>
            ) : (
              <span>Runs</span>
            )}
          </li>
          <li aria-hidden="true">/</li>
          <li className="cs-breadcrumb-item" aria-current="page">
            <span className="cs-code-inline" style={{ fontFamily: 'monospace', fontWeight: 600, color: '#0f172a' }}>{run.batchId}</span>
          </li>
        </ol>
      </nav>

      {/* Header Card with Identification & Actions */}
      <div className="cs-detail-header-card" style={{ background: '#ffffff', borderRadius: '12px', padding: '24px', border: '1px solid #e2e8f0', marginBottom: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div className="cs-detail-top-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div className="cs-detail-title-group">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              {onBackToList && (
                <button
                  type="button"
                  className="cs-btn cs-btn-secondary cs-btn-sm"
                  onClick={onBackToList}
                  aria-label="Back to Runs List"
                  style={{ padding: '4px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer' }}
                >
                  ← Back to List
                </button>
              )}
              <span className="cs-module-chip" style={{ padding: '2px 8px', background: '#f1f5f9', borderRadius: '4px', fontSize: '12px', fontWeight: 600, color: '#334155' }}>{run.module.toUpperCase()}</span>
              <span className="cs-step-tag" style={{ padding: '2px 8px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '12px', color: '#64748b' }}>Step: {run.step.toUpperCase()}</span>
            </div>
            <h1 className="cs-detail-title" style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
              Batch: {run.batchId}
              <span style={{ fontSize: '12px', fontWeight: 600, padding: '4px 10px', borderRadius: '9999px', textTransform: 'uppercase', ...getStatusBadgeStyle(run.status) }}>
                {run.status}
              </span>
            </h1>
          </div>

          <div className="cs-detail-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {/* Edit Action */}
            {onNavigateToEdit && (
              <button
                type="button"
                className="cs-btn cs-btn-secondary"
                onClick={() => onNavigateToEdit(run.id)}
                style={{ padding: '8px 14px', fontSize: '13px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer' }}
              >
                ✏️ Edit Telemetry
              </button>
            )}

            {/* Halt Action (Irreversible/Destructive Confirmation) */}
            {run.status === 'running' && (
              <button
                type="button"
                className="cs-btn cs-btn-danger"
                onClick={() =>
                  setConfirmDialog({
                    isOpen: true,
                    title: 'Halt Batch Execution',
                    message: `Are you sure you want to halt execution for batch '${run.batchId}'? Active worker threads will be stopped and marked halted.`,
                    targetStatus: 'halted',
                  })
                }
                style={{ padding: '8px 14px', fontSize: '13px', borderRadius: '6px', border: 'none', background: '#dc2626', color: '#ffffff', cursor: 'pointer' }}
              >
                ⏸️ Halt Execution
              </button>
            )}

            {/* Resume Action */}
            {run.status === 'halted' && (
              <button
                type="button"
                className="cs-btn cs-btn-primary"
                onClick={() => handleStatusTransition('running')}
                style={{ padding: '8px 14px', fontSize: '13px', borderRadius: '6px', border: 'none', background: '#2563eb', color: '#ffffff', cursor: 'pointer' }}
              >
                ▶️ Resume Execution
              </button>
            )}

            {/* Abort Action (Irreversible/Destructive Confirmation) */}
            {(run.status === 'running' || run.status === 'halted') && (
              <button
                type="button"
                className="cs-btn cs-btn-secondary"
                onClick={() =>
                  setConfirmDialog({
                    isOpen: true,
                    title: 'Abort Run to Terminal Failure',
                    message: `Are you sure you want to mark run '${run.batchId}' as failed? This is a terminal state transition that cannot be reversed.`,
                    targetStatus: 'failed',
                  })
                }
                style={{ padding: '8px 14px', fontSize: '13px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#dc2626', cursor: 'pointer' }}
              >
                🛑 Abort Run
              </button>
            )}

            <button
              type="button"
              className="cs-btn cs-btn-secondary"
              onClick={loadRunDetail}
              title="Refresh record from API"
              style={{ padding: '8px 14px', fontSize: '13px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer' }}
            >
              🔄 Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Grid of Telemetry, Timing & Scores */}
      <div className="cs-detail-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        {/* Panel 1: Record Conservation */}
        <div className="cs-panel-card" style={{ background: '#ffffff', borderRadius: '12px', padding: '20px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <h2 className="cs-panel-title" style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            Record Conservation Telemetry
            <span className="cs-readonly-badge" style={{ fontSize: '11px', fontWeight: 600, padding: '2px 6px', background: '#e2e8f0', borderRadius: '4px', color: '#475569' }}>Server Computed</span>
          </h2>
          <div className="cs-prop-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
            <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="cs-prop-label" style={{ color: '#64748b' }}>Records In:</span>
              <span className="cs-prop-value" style={{ fontWeight: 600, color: '#0f172a' }}>{numIn.toLocaleString()}</span>
            </div>
            <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="cs-prop-label" style={{ color: '#64748b' }}>Records Out:</span>
              <span className="cs-prop-value cs-text-ok" style={{ fontWeight: 600, color: '#16a34a' }}>{numOut.toLocaleString()}</span>
            </div>
            <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="cs-prop-label" style={{ color: '#64748b' }}>Records Rejected:</span>
              <span className="cs-prop-value cs-text-err" style={{ fontWeight: 600, color: '#dc2626' }}>{numRej.toLocaleString()}</span>
            </div>
            <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="cs-prop-label" style={{ color: '#64748b' }}>Total Processed:</span>
              <span className="cs-prop-value" style={{ fontWeight: 600, color: '#0f172a' }}>
                {totalProcessed.toLocaleString()} / {numIn.toLocaleString()} ({completionPercentage}%)
              </span>
            </div>
            <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #f1f5f9', paddingTop: '8px' }}>
              <span className="cs-prop-label" style={{ color: '#64748b' }}>Conservation Invariant:</span>
              <span className="cs-prop-value cs-text-ok" style={{ fontWeight: 600, color: totalProcessed <= numIn ? '#16a34a' : '#dc2626' }}>
                {totalProcessed <= numIn ? '✅ Balanced (Out + Rej ≤ In)' : '❌ Violated'}
              </span>
            </div>
          </div>
        </div>

        {/* Panel 2: Execution Timing & Lifecycle */}
        <div className="cs-panel-card" style={{ background: '#ffffff', borderRadius: '12px', padding: '20px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <h2 className="cs-panel-title" style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', margin: '0 0 16px 0' }}>Execution Lifecycle & Audit</h2>
          <div className="cs-prop-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
            <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="cs-prop-label" style={{ color: '#64748b' }}>Projection ID:</span>
              <span className="cs-code-inline" style={{ fontFamily: 'monospace', color: '#0f172a' }}>{run.id.slice(0, 8)}...</span>
            </div>
            <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="cs-prop-label" style={{ color: '#64748b' }}>Started At:</span>
              <span className="cs-prop-value" style={{ color: '#0f172a' }}>
                {new Date(run.startedAt).toLocaleString()}
              </span>
            </div>
            <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="cs-prop-label" style={{ color: '#64748b' }}>Completed At:</span>
              <span className="cs-prop-value" style={{ color: '#0f172a' }}>
                {run.completedAt ? new Date(run.completedAt).toLocaleString() : 'In Progress'}
              </span>
            </div>
            <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="cs-prop-label" style={{ color: '#64748b' }}>Duration:</span>
              <span className="cs-prop-value" style={{ color: '#0f172a' }}>
                {run.completedAt
                  ? `${Math.max(
                      0,
                      Math.round(
                        (new Date(run.completedAt).getTime() -
                          new Date(run.startedAt).getTime()) /
                          1000
                      )
                    )}s`
                  : 'Active'}
              </span>
            </div>
            <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #f1f5f9', paddingTop: '8px' }}>
              <span className="cs-prop-label" style={{ color: '#64748b' }}>System Last Updated:</span>
              <span className="cs-prop-value" style={{ color: '#0f172a' }}>
                {new Date(run.updatedAt).toLocaleTimeString()}
              </span>
            </div>
          </div>
        </div>

        {/* Panel 3: Quality & Reconciliation Reference */}
        <div className="cs-panel-card" style={{ background: '#ffffff', borderRadius: '12px', padding: '20px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <h2 className="cs-panel-title" style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', margin: '0 0 16px 0' }}>Data Quality & Reconciliation</h2>
          <div className="cs-prop-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
            <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="cs-prop-label" style={{ color: '#64748b' }}>Quality Score:</span>
              <span className="cs-prop-value" style={{ fontWeight: 600, color: '#0f172a' }}>
                {batchSummary?.score?.score != null
                  ? `${batchSummary.score.score.toFixed(2)}%`
                  : 'N/A (Pending)'}
              </span>
            </div>
            <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="cs-prop-label" style={{ color: '#64748b' }}>Reconciliation Status:</span>
              <span
                className={`cs-prop-value ${
                  batchSummary?.reconciliation?.status === 'OK' ? 'cs-text-ok' : 'cs-text-err'
                }`}
                style={{ fontWeight: 600, color: batchSummary?.reconciliation?.status === 'OK' ? '#16a34a' : '#dc2626' }}
              >
                {batchSummary?.reconciliation?.status ?? 'Not Calculated'}
              </span>
            </div>
            <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="cs-prop-label" style={{ color: '#64748b' }}>Audit Rejections Logged:</span>
              <span className="cs-prop-value" style={{ color: '#0f172a' }}>
                {batchSummary?.totals?.totalRecordsRejected ?? numRej} rows
              </span>
            </div>
            <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #f1f5f9', paddingTop: '8px' }}>
              <span className="cs-prop-label" style={{ color: '#64748b' }}>Batch State Consistency:</span>
              <span className="cs-prop-value cs-text-ok" style={{ fontWeight: 600, color: '#16a34a' }}>
                {batchSummary?.consistency?.isConsistent ? '✅ Consistent' : 'Pending Audit'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog for Destructive / Terminal Actions */}
      <ConfirmActionDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel="Proceed with Transition"
        cancelLabel="Cancel"
        isDestructive={true}
        onConfirm={() => handleStatusTransition(confirmDialog.targetStatus)}
        onCancel={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};
