import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeEmail,
  normalizeTaxId,
  normalizeSku,
  normalizePhone,
  normalizeCompositeKey,
  normalizeExactKey,
} from '@clearshift/contracts';
import {
  ExactKeyRegistry,
  detectExactDuplicates,
  DuplicateReviewQueue,
} from '../../src/domain/duplicate-policy.js';
import {
  AutoMergeForbiddenError,
  DuplicateCandidateNotFoundError,
  DomainValidationError,
} from '../../src/domain/errors.js';

describe('CRM-5 Exact Duplicate Key Policy (CRM5-12)', () => {
  describe('Key Normalization Functions', () => {
    it('normalizes email by trimming whitespace and lowercasing', () => {
      expect(normalizeEmail('  Jane.Doe@ClearShift.IO  ')).toBe('jane.doe@clearshift.io');
      expect(normalizeEmail('USER@EXAMPLE.COM')).toBe('user@example.com');
      expect(normalizeEmail('')).toBe('');
      expect(normalizeExactKey('email', '  Admin@Domain.Com  ')).toBe('admin@domain.com');
    });

    it('normalizes tax id by trimming, uppercasing, and removing punctuation/whitespace', () => {
      expect(normalizeTaxId(' 12-345.678/9 ')).toBe('123456789');
      expect(normalizeTaxId('de 987 654 321')).toBe('DE987654321');
      expect(normalizeTaxId('US-EIN-99-8877')).toBe('USEIN998877');
      expect(normalizeExactKey('tax_id', '  GB-123.456  ')).toBe('GB123456');
    });

    it('normalizes SKU by trimming, uppercasing, and collapsing whitespace', () => {
      expect(normalizeSku('  prod-abc   456  ')).toBe('PROD-ABC 456');
      expect(normalizeSku('widget-alpha')).toBe('WIDGET-ALPHA');
      expect(normalizeExactKey('sku', '  sku-100  ')).toBe('SKU-100');
    });

    it('normalizes phone numbers by trimming, stripping non-digits, and preserving leading +', () => {
      expect(normalizePhone(' +1 (555) 123-4567 ')).toBe('+15551234567');
      expect(normalizePhone(' (800) 555-0199 ')).toBe('8005550199');
      expect(normalizeExactKey('phone', '+44 20 7946 0958')).toBe('+442079460958');
    });

    it('normalizes composite keys with deterministic sorted order', () => {
      const composite = normalizeCompositeKey({
        step: 'load',
        batchId: 'batch-01',
        sourceId: 'SRC-99',
      });
      expect(composite).toBe('batchId=batch-01;sourceId=SRC-99;step=load');

      const arrayComposite = normalizeCompositeKey(['batch-01', 'load', 'SRC-99']);
      expect(arrayComposite).toBe('batch-01:load:SRC-99');
    });

    it('supports custom key normalizers via ExactKeyRegistry', () => {
      const registry = new ExactKeyRegistry();
      registry.register('custom_code', (val) => `CODE_${val.trim().toUpperCase()}`);
      expect(registry.has('custom_code')).toBe(true);
      expect(registry.normalize('custom_code', '  sample  ')).toBe('CODE_SAMPLE');
    });
  });

  describe('detectExactDuplicates', () => {
    it('returns all records as unique when there are no duplicates', () => {
      const records = [
        { id: 'rec-1', keyValue: 'user1@example.com' },
        { id: 'rec-2', keyValue: 'user2@example.com' },
      ];

      const result = detectExactDuplicates(records, 'email', { batchId: 'batch-1' });

      expect(result.uniqueRecords).toHaveLength(2);
      expect(result.duplicateCandidates).toHaveLength(0);
      expect(result.summary.duplicateGroupCount).toBe(0);
      expect(result.summary.uniqueCount).toBe(2);
    });

    it('deterministically flags identical normalized keys as duplicate candidates held for review', () => {
      const records = [
        { id: 'rec-1', keyValue: '  Lead@Clearshift.com  ' },
        { id: 'rec-2', keyValue: 'lead@clearshift.com' },
        { id: 'rec-3', keyValue: 'unique@clearshift.com' },
      ];

      const result = detectExactDuplicates(records, 'email', { batchId: 'batch-test' });

      expect(result.uniqueRecords).toHaveLength(1);
      expect(result.uniqueRecords[0]?.id).toBe('rec-3');

      expect(result.duplicateCandidates).toHaveLength(1);
      const candidate = result.duplicateCandidates[0]!;
      expect(candidate.normalizedKey).toBe('lead@clearshift.com');
      expect(candidate.recordIds).toEqual(['rec-1', 'rec-2']);
      expect(candidate.status).toBe('held_for_review');
      expect(candidate.batchId).toBe('batch-test');
      expect(result.summary.duplicateRecordCount).toBe(2);
    });

    it('strictly forbids auto-merge in V1 and throws AutoMergeForbiddenError', () => {
      const records = [
        { id: 'rec-1', keyValue: 'lead@test.com' },
        { id: 'rec-2', keyValue: 'lead@test.com' },
      ];

      expect(() =>
        detectExactDuplicates(records, 'email', { autoMerge: true })
      ).toThrowError(AutoMergeForbiddenError);
    });
  });

  describe('DuplicateReviewQueue & Human Merge Decisions', () => {
    let queue: DuplicateReviewQueue;

    beforeEach(() => {
      queue = new DuplicateReviewQueue();
    });

    it('holds candidates and lists them by batchId or keyType', () => {
      queue.addCandidate({
        id: 'cand-1',
        batchId: 'batch-alpha',
        keyType: 'email',
        normalizedKey: 'contact@example.com',
        recordIds: ['rec-1', 'rec-2'],
        status: 'held_for_review',
        detectedAt: new Date(),
      });

      queue.addCandidate({
        id: 'cand-2',
        batchId: 'batch-beta',
        keyType: 'tax_id',
        normalizedKey: 'TAX12345',
        recordIds: ['rec-3', 'rec-4'],
        status: 'held_for_review',
        detectedAt: new Date(),
      });

      const emailList = queue.listHeld({ keyType: 'email' });
      expect(emailList).toHaveLength(1);
      expect(emailList[0]?.id).toBe('cand-1');

      const batchList = queue.listHeld({ batchId: 'batch-beta' });
      expect(batchList).toHaveLength(1);
      expect(batchList[0]?.id).toBe('cand-2');
    });

    it('records human merge decision with actorId, timestamp, keptId, and mergedId', () => {
      const candidateId = 'cand-review-01';
      queue.addCandidate({
        id: candidateId,
        batchId: 'batch-alpha',
        keyType: 'email',
        normalizedKey: 'user@example.com',
        recordIds: ['rec-kept', 'rec-merged'],
        status: 'held_for_review',
        detectedAt: new Date(),
      });

      const audit = queue.resolve({
        candidateId,
        decision: 'MERGE',
        actorId: 'operator-dhruv-42',
        keptId: 'rec-kept',
        mergedId: 'rec-merged',
        reason: 'Verified canonical contact record from CRM-1 migration feed',
        metadata: { source: 'human_review_modal' },
      });

      expect(audit.candidateId).toBe(candidateId);
      expect(audit.actorId).toBe('operator-dhruv-42');
      expect(audit.decision).toBe('MERGE');
      expect(audit.keptId).toBe('rec-kept');
      expect(audit.mergedId).toBe('rec-merged');
      expect(audit.normalizedKey).toBe('user@example.com');
      expect(audit.timestamp).toBeInstanceOf(Date);

      // Candidate is marked resolved
      const candidate = queue.getCandidate(candidateId);
      expect(candidate?.status).toBe('resolved');

      // Audit logs can be queried
      const logs = queue.getAuditLogs({ candidateId });
      expect(logs.total).toBe(1);
      expect(logs.items[0]?.id).toBe(audit.id);
    });

    it('rejects self-merge where keptId and mergedId are identical', () => {
      const candidateId = 'cand-self-merge';
      queue.addCandidate({
        id: candidateId,
        keyType: 'tax_id',
        normalizedKey: 'TAX999',
        recordIds: ['rec-1', 'rec-2'],
        status: 'held_for_review',
        detectedAt: new Date(),
      });

      expect(() =>
        queue.resolve({
          candidateId,
          decision: 'MERGE',
          actorId: 'operator-1',
          keptId: 'rec-1',
          mergedId: 'rec-1',
          reason: 'invalid merge attempt',
        })
      ).toThrowError(DomainValidationError);
    });

    it('rejects merge decision when keptId or mergedId does not belong to candidate recordIds', () => {
      const candidateId = 'cand-alien-ids';
      queue.addCandidate({
        id: candidateId,
        keyType: 'email',
        normalizedKey: 'demo@test.com',
        recordIds: ['rec-1', 'rec-2'],
        status: 'held_for_review',
        detectedAt: new Date(),
      });

      expect(() =>
        queue.resolve({
          candidateId,
          decision: 'MERGE',
          actorId: 'operator-1',
          keptId: 'rec-1',
          mergedId: 'rec-alien-99',
          reason: 'alien id',
        })
      ).toThrowError(DomainValidationError);
    });

    it('rejects resolution if candidate does not exist in queue', () => {
      expect(() =>
        queue.resolve({
          candidateId: 'non-existent-candidate',
          decision: 'KEEP_SEPARATE',
          actorId: 'operator-1',
          keptId: 'rec-1',
          mergedId: 'rec-2',
          reason: 'Records represent distinct legal entities',
        })
      ).toThrowError(DuplicateCandidateNotFoundError);
    });
  });
});
