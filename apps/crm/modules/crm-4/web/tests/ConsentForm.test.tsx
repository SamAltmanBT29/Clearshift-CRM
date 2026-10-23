// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  CRM4ConsentSchema,
  CRM4ConsentSetSchema,
  assertMonotonicOptOut,
  assertValidConsentStatus,
  type CRM4Consent,
  type CRM4ConsentSet,
} from '@clearshift/contracts';

// ---------------------------------------------------------------------------
// Mock API to prevent raw network requests during component rendering
// ---------------------------------------------------------------------------
vi.mock('../src/api/crm-4.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/crm-4.js')>();
  return {
    ...actual,
    getConsent: vi.fn(),
    setConsent: vi.fn(),
  };
});

import { getConsent, setConsent } from '../src/api/crm-4.js';
import { ConsentForm } from '../src/components/forms/ConsentForm.js';
import { ConsentFormPage } from '../src/pages/ConsentFormPage.js';

describe('CRM-4 Consent Form: Invariants, Opt-Out Monotonicity & Real DOM Tests (Issue #40 / [CRM4-05])', () => {
  const sampleContactId = '10000000-0000-4000-8000-000000000001';

  const subscribedConsent: CRM4Consent = {
    id: '40000000-0000-4000-8000-000000000090',
    contactId: sampleContactId,
    status: 'subscribed',
    consentDate: '2026-09-01T12:00:00Z',
    source: 'Website Newsletter Form',
    createdAt: '2026-09-01T12:00:00Z',
    updatedAt: '2026-09-01T12:00:00Z',
  };

  const unsubscribedConsent: CRM4Consent = {
    id: '40000000-0000-4000-8000-000000000091',
    contactId: sampleContactId,
    status: 'unsubscribed',
    consentDate: '2026-09-15T08:00:00Z',
    source: 'Unsubscribe Link Header',
    createdAt: '2026-09-01T12:00:00Z',
    updatedAt: '2026-09-15T08:00:00Z',
  };

  beforeEach(() => {
    vi.mocked(getConsent).mockResolvedValue(subscribedConsent);
    vi.mocked(setConsent).mockResolvedValue(subscribedConsent);
  });

  // ---------------------------------------------------------------------------
  // 1. Validation & Domain Invariants (BR-CRM4-01)
  // ---------------------------------------------------------------------------
  describe('1. Invariants & Domain Rules (BR-CRM4-01)', () => {
    it('validates a complete, valid consent set payload', () => {
      const payload: CRM4ConsentSet = {
        contactId: sampleContactId,
        status: 'subscribed',
        source: 'Webinar Registration',
      };
      const result = CRM4ConsentSetSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('enforces status allowlist (strictly subscribed or unsubscribed)', () => {
      expect(() => assertValidConsentStatus('subscribed')).not.toThrow();
      expect(() => assertValidConsentStatus('unsubscribed')).not.toThrow();
      expect(() => assertValidConsentStatus('pending')).toThrow(/Domain Invariant Violation/);
      expect(() => assertValidConsentStatus('opted_out')).toThrow(/Domain Invariant Violation/);
    });

    it('assertMonotonicOptOut throws when reverting unsubscribed to subscribed (BR-CRM4-01)', () => {
      expect(() => assertMonotonicOptOut('unsubscribed', 'subscribed')).toThrow(
        /BR-CRM4-01/
      );
    });

    it('assertMonotonicOptOut permits updating from subscribed to unsubscribed (opt-out)', () => {
      expect(() => assertMonotonicOptOut('subscribed', 'unsubscribed')).not.toThrow();
    });

    it('assertMonotonicOptOut permits updating from unsubscribed to unsubscribed', () => {
      expect(() => assertMonotonicOptOut('unsubscribed', 'unsubscribed')).not.toThrow();
    });

    it('requires a non-empty source for audit traceability', () => {
      const invalid = CRM4ConsentSetSchema.safeParse({
        contactId: sampleContactId,
        status: 'unsubscribed',
        source: '   ',
      });
      expect(invalid.success).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Real DOM Component Tests (<ConsentForm />)
  // ---------------------------------------------------------------------------
  describe('2. Real DOM Component Tests (<ConsentForm />)', () => {
    it('renders consent form with current record and editable status options', () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(
        <ConsentForm
          contactId={sampleContactId}
          currentConsent={subscribedConsent}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      );

      expect(screen.getByRole('form', { name: /set contact consent record/i })).toBeTruthy();
      expect(screen.getByText('Current Consent Record (Read-only)')).toBeTruthy();
      expect(screen.getByText('Website Newsletter Form')).toBeTruthy();
      expect(screen.getByLabelText(/consent source/i)).toBeTruthy();

      // For a subscribed contact, the subscribed radio is enabled
      const subRadio = screen.getByLabelText(/set consent to subscribed/i) as HTMLInputElement;
      expect(subRadio.disabled).toBe(false);
    });

    it('enforces BR-CRM4-01 in DOM: disables subscribed radio and warns when contact is unsubscribed', () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(
        <ConsentForm
          contactId={sampleContactId}
          currentConsent={unsubscribedConsent}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      );

      // Warning alert banner is present
      expect(screen.getByTestId('crm4-consent-monotonic-warning')).toBeTruthy();
      expect(screen.getByText(/BR-CRM4-01 — Opt-out is Strictly Monotonic/i)).toBeTruthy();

      // Subscribed radio is explicitly disabled
      const subRadio = screen.getByRole('radio', {
        name: /subscribed \(blocked — br-crm4-01: opt-out is monotonic\)/i,
      }) as HTMLInputElement;
      expect(subRadio.disabled).toBe(true);

      // Status helper text is displayed
      expect(
        screen.getByText(/Blocked — existing opt-out cannot be reverted \(BR-CRM4-01\)/i)
      ).toBeTruthy();
    });

    it('shows field-level error message and prevents submission when source is empty', () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(
        <ConsentForm
          contactId={sampleContactId}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      );

      const form = screen.getByRole('form', { name: /set contact consent record/i });
      fireEvent.submit(form);

      expect(handleSubmit).not.toHaveBeenCalled();
      expect(screen.getByText(/consent source is required/i)).toBeTruthy();
    });

    it('submits valid consent update when fields are valid', () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(
        <ConsentForm
          contactId={sampleContactId}
          currentConsent={subscribedConsent}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      );

      const sourceInput = screen.getByLabelText(/consent source/i);
      fireEvent.change(sourceInput, { target: { value: 'Customer Preference Center' } });

      const form = screen.getByRole('form', { name: /set contact consent record/i });
      fireEvent.submit(form);

      expect(handleSubmit).toHaveBeenCalledTimes(1);
      expect(handleSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          contactId: sampleContactId,
          status: 'subscribed',
          source: 'Customer Preference Center',
        })
      );
    });

    it('displays server error banner and preserves user entered values', () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(
        <ConsentForm
          contactId={sampleContactId}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          serverError="Database consent lock error"
        />
      );

      expect(screen.getByText(/consent update failed/i)).toBeTruthy();
      expect(screen.getByText(/database consent lock error/i)).toBeTruthy();
      expect(screen.getByText(/your entered values have been preserved/i)).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Real DOM Component Tests (<ConsentFormPage />)
  // ---------------------------------------------------------------------------
  describe('3. Real DOM Component Tests (<ConsentFormPage />)', () => {
    it('renders consent form page and links back to context via onBack', () => {
      const handleBack = vi.fn();

      render(
        <ConsentFormPage
          contactId={sampleContactId}
          onBackToList={handleBack}
          onSuccess={vi.fn()}
        />
      );

      const backButton = screen.getByRole('button', { name: /back/i });
      expect(backButton).toBeTruthy();
      fireEvent.click(backButton);
      expect(handleBack).toHaveBeenCalledTimes(1);
    });
  });
});
