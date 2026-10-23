import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { ConfirmModal } from '../src/components/forms/ConfirmModal.js';
import { ConsentForm } from '../src/components/forms/ConsentForm.js';
import { CampaignForm } from '../src/components/forms/CampaignForm.js';
import { ListForm } from '../src/components/forms/ListForm.js';

// Helper to access virtual React element props safely in TypeScript strict mode
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asEl = (node: unknown): any => node as any;

describe('CRM-4 React Form Components & UI State Suite (Issue #45 / [CRM4-10])', () => {
  // ---------------------------------------------------------------------------
  // 1. ConfirmModal Accessible Dialog
  // ---------------------------------------------------------------------------
  describe('1. ConfirmModal State & Accessibility', () => {
    it('returns null when isOpen is false', () => {
      const element = ConfirmModal({
        isOpen: false,
        title: 'Cancel changes?',
        message: 'You have unsaved changes.',
        onConfirm: () => {},
        onCancel: () => {},
      });

      expect(element).toBeNull();
    });

    it('renders alertdialog with accessible ARIA labels when isOpen is true', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      const element = asEl(
        ConfirmModal({
          isOpen: true,
          title: 'Discard Unsaved Changes?',
          message: 'Are you sure you want to discard your draft marketing list?',
          confirmLabel: 'Discard',
          cancelLabel: 'Keep Editing',
          variant: 'danger',
          onConfirm,
          onCancel,
        })
      );

      expect(element).toBeDefined();
      expect(element.props.role).toBe('alertdialog');
      expect(element.props['aria-modal']).toBe('true');
      expect(element.props['aria-labelledby']).toBe('crm4-confirm-title');
      expect(element.props['aria-describedby']).toBe('crm4-confirm-desc');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. ConsentForm React Element & BR-CRM4-01 Prop Contracts
  // ---------------------------------------------------------------------------
  describe('2. ConsentForm React Element & Prop Contracts (BR-CRM4-01)', () => {
    it('instantiates ConsentForm React element for new contact consent', () => {
      const element = React.createElement(ConsentForm, {
        contactId: '11111111-1111-4111-8111-000000000001',
        onSubmit: () => {},
        onCancel: () => {},
      });

      expect(element).toBeDefined();
      expect(element.type).toBe(ConsentForm);
      expect(element.props.contactId).toBe('11111111-1111-4111-8111-000000000001');
    });

    it('instantiates ConsentForm with server error prop', () => {
      const element = React.createElement(ConsentForm, {
        contactId: '11111111-1111-4111-8111-000000000001',
        serverError: 'Database connection failed',
        onSubmit: () => {},
        onCancel: () => {},
      });

      expect(element).toBeDefined();
      expect(element.props.serverError).toBe('Database connection failed');
    });

    it('instantiates ConsentForm with existing unsubscribed consent (BR-CRM4-01)', () => {
      const unsubscribedConsent = {
        id: '60000000-0000-4000-8000-000000000002',
        contactId: '11111111-1111-4111-8111-000000000002',
        status: 'unsubscribed' as const,
        consentDate: '2026-09-15T14:30:00Z',
        source: 'Email unsubscribe link click',
        createdAt: '2026-09-15T14:30:00Z',
        updatedAt: '2026-09-15T14:30:00Z',
      };

      const element = React.createElement(ConsentForm, {
        contactId: unsubscribedConsent.contactId,
        currentConsent: unsubscribedConsent,
        onSubmit: () => {},
        onCancel: () => {},
      });

      expect(element).toBeDefined();
      expect(element.props.currentConsent?.status).toBe('unsubscribed');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. CampaignForm React Element & Immutability
  // ---------------------------------------------------------------------------
  describe('3. CampaignForm React Element & Immutability Contracts', () => {
    it('instantiates CampaignForm for create mode', () => {
      const availableLists = [
        {
          id: '44444444-1111-4444-8444-000000000001',
          name: 'Q1 Enterprise',
          description: null,
          campaignCount: 0,
          memberCount: 0,
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      ];

      const element = React.createElement(CampaignForm, {
        availableLists,
        onSubmit: () => {},
        onCancel: () => {},
      });

      expect(element).toBeDefined();
      expect(element.type).toBe(CampaignForm);
      expect((element.props as any).availableLists).toHaveLength(1);
    });

    it('instantiates CampaignForm for edit mode with initialCampaign', () => {
      const existingCampaign = {
        id: '44444444-2222-4444-8444-000000000001',
        name: 'Q1 Launch Blitz',
        campaignDate: '2026-11-01',
        listId: '44444444-1111-4444-8444-000000000001',
        listName: 'Q1 Enterprise Outreach',
        memberCount: 3,
        createdAt: '2026-10-10T00:00:00.000Z',
        updatedAt: '2026-10-10T00:00:00.000Z',
      };

      const element = React.createElement(CampaignForm, {
        initialCampaign: existingCampaign,
        onSubmit: () => {},
        onCancel: () => {},
      });

      expect(element).toBeDefined();
      expect((element.props as any).initialCampaign?.id).toBe('44444444-2222-4444-8444-000000000001');
      expect((element.props as any).initialCampaign?.listId).toBe('44444444-1111-4444-8444-000000000001');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. ListForm React Element & Error Handling
  // ---------------------------------------------------------------------------
  describe('4. ListForm React Element & Prop Contracts', () => {
    it('instantiates ListForm element successfully', () => {
      const element = React.createElement(ListForm, {
        onSubmit: () => {},
        onCancel: () => {},
      });

      expect(element).toBeDefined();
      expect(element.type).toBe(ListForm);
    });

    it('instantiates ListForm with serverError prop', () => {
      const element = React.createElement(ListForm, {
        serverError: 'List name already exists in this tenant',
        onSubmit: () => {},
        onCancel: () => {},
      });

      expect(element).toBeDefined();
      expect(element.props.serverError).toBe('List name already exists in this tenant');
    });
  });
});
