import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CRM2_API_PREFIX,
  Crm2ErrorEnvelopeSchema,
  type Crm2DetectDuplicatesInput,
  type Crm2ResolveDuplicateInput,
} from '@clearshift/contracts';
import { Roles, jwtPlugin, signAccessToken } from '@cs/identity';
import type { ReferenceResolver } from '@cs/kernel';
import { crm2Routes } from '../../src/routes/crm2.routes.js';
import { crm2AuthPlugin } from '../../src/plugins/auth.js';
import { Crm2Service } from '../../src/services/crm2.service.js';

describe('CRM-2 Exact Duplicate Key API & Human Review Audit (CRM2-12 / KIT-10)', () => {
  let app: FastifyInstance;
  let service: Crm2Service;
  let adminToken: string;
  let editorToken: string;
  let analystToken: string;
  let viewerToken: string;
  let migrationToken: string;

  const mockContactResolver: ReferenceResolver = {
    async exists(entityType: string, id: string): Promise<boolean> {
      if (entityType === 'contact') {
        return id === '90000000-0000-4000-8000-000000000001';
      }
      return false;
    },
    async get<T>(entityType: string, id: string): Promise<T | null> {
      if (entityType === 'contact' && id === '90000000-0000-4000-8000-000000000001') {
        return { firstName: 'Sarah', lastName: 'Connor' } as unknown as T;
      }
      return null;
    },
  };

  beforeEach(async () => {
    service = new Crm2Service({ contactResolver: mockContactResolver });
    service.resetStore();

    app = Fastify({ logger: false });
    await app.register(jwtPlugin);
    await app.register(crm2AuthPlugin);
    await app.register(crm2Routes, {
      prefix: CRM2_API_PREFIX,
      service,
      authEnabled: true,
    });
    await app.ready();

    adminToken = await signAccessToken('admin-01', [Roles.ADMIN]);
    editorToken = await signAccessToken('editor-01', [Roles.EDITOR]);
    analystToken = await signAccessToken('analyst-01', [Roles.ANALYST]);
    viewerToken = await signAccessToken('viewer-01', [Roles.VIEWER]);
    migrationToken = await signAccessToken('migrator-01', [Roles.MIGRATION_RUNNER]);
  });

  // ---------------------------------------------------------------------------
  // 1. POST /duplicates/detect
  // ---------------------------------------------------------------------------
  describe('POST /duplicates/detect', () => {
    it('detects duplicate candidates and marks them held for review', async () => {
      const payload: Crm2DetectDuplicatesInput = {
        batchId: 'batch-dup-01',
        entity: 'deal',
        keyType: 'deal_business',
        records: [
          { id: 'deal-1', keyValue: 'Modernization#stage-1#cnt-1' },
          { id: 'deal-2', keyValue: '  modernization#stage-1#cnt-1  ' },
          { id: 'deal-3', keyValue: 'Unique Deal#stage-1#orphan' },
        ],
      };

      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/duplicates/detect`,
        headers: { authorization: `Bearer ${analystToken}` },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.uniqueRecords).toHaveLength(1);
      expect(body.duplicateCandidates).toHaveLength(1);
      expect(body.duplicateCandidates[0].keyType).toBe('deal_business');
      expect(body.duplicateCandidates[0].normalizedKey).toBe('modernization#stage-1#cnt-1');
      expect(body.duplicateCandidates[0].recordIds).toEqual(['deal-1', 'deal-2']);
      expect(body.duplicateCandidates[0].status).toBe('held_for_review');
      expect(body.summary.uniqueCount).toBe(1);
      expect(body.summary.duplicateGroupCount).toBe(1);
      expect(body.summary.duplicateRecordCount).toBe(2);
      expect(body.correlation_id).toBeDefined();
    });

    it('returns 422 AUTO_MERGE_FORBIDDEN when autoMerge is requested', async () => {
      const payload: Crm2DetectDuplicatesInput = {
        batchId: 'batch-dup-02',
        entity: 'deal',
        keyType: 'deal_business',
        autoMerge: true,
        records: [
          { id: 'deal-1', keyValue: 'Deal A#s1#c1' },
          { id: 'deal-2', keyValue: 'Deal A#s1#c1' },
        ],
      };

      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/duplicates/detect`,
        headers: { authorization: `Bearer ${analystToken}` },
        payload,
      });

      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(Crm2ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
      expect(body.code).toBe('AUTO_MERGE_FORBIDDEN');
      expect(body.message).toContain('Automatic fuzzy or unreviewed merging is forbidden in V1');
    });

    it('returns 400 Bad Request when records array is empty or payload is malformed', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/duplicates/detect`,
        headers: { authorization: `Bearer ${analystToken}` },
        payload: {
          keyType: 'deal_business',
          records: [],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/duplicates/detect`,
        payload: {
          keyType: 'deal_business',
          records: [{ id: '1', keyValue: 'key' }],
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it('rejects unauthorized roles (viewer) with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/duplicates/detect`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          keyType: 'deal_business',
          records: [{ id: '1', keyValue: 'key' }],
        },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. GET /duplicates/held
  // ---------------------------------------------------------------------------
  describe('GET /duplicates/held', () => {
    it('returns held duplicate candidates requiring human review', async () => {
      // 1. Detect duplicates to populate held candidates
      await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/duplicates/detect`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          batchId: 'batch-held-test',
          entity: 'quote',
          keyType: 'quote_number',
          records: [
            { id: 'q-1', keyValue: 'Q-2026-100' },
            { id: 'q-2', keyValue: '  q-2026-100  ' },
          ],
        },
      });

      // 2. Query held candidates
      const res = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/duplicates/held?batchId=batch-held-test`,
        headers: { authorization: `Bearer ${analystToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.items[0].keyType).toBe('quote_number');
      expect(body.items[0].normalizedKey).toBe('Q-2026-100');
      expect(body.items[0].status).toBe('held_for_review');
    });

    it('allows viewer to inspect held candidates list', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/duplicates/held`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. POST /duplicates/resolve
  // ---------------------------------------------------------------------------
  describe('POST /duplicates/resolve', () => {
    it('records human merge decision with audit log entry and returns 200', async () => {
      // 1. Detect duplicate to generate candidate
      const detectRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/duplicates/detect`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          batchId: 'batch-res-01',
          entity: 'deal',
          keyType: 'deal_business',
          records: [
            { id: 'deal-keep', keyValue: 'Acme Upgrade#s1#cnt-1' },
            { id: 'deal-drop', keyValue: 'acme upgrade#s1#cnt-1' },
          ],
        },
      });

      const candidateId = detectRes.json().duplicateCandidates[0].id;

      // 2. Resolve via human decision (Editor role)
      const resolvePayload: Crm2ResolveDuplicateInput = {
        candidateId,
        decision: 'MERGE',
        actorId: 'operator-judy',
        keptId: 'deal-keep',
        mergedId: 'deal-drop',
        reason: 'Consolidating duplicated deal under target master deal',
      };

      const resolveRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/duplicates/resolve`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: resolvePayload,
      });

      expect(resolveRes.statusCode).toBe(200);
      const resolveBody = resolveRes.json();
      expect(resolveBody.status).toBe('resolved');
      expect(resolveBody.audit.candidateId).toBe(candidateId);
      expect(resolveBody.audit.actorId).toBe('operator-judy');
      expect(resolveBody.audit.keptId).toBe('deal-keep');
      expect(resolveBody.audit.mergedId).toBe('deal-drop');
      expect(resolveBody.audit.decision).toBe('MERGE');

      // Candidate is no longer held
      const heldRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/duplicates/held`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(heldRes.json().items).toHaveLength(0);
    });

    it('returns 422 VALIDATION_ERROR when keptId equals mergedId for MERGE', async () => {
      const detectRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/duplicates/detect`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          entity: 'deal',
          keyType: 'deal_business',
          records: [
            { id: 'deal-a', keyValue: 'Contract#s1#c1' },
            { id: 'deal-b', keyValue: 'Contract#s1#c1' },
          ],
        },
      });
      const candidateId = detectRes.json().duplicateCandidates[0].id;

      const resolveRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/duplicates/resolve`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          candidateId,
          decision: 'MERGE',
          actorId: 'operator-judy',
          keptId: 'deal-a',
          mergedId: 'deal-a',
          reason: 'Cannot merge with self',
        },
      });

      expect(resolveRes.statusCode).toBe(400); // Zod validation catches keptId === mergedId
      const body = resolveRes.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 NOT_FOUND when candidateId does not exist', async () => {
      const resolveRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/duplicates/resolve`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          candidateId: '00000000-0000-4000-8000-000000000999',
          decision: 'KEEP_SEPARATE',
          actorId: 'op-1',
          keptId: 'id-1',
          mergedId: 'id-2',
          reason: 'Valid reason',
        },
      });

      expect(resolveRes.statusCode).toBe(404);
      const body = resolveRes.json();
      expect(body.code).toBe('NOT_FOUND');
    });

    it('rejects viewer role from resolving duplicate with 403 Forbidden', async () => {
      const resolveRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/duplicates/resolve`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          candidateId: '00000000-0000-4000-8000-000000000001',
          decision: 'MERGE',
          actorId: 'op-1',
          keptId: 'id-1',
          mergedId: 'id-2',
          reason: 'Reason',
        },
      });

      expect(resolveRes.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. GET /duplicates/audit
  // ---------------------------------------------------------------------------
  describe('GET /duplicates/audit', () => {
    it('returns paginated audit logs with actor ID, timestamp, kept ID, and merged ID', async () => {
      // 1. Detect and resolve a candidate
      const detectRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/duplicates/detect`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          keyType: 'deal_business',
          records: [
            { id: 'deal-101', keyValue: 'Deal X#s1#c1' },
            { id: 'deal-102', keyValue: 'Deal X#s1#c1' },
          ],
        },
      });
      const candidateId = detectRes.json().duplicateCandidates[0].id;

      await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/duplicates/resolve`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          candidateId,
          decision: 'MERGE',
          actorId: 'audited-reviewer-01',
          keptId: 'deal-101',
          mergedId: 'deal-102',
          reason: 'Duplicate confirmed from dirty data migration import',
        },
      });

      // 2. Query audit logs
      const res = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/duplicates/audit?actorId=audited-reviewer-01`,
        headers: { authorization: `Bearer ${analystToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.items[0].actorId).toBe('audited-reviewer-01');
      expect(body.items[0].keptId).toBe('deal-101');
      expect(body.items[0].mergedId).toBe('deal-102');
      expect(body.items[0].decision).toBe('MERGE');
      expect(body.items[0].timestamp).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. POST /deals/evaluate-duplicate & POST /quotes/evaluate-duplicate
  // ---------------------------------------------------------------------------
  describe('POST /deals/evaluate-duplicate & POST /quotes/evaluate-duplicate', () => {
    it('evaluates deal candidate against existing deals in store', async () => {
      // Seed deals include: 'Acme Cloud Modernization'
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals/evaluate-duplicate`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          name: '  acme cloud modernization  ',
          stageId: '10000000-0000-4000-8000-000000000003', // Proposal
          contactId: '90000000-0000-4000-8000-000000000001',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.outcome).toBe('EXACT_MATCH');
      expect(body.matchedId).toBe('20000000-0000-4000-8000-000000000001');
      expect(body.requiresHumanReview).toBe(false);
    });

    it('evaluates quote candidate against existing quotes in store', async () => {
      // Seed quotes include: 'Q-2026-001'
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes/evaluate-duplicate`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          quoteNumber: '  q-2026-001  ',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.outcome).toBe('EXACT_MATCH');
      expect(body.matchedId).toBe('30000000-0000-4000-8000-000000000001');
    });

    it('returns NO_MATCH when candidate is novel', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes/evaluate-duplicate`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          quoteNumber: 'Q-UNIQUE-99999',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.outcome).toBe('NO_MATCH');
      expect(body.requiresHumanReview).toBe(false);
    });
  });
});
