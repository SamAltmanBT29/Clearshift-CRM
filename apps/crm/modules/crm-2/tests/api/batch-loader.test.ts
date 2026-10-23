import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CRM2_API_PREFIX,
  Crm2BatchExecutionReportSchema,
  Crm2ErrorEnvelopeSchema,
} from '@clearshift/contracts';
import { Roles, jwtPlugin, signAccessToken } from '@cs/identity';
import { crm2Routes } from '../../src/routes/crm2.routes.js';
import { crm2AuthPlugin } from '../../src/plugins/auth.js';
import { Crm2Service } from '../../src/services/crm2.service.js';

describe('CRM-2 Batch Load Execution API (CRM2-13)', () => {
  let app: FastifyInstance;
  let service: Crm2Service;
  let adminToken: string;
  let migrationToken: string;
  let editorToken: string;
  let viewerToken: string;

  beforeEach(async () => {
    service = new Crm2Service();
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

    adminToken = await signAccessToken('synthetic-admin', [Roles.ADMIN]);
    migrationToken = await signAccessToken('synthetic-migrator', [Roles.MIGRATION_RUNNER]);
    editorToken = await signAccessToken('synthetic-editor', [Roles.EDITOR]);
    viewerToken = await signAccessToken('synthetic-viewer', [Roles.VIEWER]);
  });

  describe('RBAC & Security Authorization', () => {
    it('returns 401 Unauthorized when request lacks Bearer token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/batches/execute-load`,
        payload: {
          batchId: 'batch-unauth-01',
          records: [{ sourceRow: 1, idempotencyKey: 'k1', data: {} }],
        },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 Forbidden when authenticated as viewer or editor without migration privileges', async () => {
      for (const token of [viewerToken, editorToken]) {
        const res = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/batches/execute-load`,
          headers: {
            authorization: `Bearer ${token}`,
          },
          payload: {
            batchId: 'batch-forbidden-01',
            records: [{ sourceRow: 1, idempotencyKey: 'k1', data: {} }],
          },
        });

        expect(res.statusCode).toBe(403);
        const body = JSON.parse(res.body);
        expect(body.code).toBe('FORBIDDEN');
      }
    });

    it('allows MIGRATION_RUNNER and ADMIN roles to execute batch loads', async () => {
      for (const token of [migrationToken, adminToken]) {
        const res = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/batches/execute-load`,
          headers: {
            authorization: `Bearer ${token}`,
          },
          payload: {
            batchId: `batch-role-${Date.now()}`,
            records: [
              {
                sourceRow: 1,
                idempotencyKey: `k-${Date.now()}`,
                data: {
                  entity: 'deal',
                  name: 'Role Authorized Deal',
                  value: '10000.00',
                  currency: 'USD',
                  stage_name: 'New',
                  close_date: '2026-12-31',
                },
              },
            ],
          },
        });

        expect(res.statusCode).toBe(200);
      }
    });
  });

  describe('POST /api/v1/crm-deals/batches/execute-load Validation', () => {
    it('returns 400 Bad Request if records array is empty', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/batches/execute-load`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          batchId: 'batch-empty-records',
          records: [],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(Crm2ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.message).toContain('Invalid batch load input');
    });

    it('returns 400 Bad Request if sourceRow is zero or negative', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/batches/execute-load`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          batchId: 'batch-invalid-row',
          records: [
            { sourceRow: 0, idempotencyKey: 'k-0', data: {} },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 Bad Request if batchId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/batches/execute-load`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          records: [
            { sourceRow: 1, idempotencyKey: 'k-1', data: {} },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Batch Load Processing, Chunking & Stopping Behavior', () => {
    it('executes chunked load and returns 200 with BatchExecutionReport', async () => {
      const records = Array.from({ length: 60 }, (_, i) => ({
        sourceRow: i + 1,
        idempotencyKey: `idemp-deal-${i + 1}`,
        data: {
          entity: 'deal',
          name: `Synthetic Enterprise Deal ${i + 1}`,
          value: '15000.00',
          currency: 'USD',
          stage_name: 'Qualified',
          close_date: '2026-11-20',
        },
      }));

      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/batches/execute-load`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          batchId: 'batch-crm2-api-01',
          module: 'crm-2',
          chunkSize: 50,
          records,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Crm2BatchExecutionReportSchema.safeParse(body).success).toBe(true);
      expect(body.status).toBe('COMPLETED');
      expect(body.totalRecords).toBe(60);
      expect(body.committedRecords).toBe(60);
      expect(body.failedRecords).toBe(0);
      expect(body.chunksProcessed).toBe(2);

      // Verify deals are accessible via GET /deals
      const dealsRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?search=Synthetic+Enterprise+Deal+1`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });
      expect(dealsRes.statusCode).toBe(200);
      const dealsBody = JSON.parse(dealsRes.body);
      expect(dealsBody.items.length).toBeGreaterThanOrEqual(1);

      // Verify report is accessible via GET /batches/:batchId/report
      const reportRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/batches/batch-crm2-api-01/report`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });
      expect(reportRes.statusCode).toBe(200);
      const reportBody = JSON.parse(reportRes.body);
      expect(reportBody.batchId).toBe('batch-crm2-api-01');
      expect(reportBody.status).toBe('COMPLETED');
    });

    it('halts immediately when failure threshold exceeds 10% after 50 attempted rows', async () => {
      // 80 rows: rows 1 to 45 are valid deals; rows 46 to 60 have invalid negative values (15 failures out of 60 attempted = 25% > 10%)
      const records = Array.from({ length: 80 }, (_, i) => {
        const rowNum = i + 1;
        const isFailing = rowNum >= 46 && rowNum <= 60;
        return {
          sourceRow: rowNum,
          idempotencyKey: `idemp-halt-${rowNum}`,
          data: {
            entity: 'deal',
            name: `Deal ${rowNum}`,
            value: isFailing ? '-500.00' : '20000.00', // Invalid negative value causes domain validation rejection
            currency: 'USD',
            stage_name: 'New',
            close_date: '2026-12-01',
          },
        };
      });

      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/batches/execute-load`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          batchId: 'batch-crm2-halt-test',
          module: 'crm-2',
          chunkSize: 500,
          failureThreshold: 0.10,
          minAttemptedRows: 50,
          maxRetries: 0,
          records,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('STOPPED_EXCESSIVE_FAILURES');
      expect(body.attemptedRecords).toBeLessThan(80); // Execution stopped immediately!
      expect(body.haltReason).toContain('exceeds 10% threshold');
      expect(body.committedRecords).toBe(45);
      expect(body.committedReceipts).toHaveLength(45);

      // Verify receipts remained durable
      const receiptsRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/import/receipts`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });
      expect(receiptsRes.statusCode).toBe(200);
      const receiptsBody = JSON.parse(receiptsRes.body);
      expect(receiptsBody.items.length).toBeGreaterThanOrEqual(45);
    });

    it('returns 404 for unknown batchId on GET /batches/:batchId/report', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/batches/nonexistent-batch-uuid/report`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('NOT_FOUND');
    });

    it('supports POST /import/batch as an alias for /batches/execute-load', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import/batch`,
        headers: {
          authorization: `Bearer ${migrationToken}`,
        },
        payload: {
          batchId: 'batch-alias-test',
          records: [
            {
              sourceRow: 1,
              idempotencyKey: 'alias-key-01',
              data: {
                entity: 'deal',
                name: 'Alias Endpoint Deal',
                value: '45000.00',
                currency: 'USD',
                stage_name: 'Proposal',
                close_date: '2026-10-30',
              },
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('COMPLETED');
      expect(body.committedRecords).toBe(1);
    });
  });
});
