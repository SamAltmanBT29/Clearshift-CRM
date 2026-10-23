import { describe, it, expect } from 'vitest';
import {
  CRM4_MEMBER_STATUSES,
  CRM4_CONSENT_STATUSES,
  assertValidMemberStatus,
  assertValidConsentStatus,
  assertMonotonicOptOut,
  CRM4MemberStatusSchema,
  CRM4ConsentStatusSchema,
  CRM4ListSchema,
  CRM4CampaignSchema,
  CRM4MemberSchema,
  CRM4ConsentSchema,
  CRM4ListCreateSchema,
  CRM4ListPatchSchema,
  CRM4ListQuerySchema,
} from '../src/crm-4.js';

describe('CRM-4 Marketing Lists and Campaign History: Public Contracts & Domain Invariants', () => {
  describe('Domain Invariant 1 (BR-CRM4-01): Strictly Monotonic Opt-Out / Unsubscribe', () => {
    it('prohibits reverting an existing unsubscribe/opt-out status back to subscribed', () => {
      // Reverting unsubscribed -> subscribed MUST throw invariant error
      expect(() => assertMonotonicOptOut('unsubscribed', 'subscribed')).toThrowError(
        /Domain Invariant Violation \(BR-CRM4-01\): A known opt-out\/unsubscribe is strictly monotonic/
      );
    });

    it('allows subscribing when no prior consent or when already subscribed', () => {
      expect(() => assertMonotonicOptOut(null, 'subscribed')).not.toThrow();
      expect(() => assertMonotonicOptOut(undefined, 'subscribed')).not.toThrow();
      expect(() => assertMonotonicOptOut('subscribed', 'subscribed')).not.toThrow();
    });

    it('allows opting out / unsubscribing from any prior state', () => {
      expect(() => assertMonotonicOptOut(null, 'unsubscribed')).not.toThrow();
      expect(() => assertMonotonicOptOut('subscribed', 'unsubscribed')).not.toThrow();
      expect(() => assertMonotonicOptOut('unsubscribed', 'unsubscribed')).not.toThrow();
    });
  });

  describe('Domain Invariant 2: Campaign Member Status Validation', () => {
    it('strictly permits only sent, opened, clicked member statuses', () => {
      expect(CRM4_MEMBER_STATUSES).toEqual(['sent', 'opened', 'clicked']);

      for (const status of CRM4_MEMBER_STATUSES) {
        expect(CRM4MemberStatusSchema.parse(status)).toBe(status);
        expect(() => assertValidMemberStatus(status)).not.toThrow();
      }
    });

    it('rejects arbitrary or unknown member statuses', () => {
      const invalidStatuses = ['delivered', 'bounced', 'pending', 'queued', 'failed', 'active'];
      for (const invalid of invalidStatuses) {
        expect(() => assertValidMemberStatus(invalid)).toThrowError(
          /Domain Invariant Violation: Member status '.*' is not permitted/
        );
      }
    });
  });

  describe('Domain Invariant 3: Consent Status Validation', () => {
    it('strictly permits only subscribed and unsubscribed consent statuses', () => {
      expect(CRM4_CONSENT_STATUSES).toEqual(['subscribed', 'unsubscribed']);

      for (const status of CRM4_CONSENT_STATUSES) {
        expect(CRM4ConsentStatusSchema.parse(status)).toBe(status);
        expect(() => assertValidConsentStatus(status)).not.toThrow();
      }
    });

    it('rejects invalid consent statuses', () => {
      const invalid = ['opted_in', 'opted_out', 'pending', 'unknown', 'revoked'];
      for (const status of invalid) {
        expect(() => assertValidConsentStatus(status)).toThrowError(
          /Domain Invariant Violation: Consent status '.*' is not permitted/
        );
      }
    });
  });

  describe('Core Schemas Validation', () => {
    it('validates a conformant Marketing List object', () => {
      const validList = {
        id: '40000000-0000-4000-8000-000000000001',
        name: 'Enterprise VIP Accounts',
        description: 'Key strategic decision makers and tier-1 enterprise leads',
        campaignCount: 3,
        memberCount: 150,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      };

      const parsed = CRM4ListSchema.safeParse(validList);
      expect(parsed.success).toBe(true);
    });

    it('validates a conformant Campaign History record', () => {
      const validCampaign = {
        id: '41000000-0000-4000-8000-000000000001',
        name: 'Q4 Product Launch Announcement',
        campaignDate: '2026-11-15',
        listId: '40000000-0000-4000-8000-000000000001',
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      };

      const parsed = CRM4CampaignSchema.safeParse(validCampaign);
      expect(parsed.success).toBe(true);
    });

    it('validates a conformant Campaign Member record', () => {
      const validMember = {
        id: '42000000-0000-4000-8000-000000000001',
        campaignId: '41000000-0000-4000-8000-000000000001',
        contactId: '90000000-0000-4000-8000-000000000001',
        status: 'opened',
        unsubscribed: false,
        createdAt: '2026-10-01T00:00:00Z',
      };

      const parsed = CRM4MemberSchema.safeParse(validMember);
      expect(parsed.success).toBe(true);
    });

    it('validates a conformant Consent Record with provenance/source', () => {
      const validConsent = {
        id: '43000000-0000-4000-8000-000000000001',
        contactId: '90000000-0000-4000-8000-000000000001',
        status: 'unsubscribed',
        consentDate: '2026-10-10T14:30:00Z',
        source: 'email-unsubscribe-link',
        createdAt: '2026-10-10T14:30:00Z',
        updatedAt: '2026-10-10T14:30:00Z',
      };

      const parsed = CRM4ConsentSchema.safeParse(validConsent);
      expect(parsed.success).toBe(true);
    });
  });

  describe('Query & Mutation Schemas', () => {
    it('validates list creation requires a non-empty name', () => {
      expect(CRM4ListCreateSchema.safeParse({ name: 'Valid List' }).success).toBe(true);
      expect(CRM4ListCreateSchema.safeParse({ name: '' }).success).toBe(false);
      expect(CRM4ListCreateSchema.safeParse({ name: '   ' }).success).toBe(false);
    });

    it('enforces at least one field when patching a list', () => {
      expect(CRM4ListPatchSchema.safeParse({ description: 'New description' }).success).toBe(true);
      expect(CRM4ListPatchSchema.safeParse({}).success).toBe(false);
    });

    it('parses and enforces query defaults (page 1, pageSize 25, max 100)', () => {
      const parsedDefault = CRM4ListQuerySchema.parse({});
      expect(parsedDefault.page).toBe(1);
      expect(parsedDefault.pageSize).toBe(25);

      const parsedCustom = CRM4ListQuerySchema.parse({ page: '2', pageSize: '50', search: 'vip' });
      expect(parsedCustom.page).toBe(2);
      expect(parsedCustom.pageSize).toBe(50);
      expect(parsedCustom.search).toBe('vip');

      // Rejects pageSize > 100
      expect(CRM4ListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    });
  });
});
