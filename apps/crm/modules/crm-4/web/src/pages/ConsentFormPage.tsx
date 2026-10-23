/**
 * ConsentFormPage — Manage and set contact consent record
 *
 * Domain rules enforced (BR-CRM4-01):
 *   - Opt-out/unsubscribe is strictly monotonic
 *   - An existing 'unsubscribed' consent status cannot be reverted to 'subscribed'
 *   - Source and consentDate are preserved and recorded
 *
 * API:
 *   - GET  /api/v1/crm-marketing/consents/{contactId}
 *   - POST /api/v1/crm-marketing/consents
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, Spinner, Alert } from '@cs/ui';
import type { CRM4Consent, CRM4ConsentSet } from '@clearshift/contracts';
import {
  getConsent,
  setConsent,
  Crm4ApiError,
} from '../api/crm-4.js';
import { ConsentForm } from '../components/forms/ConsentForm.js';

export interface ConsentFormPageProps {
  contactId: string;
  onBackToList: () => void;
  onSuccess: (consent: CRM4Consent) => void;
}

export function ConsentFormPage({
  contactId,
  onBackToList,
  onSuccess,
}: ConsentFormPageProps) {
  const [currentConsent, setCurrentConsent] = useState<CRM4Consent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string[]> | null>(null);

  const fetchConsent = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const consent = await getConsent(contactId);
      setCurrentConsent(consent);
    } catch (err) {
      setLoadError(
        err instanceof Crm4ApiError ? err.message : 'Failed to retrieve current consent record.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    fetchConsent();
  }, [fetchConsent]);

  const handleSubmit = async (data: CRM4ConsentSet) => {
    setIsSubmitting(true);
    setServerError(null);
    setServerFieldErrors(null);

    try {
      const result = await setConsent(data);
      onSuccess(result);
    } catch (err) {
      if (err instanceof Crm4ApiError) {
        if (err.details && typeof err.details === 'object') {
          setServerFieldErrors(err.details as Record<string, string[]>);
          setServerError('Validation failed. Please review the highlighted fields.');
        } else {
          setServerError(err.message);
        }
      } else {
        setServerError('An unexpected error occurred while saving consent. Please retry.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto w-full px-4 sm:px-6 py-8">
      {/* Back link */}
      <div>
        <button
          type="button"
          onClick={onBackToList}
          className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
          aria-label="Back to previous screen"
        >
          ← Back
        </button>
      </div>

      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Manage Contact Consent
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Contact UUID: <span className="font-mono text-slate-700">{contactId}</span>
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Per BR-CRM4-01, consent updates are strictly monotonic: once a contact unsubscribes,
          the status cannot be reverted to subscribed by standard UI or import actions.
        </p>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Spinner label="Checking contact consent record..." />
        </div>
      )}

      {loadError && !isLoading && (
        <Alert variant="error" title="Failed to Load Consent Record">
          <p className="text-sm">{loadError}</p>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchConsent}>
              Retry
            </Button>
            <Button variant="outline" size="sm" onClick={onBackToList}>
              ← Back
            </Button>
          </div>
        </Alert>
      )}

      {!isLoading && !loadError && (
        <Card className="p-6">
          <ConsentForm
            contactId={contactId}
            currentConsent={currentConsent}
            isSubmitting={isSubmitting}
            serverError={serverError}
            serverFieldErrors={serverFieldErrors}
            onSubmit={handleSubmit}
            onCancel={onBackToList}
          />
        </Card>
      )}
    </div>
  );
}

export default ConsentFormPage;
