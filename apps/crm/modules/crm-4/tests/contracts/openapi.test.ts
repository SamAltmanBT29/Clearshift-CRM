import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Roles, signAccessToken } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { Crm4Service } from '../../src/services/crm4.service.js';
import {
  CRM4ListResponseSchema,
  CRM4CampaignListResponseSchema,
  CRM4MemberListResponseSchema,
  CRM4ConsentSchema,
  CRM4ListSchema,
  CRM4CampaignSchema,
} from '@clearshift/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OPENAPI_FILE_PATH = path.resolve(__dirname, '../../../../../../packages/contracts/openapi/crm-4.yaml');

describe('CRM-4 OpenAPI Contract Conformance Suite (Issue #45 / [CRM4-10])', () => {
  let app: ReturnType<typeof buildApp>;
  let service: Crm4Service;
  let viewerToken: string;
  let openapiYaml: string;

  beforeAll(async () => {
    service = new Crm4Service();
    service.seedSyntheticData();
    app = buildApp({ service, authEnabled: true });
    await app.ready();

    viewerToken = await signAccessToken('contract-viewer', [Roles.VIEWER]);
    openapiYaml = fs.readFileSync(OPENAPI_FILE_PATH, 'utf-8');
  });

  describe('1. OpenAPI 3.1.0 Specification Integrity', () => {
    it('verifies canonical crm-4.yaml exists and declares version 3.1.0', () => {
      expect(fs.existsSync(OPENAPI_FILE_PATH)).toBe(true);
      expect(openapiYaml).toContain('openapi: 3.1.0');
      expect(openapiYaml).toContain('ClearShift CRM-4 Marketing Lists and Campaign History API');
      expect(openapiYaml).toContain('version: 1.0.0');
    });

    it('declares the standard bearerAuth security scheme', () => {
      expect(openapiYaml).toContain('bearerAuth:');
      expect(openapiYaml).toContain('type: http');
      expect(openapiYaml).toContain('scheme: bearer');
      expect(openapiYaml).toContain('bearerFormat: JWT');
    });

    it('documents all baseline SDS endpoints and mapping endpoints in paths', () => {
      expect(openapiYaml).toContain('/api/v1/crm-marketing/lists:');
      expect(openapiYaml).toContain('/api/v1/crm-marketing/lists/{id}:');
      expect(openapiYaml).toContain('/api/v1/crm-marketing/campaigns:');
      expect(openapiYaml).toContain('/api/v1/crm-marketing/campaigns/{id}:');
      expect(openapiYaml).toContain('/api/v1/crm-marketing/campaigns/{id}/members:');
      expect(openapiYaml).toContain('/api/v1/crm-marketing/consents:');
      expect(openapiYaml).toContain('/api/v1/crm-marketing/consents/{contact}:');
      expect(openapiYaml).toContain('/api/v1/crm-marketing/mappings/templates:');
      expect(openapiYaml).toContain('/api/v1/crm-marketing/mappings/templates/{id}:');
      expect(openapiYaml).toContain('/api/v1/crm-marketing/mappings/validate:');
      expect(openapiYaml).toContain('/api/v1/crm-marketing/mappings/map:');
    });

    it('documents standard ClearShift error responses (400, 401, 403, 404, 409)', () => {
      expect(openapiYaml).toContain('ValidationError:');
      expect(openapiYaml).toContain('UnauthorizedError:');
      expect(openapiYaml).toContain('ForbiddenError:');
      expect(openapiYaml).toContain('NotFoundError:');
      expect(openapiYaml).toContain('ConflictError:');
    });
  });

  describe('2. Response Payload Conformance with Zod Contracts', () => {
    it('matches GET /lists response against CRM4ListResponseSchema', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const parsed = CRM4ListResponseSchema.safeParse(res.json());
      expect(parsed.success).toBe(true);
    });

    it('matches GET /campaigns response against CRM4CampaignListResponseSchema', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/campaigns',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const parsed = CRM4CampaignListResponseSchema.safeParse(res.json());
      expect(parsed.success).toBe(true);
    });

    it('matches GET /campaigns/:id/members response against CRM4MemberListResponseSchema', async () => {
      const campaignId = '44444444-2222-4444-8444-000000000001';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-marketing/campaigns/${campaignId}/members`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const parsed = CRM4MemberListResponseSchema.safeParse(res.json());
      expect(parsed.success).toBe(true);
    });

    it('matches GET /consents/:contact response against CRM4ConsentSchema', async () => {
      const contactId = '11111111-1111-4111-8111-000000000001';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-marketing/consents/${contactId}`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const parsed = CRM4ConsentSchema.safeParse(res.json());
      expect(parsed.success).toBe(true);
    });

    it('matches GET /mappings/templates response structure with template array and enums', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/mappings/templates',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.templates)).toBe(true);
      expect(body.templates.length).toBe(8);
      expect(body.enums).toBeDefined();
      expect(body.enums.member_status).toBeDefined();
      expect(body.enums.consent_status).toBeDefined();
    });
  });
});
