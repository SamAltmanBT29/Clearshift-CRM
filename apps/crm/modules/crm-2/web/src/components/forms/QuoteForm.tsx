import React, { useState, useEffect } from 'react';
import {
  Input,
  Select,
  Button,
  Alert,
} from '@clearshift/ui';
import {
  type Quote,
  type CreateQuoteInput,
  type UpdateQuoteInput,
  CRM2_FIELD_CONTRACT,
} from '@clearshift/contracts';
import { ConfirmModal } from './ConfirmModal.js';

export interface QuoteFormProps {
  initialQuote?: Quote | null | undefined;
  dealId: string;
  dealName?: string | undefined;
  isSubmitting?: boolean | undefined;
  serverError?: string | null | undefined;
  serverFieldErrors?: Record<string, string[]> | null | undefined;
  onSubmit: (data: CreateQuoteInput | UpdateQuoteInput) => Promise<void>;
  onCancel: () => void;
}

export function QuoteForm({
  initialQuote,
  dealId,
  dealName,
  isSubmitting = false,
  serverError,
  serverFieldErrors,
  onSubmit,
  onCancel,
}: QuoteFormProps) {
  const isEditing = Boolean(initialQuote?.id);

  // Form field state
  const [quoteNumber, setQuoteNumber] = useState(initialQuote?.quote_number ?? '');
  const [date, setDate] = useState(initialQuote?.date ?? '');
  const [amount, setAmount] = useState(initialQuote?.amount ?? '');
  const [currency, setCurrency] = useState(initialQuote?.currency ?? 'USD');
  const [note, setNote] = useState(initialQuote?.note ?? '');

  // Validation state
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, setTouched] = useState<Record<string, boolean>>({});

  // Confirmation dialog state
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Track if user changed any field
  const isDirty =
    quoteNumber !== (initialQuote?.quote_number ?? '') ||
    date !== (initialQuote?.date ?? '') ||
    amount !== (initialQuote?.amount ?? '') ||
    currency !== (initialQuote?.currency ?? 'USD') ||
    note !== (initialQuote?.note ?? '');

  useEffect(() => {
    if (initialQuote) {
      setQuoteNumber(initialQuote.quote_number);
      setDate(initialQuote.date);
      setAmount(initialQuote.amount);
      setCurrency(initialQuote.currency);
      setNote(initialQuote.note ?? '');
    }
  }, [initialQuote]);

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
      case 'quote_number':
        if (!val || val.trim() === '') {
          return CRM2_FIELD_CONTRACT.quote.quote_number.errorRequired;
        }
        return undefined;

      case 'date':
        if (!val || !/^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
          return CRM2_FIELD_CONTRACT.quote.date.errorInvalid;
        }
        return undefined;

      case 'amount':
        if (!val || val.trim() === '') {
          return 'Quote amount is required';
        }
        if (!/^\d+(\.\d{1,4})?$/.test(val.trim())) {
          return CRM2_FIELD_CONTRACT.quote.amount.errorInvalid;
        }
        if (Number.parseFloat(val) < 0) {
          return 'Quote amount must be non-negative';
        }
        return undefined;

      case 'currency':
        if (!val || !/^[A-Z]{3}$/.test(val.trim())) {
          return CRM2_FIELD_CONTRACT.quote.currency.errorInvalid;
        }
        return undefined;

      default:
        return undefined;
    }
  };

  const handleBlur = (fieldName: string) => {
    setTouched((prev) => ({ ...prev, [fieldName]: true }));
    let val = '';
    if (fieldName === 'quote_number') val = quoteNumber;
    if (fieldName === 'date') val = date;
    if (fieldName === 'amount') val = amount;
    if (fieldName === 'currency') val = currency;

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

    const newErrors: Record<string, string> = {};
    const qErr = validateField('quote_number', quoteNumber);
    if (qErr) newErrors['quote_number'] = qErr;

    const dErr = validateField('date', date);
    if (dErr) newErrors['date'] = dErr;

    const aErr = validateField('amount', amount);
    if (aErr) newErrors['amount'] = aErr;

    const cErr = validateField('currency', currency);
    if (cErr) newErrors['currency'] = cErr;

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setTouched({
        quote_number: true,
        date: true,
        amount: true,
        currency: true,
      });
      return;
    }

    const payload: CreateQuoteInput = {
      deal_id: dealId,
      quote_number: quoteNumber.trim(),
      date: date.trim(),
      amount: amount.trim(),
      currency: currency.trim(),
      note: note.trim() !== '' ? note.trim() : null,
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
        aria-label={isEditing ? 'Edit Quote Form' : 'Create Quote Form'}
        className="space-y-6"
      >
        {/* Top Server Error Alert */}
        {serverError && (
          <Alert variant="error" title="Submission Failed">
            <p className="text-sm font-medium">{serverError}</p>
            <p className="text-xs text-rose-700 mt-1">
              Your entered values have been preserved. Please correct any conflicts and retry.
            </p>
          </Alert>
        )}

        {/* Read-Only Context: Linked Deal */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Linked Parent Deal
            </span>
            <span className="text-sm font-semibold text-slate-900 block truncate">
              {dealName || 'Target Deal'}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              Deal ID: {dealId}
            </span>
          </div>
          {isEditing && initialQuote && (
            <div>
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Quote ID
              </span>
              <span className="text-sm font-mono text-slate-900 select-all font-medium">
                {initialQuote.id}
              </span>
              <p className="text-xs text-slate-400 mt-0.5">Read-only immutable identifier</p>
            </div>
          )}
        </div>

        {/* Primary Quote Fields */}
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Input
                id="quote-number-input"
                label={CRM2_FIELD_CONTRACT.quote.quote_number.label}
                helperText={CRM2_FIELD_CONTRACT.quote.quote_number.helperText}
                placeholder="e.g. Q-2026-101"
                value={quoteNumber}
                onChange={(e) => setQuoteNumber(e.target.value)}
                onBlur={() => handleBlur('quote_number')}
                error={errors['quote_number'] || serverFieldErrors?.['quote_number']?.[0]}
                required
                aria-required="true"
              />
            </div>
            <div>
              <Input
                id="quote-date-input"
                type="date"
                label={CRM2_FIELD_CONTRACT.quote.date.label}
                helperText={CRM2_FIELD_CONTRACT.quote.date.helperText}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                onBlur={() => handleBlur('date')}
                error={errors['date'] || serverFieldErrors?.['date']?.[0]}
                required
                aria-required="true"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <Input
                id="quote-amount-input"
                label={CRM2_FIELD_CONTRACT.quote.amount.label}
                helperText={CRM2_FIELD_CONTRACT.quote.amount.helperText}
                placeholder="50000.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onBlur={() => handleBlur('amount')}
                error={errors['amount'] || serverFieldErrors?.['amount']?.[0]}
                required
                aria-required="true"
              />
            </div>
            <div>
              <Select
                id="quote-currency-select"
                label={CRM2_FIELD_CONTRACT.quote.currency.label}
                options={currencyOptions}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                onBlur={() => handleBlur('currency')}
                error={errors['currency'] || serverFieldErrors?.['currency']?.[0]}
                required
              />
            </div>
          </div>

          <div>
            <div className="flex flex-col gap-1.5 w-full">
              <label htmlFor="quote-note-input" className="text-sm font-medium text-slate-700">
                {CRM2_FIELD_CONTRACT.quote.note.label}
              </label>
              <textarea
                id="quote-note-input"
                rows={3}
                placeholder="Scope specifications, SLA terms, delivery schedule..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
              <p className="text-xs text-slate-500">
                {CRM2_FIELD_CONTRACT.quote.note.helperText}
              </p>
            </div>
          </div>
        </div>

        {/* Form Action Controls */}
        <div className="flex items-center justify-end gap-3 pt-5 border-t border-slate-200">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={handleCancelClick}
            disabled={isSubmitting}
            aria-label="Cancel quote editing"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={isSubmitting}
            aria-label={isEditing ? 'Save Quote Changes' : 'Create Quote'}
          >
            {isSubmitting ? 'Saving Quote...' : isEditing ? 'Save Quote' : 'Create Quote'}
          </Button>
        </div>
      </form>

      {/* Confirmation modal on discarding dirty changes */}
      <ConfirmModal
        isOpen={showCancelConfirm}
        title="Discard Quote Changes?"
        message="You have unsaved changes in this quote. If you cancel, your edits will not be saved."
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
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
