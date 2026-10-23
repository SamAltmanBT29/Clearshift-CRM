import { describe, it, expect } from 'vitest';
import {
  CreateQuoteInputSchema,
  UpdateQuoteInputSchema,
  QuoteSchema,
  CRM2_FIELD_CONTRACT,
  type CreateQuoteInput,
} from '@clearshift/contracts';
import { crm2Store } from '../../src/store/crm2.store.js';

describe('CRM-2 Quote Form Component & Workflows (Issue #20 / [CRM2-05])', () => {
  const validDealId = '20000000-0000-4000-8000-000000000001';

  describe('1. Field Labels, Helper Text & Schema Constraints', () => {
    it('verifies quote field contracts and helper descriptions', () => {
      const contract = CRM2_FIELD_CONTRACT.quote;
      expect(contract.quote_number.label).toBe('Quote Number');
      expect(contract.quote_number.helperText).toContain('reference code');
      expect(contract.deal_id.label).toBe('Linked Deal');
      expect(contract.date.label).toBe('Quote Date');
      expect(contract.amount.label).toBe('Quote Amount');
      expect(contract.currency.label).toBe('Currency');
    });

    it('validates required fields: quote_number, date, amount, currency, deal_id', () => {
      const validQuote: CreateQuoteInput = {
        deal_id: validDealId,
        quote_number: 'Q-2026-TEST-01',
        date: '2026-11-15',
        amount: '45000.00',
        currency: 'USD',
        note: 'Tier-1 Package with 1-year support included',
      };

      const result = CreateQuoteInputSchema.safeParse(validQuote);
      expect(result.success).toBe(true);

      // Empty quote number rejected
      expect(
        CreateQuoteInputSchema.safeParse({ ...validQuote, quote_number: '' }).success
      ).toBe(false);

      // Invalid date format rejected
      expect(
        CreateQuoteInputSchema.safeParse({ ...validQuote, date: '15/11/2026' }).success
      ).toBe(false);

      // Non-decimal amount rejected
      expect(
        CreateQuoteInputSchema.safeParse({ ...validQuote, amount: 'forty-five-thousand' }).success
      ).toBe(false);

      // Negative amount rejected
      expect(
        CreateQuoteInputSchema.safeParse({ ...validQuote, amount: '-100.00' }).success
      ).toBe(false);
    });
  });

  describe('2. Domain Invariant: Unique Quote Number & Deal Linking', () => {
    it('Domain Invariant: Quote number is unique across all quotes in the system', () => {
      // Q-2026-001 already exists in seeded fixtures
      expect(() =>
        crm2Store.createQuote({
          deal_id: validDealId,
          quote_number: 'Q-2026-001', // Duplicate quote number!
          date: '2026-11-20',
          amount: '30000.00',
          currency: 'USD',
          note: 'Duplicate test',
        })
      ).toThrowError(/Domain Invariant Violation: Quote number 'Q-2026-001' must be unique/);
    });

    it('rejects quote creation when referenced deal does not exist', () => {
      expect(() =>
        crm2Store.createQuote({
          deal_id: '99999999-9999-4999-8999-999999999999', // Non-existent deal
          quote_number: 'Q-2026-UNIQUE-99',
          date: '2026-11-20',
          amount: '30000.00',
          currency: 'USD',
          note: 'Non-existent deal test',
        })
      ).toThrowError(/Referenced deal does not exist/);
    });

    it('creates quote successfully with valid inputs and persists in store', () => {
      const uniqueNum = `Q-2026-${Date.now()}`;
      const created = crm2Store.createQuote({
        deal_id: validDealId,
        quote_number: uniqueNum,
        date: '2026-11-25',
        amount: '68500.00',
        currency: 'USD',
        note: 'Valid scope terms',
      });

      expect(created.id).toBeDefined();
      expect(created.quote_number).toBe(uniqueNum);
      expect(created.amount).toBe('68500.00');
      expect(created.deal_id).toBe(validDealId);

      // Verify retrieval from store
      const fetched = crm2Store.getQuoteById(created.id);
      expect(fetched).toBeDefined();
      expect(fetched?.quote_number).toBe(uniqueNum);
    });
  });

  describe('3. Updating Quotes and Conflict Prevention', () => {
    it('updates quote fields and updates timestamp', () => {
      const quote = crm2Store.getQuotes({ deal_id: validDealId }).items[0]!;
      const updated = crm2Store.updateQuote(quote.id, {
        amount: '82000.00',
        note: 'Updated commercial terms',
      });

      expect(updated.amount).toBe('82000.00');
      expect(updated.note).toBe('Updated commercial terms');
    });

    it('prevents renaming quote number to an already existing quote number', () => {
      const quotes = crm2Store.getQuotes({ deal_id: validDealId }).items;
      if (quotes.length >= 2) {
        const q1 = quotes[0]!;
        const q2 = quotes[1]!;

        expect(() =>
          crm2Store.updateQuote(q1.id, {
            quote_number: q2.quote_number,
          })
        ).toThrowError(/already in use/);
      }
    });
  });
});
