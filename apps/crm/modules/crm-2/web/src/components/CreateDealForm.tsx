import React, { useState, useId, useMemo } from 'react';
import { z } from 'zod';
import {
  type Crm2StageName,
  type Stage,
  CRM2_STAGES,
} from '@clearshift/contracts';
import { FormValidationSummary } from './FormValidationSummary.js';

export const STAGE_OPTIONS: Crm2StageName[] = [
  'New',
  'Qualified',
  'Proposal',
  'Negotiation',
  'Won',
  'Lost',
];

export const CURRENCY_OPTIONS = [
  { label: 'USD - US Dollar', value: 'USD' },
  { label: 'EUR - Euro', value: 'EUR' },
  { label: 'GBP - British Pound', value: 'GBP' },
  { label: 'CAD - Canadian Dollar', value: 'CAD' },
  { label: 'AUD - Australian Dollar', value: 'AUD' },
  { label: 'JPY - Japanese Yen', value: 'JPY' },
];

// RFC standard email and international phone regexes
export const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
export const PHONE_REGEX = /^\+?[0-9\s\-().]{7,20}$/;
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Zod Schema for Create Deal Form with Field-Level Validation (CRM2-20)
 * Validates required fields, email format, phone numbers, and decimal ranges before submission.
 */
export const CreateDealFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Deal name is required')
    .max(255, 'Deal name cannot exceed 255 characters'),
  contactId: z
    .string()
    .trim()
    .optional()
    .refine((val) => !val || UUID_REGEX.test(val), {
      message: 'Invalid Contact UUID',
    }),
  contactEmail: z
    .string()
    .trim()
    .optional()
    .refine((val) => !val || EMAIL_REGEX.test(val), {
      message: 'Invalid email address format',
    }),
  contactPhone: z
    .string()
    .trim()
    .optional()
    .refine(
      (val) => !val || (PHONE_REGEX.test(val) && (val.match(/\d/g) || []).length >= 7),
      { message: 'Invalid phone number format' }
    ),
  value: z
    .string()
    .trim()
    .min(1, 'Deal value is required')
    .refine((val) => /^\d+(\.\d{1,4})?$/.test(val), {
      message: 'Value must be a valid non-negative decimal string',
    })
    .refine((val) => Number.parseFloat(val) >= 0, {
      message: 'Value must be a valid non-negative decimal string',
    }),
  probability: z
    .number({ invalid_type_error: 'Value must be a decimal between 0.00 and 1.00' })
    .min(0, 'Value must be a decimal between 0.00 and 1.00')
    .max(1, 'Value must be a decimal between 0.00 and 1.00')
    .optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, {
      message: 'Currency must be an explicit 3-letter uppercase ISO code (e.g. USD, EUR, GBP)',
    })
    .default('USD'),
  stageName: z.enum(['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'] as const, {
    errorMap: () => ({ message: 'Stage is required' }),
  }).default('New'),
  closeDate: z
    .string()
    .trim()
    .min(1, 'Close date is required')
    .regex(DATE_REGEX, {
      message: 'Close date must be in YYYY-MM-DD format',
    }),
  sourceSystem: z.string().trim().max(64, 'Source system cannot exceed 64 characters').optional(),
  sourceId: z.string().trim().max(128, 'Source ID cannot exceed 128 characters').optional(),
});

export type CreateDealFormData = z.infer<typeof CreateDealFormSchema>;

export interface CreateDealInputValues {
  name?: string | undefined;
  contactId?: string | undefined;
  contact_id?: string | undefined;
  contactEmail?: string | undefined;
  contact_email?: string | undefined;
  contactPhone?: string | undefined;
  contact_phone?: string | undefined;
  value?: string | number | undefined;
  probability?: string | number | undefined;
  currency?: string | undefined;
  stageName?: string | undefined;
  stage_name?: string | undefined;
  closeDate?: string | undefined;
  close_date?: string | undefined;
  sourceSystem?: string | undefined;
  source_system?: string | undefined;
  sourceId?: string | undefined;
  source_id?: string | undefined;
}

export type FormFieldErrors = Record<string, string | undefined>;

/**
 * Validates form input fields according to ClearShift V1 CRM2-20 field validation rules.
 */
export function validateCreateDealFields(
  values: CreateDealInputValues,
  requireContactInfo = false
): FormFieldErrors {
  const errors: FormFieldErrors = {};

  const name = (values.name ?? '').trim();
  if (!name) {
    errors['name'] = 'Deal name is required';
  } else if (name.length > 255) {
    errors['name'] = 'Deal name cannot exceed 255 characters';
  }

  const rawValue = (values.value !== undefined ? String(values.value) : '').trim();
  if (!rawValue) {
    errors['value'] = 'Deal value is required';
  } else {
    const num = Number(rawValue);
    if (!/^\d+(\.\d{1,4})?$/.test(rawValue) || isNaN(num) || num < 0) {
      errors['value'] = 'Value must be a valid non-negative decimal string';
    }
  }

  const rawProb = values.probability !== undefined ? String(values.probability).trim() : '';
  if (rawProb.length > 0) {
    const pVal = Number(rawProb);
    if (isNaN(pVal) || pVal < 0 || pVal > 1) {
      errors['probability'] = 'Value must be a decimal between 0.00 and 1.00';
    }
  }

  const rawCurrency = (values.currency ?? 'USD').trim();
  if (!rawCurrency || !/^[A-Z]{3}$/.test(rawCurrency)) {
    errors['currency'] = 'Currency must be an explicit 3-letter uppercase ISO code (e.g. USD, EUR, GBP)';
  }

  const stage = values.stageName ?? values.stage_name;
  if (!stage || !CRM2_STAGES.includes(stage as Crm2StageName)) {
    errors['stageName'] = 'Stage is required';
  }

  const closeDate = (values.closeDate ?? values.close_date ?? '').trim();
  if (!closeDate) {
    errors['closeDate'] = 'Close date is required';
  } else if (!DATE_REGEX.test(closeDate)) {
    errors['closeDate'] = 'Close date must be in YYYY-MM-DD format';
  }

  const contactId = (values.contactId ?? values.contact_id ?? '').trim();
  if (contactId && !UUID_REGEX.test(contactId)) {
    errors['contactId'] = 'Invalid Contact UUID';
  }

  const rawEmail = (values.contactEmail ?? values.contact_email ?? '').trim();
  if (requireContactInfo && !rawEmail) {
    errors['contactEmail'] = 'Contact email is required';
  } else if (rawEmail.length > 0 && !EMAIL_REGEX.test(rawEmail)) {
    errors['contactEmail'] = 'Invalid email address format';
  }

  const rawPhone = (values.contactPhone ?? values.contact_phone ?? '').trim();
  if (requireContactInfo && !rawPhone) {
    errors['contactPhone'] = 'Contact phone is required';
  } else if (rawPhone.length > 0) {
    const digits = (rawPhone.match(/\d/g) || []).length;
    if (!PHONE_REGEX.test(rawPhone) || digits < 7) {
      errors['contactPhone'] = 'Invalid phone number format';
    }
  }

  return errors;
}

/**
 * Parses HTTP 400 server validation errors or ClearShift error envelope into field errors.
 */
export function parseServerErrorToFieldErrors(err: unknown): {
  topMessage: string;
  fieldErrors: FormFieldErrors;
} {
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

    const newFieldErrors: FormFieldErrors = {};

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

    return { topMessage, fieldErrors: newFieldErrors };
  }

  return {
    topMessage: err instanceof Error ? err.message : String(err),
    fieldErrors: {},
  };
}

export interface CreateDealFormProps {
  initialValues?: Partial<CreateDealFormData> | undefined;
  onSubmit: (values: CreateDealFormData) => Promise<unknown>;
  onSuccess?: ((result: unknown) => void) | undefined;
  onCancel?: (() => void) | undefined;
  isSubmitting?: boolean | undefined;
  serverError?: string | null | undefined;
  serverFieldErrors?: FormFieldErrors | null | undefined;
  requireContactInfo?: boolean | undefined;
  stages?: Stage[] | undefined;
}

export const CreateDealForm: React.FC<CreateDealFormProps> = ({
  initialValues,
  onSubmit,
  onSuccess,
  onCancel,
  isSubmitting = false,
  serverError: externalServerError,
  serverFieldErrors: externalFieldErrors,
  requireContactInfo = false,
  stages = [],
}) => {
  const formId = useId();

  // Field states
  const [name, setName] = useState(initialValues?.name ?? '');
  const [contactId, setContactId] = useState(initialValues?.contactId ?? '');
  const [contactEmail, setContactEmail] = useState(initialValues?.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(initialValues?.contactPhone ?? '');
  const [value, setValue] = useState(initialValues?.value ?? '');
  const [probability, setProbability] = useState(
    initialValues?.probability !== undefined ? String(initialValues.probability) : '0.10'
  );
  const [currency, setCurrency] = useState(initialValues?.currency ?? 'USD');
  const [stageName, setStageName] = useState<Crm2StageName>(
    initialValues?.stageName ?? 'New'
  );
  const [closeDate, setCloseDate] = useState<string>(
    initialValues?.closeDate ?? new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]!
  );
  const [sourceSystem, setSourceSystem] = useState(initialValues?.sourceSystem ?? '');
  const [sourceId, setSourceId] = useState(initialValues?.sourceId ?? '');

  // Validation & inflight submission state
  const [errors, setErrors] = useState<FormFieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submittingInternal, setSubmittingInternal] = useState(false);
  const [internalServerError, setInternalServerError] = useState<string | null>(null);

  const activeServerError = externalServerError ?? internalServerError;
  const inFlight = isSubmitting || submittingInternal;

  // Merged field errors from client validation and server responses
  const mergedErrors = useMemo<FormFieldErrors>(() => {
    return {
      ...errors,
      ...(externalFieldErrors ?? {}),
    };
  }, [errors, externalFieldErrors]);

  const hasError = (field: string): boolean => {
    return Boolean(touched[field] && mergedErrors[field]);
  };

  const getError = (field: string): string | undefined => {
    return mergedErrors[field];
  };

  const stageOptions = useMemo(() => {
    if (stages.length > 0) {
      return stages.map((s) => ({ label: s.name, value: s.name }));
    }
    return CRM2_STAGES.map((s) => ({ label: s, value: s }));
  }, [stages]);

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const currentValues: CreateDealInputValues = {
      name,
      contactId,
      contactEmail,
      contactPhone,
      value,
      probability: probability ? Number(probability) : undefined,
      currency,
      stageName,
      closeDate,
      sourceSystem,
      sourceId,
    };
    const fieldValidation = validateCreateDealFields(currentValues, requireContactInfo);
    setErrors((prev) => {
      const next = { ...prev };
      if (fieldValidation[field]) {
        next[field] = fieldValidation[field];
      } else {
        delete next[field];
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight) return; // double-submit prevention

    const currentValues: CreateDealInputValues = {
      name,
      contactId,
      contactEmail,
      contactPhone,
      value,
      probability: probability !== '' ? Number(probability) : undefined,
      currency,
      stageName,
      closeDate,
      sourceSystem,
      sourceId,
    };

    const clientValidationErrors = validateCreateDealFields(currentValues, requireContactInfo);
    if (Object.keys(clientValidationErrors).length > 0) {
      setErrors(clientValidationErrors);
      setTouched({
        name: true,
        contactId: true,
        contactEmail: true,
        contactPhone: true,
        value: true,
        probability: true,
        currency: true,
        stageName: true,
        closeDate: true,
      });
      return;
    }

    setSubmittingInternal(true);
    setInternalServerError(null);

    const payload: CreateDealFormData = {
      name: name.trim(),
      contactId: contactId.trim() || undefined,
      contactEmail: contactEmail.trim() || undefined,
      contactPhone: contactPhone.trim() || undefined,
      value: value.trim(),
      probability: probability !== '' ? Number(probability) : undefined,
      currency: currency.trim(),
      stageName,
      closeDate: closeDate ? closeDate.trim() : '',
      sourceSystem: sourceSystem.trim() || undefined,
      sourceId: sourceId.trim() || undefined,
    };

    try {
      const result = await onSubmit(payload);
      if (onSuccess) {
        onSuccess(result);
      }
    } catch (err: unknown) {
      const { topMessage, fieldErrors: serverFieldErrs } = parseServerErrorToFieldErrors(err);
      setInternalServerError(topMessage);
      if (Object.keys(serverFieldErrs).length > 0) {
        setErrors((prev) => ({ ...prev, ...serverFieldErrs }));
      }
    } finally {
      setSubmittingInternal(false);
    }
  };

  return (
    <form
      id={formId}
      className="cs-form"
      onSubmit={handleSubmit}
      noValidate
      aria-label="Create Deal Form"
    >
      {/* Accessible Server Validation Alert Banner */}
      {activeServerError && (
        <FormValidationSummary
          title={activeServerError}
          errors={mergedErrors}
        />
      )}

      {/* Section 1: Opportunity Basics */}
      <div className="cs-form-section">
        <h3 className="cs-form-section-title">Deal Identification &amp; Valuation</h3>
        <div className="cs-form-grid-2">
          {/* Deal Name */}
          <div className="cs-field-group">
            <label htmlFor={`${formId}-name`} className="cs-field-label">
              Deal Name <span className="cs-field-required">*</span>
            </label>
            <input
              id={`${formId}-name`}
              type="text"
              className={`cs-input ${hasError('name') ? 'cs-input-error' : ''}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => handleBlur('name')}
              placeholder="e.g. Acme Enterprise ERP Migration"
              aria-required="true"
              aria-invalid={hasError('name')}
              aria-describedby={hasError('name') ? `${formId}-name-err` : undefined}
              disabled={inFlight}
            />
            {hasError('name') && (
              <span id={`${formId}-name-err`} className="cs-field-error" role="alert">
                {getError('name')}
              </span>
            )}
          </div>

          {/* Deal Value */}
          <div className="cs-field-group">
            <label htmlFor={`${formId}-value`} className="cs-field-label">
              Deal Value (Amount) <span className="cs-field-required">*</span>
            </label>
            <input
              id={`${formId}-value`}
              type="text"
              className={`cs-input ${hasError('value') ? 'cs-input-error' : ''}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => handleBlur('value')}
              placeholder="e.g. 50000.00"
              aria-required="true"
              aria-invalid={hasError('value')}
              aria-describedby={hasError('value') ? `${formId}-value-err` : undefined}
              disabled={inFlight}
            />
            {hasError('value') && (
              <span id={`${formId}-value-err`} className="cs-field-error" role="alert">
                {getError('value')}
              </span>
            )}
          </div>
        </div>

        <div className="cs-form-grid-3">
          {/* Currency */}
          <div className="cs-field-group">
            <label htmlFor={`${formId}-currency`} className="cs-field-label">
              Currency <span className="cs-field-required">*</span>
            </label>
            <select
              id={`${formId}-currency`}
              className={`cs-select ${hasError('currency') ? 'cs-input-error' : ''}`}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              onBlur={() => handleBlur('currency')}
              aria-required="true"
              aria-invalid={hasError('currency')}
              disabled={inFlight}
            >
              {CURRENCY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            {hasError('currency') && (
              <span className="cs-field-error" role="alert">
                {getError('currency')}
              </span>
            )}
          </div>

          {/* Pipeline Stage */}
          <div className="cs-field-group">
            <label htmlFor={`${formId}-stage`} className="cs-field-label">
              Pipeline Stage <span className="cs-field-required">*</span>
            </label>
            <select
              id={`${formId}-stage`}
              className={`cs-select ${hasError('stageName') ? 'cs-input-error' : ''}`}
              value={stageName}
              onChange={(e) => setStageName(e.target.value as Crm2StageName)}
              onBlur={() => handleBlur('stageName')}
              aria-required="true"
              aria-invalid={hasError('stageName')}
              disabled={inFlight}
            >
              {stageOptions.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            {hasError('stageName') && (
              <span className="cs-field-error" role="alert">
                {getError('stageName')}
              </span>
            )}
          </div>

          {/* Probability (0.00 to 1.00) */}
          <div className="cs-field-group">
            <label htmlFor={`${formId}-probability`} className="cs-field-label">
              Win Probability (0.00 - 1.00)
            </label>
            <input
              id={`${formId}-probability`}
              type="number"
              step="0.05"
              min="0"
              max="1"
              className={`cs-input ${hasError('probability') ? 'cs-input-error' : ''}`}
              value={probability}
              onChange={(e) => setProbability(e.target.value)}
              onBlur={() => handleBlur('probability')}
              placeholder="0.10"
              aria-invalid={hasError('probability')}
              aria-describedby={hasError('probability') ? `${formId}-prob-err` : undefined}
              disabled={inFlight}
            />
            {hasError('probability') && (
              <span id={`${formId}-prob-err`} className="cs-field-error" role="alert">
                {getError('probability')}
              </span>
            )}
          </div>
        </div>

        {/* Target Close Date */}
        <div className="cs-field-group">
          <label htmlFor={`${formId}-close-date`} className="cs-field-label">
            Target Close Date <span className="cs-field-required">*</span>
          </label>
          <input
            id={`${formId}-close-date`}
            type="date"
            className={`cs-input ${hasError('closeDate') ? 'cs-input-error' : ''}`}
            value={closeDate}
            onChange={(e) => setCloseDate(e.target.value)}
            onBlur={() => handleBlur('closeDate')}
            aria-required="true"
            aria-invalid={hasError('closeDate')}
            aria-describedby={hasError('closeDate') ? `${formId}-date-err` : undefined}
            disabled={inFlight}
          />
          {hasError('closeDate') && (
            <span id={`${formId}-date-err`} className="cs-field-error" role="alert">
              {getError('closeDate')}
            </span>
          )}
        </div>
      </div>

      {/* Section 2: CRM-1 Contact Association & Contact Information */}
      <div className="cs-form-section">
        <h3 className="cs-form-section-title">CRM-1 Contact Association &amp; Communication</h3>
        <p className="cs-field-helper">
          Every deal links to an existing CRM-1 contact/company. Unassigned contacts produce an orphan deal badge.
        </p>

        {/* Contact ID */}
        <div className="cs-field-group">
          <label htmlFor={`${formId}-contact-id`} className="cs-field-label">
            CRM-1 Contact UUID
          </label>
          <input
            id={`${formId}-contact-id`}
            type="text"
            className={`cs-input ${hasError('contactId') || hasError('contact_id') ? 'cs-input-error' : ''}`}
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            onBlur={() => handleBlur('contactId')}
            placeholder="e.g. 90000000-0000-4000-8000-000000000001 (Leave blank for orphan deal)"
            aria-invalid={hasError('contactId') || hasError('contact_id')}
            aria-describedby={
              hasError('contactId') || hasError('contact_id') ? `${formId}-contact-err` : undefined
            }
            disabled={inFlight}
          />
          {(hasError('contactId') || hasError('contact_id')) && (
            <span id={`${formId}-contact-err`} className="cs-field-error" role="alert">
              {getError('contactId') || getError('contact_id')}
            </span>
          )}
        </div>

        <div className="cs-form-grid-2">
          {/* Contact Email */}
          <div className="cs-field-group">
            <label htmlFor={`${formId}-contact-email`} className="cs-field-label">
              Primary Contact Email {requireContactInfo && <span className="cs-field-required">*</span>}
            </label>
            <input
              id={`${formId}-contact-email`}
              type="email"
              className={`cs-input ${hasError('contactEmail') || hasError('contact_email') ? 'cs-input-error' : ''}`}
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              onBlur={() => handleBlur('contactEmail')}
              placeholder="e.g. sarah.connor@acme.com"
              aria-required={requireContactInfo}
              aria-invalid={hasError('contactEmail') || hasError('contact_email')}
              aria-describedby={
                hasError('contactEmail') || hasError('contact_email') ? `${formId}-email-err` : undefined
              }
              disabled={inFlight}
            />
            {(hasError('contactEmail') || hasError('contact_email')) && (
              <span id={`${formId}-email-err`} className="cs-field-error" role="alert">
                {getError('contactEmail') || getError('contact_email')}
              </span>
            )}
          </div>

          {/* Contact Phone */}
          <div className="cs-field-group">
            <label htmlFor={`${formId}-contact-phone`} className="cs-field-label">
              Primary Contact Phone {requireContactInfo && <span className="cs-field-required">*</span>}
            </label>
            <input
              id={`${formId}-contact-phone`}
              type="tel"
              className={`cs-input ${hasError('contactPhone') || hasError('contact_phone') ? 'cs-input-error' : ''}`}
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              onBlur={() => handleBlur('contactPhone')}
              placeholder="e.g. +1-555-0199"
              aria-required={requireContactInfo}
              aria-invalid={hasError('contactPhone') || hasError('contact_phone')}
              aria-describedby={
                hasError('contactPhone') || hasError('contact_phone') ? `${formId}-phone-err` : undefined
              }
              disabled={inFlight}
            />
            {(hasError('contactPhone') || hasError('contact_phone')) && (
              <span id={`${formId}-phone-err`} className="cs-field-error" role="alert">
                {getError('contactPhone') || getError('contact_phone')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Section 3: Migration Source System (Optional) */}
      <div className="cs-form-section">
        <h3 className="cs-form-section-title">Migration &amp; Sync Metadata (Optional)</h3>
        <div className="cs-form-grid-2">
          <div className="cs-field-group">
            <label htmlFor={`${formId}-source-system`} className="cs-field-label">
              Source System
            </label>
            <input
              id={`${formId}-source-system`}
              type="text"
              className="cs-input"
              value={sourceSystem}
              onChange={(e) => setSourceSystem(e.target.value)}
              placeholder="e.g. salesforce-legacy"
              disabled={inFlight}
            />
          </div>
          <div className="cs-field-group">
            <label htmlFor={`${formId}-source-id`} className="cs-field-label">
              Source ID
            </label>
            <input
              id={`${formId}-source-id`}
              type="text"
              className="cs-input"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              placeholder="e.g. 0064W0000109abc"
              disabled={inFlight}
            />
          </div>
        </div>
      </div>

      {/* Form Action Controls */}
      <div className="cs-form-actions">
        {onCancel && (
          <button
            type="button"
            className="cs-btn cs-btn-secondary"
            onClick={onCancel}
            disabled={inFlight}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          className="cs-btn cs-btn-primary cs-form-submit-btn"
          disabled={inFlight}
          aria-busy={inFlight}
        >
          {inFlight ? (
            <>
              <span className="cs-spinner-sm" aria-hidden="true" />
              <span>Creating Deal...</span>
            </>
          ) : (
            <span>Create Deal</span>
          )}
        </button>
      </div>
    </form>
  );
};
