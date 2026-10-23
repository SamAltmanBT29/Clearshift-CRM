import { describe, expect, it } from 'vitest';
import {
  buildDealExactBusinessKey,
  buildDealNameContactKey,
  buildQuoteExactKey,
  buildQuoteLineExactKey,
  buildSourcePairKey,
  normalizeCrm2ExactKey,
  evaluateDealDuplicate,
  evaluateQuoteDuplicate,
  type ExistingDealRecord,
  type ExistingQuoteRecord,
  Crm2DetectDuplicatesInputSchema,
  Crm2ResolveDuplicateInputSchema,
} from '../src/crm-2-duplicates.js';

describe('CRM-2 Exact Duplicate Key Contracts & Domain Logic (CRM2-12)', () => {
  describe('Key Normalizers', () => {
    it('builds normalized deal business key: ${name}#${stageId}#${contactId}', () => {
      const key = buildDealExactBusinessKey({
        name: '  ACME   Cloud   Migration  ',
        stageId: '  Stage-001  ',
        contactId: '  Contact-999  ',
      });
      expect(key).toBe('acme cloud migration#stage-001#contact-999');
    });

    it('defaults contactId to orphan when null or undefined in deal business key', () => {
      const key1 = buildDealExactBusinessKey({
        name: 'Enterprise License',
        stageId: 'stage-1',
        contactId: null,
      });
      expect(key1).toBe('enterprise license#stage-1#orphan');

      const key2 = buildDealExactBusinessKey({
        name: 'Enterprise License',
        stageId: 'stage-1',
        contactId: undefined,
      });
      expect(key2).toBe('enterprise license#stage-1#orphan');

      const key3 = buildDealExactBusinessKey({
        name: 'Enterprise License',
        stageId: 'stage-1',
        contactId: '   ',
      });
      expect(key3).toBe('enterprise license#stage-1#orphan');
    });

    it('builds normalized deal name + contact key', () => {
      expect(buildDealNameContactKey('  Big Deal ', 'cnt-01')).toBe('big deal#cnt-01');
      expect(buildDealNameContactKey('Big Deal', null)).toBe('big deal#orphan');
    });

    it('builds normalized quote key (trimmed uppercase quote number)', () => {
      expect(buildQuoteExactKey('  q-2026-001  ')).toBe('Q-2026-001');
      expect(buildQuoteExactKey('quote-99')).toBe('QUOTE-99');
      expect(buildQuoteExactKey(null as any)).toBe('');
    });

    it('builds quote line item SKU key within quote', () => {
      expect(buildQuoteLineExactKey('quote-123', '  sku-abc-01  ')).toBe('quote-123#SKU-ABC-01');
    });

    it('builds normalized migration source pair key', () => {
      expect(buildSourcePairKey('  Salesforce  ', '  OPP-5501  ')).toBe('salesforce:OPP-5501');
    });

    it('dispatches through normalizeCrm2ExactKey for all supported key types', () => {
      expect(normalizeCrm2ExactKey('quote_number', '  q-001 ')).toBe('Q-001');
      expect(normalizeCrm2ExactKey('sku', '  widget-x1 ')).toBe('WIDGET-X1');
      expect(normalizeCrm2ExactKey('email', '  Sales@ClearShift.Com ')).toBe('sales@clearshift.com');
      expect(normalizeCrm2ExactKey('tax_id', 'US-99-8877')).toBe('US998877');
      expect(normalizeCrm2ExactKey('phone', ' +1 (555) 000-1111 ')).toBe('+15550001111');
      expect(normalizeCrm2ExactKey('deal_name_contact', '  Acme Deal # cnt-1 ')).toBe('acme deal # cnt-1');
      expect(normalizeCrm2ExactKey('quote_line_sku', '  sku-line-1 ')).toBe('SKU-LINE-1');
      expect(normalizeCrm2ExactKey('source_key', '  LEGACY:001 ')).toBe('legacy:001');
      expect(normalizeCrm2ExactKey('composite', '  Stage:New;Val:100 ')).toBe('stage:new;val:100');
    });
  });

  describe('evaluateDealDuplicate (Deterministic Exact Matching)', () => {
    const existingPool: ExistingDealRecord[] = [
      {
        id: 'deal-001',
        name: 'Acme Cloud Modernization',
        stageId: 'stage-prop',
        contactId: 'cnt-sarah',
        value: '75000.00',
        currency: 'USD',
      },
      {
        id: 'deal-002',
        name: 'Inbound Enterprise Lead',
        stageId: 'stage-new',
        contactId: null, // orphan
        value: '50000.00',
        currency: 'USD',
      },
      {
        id: 'deal-003',
        name: 'Global Rollout Phase 1',
        stageId: 'stage-neg',
        contactId: 'cnt-sarah',
        value: '120000.00',
        currency: 'USD',
      },
      {
        id: 'deal-004',
        name: 'Acme Cloud Modernization',
        stageId: 'stage-won',
        contactId: 'cnt-other',
        value: '90000.00',
        currency: 'USD',
      },
    ];

    it('returns NO_MATCH when deal candidate does not match existing records', () => {
      const result = evaluateDealDuplicate(
        {
          name: 'Unique Software Contract',
          stageId: 'stage-prop',
          contactId: 'cnt-sarah',
        },
        existingPool
      );

      expect(result.outcome).toBe('NO_MATCH');
      expect(result.requiresHumanReview).toBe(false);
      expect(result.matchingKeys).toHaveLength(0);
    });

    it('returns EXACT_MATCH when normalized deal matches single existing record on business key', () => {
      const result = evaluateDealDuplicate(
        {
          name: '  ACME   Cloud   Modernization  ',
          stageId: 'stage-prop',
          contactId: 'cnt-sarah',
        },
        existingPool
      );

      expect(result.outcome).toBe('EXACT_MATCH');
      expect(result.matchedId).toBe('deal-001');
      expect(result.requiresHumanReview).toBe(false);
      expect(result.matchingKeys).toContain('deal_business:acme cloud modernization#stage-prop#cnt-sarah');
    });

    it('matches orphan deals deterministically using orphan placeholder', () => {
      const result = evaluateDealDuplicate(
        {
          name: 'INBOUND ENTERPRISE LEAD',
          stageId: 'stage-new',
          contactId: null,
        },
        existingPool
      );

      expect(result.outcome).toBe('EXACT_MATCH');
      expect(result.matchedId).toBe('deal-002');
      expect(result.matchingKeys).toContain('deal_business:inbound enterprise lead#stage-new#orphan');
    });

    it('returns AMBIGUOUS_REVIEW_REQUIRED when candidate matches multiple distinct existing deals', () => {
      const ambiguousPool: ExistingDealRecord[] = [
        {
          id: 'deal-a',
          name: 'Renewal 2026',
          stageId: 'stage-prop',
          contactId: 'cnt-beta',
        },
        {
          id: 'deal-b',
          name: 'Renewal 2026',
          stageId: 'stage-neg',
          contactId: 'cnt-beta',
        },
      ];

      const result = evaluateDealDuplicate(
        {
          name: 'Renewal 2026',
          stageId: 'stage-new',
          contactId: 'cnt-beta',
        },
        ambiguousPool
      );

      expect(result.outcome).toBe('AMBIGUOUS_REVIEW_REQUIRED');
      expect(result.requiresHumanReview).toBe(true);
      expect(result.candidateMatches.length).toBeGreaterThanOrEqual(2);
      expect(result.reason).toContain('Ambiguous match: candidate matches 2 different deal records');
    });

    it('ignores itself when candidate ID is present in the pool', () => {
      const result = evaluateDealDuplicate(
        {
          id: 'deal-001',
          name: 'Acme Cloud Modernization',
          stageId: 'stage-prop',
          contactId: 'cnt-sarah',
        },
        existingPool
      );

      expect(result.outcome).toBe('NO_MATCH');
    });
  });

  describe('evaluateQuoteDuplicate (Unique Quote Numbers)', () => {
    const existingQuotes: ExistingQuoteRecord[] = [
      {
        id: 'quote-001',
        quoteNumber: 'Q-2026-001',
        dealId: 'deal-001',
        amount: '75000.00',
        currency: 'USD',
      },
      {
        id: 'quote-002',
        quoteNumber: 'Q-2026-002',
        dealId: 'deal-002',
        amount: '50000.00',
        currency: 'USD',
      },
    ];

    it('returns NO_MATCH when quote number is unique', () => {
      const result = evaluateQuoteDuplicate(
        { quoteNumber: 'Q-2026-099' },
        existingQuotes
      );
      expect(result.outcome).toBe('NO_MATCH');
      expect(result.requiresHumanReview).toBe(false);
    });

    it('returns EXACT_MATCH when normalized quote number matches existing record', () => {
      const result = evaluateQuoteDuplicate(
        { quoteNumber: '  q-2026-001  ' },
        existingQuotes
      );
      expect(result.outcome).toBe('EXACT_MATCH');
      expect(result.matchedId).toBe('quote-001');
      expect(result.matchingKeys).toContain('quote_number:Q-2026-001');
    });

    it('ignores itself when candidate ID matches existing quote', () => {
      const result = evaluateQuoteDuplicate(
        { id: 'quote-001', quoteNumber: 'Q-2026-001' },
        existingQuotes
      );
      expect(result.outcome).toBe('NO_MATCH');
    });
  });

  describe('Zod Validation Schemas', () => {
    it('validates Crm2DetectDuplicatesInputSchema', () => {
      const valid = {
        batchId: 'batch-01',
        entity: 'deal',
        keyType: 'deal_business',
        records: [
          { id: 'rec-1', keyValue: 'Deal 1#s1#c1' },
          { id: 'rec-2', keyValue: 'Deal 2#s1#c2' },
        ],
      };
      expect(Crm2DetectDuplicatesInputSchema.safeParse(valid).success).toBe(true);

      const emptyRecords = {
        keyType: 'quote_number',
        records: [],
      };
      expect(Crm2DetectDuplicatesInputSchema.safeParse(emptyRecords).success).toBe(false);
    });

    it('validates Crm2ResolveDuplicateInputSchema and rejects keptId === mergedId for MERGE', () => {
      const validMerge = {
        candidateId: 'cand-001',
        decision: 'MERGE',
        actorId: 'operator-1',
        keptId: 'rec-1',
        mergedId: 'rec-2',
        reason: 'Consolidated duplicate deal into master',
      };
      expect(Crm2ResolveDuplicateInputSchema.safeParse(validMerge).success).toBe(true);

      const invalidMergeSameId = {
        candidateId: 'cand-001',
        decision: 'MERGE',
        actorId: 'operator-1',
        keptId: 'rec-1',
        mergedId: 'rec-1',
        reason: 'Should fail',
      };
      const res = Crm2ResolveDuplicateInputSchema.safeParse(invalidMergeSameId);
      expect(res.success).toBe(false);

      const validKeepSeparate = {
        candidateId: 'cand-001',
        decision: 'KEEP_SEPARATE',
        actorId: 'operator-1',
        keptId: 'rec-1',
        mergedId: 'rec-1',
        reason: 'Verified distinct commercial deals with separate buyers',
      };
      expect(Crm2ResolveDuplicateInputSchema.safeParse(validKeepSeparate).success).toBe(true);
    });
  });
});
