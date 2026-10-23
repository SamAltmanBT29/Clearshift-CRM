import { describe, it, expect, beforeEach } from 'vitest';
import {
  ExactKeyRegistry,
  defaultKeyRegistry,
  detectExactDuplicates,
  DuplicateReviewQueue,
} from '../../src/domain/duplicate-policy.js';
import {
  AutoMergeForbiddenError,
  DuplicateCandidateNotFoundError,
  DomainValidationError,
} from '../../src/domain/errors.js';
import type {
  Crm2RecordWithKey,
  Crm2ResolveDuplicateInput,
} from '@clearshift/contracts';

describe('CRM-2 Domain Duplicate Policy & Human Review Queue (CRM2-12)', () => {
  describe('ExactKeyRegistry', () => {
    let registry: ExactKeyRegistry;

    beforeEach(() => {
      registry = new ExactKeyRegistry();
    });

    it('normalizes deal_business key deterministically', () => {
      const val = '  Mega Deal  # Stage-1 # Contact-X ';
      expect(registry.normalize('deal_business', val)).toBe('mega deal # stage-1 # contact-x');
    });

    it('normalizes quote_number key (trimmed uppercase)', () => {
      expect(registry.normalize('quote_number', '  q-2026-999  ')).toBe('Q-2026-999');
    });

    it('normalizes sku key (trimmed uppercase)', () => {
      expect(registry.normalize('sku', '  prod-abc-123  ')).toBe('PROD-ABC-123');
    });

    it('normalizes email, tax_id, and phone standard keys', () => {
      expect(registry.normalize('email', '  Test.User@Domain.COM ')).toBe('test.user@domain.com');
      expect(registry.normalize('tax_id', 'US-99-8877')).toBe('US998877');
      expect(registry.normalize('phone', ' +1 (555) 234-5678 ')).toBe('+15552345678');
    });

    it('supports registering custom domain key normalizer', () => {
      registry.register('custom_prefix', (val) => `PREFIX_${val.trim().toLowerCase()}`);
      expect(registry.has('custom_prefix')).toBe(true);
      expect(registry.normalize('custom_prefix', '  Sample ')).toBe('PREFIX_sample');
    });

    it('falls back to default normalizer for unregistered types', () => {
      expect(registry.normalize('unregistered', '  raw_string  ')).toBe('raw_string');
    });
  });

  describe('detectExactDuplicates', () => {
    it('flags identical normalized keys deterministically as duplicate candidates', () => {
      const records: Crm2RecordWithKey[] = [
        { id: 'deal-1', keyValue: 'Cloud Migration#stage-1#cnt-1' },
        { id: 'deal-2', keyValue: '  cloud migration#stage-1#cnt-1  ' },
        { id: 'deal-3', keyValue: 'Security Audit#stage-1#orphan' },
      ];

      const result = detectExactDuplicates(records, 'deal_business', {
        batchId: 'batch-test-01',
      });

      expect(result.summary.totalRecords).toBe(3);
      expect(result.summary.uniqueCount).toBe(1);
      expect(result.summary.duplicateGroupCount).toBe(1);
      expect(result.summary.duplicateRecordCount).toBe(2);

      expect(result.uniqueRecords).toHaveLength(1);
      expect(result.uniqueRecords[0]!.id).toBe('deal-3');

      expect(result.duplicateCandidates).toHaveLength(1);
      const candidate = result.duplicateCandidates[0]!;
      expect(candidate.batchId).toBe('batch-test-01');
      expect(candidate.module).toBe('crm-2');
      expect(candidate.keyType).toBe('deal_business');
      expect(candidate.normalizedKey).toBe('cloud migration#stage-1#cnt-1');
      expect(candidate.recordIds).toEqual(['deal-1', 'deal-2']);
      expect(candidate.status).toBe('held_for_review');
    });

    it('detects quote duplicates based on quote_number key', () => {
      const records: Crm2RecordWithKey[] = [
        { id: 'q-1', keyValue: 'Q-2026-001' },
        { id: 'q-2', keyValue: '  q-2026-001  ' },
        { id: 'q-3', keyValue: 'Q-2026-002' },
      ];

      const result = detectExactDuplicates(records, 'quote_number', {
        entity: 'quote',
      });

      expect(result.summary.duplicateGroupCount).toBe(1);
      expect(result.duplicateCandidates[0]!.normalizedKey).toBe('Q-2026-001');
      expect(result.duplicateCandidates[0]!.entity).toBe('quote');
    });

    it('strictly forbids automatic merging in V1 (throws AutoMergeForbiddenError)', () => {
      const records: Crm2RecordWithKey[] = [
        { id: 'd-1', keyValue: 'KeyA' },
        { id: 'd-2', keyValue: 'KeyA' },
      ];

      expect(() =>
        detectExactDuplicates(records, 'composite', {
          autoMerge: true,
        })
      ).toThrow(AutoMergeForbiddenError);
    });

    it('handles all unique records without creating duplicate candidates', () => {
      const records: Crm2RecordWithKey[] = [
        { id: 'd-1', keyValue: 'Deal Alpha' },
        { id: 'd-2', keyValue: 'Deal Beta' },
        { id: 'd-3', keyValue: 'Deal Gamma' },
      ];

      const result = detectExactDuplicates(records, 'deal_name_contact');
      expect(result.uniqueRecords).toHaveLength(3);
      expect(result.duplicateCandidates).toHaveLength(0);
      expect(result.summary.duplicateGroupCount).toBe(0);
      expect(result.summary.duplicateRecordCount).toBe(0);
    });
  });

  describe('DuplicateReviewQueue & Human Merge Decisions', () => {
    let queue: DuplicateReviewQueue;

    beforeEach(() => {
      queue = new DuplicateReviewQueue();
    });

    it('holds duplicate candidates for authorized human resolution', () => {
      const candidate = {
        id: '00000000-0000-4000-8000-000000000010',
        batchId: 'batch-held-01',
        module: 'crm-2' as const,
        entity: 'deal',
        keyType: 'deal_business' as const,
        normalizedKey: 'acme contract#stage-1#cnt-1',
        recordIds: ['deal-01', 'deal-02'],
        status: 'held_for_review' as const,
        detectedAt: new Date(),
      };

      queue.addCandidate(candidate);
      const held = queue.listHeld({ batchId: 'batch-held-01' });
      expect(held).toHaveLength(1);
      expect(held[0]!.id).toBe(candidate.id);
    });

    it('resolves candidate with MERGE and records immutable audit log', () => {
      const candidateId = '00000000-0000-4000-8000-000000000020';
      queue.addCandidate({
        id: candidateId,
        batchId: 'batch-02',
        module: 'crm-2',
        entity: 'deal',
        keyType: 'deal_business',
        normalizedKey: 'renewal#stage-1#orphan',
        recordIds: ['deal-master', 'deal-duplicate'],
        status: 'held_for_review',
        detectedAt: new Date(),
      });

      const input: Crm2ResolveDuplicateInput = {
        candidateId,
        decision: 'MERGE',
        actorId: 'operator-alice',
        keptId: 'deal-master',
        mergedId: 'deal-duplicate',
        reason: 'Consolidating duplicated deal under target master',
      };

      const audit = queue.resolve(input);

      expect(audit.candidateId).toBe(candidateId);
      expect(audit.actorId).toBe('operator-alice');
      expect(audit.keptId).toBe('deal-master');
      expect(audit.mergedId).toBe('deal-duplicate');
      expect(audit.decision).toBe('MERGE');
      expect(audit.timestamp).toBeInstanceOf(Date);

      // Candidate is no longer held
      expect(queue.listHeld()).toHaveLength(0);

      // Audit logs query returns the entry
      const logs = queue.getAuditLogs({ actorId: 'operator-alice' });
      expect(logs.items).toHaveLength(1);
      expect(logs.items[0]!.id).toBe(audit.id);
    });

    it('resolves candidate with KEEP_SEPARATE decision', () => {
      const candidateId = '00000000-0000-4000-8000-000000000030';
      queue.addCandidate({
        id: candidateId,
        module: 'crm-2',
        entity: 'deal',
        keyType: 'deal_name_contact',
        normalizedKey: 'service agreement#cnt-1',
        recordIds: ['deal-a', 'deal-b'],
        status: 'held_for_review',
        detectedAt: new Date(),
      });

      const audit = queue.resolve({
        candidateId,
        decision: 'KEEP_SEPARATE',
        actorId: 'operator-bob',
        keptId: 'deal-a',
        mergedId: 'deal-b',
        reason: 'Verified two distinct commercial divisions',
      });

      expect(audit.decision).toBe('KEEP_SEPARATE');
      expect(queue.listHeld()).toHaveLength(0);
    });

    it('throws DuplicateCandidateNotFoundError when candidate ID does not exist', () => {
      expect(() =>
        queue.resolve({
          candidateId: 'non-existent-id',
          decision: 'MERGE',
          actorId: 'op-1',
          keptId: 'rec-1',
          mergedId: 'rec-2',
          reason: 'Test',
        })
      ).toThrow(DuplicateCandidateNotFoundError);
    });

    it('throws DomainValidationError when actorId is blank', () => {
      const candidateId = '00000000-0000-4000-8000-000000000040';
      queue.addCandidate({
        id: candidateId,
        module: 'crm-2',
        entity: 'deal',
        keyType: 'deal_business',
        normalizedKey: 'key',
        recordIds: ['d1', 'd2'],
        status: 'held_for_review',
        detectedAt: new Date(),
      });

      expect(() =>
        queue.resolve({
          candidateId,
          decision: 'MERGE',
          actorId: '   ',
          keptId: 'd1',
          mergedId: 'd2',
          reason: 'Missing actor',
        })
      ).toThrow(DomainValidationError);
    });

    it('throws DomainValidationError when keptId equals mergedId for MERGE', () => {
      const candidateId = '00000000-0000-4000-8000-000000000050';
      queue.addCandidate({
        id: candidateId,
        module: 'crm-2',
        entity: 'deal',
        keyType: 'deal_business',
        normalizedKey: 'key',
        recordIds: ['d1', 'd2'],
        status: 'held_for_review',
        detectedAt: new Date(),
      });

      expect(() =>
        queue.resolve({
          candidateId,
          decision: 'MERGE',
          actorId: 'op-1',
          keptId: 'd1',
          mergedId: 'd1',
          reason: 'Cannot merge onto itself',
        })
      ).toThrow(DomainValidationError);
    });

    it('throws DomainValidationError when keptId or mergedId does not belong to candidate recordIds', () => {
      const candidateId = '00000000-0000-4000-8000-000000000060';
      queue.addCandidate({
        id: candidateId,
        module: 'crm-2',
        entity: 'deal',
        keyType: 'deal_business',
        normalizedKey: 'key',
        recordIds: ['d1', 'd2'],
        status: 'held_for_review',
        detectedAt: new Date(),
      });

      expect(() =>
        queue.resolve({
          candidateId,
          decision: 'MERGE',
          actorId: 'op-1',
          keptId: 'd1',
          mergedId: 'd-alien',
          reason: 'Alien ID not in recordIds',
        })
      ).toThrow(DomainValidationError);
    });
  });
});
