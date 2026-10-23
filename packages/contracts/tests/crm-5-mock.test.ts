import { describe, expect, it, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  Crm5MockStateStore,
  crm5MockServerPlugin,
} from '../src/crm-5-mock.js';
import { CRM5_API_PREFIX } from '../src/crm-5.js';

describe('CRM-5 Deterministic Mock Server Plugin (#187 / [CRM5-01])', () => {
  let app: FastifyInstance;
  let store: Crm5MockStateStore;

  beforeEach(async () => {
    store = new Crm5MockStateStore();
    app = Fastify({ logger: false });
    await app.register(crm5MockServerPlugin, {
      store,
      prefix: CRM5_API_PREFIX,
    });
    await app.ready();
  });

  describe('1. Health Check Endpoint', () => {
    it('returns healthy status on GET /health without authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM5_API_PREFIX}/health`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('healthy');
      expect(body.module).toBe('crm-5');
      expect(body.version).toBe('1.0.0');
      expect(body.mockServer).toBe(true);
      expect(body.entities.runs).toBe(store.runs.length);
      expect(body.entities.scores).toBe(store.scores.length);
    });
  });

  describe('2. Migration Runs API', () => {
    it('returns seeded mock runs with pagination on GET /runs', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM5_API_PREFIX}/runs?page=1&pageSize=2`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(2);
      expect(body.pagination.total).toBe(store.runs.length);
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.pageSize).toBe(2);
    });

    it('filters runs by module and status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM5_API_PREFIX}/runs?module=crm-1&status=completed`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      for (const run of body.data) {
        expect(run.module).toBe('crm-1');
        expect(run.status).toBe('completed');
      }
    });

    it('returns 400 with standard error envelope when pageSize exceeds 100', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM5_API_PREFIX}/runs?pageSize=150`,
      });
      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('BAD_REQUEST');
      expect(body.message).toContain('Invalid runs query parameters');
    });
  });

  describe('3. Quality Scores API', () => {
    it('returns scorecards and system average score on GET /scores', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM5_API_PREFIX}/scores`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(store.scores.length);
      expect(typeof body.averageScore).toBe('number');
      expect(body.averageScore).toBeGreaterThanOrEqual(0);
    });

    it('filters scores by module', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM5_API_PREFIX}/scores?module=crm-1`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].module).toBe('crm-1');
    });
  });

  describe('4. Rejection Inspection API', () => {
    it('returns paginated rejection audits on GET /rejects', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM5_API_PREFIX}/rejects`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.length).toBe(store.rejects.length);
      expect(body.data[0].rawPayloadHash).toBeDefined();
    });
  });

  describe('5. Reconciliation Balance Sheet API', () => {
    it('returns balanced reconciliation report on GET /reconciliation/:batch', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM5_API_PREFIX}/reconciliation/batch-contacts-v1-001`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.batchId).toBe('batch-contacts-v1-001');
      expect(body.status).toBe('OK');
      expect(body.unaccountedCount).toBe(0);
      expect(body.sourceCount).toBe(
        body.loadedCount + body.rejectedCount + body.mergedCount + body.skippedCount
      );
    });

    it('returns 404 with standard error envelope when reconciliation batch does not exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM5_API_PREFIX}/reconciliation/non-existent-batch-999`,
      });
      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.code).toBe('NOT_FOUND');
      expect(body.message).toContain('non-existent-batch-999');
    });
  });

  describe('6. Exact Duplicate Detection & Resolution Flow', () => {
    it('detects duplicate candidates deterministically on POST /duplicates/detect', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM5_API_PREFIX}/duplicates/detect`,
        payload: {
          batchId: 'batch-contacts-v1-001',
          module: 'crm-1',
          keyType: 'email',
          records: [
            { id: 'rec-1', keyValue: '  Sarah.Connor@Clearshift.Synthetic  ' },
            { id: 'rec-2', keyValue: 'sarah.connor@clearshift.synthetic' },
            { id: 'rec-3', keyValue: 'unique.person@clearshift.synthetic' },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.detectedCount).toBe(1);
      expect(body.candidates[0].normalizedKey).toBe('sarah.connor@clearshift.synthetic');
      expect(body.candidates[0].recordIds).toEqual(['rec-1', 'rec-2']);
      expect(body.candidates[0].status).toBe('held_for_review');
    });

    it('resolves duplicate candidate and records audit log on POST /duplicates/resolve', async () => {
      const heldCandidate = store.duplicates[0]!;

      const response = await app.inject({
        method: 'POST',
        url: `${CRM5_API_PREFIX}/duplicates/resolve`,
        payload: {
          candidateId: heldCandidate.id,
          decision: 'MERGE',
          actorId: 'operator-alice',
          keptId: heldCandidate.recordIds[0],
          mergedId: heldCandidate.recordIds[1],
          reason: 'Manual confirmation of exact match',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.candidate.status).toBe('resolved');

      // Verify audit log recorded
      const auditLog = store.auditLogs.find((a) => a.candidateId === heldCandidate.id);
      expect(auditLog).toBeDefined();
      expect(auditLog?.decision).toBe('MERGE');
      expect(auditLog?.actorId).toBe('operator-alice');
    });
  });

  describe('7. Batch Summary & Loader Receipt', () => {
    it('returns aggregated batch summary on GET /batches/:batch', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM5_API_PREFIX}/batches/batch-contacts-v1-001`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.batchId).toBe('batch-contacts-v1-001');
      expect(body.totals.totalRecordsIn).toBe(500);
      expect(body.score).toBeDefined();
      expect(body.reconciliation).toBeDefined();
    });

    it('creates idempotent import receipt on POST /import/row', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM5_API_PREFIX}/import/row`,
        payload: {
          batchId: 'batch-contacts-v1-001',
          sourceRow: 1,
          idempotencyKey: 'idemp-row-001',
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.batchId).toBe('batch-contacts-v1-001');
      expect(body.sourceRow).toBe(1);
      expect(body.idempotencyKey).toBe('idemp-row-001');
    });
  });
});
