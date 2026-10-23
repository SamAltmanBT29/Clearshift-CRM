import React, { useState, useEffect } from 'react';
import {
  Card,
  Button,
  Spinner,
} from '@clearshift/ui';
import {
  type Deal,
  type Stage,
  type CreateDealInput,
  type UpdateDealInput,
} from '@clearshift/contracts';
import {
  getDealById,
  getStages,
  createDeal,
  updateDeal,
  Crm2ApiError,
} from '../api/crm-2.js';
import { DealForm } from '../components/forms/DealForm.js';

export interface DealFormPageProps {
  dealId?: string | null | undefined;
  onBackToList: () => void;
  onSuccess: (deal: Deal) => void;
}

export function DealFormPage({
  dealId,
  onBackToList,
  onSuccess,
}: DealFormPageProps) {
  const isEditing = Boolean(dealId);

  const [initialDeal, setInitialDeal] = useState<Deal | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [isLoading, setIsLoading] = useState(isEditing);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string[]> | null>(null);

  useEffect(() => {
    let isSubscribed = true;

    // Load available stages
    getStages()
      .then((res) => {
        if (isSubscribed) setStages(res.items);
      })
      .catch((err) => console.warn('Failed to load stages:', err));

    // If editing, load deal data
    if (dealId) {
      setIsLoading(true);
      getDealById(dealId)
        .then((deal) => {
          if (isSubscribed) setInitialDeal(deal);
        })
        .catch((err) => {
          if (isSubscribed) {
            setServerError(err.message || 'Failed to retrieve deal data.');
          }
        })
        .finally(() => {
          if (isSubscribed) setIsLoading(false);
        });
    }

    return () => {
      isSubscribed = false;
    };
  }, [dealId]);

  const handleSubmit = async (formData: CreateDealInput | UpdateDealInput) => {
    setIsSubmitting(true);
    setServerError(null);
    setServerFieldErrors(null);

    try {
      let saved: Deal;
      if (isEditing && dealId) {
        saved = await updateDeal(dealId, formData);
      } else {
        saved = await createDeal(formData as CreateDealInput);
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
        setServerError(err.message || 'An unexpected error occurred while saving.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-24 max-w-7xl mx-auto px-4" data-testid="form-page-loading">
        <Spinner label="Loading deal editor..." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 animate-in fade-in duration-150">
      {/* Header and Back Link */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBackToList}
            aria-label="Back to Deals List"
            className="text-slate-600 hover:text-slate-900"
          >
            ← Back to Deals
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {isEditing ? 'Edit Sales Deal' : 'New Sales Opportunity'}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {isEditing
                ? 'Update opportunity attributes, pipeline stage progression, or linked contact.'
                : 'Create a new V1 sales deal record with values validated against ClearShift contracts.'}
            </p>
          </div>
        </div>
      </div>

      {/* Main Form Card */}
      <Card className="p-6 sm:p-8">
        <DealForm
          initialDeal={initialDeal}
          stages={stages}
          isSubmitting={isSubmitting}
          serverError={serverError}
          serverFieldErrors={serverFieldErrors}
          onSubmit={handleSubmit}
          onCancel={onBackToList}
        />
      </Card>
    </div>
  );
}
