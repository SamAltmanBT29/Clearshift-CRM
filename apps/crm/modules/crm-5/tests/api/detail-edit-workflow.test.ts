import { describe, it, expect, beforeEach } from 'vitest';
import fastify from 'fastify';
import { ControlCenterService } from '../../src/services/control-center.service.js';
import { controlCenterRoutes } from '../../src/routes/control-center.routes.js';
import { DomainConflictError } from '../../src/domain/errors.js';

describe('CRM-5 Detail/Edit Workflow & Concurrency Control (Issue #194 / CRM5-21)', () => {
  let service: ControlCenterService;
  let app: ReturnType<typeof fastify>;

  beforeEach(async () => {
    service = new ControlCenterService();
    app = fastify();
    await app.register(controlCenterRoutes, { service, authEnabled: false });
    await app.ready();
  });

  describe('1. GET /api/v1/crm-control/runs/:id', () => {
    it('returns 200 with migration run details for existing run', async () => {
      const runs = service.getRuns({ page: 1, pageSize: 5 });
      expect(runs.items.length).toBeGreaterThan(0);
      const targetRun = runs.items[0]!;

      const res = await app.inject({
        method: 'GET',
        url: `/runs/${targetRun.id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(targetRun.id);
      expect(body.batchId).toBe(targetRun.batchId);
      expect(body.module).toBe(targetRun.module);
      expect(body.step).toBe(targetRun.step);
      expect(body.status).toBe(targetRun.status);
      expect(body.recordsIn).toBe(targetRun.recordsIn);
      expect(body.recordsOut).toBe(targetRun.recordsOut);
      expect(body.recordsRejected).toBe(targetRun.recordsRejected);
    });

    it('returns 404 NOT_FOUND for non-existent run ID', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000099';
      const res = await app.inject({
        method: 'GET',
        url: `/runs/${nonExistentId}`,
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('could not be located');
    });
  });

  describe('2. PATCH /api/v1/crm-control/runs/:id — Allowlisted Edits & Concurrency Control', () => {
    it('updates allowlisted fields (status, records, notes) and returns 200', async () => {
      // Find a running or pending run
      const runs = service.getRuns({ page: 1, pageSize: 50 });
      const targetRun = runs.items.find((r) => r.status === 'running' || r.status === 'pending') ?? runs.items[0]!;

      const updatePayload = {
        recordsIn: 1500,
        recordsOut: 1450,
        recordsRejected: 50,
        expectedUpdatedAt: targetRun.updatedAt.toISOString(),
        metadata: {
          operatorNotes: 'Manual reconciliation adjustments verified by operator.',
          goldenId: 'GOLDEN-RUN-999',
        },
      };

      const res = await app.inject({
        method: 'PATCH',
        url: `/runs/${targetRun.id}`,
        payload: updatePayload,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(targetRun.id);
      expect(body.recordsIn).toBe(1500);
      expect(body.recordsOut).toBe(1450);
      expect(body.recordsRejected).toBe(50);
      expect(body.metadata.operatorNotes).toBe('Manual reconciliation adjustments verified by operator.');
      expect(body.metadata.goldenId).toBe('GOLDEN-RUN-999');

      // Verify persistence in service
      const refreshed = service.getRunById(targetRun.id);
      expect(refreshed?.recordsIn).toBe(1500);
      expect(refreshed?.metadata?.['goldenId']).toBe('GOLDEN-RUN-999');
    });

    it('returns 409 CONCURRENT_MODIFICATION when submitted expectedUpdatedAt is stale', async () => {
      const runs = service.getRuns({ page: 1, pageSize: 10 });
      const targetRun = runs.items[0]!;

      // Simulate a concurrent modification: client loaded at targetRun.updatedAt - 60s, but server is at targetRun.updatedAt
      const staleTimestamp = new Date(targetRun.updatedAt.getTime() - 60000).toISOString();

      const res = await app.inject({
        method: 'PATCH',
        url: `/runs/${targetRun.id}`,
        payload: {
          recordsIn: 2000,
          expectedUpdatedAt: staleTimestamp,
        },
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.error.code).toBe('CONCURRENT_MODIFICATION');
      expect(body.error.message).toContain('Concurrent modification detected');
      expect(body.error.details.currentUpdatedAt).toBeDefined();
    });

    it('returns 400 BAD_REQUEST on invalid state transition (reverting completed run)', async () => {
      // Find a completed run
      const runs = service.getRuns({ page: 1, pageSize: 50 });
      const completedRun = runs.items.find((r) => r.status === 'completed');
      expect(completedRun).toBeDefined();

      const res = await app.inject({
        method: 'PATCH',
        url: `/runs/${completedRun!.id}`,
        payload: {
          status: 'pending', // Reverting terminal state is illegal
          expectedUpdatedAt: completedRun!.updatedAt.toISOString(),
        },
      });

      expect(res.statusCode).toBe(409); // IllegalStateTransitionError inherits DomainConflictError (409)
      const body = res.json();
      expect(body.error.message).toContain('Cannot revert run from terminal state');
    });

    it('returns 400 BAD_REQUEST on negative record counts', async () => {
      const runs = service.getRuns({ page: 1, pageSize: 5 });
      const targetRun = runs.items[0]!;

      const res = await app.inject({
        method: 'PATCH',
        url: `/runs/${targetRun.id}`,
        payload: {
          recordsIn: -10,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe('BAD_REQUEST');
      expect(body.error.message).toContain('Validation failed');
    });

    it('returns 404 NOT_FOUND when updating non-existent run ID', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000099';
      const res = await app.inject({
        method: 'PATCH',
        url: `/runs/${nonExistentId}`,
        payload: {
          recordsIn: 100,
        },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('3. Service Unit Methods: getRunById and updateRun', () => {
    it('getRunById returns cloned copy preventing direct mutation', () => {
      const runs = service.getRuns({ page: 1, pageSize: 5 });
      const targetRun = runs.items[0]!;

      const retrieved = service.getRunById(targetRun.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(targetRun.id);

      // Mutating retrieved object should not corrupt service internal store
      if (retrieved) {
        retrieved.recordsIn = 999999;
      }
      const verified = service.getRunById(targetRun.id);
      expect(verified?.recordsIn).not.toBe(999999);
    });

    it('updateRun throws DomainConflictError on stale expectedUpdatedAt', () => {
      const runs = service.getRuns({ page: 1, pageSize: 5 });
      const targetRun = runs.items[0]!;

      const staleTime = new Date(targetRun.updatedAt.getTime() - 3600000);
      expect(() => {
        service.updateRun(targetRun.id, {
          recordsOut: 500,
          expectedUpdatedAt: staleTime,
        });
      }).toThrowError(DomainConflictError);
    });
  });
});
