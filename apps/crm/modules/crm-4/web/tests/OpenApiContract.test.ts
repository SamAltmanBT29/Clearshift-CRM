import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OPENAPI_FILE_PATH = path.resolve(__dirname, '../../../../../../packages/contracts/openapi/crm-4.yaml');

describe('CRM-4 OpenAPI Specification Conformance (Issue #40 / [CRM4-05])', () => {
  it('locates and parses the canonical packages/contracts/openapi/crm-4.yaml OpenAPI spec file', () => {
    expect(fs.existsSync(OPENAPI_FILE_PATH)).toBe(true);
    const content = fs.readFileSync(OPENAPI_FILE_PATH, 'utf-8');
    expect(content).toContain('openapi: 3.1.0');
    expect(content).toContain('ClearShift CRM-4 Marketing Lists and Campaign History API');
    expect(content).toContain('version: 1.0.0');
  });

  it('documents all 10 specified REST endpoints under /api/v1/crm-marketing', () => {
    const content = fs.readFileSync(OPENAPI_FILE_PATH, 'utf-8');
    const requiredEndpoints = [
      '/api/v1/crm-marketing/lists:',
      '/api/v1/crm-marketing/lists/{id}:',
      '/api/v1/crm-marketing/campaigns:',
      '/api/v1/crm-marketing/campaigns/{id}:',
      '/api/v1/crm-marketing/campaigns/{id}/members:',
      '/api/v1/crm-marketing/consents:',
      '/api/v1/crm-marketing/consents/{contact}:',
    ];

    for (const endpoint of requiredEndpoints) {
      expect(content).toContain(endpoint);
    }
  });

  it('documents operations for lists (GET, POST), lists/{id} (PATCH)', () => {
    const content = fs.readFileSync(OPENAPI_FILE_PATH, 'utf-8');
    expect(content).toContain('operationId: listCRM4MarketingLists');
    expect(content).toContain('operationId: createCRM4MarketingList');
    expect(content).toContain('operationId: patchCRM4MarketingList');
  });

  it('documents operations for campaigns (GET, POST), campaigns/{id} (GET, PATCH)', () => {
    const content = fs.readFileSync(OPENAPI_FILE_PATH, 'utf-8');
    expect(content).toContain('operationId: listCRM4Campaigns');
    expect(content).toContain('operationId: createCRM4Campaign');
    expect(content).toContain('operationId: getCRM4CampaignById');
    expect(content).toContain('operationId: patchCRM4Campaign');
  });

  it('documents operations for campaign members (GET, POST) with status allowlist', () => {
    const content = fs.readFileSync(OPENAPI_FILE_PATH, 'utf-8');
    expect(content).toContain('operationId: listCRM4CampaignMembers');
    expect(content).toContain('operationId: createCRM4CampaignMember');
    expect(content).toContain('enum: [sent, opened, clicked]');
  });

  it('documents operations for consents (POST set, GET by contact) and BR-CRM4-01 conflict', () => {
    const content = fs.readFileSync(OPENAPI_FILE_PATH, 'utf-8');
    expect(content).toContain('operationId: setCRM4Consent');
    expect(content).toContain('operationId: getCRM4ConsentByContact');
    expect(content).toContain('BR-CRM4-01');
    expect(content).toContain('"409":');
  });

  it('documents bearerAuth securityScheme across protected endpoints', () => {
    const content = fs.readFileSync(OPENAPI_FILE_PATH, 'utf-8');
    expect(content).toContain('bearerAuth:');
    expect(content).toContain('scheme: bearer');
    expect(content).toContain('bearerFormat: JWT');
    expect(content).toContain('- bearerAuth: []');
  });

  it('defines core schemas matching Zod contracts in packages/contracts/src/crm-4.ts', () => {
    const content = fs.readFileSync(OPENAPI_FILE_PATH, 'utf-8');
    const requiredSchemas = [
      'CRM4List:',
      'CRM4ListCreate:',
      'CRM4ListPatch:',
      'CRM4Campaign:',
      'CRM4CampaignCreate:',
      'CRM4CampaignPatch:',
      'CRM4Member:',
      'CRM4MemberCreateRequest:',
      'CRM4Consent:',
      'CRM4ConsentSet:',
      'CRM4Pagination:',
      'CRM4ListResponse:',
      'CRM4CampaignListResponse:',
      'CRM4MemberListResponse:',
      'ErrorEnvelope:',
    ];

    for (const schema of requiredSchemas) {
      expect(content).toContain(schema);
    }
  });
});
