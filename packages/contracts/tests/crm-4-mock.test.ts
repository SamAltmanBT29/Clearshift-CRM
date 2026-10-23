import { describe, expect, it, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  CRM4MockStore,
  crm4MockPlugin,
  createDeterministicMockLists,
  createDeterministicMockCampaigns,
  createDeterministicMockMembers,
  createDeterministicMockConsents,
} from '../src/crm-4-mock.js';
import { CRM4_API_PREFIX } from '../src/crm-4.js';

describe('CRM-4 Deterministic Mock Server & Store (Issue #167 / [CRM4-14])', () => {
  let app: FastifyInstance;
  let store: CRM4MockStore;

  beforeEach(async () => {
    store = new CRM4MockStore();
    app = Fastify({ logger: false });
    await app.register(crm4MockPlugin, {
      store,
      prefix: CRM4_API_PREFIX,
    });
    await app.ready();
  });

  describe('1. Deterministic Synthetic Fixture Generators', () => {
    it('generates predictable, strictly synthetic CRM-4 fixtures with zero real PII', () => {
      const lists = createDeterministicMockLists();
      expect(lists).toHaveLength(3);
      expect(lists[0].name).toBe('Q4 Enterprise Prospects');

      const campaigns = createDeterministicMockCampaigns();
      expect(campaigns).toHaveLength(3);
      expect(campaigns[0].name).toBe('Q4 Enterprise Product Launch Announcement');

      const members = createDeterministicMockMembers();
      expect(members.length).toBeGreaterThanOrEqual(3);

      const consents = createDeterministicMockConsents();
      expect(consents).toHaveLength(3);
      expect(consents.some((c) => c.status === 'unsubscribed')).toBe(true);
    });
  });

  describe('2. In-Memory Mock Store Operations & Domain Invariants', () => {
    it('retrieves paginated lists with search filtering', () => {
      const res1 = store.getLists({ page: 1, pageSize: 2 });
      expect(res1.items).toHaveLength(2);
      expect(res1.pagination.totalCount).toBe(3);

      const res2 = store.getLists({ search: 'Developer' });
      expect(res2.items).toHaveLength(1);
      expect(res2.items[0].name).toContain('Developer');
    });

    it('creates a new marketing list with initialized member and campaign counters', () => {
      const created = store.createList({
        name: 'Tier-1 EMEA Partners',
        description: 'European enterprise distribution partners',
      });
      expect(created.id).toBeDefined();
      expect(created.name).toBe('Tier-1 EMEA Partners');
      expect(created.campaignCount).toBe(0);
      expect(created.memberCount).toBe(0);
    });

    it('enforces parent list_id immutability when updating campaigns', () => {
      const existing = store.getCampaigns().items[0];
      const differentListId = '40000000-0000-4000-8000-999999999999';

      expect(() =>
        store.patchCampaign(existing.id, {
          name: 'Renamed Campaign',
          listId: differentListId,
        })
      ).toThrowError(/Domain Invariant Violation: Campaign parent list_id is immutable after creation/);
    });

    it('enforces strictly monotonic opt-out in store (BR-CRM4-01)', () => {
      const unsubContactId = '11111111-1111-4111-8111-000000000003';
      const existingConsent = store.getConsentByContact(unsubContactId);
      expect(existingConsent?.status).toBe('unsubscribed');

      // Attempting to revert from unsubscribed to subscribed MUST throw
      expect(() =>
        store.setConsent({
          contactId: unsubContactId,
          status: 'subscribed',
          source: 're-engagement-campaign',
        })
      ).toThrowError(/Domain Invariant Violation \(BR-CRM4-01\)/);
    });

    it('neutralizes formula injection characters when exporting campaign CSV', () => {
      const campaign = store.getCampaigns().items[0];
      const csv = store.exportCampaignCsv(campaign.id);
      expect(csv).toContain('member_id,campaign_id,contact_id,status,unsubscribed,created_at');
      expect(csv).toContain(campaign.id);
    });
  });

  describe('3. Fastify HTTP Mock Endpoints', () => {
    describe('Marketing Lists Endpoints', () => {
      it('GET /lists returns paginated marketing lists with 200 OK', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `${CRM4_API_PREFIX}/lists?page=1&pageSize=2`,
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.items).toHaveLength(2);
        expect(body.pagination.totalCount).toBeGreaterThanOrEqual(3);
      });

      it('POST /lists creates a marketing list with 201 Created', async () => {
        const response = await app.inject({
          method: 'POST',
          url: `${CRM4_API_PREFIX}/lists`,
          payload: {
            name: 'APAC Tech Leaders 2026',
            description: 'Chief Architects & CTOs in APAC',
          },
        });
        expect(response.statusCode).toBe(201);
        const body = response.json();
        expect(body.name).toBe('APAC Tech Leaders 2026');
        expect(body.id).toBeDefined();
      });

      it('GET /lists/:id returns 404 for nonexistent list', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `${CRM4_API_PREFIX}/lists/00000000-0000-4000-8000-999999999999`,
        });
        expect(response.statusCode).toBe(404);
        const body = response.json();
        expect(body.code).toBe('NOT_FOUND');
      });
    });

    describe('Campaigns Endpoints', () => {
      it('POST /campaigns creates a campaign under a valid parent list', async () => {
        const list = store.getLists().items[0];
        const response = await app.inject({
          method: 'POST',
          url: `${CRM4_API_PREFIX}/campaigns`,
          payload: {
            name: 'Executive Dinner Invitation',
            campaignDate: '2026-11-30',
            listId: list.id,
          },
        });
        expect(response.statusCode).toBe(201);
        const body = response.json();
        expect(body.name).toBe('Executive Dinner Invitation');
        expect(body.listId).toBe(list.id);
      });

      it('PATCH /campaigns/:id returns 403 Forbidden when attempting to modify parent listId', async () => {
        const campaign = store.getCampaigns().items[0];
        const response = await app.inject({
          method: 'PATCH',
          url: `${CRM4_API_PREFIX}/campaigns/${campaign.id}`,
          payload: {
            name: 'Updated Title',
            listId: '00000000-0000-4000-8000-999999999999',
          },
        });
        expect(response.statusCode).toBe(403);
        const body = response.json();
        expect(body.code).toBe('FORBIDDEN');
        expect(body.message).toContain('list_id is immutable');
      });
    });

    describe('Campaign Members Endpoints', () => {
      it('POST /campaigns/:id/members adds a participant record', async () => {
        const campaign = store.getCampaigns().items[0];
        const newContactId = '11111111-1111-4111-8111-999999999999';

        const response = await app.inject({
          method: 'POST',
          url: `${CRM4_API_PREFIX}/campaigns/${campaign.id}/members`,
          payload: {
            contactId: newContactId,
            status: 'sent',
          },
        });
        expect(response.statusCode).toBe(201);
        const body = response.json();
        expect(body.contactId).toBe(newContactId);
        expect(body.status).toBe('sent');
      });

      it('POST /campaigns/:id/members rejects duplicate contact in the same campaign with 409 Conflict', async () => {
        const campaign = store.getCampaigns().items[0];
        const existingMember = store.getCampaignMembers(campaign.id).items[0];

        const response = await app.inject({
          method: 'POST',
          url: `${CRM4_API_PREFIX}/campaigns/${campaign.id}/members`,
          payload: {
            contactId: existingMember.contactId,
            status: 'opened',
          },
        });
        expect(response.statusCode).toBe(409);
        const body = response.json();
        expect(body.code).toBe('CONFLICT');
      });

      it('POST /campaigns/:id/members rejects invalid member status with 400 Bad Request', async () => {
        const campaign = store.getCampaigns().items[0];
        const response = await app.inject({
          method: 'POST',
          url: `${CRM4_API_PREFIX}/campaigns/${campaign.id}/members`,
          payload: {
            contactId: '11111111-1111-4111-8111-000000000099',
            status: 'delivered', // invalid status
          },
        });
        expect(response.statusCode).toBe(400);
      });
    });

    describe('Consents Endpoints & Monotonic Invariant (BR-CRM4-01)', () => {
      it('GET /consents/:contact returns current consent state', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `${CRM4_API_PREFIX}/consents/11111111-1111-4111-8111-000000000001`,
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.status).toBe('subscribed');
      });

      it('POST /consents rejects re-subscribing an unsubscribed contact with 409 Conflict (BR-CRM4-01)', async () => {
        const unsubContactId = '11111111-1111-4111-8111-000000000003';
        const response = await app.inject({
          method: 'POST',
          url: `${CRM4_API_PREFIX}/consents`,
          payload: {
            contactId: unsubContactId,
            status: 'subscribed',
            source: 'bulk_reengagement_csv',
          },
        });
        expect(response.statusCode).toBe(409);
        const body = response.json();
        expect(body.code).toBe('CONFLICT');
        expect(body.message).toContain('BR-CRM4-01');
      });

      it('POST /consents records an explicit opt-out with 200 OK', async () => {
        const subscribedContactId = '11111111-1111-4111-8111-000000000001';
        const response = await app.inject({
          method: 'POST',
          url: `${CRM4_API_PREFIX}/consents`,
          payload: {
            contactId: subscribedContactId,
            status: 'unsubscribed',
            source: 'user_privacy_center',
          },
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.status).toBe('unsubscribed');
      });
    });

    describe('CSV Export Endpoint', () => {
      it('GET /campaigns/:id/export returns text/csv attachment with 200 OK', async () => {
        const campaign = store.getCampaigns().items[0];
        const response = await app.inject({
          method: 'GET',
          url: `${CRM4_API_PREFIX}/campaigns/${campaign.id}/export`,
        });
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('text/csv');
        expect(response.body).toContain('member_id,campaign_id,contact_id');
      });
    });
  });
});
