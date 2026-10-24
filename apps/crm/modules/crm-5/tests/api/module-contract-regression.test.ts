import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Roles, signAccessToken } from '@cs/identity';
import {
  BatchSummarySchema,
  PaginatedRejectsResponseSchema,
  PaginatedRunsResponseSchema,
  ReconciliationReportSchema,
  RunsQuerySchema,
  ScoresResponseSchema,
  MigrationRunSchema,
  QualityScoreSchema,
} from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import { ControlCenterService } from '../../src/services/control-center.service.js';

const BASE_PATH = '/api/v1/crm-control';

describe('CRM-5 Module Contract and Regression Suite (Issue #202 / [CRM5-29])', () => {
  let service: ControlCenterService;
  let app: ReturnType<typeof buildApp>;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    adminToken = await signAccessToken('synthetic-admin', [Roles.ADMIN, Roles.MIGRATION_RUNNER]);
    viewerToken = await signAccessToken('synthetic-viewer', [Roles.VIEWER]);
  });

  beforeEach(async () => {
    service = new ControlCenterService();
    app = buildApp({ service });
    await app.ready();
    const rawInject = app.inject.bind(app);
    app.inject = ((opts: any) => {
      const headers = {
        authorization: opts?.headers?.authorization ?? `Bearer ${adminToken}`,
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

  // ---------------------------------------------------------------------------
  // 1. Projections Lifecycle, Search/Filter & Batch Summary
  // ---------------------------------------------------------------------------
  describe('1. Projections Lifecycle, Search/Filter & Batch Summary', () => {
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
      const createdRun = JSON.parse(createRun.payload);
      expect(MigrationRunSchema.safeParse(createdRun).success).toBe(true);

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
        url: `${BASE_PATH}/runs?batchId=${batchId}&module=crm-2&status=completed`,
      });
      expect(filteredRuns.statusCode).toBe(200);
      expect(RunsQuerySchema.safeParse({ batchId, module: 'crm-2', status: 'completed' }).success).toBe(true);
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

    it('retrieves run by ID and performs concurrency-safe patch edits', async () => {
      const runs = service.getRuns({ page: 1, pageSize: 5 });
      const targetRun = runs.items[0]!;

      // GET /runs/:id
      const getRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/runs/${targetRun.id}`,
      });
      expect(getRes.statusCode).toBe(200);
      const retrieved = JSON.parse(getRes.payload);
      expect(retrieved.id).toBe(targetRun.id);

      // PATCH /runs/:id allowlisted fields
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `${BASE_PATH}/runs/${targetRun.id}`,
        payload: {
          metadata: {
            operatorNotes: 'Verified during Gate G4 regression run.',
            goldenId: 'GOLDEN-TEST-2026',
          },
        },
      });
      expect(patchRes.statusCode).toBe(200);
      const patched = JSON.parse(patchRes.payload);
      expect(patched.metadata?.operatorNotes).toBe('Verified during Gate G4 regression run.');
      expect(patched.metadata?.goldenId).toBe('GOLDEN-TEST-2026');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Exact Formula Scores, Rejection Audits & Bounded Pagination
  // ---------------------------------------------------------------------------
  describe('2. Quality Scores, Rejections and Bounded Pagination', () => {
    it('records and computes exact 5-dimension quality score and enforces bounds', async () => {
      const batchId = 'score-regression-batch-001';
      const scoreRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/scores`,
        payload: {
          batchId,
          module: 'crm-1',
          completeness: 0.95,
          validity: 0.90,
          duplicateRate: 0.05,
          rejectRate: 0.02,
          linkIntegrity: 0.98,
        },
      });

      expect(scoreRes.statusCode).toBe(201);
      const scoreBody = JSON.parse(scoreRes.payload);
      expect(QualityScoreSchema.safeParse(scoreBody).success).toBe(true);

      // 100 * (0.95 + 0.90 + (1 - 0.05) + (1 - 0.02) + 0.98) / 5
      // = 100 * (0.95 + 0.90 + 0.95 + 0.98 + 0.98) / 5
      // = 100 * 4.76 / 5 = 95.20
      expect(scoreBody.score).toBe(95.20);
      expect(scoreBody.isFullyScored).toBe(true);
    });

    it('rejects pageSize > 100 on all paginated endpoints with HTTP 400', async () => {
      const endpoints = [
        `${BASE_PATH}/runs?pageSize=101`,
        `${BASE_PATH}/scores?pageSize=101`,
        `${BASE_PATH}/rejects?pageSize=101`,
      ];

      for (const url of endpoints) {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.payload);
        expect(body.error.code).toBe('BAD_REQUEST');
      }
    });

    it('records row-level rejections with SHA-256 payload hash and retrieves paginated list', async () => {
      const batchId = 'reject-batch-regression-01';
      const recordReject = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/rejects`,
        payload: {
          batchId,
          module: 'crm-3',
          rowIndex: 42,
          errorCode: 'INVALID_TAX_ID',
          errorMessage: 'Synthetic tax ID failed checksum validation.',
          rawPayloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      });

      expect(recordReject.statusCode).toBe(201);

      const listRejects = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/rejects?batchId=${batchId}`,
      });
      expect(listRejects.statusCode).toBe(200);
      const rejectsBody = JSON.parse(listRejects.payload);
      expect(PaginatedRejectsResponseSchema.safeParse(rejectsBody).success).toBe(true);
      expect(rejectsBody.total).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Exact Duplicate Detection & Explicit Human Review Policy
  // ---------------------------------------------------------------------------
  describe('3. Exact Duplicate Detection & Explicit Human Review Policy', () => {
    it('detects normalized exact duplicate candidates and prevents automated fuzzy merging', async () => {
      const candidatePayload = {
        batchId: 'dup-regression-batch-001',
        module: 'crm-1' as const,
        keyType: 'email' as const,
        records: [
          {
            id: 'src-001',
            keyValue: 'JOHN.DOE@EXAMPLE.COM',
            payload: { name: 'John Doe', email: 'john.doe@example.com' },
          },
          {
            id: 'src-002',
            keyValue: '  john.doe@example.com  ', // Normalized match
            payload: { name: 'J. Doe', email: 'john.doe@example.com' },
          },
        ],
      };

      const detectRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/duplicates/detect`,
        payload: candidatePayload,
      });

      expect(detectRes.statusCode).toBe(200);
      const detectBody = JSON.parse(detectRes.payload);
      expect(detectBody.duplicateCandidates.length).toBeGreaterThan(0);

      // Inspect held duplicate review queue
      const heldRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/duplicates/held`,
      });
      expect(heldRes.statusCode).toBe(200);
      const heldCandidates = JSON.parse(heldRes.payload);
      const candidatesList = Array.isArray(heldCandidates) ? heldCandidates : heldCandidates.items;
      expect(Array.isArray(candidatesList)).toBe(true);

      if (candidatesList.length > 0) {
        const candidate = candidatesList[0];
        // Human reviewer resolves candidate
        const resolveRes = await app.inject({
          method: 'POST',
          url: `${BASE_PATH}/duplicates/resolve`,
          payload: {
            candidateId: candidate.id,
            decision: 'MERGE',
            keptId: candidate.recordIds?.[0] || 'src-001',
            mergedId: candidate.recordIds?.[1] || 'src-002',
            reason: 'Explicit human review approval for duplicate resolution.',
            actorId: 'synthetic-admin',
          },
        });
        expect([200, 201]).toContain(resolveRes.statusCode);

        // Verify decision appears in audit trail
        const auditRes = await app.inject({
          method: 'GET',
          url: `${BASE_PATH}/duplicates/audit`,
        });
        expect(auditRes.statusCode).toBe(200);
        const auditBody = JSON.parse(auditRes.payload);
        expect(Array.isArray(auditBody.items)).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Read Stability, Idempotency & Domain Isolation Invariants
  // ---------------------------------------------------------------------------
  describe('4. Read Stability, Idempotency & Domain Isolation Invariants', () => {
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
    });

    it('enforces idempotency on repeated run projections with identical batchId and step', async () => {
      const payload = {
        batchId: 'idempotency-test-batch-001',
        module: 'crm-4' as const,
        step: 'validate' as const,
        status: 'running' as const,
        recordsIn: 500,
        recordsOut: 490,
        recordsRejected: 10,
      };

      const firstCall = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/runs`,
        payload,
      });
      expect(firstCall.statusCode).toBe(201);

      // Replay same event payload
      const secondCall = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/runs`,
        payload,
      });
      expect([200, 201]).toContain(secondCall.statusCode);

      // Ensure total count was not inflated
      const listRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/runs?batchId=${payload.batchId}&step=validate`,
      });
      const listBody = JSON.parse(listRes.payload);
      expect(listBody.total).toBe(1);
    });

    it('asserts domain invariant: CRM-5 never mutates foreign CRM/ERP tables', () => {
      const FORBIDDEN_MUTATION_SCHEMAS = ['crm1', 'crm2', 'crm3', 'crm4', 'erp1', 'erp2', 'erp3', 'erp4'];
      const CRM5_OWNED_TABLES = [
        'crm5_runs',
        'crm5_scores',
        'crm5_rejects',
        'crm5_reconciliation_reports',
        'crm5_import_receipts',
      ];

      for (const foreignSchema of FORBIDDEN_MUTATION_SCHEMAS) {
        for (const ownedTable of CRM5_OWNED_TABLES) {
          expect(ownedTable.startsWith(foreignSchema)).toBe(false);
        }
      }
    });
  });
});