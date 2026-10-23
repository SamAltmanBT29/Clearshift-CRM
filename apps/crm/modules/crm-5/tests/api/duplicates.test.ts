import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Roles, signAccessToken } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { ControlCenterService } from '../../src/services/control-center.service.js';
import {
  DuplicateAuditLogEntrySchema,
  ErrorEnvelopeSchema,
} from '@clearshift/contracts';

describe('CRM-5 Duplicate Key API & Human Review Audit (CRM5-12)', () => {
  let app: ReturnType<typeof buildApp>;
  let service: ControlCenterService;
  let adminToken: string;

  beforeAll(async () => {
    adminToken = await signAccessToken('synthetic-admin', [Roles.ADMIN]);
  });

  beforeEach(async () => {
    service = new ControlCenterService();
    service.clear();
    app = buildApp({ service });
    await app.ready();
    const rawInject = app.inject.bind(app);
    app.inject = ((opts: any) => {
      const headers = {
        authorization: `Bearer ${adminToken}`,
        ...(opts?.headers || {}),
      };
      return rawInject({
        ...opts,
        headers,
      });
    }) as any;
  });

  // ---------------------------------------------------------------------------
  // 1. POST /api/v1/crm-control/duplicates/detect
  // ---------------------------------------------------------------------------
  describe('POST /api/v1/crm-control/duplicates/detect', () => {
    it('detects duplicate candidates and marks them held for review', async () => {
      const payload = {
        batchId: 'batch-test-dup-01',
        module: 'crm-1',
        keyType: 'email',
        records: [
          { id: 'rec-1', keyValue: '  lead@example.com  ' },
          { id: 'rec-2', keyValue: 'LEAD@EXAMPLE.COM' },
          { id: 'rec-3', keyValue: 'unique@example.com' },
        ],
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/duplicates/detect',
        payload,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.uniqueRecords).toHaveLength(1);
      expect(body.duplicateCandidates).toHaveLength(1);
      expect(body.duplicateCandidates[0].normalizedKey).toBe('lead@example.com');
      expect(body.duplicateCandidates[0].recordIds).toEqual(['rec-1', 'rec-2']);
      expect(body.duplicateCandidates[0].status).toBe('held_for_review');
      expect(body.summary.uniqueCount).toBe(1);
      expect(body.summary.duplicateGroupCount).toBe(1);
      expect(body.summary.duplicateRecordCount).toBe(2);
    });

    it('returns 422 AUTO_MERGE_FORBIDDEN when autoMerge is requested', async () => {
      const payload = {
        batchId: 'batch-test-dup-02',
        keyType: 'tax_id',
        autoMerge: true,
        records: [
          { id: 'rec-1', keyValue: '12-345-678' },
          { id: 'rec-2', keyValue: '12345678' },
        ],
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/duplicates/detect',
        payload,
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body);
      expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
      expect(body.error.code).toBe('AUTO_MERGE_FORBIDDEN');
      expect(body.error.message).toContain('Automatic fuzzy or unreviewed merging is forbidden in V1');
    });

    it('returns 400 Bad Request when records array is empty or missing key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/duplicates/detect',
        payload: {
          keyType: 'email',
          records: [],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('BAD_REQUEST');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. GET /api/v1/crm-control/duplicates/held
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-control/duplicates/held', () => {
    it('returns held duplicate candidates requiring human review', async () => {
      // Run detection to populate held candidates
      await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/duplicates/detect',
        payload: {
          batchId: 'batch-test-held',
          keyType: 'sku',
          records: [
            { id: 'sku-1', keyValue: 'ITEM-100' },
            { id: 'sku-2', keyValue: '  item-100  ' },
          ],
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/duplicates/held?batchId=batch-test-held',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.items).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.items[0].keyType).toBe('sku');
      expect(body.items[0].normalizedKey).toBe('ITEM-100');
      expect(body.items[0].status).toBe('held_for_review');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. POST /api/v1/crm-control/duplicates/resolve
  // ---------------------------------------------------------------------------
  describe('POST /api/v1/crm-control/duplicates/resolve', () => {
    it('records human merge decision with audit log entry and returns 200', async () => {
      // 1. Detect duplicate to generate candidate
      const detectRes = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/duplicates/detect',
        payload: {
          batchId: 'batch-resolve-01',
          keyType: 'email',
          records: [
            { id: 'contact-01', keyValue: 'client@example.com' },
            { id: 'contact-02', keyValue: 'Client@Example.Com' },
          ],
        },
      });
      const detectBody = JSON.parse(detectRes.body);
      const candidateId = detectBody.duplicateCandidates[0].id;

      // 2. Resolve duplicate via human decision
      const resolvePayload = {
        candidateId,
        decision: 'MERGE',
        actorId: 'operator-jane-smith',
        keptId: 'contact-01',
        mergedId: 'contact-02',
        reason: 'Confirmed same contact via tax ID secondary match',
      };

      const resolveRes = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/duplicates/resolve',
        payload: resolvePayload,
      });

      expect(resolveRes.statusCode).toBe(200);
      const resolveBody = JSON.parse(resolveRes.body);
      expect(resolveBody.status).toBe('resolved');
      expect(DuplicateAuditLogEntrySchema.safeParse(resolveBody.audit).success).toBe(true);
      expect(resolveBody.audit.candidateId).toBe(candidateId);
      expect(resolveBody.audit.actorId).toBe('operator-jane-smith');
      expect(resolveBody.audit.keptId).toBe('contact-01');
      expect(resolveBody.audit.mergedId).toBe('contact-02');
      expect(resolveBody.audit.decision).toBe('MERGE');

      // Candidate is no longer in held list
      const heldRes = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/duplicates/held',
      });
      const heldBody = JSON.parse(heldRes.body);
      expect(heldBody.items).toHaveLength(0);
    });

    it('returns 404 when candidateId does not exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/duplicates/resolve',
        payload: {
          candidateId: 'non-existent-candidate-uuid',
          decision: 'KEEP_SEPARATE',
          actorId: 'operator-1',
          keptId: 'rec-1',
          mergedId: 'rec-2',
          reason: 'distinct entities',
        },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 Bad Request when self-merge is attempted (keptId === mergedId)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/duplicates/resolve',
        payload: {
          candidateId: 'candidate-1',
          decision: 'MERGE',
          actorId: 'operator-1',
          keptId: 'same-id',
          mergedId: 'same-id',
          reason: 'attempt self merge',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('BAD_REQUEST');
      expect(body.error.message).toContain('Invalid duplicate resolution payload');
    });

    it('returns 422 when mergedId does not belong to candidate recordIds', async () => {
      const detectRes = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/duplicates/detect',
        payload: {
          keyType: 'email',
          records: [
            { id: 'rec-alpha', keyValue: 'dup@test.com' },
            { id: 'rec-beta', keyValue: 'dup@test.com' },
          ],
        },
      });
      const candidateId = JSON.parse(detectRes.body).duplicateCandidates[0].id;

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/duplicates/resolve',
        payload: {
          candidateId,
          decision: 'MERGE',
          actorId: 'operator-1',
          keptId: 'rec-alpha',
          mergedId: 'alien-rec-id',
          reason: 'foreign record id',
        },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('UNPROCESSABLE_ENTITY');
      expect(body.error.message).toContain('alien-rec-id');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. GET /api/v1/crm-control/duplicates/audit
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-control/duplicates/audit', () => {
    it('returns paginated audit logs of human merge decisions', async () => {
      // 1. Setup and resolve duplicate
      const detectRes = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/duplicates/detect',
        payload: {
          keyType: 'tax_id',
          records: [
            { id: 'tax-1', keyValue: '99-88-77' },
            { id: 'tax-2', keyValue: '998877' },
          ],
        },
      });
      const candidateId = JSON.parse(detectRes.body).duplicateCandidates[0].id;

      await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/duplicates/resolve',
        payload: {
          candidateId,
          decision: 'KEEP_SEPARATE',
          actorId: 'auditor-dhruv',
          keptId: 'tax-1',
          mergedId: 'tax-2',
          reason: 'Subsidiary vs Parent entity',
        },
      });

      const auditRes = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/duplicates/audit?actorId=auditor-dhruv',
      });

      expect(auditRes.statusCode).toBe(200);
      const auditBody = JSON.parse(auditRes.body);
      expect(auditBody.total).toBe(1);
      expect(auditBody.items).toHaveLength(1);
      expect(auditBody.items[0].candidateId).toBe(candidateId);
      expect(auditBody.items[0].actorId).toBe('auditor-dhruv');
      expect(auditBody.items[0].decision).toBe('KEEP_SEPARATE');
      expect(auditBody.items[0].normalizedKey).toBe('998877');
    });
  });
});
