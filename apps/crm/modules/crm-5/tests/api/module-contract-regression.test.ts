import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Roles, signAccessToken } from '@cs/identity';
import {
  BatchSummarySchema,
  PaginatedRejectsResponseSchema,
  PaginatedRunsResponseSchema,
  ReconciliationReportSchema,
  RunsQuerySchema,
  ScoresResponseSchema,
} from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import { ControlCenterService } from '../../src/services/control-center.service.js';

const BASE_PATH = '/api/v1/crm-control';

describe('CRM-5 module contract and regression suite (Issue #202)', () => {
  let service: ControlCenterService;
  let app: ReturnType<typeof buildApp>;
  let adminToken: string;

  beforeAll(async () => {
    adminToken = await signAccessToken('synthetic-admin', [Roles.ADMIN]);
  });

  beforeEach(async () => {
    service = new ControlCenterService();
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

  afterEach(async () => {
    await app.close();
  });

  it('creates synthetic run and reconciliation projections, then lists, filters, and reads their batch summary', async () => {
    const batchId = 'synthetic-crm5-contract-2026-01';
    const createRun = await app.inject({
      method: 'POST',
      url: `${BASE_PATH}/runs`,
      payload: {
        batchId,
        module: 'crm-2',
        step: 'load',
        status: 'completed',
        recordsIn: 8,
        recordsOut: 5,
        recordsRejected: 2,
      },
    });

    expect(createRun.statusCode).toBe(201);

    const createReport = await app.inject({
      method: 'POST',
      url: `${BASE_PATH}/reconciliation`,
      payload: {
        batchId,
        module: 'crm-2',
        sourceCount: 8,
        loadedCount: 5,
        rejectedCount: 2,
        mergedCount: 1,
        skippedCount: 0,
      },
    });

    expect(createReport.statusCode).toBe(201);
    expect(ReconciliationReportSchema.safeParse(JSON.parse(createReport.payload)).success).toBe(true);

    const filteredRuns = await app.inject({
      method: 'GET',
      url: `${BASE_PATH}/runs?batchId=${batchId}`,
    });
    expect(filteredRuns.statusCode).toBe(200);
    expect(RunsQuerySchema.safeParse({ batchId }).success).toBe(true);
    const runsBody = JSON.parse(filteredRuns.payload);
    expect(PaginatedRunsResponseSchema.safeParse(runsBody).success).toBe(true);
    expect(runsBody.total).toBe(1);
    expect(runsBody.items[0].batchId).toBe(batchId);

    const batchResponse = await app.inject({
      method: 'GET',
      url: `${BASE_PATH}/batches/${batchId}`,
    });
    expect(batchResponse.statusCode).toBe(200);
    const batchBody = JSON.parse(batchResponse.payload);
    expect(BatchSummarySchema.safeParse(batchBody).success).toBe(true);
    expect(batchBody.totals.totalRecordsIn).toBe(8);
    expect(batchBody.totals.totalRecordsOut).toBe(5);
    expect(batchBody.totals.totalRecordsRejected).toBe(2);
    expect(batchBody.reconciliation.unaccountedCount).toBe(0);

    const reconciliationResponse = await app.inject({
      method: 'GET',
      url: `${BASE_PATH}/reconciliation/${batchId}`,
    });
    expect(reconciliationResponse.statusCode).toBe(200);
    const reconciliationBody = JSON.parse(reconciliationResponse.payload);
    expect(ReconciliationReportSchema.safeParse(reconciliationBody).success).toBe(true);
    expect(reconciliationBody.status).toBe('OK');
    expect(reconciliationBody.sourceCount).toBe(
      reconciliationBody.loadedCount +
        reconciliationBody.rejectedCount +
        reconciliationBody.mergedCount +
        reconciliationBody.skippedCount +
        reconciliationBody.unaccountedCount,
    );
  });

  it('keeps all read endpoints stable across repeated reads', async () => {
    const readUrls = [
      `${BASE_PATH}/health`,
      `${BASE_PATH}/runs`,
      `${BASE_PATH}/scores`,
      `${BASE_PATH}/rejects`,
      `${BASE_PATH}/reconciliation/batch-contacts-01`,
      `${BASE_PATH}/batches/batch-contacts-01`,
      `${BASE_PATH}/duplicates/held`,
      `${BASE_PATH}/duplicates/audit`,
      `${BASE_PATH}/import/receipts`,
    ];

    const firstReads = await Promise.all(
      readUrls.map((url) => app.inject({ method: 'GET', url })),
    );
    const secondReads = await Promise.all(
      readUrls.map((url) => app.inject({ method: 'GET', url })),
    );

    for (let index = 0; index < readUrls.length; index += 1) {
      expect(firstReads[index]?.statusCode).toBe(200);
      expect(secondReads[index]?.statusCode).toBe(200);
      expect(secondReads[index]?.payload).toBe(firstReads[index]?.payload);
    }

    expect(PaginatedRunsResponseSchema.safeParse(JSON.parse(firstReads[1]!.payload)).success).toBe(true);
    expect(ScoresResponseSchema.safeParse(JSON.parse(firstReads[2]!.payload)).success).toBe(true);
    expect(PaginatedRejectsResponseSchema.safeParse(JSON.parse(firstReads[3]!.payload)).success).toBe(true);
    expect(ReconciliationReportSchema.safeParse(JSON.parse(firstReads[4]!.payload)).success).toBe(true);
    expect(BatchSummarySchema.safeParse(JSON.parse(firstReads[5]!.payload)).success).toBe(true);

    const runs = service.getRuns({ page: 1, pageSize: 100, limit: 100 });
    const scores = service.getScores({ page: 1, pageSize: 100, limit: 100 });
    const rejects = service.getRejects({ page: 1, pageSize: 100, limit: 100 });
    expect(runs.total).toBeGreaterThan(0);
    expect(scores.total).toBeGreaterThan(0);
    expect(rejects.total).toBeGreaterThan(0);
  });
});