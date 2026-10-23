import { describe, expect, it } from 'vitest';
import {
  CRM2_STAGES,
  CRM2_DEAL_STAGE_TRANSITIONS,
  CRM2_STAGE_SEEDS,
  isDealStageTransitionAllowed,
  assertDealStageTransition,
  assertValidStageName,
  isTerminalStage,
  isWonStage,
  isLostStage,
  getAllowedNextStages,
  getStageOrder,
  assertValidContactReference,
  assertValidDealReference,
  assertValidQuoteNumber,
  isOrphanDeal,
  getOrphanDealWarning,
  calculateDealDerivedTotals,
  calculatePipelineSummary,
  type Crm2StageName,
} from '../../src/domain/relationships.js';
import {
  InvalidStageTransitionError,
  ReferenceNotFoundError,
  DuplicateRecordError,
  DomainValidationError,
} from '../../src/domain/errors.js';
import type { ReferenceResolver } from '@cs/kernel';
import type { Deal, Quote } from '@clearshift/contracts';

describe('CRM-2 Deals, Pipeline and Quotes: Domain Relationships and State Transitions', () => {
  describe('1. State Transition Matrix Enforcement', () => {
    it.each([
      ['New', 'Qualified'],
      ['New', 'Lost'],
      ['Qualified', 'Proposal'],
      ['Qualified', 'Lost'],
      ['Proposal', 'Negotiation'],
      ['Proposal', 'Lost'],
      ['Negotiation', 'Won'],
      ['Negotiation', 'Lost'],
    ] as const)('allows legal forward/terminal transition %s -> %s', (current, next) => {
      expect(isDealStageTransitionAllowed(current, next)).toBe(true);
      expect(() => assertDealStageTransition(current, next)).not.toThrow();
    });

    it.each(CRM2_STAGES)('allows idempotent same-stage transition %s -> %s', (stage) => {
      expect(isDealStageTransitionAllowed(stage, stage)).toBe(true);
      expect(() => assertDealStageTransition(stage, stage)).not.toThrow();
    });

    // Test all forbidden transitions across the full 6x6 matrix
    const forbiddenTransitions: Array<[Crm2StageName, Crm2StageName]> = [];
    for (const from of CRM2_STAGES) {
      for (const to of CRM2_STAGES) {
        if (from !== to && !CRM2_DEAL_STAGE_TRANSITIONS[from].includes(to)) {
          forbiddenTransitions.push([from, to]);
        }
      }
    }

    it.each(forbiddenTransitions)(
      'rejects forbidden transition %s -> %s with stable 422 error',
      (current, next) => {
        expect(isDealStageTransitionAllowed(current, next)).toBe(false);

        let thrownError: any = null;
        try {
          assertDealStageTransition(current, next);
        } catch (err) {
          thrownError = err;
        }

        expect(thrownError).toBeDefined();
        expect(thrownError.code).toBe('INVALID_DEAL_STAGE_TRANSITION');
        expect(thrownError.statusCode).toBe(422);
        expect(thrownError.message).toContain(
          `Deal stage cannot transition from ${current} to ${next}`
        );
        expect(thrownError.details).toEqual([
          {
            field: 'stage_name',
            message: 'Move the deal to an allowed pipeline stage',
            code: 'invalid_transition',
          },
        ]);
      }
    );

    it('enforces terminal stage rules: Won has no outgoing transitions', () => {
      expect(isTerminalStage('Won')).toBe(true);
      expect(getAllowedNextStages('Won')).toEqual([]);
      for (const target of CRM2_STAGES) {
        if (target !== 'Won') {
          expect(isDealStageTransitionAllowed('Won', target)).toBe(false);
        }
      }
    });

    it('enforces terminal stage rules: Lost has no outgoing transitions', () => {
      expect(isTerminalStage('Lost')).toBe(true);
      expect(getAllowedNextStages('Lost')).toEqual([]);
      for (const target of CRM2_STAGES) {
        if (target !== 'Lost') {
          expect(isDealStageTransitionAllowed('Lost', target)).toBe(false);
        }
      }
    });

    it('identifies won and lost stages correctly', () => {
      expect(isWonStage('Won')).toBe(true);
      expect(isWonStage('Negotiation')).toBe(false);
      expect(isLostStage('Lost')).toBe(true);
      expect(isLostStage('Proposal')).toBe(false);
    });

    it('returns canonical 1-based order for stages', () => {
      expect(getStageOrder('New')).toBe(1);
      expect(getStageOrder('Qualified')).toBe(2);
      expect(getStageOrder('Proposal')).toBe(3);
      expect(getStageOrder('Negotiation')).toBe(4);
      expect(getStageOrder('Won')).toBe(5);
      expect(getStageOrder('Lost')).toBe(6);
    });
  });

  describe('2. Cross-Module Referential Integrity (CRM-1 Contact Link)', () => {
    const mockResolver: ReferenceResolver = {
      async exists(entityType: string, id: string): Promise<boolean> {
        if (entityType === 'contact') {
          return id === '90000000-0000-4000-8000-000000000001';
        }
        return false;
      },
      async get() {
        return null;
      },
    };

    it('permits null or undefined contact_id (orphan deal)', async () => {
      await expect(assertValidContactReference(null, mockResolver)).resolves.toBeUndefined();
      await expect(assertValidContactReference(undefined, mockResolver)).resolves.toBeUndefined();
      await expect(assertValidContactReference('', mockResolver)).resolves.toBeUndefined();
    });

    it('permits valid existing contact_id resolved through CRM-1 facade', async () => {
      await expect(
        assertValidContactReference('90000000-0000-4000-8000-000000000001', mockResolver)
      ).resolves.toBeUndefined();
    });

    it('rejects non-existent contact_id with stable 422 REFERENCE_NOT_FOUND', async () => {
      const invalidId = '90000000-0000-4000-8000-999999999999';
      await expect(assertValidContactReference(invalidId, mockResolver)).rejects.toThrow(
        ReferenceNotFoundError
      );

      try {
        await assertValidContactReference(invalidId, mockResolver);
      } catch (err: any) {
        expect(err.code).toBe('REFERENCE_NOT_FOUND');
        expect(err.statusCode).toBe(422);
        expect(err.details).toEqual([
          {
            field: 'contact_id',
            message: 'Choose an existing contact',
            code: 'invalid_reference',
          },
        ]);
      }
    });
  });

  describe('3. Intra-Module Referential Integrity (Deal & Quote Links)', () => {
    it('validates parent deal exists before committing quote', async () => {
      const existingDealId = '20000000-0000-4000-8000-000000000001';
      const dealExists = (id: string) => id === existingDealId;

      await expect(assertValidDealReference(existingDealId, dealExists)).resolves.toBeUndefined();

      const missingDealId = '20000000-0000-4000-8000-999999999999';
      await expect(assertValidDealReference(missingDealId, dealExists)).rejects.toThrow(
        ReferenceNotFoundError
      );

      try {
        await assertValidDealReference(missingDealId, dealExists);
      } catch (err: any) {
        expect(err.code).toBe('REFERENCE_NOT_FOUND');
        expect(err.statusCode).toBe(422);
        expect(err.details).toEqual([
          {
            field: 'deal_id',
            message: 'Choose an existing deal',
            code: 'invalid_reference',
          },
        ]);
      }
    });

    it('rejects blank deal_id with 400 VALIDATION_ERROR', async () => {
      await expect(assertValidDealReference('', () => true)).rejects.toThrow(
        DomainValidationError
      );
    });

    it('validates quote number uniqueness before commit', async () => {
      const existingQuotes = ['Q-2026-001', 'Q-2026-002'];
      const isDuplicate = (num: string) => existingQuotes.includes(num);

      await expect(assertValidQuoteNumber('Q-2026-003', isDuplicate)).resolves.toBeUndefined();

      await expect(assertValidQuoteNumber('Q-2026-001', isDuplicate)).rejects.toThrow(
        DuplicateRecordError
      );

      try {
        await assertValidQuoteNumber('Q-2026-001', isDuplicate);
      } catch (err: any) {
        expect(err.code).toBe('DUPLICATE_RECORD');
        expect(err.statusCode).toBe(409);
        expect(err.details).toEqual([
          {
            field: 'quote_number',
            message: 'Quote quote_number must be unique',
            code: 'unique_violation',
          },
        ]);
      }
    });

    it('rejects blank quote_number with 400 VALIDATION_ERROR', async () => {
      await expect(assertValidQuoteNumber('   ', () => false)).rejects.toThrow(
        DomainValidationError
      );
    });
  });

  describe('4. Orphan Deal Representation & Warnings (FR-CRM2-05)', () => {
    it('detects orphan deals correctly and renders warning message', () => {
      const orphanDeal = { contact_id: null };
      expect(isOrphanDeal(orphanDeal)).toBe(true);
      expect(getOrphanDealWarning(orphanDeal)).toBe('Warning: Deal has no linked contact (orphan deal)');

      const undefinedContactDeal = { contact_id: undefined };
      expect(isOrphanDeal(undefinedContactDeal)).toBe(true);
      expect(getOrphanDealWarning(undefinedContactDeal)).toBe('Warning: Deal has no linked contact (orphan deal)');

      const linkedDeal = { contact_id: '90000000-0000-4000-8000-000000000001' };
      expect(isOrphanDeal(linkedDeal)).toBe(false);
      expect(getOrphanDealWarning(linkedDeal)).toBeNull();
    });
  });

  describe('5. Read-Model Consistency & Derived Computations', () => {
    const sampleDeal: Deal = {
      id: '20000000-0000-4000-8000-000000000001',
      name: 'Alpha Corp Platform',
      contact_id: '90000000-0000-4000-8000-000000000001',
      contact_name: 'Sarah Connor',
      value: '100000.00',
      currency: 'USD',
      stage_id: '00000000-0000-4000-8000-000000000003',
      stage_name: 'Proposal',
      close_date: '2026-12-31',
      is_orphan: false,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    };

    const sampleQuotes: Quote[] = [
      {
        id: '30000000-0000-4000-8000-000000000001',
        deal_id: '20000000-0000-4000-8000-000000000001',
        quote_number: 'Q-001',
        date: '2026-10-15',
        amount: '45000.50',
        currency: 'USD',
        created_at: '2026-10-15T00:00:00Z',
        updated_at: '2026-10-15T00:00:00Z',
      },
      {
        id: '30000000-0000-4000-8000-000000000002',
        deal_id: '20000000-0000-4000-8000-000000000001',
        quote_number: 'Q-002',
        date: '2026-10-20',
        amount: '55000.25',
        currency: 'USD',
        created_at: '2026-10-20T00:00:00Z',
        updated_at: '2026-10-20T00:00:00Z',
      },
      {
        id: '30000000-0000-4000-8000-000000000003',
        deal_id: 'other-deal-id',
        quote_number: 'Q-003',
        date: '2026-10-21',
        amount: '12000.00',
        currency: 'USD',
        created_at: '2026-10-21T00:00:00Z',
        updated_at: '2026-10-21T00:00:00Z',
      },
    ];

    it('calculates deal derived totals from authoritative state with decimal accuracy', () => {
      const totals = calculateDealDerivedTotals(sampleDeal, sampleQuotes);
      expect(totals.dealId).toBe(sampleDeal.id);
      expect(totals.quotesCount).toBe(2);
      expect(totals.totalQuotesAmount).toBe('100000.75');
      expect(totals.hasQuotes).toBe(true);
      expect(totals.isOrphan).toBe(false);
      expect(totals.isWon).toBe(false);
      expect(totals.isLost).toBe(false);
    });

    it('computes aggregated pipeline summary across stages, orphans, and totals', () => {
      const dealsList: Deal[] = [
        sampleDeal, // Proposal: 100000.00
        {
          ...sampleDeal,
          id: 'deal-2',
          contact_id: null, // orphan
          stage_name: 'New',
          value: '25000.00',
          is_orphan: true,
        },
        {
          ...sampleDeal,
          id: 'deal-3',
          stage_name: 'Won',
          value: '80000.00',
        },
        {
          ...sampleDeal,
          id: 'deal-4',
          stage_name: 'Lost',
          value: '15000.00',
        },
      ];

      const summary = calculatePipelineSummary(dealsList);
      expect(summary.totalDeals).toBe(4);
      expect(summary.totalPipelineValue).toBe('220000.00');
      expect(summary.orphanDealsCount).toBe(1);
      expect(summary.activeDealsCount).toBe(2); // New + Proposal
      expect(summary.activePipelineValue).toBe('125000.00');
      expect(summary.wonDealsCount).toBe(1);
      expect(summary.wonDealsValue).toBe('80000.00');
      expect(summary.lostDealsCount).toBe(1);
      expect(summary.lostDealsValue).toBe('15000.00');
      expect(summary.byStage.Proposal.count).toBe(1);
      expect(summary.byStage.Proposal.totalValue).toBe('100000.00');
      expect(summary.byStage.New.count).toBe(1);
      expect(summary.byStage.New.totalValue).toBe('25000.00');
    });
  });

  describe('6. Domain Invariant Assertions', () => {
    it('asserts fixed stage set is exactly 6 predefined stages', () => {
      expect(CRM2_STAGES).toEqual(['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']);
      expect(CRM2_STAGE_SEEDS.map((s) => s.name)).toEqual(CRM2_STAGES);

      for (const stage of CRM2_STAGES) {
        expect(() => assertValidStageName(stage)).not.toThrow();
      }

      expect(() => assertValidStageName('ClosedWon')).toThrow();
      expect(() => assertValidStageName('Draft')).toThrow();
      expect(() => assertValidStageName('Negotiating')).toThrow();
    });
  });
});
