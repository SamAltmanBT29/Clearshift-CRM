import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { ControlCenterService } from '../../src/services/control-center.service.js';
import {
  MigrationRunSchema,
  QualityScoreSchema,
  MigrationRejectSchema,
  ReconciliationReportSchema,
  ErrorEnvelopeSchema,
} from '@clearshift/contracts';

describe('CRM-5 Mutation API & Domain Validation (Issue #48)', () => {
  let app: ReturnType<typeof buildApp>;
  let service: ControlCenterService;

  beforeEach(() => {
    service = new ControlCenterService();
    service.clear(); // start with clean slate
    app = buildApp({ service });
  });

  // ---------------------------------------------------------------------------
  // 1. POST /api/v1/crm-control/runs
  // ---------------------------------------------------------------------------
  describe('POST /api/v1/crm-control/runs', () => {
    it('creates a new migration run projection and returns 201 Created', async () => {
      const payload = {
        batchId: 'batch-test-001',
        module: 'crm-1',
        step: 'extract',
        status: 'running',
        recordsIn: 1000,
        recordsOut: 800,
        recordsRejected: 50,
        metadata: { sourceFile: 'contacts_v1.csv' },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/runs',
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      const parsed = MigrationRunSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body.batchId).toBe('batch-test-001');
      expect(body.module).toBe('crm-1');
      expect(body.step).toBe('extract');
      expect(body.status).toBe('running');
      expect(body.recordsIn).toBe(1000);
      expect(body.recordsOut).toBe(800);
      expect(body.recordsRejected).toBe(50);
      expect(body.metadata).toEqual({ sourceFile: 'contacts_v1.csv' });
    });

    it('returns 200 OK on idempotent duplicate run submission', async () => {
      const payload = {
        batchId: 'batch-idempotent-001',
        module: 'crm-2',
        step: 'clean',
        status: 'completed',
        recordsIn: 500,
        recordsOut: 450,
        recordsRejected: 50,
      };

      const firstResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/runs',
        payload,
      });
      expect(firstResponse.statusCode).toBe(201);

      // Re-send exact same payload
      const secondResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/runs',
        payload,
      });
      expect(secondResponse.statusCode).toBe(200);
      const body = JSON.parse(secondResponse.payload);
      expect(body.batchId).toBe('batch-idempotent-001');
    });

    it('returns 422 Unprocessable Entity when recordsOut + recordsRejected exceeds recordsIn', async () => {
      const payload = {
        batchId: 'batch-invalid-math',
        module: 'crm-3',
        step: 'load',
        status: 'running',
        recordsIn: 100,
        recordsOut: 90,
        recordsRejected: 20, // 90 + 20 = 110 > 100
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/runs',
        payload,
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.payload);
      expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
      expect(body.error.code).toBe('UNPROCESSABLE_ENTITY');
      expect(body.error.message).toContain('cannot exceed recordsIn');
    });

    it('returns 422 Unprocessable Entity when record counts are negative', async () => {
      const payload = {
        batchId: 'batch-negative-count',
        module: 'crm-1',
        step: 'map',
        status: 'pending',
        recordsIn: -10,
        recordsOut: 0,
        recordsRejected: 0,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/runs',
        payload,
      });

      expect(response.statusCode).toBe(400); // Caught at Zod boundary .nonnegative()
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('BAD_REQUEST');
      expect(body.error.message).toBe('Invalid run payload');
    });

    it('returns 409 Conflict when attempting to revert completed run to pending', async () => {
      const runPayload = {
        batchId: 'batch-conflict-001',
        module: 'crm-4',
        step: 'validate',
        status: 'completed',
        recordsIn: 200,
        recordsOut: 200,
        recordsRejected: 0,
      };

      await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/runs',
        payload: runPayload,
      });

      // Attempt to revert to pending
      const conflictPayload = {
        batchId: 'batch-conflict-001',
        module: 'crm-4',
        step: 'validate',
        status: 'pending',
        recordsIn: 200,
        recordsOut: 100,
        recordsRejected: 0,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/runs',
        payload: conflictPayload,
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain("Cannot revert run from terminal state 'completed'");
    });

    it('returns 400 Bad Request when required fields are missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/runs',
        payload: {
          batchId: '',
          module: 'invalid-module',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('BAD_REQUEST');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. POST /api/v1/crm-control/scores
  // ---------------------------------------------------------------------------
  describe('POST /api/v1/crm-control/scores', () => {
    it('calculates score correctly and returns 201 Created when all 5 dimensions provided', async () => {
      // completeness: 0.95, validity: 0.98, duplicateRate: 0.02, rejectRate: 0.05, linkIntegrity: 0.99
      // Expected: 100 * (0.95 + 0.98 + (1 - 0.02) + (1 - 0.05) + 0.99) / 5
      // = 100 * (0.95 + 0.98 + 0.98 + 0.95 + 0.99) / 5 = 100 * (4.85) / 5 = 97.0
      const payload = {
        batchId: 'batch-score-001',
        module: 'crm-1',
        completeness: 0.95,
        validity: 0.98,
        duplicateRate: 0.02,
        rejectRate: 0.05,
        linkIntegrity: 0.99,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/scores',
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(QualityScoreSchema.safeParse(body).success).toBe(true);
      expect(body.batchId).toBe('batch-score-001');
      expect(body.score).toBe(97.0);
      expect(body.isFullyScored).toBe(true);
    });

    it('returns score: null and isFullyScored: false when components are missing', async () => {
      const payload = {
        batchId: 'batch-partial-score',
        module: 'crm-2',
        completeness: 0.85,
        validity: 0.9,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/scores',
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.score).toBeNull();
      expect(body.isFullyScored).toBe(false);
    });

    it('returns 200 OK on idempotent duplicate score submission', async () => {
      const payload = {
        batchId: 'batch-score-dup',
        module: 'crm-3',
        completeness: 0.9,
        validity: 0.9,
        duplicateRate: 0.1,
        rejectRate: 0.1,
        linkIntegrity: 0.9,
      };

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/scores',
        payload,
      });
      expect(res1.statusCode).toBe(201);

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/scores',
        payload,
      });
      expect(res2.statusCode).toBe(200);
      const body = JSON.parse(res2.payload);
      expect(body.batchId).toBe('batch-score-dup');
    });

    it('returns 400 Bad Request when dimension exceeds 1.0', async () => {
      const payload = {
        batchId: 'batch-overflow-score',
        module: 'crm-1',
        completeness: 1.5, // invalid
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/scores',
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('BAD_REQUEST');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. POST /api/v1/crm-control/reconciliation
  // ---------------------------------------------------------------------------
  describe('POST /api/v1/crm-control/reconciliation', () => {
    it('creates report with status OK when 4-term conservation equation balances', async () => {
      // Source = Loaded (800) + Rejected (150) + Merged (40) + Skipped (10) = 1000
      const payload = {
        batchId: 'batch-recon-balanced',
        module: 'crm-1',
        sourceCount: 1000,
        loadedCount: 800,
        rejectedCount: 150,
        mergedCount: 40,
        skippedCount: 10,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/reconciliation',
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(ReconciliationReportSchema.safeParse(body).success).toBe(true);
      expect(body.batchId).toBe('batch-recon-balanced');
      expect(body.sourceCount).toBe(1000);
      expect(body.unaccountedCount).toBe(0);
      expect(body.status).toBe('OK');
    });

    it('creates report with status UNBALANCED and positive unaccountedCount when counts do not sum to source', async () => {
      // Source (1000) != Loaded (800) + Rejected (100) + Merged (0) + Skipped (0) = 900
      // Unaccounted = 1000 - 900 = 100
      const payload = {
        batchId: 'batch-recon-unbalanced',
        module: 'crm-2',
        sourceCount: 1000,
        loadedCount: 800,
        rejectedCount: 100,
        mergedCount: 0,
        skippedCount: 0,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/reconciliation',
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.unaccountedCount).toBe(100);
      expect(body.status).toBe('UNBALANCED');
    });

    it('returns 409 Conflict when attempting to modify existing reconciliation with different counts', async () => {
      const payload = {
        batchId: 'batch-recon-unique',
        module: 'crm-5',
        sourceCount: 500,
        loadedCount: 500,
        rejectedCount: 0,
        mergedCount: 0,
        skippedCount: 0,
      };

      await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/reconciliation',
        payload,
      });

      const conflictingPayload = {
        ...payload,
        loadedCount: 450,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/reconciliation',
        payload: conflictingPayload,
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('already exists and cannot be modified');
    });

    it('returns 200 OK on idempotent identical reconciliation submission', async () => {
      const payload = {
        batchId: 'batch-recon-idem',
        module: 'crm-1',
        sourceCount: 100,
        loadedCount: 100,
        rejectedCount: 0,
        mergedCount: 0,
        skippedCount: 0,
      };

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/reconciliation',
        payload,
      });
      expect(res1.statusCode).toBe(201);

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/reconciliation',
        payload,
      });
      expect(res2.statusCode).toBe(200);
    });

    it('returns 400 Bad Request when counts are negative', async () => {
      const payload = {
        batchId: 'batch-negative',
        module: 'crm-1',
        sourceCount: -50,
        loadedCount: 0,
        rejectedCount: 0,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/reconciliation',
        payload,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. POST /api/v1/crm-control/rejects (with Formula Injection Defense)
  // ---------------------------------------------------------------------------
  describe('POST /api/v1/crm-control/rejects', () => {
    it('creates rejection audit and sanitizes CSV formula injection characters', async () => {
      const payload = {
        batchId: 'batch-formula-inject',
        module: 'crm-1',
        rowIndex: 42,
        errorCode: 'INVALID_SYNTAX',
        errorMessage: '=cmd|"/C calc"!A0', // Dangerous spreadsheet formula
        rawPayloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/rejects',
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(MigrationRejectSchema.safeParse(body).success).toBe(true);
      expect(body.batchId).toBe('batch-formula-inject');
      expect(body.rowIndex).toBe(42);
      // Leading '=' must be prepended with a single quote
      expect(body.errorMessage).toBe('\'=cmd|"/C calc"!A0');
    });

    it('returns 200 OK on duplicate reject submission', async () => {
      const payload = {
        batchId: 'batch-reject-dup',
        module: 'crm-3',
        rowIndex: 10,
        errorCode: 'NULL_EMAIL',
        errorMessage: 'Email cannot be null',
        rawPayloadHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      };

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/rejects',
        payload,
      });
      expect(res1.statusCode).toBe(201);

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/rejects',
        payload,
      });
      expect(res2.statusCode).toBe(200);
    });

    it('returns 400 Bad Request when rowIndex is less than 1', async () => {
      const payload = {
        batchId: 'batch-invalid-row',
        module: 'crm-1',
        rowIndex: 0, // must be >= 1
        errorCode: 'TEST',
        errorMessage: 'test',
        rawPayloadHash: '12345678901234567890123456789012',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/rejects',
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('BAD_REQUEST');
    });
  });
});
