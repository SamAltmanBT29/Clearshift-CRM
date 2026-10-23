import { describe, it, expect, beforeAll } from 'vitest';
import { Roles, signAccessToken } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { Crm4Service } from '../../src/services/crm4.service.js';
import { Crm4AuditService } from '../../src/services/audit.js';

describe('CRM-4 Fastify API Endpoint Injection Tests (Issue #45 / [CRM4-10])', () => {
  let app: ReturnType<typeof buildApp>;
  let service: Crm4Service;
  let auditService: Crm4AuditService;
  let editorToken: string;
  let viewerToken: string;

  const editorHeaders = () => ({ authorization: `Bearer ${editorToken}` });
  const viewerHeaders = () => ({ authorization: `Bearer ${viewerToken}` });

  beforeAll(async () => {
    service = new Crm4Service();
    service.seedSyntheticData();
    auditService = new Crm4AuditService();

    app = buildApp({ service, auditService, authEnabled: true });
    await app.ready();

    editorToken = await signAccessToken('api-test-editor', [Roles.EDITOR]);
    viewerToken = await signAccessToken('api-test-viewer', [Roles.VIEWER]);
  });

  // ---------------------------------------------------------------------------
  // 1. Marketing Lists Endpoints
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-marketing/lists', () => {
    it('returns paginated lists with 200 OK', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists?page=1&pageSize=10',
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toBeInstanceOf(Array);
      expect(body.items.length).toBeGreaterThanOrEqual(2);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.page).toBe(1);
    });

    it('filters lists by search term', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists?search=Beta',
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items.length).toBe(1);
      expect(body.items[0].name).toContain('Beta');
    });
  });

  describe('POST /api/v1/crm-marketing/lists', () => {
    it('creates a new marketing list with 201 Created', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/lists',
        headers: editorHeaders(),
        payload: {
          name: 'Q1 High-Intent Leads',
          description: 'Synthetic list created via Fastify injection',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Q1 High-Intent Leads');
      expect(body.campaignCount).toBe(0);
      expect(body.memberCount).toBe(0);
    });

    it('returns 400 Bad Request when list name is missing or empty', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/lists',
        headers: editorHeaders(),
        payload: {
          name: '   ',
          description: 'Invalid blank name',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PATCH /api/v1/crm-marketing/lists/:id', () => {
    it('updates list details with 200 OK', async () => {
      const listId = '44444444-1111-4444-8444-000000000001';
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/crm-marketing/lists/${listId}`,
        headers: editorHeaders(),
        payload: {
          description: 'Updated description for Q4 outreach',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(listId);
      expect(body.description).toBe('Updated description for Q4 outreach');
    });

    it('returns 404 Not Found for non-existent list ID', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000099';
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/crm-marketing/lists/${nonExistentId}`,
        headers: editorHeaders(),
        payload: {
          name: 'Does Not Exist',
        },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 Bad Request when update payload is empty', async () => {
      const listId = '44444444-1111-4444-8444-000000000001';
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/crm-marketing/lists/${listId}`,
        headers: editorHeaders(),
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Campaigns Endpoints
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-marketing/campaigns', () => {
    it('returns paginated campaigns with 200 OK', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/campaigns',
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toBeInstanceOf(Array);
      expect(body.items.length).toBeGreaterThanOrEqual(2);
    });

    it('filters campaigns by listId', async () => {
      const listId = '44444444-1111-4444-8444-000000000001';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-marketing/campaigns?listId=${listId}`,
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      for (const item of body.items) {
        expect(item.listId).toBe(listId);
      }
    });
  });

  describe('POST /api/v1/crm-marketing/campaigns', () => {
    it('creates a campaign linked to a list with 201 Created', async () => {
      const listId = '44444444-1111-4444-8444-000000000002';
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/campaigns',
        headers: editorHeaders(),
        payload: {
          name: 'Beta User Re-engagement',
          campaignDate: '2026-11-20',
          listId,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Beta User Re-engagement');
      expect(body.listId).toBe(listId);
    });

    it('returns 404 Not Found when referencing a non-existent listId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/campaigns',
        headers: editorHeaders(),
        payload: {
          name: 'Orphan Campaign',
          campaignDate: '2026-11-20',
          listId: '00000000-0000-0000-0000-000000000999',
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('returns 400 Bad Request when campaign date format is invalid', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/campaigns',
        headers: editorHeaders(),
        payload: {
          name: 'Invalid Date Campaign',
          campaignDate: '20-11-2026', // Expected YYYY-MM-DD
          listId: '44444444-1111-4444-8444-000000000001',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PATCH /api/v1/crm-marketing/campaigns/:id', () => {
    it('updates campaign name and date with 200 OK', async () => {
      const campaignId = '44444444-2222-4444-8444-000000000001';
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/crm-marketing/campaigns/${campaignId}`,
        headers: editorHeaders(),
        payload: {
          name: 'Updated Q4 Launch Announcement',
          campaignDate: '2026-11-05',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Updated Q4 Launch Announcement');
      expect(res.json().campaignDate).toBe('2026-11-05');
    });

    it('returns 403 Forbidden when attempting to mutate immutable listId', async () => {
      const campaignId = '44444444-2222-4444-8444-000000000001';
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/crm-marketing/campaigns/${campaignId}`,
        headers: editorHeaders(),
        payload: {
          listId: '44444444-1111-4444-8444-000000000002',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.message).toContain("immutable field 'listId'");
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Campaign Members Endpoints
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-marketing/campaigns/:id/members', () => {
    it('returns member list with 200 OK', async () => {
      const campaignId = '44444444-2222-4444-8444-000000000001';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-marketing/campaigns/${campaignId}/members`,
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toBeInstanceOf(Array);
      expect(body.items.length).toBeGreaterThanOrEqual(1);
    });

    it('filters members by status', async () => {
      const campaignId = '44444444-2222-4444-8444-000000000001';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-marketing/campaigns/${campaignId}/members?status=opened`,
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      for (const item of body.items) {
        expect(item.status).toBe('opened');
      }
    });
  });

  describe('POST /api/v1/crm-marketing/campaigns/:id/members', () => {
    it('records a new member with 201 Created and checks consent at action time', async () => {
      const campaignId = '44444444-2222-4444-8444-000000000002';
      const contactId = '11111111-1111-4111-8111-000000000003'; // Subscribed in seed
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/crm-marketing/campaigns/${campaignId}/members`,
        headers: editorHeaders(),
        payload: {
          contactId,
          status: 'clicked',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.campaignId).toBe(campaignId);
      expect(body.contactId).toBe(contactId);
      expect(body.status).toBe('clicked');
      expect(body.unsubscribed).toBe(false);
    });

    it('rejects an invalid member status with 400 Bad Request', async () => {
      const campaignId = '44444444-2222-4444-8444-000000000001';
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/crm-marketing/campaigns/${campaignId}/members`,
        headers: editorHeaders(),
        payload: {
          contactId: '11111111-1111-4111-8111-000000000001',
          status: 'bounced', // Not in allowlist (sent, opened, clicked)
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Consents Endpoints & Monotonic Invariant
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-marketing/consents/:contact', () => {
    it('retrieves existing contact consent with 200 OK', async () => {
      const contactId = '11111111-1111-4111-8111-000000000001';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-marketing/consents/${contactId}`,
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.contactId).toBe(contactId);
      expect(body.status).toBe('subscribed');
    });

    it('returns 404 Not Found when consent record does not exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/consents/00000000-0000-0000-0000-000000000099',
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/v1/crm-marketing/consents', () => {
    it('sets new consent record with 200 OK', async () => {
      const contactId = '11111111-1111-4111-8111-000000000009';
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/consents',
        headers: editorHeaders(),
        payload: {
          contactId,
          status: 'subscribed',
          source: 'landing_page_newsletter',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().contactId).toBe(contactId);
      expect(res.json().status).toBe('subscribed');
    });

    it('allows opting out (subscribed -> unsubscribed)', async () => {
      const contactId = '11111111-1111-4111-8111-000000000009';
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/consents',
        headers: editorHeaders(),
        payload: {
          contactId,
          status: 'unsubscribed',
          source: 'footer_unsubscribe_link',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('unsubscribed');
    });

    it('enforces BR-CRM4-01 and returns 409 Conflict when attempting to reverse unsubscribed to subscribed', async () => {
      const contactId = '11111111-1111-4111-8111-000000000002'; // Known unsubscribed
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/consents',
        headers: editorHeaders(),
        payload: {
          contactId,
          status: 'subscribed',
          source: 're-engagement_email_blast',
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error.message).toContain('BR-CRM4-01');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. CSV Export Endpoint
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-marketing/campaigns/:id/export', () => {
    it('exports campaign members as sanitized CSV with text/csv header', async () => {
      const campaignId = '44444444-2222-4444-8444-000000000001';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-marketing/campaigns/${campaignId}/export`,
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.body).toContain('MemberId,CampaignName,ContactId,Status,Unsubscribed,CreatedAt');
    });
  });
});
