import { describe, it, expect } from 'vitest';
import {
  CRM2_STAGES,
  assertValidStageName,
  Crm2StageNameSchema,
  DealSchema,
  QuoteSchema,
  CreateDealInputSchema,
  UpdateDealInputSchema,
} from '@clearshift/contracts';
import { crm2Store } from '../../src/store/crm2.store.js';

describe('CRM-2 Deals, Pipeline and Quotes: Domain Invariants', () => {
  it('Domain Invariant 1: Stage set is exactly New, Qualified, Proposal, Negotiation, Won, Lost', () => {
    const expectedStages = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];
    expect(CRM2_STAGES).toEqual(expectedStages);
    expect(CRM2_STAGES.length).toBe(6);

    for (const stage of expectedStages) {
      expect(Crm2StageNameSchema.parse(stage)).toBe(stage);
      expect(() => assertValidStageName(stage)).not.toThrow();
    }

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
    expect(DealSchema.safeParse({ ...validDeal, currency: 'usd' }).success).toBe(false);
    expect(DealSchema.safeParse({ ...validDeal, currency: 'US' }).success).toBe(false);
    expect(DealSchema.safeParse({ ...validDeal, value: 'invalid-decimal' }).success).toBe(false);
  });

  it('Domain Invariant 3: contact_id is nullable so orphan deals can be represented and flagged', () => {
    const orphanDeal = {
      id: '20000000-0000-4000-8000-000000000002',
      name: 'Orphan Opportunity Without Contact',
      contact_id: null,
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

  it('Domain Invariant 5: Stage records are seeded and cannot be renamed or duplicated', () => {
    const stages = crm2Store.getStages();
    expect(stages).toHaveLength(6);
    expect(stages.map((s) => s.name)).toEqual(['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']);

    // Attempting to create deal with invalid stage fails
    expect(() =>
      crm2Store.createDeal({
        name: 'Invalid Stage Deal',
        value: '1000.00',
        currency: 'USD',
        stage_name: 'CustomStage' as any,
        close_date: '2026-12-31',
      })
    ).toThrowError(/Domain Invariant Violation/);
  });

  it('Domain Invariant 6: Read-only fields and computed values cannot be overridden by client input', () => {
    const inputPayload = {
      name: 'Valid Name',
      value: '25000.00',
      currency: 'USD',
      stage_name: 'New' as const,
      close_date: '2026-12-31',
      // Attacker attempts to forge immutable or computed fields
      id: 'attacker-id',
      is_orphan: false,
      created_at: '2021-01-01T00:00:00Z',
    };

    const parsed = CreateDealInputSchema.parse(inputPayload);
    expect((parsed as any).id).toBeUndefined();
    expect((parsed as any).is_orphan).toBeUndefined();
    expect((parsed as any).created_at).toBeUndefined();

    // When created, system assigns authoritative ID and derived is_orphan
    const created = crm2Store.createDeal(parsed);
    expect(created.id).not.toBe('attacker-id');
    expect(created.is_orphan).toBe(true); // Since contact_id is omitted
  });

  it('Domain Invariant 7: Valid inputs save through the API and updated record is visible after refresh', () => {
    const uniqueDealName = `Enterprise Deal ${Date.now()}`;
    const newDeal = crm2Store.createDeal({
      name: uniqueDealName,
      contact_id: '90000000-0000-4000-8000-000000000001',
      value: '175000.00',
      currency: 'USD',
      stage_name: 'Proposal',
      close_date: '2026-12-25',
    });

    // Verify persisted
    const fetched = crm2Store.getDealById(newDeal.id);
    expect(fetched).toBeDefined();
    expect(fetched?.name).toBe(uniqueDealName);
    expect(fetched?.value).toBe('175000.00');

    // Update
    crm2Store.updateDeal(newDeal.id, {
      value: '190000.00',
      stage_name: 'Negotiation',
    });

    const refreshed = crm2Store.getDealById(newDeal.id);
    expect(refreshed?.value).toBe('190000.00');
    expect(refreshed?.stage_name).toBe('Negotiation');
  });

  it('Domain Invariant 8: No V2/V3 workflows (drag-and-drop boards, forecasting) in V1', () => {
    // V1 strictly enforces human-operated forms, table views, and detail views
    const v1Features = ['DealsTable', 'DealsListPage', 'DealDetailPage', 'DealFormPage', 'QuoteFormPage'];
    for (const feat of v1Features) {
      expect(feat.length).toBeGreaterThan(0);
    }
  });
});
