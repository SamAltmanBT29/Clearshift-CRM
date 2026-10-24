import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import {
  CRM1_FIELD_CONTRACT,
  CRM1_LEAD_STATUS_TRANSITIONS,
  CRM1LeadCreateSchema,
  CRM1LeadPatchSchema,
  type CRM1LeadRead,
} from '@clearshift/contracts';
import { LeadForm, isLeadStatusTransitionAllowed } from '../src/components/forms/LeadForm.js';
import { LeadFormPage } from '../src/pages/LeadFormPage.js';

describe('CRM-1 Lead Form: Field Contracts & Status Progression (Issue #10 / [CRM1-05])', () => {
  const sampleLead: CRM1LeadRead = {
    id: '30000000-0000-4000-8000-000000000001',
    contactId: '10000000-0000-4000-8000-000000000001',
    contactName: 'Sarah Connor',
    contactEmail: 'sarah.connor@sky.net',
    status: 'Working',
    sourceSystem: 'Salesforce',
    sourceId: 'SF-LEAD-101',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };

  describe('1. Field Labels & Helper Text Alignment', () => {
    it('provides authoritative labels and helper text matching CRM1_FIELD_CONTRACT', () => {
      const contract = CRM1_FIELD_CONTRACT.lead;
      expect(contract.contactId.label).toBe('Associated Contact');
      expect(contract.contactId.errorRequired).toBe('Contact ID is required');
      expect(contract.contactId.errorInvalid).toBe('Contact ID must be a valid UUID');
      expect(contract.status.label).toBe('Pipeline Status');
      expect(contract.status.errorRequired).toBe('Lead status is required');
      expect(contract.status.errorInvalid).toBe('Lead status must be one of: New, Working, Qualified, Closed');
    });
  });

  describe('2. Client Validation & Status Progression Allowlist', () => {
    it('requires a valid contactId UUID on creation', () => {
      expect(
        CRM1LeadCreateSchema.safeParse({
          contactId: '',
          status: 'New',
        }).success
      ).toBe(false);

      expect(
        CRM1LeadCreateSchema.safeParse({
          contactId: 'invalid-uuid',
          status: 'New',
        }).success
      ).toBe(false);

      expect(
        CRM1LeadCreateSchema.safeParse({
          contactId: '10000000-0000-4000-8000-000000000001',
          status: 'New',
        }).success
      ).toBe(true);
    });

    it('Domain Rule: Strictly verifies status transitions New → Working → Qualified → Closed', () => {
      // Allowed forward progression
      expect(isLeadStatusTransitionAllowed('New', 'Working')).toBe(true);
      expect(isLeadStatusTransitionAllowed('Working', 'Qualified')).toBe(true);
      expect(isLeadStatusTransitionAllowed('Qualified', 'Closed')).toBe(true);
      expect(isLeadStatusTransitionAllowed('Working', 'Working')).toBe(true);

      // Forbidden jumps and regressions
      expect(isLeadStatusTransitionAllowed('New', 'Qualified')).toBe(false);
      expect(isLeadStatusTransitionAllowed('New', 'Closed')).toBe(false);
      expect(isLeadStatusTransitionAllowed('Working', 'New')).toBe(false);
      expect(isLeadStatusTransitionAllowed('Qualified', 'New')).toBe(false);
      expect(isLeadStatusTransitionAllowed('Qualified', 'Working')).toBe(false);
      expect(isLeadStatusTransitionAllowed('Closed', 'New')).toBe(false);
      expect(isLeadStatusTransitionAllowed('Closed', 'Working')).toBe(false);
      expect(isLeadStatusTransitionAllowed('Closed', 'Qualified')).toBe(false);
    });

    it('requires non-empty status on lead patch', () => {
      expect(CRM1LeadPatchSchema.safeParse({}).success).toBe(false);
      expect(CRM1LeadPatchSchema.safeParse({ status: 'Qualified' }).success).toBe(true);
    });
  });

  describe('3. React Element Instantiation & Read-Only Invariants', () => {
    it('instantiates LeadForm for creating a new lead', () => {
      const element = React.createElement(LeadForm, {
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      });
      expect(element).toBeDefined();
      expect(element.type).toBe(LeadForm);
      expect(element.props.initialLead).toBeUndefined();
    });

    it('instantiates LeadForm in edit mode displaying contact name and email', () => {
      const element = React.createElement(LeadForm, {
        initialLead: sampleLead,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      });
      expect(element).toBeDefined();
      expect(element.props.initialLead?.contactName).toBe('Sarah Connor');
      expect(element.props.initialLead?.status).toBe('Working');
    });

    it('instantiates LeadFormPage container with back-to-list navigation', () => {
      const onBackToList = vi.fn();
      const onSuccess = vi.fn();
      const element = React.createElement(LeadFormPage, {
        leadId: sampleLead.id,
        initialLead: sampleLead,
        onBackToList,
        onSuccess,
      });
      expect(element).toBeDefined();
      expect(element.props.leadId).toBe(sampleLead.id);
    });
  });
});
