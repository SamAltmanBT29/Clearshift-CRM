import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Roles, signAccessToken } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { Crm1Service } from '../../src/services/crm1.service.js';
import { Crm1AuditService } from '../../src/services/audit.js';
import type {
  Crm1DetectDuplicatesInput,
  Crm1ResolveDuplicateInput,
} from '@clearshift/contracts';

const API_PREFIX = '/api/v1/crm-contacts';

describe('CRM-1 Duplicate Key Policy & Human Review API ([CRM1-12] / KIT-10)', () => {
  let app: ReturnType<typeof buildApp>;
  let service: Crm1Service;
  let auditService: Crm1AuditService;

  let adminToken: string;
  let editorToken: string;
  let analystToken: string;
  let runnerToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    service = new Crm1Service();
    auditService = new Crm1AuditService();
    app = buildApp({ service, auditService });
    await app.ready();

    adminToken = await signAccessToken('synthetic-admin', [Roles.ADMIN]);
    editorToken = await signAccessToken('synthetic-editor', [Roles.EDITOR]);
    analystToken = await signAccessToken('synthetic-analyst', [Roles.ANALYST]);
    runnerToken = await signAccessToken('synthetic-runner', [Roles.MIGRATION_RUNNER]);
    viewerToken = await signAccessToken('synthetic-viewer', [Roles.VIEWER]);
  });

  beforeEach(() => {
    service.resetDuplicateStore();
    auditService.resetLedger();
  });

  // ---------------------------------------------------------------------------
  // 1. POST /api/v1/crm-contacts/duplicates/detect
  // ---------------------------------------------------------------------------
  describe('POST /duplicates/detect', () => {
    it('detects duplicate candidates and marks them held for review (analyst role)', async () => {
      const payload: Crm1DetectDuplicatesInput = {
        batchId: 'batch-dup-01',
        entity: 'contact',
        keyType: 'email',
        records: [
          { id: 'cnt-1', keyValue: 'sarah.connor@example.com' },
          { id: 'cnt-2', keyValue: '  SARAH.CONNOR@EXAMPLE.COM  ' },
          { id: 'cnt-3', keyValue: 'john.connor@example.com' },
        ],
      };

      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/duplicates/detect`,
        headers: { authorization: `Bearer ${analystToken}` },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.uniqueRecords).toHaveLength(1);
      expect(body.uniqueRecords[0].id).toBe('cnt-3');

      expect(body.duplicateCandidates).toHaveLength(1);
      const candidate = body.duplicateCandidates[0];
      expect(candidate.keyType).toBe('email');
      expect(candidate.normalizedKey).toBe('sarah.connor@example.com');
      expect(candidate.recordIds).toEqual(['cnt-1', 'cnt-2']);
      expect(candidate.status).toBe('held_for_review');
      expect(candidate.module).toBe('crm-1');
      expect(candidate.entity).toBe('contact');
      expect(body.correlation_id).toBeDefined();

      expect(body.summary.uniqueCount).toBe(1);
      expect(body.summary.duplicateGroupCount).toBe(1);
      expect(body.summary.duplicateRecordCount).toBe(2);
    });

    it('detects company tax number duplicates (migration_runner role)', async () => {
      const payload: Crm1DetectDuplicatesInput = {
        batchId: 'batch-dup-02',
        entity: 'company',
        keyType: 'tax_number',
        records: [
          { id: 'comp-1', keyValue: 'US-12.345-6789' },
          { id: 'comp-2', keyValue: ' us 123456789 ' },
          { id: 'comp-3', keyValue: 'DE-999.888' },
        ],
      };

      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/duplicates/detect`,
        headers: { authorization: `Bearer ${runnerToken}` },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.uniqueRecords).toHaveLength(1);
      expect(body.duplicateCandidates).toHaveLength(1);
      expect(body.duplicateCandidates[0].normalizedKey).toBe('US123456789');
    });

    it('returns 422 AUTO_MERGE_FORBIDDEN when autoMerge is requested', async () => {
      const payload: Crm1DetectDuplicatesInput = {
        batchId: 'batch-dup-03',
        entity: 'contact',
        keyType: 'email',
        autoMerge: true,
        records: [
          { id: 'cnt-1', keyValue: 'a@example.com' },
          { id: 'cnt-2', keyValue: 'a@example.com' },
        ],
      };

      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/duplicates/detect`,
        headers: { authorization: `Bearer ${analystToken}` },
        payload,
      });

      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.code).toBe('AUTO_MERGE_FORBIDDEN');
      expect(body.message).toContain('Automatic fuzzy or unreviewed merging is forbidden in V1');
    });

    it('returns 403 Forbidden for unauthorized viewer role', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/duplicates/detect`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          keyType: 'email',
          records: [{ id: '1', keyValue: 'test@example.com' }],
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('returns 400 Bad Request for invalid payload', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/duplicates/detect`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          records: [], // records array must contain at least 1 record
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('BAD_REQUEST');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. GET /api/v1/crm-contacts/duplicates/held
  // ---------------------------------------------------------------------------
  describe('GET /duplicates/held', () => {
    it('lists held duplicate candidates for viewer and analyst', async () => {
      // First populate via detect
      await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/duplicates/detect`,
        headers: { authorization: `Bearer ${analystToken}` },
        payload: {
          batchId: 'held-test-batch',
          entity: 'contact',
          keyType: 'email',
          records: [
            { id: 'h-1', keyValue: 'dup@example.com' },
            { id: 'h-2', keyValue: 'DUP@example.com' },
          ],
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/duplicates/held`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(1);
      expect(body.items[0].normalizedKey).toBe('dup@example.com');
      expect(body.items[0].status).toBe('held_for_review');
    });

    it('filters held candidates by batchId and keyType', async () => {
      await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/duplicates/detect`,
        headers: { authorization: `Bearer ${analystToken}` },
        payload: {
          batchId: 'target-batch-42',
          entity: 'contact',
          keyType: 'email',
          records: [
            { id: 'a', keyValue: 'alpha@test.org' },
            { id: 'b', keyValue: 'alpha@test.org' },
          ],
        },
      });

      const matchRes = await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/duplicates/held?batchId=target-batch-42&keyType=email`,
        headers: { authorization: `Bearer ${analystToken}` },
      });
      expect(matchRes.statusCode).toBe(200);
      expect(matchRes.json().total).toBe(1);

      const noMatchRes = await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/duplicates/held?batchId=non-existent-batch`,
        headers: { authorization: `Bearer ${analystToken}` },
      });
      expect(noMatchRes.statusCode).toBe(200);
      expect(noMatchRes.json().total).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. POST /api/v1/crm-contacts/duplicates/resolve
  // ---------------------------------------------------------------------------
  describe('POST /duplicates/resolve', () => {
    let candidateId: string;

    beforeEach(async () => {
      const detectRes = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/duplicates/detect`,
        headers: { authorization: `Bearer ${analystToken}` },
        payload: {
          batchId: 'resolve-batch',
          entity: 'contact',
          keyType: 'email',
          records: [
            { id: 'rec-01', keyValue: 'merge.test@example.com' },
            { id: 'rec-02', keyValue: 'merge.test@example.com' },
          ],
        },
      });
      candidateId = detectRes.json().duplicateCandidates[0].id;
    });

    it('records MERGE decision and emits immutable audit log (editor role)', async () => {
      const payload: Crm1ResolveDuplicateInput = {
        candidateId,
        decision: 'MERGE',
        actorId: 'editor-john',
        keptId: 'rec-01',
        mergedId: 'rec-02',
        reason: 'Confirmed identical customer by human review',
        metadata: { channel: 'manual_review' },
      };

      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/duplicates/resolve`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const audit = res.json();
      expect(audit.id).toBeDefined();
      expect(audit.candidateId).toBe(candidateId);
      expect(audit.decision).toBe('MERGE');
      expect(audit.actorId).toBe('editor-john');
      expect(audit.keptId).toBe('rec-01');
      expect(audit.mergedId).toBe('rec-02');
      expect(audit.reason).toBe('Confirmed identical customer by human review');
      expect(audit.correlation_id).toBeDefined();

      // Check candidate is now resolved and removed from held queue
      const heldRes = await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/duplicates/held`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(heldRes.json().total).toBe(0);
    });

    it('records KEEP_SEPARATE decision (analyst role)', async () => {
      const payload: Crm1ResolveDuplicateInput = {
        candidateId,
        decision: 'KEEP_SEPARATE',
        actorId: 'analyst-jane',
        keptId: 'rec-01',
        mergedId: 'rec-02',
        reason: 'Confirmed distinct accounts with coincident key',
      };

      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/duplicates/resolve`,
        headers: { authorization: `Bearer ${analystToken}` },
        payload,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().decision).toBe('KEEP_SEPARATE');
    });

    it('returns 400 Bad Request when keptId equals mergedId for MERGE decision', async () => {
      const payload = {
        candidateId,
        decision: 'MERGE',
        actorId: 'editor-john',
        keptId: 'rec-01',
        mergedId: 'rec-01',
        reason: 'Self-merge forbidden',
      };

      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/duplicates/resolve`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload,
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('BAD_REQUEST');
      expect(JSON.stringify(body)).toContain('keptId and mergedId cannot be the same');
    });

    it('returns 400 Bad Request when IDs do not belong to candidate group', async () => {
      const payload = {
        candidateId,
        decision: 'MERGE',
        actorId: 'editor-john',
        keptId: 'rec-01',
        mergedId: 'foreign-id-999',
        reason: 'Invalid foreign ID',
      };

      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/duplicates/resolve`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('does not belong to candidate recordIds');
    });

    it('returns 404 Not Found for non-existent candidate ID', async () => {
      const payload = {
        candidateId: '00000000-0000-4000-8000-000000000099',
        decision: 'KEEP_SEPARATE',
        actorId: 'editor-john',
        keptId: 'rec-01',
        mergedId: 'rec-02',
        reason: 'Missing candidate',
      };

      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/duplicates/resolve`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
    });

    it('returns 403 Forbidden for viewer role', async () => {
      const payload = {
        candidateId,
        decision: 'MERGE',
        actorId: 'viewer-user',
        keptId: 'rec-01',
        mergedId: 'rec-02',
        reason: 'Viewer cannot resolve duplicates',
      };

      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/duplicates/resolve`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload,
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. GET /api/v1/crm-contacts/duplicates/audit
  // ---------------------------------------------------------------------------
  describe('GET /duplicates/audit', () => {
    it('queries paginated audit logs of human merge decisions', async () => {
      // Create and resolve candidate
      const detectRes = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/duplicates/detect`,
        headers: { authorization: `Bearer ${analystToken}` },
        payload: {
          batchId: 'audit-batch-1',
          entity: 'contact',
          keyType: 'email',
          records: [
            { id: 'aud-1', keyValue: 'aud@example.com' },
            { id: 'aud-2', keyValue: 'aud@example.com' },
          ],
        },
      });
      const candId = detectRes.json().duplicateCandidates[0].id;

      await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/duplicates/resolve`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          candidateId: candId,
          decision: 'MERGE',
          actorId: 'auditor-01',
          keptId: 'aud-1',
          mergedId: 'aud-2',
          reason: 'Audited merge',
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/duplicates/audit`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(1);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(20);
      expect(body.totalPages).toBe(1);
      expect(body.items[0].actorId).toBe('auditor-01');
      expect(body.items[0].decision).toBe('MERGE');
      expect(body.items[0].keptId).toBe('aud-1');
      expect(body.items[0].mergedId).toBe('aud-2');
    });

    it('filters audit logs by actorId and candidateId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/duplicates/audit?actorId=non-existent-actor`,
        headers: { authorization: `Bearer ${analystToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBe(0);
      expect(res.json().items).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. POST /duplicates/evaluate/contact & /company
  // ---------------------------------------------------------------------------
  describe('POST /duplicates/evaluate/contact & /company', () => {
    it('evaluates contact candidate and returns deterministic result', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/duplicates/evaluate/contact`,
        headers: { authorization: `Bearer ${analystToken}` },
        payload: {
          firstName: 'Synthetic',
          lastName: 'Candidate',
          email: 'synthetic.unique@test.example',
          phone: '+15551239876',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.outcome).toBe('NO_MATCH');
      expect(body.requiresHumanReview).toBe(false);
      expect(body.correlation_id).toBeDefined();
    });

    it('returns 400 Bad Request when contact evaluation payload is invalid', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/duplicates/evaluate/contact`,
        headers: { authorization: `Bearer ${analystToken}` },
        payload: {
          firstName: '', // missing required name
          lastName: '',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('evaluates company candidate and returns deterministic result', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/duplicates/evaluate/company`,
        headers: { authorization: `Bearer ${runnerToken}` },
        payload: {
          name: 'Synthetic Enterprise Corp',
          taxNumber: 'US-99.888.777',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.outcome).toBe('NO_MATCH');
      expect(body.requiresHumanReview).toBe(false);
      expect(body.correlation_id).toBeDefined();
    });
  });
});
