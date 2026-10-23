import React, { useState, useId, useMemo } from 'react';
import { z } from 'zod';
import type {
  CrmModule,
  MigrationStep,
  MigrationRunStatus,
} from '@clearshift/contracts';
import { FormValidationSummary } from './FormValidationSummary.js';

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
export const STATUS_OPTIONS: MigrationRunStatus[] = [
  'pending',
  'running',
  'completed',
  'failed',
  'halted',
];

// Email & Phone regex for standard format validation
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const PHONE_REGEX = /^\+?[0-9\s\-().]{7,20}$/;

/**
 * Zod Schema for Create Run Form with Field-Level Validation (CRM5-20)
 * Validates required fields, email format, phone numbers, and decimal ranges before submission.
 */
export const CreateRunFormSchema = z
  .object({
    batchId: z
      .string()
      .trim()
      .min(1, 'batchId is required')
      .max(128, 'batchId cannot exceed 128 characters'),
    module: z.enum(['crm-1', 'crm-2', 'crm-3', 'crm-4', 'crm-5'] as const, {
      errorMap: () => ({ message: 'Module is required' }),
    }),
    step: z.enum([
      'extract',
      'profile',
      'clean',
      'map',
      'load',
      'validate',
      'reconcile',
    ] as const, {
      errorMap: () => ({ message: 'Step is required' }),
    }),
    status: z.enum([
      'pending',
      'running',
      'completed',
      'failed',
      'halted',
    ] as const, {
      errorMap: () => ({ message: 'Status is required' }),
    }).default('pending'),
    recordsIn: z
      .number({ invalid_type_error: 'Records In must be an integer' })
      .int('Records In must be an integer')
      .min(0, 'Records In cannot be negative'),
    recordsOut: z
      .number({ invalid_type_error: 'Records Out must be an integer' })
      .int('Records Out must be an integer')
      .min(0, 'Records Out cannot be negative'),
    recordsRejected: z
      .number({ invalid_type_error: 'Records Rejected must be an integer' })
      .int('Records Rejected must be an integer')
      .min(0, 'Records Rejected cannot be negative'),
    operatorEmail: z
      .string()
      .trim()
      .optional()
      .refine(
        (val) => !val || EMAIL_REGEX.test(val),
        { message: 'Invalid email address format' }
      ),
    operatorPhone: z
      .string()
      .trim()
      .optional()
      .refine(
        (val) => !val || (PHONE_REGEX.test(val) && (val.match(/\d/g) || []).length >= 7),
        { message: 'Invalid phone number format' }
      ),
    samplingRate: z
      .number({ invalid_type_error: 'Value must be a decimal between 0.00 and 1.00' })
      .min(0, 'Value must be a decimal between 0.00 and 1.00')
      .max(1, 'Value must be a decimal between 0.00 and 1.00')
      .optional(),
  })
  .refine(
    (data) => data.recordsOut + data.recordsRejected <= data.recordsIn,
    {
      message: 'Invariant violation: sum of recordsOut and recordsRejected cannot exceed recordsIn',
      path: ['recordsOut'],
    }
  );

export type CreateRunFormData = z.infer<typeof CreateRunFormSchema>;

export interface FormFieldErrors {
  batchId?: string;
  module?: string;
  step?: string;
  status?: string;
  recordsIn?: string;
  recordsOut?: string;
  recordsRejected?: string;
  operatorEmail?: string;
  operatorPhone?: string;
  samplingRate?: string;
  [key: string]: string | undefined;
}

export interface CreateRunFormProps {
  initialValues?: Partial<CreateRunFormData>;
  onSubmit: (values: CreateRunFormData) => Promise<unknown>;
  onSuccess?: (result: unknown) => void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  serverError?: string | null;
  serverFieldErrors?: FormFieldErrors | null;
  requireContactInfo?: boolean;
}

/**
 * CreateRunForm
 * Production entity creation form strictly adhering to ClearShift V1 Issue #193 (CRM5-20).
 * Validates required fields, email format, phone numbers, and decimal ranges before submission.
 * Enforces double-submit prevention and direct HTTP 400 server validation error mapping.
 */
export const CreateRunForm: React.FC<CreateRunFormProps> = ({
  initialValues = {},
  onSubmit,
  onSuccess,
  onCancel,
  isSubmitting: externalIsSubmitting,
  serverError = null,
  serverFieldErrors = null,
  requireContactInfo = false,
}) => {
  // Field accessibility IDs
  const batchIdId = useId();
  const moduleId = useId();
  const stepId = useId();
  const statusId = useId();
  const recordsInId = useId();
  const recordsOutId = useId();
  const recordsRejectedId = useId();
  const emailId = useId();
  const phoneId = useId();
  const samplingRateId = useId();

  // Internal Form State
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
  const [operatorEmail, setOperatorEmail] = useState<string>(initialValues.operatorEmail ?? '');
  const [operatorPhone, setOperatorPhone] = useState<string>(initialValues.operatorPhone ?? '');
  const [samplingRate, setSamplingRate] = useState<string>(
    initialValues.samplingRate !== undefined ? String(initialValues.samplingRate) : ''
  );

  // Validation & Submission State
  const [clientErrors, setClientErrors] = useState<FormFieldErrors>({});
  const [localServerError, setLocalServerError] = useState<string | null>(null);
  const [localServerFieldErrors, setLocalServerFieldErrors] = useState<FormFieldErrors>({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState<boolean>(false);
  const [localIsSubmitting, setLocalIsSubmitting] = useState<boolean>(false);

  const isSubmitting = externalIsSubmitting ?? localIsSubmitting;

  // Client-Side Field Validation
  const validate = (): boolean => {
    const errors: FormFieldErrors = {};

    // 1. Required Batch Correlation ID
    if (!batchId || !batchId.trim()) {
      errors.batchId = 'batchId is required';
    } else if (batchId.trim().length > 128) {
      errors.batchId = 'batchId cannot exceed 128 characters';
    }

    // 2. Required Module
    if (!module) {
      errors.module = 'Module is required';
    }

    // 3. Required Step
    if (!step) {
      errors.step = 'Step is required';
    }

    // 4. Required Status
    if (!status) {
      errors.status = 'Status is required';
    }

    // 5. Records In
    const inVal = Number(recordsIn);
    if (recordsIn.trim() === '' || isNaN(inVal) || !Number.isInteger(inVal)) {
      errors.recordsIn = 'Records In must be an integer';
    } else if (inVal < 0) {
      errors.recordsIn = 'Records In cannot be negative';
    }

    // 6. Records Out
    const outVal = Number(recordsOut);
    if (recordsOut.trim() === '' || isNaN(outVal) || !Number.isInteger(outVal)) {
      errors.recordsOut = 'Records Out must be an integer';
    } else if (outVal < 0) {
      errors.recordsOut = 'Records Out cannot be negative';
    }

    // 7. Records Rejected
    const rejVal = Number(recordsRejected);
    if (recordsRejected.trim() === '' || isNaN(rejVal) || !Number.isInteger(rejVal)) {
      errors.recordsRejected = 'Records Rejected must be an integer';
    } else if (rejVal < 0) {
      errors.recordsRejected = 'Records Rejected cannot be negative';
    }

    // 8. Conservation Invariant: sum of recordsOut and recordsRejected cannot exceed recordsIn
    if (!errors.recordsIn && !errors.recordsOut && !errors.recordsRejected) {
      if (outVal + rejVal > inVal) {
        errors.recordsOut =
          'Invariant violation: sum of recordsOut and recordsRejected cannot exceed recordsIn';
      }
    }

    // 9. Email Format Validation
    if (requireContactInfo && (!operatorEmail || !operatorEmail.trim())) {
      errors.operatorEmail = 'Operator email is required';
    } else if (operatorEmail.trim().length > 0 && !EMAIL_REGEX.test(operatorEmail.trim())) {
      errors.operatorEmail = 'Invalid email address format';
    }

    // 10. Phone Number Validation
    if (requireContactInfo && (!operatorPhone || !operatorPhone.trim())) {
      errors.operatorPhone = 'Operator phone is required';
    } else if (operatorPhone.trim().length > 0) {
      const digits = (operatorPhone.match(/\d/g) || []).length;
      if (!PHONE_REGEX.test(operatorPhone.trim()) || digits < 7) {
        errors.operatorPhone = 'Invalid phone number format';
      }
    }

    // 11. Decimal Range Validation (0.00 to 1.00)
    if (samplingRate.trim().length > 0) {
      const rateVal = Number(samplingRate);
      if (isNaN(rateVal) || rateVal < 0 || rateVal > 1) {
        errors.samplingRate = 'Value must be a decimal between 0.00 and 1.00';
      }
    }

    setClientErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Submit Handler with Double-Submit Inflight Lock
  const handleSubmit = async (e?: React.SyntheticEvent) => {
    if (e) {
      e.preventDefault();
    }

    // Guard: Prevent double-submit during inflight request
    if (isSubmitting) {
      return;
    }

    setHasAttemptedSubmit(true);
    setLocalServerError(null);
    setLocalServerFieldErrors({});

    if (!validate()) {
      return;
    }

    const payload: CreateRunFormData = {
      batchId: batchId.trim(),
      module,
      step,
      status,
      recordsIn: parseInt(recordsIn, 10),
      recordsOut: parseInt(recordsOut, 10),
      recordsRejected: parseInt(recordsRejected, 10),
      operatorEmail: operatorEmail.trim() || undefined,
      operatorPhone: operatorPhone.trim() || undefined,
      samplingRate: samplingRate.trim() ? parseFloat(samplingRate) : undefined,
    };

    setLocalIsSubmitting(true);
    try {
      const result = await onSubmit(payload);
      if (onSuccess) {
        onSuccess(result);
      }
    } catch (err: unknown) {
      // Map HTTP 400 server validation errors directly to fields
      if (typeof err === 'object' && err !== null) {
        const errorObj = err as {
          message?: string;
          status?: number;
          statusCode?: number;
          code?: string;
          details?: unknown;
          fieldErrors?: Record<string, string>;
          error?: { message?: string; details?: unknown };
        };

        const topMessage =
          errorObj.error?.message ??
          errorObj.message ??
          'Server validation errors prevented creation.';
        setLocalServerError(topMessage);

        const newFieldErrors: FormFieldErrors = {};

        // Parse details array if formatted as standard error envelope [{ path: ['field'], message }]
        const details = errorObj.error?.details ?? errorObj.details;
        if (Array.isArray(details)) {
          for (const item of details) {
            if (typeof item === 'object' && item !== null) {
              const detailItem = item as { path?: string[]; message?: string; field?: string };
              const fieldKey = detailItem.path?.[0] || detailItem.field;
              if (fieldKey && detailItem.message) {
                newFieldErrors[fieldKey] = detailItem.message;
              }
            }
          }
        } else if (typeof details === 'object' && details !== null) {
          Object.assign(newFieldErrors, details);
        } else if (errorObj.fieldErrors) {
          Object.assign(newFieldErrors, errorObj.fieldErrors);
        }

        if (Object.keys(newFieldErrors).length > 0) {
          setLocalServerFieldErrors(newFieldErrors);
        }
      } else {
        setLocalServerError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLocalIsSubmitting(false);
    }
  };

  // Combine client and server errors
  const activeErrors: FormFieldErrors = useMemo(() => {
    return {
      ...clientErrors,
      ...(serverFieldErrors ?? {}),
      ...localServerFieldErrors,
    };
  }, [clientErrors, serverFieldErrors, localServerFieldErrors]);

  const activeTopError = serverError || localServerError;

  // Derived progress preview
  const numIn = parseInt(recordsIn, 10) || 0;
  const numOut = parseInt(recordsOut, 10) || 0;
  const numRej = parseInt(recordsRejected, 10) || 0;
  const totalProcessed = numOut + numRej;
  const completionPercentage =
    numIn > 0 ? Math.min(100, Math.round((totalProcessed / numIn) * 100)) : 0;

  return (
    <form className="cs-form cs-create-run-form" onSubmit={handleSubmit} noValidate>
      {/* Top Error Banner Summary */}
      {(Boolean(activeTopError) ||
        (Object.keys(activeErrors).length > 0 && hasAttemptedSubmit)) && (
        <FormValidationSummary
          title={activeTopError ?? 'Validation errors prevented submission:'}
          errors={activeErrors}
        />
      )}

      {/* Section 1: Identification & Lifecycle */}
      <div className="cs-form-section">
        <h3 className="cs-form-section-title">Batch Identification & Lifecycle</h3>
        <div className="cs-form-grid-2">
          {/* Batch Correlation ID */}
          <div className="cs-field-group">
            <label htmlFor={batchIdId} className="cs-field-label">
              Batch Correlation ID
              <span className="cs-field-required">*</span>
            </label>
            <input
              id={batchIdId}
              type="text"
              name="batchId"
              className={`cs-input ${activeErrors.batchId ? 'cs-input-error' : ''}`}
              value={batchId}
              onChange={(e) => {
                setBatchId(e.target.value);
                if (hasAttemptedSubmit) validate();
              }}
              disabled={isSubmitting}
              aria-required="true"
              aria-invalid={!!activeErrors.batchId}
              aria-describedby={
                activeErrors.batchId ? `${batchIdId}-error` : `${batchIdId}-helper`
              }
              placeholder="e.g. batch-crm-1-20261023-001"
            />
            {activeErrors.batchId ? (
              <span id={`${batchIdId}-error`} className="cs-field-error" role="alert">
                ❌ {activeErrors.batchId}
              </span>
            ) : (
              <span id={`${batchIdId}-helper`} className="cs-field-helper">
                Unique batch correlation identifier from Migration Kit.
              </span>
            )}
          </div>

          {/* Target CRM Module */}
          <div className="cs-field-group">
            <label htmlFor={moduleId} className="cs-field-label">
              Target CRM Module
              <span className="cs-field-required">*</span>
            </label>
            <select
              id={moduleId}
              name="module"
              className={`cs-select ${activeErrors.module ? 'cs-input-error' : ''}`}
              value={module}
              onChange={(e) => {
                setModule(e.target.value as CrmModule);
                if (hasAttemptedSubmit) validate();
              }}
              disabled={isSubmitting}
              aria-required="true"
              aria-invalid={!!activeErrors.module}
              aria-describedby={
                activeErrors.module ? `${moduleId}-error` : `${moduleId}-helper`
              }
            >
              {MODULE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m.toUpperCase()}
                </option>
              ))}
            </select>
            {activeErrors.module ? (
              <span id={`${moduleId}-error`} className="cs-field-error" role="alert">
                ❌ {activeErrors.module}
              </span>
            ) : (
              <span id={`${moduleId}-helper`} className="cs-field-helper">
                CRM destination module being populated.
              </span>
            )}
          </div>
        </div>

        <div className="cs-form-grid-2">
          {/* Migration Pipeline Step */}
          <div className="cs-field-group">
            <label htmlFor={stepId} className="cs-field-label">
              Migration Step
              <span className="cs-field-required">*</span>
            </label>
            <select
              id={stepId}
              name="step"
              className={`cs-select ${activeErrors.step ? 'cs-input-error' : ''}`}
              value={step}
              onChange={(e) => {
                setStep(e.target.value as MigrationStep);
                if (hasAttemptedSubmit) validate();
              }}
              disabled={isSubmitting}
              aria-required="true"
              aria-invalid={!!activeErrors.step}
              aria-describedby={
                activeErrors.step ? `${stepId}-error` : `${stepId}-helper`
              }
            >
              {STEP_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.toUpperCase()}
                </option>
              ))}
            </select>
            {activeErrors.step ? (
              <span id={`${stepId}-error`} className="cs-field-error" role="alert">
                ❌ {activeErrors.step}
              </span>
            ) : (
              <span id={`${stepId}-helper`} className="cs-field-helper">
                Current processing lifecycle stage.
              </span>
            )}
          </div>

          {/* Execution Status */}
          <div className="cs-field-group">
            <label htmlFor={statusId} className="cs-field-label">
              Initial Status
              <span className="cs-field-required">*</span>
            </label>
            <select
              id={statusId}
              name="status"
              className={`cs-select ${activeErrors.status ? 'cs-input-error' : ''}`}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as MigrationRunStatus);
                if (hasAttemptedSubmit) validate();
              }}
              disabled={isSubmitting}
              aria-required="true"
              aria-invalid={!!activeErrors.status}
              aria-describedby={
                activeErrors.status ? `${statusId}-error` : `${statusId}-helper`
              }
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.toUpperCase()}
                </option>
              ))}
            </select>
            {activeErrors.status ? (
              <span id={`${statusId}-error`} className="cs-field-error" role="alert">
                ❌ {activeErrors.status}
              </span>
            ) : (
              <span id={`${statusId}-helper`} className="cs-field-helper">
                Initial operational status for this projection.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Section 2: Conservation Counts & Telemetry */}
      <div className="cs-form-section">
        <h3 className="cs-form-section-title">Record Conservation Counts</h3>
        <div className="cs-form-grid-3">
          {/* Records In */}
          <div className="cs-field-group">
            <label htmlFor={recordsInId} className="cs-field-label">
              Records In
              <span className="cs-field-required">*</span>
            </label>
            <input
              id={recordsInId}
              name="recordsIn"
              type="number"
              min="0"
              step="1"
              className={`cs-input ${activeErrors.recordsIn ? 'cs-input-error' : ''}`}
              value={recordsIn}
              onChange={(e) => {
                setRecordsIn(e.target.value);
                if (hasAttemptedSubmit) validate();
              }}
              disabled={isSubmitting}
              aria-required="true"
              aria-invalid={!!activeErrors.recordsIn}
              aria-describedby={
                activeErrors.recordsIn ? `${recordsInId}-error` : `${recordsInId}-helper`
              }
            />
            {activeErrors.recordsIn ? (
              <span id={`${recordsInId}-error`} className="cs-field-error" role="alert">
                ❌ {activeErrors.recordsIn}
              </span>
            ) : (
              <span id={`${recordsInId}-helper`} className="cs-field-helper">
                Total presented rows (≥ 0).
              </span>
            )}
          </div>

          {/* Records Out */}
          <div className="cs-field-group">
            <label htmlFor={recordsOutId} className="cs-field-label">
              Records Out
              <span className="cs-field-required">*</span>
            </label>
            <input
              id={recordsOutId}
              name="recordsOut"
              type="number"
              min="0"
              step="1"
              className={`cs-input ${activeErrors.recordsOut ? 'cs-input-error' : ''}`}
              value={recordsOut}
              onChange={(e) => {
                setRecordsOut(e.target.value);
                if (hasAttemptedSubmit) validate();
              }}
              disabled={isSubmitting}
              aria-required="true"
              aria-invalid={!!activeErrors.recordsOut}
              aria-describedby={
                activeErrors.recordsOut ? `${recordsOutId}-error` : `${recordsOutId}-helper`
              }
            />
            {activeErrors.recordsOut ? (
              <span id={`${recordsOutId}-error`} className="cs-field-error" role="alert">
                ❌ {activeErrors.recordsOut}
              </span>
            ) : (
              <span id={`${recordsOutId}-helper`} className="cs-field-helper">
                Clean rows passed out.
              </span>
            )}
          </div>

          {/* Records Rejected */}
          <div className="cs-field-group">
            <label htmlFor={recordsRejectedId} className="cs-field-label">
              Records Rejected
              <span className="cs-field-required">*</span>
            </label>
            <input
              id={recordsRejectedId}
              name="recordsRejected"
              type="number"
              min="0"
              step="1"
              className={`cs-input ${activeErrors.recordsRejected ? 'cs-input-error' : ''}`}
              value={recordsRejected}
              onChange={(e) => {
                setRecordsRejected(e.target.value);
                if (hasAttemptedSubmit) validate();
              }}
              disabled={isSubmitting}
              aria-required="true"
              aria-invalid={!!activeErrors.recordsRejected}
              aria-describedby={
                activeErrors.recordsRejected ? `${recordsRejectedId}-error` : `${recordsRejectedId}-helper`
              }
            />
            {activeErrors.recordsRejected ? (
              <span id={`${recordsRejectedId}-error`} className="cs-field-error" role="alert">
                ❌ {activeErrors.recordsRejected}
              </span>
            ) : (
              <span id={`${recordsRejectedId}-helper`} className="cs-field-helper">
                Validation rejected rows.
              </span>
            )}
          </div>
        </div>

        {/* Live Progress Preview */}
        <div className="cs-prop-row" style={{ marginTop: '8px' }}>
          <span className="cs-prop-label">Progress Preview:</span>
          <span className="cs-prop-value">
            {totalProcessed.toLocaleString()} / {numIn.toLocaleString()} rows ({completionPercentage}%)
          </span>
        </div>
      </div>

      {/* Section 3: Operator Contact & Verification (Email, Phone, Decimal Ranges) */}
      <div className="cs-form-section">
        <h3 className="cs-form-section-title">Operator Contact & Sampling Parameters</h3>
        <div className="cs-form-grid-3">
          {/* Operator Email */}
          <div className="cs-field-group">
            <label htmlFor={emailId} className="cs-field-label">
              Operator Email
              {requireContactInfo && <span className="cs-field-required">*</span>}
            </label>
            <input
              id={emailId}
              name="operatorEmail"
              type="email"
              className={`cs-input ${activeErrors.operatorEmail ? 'cs-input-error' : ''}`}
              value={operatorEmail}
              onChange={(e) => {
                setOperatorEmail(e.target.value);
                if (hasAttemptedSubmit) validate();
              }}
              disabled={isSubmitting}
              aria-required={requireContactInfo}
              aria-invalid={!!activeErrors.operatorEmail}
              aria-describedby={
                activeErrors.operatorEmail ? `${emailId}-error` : `${emailId}-helper`
              }
              placeholder="e.g. operator@clearshift.internal"
            />
            {activeErrors.operatorEmail ? (
              <span id={`${emailId}-error`} className="cs-field-error" role="alert">
                ❌ {activeErrors.operatorEmail}
              </span>
            ) : (
              <span id={`${emailId}-helper`} className="cs-field-helper">
                Notification email address for run completion.
              </span>
            )}
          </div>

          {/* Operator Phone */}
          <div className="cs-field-group">
            <label htmlFor={phoneId} className="cs-field-label">
              Operator Phone
              {requireContactInfo && <span className="cs-field-required">*</span>}
            </label>
            <input
              id={phoneId}
              name="operatorPhone"
              type="tel"
              className={`cs-input ${activeErrors.operatorPhone ? 'cs-input-error' : ''}`}
              value={operatorPhone}
              onChange={(e) => {
                setOperatorPhone(e.target.value);
                if (hasAttemptedSubmit) validate();
              }}
              disabled={isSubmitting}
              aria-required={requireContactInfo}
              aria-invalid={!!activeErrors.operatorPhone}
              aria-describedby={
                activeErrors.operatorPhone ? `${phoneId}-error` : `${phoneId}-helper`
              }
              placeholder="e.g. +1-555-0199"
            />
            {activeErrors.operatorPhone ? (
              <span id={`${phoneId}-error`} className="cs-field-error" role="alert">
                ❌ {activeErrors.operatorPhone}
              </span>
            ) : (
              <span id={`${phoneId}-helper`} className="cs-field-helper">
                SMS alert phone number.
              </span>
            )}
          </div>

          {/* Sampling Decimal Range (0.00 - 1.00) */}
          <div className="cs-field-group">
            <label htmlFor={samplingRateId} className="cs-field-label">
              Sampling Rate (0.00 - 1.00)
            </label>
            <input
              id={samplingRateId}
              name="samplingRate"
              type="number"
              step="0.01"
              min="0"
              max="1"
              className={`cs-input ${activeErrors.samplingRate ? 'cs-input-error' : ''}`}
              value={samplingRate}
              onChange={(e) => {
                setSamplingRate(e.target.value);
                if (hasAttemptedSubmit) validate();
              }}
              disabled={isSubmitting}
              aria-invalid={!!activeErrors.samplingRate}
              aria-describedby={
                activeErrors.samplingRate ? `${samplingRateId}-error` : `${samplingRateId}-helper`
              }
              placeholder="e.g. 0.95"
            />
            {activeErrors.samplingRate ? (
              <span id={`${samplingRateId}-error`} className="cs-field-error" role="alert">
                ❌ {activeErrors.samplingRate}
              </span>
            ) : (
              <span id={`${samplingRateId}-helper`} className="cs-field-helper">
                Audit sampling decimal fraction [0.00 .. 1.00].
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Form Action Buttons */}
      <div className="cs-form-actions">
        {onCancel && (
          <button
            type="button"
            className="cs-btn cs-btn-secondary cs-form-cancel-btn"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          className={`cs-btn cs-btn-primary cs-form-submit-btn ${
            isSubmitting ? 'cs-btn-disabled' : ''
          }`}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <span className="cs-spinner-sm" aria-hidden="true" />
              Recording Run...
            </>
          ) : (
            'Record Migration Run'
          )}
        </button>
      </div>
    </form>
  );
};
