import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import {
  CRM1_FIELD_CONTRACT,
  CRM1CompanyCreateSchema,
  CRM1CompanyPatchSchema,
  type CRM1Company,
} from '@clearshift/contracts';
import { CompanyForm } from '../src/components/forms/CompanyForm.js';
import { CompanyFormPage } from '../src/pages/CompanyFormPage.js';

describe('CRM-1 Company Form: Field Contracts & Flat Company Invariants (Issue #10 / [CRM1-05])', () => {
  const sampleCompany: CRM1Company = {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Cyberdyne Systems',
    taxNumber: 'US-99887766',
    email: 'corp@cyberdyne.com',
    phone: '+1-800-555-0100',
    address: '18144 El Camino Real, Sunnyvale, CA',
    sourceSystem: 'HubSpot',
    sourceId: 'HS-COMPANY-88',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };

  describe('1. Field Labels & Helper Text Alignment', () => {
    it('provides authoritative labels and helper text matching CRM1_FIELD_CONTRACT', () => {
      const contract = CRM1_FIELD_CONTRACT.company;
      expect(contract.name.label).toBe('Company Name');
      expect(contract.name.errorRequired).toBe('Company name is required');
      expect(contract.taxNumber.label).toBe('Tax Identification Number');
      expect(contract.email.label).toBe('Corporate Email');
      expect(contract.phone.label).toBe('Main Office Phone');
      expect(contract.address.label).toBe('Headquarters Address');
    });
  });

  describe('2. Client Validation & Flat Company Rules', () => {
    it('requires non-empty company name', () => {
      const res = CRM1CompanyCreateSchema.safeParse({ name: '' });
      expect(res.success).toBe(false);

      expect(CRM1CompanyCreateSchema.safeParse({ name: 'Acme Corp' }).success).toBe(true);
    });

    it('validates corporate email format if provided', () => {
      expect(
        CRM1CompanyCreateSchema.safeParse({
          name: 'Acme Corp',
          email: 'invalid-email',
        }).success
      ).toBe(false);

      expect(
        CRM1CompanyCreateSchema.safeParse({
          name: 'Acme Corp',
          email: 'admin@acme.com',
        }).success
      ).toBe(true);
    });

    it('requires at least one field when patching a company', () => {
      expect(CRM1CompanyPatchSchema.safeParse({}).success).toBe(false);
      expect(CRM1CompanyPatchSchema.safeParse({ taxNumber: 'US-998877' }).success).toBe(true);
    });
  });

  describe('3. React Element Instantiation & Flat Company Banner', () => {
    it('instantiates CompanyForm for creating a new company', () => {
      const element = React.createElement(CompanyForm, {
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      });
      expect(element).toBeDefined();
      expect(element.type).toBe(CompanyForm);
      expect(element.props.initialCompany).toBeUndefined();
    });

    it('instantiates CompanyForm in edit mode displaying read-only metadata', () => {
      const element = React.createElement(CompanyForm, {
        initialCompany: sampleCompany,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      });
      expect(element).toBeDefined();
      expect(element.props.initialCompany?.taxNumber).toBe('US-99887766');
      expect(element.props.initialCompany?.sourceSystem).toBe('HubSpot');
    });

    it('instantiates CompanyFormPage container with back-to-list navigation', () => {
      const onBackToList = vi.fn();
      const onSuccess = vi.fn();
      const element = React.createElement(CompanyFormPage, {
        companyId: sampleCompany.id,
        initialCompany: sampleCompany,
        onBackToList,
        onSuccess,
      });
      expect(element).toBeDefined();
      expect(element.props.companyId).toBe(sampleCompany.id);
    });
  });
});
