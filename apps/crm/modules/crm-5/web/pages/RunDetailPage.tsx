import React, { useState, useEffect, useCallback } from 'react';
import type {
  MigrationRun,
  QualityScore,
  MigrationReject,
  UpdateRunInput,
} from '@clearshift/contracts';
import {
  getRunById,
  updateRun,
  getRuns,
  getScores,
  getRejects,
  Crm5ApiError,
} from '../api/crm-5.js';
import { EditRunDrawer } from '../components/EditRunDrawer.js';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { ConfirmationToast } from '../components/ConfirmationToast.js';
import { RejectDetailModal } from '../components/RejectDetailModal.js';

export interface RunDetailPageProps {
  runId: string;
  initialRun?: MigrationRun | null | undefined;
  onBackToList?: () => void;
  canEdit?: boolean;
  userRole?: string;
  onNavigateModule?: (moduleKey: string, entityId?: string) => void;
}

export const RunDetailPage: React.FC<RunDetailPageProps> = ({
  runId,
  initialRun,
  onBackToList,
  canEdit = true,
  userRole = 'migration_runner',
  onNavigateModule,
}) => {
  const [run, setRun] = useState<MigrationRun | null>(initialRun ?? null);
  const [relatedRuns, setRelatedRuns] = useState<MigrationRun[]>([]);
  const [relatedScore, setRelatedScore] = useState<QualityScore | null>(null);
  const [relatedRejects, setRelatedRejects] = useState<MigrationReject[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(!initialRun);
  const [error, setError] = useState<string | Error | null>(null);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState<boolean>(false);
  const [selectedReject, setSelectedReject] = useState<MigrationReject | null>(null);
  const [toast, setToast] = useState<{ show: boolean; title: string; message: string } | null>(null);

  const loadRunData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const runData = await getRunById(runId);
      setRun(runData);

      // Load linked entity records for the same batch
      if (runData.batchId) {
        try {
          const [runsRes, scoresRes, rejectsRes] = await Promise.all([
            getRuns({ batchId: runData.batchId, pageSize: 50 }),
            getScores({ batchId: runData.batchId, pageSize: 10 }),
            getRejects({ batchId: runData.batchId, pageSize: 20 }),
          ]);
          setRelatedRuns(runsRes.items);
          setRelatedScore(scoresRes.items[0] ?? null);
          setRelatedRejects(rejectsRes.items);
        } catch (linkErr) {
          console.warn('Failed to fetch linked records for batch:', linkErr);
        }
      }
    } catch (err: any) {
      setError(err instanceof Error ? err : new Error(err?.message || 'Failed to load run details'));
    } finally {
      setIsLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (!initialRun) {
      loadRunData();
    } else {
      setRun(initialRun);
      if (initialRun.batchId) {
        getRuns({ batchId: initialRun.batchId, pageSize: 50 })
          .then((r) => setRelatedRuns(r.items))
          .catch(() => {});
        getScores({ batchId: initialRun.batchId, pageSize: 10 })
          .then((s) => setRelatedScore(s.items[0] ?? null))
          .catch(() => {});
        getRejects({ batchId: initialRun.batchId, pageSize: 20 })
          .then((rej) => setRelatedRejects(rej.items))
          .catch(() => {});
      }
    }
  }, [runId, initialRun, loadRunData]);

  const handleSaveRun = async (id: string, payload: UpdateRunInput): Promise<MigrationRun> => {
    const updated = await updateRun(id, payload);
    setRun(updated);
    setToast({
      show: true,
      title: 'Run Updated',
      message: `Run projection for batch '${updated.batchId}' was successfully updated.`,
    });
    return updated;
  };

  const handleRefreshAndReapply = async () => {
    await loadRunData();
  };

  if (isLoading) {
    return (
      <div className="cs-page-container" style={{ padding: '24px' }} data-testid="detail-loading-state">
        <TableSkeleton rowCount={6} columnCount={4} ariaLabel="Loading run details..." />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="cs-page-container" style={{ padding: '24px' }} data-testid="detail-error-state">
        <ErrorAlert error={error ?? 'Migration run not found'} onRetry={loadRunData} />
        {onBackToList && (
          <div style={{ marginTop: '16px' }}>
            <button
              type="button"
              className="cs-btn cs-btn-secondary"
              onClick={onBackToList}
              style={{ padding: '8px 16px', cursor: 'pointer' }}
            >
              ← Back to Runs List
            </button>
          </div>
        )}
      </div>
    );
  }

  const goldenId = (run.metadata?.['goldenId'] as string) ?? null;
  const operatorNotes = (run.metadata?.['operatorNotes'] as string) ?? null;
  const throughputRate = run.recordsIn > 0 ? Math.round((run.recordsOut / run.recordsIn) * 100) : 100;

  const durationStr =
    run.completedAt && run.startedAt
      ? `${Math.max(1, Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000))}s`
      : 'In Progress';

  const getStatusBadgeStyle = (statusVal: string) => {
    switch (statusVal) {
      case 'completed':
        return { backgroundColor: '#dcfce7', color: '#166534', border: '1px solid #86efac' };
      case 'failed':
        return { backgroundColor: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' };
      case 'halted':
        return { backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' };
      case 'running':
        return { backgroundColor: '#e0f2fe', color: '#075985', border: '1px solid #7dd3fc' };
      default:
        return { backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' };
    }
  };

  return (
    <div className="cs-page-container cs-run-detail-page" style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto' }}>
      {toast && (
        <ConfirmationToast
          show={toast.show}
          title={toast.title}
          message={toast.message}
          type="success"
          onDismiss={() => setToast(null)}
        />
      )}

      {/* Top Header & Breadcrumb Context Navigation */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#64748b' }}>
          <span>ClearShift</span>
          <span>/</span>
          <span>CRM Modules</span>
          <span>/</span>
          {onBackToList ? (
            <button
              type="button"
              onClick={onBackToList}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                font: 'inherit',
                cursor: 'pointer',
                color: '#2563eb',
              }}
            >
              Migration Control
            </button>
          ) : (
            <span>Migration Control</span>
          )}
          <span>/</span>
          <span style={{ fontWeight: 600, color: '#0f172a' }}>Runs</span>
          <span>/</span>
          <span style={{ fontFamily: 'monospace', color: '#0f172a' }}>{run.id.slice(0, 8)}...</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {onBackToList && (
              <button
                type="button"
                onClick={onBackToList}
                className="cs-btn cs-btn-secondary"
                style={{
                  padding: '6px 12px',
                  fontSize: '13px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  cursor: 'pointer',
                }}
                data-testid="back-to-runs-btn"
              >
                ← Back
              </button>
            )}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h1 style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                  Run: {run.step.toUpperCase()} ({run.batchId})
                </h1>
                <span
                  style={{
                    padding: '3px 10px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    ...getStatusBadgeStyle(run.status),
                  }}
                  data-testid="detail-status-badge"
                >
                  {run.status}
                </span>
                <span
                  style={{
                    padding: '3px 10px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: 700,
                    backgroundColor: '#e0e7ff',
                    color: '#3730a3',
                    border: '1px solid #c7d2fe',
                  }}
                >
                  {run.module.toUpperCase()}
                </span>
              </div>
              <p style={{ fontSize: '12px', color: '#64748b', fontFamily: 'monospace', margin: '4px 0 0 0' }}>
                UUID: {run.id}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="cs-btn cs-btn-secondary"
              onClick={loadRunData}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              data-testid="refresh-run-btn"
            >
              🔄 Refresh
            </button>
            <button
              type="button"
              className="cs-btn cs-btn-primary"
              onClick={() => setIsEditDrawerOpen(true)}
              disabled={!canEdit}
              style={{
                padding: '8px 18px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: canEdit ? '#2563eb' : '#94a3b8',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: canEdit ? 'pointer' : 'not-allowed',
              }}
              data-testid="open-edit-drawer-btn"
            >
              ✏️ Edit Run
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Primary Attributes & Audit Metadata Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', marginBottom: '24px' }}>
        {/* Primary Attributes Card (AC 1) */}
        <div
          className="cs-card"
          style={{
            padding: '20px',
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
          data-testid="primary-attributes-panel"
        >
          <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
            Primary Run Execution Metrics
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <span style={{ fontSize: '12px', color: '#64748b' }}>Records In:</span>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>{run.recordsIn.toLocaleString()}</div>
            </div>
            <div>
              <span style={{ fontSize: '12px', color: '#64748b' }}>Records Out:</span>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#16a34a' }}>{run.recordsOut.toLocaleString()}</div>
            </div>
            <div>
              <span style={{ fontSize: '12px', color: '#64748b' }}>Records Rejected:</span>
              <div style={{ fontSize: '20px', fontWeight: 800, color: run.recordsRejected > 0 ? '#dc2626' : '#64748b' }}>
                {run.recordsRejected.toLocaleString()}
              </div>
            </div>
            <div>
              <span style={{ fontSize: '12px', color: '#64748b' }}>Throughput / Success:</span>
              <div style={{ fontSize: '20px', fontWeight: 800, color: throughputRate >= 90 ? '#16a34a' : '#d97706' }}>
                {throughputRate}%
              </div>
            </div>
          </div>
          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #f1f5f9', fontSize: '12px', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
            <span>Execution Duration:</span>
            <span style={{ fontWeight: 600, color: '#0f172a' }}>{durationStr}</span>
          </div>
        </div>

        {/* Audit & Golden ID Panel (AC 1) */}
        <div
          className="cs-card"
          style={{
            padding: '20px',
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
          data-testid="audit-metadata-panel"
        >
          <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
            Audit &amp; Golden Identity Metadata
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
            <div>
              <span style={{ fontSize: '12px', color: '#64748b', display: 'block' }}>Golden ID / Master Identity:</span>
              {goldenId ? (
                <span
                  style={{
                    display: 'inline-block',
                    marginTop: '4px',
                    padding: '4px 10px',
                    backgroundColor: '#fef3c7',
                    color: '#92400e',
                    border: '1px solid #fde68a',
                    borderRadius: '6px',
                    fontWeight: 700,
                    fontFamily: 'monospace',
                  }}
                  data-testid="golden-id-badge"
                >
                  🏅 {goldenId}
                </span>
              ) : (
                <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '12px' }}>
                  No explicit Golden ID assigned (Derived from Batch ID)
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <span style={{ fontSize: '12px', color: '#64748b', display: 'block' }}>Created At:</span>
                <span style={{ fontSize: '12px', color: '#0f172a', fontWeight: 500 }} data-testid="created-at-field">
                  {new Date(run.createdAt).toLocaleString()}
                </span>
              </div>
              <div>
                <span style={{ fontSize: '12px', color: '#64748b', display: 'block' }}>Last Updated:</span>
                <span style={{ fontSize: '12px', color: '#0f172a', fontWeight: 500 }} data-testid="updated-at-field">
                  {new Date(run.updatedAt).toLocaleString()}
                </span>
              </div>
            </div>
            {operatorNotes && (
              <div style={{ marginTop: '4px', padding: '8px 12px', backgroundColor: '#f8fafc', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600 }}>Operator Notes:</span>
                <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#334155' }}>{operatorNotes}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Linked Entity Sub-Tables (AC 3) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* Sub-Table 1: Related Step Runs for Batch */}
        <div
          className="cs-card"
          style={{
            padding: '20px',
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
          }}
          data-testid="linked-step-runs-section"
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', margin: 0 }}>
              Batch Pipeline Steps ({relatedRuns.length})
            </h3>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              Batch: <strong style={{ fontFamily: 'monospace' }}>{run.batchId}</strong>
            </span>
          </div>
          {relatedRuns.length === 0 ? (
            <p style={{ fontSize: '13px', color: '#64748b', fontStyle: 'italic' }}>No additional pipeline steps recorded for this batch.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#475569', textAlign: 'left' }}>
                    <th style={{ padding: '8px 12px' }}>Step</th>
                    <th style={{ padding: '8px 12px' }}>Status</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right' }}>In</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right' }}>Out</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right' }}>Rejected</th>
                    <th style={{ padding: '8px 12px' }}>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {relatedRuns.map((r) => (
                    <tr
                      key={r.id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        backgroundColor: r.id === run.id ? '#f0fdf4' : 'transparent',
                      }}
                      data-testid={`linked-run-row-${r.step}`}
                    >
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                        {r.step.toUpperCase()} {r.id === run.id && <span style={{ fontSize: '11px', color: '#16a34a' }}>(Current)</span>}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: '10px',
                            fontSize: '11px',
                            fontWeight: 600,
                            ...getStatusBadgeStyle(r.status),
                          }}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{r.recordsIn.toLocaleString()}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{r.recordsOut.toLocaleString()}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: r.recordsRejected > 0 ? '#dc2626' : 'inherit' }}>
                        {r.recordsRejected.toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#64748b' }}>{new Date(r.startedAt).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Sub-Table 2: Quality Score Metrics for Batch */}
        {relatedScore && (
          <div
            className="cs-card"
            style={{
              padding: '20px',
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
            }}
            data-testid="linked-quality-scores-section"
          >
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', margin: '0 0 14px 0' }}>
              Data Quality Scores (Batch {relatedScore.batchId})
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
              <div style={{ padding: '12px', backgroundColor: '#f8fafc', borderRadius: '6px', textAlign: 'center' }}>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Overall Score</span>
                <span style={{ fontSize: '22px', fontWeight: 800, color: '#2563eb' }}>{relatedScore.score ?? '—'}%</span>
              </div>
              <div style={{ padding: '12px', backgroundColor: '#f8fafc', borderRadius: '6px', textAlign: 'center' }}>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Completeness</span>
                <span style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                  {relatedScore.completeness != null ? `${Math.round(relatedScore.completeness * 100)}%` : '—'}
                </span>
              </div>
              <div style={{ padding: '12px', backgroundColor: '#f8fafc', borderRadius: '6px', textAlign: 'center' }}>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Validity</span>
                <span style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                  {relatedScore.validity != null ? `${Math.round(relatedScore.validity * 100)}%` : '—'}
                </span>
              </div>
              <div style={{ padding: '12px', backgroundColor: '#f8fafc', borderRadius: '6px', textAlign: 'center' }}>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Duplicate Rate</span>
                <span style={{ fontSize: '18px', fontWeight: 700, color: relatedScore.duplicateRate ? '#dc2626' : '#16a34a' }}>
                  {relatedScore.duplicateRate != null ? `${(relatedScore.duplicateRate * 100).toFixed(1)}%` : '0%'}
                </span>
              </div>
              <div style={{ padding: '12px', backgroundColor: '#f8fafc', borderRadius: '6px', textAlign: 'center' }}>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Link Integrity</span>
                <span style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                  {relatedScore.linkIntegrity != null ? `${Math.round(relatedScore.linkIntegrity * 100)}%` : '—'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Sub-Table 3: Related Rejection Records */}
        {relatedRejects.length > 0 && (
          <div
            className="cs-card"
            style={{
              padding: '20px',
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
            }}
            data-testid="linked-rejects-section"
          >
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', margin: '0 0 14px 0' }}>
              Migration Rejection Records ({relatedRejects.length})
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#475569', textAlign: 'left' }}>
                    <th style={{ padding: '8px 12px', width: '80px' }}>Row #</th>
                    <th style={{ padding: '8px 12px', width: '140px' }}>Error Code</th>
                    <th style={{ padding: '8px 12px' }}>Reason / Failure Message</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', width: '100px' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {relatedRejects.map((rej) => (
                    <tr key={rej.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{rej.rowIndex}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: '#dc2626' }}>{rej.errorCode}</td>
                      <td style={{ padding: '10px 12px', color: '#475569' }}>{rej.errorMessage}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => setSelectedReject(rej)}
                          style={{
                            padding: '4px 10px',
                            fontSize: '12px',
                            borderRadius: '4px',
                            border: '1px solid #cbd5e1',
                            backgroundColor: '#ffffff',
                            cursor: 'pointer',
                          }}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Sub-Table 4: Owning Module Master Records & Deep Links (AC 3) */}
        <div
          className="cs-card"
          style={{
            padding: '20px',
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
          }}
          data-testid="linked-master-records-section"
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                Owning Module Master Records ({run.module.toUpperCase()})
              </h3>
              <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0 0' }}>
                Navigation deep links to target entity records owned by module {run.module}.
              </p>
            </div>
            <span
              style={{
                padding: '4px 10px',
                backgroundColor: '#e0e7ff',
                color: '#3730a3',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              Target Domain: {run.module}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            {run.module === 'crm-1' && (
              <div style={{ padding: '14px', border: '1px solid #e2e8f0', borderRadius: '6px', backgroundColor: '#f8fafc' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: '6px' }}>
                  CRM-1: Customer Contacts
                </span>
                <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 10px 0' }}>
                  Inspect migrated contact entities and deduplication history in CRM-1.
                </p>
                <button
                  type="button"
                  className="cs-btn cs-btn-secondary"
                  onClick={() => onNavigateModule?.('crm-1')}
                  style={{ padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
                  data-testid="nav-crm1-btn"
                >
                  🔗 Navigate to CRM-1 Contacts →
                </button>
              </div>
            )}

            {run.module === 'crm-2' && (
              <div style={{ padding: '14px', border: '1px solid #e2e8f0', borderRadius: '6px', backgroundColor: '#f8fafc' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: '6px' }}>
                  CRM-2: Deals &amp; Commercial Quotes
                </span>
                <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 10px 0' }}>
                  Inspect migrated sales opportunities and linked quotes in CRM-2.
                </p>
                <button
                  type="button"
                  className="cs-btn cs-btn-secondary"
                  onClick={() => onNavigateModule?.('crm-2')}
                  style={{ padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
                  data-testid="nav-crm2-btn"
                >
                  🔗 Navigate to CRM-2 Deals →
                </button>
              </div>
            )}

            {run.module === 'crm-3' && (
              <div style={{ padding: '14px', border: '1px solid #e2e8f0', borderRadius: '6px', backgroundColor: '#f8fafc' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: '6px' }}>
                  CRM-3: Support Tickets
                </span>
                <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 10px 0' }}>
                  Inspect migrated customer service tickets and SLA compliance in CRM-3.
                </p>
                <button
                  type="button"
                  className="cs-btn cs-btn-secondary"
                  onClick={() => onNavigateModule?.('crm-3')}
                  style={{ padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
                  data-testid="nav-crm3-btn"
                >
                  🔗 Navigate to CRM-3 Tickets →
                </button>
              </div>
            )}

            {run.module === 'crm-4' && (
              <div style={{ padding: '14px', border: '1px solid #e2e8f0', borderRadius: '6px', backgroundColor: '#f8fafc' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: '6px' }}>
                  CRM-4: Marketing Campaigns
                </span>
                <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 10px 0' }}>
                  Inspect migrated marketing lists and campaign memberships in CRM-4.
                </p>
                <button
                  type="button"
                  className="cs-btn cs-btn-secondary"
                  onClick={() => onNavigateModule?.('crm-4')}
                  style={{ padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
                  data-testid="nav-crm4-btn"
                >
                  🔗 Navigate to CRM-4 Campaigns →
                </button>
              </div>
            )}

            {run.module === 'crm-5' && (
              <div style={{ padding: '14px', border: '1px solid #e2e8f0', borderRadius: '6px', backgroundColor: '#f8fafc' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: '6px' }}>
                  CRM-5: Control Center Reports
                </span>
                <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 10px 0' }}>
                  Inspect master reconciliation balance sheets and quality scores.
                </p>
                <button
                  type="button"
                  className="cs-btn cs-btn-secondary"
                  onClick={() => onNavigateModule?.('crm-5')}
                  style={{ padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
                  data-testid="nav-crm5-btn"
                >
                  🔗 Navigate to Control Center →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Inline Edit Drawer Dialog */}
      <EditRunDrawer
        isOpen={isEditDrawerOpen}
        run={run}
        onClose={() => setIsEditDrawerOpen(false)}
        onSave={handleSaveRun}
        onRefreshAndReapply={handleRefreshAndReapply}
        canEdit={canEdit}
        userRole={userRole}
      />

      {/* Rejection Detail Modal */}
      {selectedReject && (
        <RejectDetailModal
          isOpen={Boolean(selectedReject)}
          reject={selectedReject}
          onClose={() => setSelectedReject(null)}
        />
      )}
    </div>
  );
};
