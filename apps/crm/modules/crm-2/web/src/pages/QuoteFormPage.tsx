import React, { useState, useEffect } from 'react';
import {
  Card,
  Button,
  Spinner,
} from '@clearshift/ui';
import {
  type Quote,
  type Deal,
  type CreateQuoteInput,
  type UpdateQuoteInput,
} from '@clearshift/contracts';
import {
  getDealById,
  getQuoteById,
  createQuote,
  updateQuote,
  Crm2ApiError,
} from '../api/crm-2.js';
import { QuoteForm } from '../components/forms/QuoteForm.js';

export interface QuoteFormPageProps {
  dealId: string;
  quoteId?: string | null | undefined;
  initialDeal?: Deal | null | undefined;
  onBackToDeal: () => void;
  onSuccess: (quote: Quote) => void;
}

export function QuoteFormPage({
  dealId,
  quoteId,
  initialDeal,
  onBackToDeal,
  onSuccess,
}: QuoteFormPageProps) {
  const isEditing = Boolean(quoteId);

  const [deal, setDeal] = useState<Deal | null>(initialDeal ?? null);
  const [initialQuote, setInitialQuote] = useState<Quote | null>(null);
  const [isLoading, setIsLoading] = useState(!initialDeal || isEditing);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string[]> | null>(null);

  useEffect(() => {
    let isSubscribed = true;

    async function loadData() {
      setIsLoading(true);
      try {
        if (!deal) {
          const d = await getDealById(dealId);
          if (isSubscribed) setDeal(d);
        }
        if (quoteId) {
          const q = await getQuoteById(quoteId);
          if (isSubscribed) setInitialQuote(q);
        }
      } catch (err: any) {
        if (isSubscribed) {
          setServerError(err.message || 'Failed to retrieve record data.');
        }
      } finally {
        if (isSubscribed) setIsLoading(false);
      }
    }

    loadData();

    return () => {
      isSubscribed = false;
    };
  }, [dealId, quoteId]);

  const handleSubmit = async (formData: CreateQuoteInput | UpdateQuoteInput) => {
    setIsSubmitting(true);
    setServerError(null);
    setServerFieldErrors(null);

    try {
      let saved: Quote;
      if (isEditing && quoteId) {
        saved = await updateQuote(quoteId, formData);
      } else {
        saved = await createQuote(formData as CreateQuoteInput);
      }
      onSuccess(saved);
    } catch (err: any) {
      if (err instanceof Crm2ApiError) {
        setServerError(err.message);
        if (err.details && typeof err.details === 'object') {
          const det = err.details as any;
          if (det.fieldErrors) {
            setServerFieldErrors(det.fieldErrors);
          }
        }
      } else {
        setServerError(err.message || 'An unexpected error occurred while saving quote.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-24 max-w-7xl mx-auto px-4" data-testid="quote-page-loading">
        <Spinner label="Loading quote editor..." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 animate-in fade-in duration-150">
      {/* Header and Back Link */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBackToDeal}
            aria-label="Back to Deal Details"
            className="text-slate-600 hover:text-slate-900"
          >
            ← Back to Deal
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {isEditing ? 'Edit Commercial Quote' : 'New Commercial Quote'}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {isEditing
                ? 'Update quote amounts, reference number, or commercial notes.'
                : 'Create a simple quote linked to this opportunity per SDS FR-CRM2-04.'}
            </p>
          </div>
        </div>
      </div>

      {/* Main Quote Form Card */}
      <Card className="p-6 sm:p-8">
        <QuoteForm
          initialQuote={initialQuote}
          dealId={dealId}
          dealName={deal?.name ?? undefined}
          isSubmitting={isSubmitting}
          serverError={serverError}
          serverFieldErrors={serverFieldErrors}
          onSubmit={handleSubmit}
          onCancel={onBackToDeal}
        />
      </Card>
    </div>
  );
}
