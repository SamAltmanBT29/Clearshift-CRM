import { describe, it, expect } from 'vitest';
import {
  assertMonotonicOptOut,
  assertValidMemberStatus,
  assertValidConsentStatus,
  CRM4_MEMBER_STATUSES,
  CRM4_CONSENT_STATUSES,
} from '@clearshift/contracts';
import { Crm4Service } from '../../src/services/crm4.service.js';
import { sanitizeCsvField } from '../../src/policies/masking.js';
import { assertNoImmutableFieldMutation } from '../../src/interface/authz.js';

describe('CRM-4 Domain Rules & Invariants (Issue #45 / [CRM4-10])', () => {
  describe('1. Monotonic Opt-Out (BR-CRM4-01)', () => {
    it('allows initial subscription when no prior consent exists', () => {
      expect(() => assertMonotonicOptOut(null, 'subscribed')).not.toThrow();
      expect(() => assertMonotonicOptOut(undefined, 'subscribed')).not.toThrow();
    });

    it('allows initial unsubscription when no prior consent exists', () => {
      expect(() => assertMonotonicOptOut(null, 'unsubscribed')).not.toThrow();
      expect(() => assertMonotonicOptOut(undefined, 'unsubscribed')).not.toThrow();
    });

    it('allows transition from subscribed to unsubscribed (opt-out event)', () => {
      expect(() => assertMonotonicOptOut('subscribed', 'unsubscribed')).not.toThrow();
    });

    it('allows idempotent re-assertion of unsubscribed status', () => {
      expect(() => assertMonotonicOptOut('unsubscribed', 'unsubscribed')).not.toThrow();
    });

    it('strictly forbids and throws when attempting to revert unsubscribed to subscribed', () => {
      expect(() => assertMonotonicOptOut('unsubscribed', 'subscribed')).toThrow(
        /Domain Invariant Violation \(BR-CRM4-01\)/
      );
    });

    it('service enforces BR-CRM4-01 and rejects consent reversal with conflict error', async () => {
      const service = new Crm4Service();
      const contactId = '11111111-1111-4111-8111-000000000002'; // Known unsubscribed in seed

      // Verify current status is unsubscribed
      const current = await service.getConsent(contactId);
      expect(current.status).toBe('unsubscribed');

      // Attempt reversal to subscribed
      await expect(
        service.setConsent({
          contactId,
          status: 'subscribed',
          source: 're-engagement-campaign',
        })
      ).rejects.toThrow(/BR-CRM4-01/);
    });
  });

  describe('2. Member Status Allowlist (FR-CRM4-03)', () => {
    it('accepts all permitted statuses: sent, opened, clicked', () => {
      for (const status of CRM4_MEMBER_STATUSES) {
        expect(() => assertValidMemberStatus(status)).not.toThrow();
      }
    });

    it('rejects arbitrary, unauthorized member statuses', () => {
      const invalidStatuses = ['queued', 'delivered', 'bounced', 'failed', 'draft', 'unknown', ''];
      for (const invalid of invalidStatuses) {
        expect(() => assertValidMemberStatus(invalid)).toThrow(/Member status '.*' is not permitted/);
      }
    });
  });

  describe('3. Consent Status Allowlist (FR-CRM4-04)', () => {
    it('accepts all permitted statuses: subscribed, unsubscribed', () => {
      for (const status of CRM4_CONSENT_STATUSES) {
        expect(() => assertValidConsentStatus(status)).not.toThrow();
      }
    });

    it('rejects arbitrary, unauthorized consent statuses', () => {
      const invalidStatuses = ['pending', 'opt-in-requested', 'unknown', 'withdrawn', ''];
      for (const invalid of invalidStatuses) {
        expect(() => assertValidConsentStatus(invalid)).toThrow(/Consent status '.*' is not permitted/);
      }
    });
  });

  describe('4. Campaign List Immutability (FR-CRM4-02)', () => {
    it('blocks listId modification on existing campaigns for non-admin callers', () => {
      const nonAdminUser = {
        sub: 'user-editor-1',
        roles: ['editor'],
      };

      // Non-immutable fields (e.g. name, campaignDate) do not throw
      expect(() =>
        assertNoImmutableFieldMutation(nonAdminUser, { name: 'Updated Name', campaignDate: '2026-12-01' }, true)
      ).not.toThrow();

      // Mutation containing listId throws
      expect(() =>
        assertNoImmutableFieldMutation(nonAdminUser, { listId: '44444444-1111-4444-8444-000000000099' }, true)
      ).toThrow(/Access denied: modification of immutable field 'listId' is strictly prohibited/);
    });
  });

  describe('5. CSV Formula Injection Sanitization', () => {
    it('prepends single-quote to formula prefixes (=, +, -, @, \\t, \\r)', () => {
      expect(sanitizeCsvField('=cmd|/c calc')).toBe("'=cmd|/c calc");
      expect(sanitizeCsvField('+123456')).toBe("'+123456");
      expect(sanitizeCsvField('-500')).toBe("'-500");
      expect(sanitizeCsvField('@SUM(A1:A10)')).toBe("'@SUM(A1:A10)");
      expect(sanitizeCsvField('\tTAB_PREFIX')).toBe("'\tTAB_PREFIX");
      expect(sanitizeCsvField('\rCR_PREFIX')).toBe("'\rCR_PREFIX");
    });

    it('leaves standard benign strings unescaped', () => {
      expect(sanitizeCsvField('Q4 Enterprise List')).toBe('Q4 Enterprise List');
      expect(sanitizeCsvField('john.doe@clearshift.com')).toBe('john.doe@clearshift.com');
      expect(sanitizeCsvField('2026-11-01')).toBe('2026-11-01');
    });
  });

  describe('6. Action-Time Consent Verification on Campaign Membership', () => {
    it('sets unsubscribed flag if contact is known to have unsubscribed', async () => {
      const service = new Crm4Service();
      const unsubscribedContactId = '11111111-1111-4111-8111-000000000002';
      const campaignId = '44444444-2222-4444-8444-000000000002'; // Campaign 2 has no members initially

      const member = await service.addCampaignMember({
        campaignId,
        contactId: unsubscribedContactId,
        status: 'sent',
      });

      expect(member.unsubscribed).toBe(true);
    });

    it('keeps unsubscribed false if contact is subscribed', async () => {
      const service = new Crm4Service();
      const subscribedContactId = '11111111-1111-4111-8111-000000000001';
      const campaignId = '44444444-2222-4444-8444-000000000002'; // Campaign 2 has no members initially

      const member = await service.addCampaignMember({
        campaignId,
        contactId: subscribedContactId,
        status: 'sent',
      });

      expect(member.unsubscribed).toBe(false);
    });
  });
});
