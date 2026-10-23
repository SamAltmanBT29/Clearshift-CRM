import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Select } from '@cs/ui';
import {
  CRM1CompanyCreateSchema,
  CRM1ContactCreateSchema,
  CRM1LeadCreateSchema,
  CRM1LeadStatusSchema,
  CRM1_LEAD_STATUS_TRANSITIONS,
  type CRM1Company,
  type CRM1ContactRead,
  type CRM1LeadRead,
} from '@clearshift/contracts/crm-1';

export type Crm1EditorTarget =
  | { entity: 'contact'; record?: CRM1ContactRead }
  | { entity: 'company'; record?: CRM1Company }
  | { entity: 'lead'; record?: CRM1LeadRead };

export type Crm1EditorPayload =
  | ReturnType<typeof CRM1ContactCreateSchema.parse>
  | ReturnType<typeof CRM1CompanyCreateSchema.parse>
  | ReturnType<typeof CRM1LeadCreateSchema.parse>;

export type Crm1EditorSubmission =
  | { entity: 'contact'; id: string | undefined; payload: ReturnType<typeof CRM1ContactCreateSchema.parse> }
  | { entity: 'company'; id: string | undefined; payload: ReturnType<typeof CRM1CompanyCreateSchema.parse> }
  | { entity: 'lead'; id: string | undefined; payload: ReturnType<typeof CRM1LeadCreateSchema.parse> };

export interface Crm1RecordEditorProps {
  target: Crm1EditorTarget;
  onClose: () => void;
  onSave: (submission: Crm1EditorSubmission) => Promise<void>;
}

const LEAD_STATUS_OPTIONS = CRM1LeadStatusSchema.options.map((status) => ({
  value: status,
  label: status,
}));

export function Crm1RecordEditor({ target, onClose, onSave }: Crm1RecordEditorProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const title = `${target.record ? 'Edit' : 'Create'} ${target.entity}`;
  const leadStatusOptions = target.entity === 'lead' && target.record
    ? [target.record.status, ...CRM1_LEAD_STATUS_TRANSITIONS[target.record.status]].map((status) => ({
      value: status,
      label: status,
    }))
    : LEAD_STATUS_OPTIONS;

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    return () => previousFocusRef.current?.focus();
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? '').trim();
    const nullableText = (name: string) => text(name) || null;

    setIsSaving(true);
    try {
      if (target.entity === 'contact') {
        const input = CRM1ContactCreateSchema.safeParse({
          firstName: text('firstName'),
          lastName: text('lastName'),
          email: nullableText('email'),
          phone: nullableText('phone'),
          address: nullableText('address'),
          companyId: nullableText('companyId'),
          leadStatus: nullableText('leadStatus'),
        });
        if (!input.success) {
          setError(input.error.issues[0]?.message ?? 'Check the entered values and try again.');
          return;
        }
        await onSave({ entity: 'contact', id: target.record?.id, payload: input.data });
      } else if (target.entity === 'company') {
        const input = CRM1CompanyCreateSchema.safeParse({
          name: text('name'),
          taxNumber: nullableText('taxNumber'),
          email: nullableText('email'),
          phone: nullableText('phone'),
          address: nullableText('address'),
        });
        if (!input.success) {
          setError(input.error.issues[0]?.message ?? 'Check the entered values and try again.');
          return;
        }
        await onSave({ entity: 'company', id: target.record?.id, payload: input.data });
      } else {
        const input = CRM1LeadCreateSchema.safeParse({
          contactId: text('contactId'),
          status: text('status'),
        });
        if (!input.success) {
          setError(input.error.issues[0]?.message ?? 'Check the entered values and try again.');
          return;
        }
        await onSave({ entity: 'lead', id: target.record?.id, payload: input.data });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The record could not be saved. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/40 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm1-record-editor-title"
        aria-describedby="crm1-record-editor-description"
        className="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl"
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !isSaving) {
            onClose();
            return;
          }
          if (event.key !== 'Tab') return;
          const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]'
          );
          if (!focusable?.length) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="crm1-record-editor-title" className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            <p id="crm1-record-editor-description" className="mt-1 text-sm text-slate-600">
              Changes are validated by the CRM-1 API before being saved.
            </p>
          </div>
          <Button variant="ghost" size="sm" aria-label="Close editor" onClick={onClose} disabled={isSaving}>
            Close
          </Button>
        </div>

        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          {error && <Alert variant="error" title="Unable to save record">{error}</Alert>}
          {target.entity === 'contact' && (
            <>
              <Input label="First name" name="firstName" required maxLength={100} defaultValue={target.record?.firstName ?? ''} autoFocus />
              <Input label="Last name" name="lastName" required maxLength={100} defaultValue={target.record?.lastName ?? ''} />
              <Input label="Email" name="email" type="email" defaultValue={target.record?.email ?? ''} />
              <Input label="Phone" name="phone" defaultValue={target.record?.phone ?? ''} />
              <Input label="Address" name="address" defaultValue={target.record?.address ?? ''} />
              <Input
                label="Company ID (optional)"
                name="companyId"
                type="text"
                inputMode="text"
                pattern="[0-9a-fA-F-]{36}"
                helperText="Enter an existing company UUID, or leave blank for no company link."
                defaultValue={target.record?.companyId ?? ''}
              />
              <Select
                label="Lead status"
                name="leadStatus"
                options={LEAD_STATUS_OPTIONS}
                placeholder="Not set"
                defaultValue={target.record?.leadStatus ?? ''}
              />
            </>
          )}
          {target.entity === 'company' && (
            <>
              <Input label="Company name" name="name" required maxLength={255} defaultValue={target.record?.name ?? ''} autoFocus />
              <Input label="Tax number" name="taxNumber" defaultValue={target.record?.taxNumber ?? ''} />
              <Input label="Email" name="email" type="email" defaultValue={target.record?.email ?? ''} />
              <Input label="Phone" name="phone" defaultValue={target.record?.phone ?? ''} />
              <Input label="Address" name="address" defaultValue={target.record?.address ?? ''} />
            </>
          )}
          {target.entity === 'lead' && (
            <>
              <Input
                label="Contact ID"
                name="contactId"
                required
                type="text"
                inputMode="text"
                pattern="[0-9a-fA-F-]{36}"
                helperText="Enter the UUID of an existing CRM-1 contact."
                defaultValue={target.record?.contactId ?? ''}
                autoFocus
              />
              <Select
                label="Lead status"
                name="status"
                options={leadStatusOptions}
                defaultValue={target.record?.status ?? 'New'}
              />
            </>
          )}
          <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
            <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancel</Button>
            <Button type="submit" isLoading={isSaving}>{isSaving ? 'Saving...' : 'Save'}</Button>
          </div>
        </form>
      </section>
    </div>
  );
}
