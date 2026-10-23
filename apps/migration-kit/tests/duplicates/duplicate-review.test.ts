import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  UnreviewedCandidateMergeError,
  UnauthorizedMergeDecisionError,
  type MergeDecisionPayload,
} from '@clearshift/contracts';
import {
  evaluateExactMatch,
  DuplicateCandidateService,
  InMemoryDuplicateCandidateRepository,
  MergeDecisionService,
  AUTHORIZED_MERGE_ROLES,
} from '../../src/duplicates/index.js';
import { InMemoryRowOutcomeLedger } from '../../src/reconcile/index.js';

describe('KIT-10: Exact Duplicate Candidate Review and Audited Merge Decisions', () => {
  let candidateRepo: InMemoryDuplicateCandidateRepository;
  let outcomeLedger: InMemoryRowOutcomeLedger;
  let candidateService: DuplicateCandidateService;
  let mergeService: MergeDecisionService;

  beforeEach(() => {
    candidateRepo = new InMemoryDuplicateCandidateRepository();
    outcomeLedger = new InMemoryRowOutcomeLedger();
    candidateService = new DuplicateCandidateService(candidateRepo);
    mergeService = new MergeDecisionService(candidateRepo, outcomeLedger);
  });

  describe('1. Exact Normalized Candidate Rules', () => {
    it('detects duplicate on normalized email match (exact_email)', () => {
      const source = {
        email: '  Alice.Smith+test@ClearShift.io  ',
        companyName: 'Acme Corp',
      };
      const target = {
        email: 'alice.smith+test@clearshift.io',
        companyName: 'Acme Inc',
      };

      const result = evaluateExactMatch(source, target, 'contacts');
      expect(result.isMatch).toBe(true);
      expect(result.matchingRule).toBe('exact_email');
      expect(result.evidence).toContain('alice.smith+test@clearshift.io');
    });

    it('detects duplicate on normalized phone + name match (exact_phone_name)', () => {
      const source = {
        firstName: 'Bob',
        lastName: 'Jones',
        phone: '+1 (555) 234-5678',
        email: 'bob.different@example.com',
      };
      const target = {
        firstName: '  bob  ',
        lastName: '  JONES ',
        phone: '+1 555 234 5678',
        email: 'bob.original@example.com',
      };

      const result = evaluateExactMatch(source, target, 'contacts');
      expect(result.isMatch).toBe(true);
      expect(result.matchingRule).toBe('exact_phone_name');
      expect(result.evidence).toContain('15552345678');
    });

    it('detects duplicate on normalized tax number in jurisdiction/entity scope (exact_tax_number)', () => {
      const source = {
        companyName: 'Apex Innovations US',
        taxNumber: '12-3456789',
        jurisdiction: 'US',
      };
      const target = {
        companyName: 'Apex Innovations LLC',
        taxNumber: '123456789',
        jurisdiction: 'US',
      };

      const result = evaluateExactMatch(source, target, 'companies');
      expect(result.isMatch).toBe(true);
      expect(result.matchingRule).toBe('exact_tax_number');
      expect(result.evidence).toContain('123456789@US');
    });

    it('INVARIANT: keeps companies with shared names but different tax IDs/jurisdictions completely separate', () => {
      const source = {
        companyName: 'Acme Global Services',
        taxNumber: '99-8887776',
        jurisdiction: 'US',
      };
      const target = {
        companyName: 'Acme Global Services',
        taxNumber: 'GB123456789',
        jurisdiction: 'GB',
      };

      const result = evaluateExactMatch(source, target, 'companies');
      expect(result.isMatch).toBe(false);
      expect(result.reason).toBe('COMPANY_NAME_ONLY_MATCH_KEPT_SEPARATE');
      expect(result.matchingRule).toBeUndefined();
    });

    it('keeps companies with shared names but missing tax IDs separate (zero fuzzy auto-merge)', () => {
      const source = {
        companyName: 'Summit Technologies',
      };
      const target = {
        companyName: 'Summit Technologies',
      };

      const result = evaluateExactMatch(source, target, 'companies');
      expect(result.isMatch).toBe(false);
      expect(result.reason).toBe('COMPANY_NAME_ONLY_MATCH_KEPT_SEPARATE');
    });
  });

  describe('2. Candidate Discovery & Zero Auto-Merge Queue', () => {
    it('discovers target duplicate candidates and queues them as pending_review without auto-merging', async () => {
      const batchId = 'batch-scan-01';
      const entity = 'companies';
      const existingTargetId = randomUUID();

      const sourceRows = [
        {
          sourceRow: 1,
          data: {
            companyName: 'Delta Systems',
            taxNumber: '55-4433221',
            jurisdiction: 'US',
          },
        },
        {
          sourceRow: 2,
          data: {
            companyName: 'Brand New Company',
            taxNumber: '11-2233445',
            jurisdiction: 'US',
          },
        },
      ];

      const targetPool = [
        {
          id: existingTargetId,
          data: {
            companyName: 'Delta Systems Inc',
            taxNumber: '554433221',
            jurisdiction: 'US',
          },
        },
      ];

      const candidates = await candidateService.scanForTargetDuplicates(
        batchId,
        entity,
        sourceRows,
        targetPool
      );

      expect(candidates).toHaveLength(1);
      const cand = candidates[0]!;
      expect(cand.sourceRow).toBe(1);
      expect(cand.targetId).toBe(existingTargetId);
      expect(cand.matchingRule).toBe('exact_tax_number');
      expect(cand.status).toBe('pending_review');

      // Candidate must be in pending review repository
      const pending = await candidateService.getPendingReview(batchId);
      expect(pending).toHaveLength(1);
      expect(pending[0]!.id).toBe(cand.id);
    });

    it('blocks unreviewed candidate from loading as merged with UnreviewedCandidateMergeError', async () => {
      const batchId = 'batch-guard-01';
      const candId = randomUUID();
      const targetId = randomUUID();

      await candidateRepo.saveCandidate({
        id: candId,
        batchId,
        sourceRow: 10,
        entity: 'contacts',
        sourceRecord: { email: 'alice@clearshift.io' },
        targetRecord: { email: 'alice@clearshift.io' },
        targetId,
        matchingRule: 'exact_email',
        matchingRuleVersion: '1.0.0',
        evidence: 'exact normalized email: alice@clearshift.io',
        status: 'pending_review',
        createdAt: new Date(),
      });

      // Attempting to assert loading for row 10 while pending review must fail
      await expect(mergeService.assertCanLoad(batchId, 10)).rejects.toThrow(
        UnreviewedCandidateMergeError
      );

      // Other unaffected rows in the same batch are allowed to proceed
      await expect(mergeService.assertCanLoad(batchId, 11)).resolves.toBeUndefined();
    });
  });

  describe('3. Reauthorization at Submission Time', () => {
    it('authorizes merge decision submitted by editor, migration_admin, or platform_admin', async () => {
      const batchId = 'batch-auth-01';
      const candId = randomUUID();
      const targetId = randomUUID();

      await candidateRepo.saveCandidate({
        id: candId,
        batchId,
        sourceRow: 5,
        entity: 'contacts',
        sourceRecord: { email: 'contact@example.com' },
        targetRecord: { email: 'contact@example.com' },
        targetId,
        matchingRule: 'exact_email',
        matchingRuleVersion: '1.0.0',
        evidence: 'contact@example.com',
        status: 'pending_review',
        createdAt: new Date(),
      });

      for (const role of AUTHORIZED_MERGE_ROLES) {
        const payload: MergeDecisionPayload = {
          candidateId: candId,
          batchId,
          decision: 'keep_both',
          keptId: targetId,
          absorbedSourceRows: [5],
          reviewer: `user-${role}`,
          reviewerRole: role,
          fieldChoices: {},
        };

        const result = await mergeService.submitDecision(payload);
        expect(result.status).toBe('resolved_keep_both');
      }
    });

    it('rejects merge decision submitted by runner or viewer with UnauthorizedMergeDecisionError (HTTP 403)', async () => {
      const batchId = 'batch-auth-02';
      const candId = randomUUID();
      const targetId = randomUUID();

      await candidateRepo.saveCandidate({
        id: candId,
        batchId,
        sourceRow: 7,
        entity: 'contacts',
        sourceRecord: { email: 'runner.test@example.com' },
        targetRecord: { email: 'runner.test@example.com' },
        targetId,
        matchingRule: 'exact_email',
        matchingRuleVersion: '1.0.0',
        evidence: 'runner.test@example.com',
        status: 'pending_review',
        createdAt: new Date(),
      });

      const runnerPayload: MergeDecisionPayload = {
        candidateId: candId,
        batchId,
        decision: 'merge',
        keptId: targetId,
        absorbedSourceRows: [7],
        reviewer: 'unauthorized-runner',
        reviewerRole: 'runner',
        fieldChoices: {},
      };

      await expect(mergeService.submitDecision(runnerPayload)).rejects.toThrow(
        UnauthorizedMergeDecisionError
      );

      const viewerPayload: MergeDecisionPayload = {
        candidateId: candId,
        batchId,
        decision: 'merge',
        keptId: targetId,
        absorbedSourceRows: [7],
        reviewer: 'unauthorized-viewer',
        reviewerRole: 'viewer',
        fieldChoices: {},
      };

      await expect(mergeService.submitDecision(viewerPayload)).rejects.toThrow(
        UnauthorizedMergeDecisionError
      );
    });
  });

  describe('4. Explicit Review Decisions & Audited Merge Receipts', () => {
    it('executes keep_both without creating a merge receipt and unblocks candidate', async () => {
      const batchId = 'batch-keep-both';
      const candId = randomUUID();
      const targetId = randomUUID();

      await candidateRepo.saveCandidate({
        id: candId,
        batchId,
        sourceRow: 12,
        entity: 'contacts',
        sourceRecord: { email: 'dual@example.com' },
        targetRecord: { email: 'dual@example.com' },
        targetId,
        matchingRule: 'exact_email',
        matchingRuleVersion: '1.0.0',
        evidence: 'dual@example.com',
        status: 'pending_review',
        createdAt: new Date(),
      });

      const payload: MergeDecisionPayload = {
        candidateId: candId,
        batchId,
        decision: 'keep_both',
        keptId: targetId,
        absorbedSourceRows: [12],
        reviewer: 'reviewer-editor',
        reviewerRole: 'editor',
        fieldChoices: {},
        notes: 'Verified legitimate duplicate email used by different division contacts.',
      };

      const result = await mergeService.submitDecision(payload);
      expect(result.status).toBe('resolved_keep_both');
      expect(result.receipt).toBeUndefined();

      // Candidate is no longer pending
      const candidate = await candidateRepo.getCandidateById(candId);
      expect(candidate?.status).toBe('resolved_keep_both');

      // Now assertCanLoad succeeds because candidate is resolved
      await expect(mergeService.assertCanLoad(batchId, 12)).resolves.toBeUndefined();
    });

    it('executes merge, creates audited MergeReceipt, and updates terminal outcome ledger to merged', async () => {
      const batchId = 'batch-merge-exec';
      const candId = randomUUID();
      const targetId = randomUUID();

      await candidateRepo.saveCandidate({
        id: candId,
        batchId,
        sourceRow: 15,
        entity: 'companies',
        sourceRecord: {
          companyName: 'Acme International',
          taxNumber: '11-2233445',
          jurisdiction: 'US',
        },
        targetRecord: {
          companyName: 'Acme International Inc',
          taxNumber: '112233445',
          jurisdiction: 'US',
        },
        targetId,
        matchingRule: 'exact_tax_number',
        matchingRuleVersion: '1.0.0',
        evidence: '112233445@US',
        status: 'pending_review',
        createdAt: new Date(),
      });

      const payload: MergeDecisionPayload = {
        candidateId: candId,
        batchId,
        decision: 'merge',
        keptId: targetId,
        absorbedSourceRows: [15],
        reviewer: 'admin-auditor',
        reviewerRole: 'migration_admin',
        fieldChoices: {
          companyName: 'source',
        },
        notes: 'Confirmed same corporate legal entity, absorbed source row 15 into existing target.',
      };

      const result = await mergeService.submitDecision(payload);
      expect(result.status).toBe('resolved_merge');
      expect(result.receipt).toBeDefined();

      const receipt = result.receipt!;
      expect(receipt.candidateId).toBe(candId);
      expect(receipt.keptId).toBe(targetId);
      expect(receipt.absorbedSourceRows).toEqual([15]);
      expect(receipt.matchingRule).toBe('exact_tax_number');
      expect(receipt.reviewer).toBe('admin-auditor');
      expect(receipt.fieldChoices).toEqual({ companyName: 'source' });
      expect(receipt.idempotencyKey).toBeDefined();

      // Outcome ledger must have recorded outcome 'merged'
      const outcome = await outcomeLedger.getOutcome(batchId, 15);
      expect(outcome).toBeDefined();
      expect(outcome?.outcome).toBe('merged');
      expect(outcome?.targetId).toBe(targetId);
      expect(outcome?.reasonCode).toBe('exact_tax_number');
      expect(outcome?.actor).toBe('admin-auditor');
    });

    it('safely tolerates duplicate submissions via replay-safe idempotency key', async () => {
      const batchId = 'batch-idemp';
      const candId = randomUUID();
      const targetId = randomUUID();

      await candidateRepo.saveCandidate({
        id: candId,
        batchId,
        sourceRow: 20,
        entity: 'contacts',
        sourceRecord: { email: 'idemp@example.com' },
        targetRecord: { email: 'idemp@example.com' },
        targetId,
        matchingRule: 'exact_email',
        matchingRuleVersion: '1.0.0',
        evidence: 'idemp@example.com',
        status: 'pending_review',
        createdAt: new Date(),
      });

      const payload: MergeDecisionPayload = {
        candidateId: candId,
        batchId,
        decision: 'merge',
        keptId: targetId,
        absorbedSourceRows: [20],
        reviewer: 'lead-editor',
        reviewerRole: 'editor',
        fieldChoices: {},
      };

      // First submission
      const firstResult = await mergeService.submitDecision(payload);
      expect(firstResult.isExisting).toBe(false);

      // Replayed submission
      const replayResult = await mergeService.submitDecision(payload);
      expect(replayResult.isExisting).toBe(true);
      expect(replayResult.receipt?.id).toBe(firstResult.receipt?.id);
    });
  });
});
