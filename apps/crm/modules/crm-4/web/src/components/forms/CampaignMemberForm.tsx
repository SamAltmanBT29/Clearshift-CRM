/**
 * CampaignMemberForm — Add a member to a campaign
 *
 * Fields:
 *   - contactId (required, UUID)
 *   - status (required, one of: sent | opened | clicked)
 *   - unsubscribed (boolean flag)
 *
 * Domain rules enforced:
 *   - Status is strictly sent/opened/clicked; no arbitrary states
 *   - If the contact's current consent is 'unsubscribed', a prominent warning is shown
 *     (BR-CRM4-01: membership writes re-check consent at action time)
 *   - unsubscribed flag visible and toggleable for imported history
 *
 * API: POST /api/v1/crm-marketing/campaigns/{id}/members
 */
import React, { useState } from 'react';
import {
  Input,
  Button,
  Alert,
  Select,
} from '@clearshift/ui';
import type { CRM4MemberCreate, CRM4Consent } from '@clearshift/contracts';
import { CRM4_MEMBER_STATUSES } from '@clearshift/contracts';

export interface CampaignMemberFormProps {
  campaignId: string;
  /** Current consent record for the contact, if already loaded */
  contactConsent?: CRM4Consent | null;
  isLoadingConsent?: boolean;
  isSubmitting?: boolean;
  serverError?: string | null;
  serverFieldErrors?: Record<string, string[]> | null;
  onSubmit: (data: CRM4MemberCreate) => void;
  onCancel: () => void;
}

const STATUS_OPTIONS = CRM4_MEMBER_STATUSES.map((s) => ({
  value: s,
  label: s.charAt(0).toUpperCase() + s.slice(1),
}));

export function CampaignMemberForm({
  campaignId,
  contactConsent,
  isLoadingConsent = false,
  isSubmitting = false,
  serverError,
  serverFieldErrors,
  onSubmit,
  onCancel,
}: CampaignMemberFormProps) {
  const [contactId, setContactId] = useState('');
  const [status, setStatus] = useState<'sent' | 'opened' | 'clicked'>('sent');
  const [unsubscribed, setUnsubscribed] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // BR-CRM4-01: re-check consent at action time — warn if known unsubscribed
  const isKnownUnsubscribed = contactConsent?.status === 'unsubscribed';

  // Client validation
  const errors: Record<string, string> = {};
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (touched['contactId'] && !uuidPattern.test(contactId.trim())) {
    errors['contactId'] = 'A valid contact UUID is required (e.g. xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).';
  }

  const handleBlur = (field: string) => setTouched((t) => ({ ...t, [field]: true }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ contactId: true });

    if (!uuidPattern.test(contactId.trim())) return;

    const payload: CRM4MemberCreate = {
      campaignId,
      contactId: contactId.trim(),
      status,
      unsubscribed,
    };
    onSubmit(payload);
  };

  return (
    <form
      id="crm4-member-form"
      onSubmit={handleSubmit}
      className="space-y-5"
      aria-label="Add campaign member"
      noValidate
    >
      {/* Server error */}
      {serverError && (
        <Alert variant="error" title="Failed to Add Member">
          <p className="text-sm">{serverError}</p>
        </Alert>
      )}

      {/* BR-CRM4-01 consent warning — shown when contact is known unsubscribed */}
      {isKnownUnsubscribed && (
        <div
          data-testid="crm4-consent-unsubscribed-warning"
          role="alert"
          className="flex gap-3 p-3 bg-red-50 border border-red-300 rounded-md text-red-900 text-xs"
        >
          <span className="text-base" aria-hidden="true">⛔</span>
          <span>
            <strong>BR-CRM4-01 — Consent Warning:</strong> This contact's current consent status is{' '}
            <strong>unsubscribed</strong>. Adding them as a campaign member is being recorded for
            historical accuracy only. The unsubscribe flag will be set automatically. No outbound
            communications may be sent.
          </span>
        </div>
      )}

      {isLoadingConsent && (
        <p className="text-xs text-slate-500 italic">Checking contact consent record...</p>
      )}

      {/* Contact ID */}
      <Input
        id="crm4-member-contact-id"
        label="Contact ID (UUID)"
        placeholder="e.g. 10000000-0000-4000-8000-000000000001"
        value={contactId}
        onChange={(e) => setContactId(e.target.value)}
        onBlur={() => handleBlur('contactId')}
        error={errors['contactId'] || serverFieldErrors?.['contactId']?.[0]}
        required
        aria-required="true"
        helperText="The CRM-1 contact record UUID to associate with this campaign."
      />

      {/* Status — strictly limited to sent/opened/clicked */}
      <div>
        <Select
          id="crm4-member-status"
          label="Member Status"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(e) => setStatus(e.target.value as 'sent' | 'opened' | 'clicked')}
        />
        <p className="text-xs text-slate-500 mt-1">
          Campaign engagement status: sent → opened → clicked. No arbitrary states permitted.
        </p>
      </div>

      {/* Unsubscribed flag */}
      <div className="flex items-start gap-3">
        <input
          id="crm4-member-unsubscribed"
          type="checkbox"
          checked={unsubscribed || isKnownUnsubscribed}
          disabled={isKnownUnsubscribed}
          onChange={(e) => setUnsubscribed(e.target.checked)}
          className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
          aria-describedby="crm4-member-unsubscribed-hint"
        />
        <div>
          <label
            htmlFor="crm4-member-unsubscribed"
            className="text-sm font-medium text-slate-700"
          >
            Unsubscribed / Opted-out
          </label>
          <p id="crm4-member-unsubscribed-hint" className="text-xs text-slate-500 mt-0.5">
            Marks this member as having unsubscribed. Automatically set when contact consent is
            unsubscribed (BR-CRM4-01).
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={isSubmitting}
          aria-label="Cancel adding member"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={isSubmitting || Object.keys(errors).length > 0}
          aria-label="Add member to campaign"
        >
          {isSubmitting ? 'Adding...' : 'Add Member'}
        </Button>
      </div>
    </form>
  );
}
