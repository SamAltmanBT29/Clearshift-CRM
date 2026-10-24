import React, { useState, useEffect } from 'react';
import {
  Input,
  Select,
  Button,
  Badge,
} from '@clearshift/ui';
import {
  CRM1_FIELD_CONTRACT,
  CRM1LeadStatusSchema,
  CRM1_LEAD_STATUS_TRANSITIONS,
  type CRM1LeadRead,
  type CRM1LeadCreate,
  type CRM1LeadPatch,
  type CRM1LeadStatus,
} from '@clearshift/contracts';
import { ConfirmModal } from './ConfirmModal.js';
import { FormValidationSummary } from './FormValidationSummary.js';

export interface LeadFormErrors {
  contactId?: string;
  status?: string;
}

export interface LeadFormProps {
  initialLead?: CRM1LeadRead | null | undefined;
  isSubmitting?: boolean | undefined;
  serverError?: string | null | undefined;
  serverFieldErrors?: Record<string, string[]> | null | undefined;
  onSubmit: (data: CRM1LeadCreate | CRM1LeadPatch) => Promise<void> | void;
  onCancel: () => void;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isLeadStatusTransitionAllowed(
  current: CRM1LeadStatus,
  next: CRM1LeadStatus
): boolean {
  if (current === next) return true;
  const allowed = CRM1_LEAD_STATUS_TRANSITIONS[current];
  return allowed?.includes(next) === true;
}

export function LeadForm({
  initialLead,
  isSubmitting = false,
  serverError,
  serverFieldErrors,
  onSubmit,
  onCancel,
}: LeadFormProps) {
  const isEditing = Boolean(initialLead?.id);
  const contract = CRM1_FIELD_CONTRACT.lead;

  // Form field state
  const [contactId, setContactId] = useState(initialLead?.contactId ?? '');
  const [status, setStatus] = useState<CRM1LeadStatus>(initialLead?.status ?? 'New');

  // Validation & dirty state
  const [clientErrors, setClientErrors] = useState<LeadFormErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof LeadFormErrors, boolean>>>({});
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const isDirty =
    contactId !== (initialLead?.contactId ?? '') ||
    status !== (initialLead?.status ?? 'New');

  useEffect(() => {
    if (initialLead) {
      setContactId(initialLead.contactId ?? '');
      setStatus(initialLead.status ?? 'New');
    }
  }, [initialLead]);

  const validateField = (field: keyof LeadFormErrors, val: string): string | undefined => {
    switch (field) {
      case 'contactId':
        if (!val || val.trim().length === 0) {
          return contract.contactId.errorRequired;
        }
        if (!UUID_REGEX.test(val.trim())) {
          return contract.contactId.errorInvalid;
        }
        break;
      case 'status': {
        const parsed = CRM1LeadStatusSchema.safeParse(val);
        if (!parsed.success) {
          return contract.status.errorInvalid;
        }
        if (isEditing && initialLead?.status) {
          const nextSt = parsed.data;
          if (!isLeadStatusTransitionAllowed(initialLead.status, nextSt)) {
            return `Lead status cannot transition from ${initialLead.status} to ${nextSt}`;
          }
        }
        break;
      }
    }
    return undefined;
  };

  const handleBlur = (field: keyof LeadFormErrors, val: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const err = validateField(field, val);
    setClientErrors((prev) => {
      const next: LeadFormErrors = { ...prev };
      if (err) next[field] = err;
      else delete next[field];
      return next;
    });
  };

  const validateAll = (): boolean => {
    const newErrors: LeadFormErrors = {};
    const cidErr = validateField('contactId', contactId);
    if (cidErr) newErrors.contactId = cidErr;

    const stErr = validateField('status', status);
    if (stErr) newErrors.status = stErr;

    setClientErrors(newErrors);
    setTouched({ contactId: true, status: true });
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateAll()) {
      return;
    }

    if (isEditing) {
      const payload: CRM1LeadPatch = { status };
      onSubmit(payload);
    } else {
      const payload: CRM1LeadCreate = {
        contactId: contactId.trim(),
        status,
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

  const statusOptions = [
    { label: 'New', value: 'New' },
    { label: 'Working', value: 'Working' },
    { label: 'Qualified', value: 'Qualified' },
    { label: 'Closed', value: 'Closed' },
  ];

  return (
    <form onSubmit={handleSubmit} className="cs-lead-form" noValidate>
      <FormValidationSummary
        serverError={serverError}
        fieldErrors={{ ...clientErrors, ...(serverFieldErrors ?? {}) }}
      />

      {isEditing && initialLead && (
        <div
          className="cs-readonly-banner"
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '20px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '16px',
            alignItems: 'center',
          }}
        >
          {initialLead.contactName && (
            <div>
              <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>
                Contact Name
              </span>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>
                {initialLead.contactName}
              </span>
            </div>
          )}
          {initialLead.contactEmail && (
            <div>
              <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>
                Contact Email
              </span>
              <span style={{ fontSize: '0.875rem', color: '#334155' }}>
                {initialLead.contactEmail}
              </span>
            </div>
          )}
          <div>
            <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>
              Current Status
            </span>
            <Badge variant="info">{initialLead.status}</Badge>
          </div>
        </div>
      )}

      <div style={{ marginBottom: '16px' }}>
        <label htmlFor="lead-contact-id" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '4px' }}>
          {contract.contactId.label} <span style={{ color: '#ef4444' }}>*</span>
        </label>
        <Input
          id="lead-contact-id"
          name="contactId"
          value={contactId}
          disabled={isEditing}
          onChange={(e) => setContactId(e.target.value)}
          onBlur={(e) => handleBlur('contactId', e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          aria-required="true"
          aria-invalid={Boolean(clientErrors.contactId)}
          aria-describedby={clientErrors.contactId ? 'lead-contact-id-error' : 'lead-contact-id-helper'}
        />
        {clientErrors.contactId ? (
          <span id="lead-contact-id-error" style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
            {clientErrors.contactId}
          </span>
        ) : (
          <span id="lead-contact-id-helper" style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
            {contract.contactId.helperText}
          </span>
        )}
      </div>

      <div style={{ marginBottom: '24px' }}>
        <label htmlFor="lead-status" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '4px' }}>
          {contract.status.label} <span style={{ color: '#ef4444' }}>*</span>
        </label>
        <Select
          id="lead-status"
          name="status"
          value={status}
          options={statusOptions}
          onChange={(e) => {
            const casted = e.target.value as CRM1LeadStatus;
            setStatus(casted);
            handleBlur('status', casted);
          }}
          aria-required="true"
          aria-invalid={Boolean(clientErrors.status)}
          aria-describedby={clientErrors.status ? 'lead-status-error' : 'lead-status-helper'}
        />
        {clientErrors.status ? (
          <span id="lead-status-error" style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
            {clientErrors.status}
          </span>
        ) : (
          <span id="lead-status-helper" style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
            {contract.status.helperText}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
        <Button
          type="button"
          variant="outline"
          onClick={handleCancelClick}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Lead'}
        </Button>
      </div>

      <ConfirmModal
        isOpen={showCancelConfirm}
        title="Discard Unsaved Changes?"
        message="You have unsaved changes in this lead form. Discarding will revert all edits."
        confirmLabel="Discard Changes"
        cancelLabel="Continue Editing"
        onConfirm={() => {
          setShowCancelConfirm(false);
          onCancel();
        }}
        onCancel={() => setShowCancelConfirm(false)}
      />
    </form>
  );
}
