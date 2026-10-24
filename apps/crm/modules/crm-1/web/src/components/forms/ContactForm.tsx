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
  type CRM1ContactRead,
  type CRM1ContactCreate,
  type CRM1ContactPatch,
  type CRM1LeadStatus,
} from '@clearshift/contracts';
import { ConfirmModal } from './ConfirmModal.js';
import { FormValidationSummary } from './FormValidationSummary.js';

export interface ContactFormErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  companyId?: string;
  leadStatus?: string;
}

export interface ContactFormProps {
  initialContact?: CRM1ContactRead | null | undefined;
  isSubmitting?: boolean | undefined;
  serverError?: string | null | undefined;
  serverFieldErrors?: Record<string, string[]> | null | undefined;
  onSubmit: (data: CRM1ContactCreate | CRM1ContactPatch) => Promise<void> | void;
  onCancel: () => void;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ContactForm({
  initialContact,
  isSubmitting = false,
  serverError,
  serverFieldErrors,
  onSubmit,
  onCancel,
}: ContactFormProps) {
  const isEditing = Boolean(initialContact?.id);
  const contract = CRM1_FIELD_CONTRACT.contact;

  // Form field state
  const [firstName, setFirstName] = useState(initialContact?.firstName ?? '');
  const [lastName, setLastName] = useState(initialContact?.lastName ?? '');
  const [email, setEmail] = useState(initialContact?.email ?? '');
  const [phone, setPhone] = useState(initialContact?.phone ?? '');
  const [address, setAddress] = useState(initialContact?.address ?? '');
  const [companyId, setCompanyId] = useState(initialContact?.companyId ?? '');
  const [leadStatus, setLeadStatus] = useState<string>(initialContact?.leadStatus ?? '');

  // Validation & dirty state
  const [clientErrors, setClientErrors] = useState<ContactFormErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof ContactFormErrors, boolean>>>({});
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const isDirty =
    firstName !== (initialContact?.firstName ?? '') ||
    lastName !== (initialContact?.lastName ?? '') ||
    email !== (initialContact?.email ?? '') ||
    phone !== (initialContact?.phone ?? '') ||
    address !== (initialContact?.address ?? '') ||
    companyId !== (initialContact?.companyId ?? '') ||
    leadStatus !== (initialContact?.leadStatus ?? '');

  useEffect(() => {
    if (initialContact) {
      setFirstName(initialContact.firstName ?? '');
      setLastName(initialContact.lastName ?? '');
      setEmail(initialContact.email ?? '');
      setPhone(initialContact.phone ?? '');
      setAddress(initialContact.address ?? '');
      setCompanyId(initialContact.companyId ?? '');
      setLeadStatus(initialContact.leadStatus ?? '');
    }
  }, [initialContact]);

  const validateField = (field: keyof ContactFormErrors, val: string): string | undefined => {
    switch (field) {
      case 'firstName':
        if (!val || val.trim().length === 0) {
          return contract.firstName.errorRequired;
        }
        break;
      case 'lastName':
        if (!val || val.trim().length === 0) {
          return contract.lastName.errorRequired;
        }
        break;
      case 'email':
        if (val && val.trim().length > 0 && !EMAIL_REGEX.test(val.trim())) {
          return contract.email.errorInvalid;
        }
        break;
      case 'companyId':
        if (val && val.trim().length > 0 && !UUID_REGEX.test(val.trim())) {
          return contract.companyId.errorInvalid;
        }
        break;
      case 'leadStatus':
        if (val && val.trim().length > 0 && !CRM1LeadStatusSchema.safeParse(val).success) {
          return contract.leadStatus.errorInvalid;
        }
        break;
    }
    return undefined;
  };

  const handleBlur = (field: keyof ContactFormErrors, val: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const err = validateField(field, val);
    setClientErrors((prev) => {
      const next: ContactFormErrors = { ...prev };
      if (err) next[field] = err;
      else delete next[field];
      return next;
    });
  };

  const validateAll = (): boolean => {
    const newErrors: ContactFormErrors = {};
    const fnErr = validateField('firstName', firstName);
    if (fnErr) newErrors.firstName = fnErr;

    const lnErr = validateField('lastName', lastName);
    if (lnErr) newErrors.lastName = lnErr;

    const emErr = validateField('email', email);
    if (emErr) newErrors.email = emErr;

    const coErr = validateField('companyId', companyId);
    if (coErr) newErrors.companyId = coErr;

    const lsErr = validateField('leadStatus', leadStatus);
    if (lsErr) newErrors.leadStatus = lsErr;

    setClientErrors(newErrors);
    setTouched({
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      address: true,
      companyId: true,
      leadStatus: true,
    });
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateAll()) {
      return;
    }

    const payload: Record<string, unknown> = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim() ? email.trim().toLowerCase() : null,
      phone: phone.trim() ? phone.trim() : null,
      address: address.trim() ? address.trim() : null,
      companyId: companyId.trim() ? companyId.trim() : null,
      leadStatus: leadStatus ? (leadStatus as CRM1LeadStatus) : null,
    };

    if (isEditing) {
      onSubmit(payload as CRM1ContactPatch);
    } else {
      onSubmit(payload as CRM1ContactCreate);
    }
  };

  const handleCancelClick = () => {
    if (isDirty) {
      setShowCancelConfirm(true);
    } else {
      onCancel();
    }
  };

  const leadStatusOptions = [
    { label: '-- Select Status --', value: '' },
    { label: 'New', value: 'New' },
    { label: 'Working', value: 'Working' },
    { label: 'Qualified', value: 'Qualified' },
    { label: 'Closed', value: 'Closed' },
  ];

  return (
    <form onSubmit={handleSubmit} className="cs-contact-form" noValidate>
      <FormValidationSummary
        serverError={serverError}
        fieldErrors={{ ...clientErrors, ...(serverFieldErrors ?? {}) }}
      />

      {isEditing && initialContact && (
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
          <div>
            <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>
              {contract.goldenId.label}
            </span>
            <Badge variant="info">{initialContact.goldenId || 'PENDING'}</Badge>
          </div>
          {initialContact.sourceSystem && (
            <div>
              <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>
                Source System / ID
              </span>
              <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#334155' }}>
                {initialContact.sourceSystem} / {initialContact.sourceId || 'N/A'}
              </span>
            </div>
          )}
          <div>
            <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>
              Consent Status
            </span>
            <Badge variant={initialContact.consentStatus === 'granted' ? 'success' : 'neutral'}>
              {initialContact.consentStatus || 'unknown'}
            </Badge>
          </div>
          {initialContact.unsubscribed && (
            <Badge variant="danger">Unsubscribed</Badge>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        <div>
          <label htmlFor="contact-first-name" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '4px' }}>
            {contract.firstName.label} <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <Input
            id="contact-first-name"
            name="firstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            onBlur={(e) => handleBlur('firstName', e.target.value)}
            placeholder="Jane"
            aria-required="true"
            aria-invalid={Boolean(clientErrors.firstName)}
            aria-describedby={clientErrors.firstName ? 'first-name-error' : 'first-name-helper'}
          />
          {clientErrors.firstName ? (
            <span id="first-name-error" style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
              {clientErrors.firstName}
            </span>
          ) : (
            <span id="first-name-helper" style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
              {contract.firstName.helperText}
            </span>
          )}
        </div>

        <div>
          <label htmlFor="contact-last-name" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '4px' }}>
            {contract.lastName.label} <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <Input
            id="contact-last-name"
            name="lastName"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            onBlur={(e) => handleBlur('lastName', e.target.value)}
            placeholder="Doe"
            aria-required="true"
            aria-invalid={Boolean(clientErrors.lastName)}
            aria-describedby={clientErrors.lastName ? 'last-name-error' : 'last-name-helper'}
          />
          {clientErrors.lastName ? (
            <span id="last-name-error" style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
              {clientErrors.lastName}
            </span>
          ) : (
            <span id="last-name-helper" style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
              {contract.lastName.helperText}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        <div>
          <label htmlFor="contact-email" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '4px' }}>
            {contract.email.label}
          </label>
          <Input
            id="contact-email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={(e) => handleBlur('email', e.target.value)}
            placeholder="jane.doe@example.com"
            aria-invalid={Boolean(clientErrors.email)}
            aria-describedby={clientErrors.email ? 'email-error' : 'email-helper'}
          />
          {clientErrors.email ? (
            <span id="email-error" style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
              {clientErrors.email}
            </span>
          ) : (
            <span id="email-helper" style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
              {contract.email.helperText}
            </span>
          )}
        </div>

        <div>
          <label htmlFor="contact-phone" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '4px' }}>
            {contract.phone.label}
          </label>
          <Input
            id="contact-phone"
            name="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1-555-0199"
            aria-describedby="phone-helper"
          />
          <span id="phone-helper" style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
            {contract.phone.helperText}
          </span>
        </div>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label htmlFor="contact-address" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '4px' }}>
          {contract.address.label}
        </label>
        <Input
          id="contact-address"
          name="address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="100 Main Street, Suite 400, Metropolis"
          aria-describedby="address-helper"
        />
        <span id="address-helper" style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
          {contract.address.helperText}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
        <div>
          <label htmlFor="contact-company-id" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '4px' }}>
            {contract.companyId.label}
          </label>
          <Input
            id="contact-company-id"
            name="companyId"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            onBlur={(e) => handleBlur('companyId', e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            aria-invalid={Boolean(clientErrors.companyId)}
            aria-describedby={clientErrors.companyId ? 'company-id-error' : 'company-id-helper'}
          />
          {clientErrors.companyId ? (
            <span id="company-id-error" style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
              {clientErrors.companyId}
            </span>
          ) : (
            <span id="company-id-helper" style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
              {contract.companyId.helperText}
            </span>
          )}
        </div>

        <div>
          <label htmlFor="contact-lead-status" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '4px' }}>
            {contract.leadStatus.label}
          </label>
          <Select
            id="contact-lead-status"
            name="leadStatus"
            value={leadStatus}
            options={leadStatusOptions}
            onChange={(e) => {
              const val = e.target.value;
              setLeadStatus(val);
              handleBlur('leadStatus', val);
            }}
            aria-invalid={Boolean(clientErrors.leadStatus)}
            aria-describedby={clientErrors.leadStatus ? 'lead-status-error' : 'lead-status-helper'}
          />
          {clientErrors.leadStatus ? (
            <span id="lead-status-error" style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
              {clientErrors.leadStatus}
            </span>
          ) : (
            <span id="lead-status-helper" style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
              {contract.leadStatus.helperText}
            </span>
          )}
        </div>
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
          {isSubmitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Contact'}
        </Button>
      </div>

      <ConfirmModal
        isOpen={showCancelConfirm}
        title="Discard Unsaved Changes?"
        message="You have unsaved changes in this contact form. Discarding will revert all edits."
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
