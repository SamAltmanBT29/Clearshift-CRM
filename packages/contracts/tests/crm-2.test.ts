import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CRM2_STAGES,
  CRM2_DEAL_STAGE_TRANSITIONS,
  CRM2_STAGE_SEEDS,
  isDealStageTransitionAllowed,
  assertDealStageTransition,
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
      expect(crm2OpenApi).toContain('getQuoteById');
      expect(crm2OpenApi).toContain('422');
      expect(crm2OpenApi).toContain('409');
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

  describe('Domain Invariants & State Transitions', () => {
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

    it('enforces deal stage transition rules across the matrix', () => {
      // Allowed forward transitions
      expect(isDealStageTransitionAllowed('New', 'Qualified')).toBe(true);
      expect(isDealStageTransitionAllowed('Qualified', 'Proposal')).toBe(true);
      expect(isDealStageTransitionAllowed('Proposal', 'Negotiation')).toBe(true);
      expect(isDealStageTransitionAllowed('Negotiation', 'Won')).toBe(true);

      // Allowed immediate transitions to Lost
      expect(isDealStageTransitionAllowed('New', 'Lost')).toBe(true);
      expect(isDealStageTransitionAllowed('Qualified', 'Lost')).toBe(true);
      expect(isDealStageTransitionAllowed('Proposal', 'Lost')).toBe(true);
      expect(isDealStageTransitionAllowed('Negotiation', 'Lost')).toBe(true);

      // Idempotent same-stage updates
      for (const stage of CRM2_STAGES) {
        expect(isDealStageTransitionAllowed(stage, stage)).toBe(true);
      }

      // Forbidden backward and skip transitions
      expect(isDealStageTransitionAllowed('Proposal', 'New')).toBe(false);
      expect(isDealStageTransitionAllowed('New', 'Won')).toBe(false);
      expect(isDealStageTransitionAllowed('Won', 'New')).toBe(false);
      expect(isDealStageTransitionAllowed('Lost', 'Qualified')).toBe(false);

      expect(() => assertDealStageTransition('Proposal', 'New')).toThrow();
    });

    it('defines canonical stage seeds with matching flags and positions', () => {
      expect(CRM2_STAGE_SEEDS).toHaveLength(6);
      expect(CRM2_STAGE_SEEDS.map((s) => s.name)).toEqual(CRM2_STAGES);
      expect(CRM2_STAGE_SEEDS.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6]);

      const won = CRM2_STAGE_SEEDS.find((s) => s.name === 'Won');
      expect(won?.is_closed_won).toBe(true);
      expect(won?.is_closed_lost).toBe(false);

      const lost = CRM2_STAGE_SEEDS.find((s) => s.name === 'Lost');
      expect(lost?.is_closed_lost).toBe(true);
      expect(lost?.is_closed_won).toBe(false);
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

    it('enforces bounded pagination and rejects pageSize or limit > 100', () => {
      expect(DealsQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
      expect(DealsQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
      expect(DealsQuerySchema.safeParse({ page: 0 }).success).toBe(false);
      expect(DealsQuerySchema.safeParse({ page: -1 }).success).toBe(false);

      const parsedLimit = DealsQuerySchema.safeParse({ limit: 50 });
      expect(parsedLimit.success).toBe(true);
      if (parsedLimit.success) {
        expect(parsedLimit.data.pageSize).toBe(50);
        expect(parsedLimit.data.limit).toBe(50);
      }
    });
  });
});
