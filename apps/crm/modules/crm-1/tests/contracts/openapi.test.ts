import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Roles, signAccessToken } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { Crm1Service } from '../../src/services/crm1.service.js';
import {
  PaginatedContactsResponseSchema,
  ContactSchema,
  PaginatedCompaniesResponseSchema,
  CompanySchema,
  PaginatedLeadsResponseSchema,
  LeadSchema,
  Crm1ImportRunSchema,
  Crm1BatchExecutionReportSchema,
} from '@clearshift/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OPENAPI_FILE_PATH = path.resolve(__dirname, '../../../../../../packages/contracts/openapi/crm-1.yaml');

describe('CRM-1 OpenAPI Contract Conformance Suite (Issue #122 / [CRM1-29])', () => {
  let app: ReturnType<typeof buildApp>;
  let service: Crm1Service;
  let adminToken: string;
  let viewerToken: string;
  let openapiYaml: string;

  beforeAll(async () => {
    service = new Crm1Service({ inMemory: true });
    await service.seedSyntheticData();
    app = buildApp({ service });
    await app.ready();

    adminToken = await signAccessToken('contract-admin', [Roles.ADMIN, Roles.MIGRATION_RUNNER]);
    viewerToken = await signAccessToken('contract-viewer', [Roles.VIEWER]);
    openapiYaml = fs.readFileSync(OPENAPI_FILE_PATH, 'utf-8');
  });

  describe('1. OpenAPI 3.1.0 Specification Integrity', () => {
    it('verifies canonical crm-1.yaml exists and declares version 3.1.0', () => {
      expect(fs.existsSync(OPENAPI_FILE_PATH)).toBe(true);
      expect(openapiYaml).toContain('openapi: 3.1.0');
      expect(openapiYaml).toContain('ClearShift CRM-1 Contacts, Companies and Leads API');
      expect(openapiYaml).toContain('version: 1.0.0');
    });

    it('declares the standard bearerAuth security scheme', () => {
      expect(openapiYaml).toContain('bearerAuth:');
      expect(openapiYaml).toContain('type: http');
      expect(openapiYaml).toContain('scheme: bearer');
      expect(openapiYaml).toContain('bearerFormat: JWT');
    });

    it('documents all baseline SDS endpoints in paths', () => {
      const requiredEndpoints = [
        '/api/v1/crm-contacts/contacts:',
        '/api/v1/crm-contacts/contacts/{id}:',
        '/api/v1/crm-contacts/companies:',
        '/api/v1/crm-contacts/companies/{id}:',
        '/api/v1/crm-contacts/leads:',
        '/api/v1/crm-contacts/leads/{id}:',
        '/api/v1/crm-contacts/imports:',
        '/api/v1/crm-contacts/imports/{batch}:',
        '/api/v1/crm-contacts/imports/{batch}/rejects:',
        '/api/v1/crm-contacts/import/row:',
        '/api/v1/crm-contacts/import/receipts:',
        '/api/v1/crm-contacts/batches/execute-load:',
        '/api/v1/crm-contacts/batches/{batchId}/report:',
        '/api/v1/crm-contacts/duplicates/detect:',
        '/api/v1/crm-contacts/duplicates/held:',
        '/api/v1/crm-contacts/duplicates/resolve:',
        '/api/v1/crm-contacts/duplicates/audit:',
      ];

      for (const endpoint of requiredEndpoints) {
        expect(openapiYaml).toContain(endpoint);
      }
    });

    it('documents standard ClearShift error responses (400, 401, 403, 404, 409, 422)', () => {
      expect(openapiYaml).toContain('ValidationError:');
      expect(openapiYaml).toContain('UnauthorizedError:');
      expect(openapiYaml).toContain('ForbiddenError:');
      expect(openapiYaml).toContain('NotFoundError:');
      expect(openapiYaml).toContain('ConflictError:');
    });
  });

  describe('2. Response Payload Conformance with Zod Contracts', () => {
    it('matches GET /contacts response against PaginatedContactsResponseSchema', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts?page=1&pageSize=10',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const parsed = PaginatedContactsResponseSchema.safeParse(res.json());
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.page).toBe(1);
        expect(parsed.data.pageSize).toBe(10);
        expect(parsed.data.items.length).toBe(10);
        expect(parsed.data.total).toBe(32);
      }
    });

    it('matches GET /contacts/:id response against ContactSchema', async () => {
      const contactId = '00000000-0000-4000-8000-010000000000';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-contacts/contacts/${contactId}`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const parsed = ContactSchema.safeParse(res.json());
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.id).toBe(contactId);
        expect(parsed.data.firstName).toBe('Alice');
        expect(parsed.data.lastName).toBe('Anderson');
      }
    });

    it('matches GET /companies response against PaginatedCompaniesResponseSchema', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/companies?page=1&pageSize=10',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const parsed = PaginatedCompaniesResponseSchema.safeParse(res.json());
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.page).toBe(1);
        expect(parsed.data.items.length).toBe(4);
        expect(parsed.data.total).toBe(4);
      }
    });

    it('matches GET /companies/:id response against CompanySchema', async () => {
      const companyId = '11111111-1111-4111-8111-111111111111';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-contacts/companies/${companyId}`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const parsed = CompanySchema.safeParse(res.json());
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.id).toBe(companyId);
        expect(parsed.data.name).toBe('Acme Corporation');
      }
    });

    it('matches GET /leads response against PaginatedLeadsResponseSchema', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/leads?page=1&pageSize=10',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const parsed = PaginatedLeadsResponseSchema.safeParse(res.json());
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.page).toBe(1);
        expect(parsed.data.items.length).toBe(4);
        expect(parsed.data.total).toBe(4);
      }
    });

    it('matches GET /leads/:id response against LeadSchema', async () => {
      const leadId = '90000000-0000-4000-8000-000000000001';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-contacts/leads/${leadId}`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const parsed = LeadSchema.safeParse(res.json());
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.id).toBe(leadId);
        expect(parsed.data.status).toBe('Working');
      }
    });

    it('matches GET /imports/:batch response against Crm1ImportRunSchema', async () => {
      const batchId = 'batch-contacts-01';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-contacts/imports/${batchId}`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const parsed = Crm1ImportRunSchema.safeParse(res.json());
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.batchId).toBe(batchId);
        expect(parsed.data.status).toBe('completed');
      }
    });

    it('matches GET /batches/:batchId/report response against Crm1BatchExecutionReportSchema', async () => {
      const batchId = 'batch-contacts-01';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-contacts/batches/${batchId}/report`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const parsed = Crm1BatchExecutionReportSchema.safeParse(res.json());
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.batchId).toBe(batchId);
        expect(parsed.data.module).toBe('crm-1');
        expect(parsed.data.totalRecords).toBe(100);
      }
    });

    it('matches GET /mappings/templates response structure with template array and enums', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/mappings/templates',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.templates)).toBe(true);
      expect(body.templates.length).toBeGreaterThanOrEqual(1);
      expect(body.enums).toBeDefined();
      expect(body.enums.lead_status).toBeDefined();
    });
  });
});
