/**
 * ConsentForm — Set contact consent record (POST /api/v1/crm-marketing/consents)
 *
 * Domain rules enforced (BR-CRM4-01):
 *   - If current consent is 'unsubscribed', the 'subscribed' option is DISABLED
 *     (opt-out is strictly monotonic — cannot be reverted by UI action)
 *   - consentDate defaults to now
 *   - source is required
 *
 * Shows existing consent record read-only above the form when available.
 * API: POST /api/v1/crm-marketing/consents
 */
import React, { useState, useEffect } from 'react';
import {
  Input,
  Button,
  Alert,
  Badge,
} from '@cs/ui';
import type { CRM4Consent, CRM4ConsentSet } from '@clearshift/contracts';
import { CRM4_CONSENT_STATUSES } from '@clearshift/contracts';

export interface ConsentFormProps {
  contactId: string;
  /** Current persisted consent record for this contact (if any) */
  currentConsent?: CRM4Consent | null;
  isSubmitting?: boolean;
  serverError?: string | null;
  serverFieldErrors?: Record<string, string[]> | null;
  onSubmit: (data: CRM4ConsentSet) => void;
  onCancel: () => void;
}

function nowISO(): string {
  return new Date().toISOString();
}

export function ConsentForm({
  contactId,
  currentConsent,
  isSubmitting = false,
  serverError,
  serverFieldErrors,
  onSubmit,
  onCancel,
}: ConsentFormProps) {
  // BR-CRM4-01: subscribed is blocked when current consent is unsubscribed
  const isCurrentlyUnsubscribed = currentConsent?.status === 'unsubscribed';

  const [status, setStatus] = useState<'subscribed' | 'unsubscribed'>(
    // Default to current status if available; if unsubscribed, stay unsubscribed
    isCurrentlyUnsubscribed ? 'unsubscribed' : (currentConsent?.status ?? 'subscribed')
  );
  const [consentDate, setConsentDate] = useState(
    currentConsent?.consentDate?.slice(0, 16) ?? nowISO().slice(0, 16)
  );
  const [source, setSource] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (isCurrentlyUnsubscribed) {
      setStatus('unsubscribed');
    }
  }, [isCurrentlyUnsubscribed]);

  // Client validation
  const errors: Record<string, string> = {};
  if (touched['source'] && source.trim().length === 0) {
    errors['source'] = 'Consent source is required (e.g. "Double opt-in form", "CSV import v2").';
  }
  if (touched['consentDate'] && !consentDate) {
    errors['consentDate'] = 'Consent date is required.';
  }

  const handleBlur = (field: string) => setTouched((t) => ({ ...t, [field]: true }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ source: true, consentDate: true });

    if (source.trim().length === 0) return;
    if (!consentDate) return;

    // BR-CRM4-01: final guard — cannot submit subscribed if currently unsubscribed
    if (isCurrentlyUnsubscribed && status === 'subscribed') {
      return; // UI already disabled the radio; this is a belt-and-suspenders guard
    }

    const payload: CRM4ConsentSet = {
      contactId,
      status,
      consentDate: consentDate ? new Date(consentDate).toISOString() : undefined,
      source: source.trim(),
    };
    onSubmit(payload);
  };

  return (
    <form
      id="crm4-consent-form"
      onSubmit={handleSubmit}
      className="space-y-6"
      aria-label="Set contact consent record"
      noValidate
    >
      {/* Server error banner */}
      {serverError && (
        <Alert variant="error" title="Consent Update Failed">
          <p className="text-sm">{serverError}</p>
          <p className="text-xs text-rose-700 mt-1">
            Your entered values have been preserved. Correct the issues and retry.
          </p>
        </Alert>
      )}

      {/* Current consent — read-only panel */}
      {currentConsent && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Current Consent Record (Read-only)
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <span className="text-xs text-slate-400 block">Status</span>
              <Badge
                variant={currentConsent.status === 'subscribed' ? 'success' : 'danger'}
                size="sm"
              >
                {currentConsent.status}
              </Badge>
            </div>
            <div>
              <span className="text-xs text-slate-400 block">Date</span>
              <span className="text-slate-800">
                {new Date(currentConsent.consentDate).toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-xs text-slate-400 block">Source</span>
              <span className="text-slate-800">{currentConsent.source}</span>
            </div>
          </div>
        </div>
      )}

      {/* BR-CRM4-01 opt-out monotonic warning */}
      {isCurrentlyUnsubscribed && (
        <div
          data-testid="crm4-consent-monotonic-warning"
          role="alert"
          className="flex gap-3 p-4 bg-red-50 border border-red-300 rounded-lg text-red-900 text-sm"
        >
          <span className="text-lg" aria-hidden="true">⛔</span>
          <div>
            <p className="font-bold">BR-CRM4-01 — Opt-out is Strictly Monotonic</p>
            <p className="text-xs mt-1 leading-relaxed">
              This contact's consent status is <strong>unsubscribed</strong>. Per ClearShift domain
              rules, an opt-out cannot be reverted to subscribed by any UI action, migration, or
              bulk update. Only a verified re-subscription event with a new source may update this
              record; that must be submitted through an approved workflow.
            </p>
          </div>
        </div>
      )}

      {/* Status radio group */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-slate-700">
          New Consent Status <span className="text-red-500">*</span>
        </legend>
        {CRM4_CONSENT_STATUSES.map((s) => {
          const isDisabled = s === 'subscribed' && isCurrentlyUnsubscribed;
          return (
            <label
              key={s}
              htmlFor={`crm4-consent-status-${s}`}
              className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                isDisabled
                  ? 'opacity-40 cursor-not-allowed bg-slate-50 border-slate-200'
                  : status === s
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <input
                id={`crm4-consent-status-${s}`}
                type="radio"
                name="crm4-consent-status"
                value={s}
                checked={status === s}
                disabled={isDisabled}
                onChange={() => !isDisabled && setStatus(s)}
                className="h-4 w-4 text-indigo-600 border-slate-300 focus:ring-indigo-500"
                aria-label={
                  isDisabled
                    ? `${s} (blocked — BR-CRM4-01: opt-out is monotonic)`
                    : `Set consent to ${s}`
                }
              />
              <div>
                <span className="font-medium text-slate-800 capitalize">{s}</span>
                {s === 'subscribed' && isDisabled && (
                  <span className="block text-xs text-red-600 mt-0.5">
                    Blocked — existing opt-out cannot be reverted (BR-CRM4-01)
                  </span>
                )}
              </div>
            </label>
          );
        })}
      </fieldset>

      {/* Consent date */}
      <Input
        id="crm4-consent-date"
        type="datetime-local"
        label="Consent Date"
        value={consentDate}
        onChange={(e) => setConsentDate(e.target.value)}
        onBlur={() => handleBlur('consentDate')}
        error={errors['consentDate'] || serverFieldErrors?.['consentDate']?.[0]}
        required
        aria-required="true"
        helperText="The date and time of the consent event. Defaults to now; adjust for imported historical data."
      />

      {/* Source */}
      <Input
        id="crm4-consent-source"
        label="Consent Source"
        placeholder='e.g. "Double opt-in email form", "CSV import batch #42"'
        value={source}
        onChange={(e) => setSource(e.target.value)}
        onBlur={() => handleBlur('source')}
        error={errors['source'] || serverFieldErrors?.['source']?.[0]}
        required
        aria-required="true"
        helperText="A human-readable description of the event or system that triggered this consent change."
      />

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-5 border-t border-slate-200">
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={onCancel}
          disabled={isSubmitting}
          aria-label="Cancel consent update"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={isSubmitting || Object.keys(errors).length > 0}
          aria-label="Save consent record"
        >
          {isSubmitting ? 'Saving...' : 'Save Consent Record'}
        </Button>
      </div>
    </form>
  );
}
