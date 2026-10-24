import { describe, it, expect, beforeAll } from 'vitest';
import { Roles, signAccessToken } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { Crm1Service } from '../../src/services/crm1.service.js';

describe('CRM-1 Mapping Routes (#121, [CRM1-28])', () => {
  let app: ReturnType<typeof buildApp>;
  let runnerHeaders: { authorization: string };
  let viewerHeaders: { authorization: string };

  beforeAll(async () => {
    const service = new Crm1Service();
    app = buildApp({ service });
    await app.ready();

    const runnerToken = await signAccessToken('synthetic-runner', [
      Roles.MIGRATION_RUNNER,
      Roles.VIEWER,
    ]);
    runnerHeaders = { authorization: `Bearer ${runnerToken}` };

    const viewerToken = await signAccessToken('synthetic-viewer', [Roles.VIEWER]);
    viewerHeaders = { authorization: `Bearer ${viewerToken}` };
  });

  describe('GET /api/v1/crm-contacts/mappings/templates', () => {
    it('returns all templates and enum dictionaries with 200 OK', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/mappings/templates',
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(Array.isArray(data.templates)).toBe(true);
      expect(data.templates.length).toBe(6);
      expect(data.enums.lead_status.allowlist).toEqual(['New', 'Working', 'Qualified', 'Closed']);
    });

    it('filters templates by entity query param', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/mappings/templates?entity=crm1_companies',
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.templates.length).toBe(2);
      expect(data.templates.every((t: any) => t.entity === 'crm1_companies')).toBe(true);
    });

    it('returns 400 for invalid entity query param', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/mappings/templates?entity=invalid_entity',
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.payload);
      expect(data.error.code).toBe('BAD_REQUEST');
    });
  });

  describe('GET /api/v1/crm-contacts/mappings/templates/:id', () => {
    it('returns template details and SHA-256 checksum for valid ID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/mappings/templates/crm1-contacts-canonical',
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.template.id).toBe('crm1-contacts-canonical');
      expect(data.checksum).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns 404 for non-existent template ID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/mappings/templates/unknown-template-xyz',
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(404);
      const data = JSON.parse(response.payload);
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/v1/crm-contacts/mappings/validate', () => {
    it('returns 200 OK when source columns satisfy mandatory target attributes', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/mappings/validate',
        headers: runnerHeaders,
        payload: {
          templateId: 'crm1-contacts-canonical',
          sourceColumns: ['first_name', 'last_name', 'email', 'phone'],
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.ready).toBe(true);
      expect(data.templateId).toBe('crm1-contacts-canonical');
    });

    it('returns 400 with MAPPING_INCOMPLETE when required fields are missing from source columns', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/mappings/validate',
        headers: runnerHeaders,
        payload: {
          templateId: 'crm1-contacts-canonical',
          sourceColumns: ['first_name', 'email'], // missing 'last_name'
        },
      });

      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.payload);
      expect(data.error.code).toBe('MAPPING_INCOMPLETE');
      expect(Array.isArray(data.error.details)).toBe(true);
      expect(data.error.details[0]?.field).toBe('lastName');
    });

    it('returns 403 Forbidden when accessed without migration_runner or admin role', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/mappings/validate',
        headers: viewerHeaders,
        payload: {
          templateId: 'crm1-contacts-canonical',
          sourceColumns: ['first_name', 'last_name'],
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/crm-contacts/mappings/map', () => {
    it('maps batch rows deterministically with status 200 OK', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/mappings/map',
        headers: runnerHeaders,
        payload: {
          templateId: 'crm1-leads-canonical',
          rows: [
            {
              contact_id: 'c1000001-0000-4000-8000-000000000001',
              status: 'in_progress',
            },
            {
              contact_id: 'c1000001-0000-4000-8000-000000000002',
              status: 'won',
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.totalRows).toBe(2);
      expect(data.successfulCount).toBe(2);
      expect(data.failedCount).toBe(0);
      expect(data.rows[0]?.['status']).toBe('Working');
      expect(data.rows[1]?.['status']).toBe('Closed');
    });

    it('returns 400 when malformed payload is provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/mappings/map',
        headers: runnerHeaders,
        payload: {
          templateId: 'crm1-leads-canonical',
          rows: 'not-an-array',
        },
      });

      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.payload);
      expect(data.error.code).toBe('BAD_REQUEST');
    });
  });
});
