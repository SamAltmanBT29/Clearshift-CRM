import { describe, it, expect, beforeEach } from 'vitest';
import { Roles, signAccessToken } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { Crm4Service } from '../../src/services/crm4.service.js';
import { Crm4AuditService } from '../../src/services/audit.js';
import {
  buildListExactKey,
  buildListBusinessKey,
  buildCampaignExactKey,
  buildMemberExactKey,
  buildConsentExactKey,
  evaluateListDuplicate,
  evaluateCampaignDuplicate,
  type ListCandidate,
  type ExistingListRecord,
  type CampaignCandidate,
  type ExistingCampaignRecord,
} from '@clearshift/contracts';

describe('CRM-4 Exact Duplicate Key Policy & Human Review ([CRM4-12] / Issue #165)', () => {
  // =========================================================================
  // 1. Normalization & Exact Key Builders
  // =========================================================================
  describe('1. Normalization & Exact Key Builders', () => {
    it('buildListExactKey: normalizes source_system + source_id (trimmed lowercase) (BR-CRM4-DUP-01)', () => {
      const key1 = buildListExactKey('  Hubspot_CRM  ', '  LST-9001  ');
      const key2 = buildListExactKey('hubspot_crm', 'lst-9001');
      expect(key1).toBe('hubspot_crm#lst-9001');
      expect(key1).toBe(key2);
    });

    it('buildListBusinessKey: collapses whitespace and lowercases name', () => {
      const key1 = buildListBusinessKey('   Q4    Enterprise    Prospects   ');
      expect(key1).toBe('q4 enterprise prospects');
    });

    it('buildCampaignExactKey: builds composite name#listId#campaignDate (BR-CRM4-DUP-02)', () => {
      const key = buildCampaignExactKey(
        '  Product Launch  ',
        '  44444444-1111-4444-8444-000000000001  ',
        '  2026-11-01  '
      );
      expect(key).toBe('product launch#44444444-1111-4444-8444-000000000001#2026-11-01');
    });

    it('buildMemberExactKey: builds composite campaignId#contactId (BR-CRM4-DUP-03)', () => {
      const key = buildMemberExactKey(
        '  44444444-2222-4444-8444-000000000001  ',
        '  11111111-1111-4111-8111-000000000001  '
      );
      expect(key).toBe('44444444-2222-4444-8444-000000000001#11111111-1111-4111-8111-000000000001');
    });

    it('buildConsentExactKey: normalizes contactId strictly 1:1', () => {
      const key = buildConsentExactKey('  11111111-1111-4111-8111-000000000001  ');
      expect(key).toBe('11111111-1111-4111-8111-000000000001');
    });
  });

  // =========================================================================
  // 2. Deterministic Candidate Evaluation (Zero Fuzzy Auto-Merge)
  // =========================================================================
  describe('2. Deterministic Candidate Evaluation', () => {
    const existingLists: ExistingListRecord[] = [
      {
        id: 'list-1',
        name: 'Enterprise Prospects',
        sourceSystem: 'salesforce',
        sourceId: 'SF-100',
      },
      {
        id: 'list-2',
        name: 'APAC Customers',
        sourceSystem: 'salesforce',
        sourceId: 'SF-200',
      },
      {
        id: 'list-3',
        name: 'Enterprise Prospects',
        sourceSystem: 'hubspot',
        sourceId: 'HB-300',
      },
    ];

    it('evaluates exact match on source key (sourceSystem + sourceId)', () => {
      const candidate: ListCandidate = {
        name: 'Different Name',
        sourceSystem: 'salesforce',
        sourceId: 'SF-200',
      };
      const result = evaluateListDuplicate(candidate, existingLists);
      expect(result.outcome).toBe('EXACT_MATCH');
      expect(result.matchedId).toBe('list-2');
      expect(result.requiresHumanReview).toBe(false);
    });

    it('flags AMBIGUOUS_REVIEW_REQUIRED when candidate matches multiple distinct existing records', () => {
      // 'Enterprise Prospects' matches both list-1 and list-3
      const candidate: ListCandidate = {
        name: 'Enterprise Prospects',
      };
      const result = evaluateListDuplicate(candidate, existingLists);
      expect(result.outcome).toBe('AMBIGUOUS_REVIEW_REQUIRED');
      expect(result.requiresHumanReview).toBe(true);
      expect(result.candidateMatches).toHaveLength(2);
      expect(result.reason).toContain('Ambiguous match');
    });

    it('returns NO_MATCH when candidate does not match any existing records', () => {
      const candidate: ListCandidate = {
        name: 'Completely Unique Marketing List',
        sourceSystem: 'marketo',
        sourceId: 'MK-999',
      };
      const result = evaluateListDuplicate(candidate, existingLists);
      expect(result.outcome).toBe('NO_MATCH');
      expect(result.requiresHumanReview).toBe(false);
    });

    it('evaluates campaign composite key duplicates deterministically', () => {
      const existingCampaigns: ExistingCampaignRecord[] = [
        {
          id: 'camp-1',
          name: 'Winter Outreach',
          listId: 'list-1',
          campaignDate: '2026-12-01',
        },
      ];

      const exactCandidate: CampaignCandidate = {
        name: 'Winter Outreach',
        listId: 'list-1',
        campaignDate: '2026-12-01',
      };
      const match = evaluateCampaignDuplicate(exactCandidate, existingCampaigns);
      expect(match.outcome).toBe('EXACT_MATCH');
      expect(match.matchedId).toBe('camp-1');

      const differentDateCandidate: CampaignCandidate = {
        name: 'Winter Outreach',
        listId: 'list-1',
        campaignDate: '2026-12-15',
      };
      const noMatch = evaluateCampaignDuplicate(differentDateCandidate, existingCampaigns);
      expect(noMatch.outcome).toBe('NO_MATCH');
    });
  });

  // =========================================================================
  // 3. Service Layer Duplicate Detection & Human Review Resolution
  // =========================================================================
  describe('3. Service Layer Duplicate Detection & Resolution', () => {
    let service: Crm4Service;

    beforeEach(() => {
      service = new Crm4Service();
    });

    it('detects duplicate records and places them in held_for_review status (no auto-merge)', async () => {
      const detectionResult = await service.detectDuplicates({
        batchId: 'batch-001',
        entity: 'list',
        keyType: 'list_name',
        records: [
          { id: 'rec-1', keyValue: 'Spring Product Launch' },
          { id: 'rec-2', keyValue: 'spring product launch' }, // Duplicate!
          { id: 'rec-3', keyValue: 'Unique VIP List' },
        ],
      });

      expect(detectionResult.totalDuplicates).toBe(1);
      expect(detectionResult.heldForReviewCount).toBe(1);
      expect(detectionResult.candidates[0]!.status).toBe('held_for_review');
      expect(detectionResult.candidates[0]!.recordIds).toEqual(['rec-1', 'rec-2']);
    });

    it('resolves duplicate candidate and records immutable audit log entry', async () => {
      const detectionResult = await service.detectDuplicates({
        batchId: 'batch-002',
        entity: 'list',
        keyType: 'list_name',
        records: [
          { id: 'rec-1', keyValue: 'Beta Testers' },
          { id: 'rec-2', keyValue: 'beta testers' },
        ],
      });

      const candidateId = detectionResult.candidates[0]!.id;

      const auditLog = await service.resolveDuplicate({
        candidateId,
        decision: 'MERGE',
        actorId: 'usr-admin-1',
        keptId: 'rec-1',
        mergedId: 'rec-2',
        reason: 'Authorized human merge: records confirmed identical from Hubspot import',
      });

      expect(auditLog.candidateId).toBe(candidateId);
      expect(auditLog.decision).toBe('MERGE');
      expect(auditLog.keptId).toBe('rec-1');
      expect(auditLog.mergedId).toBe('rec-2');

      // Verify candidate is now marked as resolved
      const candidates = await service.getDuplicateCandidates();
      const resolved = candidates.items.find((c) => c.id === candidateId);
      expect(resolved?.status).toBe('resolved');

      // Verify cannot re-resolve
      await expect(
        service.resolveDuplicate({
          candidateId,
          decision: 'KEEP_SEPARATE',
          actorId: 'usr-admin-1',
          keptId: 'rec-1',
          mergedId: 'rec-2',
          reason: 'Attempt duplicate resolution',
        })
      ).rejects.toThrowError(/already been resolved/);
    });

    it('rejects resolution if keptId or mergedId does not belong to candidate', async () => {
      const detectionResult = await service.detectDuplicates({
        batchId: 'batch-003',
        entity: 'list',
        keyType: 'list_name',
        records: [
          { id: 'rec-1', keyValue: 'Alpha Cohort' },
          { id: 'rec-2', keyValue: 'alpha cohort' },
        ],
      });

      const candidateId = detectionResult.candidates[0]!.id;

      await expect(
        service.resolveDuplicate({
          candidateId,
          decision: 'MERGE',
          actorId: 'usr-admin-1',
          keptId: 'rec-1',
          mergedId: 'rec-unrelated-id',
          reason: 'Invalid merged ID test',
        })
      ).rejects.toThrowError(/does not belong to duplicate candidate/);
    });
  });

  // =========================================================================
  // 4. HTTP API End-to-End: /duplicates/detect & /duplicates/resolve
  // =========================================================================
  describe('4. HTTP API End-to-End: /duplicates endpoints', () => {
    let app: ReturnType<typeof buildApp>;
    let service: Crm4Service;
    let auditService: Crm4AuditService;
    let editorToken: string;
    let viewerToken: string;

    const editorHeaders = () => ({ authorization: `Bearer ${editorToken}` });
    const viewerHeaders = () => ({ authorization: `Bearer ${viewerToken}` });

    beforeEach(async () => {
      service = new Crm4Service();
      auditService = new Crm4AuditService();
      app = buildApp({ service, auditService, authEnabled: true });
      await app.ready();

      editorToken = await signAccessToken('test-editor-user', [Roles.EDITOR]);
      viewerToken = await signAccessToken('test-viewer-user', [Roles.VIEWER]);
    });

    it('POST /duplicates/detect: returns 200 OK and flags candidates held for human review', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/duplicates/detect',
        headers: editorHeaders(),
        payload: {
          batchId: 'http-batch-01',
          entity: 'list',
          keyType: 'list_name',
          records: [
            { id: 'l1', keyValue: 'High Intent Prospects' },
            { id: 'l2', keyValue: 'high intent prospects' },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalDuplicates).toBe(1);
      expect(body.heldForReviewCount).toBe(1);
      expect(body.candidates[0].status).toBe('held_for_review');
    });

    it('POST /duplicates/resolve: returns 200 OK for EDITOR and records audit event', async () => {
      // 1. Detect duplicates first
      const detectRes = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/duplicates/detect',
        headers: editorHeaders(),
        payload: {
          batchId: 'http-batch-02',
          entity: 'list',
          keyType: 'list_name',
          records: [
            { id: 'id-a', keyValue: 'APAC Enterprise' },
            { id: 'id-b', keyValue: 'apac enterprise' },
          ],
        },
      });
      const candidateId = detectRes.json().candidates[0].id;

      // 2. Resolve via human decision
      const resolveRes = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/duplicates/resolve',
        headers: editorHeaders(),
        payload: {
          candidateId,
          decision: 'MERGE',
          actorId: 'test-editor-user',
          keptId: 'id-a',
          mergedId: 'id-b',
          reason: 'Human review confirms identical lists from Marketo migration',
        },
      });

      expect(resolveRes.statusCode).toBe(200);
      const resolveBody = resolveRes.json();
      expect(resolveBody.status).toBe('RESOLVED');
      expect(resolveBody.decision).toBe('MERGE');
      expect(resolveBody.auditLog.keptId).toBe('id-a');
      expect(resolveBody.auditLog.mergedId).toBe('id-b');
    });

    it('POST /duplicates/resolve: returns 403 Forbidden for VIEWER role', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/duplicates/resolve',
        headers: viewerHeaders(),
        payload: {
          candidateId: 'cand-001',
          decision: 'MERGE',
          actorId: 'test-viewer-user',
          keptId: 'id-a',
          mergedId: 'id-b',
          reason: 'Viewer unauthorized resolution attempt',
        },
      });

      expect(res.statusCode).toBe(403);
    });
  });
});
