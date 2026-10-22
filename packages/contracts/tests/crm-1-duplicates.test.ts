import { describe, expect, it } from 'vitest';
import {
  buildContactExactEmailKey,
  buildContactExactPhoneNameKey,
  buildCompanyExactTaxKey,
  evaluateContactDuplicate,
  evaluateCompanyDuplicate,
  ALLOWED_LEAD_TRANSITIONS,
  canTransitionLeadStatus,
  assertValidLeadTransition,
  type ExistingContactRecord,
  type ExistingCompanyRecord,
} from '../src/crm-1-duplicates.js';

describe('CRM-1 Duplicate Matching & Lead Status Transitions', () => {
  describe('Key Normalizers', () => {
    it('normalizes email key by trimming, lowercasing, and handling null/empty', () => {
      expect(buildContactExactEmailKey('  ALICE@DOMAIN.COM  ')).toBe('alice@domain.com');
      expect(buildContactExactEmailKey('alice@domain.com')).toBe('alice@domain.com');
      expect(buildContactExactEmailKey(null)).toBeNull();
      expect(buildContactExactEmailKey(undefined)).toBeNull();
      expect(buildContactExactEmailKey('   ')).toBeNull();
    });

    it('builds normalized exact phone + name combined key', () => {
      const key = buildContactExactPhoneNameKey(
        '+1 (555) 012-3456',
        '  Bob ',
        ' Dylan '
      );
      expect(key).toBe('+15550123456#bob dylan');

      expect(buildContactExactPhoneNameKey(null, 'Bob', 'Dylan')).toBeNull();
      expect(buildContactExactPhoneNameKey('+15550123456', '', 'Dylan')).toBeNull();
      expect(buildContactExactPhoneNameKey('+15550123456', 'Bob', null)).toBeNull();
    });

    it('builds normalized company tax number key', () => {
      expect(buildCompanyExactTaxKey(' US-TAX-987-654 ')).toBe('USTAX987654');
      expect(buildCompanyExactTaxKey(null)).toBeNull();
      expect(buildCompanyExactTaxKey('   ')).toBeNull();
    });
  });

  describe('evaluateContactDuplicate (Deterministic Exact Matching)', () => {
    const existingPool: ExistingContactRecord[] = [
      {
        id: 'contact-001',
        goldenId: 'GID-001',
        firstName: 'Carol',
        lastName: 'Danvers',
        email: 'carol.danvers@marvel.synthetic',
        phone: '+1-555-0101',
      },
      {
        id: 'contact-002',
        goldenId: 'GID-002',
        firstName: 'Peter',
        lastName: 'Parker',
        email: 'spidey@nyc.synthetic',
        phone: '+1-555-0202',
      },
      {
        id: 'contact-003',
        goldenId: 'GID-003',
        firstName: 'Peter',
        lastName: 'Parker',
        email: 'peter.parker@dailybugle.synthetic',
        phone: '+1-555-0303',
      },
    ];

    it('returns NO_MATCH when candidate does not match any existing record', () => {
      const result = evaluateContactDuplicate(
        {
          firstName: 'Tony',
          lastName: 'Stark',
          email: 'tony@stark.synthetic',
          phone: '+1-555-9999',
        },
        existingPool
      );

      expect(result.outcome).toBe('NO_MATCH');
      expect(result.requiresHumanReview).toBe(false);
      expect(result.matchingKeys).toHaveLength(0);
    });

    it('returns EXACT_MATCH when normalized email matches exactly one existing record', () => {
      const result = evaluateContactDuplicate(
        {
          firstName: 'Carol',
          lastName: 'Danvers',
          email: '  CAROL.DANVERS@MARVEL.SYNTHETIC  ',
          phone: '+1-555-0999',
        },
        existingPool
      );

      expect(result.outcome).toBe('EXACT_MATCH');
      expect(result.matchedId).toBe('contact-001');
      expect(result.matchedGoldenId).toBe('GID-001');
      expect(result.requiresHumanReview).toBe(false);
      expect(result.matchingKeys).toContain('email:carol.danvers@marvel.synthetic');
    });

    it('returns EXACT_MATCH when phone + name matches exactly one existing record', () => {
      const result = evaluateContactDuplicate(
        {
          firstName: 'Peter',
          lastName: 'Parker',
          email: 'different.peter@parker.synthetic',
          phone: '+1 (555) 0202',
        },
        existingPool
      );

      expect(result.outcome).toBe('EXACT_MATCH');
      expect(result.matchedId).toBe('contact-002');
      expect(result.matchedGoldenId).toBe('GID-002');
      expect(result.requiresHumanReview).toBe(false);
    });

    it('returns AMBIGUOUS_REVIEW_REQUIRED when candidate matches multiple distinct contacts', () => {
      // Candidate has email of contact-001 but phone+name of contact-002
      const result = evaluateContactDuplicate(
        {
          firstName: 'Peter',
          lastName: 'Parker',
          email: 'carol.danvers@marvel.synthetic',
          phone: '+1-555-0202',
        },
        existingPool
      );

      expect(result.outcome).toBe('AMBIGUOUS_REVIEW_REQUIRED');
      expect(result.requiresHumanReview).toBe(true);
      expect(result.matchedId).toBeUndefined();
      expect(result.reason).toContain('Ambiguous match: candidate matches 2 different contacts');
    });

    it('ignores self when candidate.id matches existing record ID during update', () => {
      const result = evaluateContactDuplicate(
        {
          id: 'contact-001',
          firstName: 'Carol',
          lastName: 'Danvers',
          email: 'carol.danvers@marvel.synthetic',
          phone: '+1-555-0101',
        },
        existingPool
      );

      expect(result.outcome).toBe('NO_MATCH');
    });
  });

  describe('evaluateCompanyDuplicate (Deterministic Exact Tax Key)', () => {
    const existingCompanies: ExistingCompanyRecord[] = [
      {
        id: 'comp-001',
        name: 'Stark Industries',
        taxNumber: 'US-STARK-001',
      },
      {
        id: 'comp-002',
        name: 'Wayne Enterprises',
        taxNumber: 'US-WAYNE-002',
      },
      {
        id: 'comp-003',
        name: 'Wayne Gotham Corp',
        taxNumber: 'US-WAYNE-002', // Deliberate test duplicate for ambiguity
      },
    ];

    it('returns NO_MATCH when tax number is absent or un-matched', () => {
      expect(
        evaluateCompanyDuplicate({ name: 'Oscorp', taxNumber: null }, existingCompanies).outcome
      ).toBe('NO_MATCH');

      expect(
        evaluateCompanyDuplicate({ name: 'Oscorp', taxNumber: 'US-OSCORP-999' }, existingCompanies).outcome
      ).toBe('NO_MATCH');
    });

    it('returns EXACT_MATCH when normalized tax number matches exactly one company', () => {
      const result = evaluateCompanyDuplicate(
        { name: 'Stark Ind', taxNumber: '  US-STARK-001  ' },
        existingCompanies
      );

      expect(result.outcome).toBe('EXACT_MATCH');
      expect(result.matchedId).toBe('comp-001');
      expect(result.requiresHumanReview).toBe(false);
    });

    it('returns AMBIGUOUS_REVIEW_REQUIRED when tax number matches multiple companies', () => {
      const result = evaluateCompanyDuplicate(
        { name: 'Wayne Holding', taxNumber: 'US-WAYNE-002' },
        existingCompanies
      );

      expect(result.outcome).toBe('AMBIGUOUS_REVIEW_REQUIRED');
      expect(result.requiresHumanReview).toBe(true);
      expect(result.candidateMatches).toHaveLength(2);
    });
  });

  describe('Lead Status Transitions (SDS Allowlist)', () => {
    it('defines correct SDS transition allowlist', () => {
      expect(ALLOWED_LEAD_TRANSITIONS.New).toEqual(['Working', 'Qualified', 'Closed']);
      expect(ALLOWED_LEAD_TRANSITIONS.Working).toEqual(['Qualified', 'Closed']);
      expect(ALLOWED_LEAD_TRANSITIONS.Qualified).toEqual(['Closed']);
      expect(ALLOWED_LEAD_TRANSITIONS.Closed).toEqual([]);
    });

    it('allows permitted transitions', () => {
      expect(canTransitionLeadStatus('New', 'Working')).toBe(true);
      expect(canTransitionLeadStatus('New', 'Qualified')).toBe(true);
      expect(canTransitionLeadStatus('New', 'Closed')).toBe(true);
      expect(canTransitionLeadStatus('Working', 'Qualified')).toBe(true);
      expect(canTransitionLeadStatus('Working', 'Closed')).toBe(true);
      expect(canTransitionLeadStatus('Qualified', 'Closed')).toBe(true);
      expect(canTransitionLeadStatus('Working', 'Working')).toBe(true); // No-op
    });

    it('prohibits backwards or unauthorized transitions', () => {
      expect(canTransitionLeadStatus('Working', 'New')).toBe(false);
      expect(canTransitionLeadStatus('Qualified', 'Working')).toBe(false);
      expect(canTransitionLeadStatus('Qualified', 'New')).toBe(false);
      expect(canTransitionLeadStatus('Closed', 'New')).toBe(false);
      expect(canTransitionLeadStatus('Closed', 'Working')).toBe(false);
      expect(canTransitionLeadStatus('Closed', 'Qualified')).toBe(false);
    });

    it('assertValidLeadTransition throws descriptive error on invalid transition', () => {
      expect(() => assertValidLeadTransition('Qualified', 'New')).toThrowError(
        /Invalid lead status transition from 'Qualified' to 'New'/
      );
      expect(() => assertValidLeadTransition('Closed', 'Working')).toThrowError(
        /terminal state/
      );
      expect(() => assertValidLeadTransition('New', 'Working')).not.toThrow();
    });
  });
});
