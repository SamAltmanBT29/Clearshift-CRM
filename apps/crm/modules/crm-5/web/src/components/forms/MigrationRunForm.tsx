import React, { useState, useId, useMemo } from 'react';
import type {
  CrmModule,
  MigrationStep,
  MigrationRunStatus,
  MigrationRun,
  CreateRunInput,
  UpdateRunInput,
} from '@clearshift/contracts';
import { getAllowedNextStates } from '../../../../src/domain/transitions.js';
import { FormValidationSummary } from './FormValidationSummary.js';

export interface FormFieldErrors {
  batchId?: string | undefined;
  module?: string | undefined;
  step?: string | undefined;
  status?: string | undefined;
  recordsIn?: string | undefined;
  recordsOut?: string | undefined;
  recordsRejected?: string | undefined;
}

export interface MigrationRunFormProps {
  initialValues?: Partial<MigrationRun> | undefined;
  isEdit?: boolean | undefined;
  onSubmit: (values: CreateRunInput | UpdateRunInput) => Promise<void>;
  onCancel?: (() => void) | undefined;
  isSubmitting?: boolean | undefined;
  apiError?: string | null | undefined;
  apiFieldErrors?: FormFieldErrors | null | undefined;
}

export const MODULE_OPTIONS: CrmModule[] = ['crm-1', 'crm-2', 'crm-3', 'crm-4', 'crm-5'];
export const STEP_OPTIONS: MigrationStep[] = [
  'extract',
  'profile',
  'clean',
  'map',
  'load',
  'validate',
  'reconcile',
];
export const ALL_STATUS_OPTIONS: MigrationRunStatus[] = [
  'pending',
  'running',
  'completed',
  'failed',
  'halted',
];

/**
 * MigrationRunForm
 * Create & Edit form for Migration Run Projections.
 * Provides client-side validation, authoritative server-aligned error handling,
 * invariant assertion (recordsOut + recordsRejected <= recordsIn), and read-only field guards.
 */
export const MigrationRunForm: React.FC<MigrationRunFormProps> = ({
  initialValues = {},
  isEdit = false,
  onSubmit,
  onCancel,
  isSubmitting = false,
  apiError = null,
  apiFieldErrors = null,
}) => {
  // Field IDs for accessibility
  const batchIdId = useId();
  const moduleId = useId();
  const stepId = useId();
  const statusId = useId();
  const recordsInId = useId();
  const recordsOutId = useId();
  const recordsRejectedId = useId();

  // Form field state
  const [batchId, setBatchId] = useState<string>(initialValues.batchId ?? '');
  const [module, setModule] = useState<CrmModule>(initialValues.module ?? 'crm-1');
  const [step, setStep] = useState<MigrationStep>(initialValues.step ?? 'extract');
  const [status, setStatus] = useState<MigrationRunStatus>(initialValues.status ?? 'pending');
  const [recordsIn, setRecordsIn] = useState<string>(
    initialValues.recordsIn !== undefined ? String(initialValues.recordsIn) : '0'
  );
  const [recordsOut, setRecordsOut] = useState<string>(
    initialValues.recordsOut !== undefined ? String(initialValues.recordsOut) : '0'
  );
  const [recordsRejected, setRecordsRejected] = useState<string>(
    initialValues.recordsRejected !== undefined ? String(initialValues.recordsRejected) : '0'
  );

  // Client validation error state
  const [clientErrors, setClientErrors] = useState<FormFieldErrors>({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState<boolean>(false);

  // Status options calculation (in edit mode, enforce valid state transitions)
  const availableStatusOptions = useMemo<MigrationRunStatus[]>(() => {
    if (!isEdit || !initialValues.status) {
      return ALL_STATUS_OPTIONS;
    }
    const current = initialValues.status;
    const allowed = getAllowedNextStates(current);
    return [current, ...allowed.filter((s) => s !== current)];
  }, [isEdit, initialValues.status]);

  // Derived calculations (server-computed read-only representation)
  const numIn = parseInt(recordsIn, 10) || 0;
  const numOut = parseInt(recordsOut, 10) || 0;
  const numRejected = parseInt(recordsRejected, 10) || 0;
  const totalProcessed = numOut + numRejected;
  const completionPercentage =
    numIn > 0 ? Math.min(100, Math.round((totalProcessed / numIn) * 100)) : 0;

  // Validate fields strictly adhering to domain invariants
  const validate = (): boolean => {
    const errors: FormFieldErrors = {};

    if (!batchId || !batchId.trim()) {
      errors.batchId = 'batchId is required';
    } else if (batchId.trim().length > 128) {
      errors.batchId = 'batchId cannot exceed 128 characters';
    }

    if (!module) {
      errors.module = 'Module is required';
    }

    if (!step) {
      errors.step = 'Step is required';
    }

    if (!status) {
      errors.status = 'Status is required';
    }

    const inVal = Number(recordsIn);
    if (isNaN(inVal) || !Number.isInteger(inVal)) {
      errors.recordsIn = 'Records In must be an integer';
    } else if (inVal < 0) {
      errors.recordsIn = 'recordsIn cannot be negative';
    }

    const outVal = Number(recordsOut);
    if (isNaN(outVal) || !Number.isInteger(outVal)) {
      errors.recordsOut = 'Records Out must be an integer';
    } else if (outVal < 0) {
      errors.recordsOut = 'recordsOut cannot be negative';
    }

    const rejVal = Number(recordsRejected);
    if (isNaN(rejVal) || !Number.isInteger(rejVal)) {
      errors.recordsRejected = 'Records Rejected must be an integer';
    } else if (rejVal < 0) {
      errors.recordsRejected = 'recordsRejected cannot be negative';
    }

    // Invariant: sum of recordsOut and recordsRejected cannot exceed recordsIn
    if (!errors.recordsIn && !errors.recordsOut && !errors.recordsRejected) {
      if (outVal + rejVal > inVal) {
        errors.recordsOut =
          'Invariant violation: sum of recordsOut and recordsRejected cannot exceed recordsIn';
      }
    }

    setClientErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e?: React.SyntheticEvent) => {
    if (e) {
      e.preventDefault();
    }
    setHasAttemptedSubmit(true);

    if (!validate()) {
      return;
    }

    const inVal = parseInt(recordsIn, 10);
    const outVal = parseInt(recordsOut, 10);
    const rejVal = parseInt(recordsRejected, 10);

    if (isEdit) {
      const payload: UpdateRunInput = {
        status,
        recordsIn: inVal,
        recordsOut: outVal,
        recordsRejected: rejVal,
      };
      await onSubmit(payload);
    } else {
      const payload: CreateRunInput = {
        batchId: batchId.trim(),
        module,
        step,
        status,
        recordsIn: inVal,
        recordsOut: outVal,
        recordsRejected: rejVal,
      };
      await onSubmit(payload);
    }
  };

  // Combine client and server errors for summary and field-level feedback
  const combinedErrors: FormFieldErrors = {
    ...clientErrors,
    ...(apiFieldErrors ?? {}),
  };

  return (
    <div className="cs-form-card" style={{ background: '#ffffff', borderRadius: '12px', padding: '24px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
      <form className="cs-form" onSubmit={handleSubmit} noValidate>
        {/* Error Summary Banner */}
        {(Boolean(apiError) || (Object.keys(combinedErrors).length > 0 && hasAttemptedSubmit)) && (
          <FormValidationSummary
            title={apiError ?? 'Validation errors prevented submission:'}
            errors={combinedErrors}
          />
        )}

        {/* Section 1: Batch Identification */}
        <div className="cs-form-section" style={{ marginBottom: '24px' }}>
          <h3 className="cs-form-section-title" style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', marginBottom: '16px' }}>Batch Identification & Lifecycle</h3>
          <div className="cs-form-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            {/* Batch ID */}
            <div className="cs-field-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor={batchIdId} className="cs-field-label" style={{ fontSize: '13px', fontWeight: 500, color: '#334155' }}>
                Batch Correlation ID
                <span className="cs-field-required" style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>
              </label>
              <input
                id={batchIdId}
                type="text"
                className={`cs-input ${combinedErrors.batchId ? 'cs-input-error' : ''} ${
                  isEdit ? 'cs-input-disabled' : ''
                }`}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: combinedErrors.batchId ? '1px solid #ef4444' : '1px solid #cbd5e1',
                  background: isEdit ? '#f8fafc' : '#ffffff',
                  fontSize: '14px',
                }}
                value={batchId}
                onChange={(e) => {
                  setBatchId(e.target.value);
                  if (hasAttemptedSubmit) validate();
                }}
                disabled={isEdit}
                readOnly={isEdit}
                aria-required="true"
                aria-invalid={!!combinedErrors.batchId}
                aria-describedby={
                  combinedErrors.batchId ? `${batchIdId}-error` : `${batchIdId}-helper`
                }
                placeholder="e.g. batch-crm-1-20261020-001"
              />
              {combinedErrors.batchId ? (
                <span id={`${batchIdId}-error`} className="cs-field-error" role="alert" style={{ fontSize: '12px', color: '#ef4444' }}>
                  ❌ {combinedErrors.batchId}
                </span>
              ) : (
                <span id={`${batchIdId}-helper`} className="cs-field-helper" style={{ fontSize: '12px', color: '#64748b' }}>
                  {isEdit
                    ? 'Batch correlation is permanently locked after registration.'
                    : 'Correlates runs, scores, rejects, and reconciliation.'}
                </span>
              )}
            </div>

            {/* Target CRM Module */}
            <div className="cs-field-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor={moduleId} className="cs-field-label" style={{ fontSize: '13px', fontWeight: 500, color: '#334155' }}>
                Target CRM Module
                <span className="cs-field-required" style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>
              </label>
              <select
                id={moduleId}
                className={`cs-input ${combinedErrors.module ? 'cs-input-error' : ''} ${
                  isEdit ? 'cs-input-disabled' : ''
                }`}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: combinedErrors.module ? '1px solid #ef4444' : '1px solid #cbd5e1',
                  background: isEdit ? '#f8fafc' : '#ffffff',
                  fontSize: '14px',
                }}
                value={module}
                onChange={(e) => {
                  setModule(e.target.value as CrmModule);
                  if (hasAttemptedSubmit) validate();
                }}
                disabled={isEdit}
                aria-required="true"
                aria-invalid={!!combinedErrors.module}
              >
                {MODULE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m.toUpperCase()}
                  </option>
                ))}
              </select>
              {combinedErrors.module && (
                <span id={`${moduleId}-error`} className="cs-field-error" role="alert" style={{ fontSize: '12px', color: '#ef4444' }}>
                  ❌ {combinedErrors.module}
                </span>
              )}
            </div>

            {/* Migration Step */}
            <div className="cs-field-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor={stepId} className="cs-field-label" style={{ fontSize: '13px', fontWeight: 500, color: '#334155' }}>
                Migration Lifecycle Step
                <span className="cs-field-required" style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>
              </label>
              <select
                id={stepId}
                className={`cs-input ${combinedErrors.step ? 'cs-input-error' : ''} ${
                  isEdit ? 'cs-input-disabled' : ''
                }`}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: combinedErrors.step ? '1px solid #ef4444' : '1px solid #cbd5e1',
                  background: isEdit ? '#f8fafc' : '#ffffff',
                  fontSize: '14px',
                }}
                value={step}
                onChange={(e) => {
                  setStep(e.target.value as MigrationStep);
                  if (hasAttemptedSubmit) validate();
                }}
                disabled={isEdit}
                aria-required="true"
                aria-invalid={!!combinedErrors.step}
              >
                {STEP_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s.toUpperCase()}
                  </option>
                ))}
              </select>
              {combinedErrors.step && (
                <span id={`${stepId}-error`} className="cs-field-error" role="alert" style={{ fontSize: '12px', color: '#ef4444' }}>
                  ❌ {combinedErrors.step}
                </span>
              )}
            </div>

            {/* Execution Status */}
            <div className="cs-field-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor={statusId} className="cs-field-label" style={{ fontSize: '13px', fontWeight: 500, color: '#334155' }}>
                Execution Status
                <span className="cs-field-required" style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>
              </label>
              <select
                id={statusId}
                className={`cs-input ${combinedErrors.status ? 'cs-input-error' : ''}`}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: combinedErrors.status ? '1px solid #ef4444' : '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: '14px',
                }}
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as MigrationRunStatus);
                  if (hasAttemptedSubmit) validate();
                }}
                aria-required="true"
                aria-invalid={!!combinedErrors.status}
              >
                {availableStatusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s.toUpperCase()}
                  </option>
                ))}
              </select>
              {combinedErrors.status ? (
                <span id={`${statusId}-error`} className="cs-field-error" role="alert" style={{ fontSize: '12px', color: '#ef4444' }}>
                  ❌ {combinedErrors.status}
                </span>
              ) : (
                <span className="cs-field-helper" style={{ fontSize: '12px', color: '#64748b' }}>
                  {isEdit
                    ? 'Only valid state transitions according to the state machine are permitted.'
                    : 'Initial lifecycle execution state.'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Section 2: Record Telemetry & Conservation Counts */}
        <div className="cs-form-section" style={{ marginBottom: '24px' }}>
          <h3 className="cs-form-section-title" style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', marginBottom: '16px' }}>Record Telemetry & Conservation</h3>
          <div className="cs-form-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
            {/* Records In */}
            <div className="cs-field-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor={recordsInId} className="cs-field-label" style={{ fontSize: '13px', fontWeight: 500, color: '#334155' }}>
                Records In
                <span className="cs-field-required" style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>
              </label>
              <input
                id={recordsInId}
                type="number"
                min="0"
                step="1"
                className={`cs-input ${combinedErrors.recordsIn ? 'cs-input-error' : ''}`}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: combinedErrors.recordsIn ? '1px solid #ef4444' : '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: '14px',
                }}
                value={recordsIn}
                onChange={(e) => {
                  setRecordsIn(e.target.value);
                  if (hasAttemptedSubmit) validate();
                }}
                aria-required="true"
                aria-invalid={!!combinedErrors.recordsIn}
                aria-describedby={
                  combinedErrors.recordsIn ? `${recordsInId}-error` : `${recordsInId}-helper`
                }
              />
              {combinedErrors.recordsIn ? (
                <span id={`${recordsInId}-error`} className="cs-field-error" role="alert" style={{ fontSize: '12px', color: '#ef4444' }}>
                  ❌ {combinedErrors.recordsIn}
                </span>
              ) : (
                <span id={`${recordsInId}-helper`} className="cs-field-helper" style={{ fontSize: '12px', color: '#64748b' }}>
                  Total records presented to this step (≥ 0).
                </span>
              )}
            </div>

            {/* Records Out */}
            <div className="cs-field-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor={recordsOutId} className="cs-field-label" style={{ fontSize: '13px', fontWeight: 500, color: '#334155' }}>
                Records Out
                <span className="cs-field-required" style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>
              </label>
              <input
                id={recordsOutId}
                type="number"
                min="0"
                step="1"
                className={`cs-input ${combinedErrors.recordsOut ? 'cs-input-error' : ''}`}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: combinedErrors.recordsOut ? '1px solid #ef4444' : '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: '14px',
                }}
                value={recordsOut}
                onChange={(e) => {
                  setRecordsOut(e.target.value);
                  if (hasAttemptedSubmit) validate();
                }}
                aria-required="true"
                aria-invalid={!!combinedErrors.recordsOut}
                aria-describedby={
                  combinedErrors.recordsOut ? `${recordsOutId}-error` : `${recordsOutId}-helper`
                }
              />
              {combinedErrors.recordsOut ? (
                <span id={`${recordsOutId}-error`} className="cs-field-error" role="alert" style={{ fontSize: '12px', color: '#ef4444' }}>
                  ❌ {combinedErrors.recordsOut}
                </span>
              ) : (
                <span id={`${recordsOutId}-helper`} className="cs-field-helper" style={{ fontSize: '12px', color: '#64748b' }}>
                  Successfully processed records.
                </span>
              )}
            </div>

            {/* Records Rejected */}
            <div className="cs-field-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor={recordsRejectedId} className="cs-field-label" style={{ fontSize: '13px', fontWeight: 500, color: '#334155' }}>
                Records Rejected
                <span className="cs-field-required" style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>
              </label>
              <input
                id={recordsRejectedId}
                type="number"
                min="0"
                step="1"
                className={`cs-input ${combinedErrors.recordsRejected ? 'cs-input-error' : ''}`}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: combinedErrors.recordsRejected ? '1px solid #ef4444' : '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: '14px',
                }}
                value={recordsRejected}
                onChange={(e) => {
                  setRecordsRejected(e.target.value);
                  if (hasAttemptedSubmit) validate();
                }}
                aria-required="true"
                aria-invalid={!!combinedErrors.recordsRejected}
                aria-describedby={
                  combinedErrors.recordsRejected
                    ? `${recordsRejectedId}-error`
                    : `${recordsRejectedId}-helper`
                }
              />
              {combinedErrors.recordsRejected ? (
                <span id={`${recordsRejectedId}-error`} className="cs-field-error" role="alert" style={{ fontSize: '12px', color: '#ef4444' }}>
                  ❌ {combinedErrors.recordsRejected}
                </span>
              ) : (
                <span id={`${recordsRejectedId}-helper`} className="cs-field-helper" style={{ fontSize: '12px', color: '#64748b' }}>
                  Validation rejected rows.
                </span>
              )}
            </div>
          </div>

          {/* Server-Computed Derived Totals (Read-Only) */}
          <div className="cs-prop-row" style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#475569' }}>
            <span className="cs-prop-label" style={{ fontWeight: 500 }}>
              Derived Processing Progress:
              <span className="cs-readonly-badge" style={{ marginLeft: '6px', padding: '2px 6px', background: '#e2e8f0', borderRadius: '4px', fontSize: '11px', fontWeight: 600, color: '#475569' }}>Server Computed</span>
            </span>
            <span className="cs-prop-value" style={{ fontWeight: 600, color: '#0f172a' }}>
              {totalProcessed.toLocaleString()} / {numIn.toLocaleString()} records ({completionPercentage}%)
            </span>
          </div>
        </div>

        {/* Read-Only Server Identifiers (Edit Mode) */}
        {isEdit && initialValues.id && (
          <div className="cs-form-section" style={{ marginBottom: '24px', padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <h3 className="cs-form-section-title" style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', margin: '0 0 12px 0' }}>
              System Audit Metadata
              <span className="cs-readonly-badge" style={{ marginLeft: '6px', padding: '2px 6px', background: '#e2e8f0', borderRadius: '4px', fontSize: '11px', fontWeight: 600, color: '#475569' }}>Read-Only</span>
            </h3>
            <div className="cs-prop-list" style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
              <div className="cs-prop-row" style={{ display: 'flex', gap: '8px' }}>
                <span className="cs-prop-label" style={{ color: '#64748b', minWidth: '120px' }}>Projection UUID:</span>
                <span className="cs-code-inline" style={{ fontFamily: 'monospace', color: '#0f172a' }}>{initialValues.id}</span>
              </div>
              <div className="cs-prop-row" style={{ display: 'flex', gap: '8px' }}>
                <span className="cs-prop-label" style={{ color: '#64748b', minWidth: '120px' }}>Created At:</span>
                <span className="cs-prop-value" style={{ color: '#0f172a' }}>
                  {initialValues.createdAt ? new Date(initialValues.createdAt).toISOString() : '—'}
                </span>
              </div>
              <div className="cs-prop-row" style={{ display: 'flex', gap: '8px' }}>
                <span className="cs-prop-label" style={{ color: '#64748b', minWidth: '120px' }}>Last Updated:</span>
                <span className="cs-prop-value" style={{ color: '#0f172a' }}>
                  {initialValues.updatedAt ? new Date(initialValues.updatedAt).toISOString() : '—'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="cs-form-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
          {onCancel && (
            <button
              type="button"
              className="cs-btn cs-btn-secondary"
              onClick={onCancel}
              disabled={isSubmitting}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#334155',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            className="cs-btn cs-btn-primary"
            disabled={isSubmitting}
            onClick={handleSubmit}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              background: '#2563eb',
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {isSubmitting
              ? 'Saving...'
              : isEdit
              ? 'Save Telemetry Updates'
              : 'Record Migration Run'}
          </button>
        </div>
      </form>
    </div>
  );
};
