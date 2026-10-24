import { describe, it, expect, beforeAll } from 'vitest';
import { Roles, signAccessToken } from '@cs/identity';
import {
  CRM4ListResponseSchema,
  CRM4ListSchema,
  CRM4CampaignListResponseSchema,
  CRM4CampaignSchema,
  CRM4MemberListResponseSchema,
  CRM4ConsentSchema,
} from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import { Crm4Service } from '../../src/services/crm4.service.js';
import { Crm4AuditService } from '../../src/services/audit.js';

describe('[CRM4-02] CRM-4 Marketing Lists and Campaign History: List/Read API (Issue #37)', () => {
  let app: ReturnType<typeof buildApp>;
  let service: Crm4Service;
  let auditService: Crm4AuditService;
  let viewerToken: string;
  let editorToken: string;
  let adminToken: string;
  let migrationRunnerToken: string;

  const viewerHeaders = () => ({ authorization: `Bearer ${viewerToken}` });
  const prohibitedHeaders = () => ({ authorization: `Bearer ${migrationRunnerToken}` });

  beforeAll(async () => {
    service = new Crm4Service();
    service.seedSyntheticData();
    auditService = new Crm4AuditService();

    app = buildApp({ service, auditService, authEnabled: true });
    await app.ready();

    viewerToken = await signAccessToken('test-viewer-user', [Roles.VIEWER]);
    editorToken = await signAccessToken('test-editor-user', [Roles.EDITOR]);
    adminToken = await signAccessToken('test-admin-user', [Roles.ADMIN]);
    migrationRunnerToken = await signAccessToken('test-migration-user', [Roles.MIGRATION_RUNNER]);
  });

  // =========================================================================
  // 1. Marketing Lists Collection & Read API (GET /lists & GET /lists/:id)
  // =========================================================================
  describe('1. Marketing Lists Read & Collection Endpoints', () => {
    it('GET /api/v1/crm-marketing/lists returns 200 OK with default bounded pagination', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists',
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const parsed = CRM4ListResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);

      expect(body.pagination.page).toBe(1);
      expect(body.pagination.pageSize).toBe(25);
      expect(body.pagination.totalCount).toBeGreaterThanOrEqual(2);
      expect(body.pagination.totalPages).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(body.items)).toBe(true);
    });

    it('rejects pageSize exceeding 100 with 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists?page=1&pageSize=101',
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects non-positive page parameter with 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists?page=0',
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('performs server-side case-insensitive search by list name and description', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists?search=beta',
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items.length).toBe(1);
      expect(body.items[0].name).toContain('Beta');
    });

    it('returns empty items array with 200 OK when search matches nothing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists?search=NonExistentTermXYZ999',
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(0);
      expect(body.pagination.totalCount).toBe(0);
    });

    it('guarantees deterministic, non-overlapping pagination across consecutive pages', async () => {
      // Seed additional synthetic lists to test multi-page non-overlapping pagination
      for (let i = 1; i <= 5; i++) {
        await service.createList({
          name: `Synthetic Outreach Cohort ${i}`,
          description: `Pagination test cohort ${i}`,
        });
      }

      const page1Res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists?page=1&pageSize=2',
        headers: viewerHeaders(),
      });
      const page2Res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists?page=2&pageSize=2',
        headers: viewerHeaders(),
      });

      expect(page1Res.statusCode).toBe(200);
      expect(page2Res.statusCode).toBe(200);

      const page1Items = page1Res.json().items;
      const page2Items = page2Res.json().items;

      expect(page1Items).toHaveLength(2);
      expect(page2Items).toHaveLength(2);

      const page1Ids = new Set(page1Items.map((item: any) => item.id));
      const hasOverlap = page2Items.some((item: any) => page1Ids.has(item.id));
      expect(hasOverlap).toBe(false);
    });

    it('tolerates unknown query parameters without altering results or failing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists?page=1&pageSize=10&unexpected_param=malicious_sql_drop_table',
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toBeDefined();
    });

    it('GET /api/v1/crm-marketing/lists/:id returns 200 OK for valid list ID', async () => {
      const listId = '44444444-1111-4444-8444-000000000001';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-marketing/lists/${listId}`,
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const parsed = CRM4ListSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body.id).toBe(listId);
      expect(body.name).toBe('Q4 Enterprise Prospects');
    });

    it('GET /api/v1/crm-marketing/lists/:id returns 404 Not Found for nonexistent list ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists/99999999-9999-4999-8999-000000000099',
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.code).toBe('NOT_FOUND');
    });
  });

  // =========================================================================
  // 2. Campaigns Collection & Read API (GET /campaigns & GET /campaigns/:id)
  // =========================================================================
  describe('2. Campaigns Read & Collection Endpoints', () => {
    it('GET /api/v1/crm-marketing/campaigns returns 200 OK with default bounded pagination', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/campaigns',
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const parsed = CRM4CampaignListResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.pageSize).toBe(25);
      expect(body.items.length).toBeGreaterThanOrEqual(2);
    });

    it('filters campaigns by parent listId', async () => {
      const list1Id = '44444444-1111-4444-8444-000000000001';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-marketing/campaigns?listId=${list1Id}`,
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      for (const item of body.items) {
        expect(item.listId).toBe(list1Id);
      }
    });

    it('performs server-side case-insensitive search by campaign name', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/campaigns?search=Launch',
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.items[0].name).toContain('Launch');
    });

    it('rejects campaigns pageSize > 100 with 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/campaigns?pageSize=150',
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects malformed listId UUID with 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/campaigns?listId=invalid-not-a-uuid',
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('GET /api/v1/crm-marketing/campaigns/:id returns 200 OK for valid campaign', async () => {
      const campId = '44444444-2222-4444-8444-000000000001';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-marketing/campaigns/${campId}`,
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const parsed = CRM4CampaignSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body.id).toBe(campId);
      expect(body.listId).toBe('44444444-1111-4444-8444-000000000001');
    });

    it('GET /api/v1/crm-marketing/campaigns/:id returns 404 Not Found for nonexistent campaign', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/campaigns/99999999-9999-4999-8999-000000000099',
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.code).toBe('NOT_FOUND');
    });
  });

  // =========================================================================
  // 3. Campaign Members Collection API (GET /campaigns/:id/members)
  // =========================================================================
  describe('3. Campaign Members Read Endpoints', () => {
    const campId = '44444444-2222-4444-8444-000000000001';

    it('GET /api/v1/crm-marketing/campaigns/:id/members returns 200 OK and validates schema', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-marketing/campaigns/${campId}/members`,
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const parsed = CRM4MemberListResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body.items.length).toBeGreaterThanOrEqual(2);
      expect(body.items[0].campaignId).toBe(campId);
    });

    it('filters campaign members by valid status (sent, opened, clicked)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-marketing/campaigns/${campId}/members?status=opened`,
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      for (const m of body.items) {
        expect(m.status).toBe('opened');
      }
    });

    it('rejects invalid member status with 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-marketing/campaigns/${campId}/members?status=bounced`,
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects members pageSize > 100 with 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-marketing/campaigns/${campId}/members?pageSize=200`,
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 Not Found when campaign does not exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/campaigns/99999999-9999-4999-8999-000000000099/members',
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.code).toBe('NOT_FOUND');
    });
  });

  // =========================================================================
  // 4. Contact Consent Read & Monotonic Opt-Out Invariant (GET /consents/:contact)
  // =========================================================================
  describe('4. Contact Consent Read & BR-CRM4-01 Invariant', () => {
    it('GET /api/v1/crm-marketing/consents/:contact returns 200 OK for known subscribed contact', async () => {
      const contact1Id = '11111111-1111-4111-8111-000000000001';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-marketing/consents/${contact1Id}`,
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const parsed = CRM4ConsentSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body.contactId).toBe(contact1Id);
      expect(body.status).toBe('subscribed');
    });

    it('GET /api/v1/crm-marketing/consents/:contact returns 200 OK for known unsubscribed contact (BR-CRM4-01)', async () => {
      const contact2Id = '11111111-1111-4111-8111-000000000002';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-marketing/consents/${contact2Id}`,
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.contactId).toBe(contact2Id);
      expect(body.status).toBe('unsubscribed');
    });

    it('GET /api/v1/crm-marketing/consents/:contact returns 404 Not Found for unrecorded contact ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/consents/99999999-9999-4999-8999-000000000099',
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.code).toBe('NOT_FOUND');
    });
  });

  // =========================================================================
  // 5. Authentication & Authorization (RBAC)
  // =========================================================================
  describe('5. RBAC & Security Enforcement for Read Endpoints', () => {
    it('returns 401 Unauthorized when Authorization header is absent', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists',
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 403 Forbidden when caller possesses a prohibited role (migration_runner)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists',
        headers: prohibitedHeaders(),
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.code).toBe('FORBIDDEN');
    });

    it('permits access to viewers, editors, and admins', async () => {
      const rolesToTest = [
        { name: 'editor', token: editorToken },
        { name: 'admin', token: adminToken },
      ];

      for (const { token } of rolesToTest) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-marketing/lists',
          headers: { authorization: `Bearer ${token}` },
        });

        expect(res.statusCode).toBe(200);
      }
    });
  });
});
