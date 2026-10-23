import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Roles, signAccessToken } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { ControlCenterService } from '../../src/services/control-center.service.js';
import { BatchExecutionReportSchema, ErrorEnvelopeSchema } from '@clearshift/contracts';

describe('CRM-5 Batch Load Execution API (CRM5-13)', () => {
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

  describe('POST /api/v1/crm-control/batches/execute-load', () => {
    it('executes chunked load and returns 200 with BatchExecutionReport', async () => {
      const records = Array.from({ length: 100 }, (_, i) => ({
        sourceRow: i + 1,
        idempotencyKey: `idemp-key-${i + 1}`,
        data: { name: `Customer ${i + 1}` },
      }));

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/batches/execute-load',
        payload: {
          batchId: 'batch-api-load-01',
          module: 'crm-1',
          step: 'load',
          chunkSize: 50,
          records,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(BatchExecutionReportSchema.safeParse(body).success).toBe(true);
      expect(body.status).toBe('COMPLETED');
      expect(body.totalRecords).toBe(100);
      expect(body.committedRecords).toBe(100);
      expect(body.failedRecords).toBe(0);
      expect(body.chunksProcessed).toBe(2);

      // Verify run projection was recorded in service
      const runs = service.getRuns({ batchId: 'batch-api-load-01', page: 1, pageSize: 10 });
      expect(runs.items).toHaveLength(1);
      expect(runs.items[0]?.status).toBe('completed');
      expect(runs.items[0]?.recordsIn).toBe(100);
      expect(runs.items[0]?.recordsOut).toBe(100);
    });

    it('returns 400 Bad Request if records array is empty', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/batches/execute-load',
        payload: {
          batchId: 'batch-bad-input',
          module: 'crm-1',
          records: [],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
      expect(body.error.code).toBe('BAD_REQUEST');
    });

    it('returns 400 Bad Request if sourceRow is missing or non-positive', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/batches/execute-load',
        payload: {
          batchId: 'batch-invalid-row',
          module: 'crm-1',
          records: [
            { sourceRow: 0, idempotencyKey: 'k1', data: {} },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('BAD_REQUEST');
    });
  });
});
