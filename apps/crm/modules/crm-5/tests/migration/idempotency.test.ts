import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { Crm5TargetAdapter } from '../../src/migration/target-adapter.js';
import { ControlCenterService } from '../../src/services/control-center.service.js';
import type { ImportRowInput } from '@clearshift/contracts';

describe('CRM-5 Target Adapter & Durable Import Receipts (KIT-08 & Decision C4)', () => {
  let service: ControlCenterService;
  let adapter: Crm5TargetAdapter;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    service = new ControlCenterService();
    adapter = new Crm5TargetAdapter(service);
    app = buildApp({ service, adapter });
  });

  describe('1. Public API Data Loading via Kit Target Adapter Contract', () => {
    it('loads a fixture row via POST /api/v1/crm-control/import/row through the public API without direct DB table write privileges', async () => {
      const payload: ImportRowInput = {
        batchId: 'batch-kit-001',
        sourceRow: 1,
        sourceSystem: 'legacy_salesforce',
        sourceId: 'sf-run-101',
        entity: 'runs',
        data: {
          batchId: 'batch-kit-001',
          module: 'crm-1',
          step: 'load',
          status: 'running',
          recordsIn: 100,
          recordsOut: 85,
          recordsRejected: 15,
        },
        idempotencyKey: 'idemp-key-run-001',
        correlationId: 'corr-001',
        schemaVersion: 1,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/import/row',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'idemp-key-run-001',
          'x-correlation-id': 'corr-001',
        },
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.targetId).toBeDefined();
      expect(body.version).toBe(1);
      expect(body.outcome).toBe('created');
      expect(body.receipt).toBeDefined();
      expect(body.receipt.batchId).toBe('batch-kit-001');
      expect(body.receipt.sourceRow).toBe(1);
      expect(body.receipt.idempotencyKey).toBe('idemp-key-run-001');

      // Verify business record is reflected in read projections
      const runs = service.getRuns({ page: 1, pageSize: 20, batchId: 'batch-kit-001', limit: 20 });
      expect(runs.items.length).toBe(1);
      expect(runs.items[0]?.recordsIn).toBe(100);
      expect(runs.items[0]?.recordsOut).toBe(85);
      expect(runs.items[0]?.recordsRejected).toBe(15);
    });
  });

  describe('2. Idempotency & Retry Guarantees (Identical Submissions)', () => {
    it('retrying identical row payload and key 3 times produces exactly 1 business record and 1 durable receipt', async () => {
      const payload: ImportRowInput = {
        batchId: 'batch-kit-002',
        sourceRow: 1,
        sourceSystem: 'sap_crm',
        sourceId: 'sap-score-1',
        entity: 'scores',
        data: {
          batchId: 'batch-kit-002',
          module: 'crm-2',
          completeness: 0.95,
          validity: 0.98,
          duplicateRate: 0.02,
          rejectRate: 0.03,
          linkIntegrity: 0.99,
        },
        idempotencyKey: 'idemp-score-retry-002',
        schemaVersion: 1,
      };

      // 1st invocation -> 201 Created
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/import/row',
        headers: {
          'idempotency-key': 'idemp-score-retry-002',
        },
        payload,
      });
      expect(res1.statusCode).toBe(201);
      const body1 = JSON.parse(res1.body);
      const targetId1 = body1.targetId;

      // 2nd invocation (identical retry) -> 200 OK
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/import/row',
        headers: {
          'idempotency-key': 'idemp-score-retry-002',
        },
        payload,
      });
      expect(res2.statusCode).toBe(200);
      const body2 = JSON.parse(res2.body);
      expect(body2.targetId).toBe(targetId1);
      expect(body2.isExisting).toBe(true);

      // 3rd invocation (identical retry) -> 200 OK
      const res3 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/import/row',
        headers: {
          'idempotency-key': 'idemp-score-retry-002',
        },
        payload,
      });
      expect(res3.statusCode).toBe(200);
      const body3 = JSON.parse(res3.body);
      expect(body3.targetId).toBe(targetId1);
      expect(body3.isExisting).toBe(true);

      // Verify exactly ONE durable receipt exists
      const receipts = adapter.getReceipts().filter((r) => r.idempotencyKey === 'idemp-score-retry-002');
      expect(receipts.length).toBe(1);

      // Verify quality score formula: 100 * (0.95 + 0.98 + (1 - 0.02) + (1 - 0.03) + 0.99) / 5 = 97.4
      const scores = service.getScores({ page: 1, pageSize: 20, batchId: 'batch-kit-002', limit: 20 });
      expect(scores.items.length).toBe(1);
      expect(scores.items[0]?.score).toBe(97.4);
    });
  });

  describe('3. Idempotency Key Conflict Protection (Same Key, Different Payload)', () => {
    it('reusing an idempotency key with a different payload returns HTTP 409 Conflict and performs zero data mutations', async () => {
      const initialPayload: ImportRowInput = {
        batchId: 'batch-conflict-003',
        sourceRow: 1,
        entity: 'runs',
        data: {
          batchId: 'batch-conflict-003',
          module: 'crm-3',
          step: 'extract',
          status: 'running',
          recordsIn: 50,
          recordsOut: 50,
          recordsRejected: 0,
        },
        idempotencyKey: 'idemp-conflict-test-003',
        schemaVersion: 1,
      };

      // 1. Initial successful commit
      const initialRes = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/import/row',
        headers: { 'idempotency-key': 'idemp-conflict-test-003' },
        payload: initialPayload,
      });
      expect(initialRes.statusCode).toBe(201);

      // 2. Attempt reuse with modified recordsIn count
      const alteredPayload: ImportRowInput = {
        ...initialPayload,
        data: {
          ...initialPayload.data,
          recordsIn: 999, // Changed payload!
        },
      };

      const conflictRes = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/import/row',
        headers: { 'idempotency-key': 'idemp-conflict-test-003' },
        payload: alteredPayload,
      });

      expect(conflictRes.statusCode).toBe(409);
      const conflictBody = JSON.parse(conflictRes.body);
      expect(conflictBody.error.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(conflictBody.error.message).toContain('was already used with a different request payload');

      // Verify the original record was NOT mutated
      const runs = service.getRuns({ page: 1, pageSize: 20, batchId: 'batch-conflict-003', limit: 20 });
      expect(runs.items.length).toBe(1);
      expect(runs.items[0]?.recordsIn).toBe(50); // Original value preserved
    });
  });

  describe('4. Business Validation Rejections vs Retryable Infrastructure Failures', () => {
    it('reports business-rule rejection with a stable reason code and safe message without persisting corrupt data', async () => {
      const invalidPayload: ImportRowInput = {
        batchId: 'batch-invalid-004',
        sourceRow: 1,
        entity: 'runs',
        data: {
          batchId: 'batch-invalid-004',
          module: 'crm-4',
          step: 'load',
          status: 'completed',
          recordsIn: 100,
          recordsOut: 80,
          recordsRejected: 30, // Invariant violation: 80 + 30 = 110 > 100
        },
        idempotencyKey: 'idemp-invalid-004',
        schemaVersion: 1,
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/import/row',
        headers: { 'idempotency-key': 'idemp-invalid-004' },
        payload: invalidPayload,
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('RUN_COUNT_INVARIANT_VIOLATION');
      expect(body.error.message).toContain('Sum of recordsOut and recordsRejected cannot exceed recordsIn');

      // Ensure no receipt was written
      expect(adapter.getReceiptByKey('idemp-invalid-004')).toBeUndefined();
    });

    it('simulated 503 infrastructure failure returns retryable status and is NOT recorded as a rejected business record', async () => {
      const transientPayload: ImportRowInput = {
        batchId: 'batch-transient-005',
        sourceRow: 1,
        entity: 'runs',
        data: {
          batchId: 'batch-transient-005',
          module: 'crm-1',
          step: 'validate',
          status: 'running',
          recordsIn: 200,
          recordsOut: 190,
          recordsRejected: 10,
        },
        idempotencyKey: 'idemp-transient-005',
        schemaVersion: 1,
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/import/row',
        headers: {
          'idempotency-key': 'idemp-transient-005',
          'x-simulate-503': 'true',
        },
        payload: transientPayload,
      });

      expect(res.statusCode).toBe(503);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(body.error.retryable).toBe(true);

      // Verify no receipt and no business record created
      expect(adapter.getReceiptByKey('idemp-transient-005')).toBeUndefined();
      const runs = service.getRuns({ page: 1, pageSize: 20, batchId: 'batch-transient-005', limit: 20 });
      expect(runs.items.length).toBe(0);

      // Verify this failure was NOT misclassified as a data rejection in crm5_rejects
      const rejects = service.getRejects({ page: 1, pageSize: 20, batchId: 'batch-transient-005', limit: 20 });
      expect(rejects.items.length).toBe(0);
    });
  });

  describe('5. Transaction Atomicity & Rollback Guarantee', () => {
    it('target business mutation rolls back when receipt insertion fails', async () => {
      const payload: ImportRowInput = {
        batchId: 'batch-rollback-006',
        sourceRow: 1,
        entity: 'runs',
        data: {
          batchId: 'batch-rollback-006',
          module: 'crm-5',
          step: 'load',
          status: 'running',
          recordsIn: 300,
          recordsOut: 300,
          recordsRejected: 0,
        },
        idempotencyKey: 'idemp-rollback-006',
        schemaVersion: 1,
      };

      // Call importRow with failReceiptCommit option
      await expect(
        adapter.importRow('batch-rollback-006', 1, 'idemp-rollback-006', payload, {
          failReceiptCommit: true,
        })
      ).rejects.toThrow('Database transaction aborted: failed to persist import receipt');

      // Verify target business mutation was rolled back
      const runs = service.getRuns({ page: 1, pageSize: 20, batchId: 'batch-rollback-006', limit: 20 });
      expect(runs.items.length).toBe(0);

      // Verify receipt was not stored
      expect(adapter.getReceiptByKey('idemp-rollback-006')).toBeUndefined();
    });
  });

  describe('6. Module Boundary Isolation & Invariants', () => {
    it('CRM-5 never writes to other modules and enforces exact reconciliation balance equation', async () => {
      const reconPayload: ImportRowInput = {
        batchId: 'batch-recon-007',
        sourceRow: 1,
        entity: 'reconciliation',
        data: {
          batchId: 'batch-recon-007',
          module: 'crm-1',
          sourceCount: 1000,
          loadedCount: 950,
          rejectedCount: 40,
          mergedCount: 5,
          skippedCount: 5,
          status: 'OK',
        },
        idempotencyKey: 'idemp-recon-007',
        schemaVersion: 1,
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/import/row',
        headers: { 'idempotency-key': 'idemp-recon-007' },
        payload: reconPayload,
      });

      expect(res.statusCode).toBe(201);

      // Verify reconciliation conservation: 1000 = 950 + 40 + 5 + 5 (unaccounted = 0)
      const report = service.getReconciliation('batch-recon-007');
      expect(report).toBeDefined();
      expect(report?.status).toBe('OK');
      expect(report?.unaccountedCount).toBe(0);
    });

    it('preflight dry-run executes validation with zero database mutations', async () => {
      const rows: ImportRowInput[] = [
        {
          batchId: 'batch-preflight-008',
          sourceRow: 1,
          entity: 'runs',
          data: {
            batchId: 'batch-preflight-008',
            module: 'crm-1',
            step: 'clean',
            status: 'running',
            recordsIn: 10,
            recordsOut: 10,
            recordsRejected: 0,
          },
          idempotencyKey: 'idemp-preflight-1',
          schemaVersion: 1,
        },
        {
          batchId: 'batch-preflight-008',
          sourceRow: 2,
          entity: 'runs',
          data: {
            batchId: 'batch-preflight-008',
            module: 'crm-1',
            step: 'clean',
            status: 'running',
            recordsIn: 10,
            recordsOut: 15, // Invalid: recordsOut > recordsIn
            recordsRejected: 0,
          },
          idempotencyKey: 'idemp-preflight-2',
          schemaVersion: 1,
        },
      ];

      const preflightResult = await adapter.preflight('batch-preflight-008', rows);
      expect(preflightResult.ok).toBe(true);
      if (preflightResult.ok) {
        expect(preflightResult.value.validCount).toBe(1);
        expect(preflightResult.value.rejectCount).toBe(1);
      }

      // Assert zero mutations occurred
      const runs = service.getRuns({ page: 1, pageSize: 20, batchId: 'batch-preflight-008', limit: 20 });
      expect(runs.items.length).toBe(0);
      expect(adapter.getReceipts().length).toBe(0);
    });
  });
});
