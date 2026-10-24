import { describe, expect, it, beforeEach } from 'vitest';
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
import {
  buildContactExactEmailKey,
  buildContactExactPhoneNameKey,
  buildCompanyExactTaxKey,
  evaluateContactDuplicate,
  evaluateCompanyDuplicate,
  type Crm1RecordWithKey,
  type ContactCandidate,
  type ExistingContactRecord,
  type CompanyCandidate,
  type ExistingCompanyRecord,
} from '@clearshift/contracts';

describe('CRM-1 Exact Duplicate Key Policy & Normalization ([CRM1-12] / KIT-10)', () => {
  // ---------------------------------------------------------------------------
  // 1. ExactKeyRegistry & Key Normalizers
  // ---------------------------------------------------------------------------
  describe('ExactKeyRegistry', () => {
    it('normalizes email by trimming and lowercasing', () => {
      const registry = new ExactKeyRegistry();
      expect(registry.normalize('email', '  SARAH.Connor@Example.COM  ')).toBe(
        'sarah.connor@example.com'
      );
    });

    it('normalizes tax number by uppercasing and stripping whitespace and punctuation', () => {
      const registry = new ExactKeyRegistry();
      expect(registry.normalize('tax_number', ' us-12.345-6789 ')).toBe(
        'US123456789'
      );
      expect(registry.normalize('tax_id', ' de 987 654 321 ')).toBe('DE987654321');
    });

    it('normalizes phone number by stripping formatting while preserving leading +', () => {
      const registry = new ExactKeyRegistry();
      expect(registry.normalize('phone', ' +1 (555) 019-2834 ')).toBe('+15550192834');
      expect(registry.normalize('phone', ' (555) 019-2834 ')).toBe('5550192834');
    });

    it('normalizes sku by trimming, uppercasing, and removing whitespace', () => {
      const registry = new ExactKeyRegistry();
      expect(registry.normalize('sku', '  sku-  alpha  01 ')).toBe('SKU-ALPHA01');
    });

    it('normalizes phone_name composite key by trimming and collapsing whitespace', () => {
      const registry = new ExactKeyRegistry();
      expect(
        registry.normalize('phone_name', ' +15550192834 # Sarah   Connor ')
      ).toBe('+15550192834 # sarah connor');
    });

    it('supports registering custom domain key normalizers', () => {
      const registry = new ExactKeyRegistry();
      registry.register('custom_domain', (val) => `custom:${val.trim().toLowerCase()}`);

      expect(registry.has('custom_domain')).toBe(true);
      expect(registry.normalize('custom_domain', '  FOO-BAR  ')).toBe('custom:foo-bar');
    });

    it('falls back to default normalization for unknown keys', () => {
      const registry = new ExactKeyRegistry();
      expect(registry.normalize('unknown_key', '  Raw Value  ')).toBe('Raw Value');
    });

    it('provides a singleton defaultKeyRegistry', () => {
      expect(defaultKeyRegistry).toBeInstanceOf(ExactKeyRegistry);
      expect(defaultKeyRegistry.has('email')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Deterministic Key Builders
  // ---------------------------------------------------------------------------
  describe('Deterministic Exact Key Builders', () => {
    it('buildContactExactEmailKey returns trimmed lowercase or null', () => {
      expect(buildContactExactEmailKey('  ALICE@Test.Org ')).toBe('alice@test.org');
      expect(buildContactExactEmailKey(null)).toBeNull();
      expect(buildContactExactEmailKey('   ')).toBeNull();
    });

    it('buildContactExactPhoneNameKey returns combined normalized phone and name', () => {
      const key = buildContactExactPhoneNameKey('+1 (555) 234-5678', ' John ', ' Smith ');
      expect(key).toBe('+15552345678#john smith');
      expect(buildContactExactPhoneNameKey(null, 'John', 'Smith')).toBeNull();
      expect(buildContactExactPhoneNameKey('+1555', '', 'Smith')).toBeNull();
    });

    it('buildCompanyExactTaxKey returns stripped uppercase tax key', () => {
      expect(buildCompanyExactTaxKey(' US-98.76543-21 ')).toBe('US987654321');
      expect(buildCompanyExactTaxKey(null)).toBeNull();
      expect(buildCompanyExactTaxKey('   ')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. detectExactDuplicates Function
  // ---------------------------------------------------------------------------
  describe('detectExactDuplicates', () => {
    const syntheticEmailRecords: Crm1RecordWithKey[] = [
      { id: 'cnt-01', keyValue: 'john.doe@example.com' },
      { id: 'cnt-02', keyValue: '  JOHN.DOE@example.com  ' },
      { id: 'cnt-03', keyValue: 'jane.smith@example.com' },
      { id: 'cnt-04', keyValue: 'sarah.connor@example.com' },
      { id: 'cnt-05', keyValue: 'SARAH.CONNOR@EXAMPLE.COM' },
      { id: 'cnt-06', keyValue: 'unique.person@example.com' },
    ];

    it('partitions records into unique records and held duplicate groups', () => {
      const result = detectExactDuplicates(syntheticEmailRecords, 'email', {
        batchId: 'batch-test-01',
        entity: 'contact',
      });

      expect(result.summary.totalRecords).toBe(6);
      expect(result.summary.uniqueCount).toBe(2);
      expect(result.summary.duplicateGroupCount).toBe(2);
      expect(result.summary.duplicateRecordCount).toBe(4);

      expect(result.uniqueRecords.map((r) => r.id)).toEqual(['cnt-03', 'cnt-06']);

      expect(result.duplicateCandidates).toHaveLength(2);

      const johnGroup = result.duplicateCandidates.find(
        (c) => c.normalizedKey === 'john.doe@example.com'
      );
      expect(johnGroup).toBeDefined();
      expect(johnGroup?.recordIds).toEqual(['cnt-01', 'cnt-02']);
      expect(johnGroup?.status).toBe('held_for_review');
      expect(johnGroup?.module).toBe('crm-1');
      expect(johnGroup?.entity).toBe('contact');
      expect(johnGroup?.batchId).toBe('batch-test-01');

      const sarahGroup = result.duplicateCandidates.find(
        (c) => c.normalizedKey === 'sarah.connor@example.com'
      );
      expect(sarahGroup).toBeDefined();
      expect(sarahGroup?.recordIds).toEqual(['cnt-04', 'cnt-05']);
      expect(sarahGroup?.status).toBe('held_for_review');
    });

    it('throws AutoMergeForbiddenError when autoMerge is requested', () => {
      expect(() => {
        detectExactDuplicates(syntheticEmailRecords, 'email', {
          batchId: 'batch-test-02',
          autoMerge: true,
        });
      }).toThrowError(AutoMergeForbiddenError);
    });

    it('works with company tax number exact matching', () => {
      const companyRecords: Crm1RecordWithKey[] = [
        { id: 'comp-01', keyValue: 'US-12.345.678' },
        { id: 'comp-02', keyValue: ' us 12345678 ' },
        { id: 'comp-03', keyValue: 'DE-99.888.777' },
      ];

      const result = detectExactDuplicates(companyRecords, 'tax_number', {
        entity: 'company',
      });

      expect(result.summary.uniqueCount).toBe(1);
      expect(result.summary.duplicateGroupCount).toBe(1);
      expect(result.duplicateCandidates[0]?.normalizedKey).toBe('US12345678');
      expect(result.duplicateCandidates[0]?.recordIds).toEqual(['comp-01', 'comp-02']);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. DuplicateReviewQueue & Human Merge Resolution
  // ---------------------------------------------------------------------------
  describe('DuplicateReviewQueue', () => {
    let queue: DuplicateReviewQueue;

    beforeEach(() => {
      queue = new DuplicateReviewQueue();
    });

    it('adds candidates and lists held candidates sorted by detection time', () => {
      queue.addCandidate({
        id: 'cand-01',
        module: 'crm-1',
        entity: 'contact',
        keyType: 'email',
        normalizedKey: 'user1@example.com',
        recordIds: ['id-1', 'id-2'],
        status: 'held_for_review',
        detectedAt: new Date(Date.now() - 5000),
      });

      queue.addCandidate({
        id: 'cand-02',
        module: 'crm-1',
        entity: 'company',
        keyType: 'tax_number',
        normalizedKey: 'TAX12345',
        recordIds: ['comp-1', 'comp-2'],
        status: 'held_for_review',
        detectedAt: new Date(Date.now()),
      });

      const held = queue.listHeld();
      expect(held).toHaveLength(2);
      expect(held[0]?.id).toBe('cand-02'); // Most recent first
      expect(held[1]?.id).toBe('cand-01');

      const companyHeld = queue.listHeld({ entity: 'company' });
      expect(companyHeld).toHaveLength(1);
      expect(companyHeld[0]?.id).toBe('cand-02');
    });

    it('resolves duplicate via MERGE decision and records immutable audit log', () => {
      queue.addCandidate({
        id: 'cand-10',
        module: 'crm-1',
        entity: 'contact',
        keyType: 'email',
        normalizedKey: 'matched@example.com',
        recordIds: ['cnt-kept', 'cnt-merged'],
        status: 'held_for_review',
        detectedAt: new Date(),
      });

      const auditEntry = queue.resolve({
        candidateId: 'cand-10',
        decision: 'MERGE',
        actorId: 'analyst-42',
        keptId: 'cnt-kept',
        mergedId: 'cnt-merged',
        reason: 'Verified duplicate contact via normalized email exact match',
        metadata: { source: 'migration_batch_01' },
      });

      expect(auditEntry.id).toBeDefined();
      expect(auditEntry.candidateId).toBe('cand-10');
      expect(auditEntry.decision).toBe('MERGE');
      expect(auditEntry.actorId).toBe('analyst-42');
      expect(auditEntry.keptId).toBe('cnt-kept');
      expect(auditEntry.mergedId).toBe('cnt-merged');
      expect(auditEntry.normalizedKey).toBe('matched@example.com');
      expect(auditEntry.timestamp).toBeInstanceOf(Date);

      // Verify candidate is now resolved and no longer held
      expect(queue.getCandidate('cand-10')?.status).toBe('resolved');
      expect(queue.listHeld()).toHaveLength(0);

      // Query audit logs
      const logs = queue.getAuditLogs({ candidateId: 'cand-10' });
      expect(logs.total).toBe(1);
      expect(logs.items[0]?.actorId).toBe('analyst-42');
    });

    it('rejects MERGE decision when keptId equals mergedId (self-merge forbidden)', () => {
      queue.addCandidate({
        id: 'cand-11',
        module: 'crm-1',
        entity: 'contact',
        keyType: 'email',
        normalizedKey: 'self@example.com',
        recordIds: ['cnt-1', 'cnt-2'],
        status: 'held_for_review',
        detectedAt: new Date(),
      });

      expect(() => {
        queue.resolve({
          candidateId: 'cand-11',
          decision: 'MERGE',
          actorId: 'analyst-01',
          keptId: 'cnt-1',
          mergedId: 'cnt-1',
          reason: 'Erroneous self-merge attempt',
        });
      }).toThrowError(DomainValidationError);
    });

    it('rejects MERGE decision when keptId or mergedId does not belong to candidate group', () => {
      queue.addCandidate({
        id: 'cand-12',
        module: 'crm-1',
        entity: 'contact',
        keyType: 'email',
        normalizedKey: 'foreign@example.com',
        recordIds: ['cnt-1', 'cnt-2'],
        status: 'held_for_review',
        detectedAt: new Date(),
      });

      expect(() => {
        queue.resolve({
          candidateId: 'cand-12',
          decision: 'MERGE',
          actorId: 'analyst-01',
          keptId: 'cnt-1',
          mergedId: 'foreign-id-99',
          reason: 'Attempted foreign merge',
        });
      }).toThrowError(DomainValidationError);
    });

    it('throws DuplicateCandidateNotFoundError when resolving non-existent candidate', () => {
      expect(() => {
        queue.resolve({
          candidateId: 'non-existent-candidate',
          decision: 'KEEP_SEPARATE',
          actorId: 'analyst-01',
          keptId: 'id-1',
          mergedId: 'id-2',
          reason: 'Valid separation',
        });
      }).toThrowError(DuplicateCandidateNotFoundError);
    });

    it('throws DomainValidationError when actorId is missing or empty', () => {
      queue.addCandidate({
        id: 'cand-13',
        module: 'crm-1',
        entity: 'contact',
        keyType: 'email',
        normalizedKey: 'noactor@example.com',
        recordIds: ['c1', 'c2'],
        status: 'held_for_review',
        detectedAt: new Date(),
      });

      expect(() => {
        queue.resolve({
          candidateId: 'cand-13',
          decision: 'KEEP_SEPARATE',
          actorId: '   ',
          keptId: 'c1',
          mergedId: 'c2',
          reason: 'Blank actor',
        });
      }).toThrowError(DomainValidationError);
    });

    it('paginates and filters duplicate audit logs properly', () => {
      queue.addCandidate({
        id: 'cand-20',
        module: 'crm-1',
        entity: 'contact',
        keyType: 'email',
        normalizedKey: 'test@example.com',
        recordIds: ['c1', 'c2'],
        status: 'held_for_review',
        detectedAt: new Date(),
      });

      queue.resolve({
        candidateId: 'cand-20',
        decision: 'KEEP_SEPARATE',
        actorId: 'analyst-01',
        keptId: 'c1',
        mergedId: 'c2',
        reason: 'Distinguishable entities',
      });

      const page1 = queue.getAuditLogs({ page: 1, pageSize: 10 });
      expect(page1.total).toBe(1);
      expect(page1.totalPages).toBe(1);
      expect(page1.items).toHaveLength(1);

      const filtered = queue.getAuditLogs({ actorId: 'other-user' });
      expect(filtered.total).toBe(0);
      expect(filtered.items).toHaveLength(0);
    });

    it('clears all candidates and audit entries on clear()', () => {
      queue.addCandidate({
        id: 'cand-30',
        module: 'crm-1',
        entity: 'contact',
        keyType: 'email',
        normalizedKey: 'clear@example.com',
        recordIds: ['c1', 'c2'],
        status: 'held_for_review',
        detectedAt: new Date(),
      });

      queue.clear();
      expect(queue.listHeld()).toHaveLength(0);
      expect(queue.getAuditLogs().total).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. evaluateContactDuplicate & evaluateCompanyDuplicate (Target Matching)
  // ---------------------------------------------------------------------------
  describe('evaluateContactDuplicate & evaluateCompanyDuplicate Invariants', () => {
    const existingContacts: ExistingContactRecord[] = [
      {
        id: 'contact-01',
        firstName: 'Sarah',
        lastName: 'Connor',
        email: 'sarah.connor@cyberdyne.test',
        phone: '+15550192834',
        goldenId: 'gold-01',
      },
      {
        id: 'contact-02',
        firstName: 'John',
        lastName: 'Connor',
        email: 'john.connor@resistance.test',
        phone: '+15550192835',
      },
    ];

    it('returns EXACT_MATCH when candidate email matches existing contact', () => {
      const candidate: ContactCandidate = {
        firstName: 'Sarah',
        lastName: 'Connor',
        email: '  SARAH.CONNOR@CYBERDYNE.TEST  ',
      };

      const result = evaluateContactDuplicate(candidate, existingContacts);
      expect(result.outcome).toBe('EXACT_MATCH');
      expect(result.matchedId).toBe('contact-01');
      expect(result.matchedGoldenId).toBe('gold-01');
      expect(result.requiresHumanReview).toBe(false);
      expect(result.matchingKeys).toContain('email:sarah.connor@cyberdyne.test');
    });

    it('returns EXACT_MATCH when phone + name composite key matches', () => {
      const candidate: ContactCandidate = {
        firstName: 'John',
        lastName: 'Connor',
        phone: '+1 (555) 019-2835',
        email: 'different.email@resistance.test',
      };

      const result = evaluateContactDuplicate(candidate, existingContacts);
      expect(result.outcome).toBe('EXACT_MATCH');
      expect(result.matchedId).toBe('contact-02');
      expect(result.requiresHumanReview).toBe(false);
    });

    it('returns AMBIGUOUS_REVIEW_REQUIRED when candidate matches two different records', () => {
      const candidate: ContactCandidate = {
        firstName: 'John',
        lastName: 'Connor',
        email: 'sarah.connor@cyberdyne.test', // matches contact-01 by email
        phone: '+15550192835',               // matches contact-02 by phone + name
      };

      const result = evaluateContactDuplicate(candidate, existingContacts);
      expect(result.outcome).toBe('AMBIGUOUS_REVIEW_REQUIRED');
      expect(result.requiresHumanReview).toBe(true);
      expect(result.matchedId).toBeUndefined();
      expect(result.candidateMatches).toHaveLength(2);
    });

    it('returns NO_MATCH when candidate has no matching deterministic keys', () => {
      const candidate: ContactCandidate = {
        firstName: 'Kyle',
        lastName: 'Reese',
        email: 'kyle.reese@future.test',
        phone: '+15559990000',
      };

      const result = evaluateContactDuplicate(candidate, existingContacts);
      expect(result.outcome).toBe('NO_MATCH');
      expect(result.requiresHumanReview).toBe(false);
      expect(result.candidateMatches).toHaveLength(0);
    });

    it('evaluates company duplicates on deterministic tax number', () => {
      const existingCompanies: ExistingCompanyRecord[] = [
        { id: 'comp-01', name: 'Cyberdyne Systems', taxNumber: 'US12345678' },
      ];

      const candidateMatch: CompanyCandidate = {
        name: 'Cyberdyne Systems Inc',
        taxNumber: ' us-12.345.678 ',
      };
      const matchResult = evaluateCompanyDuplicate(candidateMatch, existingCompanies);
      expect(matchResult.outcome).toBe('EXACT_MATCH');
      expect(matchResult.matchedId).toBe('comp-01');

      const candidateNoTax: CompanyCandidate = {
        name: 'No Tax Corp',
      };
      const noTaxResult = evaluateCompanyDuplicate(candidateNoTax, existingCompanies);
      expect(noTaxResult.outcome).toBe('NO_MATCH');
    });
  });
});
