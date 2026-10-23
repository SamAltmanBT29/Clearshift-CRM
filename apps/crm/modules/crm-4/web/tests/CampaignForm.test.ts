import { describe, it, expect } from 'vitest';
import {
  CRM4CampaignSchema,
  CRM4CampaignCreateSchema,
  CRM4CampaignPatchSchema,
  CRM4MemberCreateSchema,
  CRM4_MEMBER_STATUSES,
  type CRM4Campaign,
  type CRM4CampaignCreate,
  type CRM4CampaignPatch,
} from '@clearshift/contracts';

describe('CRM-4 Campaign Form: Contracts & Invariants (Issue #173/#174 / [CRM4-20]/[CRM4-21])', () => {
  const sampleValidCampaign: CRM4Campaign = {
    id: '50000000-0000-4000-8000-000000000001',
    listId: '40000000-0000-4000-8000-000000000001',
    name: 'Product Launch Announcement 2026',
    campaignDate: '2026-11-15',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };

  describe('1. Campaign Create Validation', () => {
    it('accepts a valid campaign creation payload', () => {
      const payload: CRM4CampaignCreate = {
        listId: '40000000-0000-4000-8000-000000000001',
        name: 'Spring Newsletter',
        campaignDate: '2026-03-20',
      };
      const result = CRM4CampaignCreateSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('requires a non-empty campaign name', () => {
      const result = CRM4CampaignCreateSchema.safeParse({
        listId: '40000000-0000-4000-8000-000000000001',
        name: '',
        campaignDate: '2026-11-15',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.name).toBeDefined();
      }
    });

    it('requires a valid YYYY-MM-DD date format', () => {
      // Valid dates
      const validDates = ['2026-01-01', '2026-12-31', '2026-02-28'];
      for (const d of validDates) {
        const res = CRM4CampaignCreateSchema.safeParse({
          listId: '40000000-0000-4000-8000-000000000001',
          name: 'Valid Campaign',
          campaignDate: d,
        });
        expect(res.success).toBe(true);
      }

      // Invalid date formats
      const invalidDates = ['15-11-2026', '11/15/2026', '2026/11/15', '2026-1-1', 'not-a-date'];
      for (const d of invalidDates) {
        const res = CRM4CampaignCreateSchema.safeParse({
          listId: '40000000-0000-4000-8000-000000000001',
          name: 'Invalid Date Campaign',
          campaignDate: d,
        });
        expect(res.success).toBe(false);
      }
    });

    it('requires listId on create as a valid UUID', () => {
      const missingList = CRM4CampaignCreateSchema.safeParse({
        name: 'No List Campaign',
        campaignDate: '2026-11-15',
      });
      expect(missingList.success).toBe(false);

      const invalidListUuid = CRM4CampaignCreateSchema.safeParse({
        listId: 'not-a-valid-uuid',
        name: 'Invalid List Campaign',
        campaignDate: '2026-11-15',
      });
      expect(invalidListUuid.success).toBe(false);
    });
  });

  describe('2. List ID Immutability on Campaign Update', () => {
    it('CRM4CampaignPatchSchema accepts valid editable fields (name, campaignDate)', () => {
      const validUpdate: CRM4CampaignPatch = {
        name: 'Updated Campaign Name',
        campaignDate: '2026-12-01',
      };
      const result = CRM4CampaignPatchSchema.safeParse(validUpdate);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Updated Campaign Name');
        expect(result.data.campaignDate).toBe('2026-12-01');
      }
    });

    it('CRM4CampaignPatchSchema strictly rejects listId (immutable after creation)', () => {
      const updateWithListId = {
        name: 'Updated Campaign Name',
        campaignDate: '2026-12-01',
        listId: '40000000-0000-4000-8000-000000000099',
      };
      const result = CRM4CampaignPatchSchema.safeParse(updateWithListId);
      expect(result.success).toBe(false);
    });

    it('CRM4CampaignPatchSchema strictly rejects server-managed id and createdAt', () => {
      const updateWithSystemFields = {
        name: 'Renamed Campaign',
        id: 'fake-id',
        createdAt: '2020-01-01T00:00:00Z',
      };
      const result = CRM4CampaignPatchSchema.safeParse(updateWithSystemFields);
      expect(result.success).toBe(false);
    });
  });

  describe('3. Campaign Member Status Allowlist', () => {
    it('strictly enforces member status to sent, opened, clicked', () => {
      expect(CRM4_MEMBER_STATUSES).toEqual(['sent', 'opened', 'clicked']);
      expect(CRM4_MEMBER_STATUSES.length).toBe(3);

      for (const validStatus of ['sent', 'opened', 'clicked'] as const) {
        const res = CRM4MemberCreateSchema.safeParse({
          campaignId: '50000000-0000-4000-8000-000000000001',
          contactId: '10000000-0000-4000-8000-000000000001',
          status: validStatus,
          unsubscribed: false,
        });
        expect(res.success).toBe(true);
      }

      // Rejects statuses outside the V1 contract
      const invalidStatuses = ['bounced', 'delivered', 'pending', 'queued', 'failed', 'draft'];
      for (const s of invalidStatuses) {
        const res = CRM4MemberCreateSchema.safeParse({
          campaignId: '50000000-0000-4000-8000-000000000001',
          contactId: '10000000-0000-4000-8000-000000000001',
          status: s as any,
          unsubscribed: false,
        });
        expect(res.success).toBe(false);
      }
    });

    it('preserves and validates the unsubscribed flag', () => {
      const unsubscribedMember = CRM4MemberCreateSchema.safeParse({
        campaignId: '50000000-0000-4000-8000-000000000001',
        contactId: '10000000-0000-4000-8000-000000000001',
        status: 'opened',
        unsubscribed: true,
      });
      expect(unsubscribedMember.success).toBe(true);
      if (unsubscribedMember.success) {
        expect(unsubscribedMember.data.unsubscribed).toBe(true);
      }
    });
  });

  describe('4. Scope Boundary: Outbound Delivery Excluded', () => {
    it('verifies campaign schema contains only historical records, no delivery mechanisms', () => {
      const parsed = CRM4CampaignSchema.parse(sampleValidCampaign);
      // No transmission/sending fields in V1
      expect((parsed as any).sendNow).toBeUndefined();
      expect((parsed as any).smtpConfig).toBeUndefined();
      expect((parsed as any).recipientBatchSize).toBeUndefined();
      expect((parsed as any).scheduledDeliveryTime).toBeUndefined();
    });
  });
});
