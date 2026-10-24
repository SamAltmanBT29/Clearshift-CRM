import React, { useState, useEffect } from 'react';
import {
  Input,
  Button,
  Badge,
} from '@clearshift/ui';
import {
  CRM1_FIELD_CONTRACT,
  type CRM1Company,
  type CRM1CompanyCreate,
  type CRM1CompanyPatch,
} from '@clearshift/contracts';
import { ConfirmModal } from './ConfirmModal.js';
import { FormValidationSummary } from './FormValidationSummary.js';

export interface CompanyFormErrors {
  name?: string;
  taxNumber?: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface CompanyFormProps {
  initialCompany?: CRM1Company | null | undefined;
  isSubmitting?: boolean | undefined;
  serverError?: string | null | undefined;
  serverFieldErrors?: Record<string, string[]> | null | undefined;
  onSubmit: (data: CRM1CompanyCreate | CRM1CompanyPatch) => Promise<void> | void;
  onCancel: () => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CompanyForm({
  initialCompany,
  isSubmitting = false,
  serverError,
  serverFieldErrors,
  onSubmit,
  onCancel,
}: CompanyFormProps) {
  const isEditing = Boolean(initialCompany?.id);
  const contract = CRM1_FIELD_CONTRACT.company;

  // Form field state
  const [name, setName] = useState(initialCompany?.name ?? '');
  const [taxNumber, setTaxNumber] = useState(initialCompany?.taxNumber ?? '');
  const [email, setEmail] = useState(initialCompany?.email ?? '');
  const [phone, setPhone] = useState(initialCompany?.phone ?? '');
  const [address, setAddress] = useState(initialCompany?.address ?? '');

  // Validation & dirty state
  const [clientErrors, setClientErrors] = useState<CompanyFormErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof CompanyFormErrors, boolean>>>({});
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const isDirty =
    name !== (initialCompany?.name ?? '') ||
    taxNumber !== (initialCompany?.taxNumber ?? '') ||
    email !== (initialCompany?.email ?? '') ||
    phone !== (initialCompany?.phone ?? '') ||
    address !== (initialCompany?.address ?? '');

  useEffect(() => {
    if (initialCompany) {
      setName(initialCompany.name ?? '');
      setTaxNumber(initialCompany.taxNumber ?? '');
      setEmail(initialCompany.email ?? '');
      setPhone(initialCompany.phone ?? '');
      setAddress(initialCompany.address ?? '');
    }
  }, [initialCompany]);

  const validateField = (field: keyof CompanyFormErrors, val: string): string | undefined => {
    switch (field) {
      case 'name':
        if (!val || val.trim().length === 0) {
          return contract.name.errorRequired;
        }
        break;
      case 'email':
        if (val && val.trim().length > 0 && !EMAIL_REGEX.test(val.trim())) {
          return contract.email.errorInvalid;
        }
        break;
    }
    return undefined;
  };

  const handleBlur = (field: keyof CompanyFormErrors, val: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const err = validateField(field, val);
    setClientErrors((prev) => {
      const next: CompanyFormErrors = { ...prev };
      if (err) next[field] = err;
      else delete next[field];
      return next;
    });
  };

  const validateAll = (): boolean => {
    const newErrors: CompanyFormErrors = {};
    const nameErr = validateField('name', name);
    if (nameErr) newErrors.name = nameErr;

    const emailErr = validateField('email', email);
    if (emailErr) newErrors.email = emailErr;

    setClientErrors(newErrors);
    setTouched({
      name: true,
      taxNumber: true,
      email: true,
      phone: true,
      address: true,
    });
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateAll()) {
      return;
    }

    const payload: Record<string, unknown> = {
      name: name.trim(),
      taxNumber: taxNumber.trim() ? taxNumber.trim().toUpperCase() : null,
      email: email.trim() ? email.trim().toLowerCase() : null,
      phone: phone.trim() ? phone.trim() : null,
      address: address.trim() ? address.trim() : null,
    };

    if (isEditing) {
      onSubmit(payload as CRM1CompanyPatch);
    } else {
      onSubmit(payload as CRM1CompanyCreate);
    }
  };

  const handleCancelClick = () => {
    if (isDirty) {
      setShowCancelConfirm(true);
    } else {
      onCancel();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="cs-company-form" noValidate>
      <FormValidationSummary
        serverError={serverError}
        fieldErrors={{ ...clientErrors, ...(serverFieldErrors ?? {}) }}
      />

      {isEditing && initialCompany && (
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
              Company Structure
            </span>
            <Badge variant="info">Flat Company (V1)</Badge>
          </div>
          {initialCompany.sourceSystem && (
            <div>
              <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>
                Source System / ID
              </span>
              <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#334155' }}>
                {initialCompany.sourceSystem} / {initialCompany.sourceId || 'N/A'}
              </span>
            </div>
          )}
        </div>
      )}

      <div style={{ marginBottom: '16px' }}>
        <label htmlFor="company-name" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '4px' }}>
          {contract.name.label} <span style={{ color: '#ef4444' }}>*</span>
        </label>
        <Input
          id="company-name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={(e) => handleBlur('name', e.target.value)}
          placeholder="Acme Industrial Corp."
          aria-required="true"
          aria-invalid={Boolean(clientErrors.name)}
          aria-describedby={clientErrors.name ? 'company-name-error' : 'company-name-helper'}
        />
        {clientErrors.name ? (
          <span id="company-name-error" style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
            {clientErrors.name}
          </span>
        ) : (
          <span id="company-name-helper" style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
            {contract.name.helperText}
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        <div>
          <label htmlFor="company-tax-number" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '4px' }}>
            {contract.taxNumber.label}
          </label>
          <Input
            id="company-tax-number"
            name="taxNumber"
            value={taxNumber}
            onChange={(e) => setTaxNumber(e.target.value)}
            placeholder="US-123456789"
            aria-describedby="tax-number-helper"
          />
          <span id="tax-number-helper" style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
            {contract.taxNumber.helperText}
          </span>
        </div>

        <div>
          <label htmlFor="company-email" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '4px' }}>
            {contract.email.label}
          </label>
          <Input
            id="company-email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={(e) => handleBlur('email', e.target.value)}
            placeholder="contact@acme.com"
            aria-invalid={Boolean(clientErrors.email)}
            aria-describedby={clientErrors.email ? 'company-email-error' : 'company-email-helper'}
          />
          {clientErrors.email ? (
            <span id="company-email-error" style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
              {clientErrors.email}
            </span>
          ) : (
            <span id="company-email-helper" style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
              {contract.email.helperText}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
        <div>
          <label htmlFor="company-phone" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '4px' }}>
            {contract.phone.label}
          </label>
          <Input
            id="company-phone"
            name="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1-800-555-0100"
            aria-describedby="company-phone-helper"
          />
          <span id="company-phone-helper" style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
            {contract.phone.helperText}
          </span>
        </div>

        <div>
          <label htmlFor="company-address" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '4px' }}>
            {contract.address.label}
          </label>
          <Input
            id="company-address"
            name="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="500 Corporate Blvd, Tech City"
            aria-describedby="company-address-helper"
          />
          <span id="company-address-helper" style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
            {contract.address.helperText}
          </span>
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
          {isSubmitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Company'}
        </Button>
      </div>

      <ConfirmModal
        isOpen={showCancelConfirm}
        title="Discard Unsaved Changes?"
        message="You have unsaved changes in this company form. Discarding will revert all edits."
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
