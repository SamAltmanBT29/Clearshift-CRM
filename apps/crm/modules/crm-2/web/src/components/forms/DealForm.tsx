import React, { useState, useEffect } from 'react';
import {
  Input,
  Select,
  Button,
  Alert,
  Badge,
} from '@clearshift/ui';
import {
  type Deal,
  type Stage,
  type CreateDealInput,
  type UpdateDealInput,
  type Crm2StageName,
  CRM2_STAGES,
  CRM2_FIELD_CONTRACT,
} from '@clearshift/contracts';
import { ConfirmModal } from './ConfirmModal.js';

export interface DealFormProps {
  initialDeal?: Deal | null | undefined;
  stages?: Stage[] | undefined;
  isSubmitting?: boolean | undefined;
  serverError?: string | null | undefined;
  serverFieldErrors?: Record<string, string[]> | null | undefined;
  onSubmit: (data: CreateDealInput | UpdateDealInput) => Promise<void>;
  onCancel: () => void;
}

export function DealForm({
  initialDeal,
  stages = [],
  isSubmitting = false,
  serverError,
  serverFieldErrors,
  onSubmit,
  onCancel,
}: DealFormProps) {
  const isEditing = Boolean(initialDeal?.id);

  // Form field state
  const [name, setName] = useState(initialDeal?.name ?? '');
  const [contactId, setContactId] = useState(initialDeal?.contact_id ?? '');
  const [value, setValue] = useState(initialDeal?.value ?? '');
  const [currency, setCurrency] = useState(initialDeal?.currency ?? 'USD');
  const [stageName, setStageName] = useState<Crm2StageName>(initialDeal?.stage_name ?? 'New');
  const [closeDate, setCloseDate] = useState(initialDeal?.close_date ?? '');

  // Validation state
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Confirmation dialog state
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Track if user changed any field
  const isDirty =
    name !== (initialDeal?.name ?? '') ||
    contactId !== (initialDeal?.contact_id ?? '') ||
    value !== (initialDeal?.value ?? '') ||
    currency !== (initialDeal?.currency ?? 'USD') ||
    stageName !== (initialDeal?.stage_name ?? 'New') ||
    closeDate !== (initialDeal?.close_date ?? '');

  // Computed orphan status derived from contactId
  const isOrphan = !contactId || contactId.trim() === '';

  // Synchronize when initialDeal updates
  useEffect(() => {
    if (initialDeal) {
      setName(initialDeal.name);
      setContactId(initialDeal.contact_id ?? '');
      setValue(initialDeal.value);
      setCurrency(initialDeal.currency);
      setStageName(initialDeal.stage_name);
      setCloseDate(initialDeal.close_date);
    }
  }, [initialDeal]);

  // Stage options derived strictly from CRM2_STAGES
  const stageOptions = (stages.length > 0 ? stages.map((s) => s.name) : CRM2_STAGES).map(
    (stage) => ({
      label: stage,
      value: stage,
    })
  );

  const currencyOptions = [
    { label: 'USD - US Dollar', value: 'USD' },
    { label: 'EUR - Euro', value: 'EUR' },
    { label: 'GBP - British Pound', value: 'GBP' },
    { label: 'CAD - Canadian Dollar', value: 'CAD' },
    { label: 'AUD - Australian Dollar', value: 'AUD' },
    { label: 'JPY - Japanese Yen', value: 'JPY' },
  ];

  const validateField = (fieldName: string, val: string): string | undefined => {
    switch (fieldName) {
      case 'name':
        if (!val || val.trim() === '') {
          return CRM2_FIELD_CONTRACT.deal.name.errorRequired;
        }
        if (val.trim().length > 255) {
          return 'Deal name cannot exceed 255 characters';
        }
        return undefined;

      case 'value':
        if (!val || val.trim() === '') {
          return 'Deal value is required';
        }
        if (!/^\d+(\.\d{1,4})?$/.test(val.trim())) {
          return CRM2_FIELD_CONTRACT.deal.value.errorInvalid;
        }
        if (Number.parseFloat(val) < 0) {
          return 'Deal value must be non-negative';
        }
        return undefined;

      case 'currency':
        if (!val || !/^[A-Z]{3}$/.test(val.trim())) {
          return CRM2_FIELD_CONTRACT.deal.currency.errorInvalid;
        }
        return undefined;

      case 'stage_name':
        if (!CRM2_STAGES.includes(val as Crm2StageName)) {
          return CRM2_FIELD_CONTRACT.deal.stage_name.errorInvalid;
        }
        return undefined;

      case 'close_date':
        if (!val || !/^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
          return CRM2_FIELD_CONTRACT.deal.close_date.errorInvalid;
        }
        return undefined;

      default:
        return undefined;
    }
  };

  const handleBlur = (fieldName: string) => {
    setTouched((prev) => ({ ...prev, [fieldName]: true }));
    let val = '';
    if (fieldName === 'name') val = name;
    if (fieldName === 'value') val = value;
    if (fieldName === 'currency') val = currency;
    if (fieldName === 'stage_name') val = stageName;
    if (fieldName === 'close_date') val = closeDate;

    const error = validateField(fieldName, val);
    setErrors((prev) => {
      const next = { ...prev };
      if (error) {
        next[fieldName] = error;
      } else {
        delete next[fieldName];
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all fields
    const newErrors: Record<string, string> = {};
    const nameErr = validateField('name', name);
    if (nameErr) newErrors['name'] = nameErr;

    const valErr = validateField('value', value);
    if (valErr) newErrors['value'] = valErr;

    const currErr = validateField('currency', currency);
    if (currErr) newErrors['currency'] = currErr;

    const stageErr = validateField('stage_name', stageName);
    if (stageErr) newErrors['stage_name'] = stageErr;

    const dateErr = validateField('close_date', closeDate);
    if (dateErr) newErrors['close_date'] = dateErr;

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setTouched({
        name: true,
        value: true,
        currency: true,
        stage_name: true,
        close_date: true,
      });
      return;
    }

    const payload: CreateDealInput = {
      name: name.trim(),
      contact_id: contactId && contactId.trim() !== '' ? contactId.trim() : null,
      value: value.trim(),
      currency: currency.trim(),
      stage_name: stageName,
      close_date: closeDate.trim(),
    };

    await onSubmit(payload);
  };

  const handleCancelClick = () => {
    if (isDirty) {
      setShowCancelConfirm(true);
    } else {
      onCancel();
    }
  };

  return (
    <>
      <form
        onSubmit={handleSubmit}
        aria-label={isEditing ? 'Edit Deal Form' : 'Create Deal Form'}
        className="space-y-6"
      >
        {/* Top Server Error Alert */}
        {serverError && (
          <Alert variant="error" title="Submission Failed">
            <p className="text-sm font-medium">{serverError}</p>
            <p className="text-xs text-rose-700 mt-1">
              Your entered values have been preserved. Please correct the highlighted issues and retry.
            </p>
          </Alert>
        )}

        {/* Read-Only System Identity Panel (if editing) */}
        {isEditing && initialDeal && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Deal Record ID
              </span>
              <span className="text-sm font-mono text-slate-900 select-all font-medium">
                {initialDeal.id}
              </span>
              <p className="text-xs text-slate-400 mt-0.5">Read-only immutable identifier</p>
            </div>
            <div>
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Created Timestamp
              </span>
              <span className="text-sm text-slate-800">
                {new Date(initialDeal.created_at).toLocaleString()}
              </span>
              <p className="text-xs text-slate-400 mt-0.5">Server-assigned creation audit</p>
            </div>
            <div>
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Computed Orphan State
              </span>
              <div className="mt-1">
                {initialDeal.is_orphan ? (
                  <Badge variant="warning" size="sm">
                    ⚠️ Orphan (No Contact)
                  </Badge>
                ) : (
                  <Badge variant="success" size="sm">
                    ✓ Contact Linked
                  </Badge>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Server-derived domain status</p>
            </div>
          </div>
        )}

        {/* Primary Deal Details */}
        <div className="space-y-4">
          <Input
            id="deal-name-input"
            label={CRM2_FIELD_CONTRACT.deal.name.label}
            helperText={CRM2_FIELD_CONTRACT.deal.name.helperText}
            placeholder="e.g. Global Tech Infrastructure Modernization"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => handleBlur('name')}
            error={errors['name'] || serverFieldErrors?.['name']?.[0]}
            required
            aria-required="true"
          />

          {/* Contact UUID with Orphan Deal Warning */}
          <div className="space-y-2">
            <Input
              id="deal-contact-id-input"
              label={CRM2_FIELD_CONTRACT.deal.contact_id.label}
              helperText={CRM2_FIELD_CONTRACT.deal.contact_id.helperText}
              placeholder="e.g. 90000000-0000-4000-8000-000000000001 (leave empty for orphan)"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              error={serverFieldErrors?.['contact_id']?.[0]}
            />

            {/* Invariant & SDS Rule: The UI visibly warns on an orphan deal */}
            {isOrphan && (
              <div
                data-testid="deal-form-orphan-warning"
                className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-300 rounded-md text-amber-900 text-xs"
              >
                <span className="text-base" aria-hidden="true">⚠️</span>
                <span>
                  <strong>Orphan Deal Warning:</strong> No contact reference provided. This opportunity will be visibly flagged as an unassigned orphan deal across all CRM-2 pipeline screens.
                </span>
              </div>
            )}
          </div>

          {/* Financials: Value & Currency */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <Input
                id="deal-value-input"
                label={CRM2_FIELD_CONTRACT.deal.value.label}
                helperText={CRM2_FIELD_CONTRACT.deal.value.helperText}
                placeholder="75000.00"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => handleBlur('value')}
                error={errors['value'] || serverFieldErrors?.['value']?.[0]}
                required
                aria-required="true"
              />
            </div>
            <div>
              <Select
                id="deal-currency-select"
                label={CRM2_FIELD_CONTRACT.deal.currency.label}
                options={currencyOptions}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                onBlur={() => handleBlur('currency')}
                error={errors['currency'] || serverFieldErrors?.['currency']?.[0]}
                required
              />
            </div>
          </div>

          {/* Pipeline Stage and Close Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Select
                id="deal-stage-select"
                label={CRM2_FIELD_CONTRACT.deal.stage_name.label}
                options={stageOptions}
                value={stageName}
                onChange={(e) => setStageName(e.target.value as Crm2StageName)}
                onBlur={() => handleBlur('stage_name')}
                error={errors['stage_name'] || serverFieldErrors?.['stage_name']?.[0]}
                required
              />
              <p className="text-xs text-slate-500 mt-1">
                {CRM2_FIELD_CONTRACT.deal.stage_name.helperText}
              </p>
            </div>
            <div>
              <Input
                id="deal-close-date-input"
                type="date"
                label={CRM2_FIELD_CONTRACT.deal.close_date.label}
                helperText={CRM2_FIELD_CONTRACT.deal.close_date.helperText}
                value={closeDate}
                onChange={(e) => setCloseDate(e.target.value)}
                onBlur={() => handleBlur('close_date')}
                error={errors['close_date'] || serverFieldErrors?.['close_date']?.[0]}
                required
                aria-required="true"
              />
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-5 border-t border-slate-200">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={handleCancelClick}
            disabled={isSubmitting}
            aria-label="Cancel form changes"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={isSubmitting}
            aria-label={isEditing ? 'Save Deal Updates' : 'Create Deal'}
          >
            {isSubmitting ? 'Saving Opportunity...' : isEditing ? 'Save Changes' : 'Create Opportunity'}
          </Button>
        </div>
      </form>

      {/* Confirmation modal on discarding dirty changes */}
      <ConfirmModal
        isOpen={showCancelConfirm}
        title="Discard Unsaved Changes?"
        message="You have unsaved changes in this form. If you proceed, all your modifications will be discarded."
        confirmLabel="Discard Changes"
        cancelLabel="Continue Editing"
        variant="danger"
        onConfirm={() => {
          setShowCancelConfirm(false);
          onCancel();
        }}
        onCancel={() => setShowCancelConfirm(false)}
      />
    </>
  );
}
