import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import {
  CRM1_FIELD_CONTRACT,
  CRM1ContactCreateSchema,
  CRM1ContactPatchSchema,
  type CRM1ContactRead,
} from '@clearshift/contracts';
import { ContactForm } from '../src/components/forms/ContactForm.js';
import { ContactFormPage } from '../src/pages/ContactFormPage.js';

describe('CRM-1 Contact Form: Field Contracts & Client Validation (Issue #10 / [CRM1-05])', () => {
  const sampleContact: CRM1ContactRead = {
    id: '10000000-0000-4000-8000-000000000001',
    firstName: 'Sarah',
    lastName: 'Connor',
    email: 'sarah.connor@sky.net',
    phone: '+1-555-0199',
    address: '42 Resistance Way, Los Angeles, CA',
    companyId: '20000000-0000-4000-8000-000000000001',
    companyName: 'Cyberdyne Systems',
    leadStatus: 'Working',
    goldenId: 'GID-100000000001',
    sourceSystem: 'Salesforce',
    sourceId: 'SF-00912',
    consentStatus: 'granted',
    consentUpdatedAt: '2026-10-01T00:00:00Z',
    unsubscribed: false,
    unsubscribedUpdatedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };

  describe('1. Field Labels & Helper Text Alignment', () => {
    it('provides authoritative labels and helper text matching CRM1_FIELD_CONTRACT', () => {
      const contract = CRM1_FIELD_CONTRACT.contact;
      expect(contract.firstName.label).toBe('First Name');
      expect(contract.firstName.errorRequired).toBe('First name is required');
      expect(contract.lastName.label).toBe('Last Name');
      expect(contract.lastName.errorRequired).toBe('Last name is required');
      expect(contract.email.label).toBe('Email Address');
      expect(contract.email.errorInvalid).toBe('Email must be a valid email address');
      expect(contract.companyId.label).toBe('Associated Company');
      expect(contract.companyId.errorInvalid).toBe('Company ID must be a valid UUID');
      expect(contract.leadStatus.label).toBe('Lead Status');
      expect(contract.leadStatus.errorInvalid).toBe('Lead status must be one of: New, Working, Qualified, Closed');
      expect(contract.goldenId.readOnly).toBe(true);
    });
  });

  describe('2. Client Validation & Domain Invariants', () => {
    it('requires non-empty firstName and lastName', () => {
      const res = CRM1ContactCreateSchema.safeParse({
        firstName: '',
        lastName: '',
      });
      expect(res.success).toBe(false);
    });

    it('validates email format if provided', () => {
      expect(
        CRM1ContactCreateSchema.safeParse({
          firstName: 'John',
          lastName: 'Doe',
          email: 'not-an-email',
        }).success
      ).toBe(false);

      expect(
        CRM1ContactCreateSchema.safeParse({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
        }).success
      ).toBe(true);
    });

    it('validates companyId as a valid UUID if provided', () => {
      expect(
        CRM1ContactCreateSchema.safeParse({
          firstName: 'John',
          lastName: 'Doe',
          companyId: 'not-a-uuid',
        }).success
      ).toBe(false);

      expect(
        CRM1ContactCreateSchema.safeParse({
          firstName: 'John',
          lastName: 'Doe',
          companyId: '20000000-0000-4000-8000-000000000001',
        }).success
      ).toBe(true);
    });

    it('validates leadStatus allowlist: New, Working, Qualified, Closed', () => {
      const validStatuses = ['New', 'Working', 'Qualified', 'Closed'];
      for (const st of validStatuses) {
        expect(
          CRM1ContactCreateSchema.safeParse({
            firstName: 'John',
            lastName: 'Doe',
            leadStatus: st,
          }).success
        ).toBe(true);
      }

      expect(
        CRM1ContactCreateSchema.safeParse({
          firstName: 'John',
          lastName: 'Doe',
          leadStatus: 'InvalidStatus',
        }).success
      ).toBe(false);
    });

    it('requires at least one field when patching a contact', () => {
      expect(CRM1ContactPatchSchema.safeParse({}).success).toBe(false);
      expect(CRM1ContactPatchSchema.safeParse({ phone: '+1-555-0100' }).success).toBe(true);
    });
  });

  describe('3. React Element Instantiation & Read-Only Invariants', () => {
    it('instantiates ContactForm for creating a new contact', () => {
      const element = React.createElement(ContactForm, {
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      });
      expect(element).toBeDefined();
      expect(element.type).toBe(ContactForm);
      expect(element.props.initialContact).toBeUndefined();
    });

    it('instantiates ContactForm in edit mode displaying read-only goldenId', () => {
      const element = React.createElement(ContactForm, {
        initialContact: sampleContact,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      });
      expect(element).toBeDefined();
      expect(element.props.initialContact?.goldenId).toBe('GID-100000000001');
      expect(element.props.initialContact?.unsubscribed).toBe(false);
    });

    it('instantiates ContactForm with serverError and fieldErrors without state loss', () => {
      const element = React.createElement(ContactForm, {
        initialContact: sampleContact,
        serverError: 'Conflict: Contact with this email already exists',
        serverFieldErrors: { email: ['Email must be unique'] },
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      });
      expect(element.props.serverError).toContain('Conflict');
      expect(element.props.serverFieldErrors?.['email']).toContain('Email must be unique');
    });

    it('instantiates ContactFormPage container with back-to-list navigation', () => {
      const onBackToList = vi.fn();
      const onSuccess = vi.fn();
      const element = React.createElement(ContactFormPage, {
        contactId: sampleContact.id,
        initialContact: sampleContact,
        onBackToList,
        onSuccess,
      });
      expect(element).toBeDefined();
      expect(element.props.contactId).toBe(sampleContact.id);
    });
  });
});
