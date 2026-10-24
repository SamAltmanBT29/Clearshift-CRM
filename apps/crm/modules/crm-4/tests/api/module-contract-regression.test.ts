import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Roles, signAccessToken } from '@cs/identity';
import {
  CRM4ListResponseSchema,
  CRM4ListSchema,
  CRM4CampaignListResponseSchema,
  CRM4CampaignSchema,
  CRM4MemberListResponseSchema,
  CRM4MemberSchema,
  CRM4ConsentSchema,
  CRM4_MEMBER_STATUSES,
  CRM4_CONSENT_STATUSES,
} from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import { Crm4Service } from '../../src/services/crm4.service.js';
import { Crm4AuditService } from '../../src/services/audit.js';
import { crm4Resolver } from '../../src/public.js';

const BASE_PATH = '/api/v1/crm-marketing';

describe('CRM-4 Module Contract and Regression Suite (Issue #182 / [CRM4-29])', () => {
  let app: ReturnType<typeof buildApp>;
  let service: Crm4Service;
  let auditService: Crm4AuditService;
  let adminToken: string;
  let editorToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    adminToken = await signAccessToken('contract-reg-admin', [Roles.ADMIN]);
    editorToken = await signAccessToken('contract-reg-editor', [Roles.EDITOR]);
    viewerToken = await signAccessToken('contract-reg-viewer', [Roles.VIEWER]);
  });

  beforeEach(() => {
    service = new Crm4Service();
    service.seedSyntheticData();
    auditService = new Crm4AuditService();
    app = buildApp({ service, auditService, authEnabled: true });
  });

  afterEach(async () => {
    await app.close();
  });

  const editorHeaders = () => ({ authorization: `Bearer ${editorToken}` });
  const viewerHeaders = () => ({ authorization: `Bearer ${viewerToken}` });
  const adminHeaders = () => ({ authorization: `Bearer ${adminToken}` });

  // ---------------------------------------------------------------------------
  // 1. Marketing Lists Lifecycle & Schema Conformance
  // ---------------------------------------------------------------------------
  describe('1. Marketing Lists Lifecycle & Contracts', () => {
    it('creates, reads, updates, and filters marketing lists with CRM4ListSchema and CRM4ListResponseSchema', async () => {
      // Create list
      const createRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/lists`,
        headers: editorHeaders(),
        payload: {
          name: 'Synthetic Enterprise VIP List 2026',
          description: 'High-tier enterprise accounts for global summit',
        },
      });

      expect(createRes.statusCode).toBe(201);
      const createdList = createRes.json();
      expect(CRM4ListSchema.safeParse(createdList).success).toBe(true);
      expect(createdList.name).toBe('Synthetic Enterprise VIP List 2026');
      expect(createdList.campaignCount).toBe(0);
      expect(createdList.memberCount).toBe(0);

      const listId = createdList.id;

      // Read single list
      const readRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/lists/${listId}`,
        headers: viewerHeaders(),
      });
      expect(readRes.statusCode).toBe(200);
      expect(CRM4ListSchema.safeParse(readRes.json()).success).toBe(true);
      expect(readRes.json().id).toBe(listId);

      // Patch list
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `${BASE_PATH}/lists/${listId}`,
        headers: editorHeaders(),
        payload: {
          description: 'Updated description for synthetic enterprise VIPs',
        },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().description).toBe('Updated description for synthetic enterprise VIPs');

      // Filter lists by search query
      const searchRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/lists?search=Enterprise+VIP&page=1&pageSize=10`,
        headers: viewerHeaders(),
      });
      expect(searchRes.statusCode).toBe(200);
      const searchBody = searchRes.json();
      expect(CRM4ListResponseSchema.safeParse(searchBody).success).toBe(true);
      expect(searchBody.items.length).toBe(1);
      expect(searchBody.items[0].id).toBe(listId);
      expect(searchBody.pagination.totalCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Campaigns Lifecycle & BR-CRM4-02 List Immutability
  // ---------------------------------------------------------------------------
  describe('2. Campaigns Lifecycle & Invariants', () => {
    it('creates campaign, verifies CRM4CampaignSchema, updates metadata, and enforces list_id immutability (BR-CRM4-02)', async () => {
      const listId = '44444444-1111-4444-8444-000000000001';

      // Create campaign
      const createRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/campaigns`,
        headers: editorHeaders(),
        payload: {
          name: 'Q4 Global Product Summit Announcement',
          campaignDate: '2026-11-20',
          listId,
        },
      });

      expect(createRes.statusCode).toBe(201);
      const campaign = createRes.json();
      expect(CRM4CampaignSchema.safeParse(campaign).success).toBe(true);
      expect(campaign.name).toBe('Q4 Global Product Summit Announcement');
      expect(campaign.listId).toBe(listId);
      expect(campaign.campaignDate).toBe('2026-11-20');

      const campaignId = campaign.id;

      // Update allowed metadata
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `${BASE_PATH}/campaigns/${campaignId}`,
        headers: editorHeaders(),
        payload: {
          name: 'Q4 Global Product Summit Announcement - Confirmed',
        },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().name).toBe('Q4 Global Product Summit Announcement - Confirmed');

      // Enforce BR-CRM4-02: attempt to change listId must be blocked
      const forbiddenPatchRes = await app.inject({
        method: 'PATCH',
        url: `${BASE_PATH}/campaigns/${campaignId}`,
        headers: editorHeaders(),
        payload: {
          listId: '44444444-1111-4444-8444-000000000002',
        },
      });
      expect(forbiddenPatchRes.statusCode).toBe(403);
      expect(forbiddenPatchRes.json().message).toContain('immutable');

      // Query campaigns
      const listCampaignsRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/campaigns?listId=${listId}`,
        headers: viewerHeaders(),
      });
      expect(listCampaignsRes.statusCode).toBe(200);
      const listBody = listCampaignsRes.json();
      expect(CRM4CampaignListResponseSchema.safeParse(listBody).success).toBe(true);
      expect(listBody.items.some((c: any) => c.id === campaignId)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Campaign Members Lifecycle, Status Allowlist & Deduplication
  // ---------------------------------------------------------------------------
  describe('3. Campaign Members Lifecycle, Allowlist & Uniqueness', () => {
    it('manages members, verifies status allowlist (sent, opened, clicked), and prevents duplicate membership', async () => {
      const campaignId = '44444444-2222-4444-8444-000000000001';
      const contactId = '11111111-1111-4111-8111-000000000088';

      // 1. Add member with valid status
      const addRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/campaigns/${campaignId}/members`,
        headers: editorHeaders(),
        payload: {
          contactId,
          status: 'sent',
        },
      });
      expect(addRes.statusCode).toBe(201);
      const member = addRes.json();
      expect(CRM4MemberSchema.safeParse(member).success).toBe(true);
      expect(member.status).toBe('sent');
      expect(member.contactId).toBe(contactId);

      // 2. Reject member with unpermitted status
      const invalidStatusRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/campaigns/${campaignId}/members`,
        headers: editorHeaders(),
        payload: {
          contactId: '11111111-1111-4111-8111-000000000089',
          status: 'bounced',
        },
      });
      expect(invalidStatusRes.statusCode).toBe(400);

      // 3. Prevent duplicate membership (campaignId#contactId uniqueness)
      const duplicateRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/campaigns/${campaignId}/members`,
        headers: editorHeaders(),
        payload: {
          contactId,
          status: 'opened',
        },
      });
      expect(duplicateRes.statusCode).toBe(409);

      // 4. Update existing member status through allowed status progression
      const patchMemberRes = await app.inject({
        method: 'PATCH',
        url: `${BASE_PATH}/campaigns/${campaignId}/members/${member.id}`,
        headers: editorHeaders(),
        payload: {
          status: 'opened',
        },
      });
      expect(patchMemberRes.statusCode).toBe(200);
      expect(patchMemberRes.json().status).toBe('opened');

      // 5. Query members with schema conformance
      const getMembersRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/campaigns/${campaignId}/members?status=opened`,
        headers: viewerHeaders(),
      });
      expect(getMembersRes.statusCode).toBe(200);
      const membersBody = getMembersRes.json();
      expect(CRM4MemberListResponseSchema.safeParse(membersBody).success).toBe(true);
      expect(membersBody.items.some((m: any) => m.id === member.id)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Consent State & Monotonic Opt-Out Rule (BR-CRM4-01)
  // ---------------------------------------------------------------------------
  describe('4. Consent Management & Monotonic Opt-Out (BR-CRM4-01)', () => {
    it('manages contact consent, reads state, records opt-out, and blocks re-subscribing', async () => {
      const contactId = '11111111-1111-4111-8111-000000000077';

      // 1. Initial consent recording (subscribed)
      const setRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/consents`,
        headers: editorHeaders(),
        payload: {
          contactId,
          status: 'subscribed',
          source: 'web_registration',
          consentDate: '2026-10-24T00:00:00Z',
        },
      });
      expect(setRes.statusCode).toBe(200);
      const consent = setRes.json();
      expect(CRM4ConsentSchema.safeParse(consent).success).toBe(true);
      expect(consent.status).toBe('subscribed');

      // 2. Read consent
      const readConsentRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/consents/${contactId}`,
        headers: viewerHeaders(),
      });
      expect(readConsentRes.statusCode).toBe(200);
      expect(CRM4ConsentSchema.safeParse(readConsentRes.json()).success).toBe(true);

      // 3. User opts out (unsubscribed)
      const optOutRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/consents`,
        headers: editorHeaders(),
        payload: {
          contactId,
          status: 'unsubscribed',
          source: 'email_unsubscribe_link',
          consentDate: '2026-10-24T01:00:00Z',
        },
      });
      expect(optOutRes.statusCode).toBe(200);
      expect(optOutRes.json().status).toBe('unsubscribed');

      // 4. BR-CRM4-01: strictly block re-subscription attempt
      const attemptReSubRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/consents`,
        headers: editorHeaders(),
        payload: {
          contactId,
          status: 'subscribed',
          source: 'accidental_bulk_reimport',
          consentDate: '2026-10-24T02:00:00Z',
        },
      });
      expect(attemptReSubRes.statusCode).toBe(409);
      expect(attemptReSubRes.json().message).toContain('BR-CRM4-01');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Migration Mapping Endpoints (#181 / [CRM4-28])
  // ---------------------------------------------------------------------------
  describe('5. Migration Mapping Templates & Dry-Run Validation', () => {
    it('serves mapping templates, validates field configs, and maps source data with enum coercion', async () => {
      // List all templates
      const templatesRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/mappings/templates`,
        headers: viewerHeaders(),
      });
      expect(templatesRes.statusCode).toBe(200);
      const templatesBody = templatesRes.json();
      expect(templatesBody.templates.length).toBe(8);
      expect(templatesBody.enums.member_status.allowlist).toEqual(CRM4_MEMBER_STATUSES);
      expect(templatesBody.enums.consent_status.allowlist).toEqual(CRM4_CONSENT_STATUSES);

      // Get single template
      const templateRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/mappings/templates/crm4-campaigns-canonical`,
        headers: viewerHeaders(),
      });
      expect(templateRes.statusCode).toBe(200);
      expect(templateRes.json().template.entity).toBe('crm4_campaigns');

      // Validate mapping config
      const validateRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/mappings/validate`,
        headers: editorHeaders(),
        payload: {
          templateId: 'crm4-lists-canonical',
          sourceColumns: ['id', 'name', 'description'],
        },
      });
      expect(validateRes.statusCode).toBe(200);
      expect(validateRes.json().ready).toBe(true);

      // Map rows with type coercion and enum normalization
      const mapRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/mappings/map`,
        headers: editorHeaders(),
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
      expect(mapRes.statusCode).toBe(200);
      const mapResult = mapRes.json();
      expect(mapResult.totalRows).toBe(2);
      expect(mapResult.successfulCount).toBe(2);
      expect(mapResult.failedCount).toBe(0);
      expect(mapResult.rows[0].status).toBe('subscribed');
      expect(mapResult.rows[1].status).toBe('unsubscribed');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Idempotent Repeated Read Stability Across All Endpoints
  // ---------------------------------------------------------------------------
  describe('6. Repeated Read Payload Stability', () => {
    it('maintains strict read payload stability across repeated GET requests', async () => {
      const readUrls = [
        `${BASE_PATH}/lists`,
        `${BASE_PATH}/lists/44444444-1111-4444-8444-000000000001`,
        `${BASE_PATH}/campaigns`,
        `${BASE_PATH}/campaigns/44444444-2222-4444-8444-000000000001`,
        `${BASE_PATH}/campaigns/44444444-2222-4444-8444-000000000001/members`,
        `${BASE_PATH}/consents/11111111-1111-4111-8111-000000000001`,
        `${BASE_PATH}/mappings/templates`,
        `${BASE_PATH}/mappings/templates/crm4-lists-canonical`,
      ];

      const firstPass = await Promise.all(
        readUrls.map((url) => app.inject({ method: 'GET', url, headers: viewerHeaders() }))
      );
      const secondPass = await Promise.all(
        readUrls.map((url) => app.inject({ method: 'GET', url, headers: viewerHeaders() }))
      );

      for (let i = 0; i < readUrls.length; i++) {
        expect(firstPass[i]?.statusCode).toBe(200);
        expect(secondPass[i]?.statusCode).toBe(200);
        expect(secondPass[i]?.payload).toBe(firstPass[i]?.payload);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 7. ClearShift Standard Error Envelopes (400, 401, 403, 404, 409)
  // ---------------------------------------------------------------------------
  describe('7. Error Envelopes & RBAC Access Control', () => {
    it('returns 401 Unauthorized when Authorization header is absent', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/lists`,
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHORIZED');
    });

    it('returns 403 Forbidden when VIEWER attempts write mutation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/lists`,
        headers: viewerHeaders(),
        payload: {
          name: 'Forbidden List Attempt',
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    });

    it('returns 400 Bad Request on schema validation failure', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/campaigns`,
        headers: editorHeaders(),
        payload: {
          name: '', // Empty name rejected by Zod
          campaignDate: 'invalid-date',
          listId: 'not-a-uuid',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 Not Found when requesting non-existent entities', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/lists/99999999-9999-9999-9999-999999999999`,
        headers: viewerHeaders(),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
    });

    it('returns 409 Conflict on idempotency or domain invariant collisions', async () => {
      const campaignId = '44444444-2222-4444-8444-000000000001';
      const existingContact = '11111111-1111-4111-8111-000000000001';

      const res = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/campaigns/${campaignId}/members`,
        headers: editorHeaders(),
        payload: {
          contactId: existingContact,
          status: 'sent',
        },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('CONFLICT');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Cross-Module Public Reference Resolver
  // ---------------------------------------------------------------------------
  describe('8. Public Crm4ReferenceResolver Integration', () => {
    it('supports exists() and get() for campaign, list, and consent entities', async () => {
      // Exists check
      expect(await crm4Resolver.exists('campaign', '44444444-2222-4444-8444-000000000001')).toBe(true);
      expect(await crm4Resolver.exists('list', '40000000-0000-4000-8000-000000000001')).toBe(true);
      expect(await crm4Resolver.exists('consent', '11111111-1111-4111-8111-000000000001')).toBe(true);
      expect(await crm4Resolver.exists('deal', 'unknown-id')).toBe(false);

      // Get check
      const campaign = await crm4Resolver.get('campaign', '44444444-2222-4444-8444-000000000001') as any;
      expect(campaign).toBeDefined();
      expect(campaign.id).toBe('44444444-2222-4444-8444-000000000001');

      const list = await crm4Resolver.get('list', '40000000-0000-4000-8000-000000000001') as any;
      expect(list).toBeDefined();
      expect(list.id).toBe('40000000-0000-4000-8000-000000000001');

      const consent = await crm4Resolver.get('consent', '11111111-1111-4111-8111-000000000001') as any;
      expect(consent).toBeDefined();
      expect(consent.contactId).toBe('11111111-1111-4111-8111-000000000001');

      const unknown = await crm4Resolver.get('unknown-type', '123');
      expect(unknown).toBeNull();
    });
  });
});
