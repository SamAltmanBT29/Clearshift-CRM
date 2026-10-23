/**
 * ListForm — Create / Edit form for CRM-4 Marketing Lists
 *
 * Fields: name (required, min 1), description (optional)
 * Read-only on edit: id, createdAt, campaignCount, memberCount
 * Domain: FR-CRM4-01; API: POST /api/v1/crm-marketing/lists, PATCH /api/v1/crm-marketing/lists/{id}
 */
import React, { useState, useEffect } from 'react';
import {
  Input,
  Button,
  Alert,
} from '@clearshift/ui';
import type { CRM4List, CRM4ListCreate, CRM4ListPatch } from '@clearshift/contracts';
import { ConfirmModal } from './ConfirmModal.js';

export interface ListFormProps {
  /** Provide when editing an existing list; omit for create */
  initialList?: CRM4List | null;
  isSubmitting?: boolean;
  serverError?: string | null;
  /** Field-level errors returned from server (fieldName -> first message) */
  serverFieldErrors?: Record<string, string[]> | null;
  onSubmit: (data: CRM4ListCreate | CRM4ListPatch) => void;
  onCancel: () => void;
}

export function ListForm({
  initialList,
  isSubmitting = false,
  serverError,
  serverFieldErrors,
  onSubmit,
  onCancel,
}: ListFormProps) {
  const isEditing = Boolean(initialList);

  // Controlled fields
  const [name, setName] = useState(initialList?.name ?? '');
  const [description, setDescription] = useState(initialList?.description ?? '');

  // Client-side touched map for blur-on-change validation
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Reset when initialList changes (e.g. data loaded after mount)
  useEffect(() => {
    if (initialList) {
      setName(initialList.name);
      setDescription(initialList.description ?? '');
    }
  }, [initialList?.id]);

  // ---------------------------------------------------------------------------
  // Client validation
  // ---------------------------------------------------------------------------
  const errors: Record<string, string> = {};
  if (touched['name'] && name.trim().length === 0) {
    errors['name'] = 'List name is required.';
  }

  const handleBlur = (field: string) => setTouched((t) => ({ ...t, [field]: true }));

  const isDirty = isEditing
    ? name !== (initialList?.name ?? '') || description !== (initialList?.description ?? '')
    : name.trim() !== '' || description.trim() !== '';

  // ---------------------------------------------------------------------------
  // Submit handler
  // ---------------------------------------------------------------------------
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Mark all fields touched on submit attempt
    setTouched({ name: true });

    if (name.trim().length === 0) return;

    const payload: CRM4ListCreate | CRM4ListPatch = {
      name: name.trim(),
      description: description.trim() || null,
    };
    onSubmit(payload);
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
        id="crm4-list-form"
        onSubmit={handleSubmit}
        className="space-y-6"
        aria-label={isEditing ? 'Edit marketing list' : 'Create new marketing list'}
        noValidate
      >
        {/* Server error banner */}
        {serverError && (
          <Alert variant="error" title="Save Failed">
            <p className="text-sm">{serverError}</p>
            <p className="text-xs text-rose-700 mt-1">
              Your entered values have been preserved. Please correct the issues and retry.
            </p>
          </Alert>
        )}

        {/* Read-only system panel (edit mode only) */}
        {isEditing && initialList && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                List ID (Read-only)
              </span>
              <span className="text-xs font-mono text-slate-800 select-all break-all">
                {initialList.id}
              </span>
            </div>
            <div>
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Created
              </span>
              <span className="text-sm text-slate-700">
                {new Date(initialList.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Campaigns
                </span>
                <span className="text-lg font-bold text-slate-900">{initialList.campaignCount}</span>
                <p className="text-xs text-slate-400">Server-computed</p>
              </div>
              <div>
                <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Members
                </span>
                <span className="text-lg font-bold text-slate-900">{initialList.memberCount}</span>
                <p className="text-xs text-slate-400">Server-computed</p>
              </div>
            </div>
          </div>
        )}

        {/* Editable fields */}
        <div className="space-y-4">
          <Input
            id="crm4-list-name"
            label="List Name"
            placeholder="e.g. Q4 Enterprise Prospects"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => handleBlur('name')}
            error={errors['name'] || serverFieldErrors?.['name']?.[0]}
            required
            aria-required="true"
            helperText="The display name of this audience segment (required)."
          />

          <div className="space-y-1">
            <label
              htmlFor="crm4-list-description"
              className="block text-sm font-medium text-slate-700"
            >
              Description{' '}
              <span className="text-slate-400 font-normal text-xs">(optional)</span>
            </label>
            <textarea
              id="crm4-list-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder:text-slate-400 resize-none"
              placeholder="Describe the audience criteria or segment purpose..."
              aria-describedby="crm4-list-description-hint"
            />
            <p id="crm4-list-description-hint" className="text-xs text-slate-500">
              Optional free-text description. Not used for targeting or filtering.
            </p>
            {serverFieldErrors?.['description']?.[0] && (
              <p className="text-xs text-red-600">{serverFieldErrors['description'][0]}</p>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-3 pt-5 border-t border-slate-200">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={handleCancelClick}
            disabled={isSubmitting}
            aria-label="Cancel and return to list"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={isSubmitting || Object.keys(errors).length > 0}
            aria-label={isEditing ? 'Save list changes' : 'Create marketing list'}
          >
            {isSubmitting
              ? isEditing
                ? 'Saving...'
                : 'Creating...'
              : isEditing
                ? 'Save Changes'
                : 'Create List'}
          </Button>
        </div>
      </form>

      {/* Dirty-state cancel confirmation */}
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
