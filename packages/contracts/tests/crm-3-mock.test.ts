import { describe, expect, it, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  Crm3MockStateStore,
  crm3MockServerPlugin,
} from '../src/crm-3-mock.js';
import { CRM3_API_PREFIX } from '../src/crm-3.js';

describe('CRM-3 Deterministic Mock Server Plugin (Issue #147 / [CRM3-14])', () => {
  let app: FastifyInstance;
  let store: Crm3MockStateStore;

  beforeEach(async () => {
    store = new Crm3MockStateStore();
    app = Fastify({ logger: false });
    await app.register(crm3MockServerPlugin, {
      store,
      prefix: CRM3_API_PREFIX,
    });
    await app.ready();
  });

  describe('Health Check', () => {
    it('returns healthy status on GET /health', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/health`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('healthy');
      expect(body.module).toBe('crm-3');
      expect(body.mockServer).toBe(true);
      expect(body.entities.tickets).toBe(store.tickets.length);
      expect(body.entities.notes).toBe(store.notes.length);
    });
  });

  describe('Tickets API', () => {
    it('returns seeded mock tickets with pagination on GET /tickets', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?page=1&pageSize=10`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toHaveLength(10);
      expect(body.total).toBe(30);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(10);
    });

    it('rejects pageSize above 100 with HTTP 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?pageSize=101`,
      });
      expect(response.statusCode).toBe(400);
    });

    it('filters tickets strictly by status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?status=Waiting`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items.length).toBeGreaterThan(0);
      body.items.forEach((t: any) => {
        expect(t.status).toBe('Waiting');
      });
    });

    it('filters tickets strictly by priority', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?priority=High`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items.length).toBeGreaterThan(0);
      body.items.forEach((t: any) => {
        expect(t.priority).toBe('High');
      });
    });

    it('filters tickets by search query on subject', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?search=issue+%235`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.items[0].subject.toLowerCase()).toContain('issue #5');
    });

    it('orders tickets descending by createdAt with tie-breaker', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets?page=1&pageSize=30`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      for (let i = 0; i < body.items.length - 1; i++) {
        const curr = new Date(body.items[i].createdAt).getTime();
        const next = new Date(body.items[i + 1].createdAt).getTime();
        expect(curr).toBeGreaterThanOrEqual(next);
      }
    });

    it('returns single ticket with enriched contact on GET /tickets/:id', async () => {
      const ticketId = '30000000-0000-4000-8000-000000000001';
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets/${ticketId}`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(ticketId);
      expect(body.contactName).toBeDefined();
    });

    it('returns 404 when ticket ID does not exist on GET /tickets/:id', async () => {
      const missingId = '00000000-0000-4000-8000-000000000999';
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets/${missingId}`,
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns 400 when ticket ID is not a valid UUID on GET /tickets/:id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets/not-a-valid-uuid`,
      });
      expect(response.statusCode).toBe(400);
    });

    it('creates a new ticket on POST /tickets and appends optional initial note', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        payload: {
          subject: 'Critical outage on checkout gateway',
          status: 'Open',
          priority: 'Urgent',
          contactId: '90000000-0000-4000-8000-000000000001',
          orderRef: 'ORD-7777',
          note: 'Customer reported repeated 504 gateway timeout.',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.subject).toBe('Critical outage on checkout gateway');
      expect(body.status).toBe('Open');
      expect(body.priority).toBe('Urgent');

      // Verify the initial note is present
      const notesRes = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets/${body.id}/notes`,
      });
      expect(notesRes.statusCode).toBe(200);
      const notesBody = notesRes.json();
      expect(notesBody.items).toHaveLength(1);
      expect(notesBody.items[0].noteText).toBe('Customer reported repeated 504 gateway timeout.');
    });

    it('rejects ticket creation with invalid status with HTTP 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        payload: {
          subject: 'Invalid ticket',
          status: 'BogusStatus',
          contactId: '90000000-0000-4000-8000-000000000001',
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it('updates mutable ticket fields on PATCH /tickets/:id', async () => {
      const ticketId = '30000000-0000-4000-8000-000000000001';
      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${ticketId}`,
        payload: {
          status: 'Solved',
          priority: 'Urgent',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('Solved');
      expect(body.priority).toBe('Urgent');
    });

    it('returns 404 when patching non-existent ticket', async () => {
      const missingId = '00000000-0000-4000-8000-000000000999';
      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${missingId}`,
        payload: {
          status: 'Closed',
        },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('Notes API', () => {
    it('returns notes newest-first on GET /tickets/:id/notes', async () => {
      const ticketId = '30000000-0000-4000-8000-000000000001';
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets/${ticketId}/notes`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < body.items.length - 1; i++) {
        const curr = new Date(body.items[i].createdAt).getTime();
        const next = new Date(body.items[i + 1].createdAt).getTime();
        expect(curr).toBeGreaterThanOrEqual(next);
      }
    });

    it('appends note via POST /notes', async () => {
      const ticketId = '30000000-0000-4000-8000-000000000001';
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/notes`,
        payload: {
          ticketId,
          noteText: 'Checked network configurations: all green.',
          authorId: 'agent.charlie',
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.ticketId).toBe(ticketId);
      expect(body.noteText).toBe('Checked network configurations: all green.');
    });

    it('appends note via POST /tickets/:id/notes REST alias', async () => {
      const ticketId = '30000000-0000-4000-8000-000000000001';
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets/${ticketId}/notes`,
        payload: {
          noteText: 'Alias endpoint note append verification.',
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.ticketId).toBe(ticketId);
      expect(body.noteText).toBe('Alias endpoint note append verification.');
    });

    it('returns 404 when appending note to non-existent ticket', async () => {
      const missingId = '00000000-0000-4000-8000-000000000999';
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/notes`,
        payload: {
          ticketId: missingId,
          noteText: 'Orphan note',
        },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('Migration Kit Import Stubs', () => {
    it('creates import batch with receipts on POST /imports', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/imports`,
        payload: {
          sourceSystem: 'jira_helpdesk',
          rows: [
            { sourceRow: 1, entity: 'ticket', sourceId: 'TCK-1' },
            { sourceRow: 2, entity: 'note', sourceId: 'NOTE-1' },
          ],
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.sourceSystem).toBe('jira_helpdesk');
      expect(body.loadedCount).toBe(2);

      // Verify retrieval via GET /imports/:batch
      const getRes = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/imports/${body.id}`,
      });
      expect(getRes.statusCode).toBe(200);
      const getBody = getRes.json();
      expect(getBody.receipts).toHaveLength(2);
    });

    it('returns 404 for non-existent import batch on GET /imports/:batch', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/imports/batch-does-not-exist`,
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
