import React, { useState, useEffect, useId } from 'react';
import type { MigrationRun, MigrationRunStatus, UpdateRunInput } from '@clearshift/contracts';
import { assertValidTransition } from '../../src/domain/transitions.js';
import { Crm5ApiError } from '../api/crm-5.js';

export interface EditRunDrawerProps {
  isOpen: boolean;
  run: MigrationRun | null;
  onClose: () => void;
  onSave: (runId: string, input: UpdateRunInput) => Promise<MigrationRun>;
  onRefreshAndReapply?: () => Promise<void> | void;
  canEdit?: boolean;
  userRole?: string;
}

export const EditRunDrawer: React.FC<EditRunDrawerProps> = ({
  isOpen,
  run,
  onClose,
  onSave,
  onRefreshAndReapply,
  canEdit = true,
  userRole = 'migration_runner',
}) => {
  const [status, setStatus] = useState<MigrationRunStatus>('pending');
  const [recordsIn, setRecordsIn] = useState<number>(0);
  const [recordsOut, setRecordsOut] = useState<number>(0);
  const [recordsRejected, setRecordsRejected] = useState<number>(0);
  const [operatorNotes, setOperatorNotes] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const statusId = useId();
  const recordsInId = useId();
  const recordsOutId = useId();
  const recordsRejectedId = useId();
  const notesId = useId();

  // Synchronize form when a run is selected
  useEffect(() => {
    if (run) {
      setStatus(run.status);
      setRecordsIn(run.recordsIn);
      setRecordsOut(run.recordsOut);
      setRecordsRejected(run.recordsRejected);
      const notes = (run.metadata?.['operatorNotes'] as string) ?? '';
      setOperatorNotes(notes);
      setFormError(null);
      setConflictError(null);
    }
  }, [run]);

  if (!isOpen || !run) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      setFormError('Access Denied: Insufficient permissions to update migration runs.');
      return;
    }

    setFormError(null);
    setConflictError(null);

    // Validate state transition if status changed
    if (status !== run.status) {
      try {
        assertValidTransition(run.status, status);
      } catch (err: any) {
        setFormError(err.message || 'Illegal state transition.');
        return;
      }
    }

    if (recordsIn < 0 || recordsOut < 0 || recordsRejected < 0) {
      setFormError('Record counts cannot be negative.');
      return;
    }

    const payload: UpdateRunInput = {
      status,
      recordsIn,
      recordsOut,
      recordsRejected,
      expectedUpdatedAt: run.updatedAt,
      metadata: {
        ...(run.metadata ?? {}),
        operatorNotes,
        lastEditedBy: userRole,
      },
    };

    setIsSaving(true);
    try {
      await onSave(run.id, payload);
      onClose();
    } catch (err: any) {
      if (err instanceof Crm5ApiError && (err.statusCode === 409 || err.code === 'CONCURRENT_MODIFICATION' || err.code === 'CONFLICT')) {
        setConflictError(
          err.message ||
            'Concurrent modification conflict: this run projection was updated concurrently by another operator. Please refresh to load the latest state before re-applying.'
        );
      } else {
        setFormError(err.message || 'Failed to update migration run.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleRefreshAndReapply = async () => {
    if (!onRefreshAndReapply) return;
    setIsRefreshing(true);
    try {
      await onRefreshAndReapply();
      setConflictError(null);
      setFormError(null);
    } catch (err: any) {
      setFormError(err.message || 'Failed to refresh record.');
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div
      className="cs-drawer-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.6)',
        display: 'flex',
        justifyContent: 'flex-end',
        zIndex: 9999,
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-run-drawer-title"
    >
      <div
        className="cs-drawer-container"
        style={{
          width: '100%',
          maxWidth: '540px',
          backgroundColor: '#ffffff',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.15)',
        }}
      >
        {/* Drawer Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#f8fafc',
          }}
        >
          <div>
            <h2 id="edit-run-drawer-title" style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', margin: 0 }}>
              Edit Run Projection
            </h2>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '4px 0 0 0' }}>
              Batch: <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{run.batchId}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20px',
              cursor: 'pointer',
              color: '#64748b',
              padding: '4px 8px',
              borderRadius: '4px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Drawer Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {/* Permission Warning if not authorized */}
          {!canEdit && (
            <div
              className="cs-alert cs-alert-warning"
              style={{
                padding: '12px 16px',
                backgroundColor: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '6px',
                color: '#92400e',
                fontSize: '13px',
                marginBottom: '20px',
              }}
              role="alert"
            >
              ⚠️ <strong>Permission Notice:</strong> Your current role (<code>{userRole}</code>) has read-only access.
              Editing requires <code>migration_runner</code>, <code>editor</code>, or <code>admin</code> role.
            </div>
          )}

          {/* Concurrent Modification Conflict Alert (AC 4 / 409 Conflict) */}
          {conflictError && (
            <div
              className="cs-alert cs-alert-danger cs-conflict-alert"
              style={{
                padding: '14px 18px',
                backgroundColor: '#fef2f2',
                border: '1px solid #fca5a5',
                borderRadius: '6px',
                color: '#991b1b',
                fontSize: '13px',
                marginBottom: '20px',
              }}
              role="alert"
              data-testid="concurrent-conflict-alert"
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>⚠️</span>
                <div>
                  <strong style={{ display: 'block', marginBottom: '4px' }}>Concurrent Modification Conflict (409)</strong>
                  <p style={{ margin: 0, lineHeight: 1.4 }}>{conflictError}</p>
                  {onRefreshAndReapply && (
                    <button
                      type="button"
                      className="cs-btn cs-btn-secondary"
                      onClick={handleRefreshAndReapply}
                      disabled={isRefreshing}
                      style={{
                        marginTop: '10px',
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: 600,
                        backgroundColor: '#991b1b',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                      data-testid="refresh-reapply-btn"
                    >
                      {isRefreshing ? 'Refreshing...' : '🔄 Refresh and Re-apply'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Validation Form Error Alert */}
          {formError && (
            <div
              className="cs-alert cs-alert-danger"
              style={{
                padding: '12px 16px',
                backgroundColor: '#fef2f2',
                border: '1px solid #fca5a5',
                borderRadius: '6px',
                color: '#991b1b',
                fontSize: '13px',
                marginBottom: '20px',
              }}
              role="alert"
            >
              ❌ {formError}
            </div>
          )}

          {/* Read-Only System Metadata Section */}
          <div
            style={{
              padding: '14px 16px',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              marginBottom: '20px',
              fontSize: '12px',
            }}
          >
            <div style={{ fontWeight: 600, color: '#475569', marginBottom: '8px', textTransform: 'uppercase' }}>
              System Metadata (Read-Only)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', color: '#64748b' }}>
              <div>
                <span>Run ID:</span>
                <span style={{ display: 'block', fontFamily: 'monospace', color: '#0f172a' }}>{run.id}</span>
              </div>
              <div>
                <span>Target Module:</span>
                <span style={{ display: 'block', fontWeight: 600, color: '#0f172a' }}>{run.module.toUpperCase()}</span>
              </div>
              <div>
                <span>Pipeline Step:</span>
                <span style={{ display: 'block', fontWeight: 600, color: '#0f172a' }}>{run.step}</span>
              </div>
              <div>
                <span>Recorded At:</span>
                <span style={{ display: 'block', color: '#0f172a' }}>
                  {new Date(run.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Edit Form */}
          <form id="edit-run-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Status Field */}
            <div>
              <label htmlFor={statusId} style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1e293b', marginBottom: '6px' }}>
                Run Status <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <select
                id={statusId}
                value={status}
                onChange={(e) => setStatus(e.target.value as MigrationRunStatus)}
                disabled={!canEdit || isSaving}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px',
                  color: '#0f172a',
                  backgroundColor: canEdit ? '#ffffff' : '#f1f5f9',
                }}
                data-testid="edit-status-select"
              >
                <option value="pending">Pending</option>
                <option value="running">Running</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="halted">Halted</option>
              </select>
            </div>

            {/* Records In */}
            <div>
              <label htmlFor={recordsInId} style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1e293b', marginBottom: '6px' }}>
                Records In (Source Ingested)
              </label>
              <input
                id={recordsInId}
                type="number"
                min="0"
                value={recordsIn}
                onChange={(e) => setRecordsIn(Math.max(0, parseInt(e.target.value || '0', 10)))}
                disabled={!canEdit || isSaving}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px',
                  color: '#0f172a',
                  backgroundColor: canEdit ? '#ffffff' : '#f1f5f9',
                }}
                data-testid="edit-records-in-input"
              />
            </div>

            {/* Records Out */}
            <div>
              <label htmlFor={recordsOutId} style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1e293b', marginBottom: '6px' }}>
                Records Out (Migrated Successfully)
              </label>
              <input
                id={recordsOutId}
                type="number"
                min="0"
                value={recordsOut}
                onChange={(e) => setRecordsOut(Math.max(0, parseInt(e.target.value || '0', 10)))}
                disabled={!canEdit || isSaving}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px',
                  color: '#0f172a',
                  backgroundColor: canEdit ? '#ffffff' : '#f1f5f9',
                }}
                data-testid="edit-records-out-input"
              />
            </div>

            {/* Records Rejected */}
            <div>
              <label htmlFor={recordsRejectedId} style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1e293b', marginBottom: '6px' }}>
                Records Rejected
              </label>
              <input
                id={recordsRejectedId}
                type="number"
                min="0"
                value={recordsRejected}
                onChange={(e) => setRecordsRejected(Math.max(0, parseInt(e.target.value || '0', 10)))}
                disabled={!canEdit || isSaving}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px',
                  color: '#0f172a',
                  backgroundColor: canEdit ? '#ffffff' : '#f1f5f9',
                }}
                data-testid="edit-records-rejected-input"
              />
            </div>

            {/* Operator Notes in Metadata */}
            <div>
              <label htmlFor={notesId} style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1e293b', marginBottom: '6px' }}>
                Operator Audit Notes
              </label>
              <textarea
                id={notesId}
                rows={3}
                value={operatorNotes}
                onChange={(e) => setOperatorNotes(e.target.value)}
                disabled={!canEdit || isSaving}
                placeholder="Document reason for manual intervention, reconciliation findings, or recovery actions..."
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  color: '#0f172a',
                  backgroundColor: canEdit ? '#ffffff' : '#f1f5f9',
                  resize: 'vertical',
                }}
                data-testid="edit-operator-notes-textarea"
              />
            </div>
          </form>
        </div>

        {/* Drawer Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '12px',
            backgroundColor: '#f8fafc',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              color: '#475569',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="edit-run-form"
            disabled={!canEdit || isSaving}
            style={{
              padding: '8px 20px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: canEdit ? '#2563eb' : '#94a3b8',
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: canEdit && !isSaving ? 'pointer' : 'not-allowed',
            }}
            data-testid="save-run-btn"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};
