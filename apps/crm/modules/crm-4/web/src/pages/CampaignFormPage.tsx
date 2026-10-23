/**
 * CampaignFormPage — Create or edit a CRM-4 Campaign
 *
 * Create mode: campaignId prop absent → POST /api/v1/crm-marketing/campaigns
 * Edit mode:   campaignId prop present → loads existing campaign, PATCH /api/v1/crm-marketing/campaigns/{id}
 *
 * Links back to: Marketing Lists (onBackToList)
 */
import React, { useState, useEffect } from 'react';
import { Card, Button, Spinner } from '@clearshift/ui';
import type {
  CRM4Campaign,
  CRM4List,
  CRM4CampaignCreate,
  CRM4CampaignPatch,
} from '@clearshift/contracts';
import {
  getCampaignById,
  getMarketingLists,
  createCampaign,
  patchCampaign,
  Crm4ApiError,
} from '../api/crm-4.js';
import { CampaignForm } from '../components/forms/CampaignForm.js';

export interface CampaignFormPageProps {
  /** Provide for edit mode; omit for create */
  campaignId?: string | null;
  /** Pre-selected listId when creating from a list detail view */
  defaultListId?: string | null;
  onBackToList: () => void;
  onSuccess: (campaign: CRM4Campaign) => void;
}

export function CampaignFormPage({
  campaignId,
  defaultListId,
  onBackToList,
  onSuccess,
}: CampaignFormPageProps) {
  const isEditing = Boolean(campaignId);

  const [initialCampaign, setInitialCampaign] = useState<CRM4Campaign | null>(null);
  const [availableLists, setAvailableLists] = useState<CRM4List[]>([]);
  const [isLoading, setIsLoading] = useState(isEditing);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string[]> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load campaign (edit) and available lists (create)
  useEffect(() => {
    let active = true;

    const loadLists = getMarketingLists({ page: 1, pageSize: 100 })
      .then((res) => { if (active) setAvailableLists(res.items); })
      .catch(() => {}); // non-fatal — select will be empty

    if (campaignId) {
      setIsLoading(true);
      Promise.all([
        getCampaignById(campaignId),
        loadLists,
      ])
        .then(([campaign]) => {
          if (active) setInitialCampaign(campaign);
        })
        .catch((err) => {
          if (active) {
            setLoadError(err instanceof Crm4ApiError ? err.message : 'Failed to load campaign.');
          }
        })
        .finally(() => { if (active) setIsLoading(false); });
    }

    return () => { active = false; };
  }, [campaignId]);

  const handleSubmit = async (data: CRM4CampaignCreate | CRM4CampaignPatch) => {
    setIsSubmitting(true);
    setServerError(null);
    setServerFieldErrors(null);

    try {
      let result: CRM4Campaign;
      if (isEditing && campaignId) {
        result = await patchCampaign(campaignId, data as CRM4CampaignPatch);
      } else {
        // Inject defaultListId if provided and not in payload
        const createPayload = data as CRM4CampaignCreate;
        if (defaultListId && !createPayload.listId) {
          createPayload.listId = defaultListId;
        }
        result = await createCampaign(createPayload);
      }
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
        setServerError('An unexpected error occurred. Please retry.');
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
          aria-label="Back to Marketing Lists"
        >
          ← Marketing Lists
        </button>
      </div>

      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {isEditing ? 'Edit Campaign' : 'Record New Campaign'}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {isEditing
            ? 'Update the campaign name or date. The linked list cannot be changed.'
            : 'Record a new campaign history entry. No outbound email or SMS is sent (V1 history only).'}
        </p>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Spinner label="Loading campaign record..." />
        </div>
      )}

      {loadError && !isLoading && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">Failed to load campaign</p>
          <p className="mt-1">{loadError}</p>
          <Button variant="outline" size="sm" onClick={onBackToList} className="mt-3">
            ← Back to Lists
          </Button>
        </div>
      )}

      {!isLoading && !loadError && (
        <Card className="p-6">
          <CampaignForm
            initialCampaign={initialCampaign}
            availableLists={availableLists}
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

export default CampaignFormPage;
