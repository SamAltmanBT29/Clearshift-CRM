// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  CRM4CampaignSchema,
  CRM4CampaignCreateSchema,
  CRM4CampaignPatchSchema,
  CRM4MemberSchema,
  CRM4MemberCreateSchema,
  assertValidMemberStatus,
  type CRM4Campaign,
  type CRM4List,
  type CRM4Member,
} from '@clearshift/contracts';

// ---------------------------------------------------------------------------
// Mock API to prevent raw network requests during component rendering
// ---------------------------------------------------------------------------
vi.mock('../src/api/crm-4.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/crm-4.js')>();
  return {
    ...actual,
    getCampaignById: vi.fn(),
    getCampaignMembers: vi.fn(),
    createCampaignMember: vi.fn(),
  };
});

import { getCampaignById, getCampaignMembers } from '../src/api/crm-4.js';
import { CampaignForm } from '../src/components/forms/CampaignForm.js';
import { CampaignDetailPage } from '../src/pages/CampaignDetailPage.js';

describe('CRM-4 Campaigns Form & Detail: Contracts, Invariants & Real DOM Tests (Issue #40 / [CRM4-05])', () => {
  const sampleList: CRM4List = {
    id: '40000000-0000-4000-8000-000000000001',
    name: 'North America Enterprise',
    description: 'Enterprise contacts',
    campaignCount: 2,
    memberCount: 50,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };

  const sampleCampaign: CRM4Campaign = {
    id: '40000000-0000-4000-8000-000000000010',
    name: 'Q4 Product Launch Announcement',
    campaignDate: '2026-11-15',
    listId: sampleList.id,
    listName: sampleList.name,
    memberCount: 30,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.mocked(getCampaignById).mockResolvedValue(sampleCampaign);
    vi.mocked(getCampaignMembers).mockResolvedValue({
      items: [
        {
          id: '40000000-0000-4000-8000-000000000050',
          campaignId: sampleCampaign.id,
          contactId: '10000000-0000-4000-8000-000000000001',
          status: 'sent',
          unsubscribed: false,
          createdAt: '2026-10-01T00:00:00Z',
        },
      ],
      pagination: {
        page: 1,
        pageSize: 10,
        totalCount: 1,
        totalPages: 1,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // 1. Validation & Schema Contracts
  // ---------------------------------------------------------------------------
  describe('1. Validation & Schema Contracts', () => {
    it('validates a complete, valid campaign create payload', () => {
      const payload = {
        name: 'Fall Re-Engagement Campaign',
        campaignDate: '2026-10-15',
        listId: sampleList.id,
      };
      const result = CRM4CampaignCreateSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('enforces YYYY-MM-DD date regex for campaignDate', () => {
      expect(
        CRM4CampaignCreateSchema.safeParse({
          name: 'Date Test',
          campaignDate: '2026/10/15',
          listId: sampleList.id,
        }).success
      ).toBe(false);

      expect(
        CRM4CampaignCreateSchema.safeParse({
          name: 'Date Test',
          campaignDate: '15-10-2026',
          listId: sampleList.id,
        }).success
      ).toBe(false);

      expect(
        CRM4CampaignCreateSchema.safeParse({
          name: 'Date Test',
          campaignDate: 'invalid-date',
          listId: sampleList.id,
        }).success
      ).toBe(false);
    });

    it('requires a valid UUID for listId on create', () => {
      const invalid = CRM4CampaignCreateSchema.safeParse({
        name: 'List UUID Test',
        campaignDate: '2026-10-15',
        listId: 'not-a-valid-uuid',
      });
      expect(invalid.success).toBe(false);
    });

    it('domain invariant: listId is excluded and immutable in CRM4CampaignPatchSchema', () => {
      const patchWithListId = {
        name: 'Updated Name',
        listId: '40000000-0000-4000-8000-000000000099',
      };
      const result = CRM4CampaignPatchSchema.safeParse(patchWithListId);
      expect(result.success).toBe(false);
    });

    it('strictly enforces member status allowlist (sent, opened, clicked)', () => {
      expect(() => assertValidMemberStatus('sent')).not.toThrow();
      expect(() => assertValidMemberStatus('opened')).not.toThrow();
      expect(() => assertValidMemberStatus('clicked')).not.toThrow();
      expect(() => assertValidMemberStatus('bounced')).toThrow(/Domain Invariant Violation/);
      expect(() => assertValidMemberStatus('delivered')).toThrow(/Domain Invariant Violation/);
    });

    it('strictly excludes V2/V3 outbound sending fields from create schema', () => {
      const outOfScopePayload = {
        name: 'Outbound Campaign',
        campaignDate: '2026-10-15',
        listId: sampleList.id,
        emailSubject: 'Special Announcement',
        scheduledTime: '2026-10-15T09:00:00Z',
        channel: 'email',
      };
      const parsed = CRM4CampaignCreateSchema.safeParse(outOfScopePayload);
      expect(parsed.success).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Real DOM Component Tests (<CampaignForm />)
  // ---------------------------------------------------------------------------
  describe('2. Real DOM Component Tests (<CampaignForm />)', () => {
    it('renders create mode with list selector options', () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(
        <CampaignForm
          availableLists={[sampleList]}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      );

      expect(screen.getByRole('form', { name: /create new campaign/i })).toBeTruthy();
      expect(screen.getByLabelText(/campaign name/i)).toBeTruthy();
      expect(screen.getByLabelText(/campaign date/i)).toBeTruthy();
      expect(screen.getByLabelText(/marketing list/i)).toBeTruthy();
    });

    it('shows field-level error messages on invalid submit and prevents submission', () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(
        <CampaignForm
          availableLists={[sampleList]}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      );

      const form = screen.getByRole('form', { name: /create new campaign/i });
      fireEvent.submit(form);

      expect(handleSubmit).not.toHaveBeenCalled();
      expect(screen.getByText(/campaign name is required/i)).toBeTruthy();
    });

    it('submits valid campaign create payload', () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(
        <CampaignForm
          availableLists={[sampleList]}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      );

      const nameInput = screen.getByLabelText(/campaign name/i);
      const dateInput = screen.getByLabelText(/campaign date/i);
      const listSelect = screen.getByLabelText(/marketing list/i);

      fireEvent.change(nameInput, { target: { value: '  Q4 Product Launch  ' } });
      fireEvent.change(dateInput, { target: { value: '2026-11-20' } });
      fireEvent.change(listSelect, { target: { value: sampleList.id } });

      const form = screen.getByRole('form', { name: /create new campaign/i });
      fireEvent.submit(form);

      expect(handleSubmit).toHaveBeenCalledTimes(1);
      expect(handleSubmit).toHaveBeenCalledWith({
        name: 'Q4 Product Launch',
        campaignDate: '2026-11-20',
        listId: sampleList.id,
      });
    });

    it('renders edit mode with listId strictly read-only and immutable', () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(
        <CampaignForm
          initialCampaign={sampleCampaign}
          availableLists={[sampleList]}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      );

      expect(screen.getByRole('form', { name: /edit campaign/i })).toBeTruthy();
      expect(screen.getByText(sampleCampaign.id)).toBeTruthy();
      expect(screen.getByText(/immutable after creation/i)).toBeTruthy();
      expect(screen.getByText(sampleList.name)).toBeTruthy();

      // No dropdown/select exists in edit mode for list
      expect(screen.queryByRole('combobox', { name: /marketing list/i })).toBeNull();
    });

    it('presents server error banner while preserving entered input values', () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(
        <CampaignForm
          availableLists={[sampleList]}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          serverError="Campaign date cannot be in the closed period"
        />
      );

      expect(screen.getByText(/save failed/i)).toBeTruthy();
      expect(screen.getByText(/campaign date cannot be in the closed period/i)).toBeTruthy();
      expect(screen.getByText(/your entered values have been preserved/i)).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Real DOM Component Tests (<CampaignDetailPage />)
  // ---------------------------------------------------------------------------
  describe('3. Real DOM Component Tests (<CampaignDetailPage />)', () => {
    it('renders campaign detail page and navigation links back to list context', async () => {
      const handleBack = vi.fn();
      const handleEdit = vi.fn();

      render(
        <CampaignDetailPage
          campaignId={sampleCampaign.id}
          initialCampaign={sampleCampaign}
          onBackToList={handleBack}
          onEditCampaign={handleEdit}
        />
      );

      // Back navigation button exists
      const backButton = screen.getByRole('button', { name: /back to marketing lists/i });
      expect(backButton).toBeTruthy();
      fireEvent.click(backButton);
      expect(handleBack).toHaveBeenCalledTimes(1);
    });
  });
});
