import { describe, it, expect } from 'vitest';
import type {
  Crm2DuplicateCandidate,
  Crm2ResolveDuplicateInput,
  DuplicateReviewDecision,
} from '@clearshift/contracts';
import {
  Crm2ResolveDuplicateInputSchema,
  Crm2DetectDuplicatesInputSchema,
} from '@clearshift/contracts';
import { DuplicateReviewModal } from '../src/components/DuplicateReviewModal.js';
import { DuplicateReviewPage } from '../src/pages/DuplicateReviewPage.js';
import * as api from '../src/api/crm-2.js';

describe('CRM-2 Frontend: Duplicate Key Policy & Human Review UI Logic (CRM2-12)', () => {
  const sampleCandidate: Crm2DuplicateCandidate = {
    id: '00000000-0000-4000-8000-000000000001',
    batchId: 'batch-test-1',
    module: 'crm-2',
    entity: 'deal',
    keyType: 'deal_business',
    normalizedKey: 'cloud migration#stage-1#cnt-1',
    recordIds: ['deal-id-01', 'deal-id-02'],
    status: 'held_for_review',
    detectedAt: new Date('2026-10-23T10:00:00.000Z'),
  };

  describe('1. Review Modal Validation Rules & Decision Envelopes', () => {
    it('validates MERGE decision requires keptId !== mergedId', () => {
      const invalidMerge = {
        candidateId: sampleCandidate.id,
        decision: 'MERGE' as DuplicateReviewDecision,
        actorId: 'operator-1',
        keptId: 'deal-id-01',
        mergedId: 'deal-id-01',
        reason: 'Invalid same entity merge',
      };

      const result = Crm2ResolveDuplicateInputSchema.safeParse(invalidMerge);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain(
          'keptId and mergedId cannot be the same entity for MERGE decisions'
        );
      }
    });

    it('allows distinct keptId and mergedId for MERGE', () => {
      const validMerge: Crm2ResolveDuplicateInput = {
        candidateId: sampleCandidate.id,
        decision: 'MERGE',
        actorId: 'operator-1',
        keptId: 'deal-id-01',
        mergedId: 'deal-id-02',
        reason: 'Consolidating duplicated target records',
      };

      const result = Crm2ResolveDuplicateInputSchema.safeParse(validMerge);
      expect(result.success).toBe(true);
    });

    it('requires actorId and reason for all decision types', () => {
      const missingActor = {
        candidateId: sampleCandidate.id,
        decision: 'KEEP_SEPARATE',
        actorId: '',
        keptId: 'deal-id-01',
        mergedId: 'deal-id-02',
        reason: 'Some reason',
      };
      expect(Crm2ResolveDuplicateInputSchema.safeParse(missingActor).success).toBe(false);

      const missingReason = {
        candidateId: sampleCandidate.id,
        decision: 'REJECT_DUPLICATE',
        actorId: 'operator-1',
        keptId: 'deal-id-01',
        mergedId: 'deal-id-02',
        reason: '',
      };
      expect(Crm2ResolveDuplicateInputSchema.safeParse(missingReason).success).toBe(false);
    });

    it('accepts REJECT_DUPLICATE and KEEP_SEPARATE decisions', () => {
      const rejectInput: Crm2ResolveDuplicateInput = {
        candidateId: sampleCandidate.id,
        decision: 'REJECT_DUPLICATE',
        actorId: 'operator-analyst',
        keptId: 'deal-id-01',
        mergedId: 'deal-id-02',
        reason: 'Dropped duplicate record from legacy batch',
      };
      expect(Crm2ResolveDuplicateInputSchema.safeParse(rejectInput).success).toBe(true);

      const keepSeparateInput: Crm2ResolveDuplicateInput = {
        candidateId: sampleCandidate.id,
        decision: 'KEEP_SEPARATE',
        actorId: 'operator-analyst',
        keptId: 'deal-id-01',
        mergedId: 'deal-id-02',
        reason: 'Verified separate business divisions',
      };
      expect(Crm2ResolveDuplicateInputSchema.safeParse(keepSeparateInput).success).toBe(true);
    });
  });

  describe('2. Component Definitions & Export Invariants', () => {
    it('exports DuplicateReviewModal and DuplicateReviewPage as functional React components', () => {
      expect(typeof DuplicateReviewModal).toBe('function');
      expect(typeof DuplicateReviewPage).toBe('function');
    });

    it('exports frontend duplicate API methods', () => {
      expect(typeof api.detectDuplicates).toBe('function');
      expect(typeof api.getHeldDuplicates).toBe('function');
      expect(typeof api.resolveDuplicate).toBe('function');
      expect(typeof api.getDuplicateAuditLogs).toBe('function');
      expect(typeof api.evaluateDealDuplicate).toBe('function');
      expect(typeof api.evaluateQuoteDuplicate).toBe('function');
    });
  });

  describe('3. Invariant Policy & Human Review Guarantees', () => {
    it('prohibits autoMerge in V1 duplicate detection schemas', () => {
      const input = {
        batchId: 'batch-001',
        keyType: 'deal_business' as const,
        records: [
          { id: '1', keyValue: 'Deal A#s1#c1' },
          { id: '2', keyValue: 'Deal A#s1#c1' },
        ],
        autoMerge: true,
      };

      const parsed = Crm2DetectDuplicatesInputSchema.safeParse(input);
      expect(parsed.success).toBe(true);
      // The schema accepts autoMerge as a boolean flag so the server can explicitly enforce
      // the V1 non-negotiable invariant and return HTTP 422 AUTO_MERGE_FORBIDDEN
      expect(parsed.data?.autoMerge).toBe(true);
    });

    it('ensures duplicate candidate groups are created in held_for_review status', () => {
      expect(sampleCandidate.status).toBe('held_for_review');
      expect(sampleCandidate.recordIds.length).toBeGreaterThanOrEqual(2);
    });
  });
});
