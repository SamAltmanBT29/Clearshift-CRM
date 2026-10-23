/**
 * CampaignForm — Create / Edit form for CRM-4 Campaigns
 *
 * Fields:
 *   - name (required)
 *   - campaignDate (required, YYYY-MM-DD format)
 *   - listId (required on create; READ-ONLY on edit — domain rule: listId is immutable after creation)
 *
 * Domain: FR-CRM4-02; No actual campaign transmission (V1 records only)
 * API: POST /api/v1/crm-marketing/campaigns, PATCH /api/v1/crm-marketing/campaigns/{id}
 */
import React, { useState, useEffect } from 'react';
import {
  Input,
  Button,
  Alert,
  Select,
} from '@clearshift/ui';
import type {
  CRM4Campaign,
  CRM4List,
  CRM4CampaignCreate,
  CRM4CampaignPatch,
} from '@clearshift/contracts';
import { ConfirmModal } from './ConfirmModal.js';

export interface CampaignFormProps {
  /** Provide when editing an existing campaign; omit for create */
  initialCampaign?: CRM4Campaign | null;
  /** Available lists for the listId selector (create mode only) */
  availableLists?: CRM4List[];
  isSubmitting?: boolean;
  serverError?: string | null;
  serverFieldErrors?: Record<string, string[]> | null;
  onSubmit: (data: CRM4CampaignCreate | CRM4CampaignPatch) => void;
  onCancel: () => void;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CampaignForm({
  initialCampaign,
  availableLists = [],
  isSubmitting = false,
  serverError,
  serverFieldErrors,
  onSubmit,
  onCancel,
}: CampaignFormProps) {
  const isEditing = Boolean(initialCampaign);

  const [name, setName] = useState(initialCampaign?.name ?? '');
  const [campaignDate, setCampaignDate] = useState(
    initialCampaign?.campaignDate ?? todayISO()
  );
  const [listId, setListId] = useState(initialCampaign?.listId ?? '');

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  useEffect(() => {
    if (initialCampaign) {
      setName(initialCampaign.name);
      setCampaignDate(initialCampaign.campaignDate);
      setListId(initialCampaign.listId);
    }
  }, [initialCampaign?.id]);

  // ---------------------------------------------------------------------------
  // Client validation
  // ---------------------------------------------------------------------------
  const errors: Record<string, string> = {};
  if (touched['name'] && name.trim().length === 0) {
    errors['name'] = 'Campaign name is required.';
  }
  if (touched['campaignDate'] && !/^\d{4}-\d{2}-\d{2}$/.test(campaignDate)) {
    errors['campaignDate'] = 'Date must be in YYYY-MM-DD format.';
  }
  if (touched['listId'] && !isEditing && listId.trim().length === 0) {
    errors['listId'] = 'A marketing list must be selected.';
  }

  const handleBlur = (field: string) => setTouched((t) => ({ ...t, [field]: true }));

  const isDirty = isEditing
    ? name !== initialCampaign?.name || campaignDate !== initialCampaign?.campaignDate
    : name.trim() !== '' || campaignDate !== todayISO() || listId !== '';

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ name: true, campaignDate: true, listId: true });

    if (name.trim().length === 0) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(campaignDate)) return;
    if (!isEditing && listId.trim().length === 0) return;

    if (isEditing) {
      // listId is NOT included in patch payload — immutable after creation
      const payload: CRM4CampaignPatch = {
        name: name.trim(),
        campaignDate,
      };
      onSubmit(payload);
    } else {
      const payload: CRM4CampaignCreate = {
        name: name.trim(),
        campaignDate,
        listId,
      };
      onSubmit(payload);
    }
  };

  const handleCancelClick = () => {
    if (isDirty) {
      setShowCancelConfirm(true);
    } else {
      onCancel();
    }
  };

  const listOptions = availableLists.map((l) => ({ value: l.id, label: l.name }));

  return (
    <>
      <form
        id="crm4-campaign-form"
        onSubmit={handleSubmit}
        className="space-y-6"
        aria-label={isEditing ? 'Edit campaign' : 'Create new campaign'}
        noValidate
      >
        {/* Server error banner */}
        {serverError && (
          <Alert variant="error" title="Save Failed">
            <p className="text-sm">{serverError}</p>
            <p className="text-xs text-rose-700 mt-1">
              Your entered values have been preserved. Correct the issues and retry.
            </p>
          </Alert>
        )}

        {/* Read-only system panel (edit mode) */}
        {isEditing && initialCampaign && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Campaign ID (Read-only)
              </span>
              <span className="text-xs font-mono text-slate-800 select-all break-all">
                {initialCampaign.id}
              </span>
            </div>
            <div>
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Created
              </span>
              <span className="text-sm text-slate-700">
                {new Date(initialCampaign.createdAt).toLocaleString()}
              </span>
            </div>
            <div>
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Members (Server-computed)
              </span>
              <span className="text-lg font-bold text-slate-900">
                {initialCampaign.memberCount ?? 0}
              </span>
            </div>
          </div>
        )}

        {/* Editable fields */}
        <div className="space-y-4">
          <Input
            id="crm4-campaign-name"
            label="Campaign Name"
            placeholder="e.g. November Enterprise Re-Engagement"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => handleBlur('name')}
            error={errors['name'] || serverFieldErrors?.['name']?.[0]}
            required
            aria-required="true"
            helperText="The display name for this recorded campaign (required)."
          />

          <Input
            id="crm4-campaign-date"
            type="date"
            label="Campaign Date"
            value={campaignDate}
            onChange={(e) => setCampaignDate(e.target.value)}
            onBlur={() => handleBlur('campaignDate')}
            error={errors['campaignDate'] || serverFieldErrors?.['campaignDate']?.[0]}
            required
            aria-required="true"
            helperText="Date the campaign was or will be sent (YYYY-MM-DD). History-only; no outbound email/SMS in V1."
          />

          {/* listId: editable on create, read-only on edit (domain invariant) */}
          {isEditing ? (
            <div>
              <span className="block text-sm font-medium text-slate-700 mb-1">
                Marketing List{' '}
                <span className="text-xs font-normal text-slate-400">(Read-only — immutable after creation)</span>
              </span>
              <div className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-700 font-mono">
                {initialCampaign?.listName ?? initialCampaign?.listId ?? '—'}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                The linked marketing list cannot be changed after a campaign is created.
              </p>
            </div>
          ) : (
            <div>
              <Select
                id="crm4-campaign-list"
                label="Marketing List"
                options={[
                  { value: '', label: '— Select a list —' },
                  ...listOptions,
                ]}
                value={listId}
                onChange={(e) => setListId(e.target.value)}
                onBlur={() => handleBlur('listId')}
                error={errors['listId'] || serverFieldErrors?.['listId']?.[0]}
                required
              />
              <p className="text-xs text-slate-500 mt-1">
                The audience list this campaign targets. Cannot be changed after creation.
              </p>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-3 pt-5 border-t border-slate-200">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={handleCancelClick}
            disabled={isSubmitting}
            aria-label="Cancel and return"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={isSubmitting || Object.keys(errors).length > 0}
            aria-label={isEditing ? 'Save campaign changes' : 'Create campaign'}
          >
            {isSubmitting
              ? isEditing
                ? 'Saving...'
                : 'Creating...'
              : isEditing
                ? 'Save Changes'
                : 'Create Campaign'}
          </Button>
        </div>
      </form>

      <ConfirmModal
        isOpen={showCancelConfirm}
        title="Discard Unsaved Changes?"
        message="You have unsaved changes. If you proceed, all modifications will be lost."
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
