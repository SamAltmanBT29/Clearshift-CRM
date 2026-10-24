import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Roles, signAccessToken } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { ControlCenterService } from '../../src/services/control-center.service.js';
import {
  PaginatedRunsResponseSchema,
  ScoresResponseSchema,
  PaginatedRejectsResponseSchema,
  ReconciliationReportSchema,
  MigrationRunSchema,
  BatchSummarySchema,
  DuplicateCandidateSchema,
  DuplicateAuditLogEntrySchema,
} from '@clearshift/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OPENAPI_FILE_PATH = path.resolve(__dirname, '../../../../../../packages/contracts/openapi/crm-5.yaml');

describe('CRM-5 OpenAPI Contract Conformance & Regression Suite (#202, [CRM5-29])', () => {
  let app: ReturnType<typeof buildApp>;
  let service: ControlCenterService;
  let adminToken: string;
  let viewerToken: string;
  let openapiYaml: string;

  beforeAll(async () => {
    service = new ControlCenterService();
    app = buildApp({ service });
    await app.ready();

    adminToken = await signAccessToken('admin-qa', [Roles.ADMIN, Roles.MIGRATION_RUNNER]);
    viewerToken = await signAccessToken('viewer-qa', [Roles.VIEWER]);
    openapiYaml = fs.readFileSync(OPENAPI_FILE_PATH, 'utf-8');
  });

  describe('1. OpenAPI Specification File Integrity', () => {
    it('locates and parses the canonical crm-5.yaml OpenAPI spec file', () => {
      expect(fs.existsSync(OPENAPI_FILE_PATH)).toBe(true);
      expect(openapiYaml).toContain('openapi: 3.1.0');
      expect(openapiYaml).toContain('CRM-5 Migration Control Center & Reports API');
      expect(openapiYaml).toContain('version: 1.0.0');
    });

    it('documents all required baseline and mutation endpoints in paths', () => {
      const requiredPaths = [
        '/health:',
        '/runs:',
        '/runs/{id}:',
        '/scores:',
        '/rejects:',
        '/reconciliation/{batch}:',
        '/reconciliation:',
        '/batches/{batch}:',
        '/duplicates/detect:',
        '/duplicates/held:',
        '/duplicates/resolve:',
        '/duplicates/audit:',
        '/import/row:',
        '/import/receipts:',
      ];

      for (const endpoint of requiredPaths) {
        expect(openapiYaml).toContain(endpoint);
      }
    });

    it('documents HTTP bearerAuth security scheme across all protected endpoints', () => {
      expect(openapiYaml).toContain('securitySchemes:');
      expect(openapiYaml).toContain('bearerAuth:');
      expect(openapiYaml).toContain('scheme: bearer');
      expect(openapiYaml).toContain('bearerFormat: JWT');
      expect(openapiYaml).toContain('- bearerAuth: []');
    });
  });

  describe('2. Endpoint Response Schema Conformance against Contracts', () => {
    it('GET /api/v1/crm-control/runs returns schema-compliant paginated runs', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/runs?page=1&pageSize=10',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const parsed = PaginatedRunsResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.page).toBe(1);
        expect(parsed.data.pageSize).toBe(10);
        expect(Array.isArray(parsed.data.items)).toBe(true);
      }
    });

    it('GET /api/v1/crm-control/runs/:id returns schema-compliant migration run entity', async () => {
      const runs = service.getRuns({ page: 1, pageSize: 5 });
      const targetRun = runs.items[0]!;

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-control/runs/${targetRun.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const parsed = MigrationRunSchema.safeParse(body);
      expect(parsed.success).toBe(true);
    });

    it('GET /api/v1/crm-control/scores returns schema-compliant quality scores', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/scores?page=1&pageSize=5',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const parsed = ScoresResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(Array.isArray(parsed.data.items)).toBe(true);
        expect(parsed.data.averageScore).toBeDefined();
      }
    });

    it('GET /api/v1/crm-control/rejects returns schema-compliant rejection audits', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/rejects?page=1&pageSize=5',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const parsed = PaginatedRejectsResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(Array.isArray(parsed.data.items)).toBe(true);
        expect(parsed.data.page).toBe(1);
      }
    });

    it('GET /api/v1/crm-control/reconciliation/:batch returns balanced reconciliation model', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/reconciliation/batch-contacts-01',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const parsed = ReconciliationReportSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.batchId).toBe('batch-contacts-01');
        expect(parsed.data.unaccountedCount).toBe(0);
        expect(parsed.data.status).toBe('OK');
      }
    });

    it('GET /api/v1/crm-control/batches/:batch returns schema-compliant batch summary', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/batches/batch-contacts-01',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const parsed = BatchSummarySchema.safeParse(body);
      expect(parsed.success).toBe(true);
    });

    it('GET /api/v1/crm-control/duplicates/held returns array of duplicate candidates', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/duplicates/held',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const list = Array.isArray(body) ? body : body.items;
      expect(Array.isArray(list)).toBe(true);
      for (const item of list) {
        expect(DuplicateCandidateSchema.safeParse(item).success).toBe(true);
      }
    });

    it('GET /api/v1/crm-control/health returns public health check model without authentication', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/health',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('ok');
      expect(body.module).toBe('crm-5');
      expect(body.version).toBe('1.0.0');
    });
  });

  describe('3. Standard Error Envelope Conformance (PLT-04 & CRM-5)', () => {
    it('returns 400 with standard error envelope when pageSize exceeds max bounded limit (100)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/runs?pageSize=101',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBeDefined();
      expect(['BAD_REQUEST', 'VALIDATION_ERROR']).toContain(body.error.code);
      const errorContent = JSON.stringify(body.error);
      expect(errorContent).toContain('pageSize');
    });

    it('returns 401 with standard error envelope when authorization token is omitted', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/runs',
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 with standard error envelope when viewer accesses analyst-restricted endpoint', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/scores',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 404 with standard error envelope when reconciliation batch does not exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/reconciliation/nonexistent-batch-999',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });
});
