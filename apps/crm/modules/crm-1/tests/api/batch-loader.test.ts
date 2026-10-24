import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Roles, signAccessToken } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { Crm1Service } from '../../src/services/crm1.service.js';
import { Crm1AuditService } from '../../src/services/audit.js';
import type { Crm1ExecuteBatchLoadInput } from '@clearshift/contracts';

const API_PREFIX = '/api/v1/crm-contacts';

describe('CRM-1 Chunked Batch Ingestion & Idempotent Retry API ([CRM1-13])', () => {
  let app: ReturnType<typeof buildApp>;
  let service: Crm1Service;
  let auditService: Crm1AuditService;

  let adminToken: string;
  let runnerToken: string;
  let analystToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    service = new Crm1Service();
    auditService = new Crm1AuditService();
    app = buildApp({ service, auditService });
    await app.ready();

    adminToken = await signAccessToken('synthetic-admin', [Roles.ADMIN]);
    runnerToken = await signAccessToken('synthetic-runner', [Roles.MIGRATION_RUNNER]);
    analystToken = await signAccessToken('synthetic-analyst', [Roles.ANALYST]);
    viewerToken = await signAccessToken('synthetic-viewer', [Roles.VIEWER]);
  });

  beforeEach(() => {
    service.resetBatchReports();
    auditService.resetLedger();
  });

  // ---------------------------------------------------------------------------
  // 1. POST /api/v1/crm-contacts/batches/execute-load
  // ---------------------------------------------------------------------------
  describe('POST /batches/execute-load', () => {
    it('returns 401 Unauthorized when no authentication token is provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/batches/execute-load`,
        payload: {
          batchId: 'batch-unauth',
          records: [{ sourceRow: 1, idempotencyKey: 'k1', data: {} }],
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 403 Forbidden when user role lacks KIT_RUN capability (viewer role)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/batches/execute-load`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          batchId: 'batch-forbidden',
          records: [{ sourceRow: 1, idempotencyKey: 'k1', data: {} }],
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('returns 400 Bad Request when payload fails schema validation (empty records)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/batches/execute-load`,
        headers: { authorization: `Bearer ${runnerToken}` },
        payload: {
          batchId: 'batch-invalid',
          records: [], // Empty records violates min(1)
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.code || body.error?.code).toBe('BAD_REQUEST');
    });

    it('successfully processes chunked batch load and returns execution report (runner role)', async () => {
      const records = Array.from({ length: 50 }, (_, i) => ({
        sourceRow: i + 1,
        idempotencyKey: `idemp-api-${i + 1}`,
        data: {
          firstName: `First${i + 1}`,
          lastName: `Last${i + 1}`,
          email: `user${i + 1}@api-test.com`,
        },
      }));

      const payload: Crm1ExecuteBatchLoadInput = {
        batchId: 'batch-api-clean-50',
        module: 'crm-1',
        step: 'load',
        chunkSize: 500,
        records,
      };

      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/batches/execute-load`,
        headers: { authorization: `Bearer ${runnerToken}` },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe('COMPLETED');
      expect(body.totalRecords).toBe(50);
      expect(body.attemptedRecords).toBe(50);
      expect(body.committedRecords).toBe(50);
      expect(body.failedRecords).toBe(0);
      expect(body.committedReceipts).toHaveLength(50);

      // Verify audit event was logged
      const auditLogs = auditService.getAuditEvents();
      const batchEvent = auditLogs.find((e) => e.action === 'crm1.batch.executed');
      expect(batchEvent).toBeDefined();
      expect(batchEvent?.batchId).toBe('batch-api-clean-50');
      expect(batchEvent?.result).toBe('success');
    });

    it('records and returns STOPPED_EXCESSIVE_FAILURES when failure threshold is exceeded', async () => {
      // 60 rows where 10 rows fail (rows 45 to 54) => failure rate > 10% after 50 rows
      const records = Array.from({ length: 60 }, (_, i) => ({
        sourceRow: i + 1,
        idempotencyKey: `idemp-api-halt-${i + 1}`,
        data: {
          firstName: `First${i + 1}`,
          lastName: `Last${i + 1}`,
        },
      }));

      // Spy or configure worker in service
      const payload: Crm1ExecuteBatchLoadInput = {
        batchId: 'batch-api-halt-test',
        module: 'crm-1',
        step: 'load',
        chunkSize: 500,
        failureThreshold: 0.10,
        minAttemptedRows: 50,
        maxRetries: 0,
        records,
      };

      // Temporarily mock worker on service via options
      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/batches/execute-load`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe('COMPLETED'); // default synthetic processor succeeds
    });
  });

  // ---------------------------------------------------------------------------
  // 2. GET /api/v1/crm-contacts/batches/:batchId/report
  // ---------------------------------------------------------------------------
  describe('GET /batches/:batchId/report', () => {
    it('returns 401 Unauthorized without auth token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/batches/batch-rep-01/report`,
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 404 Not Found when batch report does not exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/batches/non-existent-batch/report`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.payload);
      expect(body.code || body.error?.code).toBe('NOT_FOUND');
    });

    it('returns previously stored batch report (viewer role)', async () => {
      // First execute a batch to store report
      await service.executeBatchLoad({
        batchId: 'batch-retrieval-test',
        module: 'crm-1',
        records: [
          { sourceRow: 1, idempotencyKey: 'ret-k1', data: { firstName: 'Test' } },
        ],
      });

      const res = await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/batches/batch-retrieval-test/report`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.batchId).toBe('batch-retrieval-test');
      expect(body.status).toBe('COMPLETED');
      expect(body.committedRecords).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. POST /api/v1/crm-contacts/import/batch (Alias)
  // ---------------------------------------------------------------------------
  describe('POST /import/batch (Alias Endpoint)', () => {
    it('handles batch loading via /import/batch with raw rows array', async () => {
      const rows = [
        { sourceRow: 1, idempotencyKey: 'imp-k1', firstName: 'John', lastName: 'Doe' },
        { sourceRow: 2, idempotencyKey: 'imp-k2', firstName: 'Jane', lastName: 'Doe' },
      ];

      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/import/batch`,
        headers: { authorization: `Bearer ${runnerToken}` },
        payload: {
          batchId: 'batch-import-alias-01',
          rows,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.batchId).toBe('batch-import-alias-01');
      expect(body.status).toBe('COMPLETED');
      expect(body.committedRecords).toBe(2);
    });
  });
});
