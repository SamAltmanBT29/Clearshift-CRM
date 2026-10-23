/**
 * ListFormPage — Create or edit a CRM-4 Marketing List
 *
 * Create mode: no listId prop → POST /api/v1/crm-marketing/lists
 * Edit mode:   listId prop   → loads existing list, then PATCH /api/v1/crm-marketing/lists/{id}
 *
 * Links back to: Marketing Lists (onBackToList)
 */
import React, { useState, useEffect } from 'react';
import { Card, Button, Spinner } from '@cs/ui';
import type { CRM4List, CRM4ListCreate, CRM4ListPatch } from '@clearshift/contracts';
import {
  getMarketingLists,
  createList,
  patchList,
  Crm4ApiError,
} from '../api/crm-4.js';
import { ListForm } from '../components/forms/ListForm.js';

export interface ListFormPageProps {
  /** Provide to enter edit mode; omit for create */
  listId?: string | null;
  onBackToList: () => void;
  onSuccess: (list: CRM4List) => void;
}

export function ListFormPage({ listId, onBackToList, onSuccess }: ListFormPageProps) {
  const isEditing = Boolean(listId);

  const [initialList, setInitialList] = useState<CRM4List | null>(null);
  const [isLoading, setIsLoading] = useState(isEditing);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string[]> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load existing list on edit mode
  useEffect(() => {
    if (!listId) return;
    let active = true;
    setIsLoading(true);
    setLoadError(null);

    getMarketingLists({ page: 1, pageSize: 100 })
      .then((res) => {
        if (!active) return;
        const found = res.items.find((l) => l.id === listId) ?? null;
        if (!found) {
          setLoadError(`Marketing list '${listId}' was not found.`);
        } else {
          setInitialList(found);
        }
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(err instanceof Crm4ApiError ? err.message : 'Failed to load list record.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => { active = false; };
  }, [listId]);

  const handleSubmit = async (data: CRM4ListCreate | CRM4ListPatch) => {
    setIsSubmitting(true);
    setServerError(null);
    setServerFieldErrors(null);

    try {
      let result: CRM4List;
      if (isEditing && listId) {
        result = await patchList(listId, data as CRM4ListPatch);
      } else {
        result = await createList(data as CRM4ListCreate);
      }
      onSuccess(result);
    } catch (err) {
      if (err instanceof Crm4ApiError) {
        if (err.details && typeof err.details === 'object') {
          const details = err.details as Record<string, string[]>;
          setServerFieldErrors(details);
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
      {/* Breadcrumb / back link */}
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

      {/* Page header */}
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {isEditing ? 'Edit Marketing List' : 'New Marketing List'}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {isEditing
            ? 'Update the name or description of this audience segment.'
            : 'Create a new audience segment for use in CRM-4 campaign history.'}
        </p>
      </div>

      {/* Loading state (edit mode fetch) */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <Spinner label="Loading list record..." />
        </div>
      )}

      {/* Load error */}
      {loadError && !isLoading && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">Failed to load list</p>
          <p className="mt-1">{loadError}</p>
          <Button variant="outline" size="sm" onClick={onBackToList} className="mt-3">
            ← Back to Lists
          </Button>
        </div>
      )}

      {/* Form */}
      {!isLoading && !loadError && (
        <Card className="p-6">
          <ListForm
            initialList={initialList}
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

export default ListFormPage;
