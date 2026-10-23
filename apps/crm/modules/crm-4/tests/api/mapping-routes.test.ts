import { describe, it, expect, beforeAll } from 'vitest';
import { Roles, signAccessToken } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { Crm4Service } from '../../src/services/crm4.service.js';
import { Crm4AuditService } from '../../src/services/audit.js';

describe('CRM-4 Mapping Fastify Route Tests (#181, [CRM4-28])', () => {
  let app: ReturnType<typeof buildApp>;
  let editorHeaders: { authorization: string };
  let viewerHeaders: { authorization: string };

  beforeAll(async () => {
    const service = new Crm4Service();
    const auditService = new Crm4AuditService();
    app = buildApp({ service, auditService, authEnabled: true });
    await app.ready();

    const editorToken = await signAccessToken('synthetic-editor', [Roles.EDITOR]);
    editorHeaders = { authorization: `Bearer ${editorToken}` };

    const viewerToken = await signAccessToken('synthetic-viewer', [Roles.VIEWER]);
    viewerHeaders = { authorization: `Bearer ${viewerToken}` };
  });

  describe('GET /api/v1/crm-marketing/mappings/templates', () => {
    it('returns all templates and enum dictionaries with 200 OK', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/mappings/templates',
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(Array.isArray(data.templates)).toBe(true);
      expect(data.templates.length).toBe(8);
      expect(data.enums.member_status.allowlist).toEqual(['sent', 'opened', 'clicked']);
      expect(data.enums.consent_status.allowlist).toEqual(['subscribed', 'unsubscribed']);
    });

    it('filters templates by entity query param', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/mappings/templates?entity=crm4_lists',
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.templates.length).toBe(2);
      expect(data.templates.every((t: any) => t.entity === 'crm4_lists')).toBe(true);
    });

    it('returns 400 for invalid entity query param', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/mappings/templates?entity=invalid_crm_entity',
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.payload);
      expect(data.error.code).toBe('BAD_REQUEST');
    });
  });

  describe('GET /api/v1/crm-marketing/mappings/templates/:id', () => {
    it('returns template details and SHA-256 checksum for valid ID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/mappings/templates/crm4-lists-canonical',
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.template.id).toBe('crm4-lists-canonical');
      expect(data.checksum).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns 404 for non-existent template ID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/mappings/templates/unknown-template-xyz',
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(404);
      const data = JSON.parse(response.payload);
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/v1/crm-marketing/mappings/validate', () => {
    it('returns 200 OK when source columns satisfy mandatory target attributes', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/mappings/validate',
        headers: editorHeaders,
        payload: {
          templateId: 'crm4-lists-canonical',
          sourceColumns: ['id', 'name', 'description'],
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.ready).toBe(true);
      expect(data.templateId).toBe('crm4-lists-canonical');
    });

    it('returns 400 with MAPPING_INCOMPLETE when required fields are missing from source columns', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/mappings/validate',
        headers: editorHeaders,
        payload: {
          templateId: 'crm4-lists-canonical',
          sourceColumns: ['id', 'description'], // missing required 'name'
        },
      });

      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.payload);
      expect(data.error.code).toBe('MAPPING_INCOMPLETE');
      expect(Array.isArray(data.error.details)).toBe(true);
      expect(data.error.details[0]?.field).toBe('name');
    });

    it('returns 403 Forbidden when accessed without editor or admin role', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/mappings/validate',
        headers: viewerHeaders,
        payload: {
          templateId: 'crm4-lists-canonical',
          sourceColumns: ['name'],
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/crm-marketing/mappings/map', () => {
    it('maps batch rows deterministically with status 200 OK', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/mappings/map',
        headers: editorHeaders,
        payload: {
          templateId: 'crm4-consents-canonical',
          rows: [
            {
              contact_id: '11111111-1111-4111-8111-000000000001',
              status: 'opt_in',
              source: 'newsletter_signup',
            },
            {
              contact_id: '11111111-1111-4111-8111-000000000002',
              status: 'opt_out',
              source: 'unsubscribe_page',
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.totalRows).toBe(2);
      expect(data.successfulCount).toBe(2);
      expect(data.failedCount).toBe(0);
      expect(data.rows[0]?.['status']).toBe('subscribed');
      expect(data.rows[1]?.['status']).toBe('unsubscribed');
    });

    it('returns 400 when malformed payload is provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/mappings/map',
        headers: editorHeaders,
        payload: {
          templateId: 'crm4-consents-canonical',
          rows: 'invalid-non-array',
        },
      });

      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.payload);
      expect(data.error.code).toBe('BAD_REQUEST');
    });
  });
});
