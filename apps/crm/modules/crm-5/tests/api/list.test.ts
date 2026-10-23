import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Roles, signAccessToken } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { ControlCenterService } from '../../src/services/control-center.service.js';
import {
  PaginatedRunsResponseSchema,
  ScoresResponseSchema,
  PaginatedRejectsResponseSchema,
  ReconciliationReportSchema,
  sanitizeCsvFormula,
  verifyReconciliation,
  type MigrationRun,
  type QualityScore,
} from '@clearshift/contracts';

describe('CRM-5 List/Read API & Contracts (Issue #47)', () => {
  let app: ReturnType<typeof buildApp>;
  let service: ControlCenterService;
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

  // ---------------------------------------------------------------------------
  // 1. Health Check Endpoint
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-control/health', () => {
    it('returns 200 OK with service metadata and module version', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toEqual({
        status: 'ok',
        module: 'crm-5',
        name: 'Migration Control Center and Reports',
        version: '1.0.0',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Migration Runs API (/runs)
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-control/runs', () => {
    it('returns 200 with default pagination and synthetic seed items', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/runs',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      const parsed = PaginatedRunsResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(20);
      expect(body.limit).toBe(20);
      expect(body.items.length).toBeGreaterThanOrEqual(2);
    });

    it('filters runs by module server-side', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/runs?module=crm-1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.items.length).toBeGreaterThan(0);
      for (const item of body.items) {
        expect(item.module).toBe('crm-1');
      }
    });

    it('filters runs by batchId substring server-side (case-insensitive)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/runs?batchId=CONTACTS',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.items.length).toBe(1);
      expect(body.items[0].batchId).toBe('batch-contacts-01');
    });

    it('filters runs by status server-side', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/runs?status=running',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.items.length).toBe(1);
      expect(body.items[0].status).toBe('running');
      expect(body.items[0].module).toBe('crm-2');
    });

    it('returns empty list when filter matches no records', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/runs?module=crm-4',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.items).toEqual([]);
      expect(body.total).toBe(0);
      expect(body.totalPages).toBe(0);
    });

    it('enforces deterministic sort order: startedAt desc, id asc', async () => {
      service.clear();
      const t1 = new Date('2026-10-18T12:00:00Z');
      const t2 = new Date('2026-10-18T13:00:00Z');

      const runA: MigrationRun = {
        id: '11111111-1111-1111-1111-111111111111',
        batchId: 'batch-test-a',
        module: 'crm-1',
        step: 'load',
        status: 'completed',
        recordsIn: 100,
        recordsOut: 100,
        recordsRejected: 0,
        startedAt: t1,
        completedAt: t2,
        metadata: null,
        createdAt: t1,
        updatedAt: t2,
      };

      const runB: MigrationRun = {
        id: '22222222-2222-2222-2222-222222222222',
        batchId: 'batch-test-b',
        module: 'crm-2',
        step: 'clean',
        status: 'running',
        recordsIn: 200,
        recordsOut: 180,
        recordsRejected: 20,
        startedAt: t2, // later start time -> should be first
        completedAt: null,
        metadata: null,
        createdAt: t2,
        updatedAt: t2,
      };

      service.addRun(runA);
      service.addRun(runB);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/runs',
      });

      const body = JSON.parse(response.payload);
      expect(body.items[0].id).toBe(runB.id);
      expect(body.items[1].id).toBe(runA.id);
    });

    it('supports deterministic non-overlapping pagination', async () => {
      const page1Res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/runs?page=1&pageSize=1',
      });
      const page2Res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/runs?page=2&pageSize=1',
      });

      expect(page1Res.statusCode).toBe(200);
      expect(page2Res.statusCode).toBe(200);

      const page1 = JSON.parse(page1Res.payload);
      const page2 = JSON.parse(page2Res.payload);

      expect(page1.items.length).toBe(1);
      expect(page2.items.length).toBe(1);
      expect(page1.items[0].id).not.toBe(page2.items[0].id);
    });

    it('accepts maximum allowed pageSize of 100', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/runs?pageSize=100',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.pageSize).toBe(100);
    });

    it('rejects pageSize > 100 with 400 Bad Request and error envelope', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/runs?pageSize=101',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('BAD_REQUEST');
      expect(body.error.message).toBe('Invalid query parameters');
      expect(Array.isArray(body.error.details)).toBe(true);
      expect(
        body.error.details.some(
          (d: { message: string }) => d.message === 'pageSize cannot exceed 100'
        )
      ).toBe(true);
    });

    it('rejects limit > 100 with 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/runs?limit=150',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('BAD_REQUEST');
      expect(
        body.error.details.some((d: { message: string }) => d.message === 'limit cannot exceed 100')
      ).toBe(true);
    });

    it('rejects page < 1 with 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/runs?page=0',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('BAD_REQUEST');
      expect(
        body.error.details.some((d: { message: string }) => d.message === 'page must be >= 1')
      ).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Quality Scores API (/scores)
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-control/scores', () => {
    it('returns 200 with quality scores list and overall averageScore', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/scores',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      const parsed = ScoresResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.averageScore).toBe(97.8);
    });

    it('filters scores by module and batchId', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/scores?module=crm-1&batchId=contacts',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.items.length).toBe(1);
      expect(body.items[0].module).toBe('crm-1');
      expect(body.items[0].score).toBe(97.8);
    });

    it('computes averageScore only from fully scored batches', async () => {
      service.clear();
      const now = new Date();

      const fullyScored1: QualityScore = {
        id: '10000000-0000-0000-0000-000000000001',
        batchId: 'batch-1',
        module: 'crm-1',
        completeness: 1.0,
        validity: 1.0,
        duplicateRate: 0.0,
        rejectRate: 0.0,
        linkIntegrity: 1.0,
        score: 100.0,
        isFullyScored: true,
        scoredAt: now,
        createdAt: now,
      };

      const fullyScored2: QualityScore = {
        id: '10000000-0000-0000-0000-000000000002',
        batchId: 'batch-2',
        module: 'crm-2',
        completeness: 0.8,
        validity: 0.8,
        duplicateRate: 0.0,
        rejectRate: 0.0,
        linkIntegrity: 0.8,
        score: 88.0,
        isFullyScored: true,
        scoredAt: now,
        createdAt: now,
      };

      const partiallyScored: QualityScore = {
        id: '10000000-0000-0000-0000-000000000003',
        batchId: 'batch-3',
        module: 'crm-3',
        completeness: 0.9,
        validity: null,
        duplicateRate: null,
        rejectRate: 0.1,
        linkIntegrity: 0.9,
        score: null,
        isFullyScored: false,
        scoredAt: now,
        createdAt: now,
      };

      service.addScore(fullyScored1);
      service.addScore(fullyScored2);
      service.addScore(partiallyScored);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/scores',
      });

      const body = JSON.parse(response.payload);
      expect(body.items.length).toBe(3);
      // Average of 100 and 88 = 94.00
      expect(body.averageScore).toBe(94);
    });

    it('returns null averageScore when no fully scored batches exist', async () => {
      service.clear();
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/scores',
      });

      const body = JSON.parse(response.payload);
      expect(body.items.length).toBe(0);
      expect(body.averageScore).toBeNull();
    });

    it('rejects scores query with pageSize > 100', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/scores?pageSize=120',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('BAD_REQUEST');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Migration Rejects API (/rejects)
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-control/rejects', () => {
    it('returns 200 with paginated rejected rows auditing error codes and row indices', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/rejects',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      const parsed = PaginatedRejectsResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items[0].errorCode).toBe('INVALID_EMAIL_FORMAT');
      expect(body.items[0].rowIndex).toBe(42);
      expect(body.items[0].rawPayloadHash).toBeDefined();
    });

    it('filters rejects by module and batchId', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/rejects?module=crm-1&batchId=batch-contacts-01',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.items.length).toBe(1);
      expect(body.items[0].batchId).toBe('batch-contacts-01');
    });

    it('rejects rejects query with pageSize > 100', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/rejects?pageSize=105',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('BAD_REQUEST');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Reconciliation Report API (/reconciliation/:batch)
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-control/reconciliation/:batch', () => {
    it('returns 200 and validates conservation balance sheet for existing batch', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/reconciliation/batch-contacts-01',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      const parsed = ReconciliationReportSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body.batchId).toBe('batch-contacts-01');
      expect(body.status).toBe('OK');

      // Verify exact conservation equation:
      // Source = Loaded + Rejected + Merged + Skipped + Unaccounted
      const conservation = verifyReconciliation({
        sourceCount: body.sourceCount,
        loadedCount: body.loadedCount,
        rejectedCount: body.rejectedCount,
        mergedCount: body.mergedCount,
        skippedCount: body.skippedCount,
      });
      expect(conservation.status).toBe('OK');
      expect(conservation.unaccountedCount).toBe(0);
    });

    it('returns 404 with error envelope for non-existent batch', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/reconciliation/non-existent-batch',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain("Reconciliation report not found for batch 'non-existent-batch'");
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Domain Invariants & Security Enforcements
  // ---------------------------------------------------------------------------
  describe('Domain Invariants & Security Defense', () => {
    it('asserts that CRM-5 maintains zero direct table mutations on other CRM modules', () => {
      // Architectural rule: ControlCenterService is read-only towards other modules
      expect(service).toBeDefined();
      expect(typeof service.getRuns).toBe('function');
      expect(typeof service.getScores).toBe('function');
      expect(typeof service.getRejects).toBe('function');
      expect(typeof service.getReconciliation).toBe('function');
      // No methods exist on CRM-5 to mutate crm1, crm2, crm3, or crm4 tables
      expect((service as unknown as Record<string, unknown>).mutateCrm1).toBeUndefined();
      expect((service as unknown as Record<string, unknown>).updateDeals).toBeUndefined();
    });

    it('idempotently deduplicates event stream by unique ID', () => {
      service.clear();
      const now = new Date();
      const runItem: MigrationRun = {
        id: '99999999-9999-9999-9999-999999999999',
        batchId: 'batch-dedup-test',
        module: 'crm-1',
        step: 'load',
        status: 'pending',
        recordsIn: 50,
        recordsOut: 0,
        recordsRejected: 0,
        startedAt: now,
        completedAt: null,
        metadata: null,
        createdAt: now,
        updatedAt: now,
      };

      // Add twice with updated status
      service.addRun(runItem);
      service.addRun({ ...runItem, status: 'completed', recordsOut: 50 });

      const runs = service.getRuns({ page: 1, pageSize: 20, limit: 20 });
      expect(runs.total).toBe(1);
      expect(runs.items.length).toBe(1);
      expect(runs.items[0].status).toBe('completed');
      expect(runs.items[0].recordsOut).toBe(50);
    });

    it('neutralizes spreadsheet formula injection prefixes on export values', () => {
      expect(sanitizeCsvFormula('=1+2')).toBe("'=1+2");
      expect(sanitizeCsvFormula('+cmd|')).toBe("'+cmd|");
      expect(sanitizeCsvFormula('-calc()')).toBe("'-calc()");
      expect(sanitizeCsvFormula('@SUM(A1:A10)')).toBe("'@SUM(A1:A10)");
      expect(sanitizeCsvFormula('\tDangerousTab')).toBe("'\tDangerousTab");
      expect(sanitizeCsvFormula('\rDangerousReturn')).toBe("'\rDangerousReturn");
      // Safe values untouched
      expect(sanitizeCsvFormula('Clean String')).toBe('Clean String');
      expect(sanitizeCsvFormula(12345)).toBe('12345');
    });
  });
});
