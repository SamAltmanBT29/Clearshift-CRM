import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CRM2_STAGES,
  assertValidStageName,
  Crm2StageNameSchema,
  DealSchema,
  QuoteSchema,
  StageSchema,
  CreateDealInputSchema,
  CreateQuoteInputSchema,
  DealsQuerySchema,
} from '../src/crm-2.js';

const crm2OpenApi = readFileSync(new URL('../openapi/crm-2.yaml', import.meta.url), 'utf8');

describe('CRM-2 Deals, Pipeline and Quotes Public Contracts & OpenAPI', () => {
  describe('OpenAPI 3.1 Spec Baseline', () => {
    it('validates crm-2.yaml exists and defines all required V1 endpoints', () => {
      expect(crm2OpenApi).toContain('openapi: 3.1.0');
      expect(crm2OpenApi).toContain('ClearShift CRM-2 Deals, Pipeline and Quotes API');
      expect(crm2OpenApi).toContain('/deals:');
      expect(crm2OpenApi).toContain('/deals/{id}:');
      expect(crm2OpenApi).toContain('/stages:');
      expect(crm2OpenApi).toContain('/quotes:');
      expect(crm2OpenApi).toContain('/quotes/{id}:');
    });

    it('documents fixed stages in OpenAPI schema', () => {
      expect(crm2OpenApi).toContain('- New');
      expect(crm2OpenApi).toContain('- Qualified');
      expect(crm2OpenApi).toContain('- Proposal');
      expect(crm2OpenApi).toContain('- Negotiation');
      expect(crm2OpenApi).toContain('- Won');
      expect(crm2OpenApi).toContain('- Lost');
    });
  });

  describe('Domain Invariants', () => {
    it('Stage set is exactly New, Qualified, Proposal, Negotiation, Won, Lost', () => {
      expect(CRM2_STAGES).toEqual(['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']);
      expect(CRM2_STAGES.length).toBe(6);

      for (const stage of CRM2_STAGES) {
        expect(Crm2StageNameSchema.parse(stage)).toBe(stage);
        expect(() => assertValidStageName(stage)).not.toThrow();
      }

      expect(() => assertValidStageName('ClosedWon')).toThrow();
      expect(() => assertValidStageName('Draft')).toThrow();
    });

    it('validates deal financial precision, explicit currency, and orphan flag', () => {
      const validDeal = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Enterprise Contract',
        contact_id: null, // Orphan deal
        value: '50000.00',
        currency: 'USD',
        stage_id: '123e4567-e89b-12d3-a456-426614174001',
        stage_name: 'Proposal',
        close_date: '2026-12-31',
        is_orphan: true,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      };

      const parsed = DealSchema.safeParse(validDeal);
      expect(parsed.success).toBe(true);

      // Rejects non-3-letter currency
      expect(DealSchema.safeParse({ ...validDeal, currency: 'US' }).success).toBe(false);
      expect(DealSchema.safeParse({ ...validDeal, currency: 'us-dollar' }).success).toBe(false);
    });

    it('enforces unique quote number and decimal format on quotes', () => {
      const validQuote = {
        id: '123e4567-e89b-12d3-a456-426614174002',
        deal_id: '123e4567-e89b-12d3-a456-426614174000',
        quote_number: 'Q-2026-001',
        date: '2026-11-15',
        amount: '12000.50',
        currency: 'USD',
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      };

      expect(QuoteSchema.safeParse(validQuote).success).toBe(true);
      expect(QuoteSchema.safeParse({ ...validQuote, amount: 'not-a-number' }).success).toBe(false);
    });

    it('defaults query parameters for deals listing', () => {
      const query = DealsQuerySchema.parse({});
      expect(query.page).toBe(1);
      expect(query.pageSize).toBe(10);
    });
  });
});
