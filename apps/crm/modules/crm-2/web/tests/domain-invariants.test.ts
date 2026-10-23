import { describe, it, expect } from 'vitest';
import {
  CRM2_STAGES,
  assertValidStageName,
  Crm2StageNameSchema,
  DealSchema,
  QuoteSchema,
} from '@clearshift/contracts';

describe('CRM-2 Deals, Pipeline and Quotes: Domain Invariants', () => {
  it('Domain Invariant 1: Stage set is exactly New, Qualified, Proposal, Negotiation, Won, Lost', () => {
    // Assert the exact fixed 6 stages
    const expectedStages = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];
    expect(CRM2_STAGES).toEqual(expectedStages);
    expect(CRM2_STAGES.length).toBe(6);

    // Verify all stages parse cleanly
    for (const stage of expectedStages) {
      expect(Crm2StageNameSchema.parse(stage)).toBe(stage);
      expect(() => assertValidStageName(stage)).not.toThrow();
    }

    // Verify forbidden stage names are rejected
    const invalidStages = ['Prospect', 'Review', 'Closed', 'Archived', 'Pending', 'In Progress'];
    for (const invalid of invalidStages) {
      expect(() => assertValidStageName(invalid)).toThrowError(
        /Domain Invariant Violation: Stage '.*' is not permitted/
      );
    }
  });

  it('Domain Invariant 2: Deal value is decimal and currency is explicit 3-letter code', () => {
    const validDeal = {
      id: '20000000-0000-4000-8000-000000000001',
      name: 'Valid Opportunity',
      contact_id: '90000000-0000-4000-8000-000000000001',
      value: '150000.50',
      currency: 'USD',
      stage_id: '10000000-0000-4000-8000-000000000001',
      stage_name: 'New',
      close_date: '2026-11-30',
      is_orphan: false,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    };

    expect(DealSchema.safeParse(validDeal).success).toBe(true);

    // Invalid currency (must be 3 uppercase letters)
    expect(DealSchema.safeParse({ ...validDeal, currency: 'usd' }).success).toBe(false);
    expect(DealSchema.safeParse({ ...validDeal, currency: 'US' }).success).toBe(false);

    // Invalid decimal string
    expect(DealSchema.safeParse({ ...validDeal, value: 'invalid-decimal' }).success).toBe(false);
  });

  it('Domain Invariant 3: contact_id is nullable so orphan deals can be represented and flagged', () => {
    const orphanDeal = {
      id: '20000000-0000-4000-8000-000000000002',
      name: 'Orphan Opportunity Without Contact',
      contact_id: null, // Explicitly null
      value: '80000.00',
      currency: 'EUR',
      stage_id: '10000000-0000-4000-8000-000000000002',
      stage_name: 'Qualified',
      close_date: '2026-12-31',
      is_orphan: true,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    };

    const result = DealSchema.safeParse(orphanDeal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contact_id).toBeNull();
      expect(result.data.is_orphan).toBe(true);
    }
  });

  it('Domain Invariant 4: Quote number is unique and amount is decimal', () => {
    const validQuote = {
      id: '30000000-0000-4000-8000-000000000001',
      deal_id: '20000000-0000-4000-8000-000000000001',
      quote_number: 'Q-2026-001',
      date: '2026-10-15',
      amount: '50000.00',
      currency: 'USD',
      note: 'Initial scope quote',
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    };

    expect(QuoteSchema.safeParse(validQuote).success).toBe(true);
    expect(QuoteSchema.safeParse({ ...validQuote, amount: 'abc' }).success).toBe(false);
    expect(QuoteSchema.safeParse({ ...validQuote, quote_number: '' }).success).toBe(false);
  });
});
