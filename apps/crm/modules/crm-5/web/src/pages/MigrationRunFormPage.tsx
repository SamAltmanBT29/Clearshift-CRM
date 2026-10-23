import React, { useState, useEffect, useCallback } from 'react';
import type { MigrationRun, CreateRunInput, UpdateRunInput } from '@clearshift/contracts';
import { Crm5ApiClient, Crm5ApiError, crm5Api } from '../api/crm-5.js';
import { MigrationRunForm, type FormFieldErrors } from '../components/forms/MigrationRunForm.js';

export interface MigrationRunFormPageProps {
  mode: 'create' | 'edit';
  runId?: string;
  apiClient?: Crm5ApiClient;
  onBackToList?: () => void;
  onSuccess?: (run: MigrationRun) => void;
}

/**
 * MigrationRunFormPage
 * Dedicated Create / Edit Workflow Page for Migration Run Projections.
 * Links back to list context, integrates MigrationRunForm, and preserves form values
 * across server-side validation error responses.
 */
export const MigrationRunFormPage: React.FC<MigrationRunFormPageProps> = ({
  mode,
  runId,
  apiClient = crm5Api,
  onBackToList,
  onSuccess,
}) => {
  const [initialData, setInitialData] = useState<MigrationRun | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(mode === 'edit');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiFieldErrors, setApiFieldErrors] = useState<FormFieldErrors | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load existing run in edit mode
  const loadExisting = useCallback(async () => {
    if (mode !== 'edit' || !runId) return;
    setIsLoading(true);
    setApiError(null);
    try {
      const existing = await apiClient.getRunById(runId);
      setInitialData(existing);
    } catch (err: unknown) {
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [mode, runId, apiClient]);

  useEffect(() => {
    loadExisting();
  }, [loadExisting]);

  const handleSubmit = async (values: CreateRunInput | UpdateRunInput) => {
    setIsSubmitting(true);
    setApiError(null);
    setApiFieldErrors(null);
    setSuccessMessage(null);

    try {
      let savedRun: MigrationRun;
      if (mode === 'edit' && runId) {
        savedRun = await apiClient.patchRun(runId, values as UpdateRunInput);
        setSuccessMessage(`Migration run for batch '${savedRun.batchId}' successfully updated.`);
      } else {
        savedRun = await apiClient.postRun(values as CreateRunInput);
        setSuccessMessage(`Migration run for batch '${savedRun.batchId}' successfully recorded.`);
      }

      setInitialData(savedRun);
      if (onSuccess) {
        onSuccess(savedRun);
      }
    } catch (err: unknown) {
      if (err instanceof Crm5ApiError) {
        setApiError(err.message);
        if (Array.isArray(err.details)) {
          const fieldMap: Record<string, string> = {};
          for (const d of err.details as Array<{ path?: string[]; message?: string }>) {
            if (d.path && d.path.length > 0 && d.message) {
              fieldMap[d.path.join('.')] = d.message;
            }
          }
          if (Object.keys(fieldMap).length > 0) {
            setApiFieldErrors(fieldMap);
          }
        }
      } else {
        setApiError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="cs-detail-container" role="status" aria-busy="true" style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
        <div className="cs-form-card" style={{ background: '#ffffff', borderRadius: '12px', padding: '24px', border: '1px solid #e2e8f0' }}>
          <div className="cs-skeleton-title" style={{ height: '28px', width: '50%', background: '#e2e8f0', borderRadius: '4px' }} />
          <div
            className="cs-skeleton-row"
            style={{ height: '300px', width: '100%', marginTop: '20px', background: '#f1f5f9', borderRadius: '8px' }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="cs-detail-container" style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
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
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  color: '#2563eb',
                  font: 'inherit',
                }}
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
            <span style={{ fontWeight: 600, color: '#0f172a' }}>{mode === 'edit' ? 'Edit Run Telemetry' : 'New Migration Run'}</span>
          </li>
        </ol>
      </nav>

      {/* Top Header Row with Navigation */}
      <div className="cs-detail-top-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 className="cs-detail-title" style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', margin: '0 0 4px 0' }}>
            {mode === 'edit'
              ? `Edit Run: ${initialData?.batchId ?? runId}`
              : 'Record Migration Run Projection'}
          </h1>
          <p className="cs-field-helper" style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>
            {mode === 'edit'
              ? 'Update execution status, records processed, or run completion metadata.'
              : 'Manually register or project a Migration Kit batch execution into CRM-5.'}
          </p>
        </div>

        {onBackToList && (
          <button
            type="button"
            className="cs-btn cs-btn-secondary"
            onClick={onBackToList}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#334155',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            ← Back to Runs List
          </button>
        )}
      </div>

      {/* Success Banner */}
      {successMessage && (
        <div
          className="cs-alert-card cs-alert-ok"
          role="status"
          style={{
            backgroundColor: '#dcfce7',
            border: '1px solid #166534',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <span className="cs-alert-icon" aria-hidden="true" style={{ fontSize: '20px' }}>
            ✅
          </span>
          <div className="cs-alert-content">
            <h2 className="cs-alert-title" style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#166534' }}>
              Success
            </h2>
            <p className="cs-alert-desc" style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#166534' }}>
              {successMessage}
            </p>
          </div>
        </div>
      )}

      {/* Form Component */}
      <MigrationRunForm
        initialValues={initialData ?? undefined}
        isEdit={mode === 'edit'}
        onSubmit={handleSubmit}
        onCancel={onBackToList}
        isSubmitting={isSubmitting}
        apiError={apiError}
        apiFieldErrors={apiFieldErrors}
      />
    </div>
  );
};
