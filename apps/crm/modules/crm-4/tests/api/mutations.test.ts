import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Roles, signAccessToken } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { Crm4Service } from '../../src/services/crm4.service.js';
import { Crm4AuditService } from '../../src/services/audit.js';

describe('CRM-4 Mutation API & Domain Validation Suite (Issue #38 / [CRM4-03])', () => {
  let app: ReturnType<typeof buildApp>;
  let service: Crm4Service;
  let auditService: Crm4AuditService;
  let editorToken: string;
  let viewerToken: string;
  let adminToken: string;

  const editorHeaders = () => ({ authorization: `Bearer ${editorToken}` });
  const viewerHeaders = () => ({ authorization: `Bearer ${viewerToken}` });
  const adminHeaders = () => ({ authorization: `Bearer ${adminToken}` });

  beforeAll(async () => {
    service = new Crm4Service();
    service.seedSyntheticData();
    auditService = new Crm4AuditService();

    app = buildApp({ service, auditService, authEnabled: true });
    await app.ready();

    editorToken = await signAccessToken('mutation-test-editor', [Roles.EDITOR]);
    viewerToken = await signAccessToken('mutation-test-viewer', [Roles.VIEWER]);
    adminToken = await signAccessToken('mutation-test-admin', [Roles.ADMIN]);
  });

  // =========================================================================
  // 1. Marketing List Mutations & Domain Validation
  // =========================================================================
  describe('Marketing List Mutations (POST & PATCH /lists)', () => {
    it('creates marketing list with 201 Created and trims whitespace', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/lists',
        headers: editorHeaders(),
        payload: {
          name: '  Sprint 3 High Value Accounts  ',
          description: '  Target enterprise accounts  ',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Sprint 3 High Value Accounts');
      expect(body.description).toBe('Target enterprise accounts');
      expect(body.campaignCount).toBe(0);
      expect(body.memberCount).toBe(0);
      expect(body.createdAt).toBeDefined();
    });

    it('rejects blank name with 400 Validation Error on whitespace-only input', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/lists',
        headers: editorHeaders(),
        payload: {
          name: '   ',
          description: 'Invalid blank list',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('updates marketing list name and description with 200 OK', async () => {
      const listId = '44444444-1111-4444-8444-000000000001';
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/crm-marketing/lists/${listId}`,
        headers: editorHeaders(),
        payload: {
          name: 'Renamed Q4 Enterprise Prospects',
          description: 'Updated enterprise cohort',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(listId);
      expect(body.name).toBe('Renamed Q4 Enterprise Prospects');
      expect(body.description).toBe('Updated enterprise cohort');
    });

    it('rejects tampering with immutable system-managed fields on PATCH /lists/:id with 403 Forbidden', async () => {
      const listId = '44444444-1111-4444-8444-000000000001';
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/crm-marketing/lists/${listId}`,
        headers: editorHeaders(),
        payload: {
          name: 'Valid Name',
          campaignCount: 999, // Immutable protected field
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toContain('campaignCount');
    });

    it('rejects tampering with memberCount on PATCH /lists/:id with 403 Forbidden', async () => {
      const listId = '44444444-1111-4444-8444-000000000001';
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/crm-marketing/lists/${listId}`,
        headers: editorHeaders(),
        payload: {
          memberCount: 500, // Immutable protected field
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toContain('memberCount');
    });
  });

  // =========================================================================
  // 2. Campaign Mutations & listId Immutability Invariant
  // =========================================================================
  describe('Campaign Mutations (POST & PATCH /campaigns)', () => {
    it('creates campaign linked to parent list and increments parent list campaignCount', async () => {
      const listId = '44444444-1111-4444-8444-000000000002';
      const beforeList = await service.getListById(listId);
      const initialCount = beforeList.campaignCount;

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/campaigns',
        headers: editorHeaders(),
        payload: {
          name: 'Sprint 3 Kickoff Webinar',
          campaignDate: '2026-11-20',
          listId,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Sprint 3 Kickoff Webinar');
      expect(body.listId).toBe(listId);
      expect(body.memberCount).toBe(0);

      const afterList = await service.getListById(listId);
      expect(afterList.campaignCount).toBe(initialCount + 1);
    });

    it('rejects campaign creation when referenced list does not exist with 404 Not Found', async () => {
      const missingListId = '00000000-0000-0000-0000-000000000999';
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/campaigns',
        headers: editorHeaders(),
        payload: {
          name: 'Invalid Parent Campaign',
          campaignDate: '2026-11-20',
          listId: missingListId,
        },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('strictly forbids modifying listId on PATCH /campaigns/:id with 403 Forbidden', async () => {
      const campId = '44444444-2222-4444-8444-000000000001';
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/crm-marketing/campaigns/${campId}`,
        headers: editorHeaders(),
        payload: {
          listId: '44444444-1111-4444-8444-000000000002', // Attempted parent list reparenting
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toContain('listId');
    });

    it('updates campaign name and campaignDate with 200 OK', async () => {
      const campId = '44444444-2222-4444-8444-000000000002';
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/crm-marketing/campaigns/${campId}`,
        headers: editorHeaders(),
        payload: {
          name: 'Updated Beta Drive 2026',
          campaignDate: '2026-12-01',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(campId);
      expect(body.name).toBe('Updated Beta Drive 2026');
      expect(body.campaignDate).toBe('2026-12-01');
    });
  });

  // =========================================================================
  // 3. Campaign Membership Domain Invariants & Duplicate Prevention
  // =========================================================================
  describe('Campaign Membership (POST /campaigns/:id/members)', () => {
    it('adds a member to campaign, sets initial status, and increments campaign memberCount', async () => {
      const campId = '44444444-2222-4444-8444-000000000002';
      const beforeCamp = await service.getCampaignById(campId);
      const initialCount = beforeCamp.memberCount;
      const newContactId = '11111111-9999-4111-8111-000000000001';

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/crm-marketing/campaigns/${campId}/members`,
        headers: editorHeaders(),
        payload: {
          contactId: newContactId,
          status: 'sent',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.campaignId).toBe(campId);
      expect(body.contactId).toBe(newContactId);
      expect(body.status).toBe('sent');
      expect(body.unsubscribed).toBe(false);

      const afterCamp = await service.getCampaignById(campId);
      expect(afterCamp.memberCount).toBe(initialCount + 1);
    });

    it('enforces duplicate prevention: returns 409 Conflict when contact is already a member', async () => {
      const campId = '44444444-2222-4444-8444-000000000001';
      // Contact 1 is already seeded as member of camp 1
      const duplicateContactId = '11111111-1111-4111-8111-000000000001';

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/crm-marketing/campaigns/${campId}/members`,
        headers: editorHeaders(),
        payload: {
          contactId: duplicateContactId,
          status: 'sent',
        },
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('already a member');
    });

    it('strictly restricts member status to sent, opened, clicked (rejects queued/failed with 400)', async () => {
      const campId = '44444444-2222-4444-8444-000000000002';
      const contactId = '11111111-8888-4111-8111-000000000001';

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/crm-marketing/campaigns/${campId}/members`,
        headers: editorHeaders(),
        payload: {
          contactId,
          status: 'delivered', // Invalid status per SDS CRM-4
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('marks unsubscribed = true at member creation time if contact has existing opt-out', async () => {
      const campId = '44444444-2222-4444-8444-000000000002';
      // Contact 2 is seeded with status unsubscribed
      const unsubscribedContactId = '11111111-1111-4111-8111-000000000002';

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/crm-marketing/campaigns/${campId}/members`,
        headers: editorHeaders(),
        payload: {
          contactId: unsubscribedContactId,
          status: 'opened',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.contactId).toBe(unsubscribedContactId);
      expect(body.unsubscribed).toBe(true);
    });
  });

  // =========================================================================
  // 4. BR-CRM4-01 Monotonic Opt-Out Invariant
  // =========================================================================
  describe('Consent Management & BR-CRM4-01 Invariant (POST /consents)', () => {
    it('sets initial consent with 200 OK for new contact', async () => {
      const newContactId = '11111111-7777-4111-8111-000000000001';
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/consents',
        headers: editorHeaders(),
        payload: {
          contactId: newContactId,
          status: 'subscribed',
          source: 'newsletter_signup',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.contactId).toBe(newContactId);
      expect(body.status).toBe('subscribed');
    });

    it('allows transition from subscribed to unsubscribed (opting out)', async () => {
      // Contact 1 starts as subscribed
      const contact1Id = '11111111-1111-4111-8111-000000000001';
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/consents',
        headers: editorHeaders(),
        payload: {
          contactId: contact1Id,
          status: 'unsubscribed',
          source: 'user_settings_toggle',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.contactId).toBe(contact1Id);
      expect(body.status).toBe('unsubscribed');

      // Verify contact1 members are now marked unsubscribed
      const membersResult = await service.getCampaignMembers('44444444-2222-4444-8444-000000000001');
      const member = membersResult.items.find((m) => m.contactId === contact1Id);
      expect(member?.unsubscribed).toBe(true);
    });

    it('enforces BR-CRM4-01: rejects unsubscribed -> subscribed with 409 Conflict', async () => {
      // Contact 2 is known unsubscribed
      const contact2Id = '11111111-1111-4111-8111-000000000002';
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/consents',
        headers: editorHeaders(),
        payload: {
          contactId: contact2Id,
          status: 'subscribed',
          source: 'csv_reimport',
        },
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('BR-CRM4-01');
    });
  });

  // =========================================================================
  // 5. Idempotency Key Handling & Replay Guarantees
  // =========================================================================
  describe('Idempotency & Replay Semantics', () => {
    it('replays identical response with x-idempotent-replay header on duplicate POST /lists', async () => {
      const idempotencyKey = `idem-list-${randomUUID()}`;

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/lists',
        headers: {
          ...editorHeaders(),
          'idempotency-key': idempotencyKey,
        },
        payload: {
          name: 'Idempotent Marketing Cohort',
          description: 'Testing duplicate POST replay',
        },
      });

      expect(res1.statusCode).toBe(201);
      const body1 = res1.json();
      expect(res1.headers['x-idempotent-replay']).toBeUndefined();

      // Second identical request
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/lists',
        headers: {
          ...editorHeaders(),
          'idempotency-key': idempotencyKey,
        },
        payload: {
          name: 'Idempotent Marketing Cohort',
          description: 'Testing duplicate POST replay',
        },
      });

      expect(res2.statusCode).toBe(201);
      expect(res2.headers['x-idempotent-replay']).toBe('true');
      const body2 = res2.json();
      expect(body2.id).toBe(body1.id);
      expect(body2.name).toBe(body1.name);
    });

    it('replays duplicate POST /campaigns without incrementing parent list campaignCount twice', async () => {
      const listId = '44444444-1111-4444-8444-000000000001';
      const beforeList = await service.getListById(listId);
      const initialCount = beforeList.campaignCount;
      const idempotencyKey = `idem-camp-${randomUUID()}`;

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/campaigns',
        headers: {
          ...editorHeaders(),
          'idempotency-key': idempotencyKey,
        },
        payload: {
          name: 'Idempotent Campaign Test',
          campaignDate: '2026-11-25',
          listId,
        },
      });

      expect(res1.statusCode).toBe(201);
      const afterFirstList = await service.getListById(listId);
      expect(afterFirstList.campaignCount).toBe(initialCount + 1);

      // Replay request with same key
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/campaigns',
        headers: {
          ...editorHeaders(),
          'idempotency-key': idempotencyKey,
        },
        payload: {
          name: 'Idempotent Campaign Test',
          campaignDate: '2026-11-25',
          listId,
        },
      });

      expect(res2.statusCode).toBe(201);
      expect(res2.headers['x-idempotent-replay']).toBe('true');
      const afterSecondList = await service.getListById(listId);
      // Verify count did NOT increment again
      expect(afterSecondList.campaignCount).toBe(initialCount + 1);
    });

    it('replays duplicate POST /campaigns/:id/members without duplicate conflict or double-counting', async () => {
      const campId = '44444444-2222-4444-8444-000000000002';
      const beforeCamp = await service.getCampaignById(campId);
      const initialCount = beforeCamp.memberCount;
      const idempotencyKey = `idem-mem-${randomUUID()}`;
      const contactId = '11111111-6666-4111-8111-000000000001';

      const res1 = await app.inject({
        method: 'POST',
        url: `/api/v1/crm-marketing/campaigns/${campId}/members`,
        headers: {
          ...editorHeaders(),
          'idempotency-key': idempotencyKey,
        },
        payload: {
          contactId,
          status: 'sent',
        },
      });

      expect(res1.statusCode).toBe(201);
      const afterFirstCamp = await service.getCampaignById(campId);
      expect(afterFirstCamp.memberCount).toBe(initialCount + 1);

      // Replay request with same idempotency key
      const res2 = await app.inject({
        method: 'POST',
        url: `/api/v1/crm-marketing/campaigns/${campId}/members`,
        headers: {
          ...editorHeaders(),
          'idempotency-key': idempotencyKey,
        },
        payload: {
          contactId,
          status: 'sent',
        },
      });

      expect(res2.statusCode).toBe(201);
      expect(res2.headers['x-idempotent-replay']).toBe('true');
      const afterSecondCamp = await service.getCampaignById(campId);
      expect(afterSecondCamp.memberCount).toBe(initialCount + 1);
    });
  });

  // =========================================================================
  // 6. RBAC & Access Control Enforcement on Mutation Endpoints
  // =========================================================================
  describe('RBAC Mutation Enforcement', () => {
    it('denies mutation to VIEWER role with 403 Forbidden on POST /lists', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/lists',
        headers: viewerHeaders(),
        payload: {
          name: 'Unauthorized List',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('denies mutation to unauthenticated caller with 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/lists',
        payload: {
          name: 'Anonymous List',
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it('allows ADMIN role full mutation privileges on POST /lists and PATCH /lists/:id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/lists',
        headers: adminHeaders(),
        payload: {
          name: 'Admin Managed Cohort',
          description: 'Created by administrator',
        },
      });

      expect(res.statusCode).toBe(201);
      const list = res.json();

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/crm-marketing/lists/${list.id}`,
        headers: adminHeaders(),
        payload: {
          description: 'Updated by administrator',
        },
      });

      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().description).toBe('Updated by administrator');
    });
  });
});
