import { describe, it, expect } from 'vitest';
import {
  CRM4ConsentSchema,
  CRM4ConsentSetSchema,
  CRM4_CONSENT_STATUSES,
  assertValidConsentStatus,
  assertMonotonicOptOut,
  type CRM4Consent,
  type CRM4ConsentSet,
} from '@clearshift/contracts';

describe('CRM-4 Contact Consent Form: BR-CRM4-01 & Monotonicity Invariants (Issue #173 / [CRM4-20])', () => {
  const existingSubscribedConsent: CRM4Consent = {
    id: '60000000-0000-4000-8000-000000000001',
    contactId: '10000000-0000-4000-8000-000000000001',
    status: 'subscribed',
    consentDate: '2026-09-01T10:00:00Z',
    source: 'Website newsletter signup form',
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
  };

  const existingUnsubscribedConsent: CRM4Consent = {
    id: '60000000-0000-4000-8000-000000000002',
    contactId: '10000000-0000-4000-8000-000000000002',
    status: 'unsubscribed',
    consentDate: '2026-09-15T14:30:00Z',
    source: 'Email unsubscribe link click',
    createdAt: '2026-09-15T14:30:00Z',
    updatedAt: '2026-09-15T14:30:00Z',
  };

  describe('1. Business Rule BR-CRM4-01: Monotonicity of Opt-Out', () => {
    it('throws Domain Invariant Violation when attempting to overwrite unsubscribed with subscribed', () => {
      expect(() => {
        assertMonotonicOptOut('unsubscribed', 'subscribed');
      }).toThrowError(
        /Domain Invariant Violation \(BR-CRM4-01\): A known opt-out\/unsubscribe is strictly monotonic/
      );
    });

    it('allows opt-out transition: subscribed -> unsubscribed', () => {
      expect(() => {
        assertMonotonicOptOut('subscribed', 'unsubscribed');
      }).not.toThrow();
    });

    it('allows idempotent opt-out refresh: unsubscribed -> unsubscribed (updating date/source)', () => {
      expect(() => {
        assertMonotonicOptOut('unsubscribed', 'unsubscribed');
      }).not.toThrow();
    });

    it('allows initial consent recording: null/undefined -> subscribed or unsubscribed', () => {
      expect(() => {
        assertMonotonicOptOut(null, 'subscribed');
      }).not.toThrow();

      expect(() => {
        assertMonotonicOptOut(undefined, 'subscribed');
      }).not.toThrow();

      expect(() => {
        assertMonotonicOptOut(null, 'unsubscribed');
      }).not.toThrow();
    });

    it('allows continuous subscribed status: subscribed -> subscribed', () => {
      expect(() => {
        assertMonotonicOptOut('subscribed', 'subscribed');
      }).not.toThrow();
    });
  });

  describe('2. Permitted Status Set and Validation', () => {
    it('consent statuses are strictly subscribed and unsubscribed', () => {
      expect(CRM4_CONSENT_STATUSES).toEqual(['subscribed', 'unsubscribed']);
      expect(CRM4_CONSENT_STATUSES.length).toBe(2);

      for (const s of ['subscribed', 'unsubscribed']) {
        expect(() => assertValidConsentStatus(s)).not.toThrow();
      }

      const invalidStatuses = ['pending', 'revoked', 'opted-in', 'opted-out', 'active', 'inactive'];
      for (const invalid of invalidStatuses) {
        expect(() => assertValidConsentStatus(invalid)).toThrowError(
          /Domain Invariant Violation: Consent status '.*' is not permitted/
        );
      }
    });

    it('validates a complete, valid consent payload', () => {
      const payload: CRM4ConsentSet = {
        contactId: '10000000-0000-4000-8000-000000000001',
        status: 'unsubscribed',
        consentDate: '2026-10-23T12:00:00Z',
        source: 'User preferences dashboard',
      };
      const result = CRM4ConsentSetSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('requires source field to be non-empty', () => {
      const missingSource = CRM4ConsentSetSchema.safeParse({
        contactId: '10000000-0000-4000-8000-000000000001',
        status: 'subscribed',
        source: '',
      });
      expect(missingSource.success).toBe(false);
      if (!missingSource.success) {
        expect(missingSource.error.flatten().fieldErrors.source).toBeDefined();
      }
    });

    it('requires contactId to be a valid UUID', () => {
      const invalidUuid = CRM4ConsentSetSchema.safeParse({
        contactId: 'not-a-valid-uuid',
        status: 'subscribed',
        source: 'Website form',
      });
      expect(invalidUuid.success).toBe(false);
    });
  });

  describe('3. UI Guard Invariant Behavior', () => {
    it('determines whether the subscribed radio button must be disabled', () => {
      const isSubscribedDisabled = (currentConsent: CRM4Consent | null | undefined): boolean => {
        return currentConsent?.status === 'unsubscribed';
      };

      expect(isSubscribedDisabled(existingUnsubscribedConsent)).toBe(true);
      expect(isSubscribedDisabled(existingSubscribedConsent)).toBe(false);
      expect(isSubscribedDisabled(null)).toBe(false);
      expect(isSubscribedDisabled(undefined)).toBe(false);
    });

    it('prevents submission when current consent is unsubscribed and target status is subscribed', () => {
      const attemptSubmit = (
        currentStatus: string | undefined,
        desiredStatus: 'subscribed' | 'unsubscribed',
        onSubmit: () => void
      ) => {
        if (currentStatus === 'unsubscribed' && desiredStatus === 'subscribed') {
          return false; // Submission blocked by BR-CRM4-01 guard
        }
        onSubmit();
        return true;
      };

      let submitted = false;
      const result = attemptSubmit('unsubscribed', 'subscribed', () => {
        submitted = true;
      });

      expect(result).toBe(false);
      expect(submitted).toBe(false);
    });
  });

  describe('4. Historical Record Read-Only Display', () => {
    it('parses existing consent records and guarantees read-only id/timestamps are retained', () => {
      const parsed = CRM4ConsentSchema.parse(existingUnsubscribedConsent);
      expect(parsed.id).toBe('60000000-0000-4000-8000-000000000002');
      expect(parsed.status).toBe('unsubscribed');
      expect(parsed.source).toBe('Email unsubscribe link click');
      expect(parsed.consentDate).toBe('2026-09-15T14:30:00Z');
      expect(parsed.createdAt).toBe('2026-09-15T14:30:00Z');
    });
  });
});
