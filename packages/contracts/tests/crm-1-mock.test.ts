import { describe, expect, it, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  Crm1MockStateStore,
  crm1MockServerPlugin,
} from '../src/crm-1-mock.js';
import { CRM1_API_PREFIX } from '../src/crm-1.js';

describe('CRM-1 Deterministic Mock Server Plugin', () => {
  let app: FastifyInstance;
  let store: Crm1MockStateStore;

  beforeEach(async () => {
    store = new Crm1MockStateStore();
    app = Fastify({ logger: false });
    await app.register(crm1MockServerPlugin, {
      store,
      prefix: CRM1_API_PREFIX,
    });
    await app.ready();
  });

  describe('Health Check', () => {
    it('returns healthy status on GET /health', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM1_API_PREFIX}/health`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('healthy');
      expect(body.module).toBe('crm-1');
      expect(body.mockServer).toBe(true);
      expect(body.entities.contacts).toBe(store.contacts.length);
    });
  });

  describe('Contacts API', () => {
    it('returns seeded mock contacts with pagination on GET /contacts', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM1_API_PREFIX}/contacts?page=1&pageSize=2`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(store.contacts.length);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(2);
    });

    it('filters contacts by search term', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM1_API_PREFIX}/contacts?search=Alex`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.items[0].firstName).toBe('Alex');
    });

    it('returns contact by ID on GET /contacts/:id', async () => {
      const target = store.contacts[0]!;
      const response = await app.inject({
        method: 'GET',
        url: `${CRM1_API_PREFIX}/contacts/${target.id}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(target.id);
    });

    it('returns 404 for unknown contact ID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM1_API_PREFIX}/contacts/00000000-0000-4000-8000-999999999999`,
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('NOT_FOUND');
    });

    it('creates new contact on valid POST /contacts', async () => {
      const payload = {
        firstName: 'Diana',
        lastName: 'Prince',
        email: 'diana.prince@synthetic.clearshift',
        phone: '+1-555-0777',
        companyId: store.companies[0]!.id,
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM1_API_PREFIX}/contacts`,
        payload,
      });

      expect(response.statusCode).toBe(201);
      const created = response.json();
      expect(created.firstName).toBe('Diana');
      expect(created.email).toBe('diana.prince@synthetic.clearshift');
      expect(created.leadStatus).toBe('New');
    });

    it('returns 404 when referencing nonexistent companyId on POST /contacts', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM1_API_PREFIX}/contacts`,
        payload: {
          firstName: 'Bruce',
          lastName: 'Wayne',
          companyId: '00000000-0000-4000-9000-999999999999',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('NOT_FOUND');
    });

    it('returns 409 Conflict when exact duplicate email is posted', async () => {
      const existing = store.contacts[0]!;
      const response = await app.inject({
        method: 'POST',
        url: `${CRM1_API_PREFIX}/contacts`,
        payload: {
          firstName: 'Another',
          lastName: 'Person',
          email: existing.email,
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('CONFLICT');
      expect(response.json().message).toContain('Duplicate contact detected');
    });

    it('updates contact on valid PATCH /contacts/:id', async () => {
      const target = store.contacts[0]!;
      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM1_API_PREFIX}/contacts/${target.id}`,
        payload: {
          phone: '+1-555-9876',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().phone).toBe('+1-555-9876');
    });

    it('returns 400 when empty patch is provided', async () => {
      const target = store.contacts[0]!;
      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM1_API_PREFIX}/contacts/${target.id}`,
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Companies API', () => {
    it('returns seeded mock companies on GET /companies', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM1_API_PREFIX}/companies`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.total).toBe(store.companies.length);
    });

    it('returns company by ID on GET /companies/:id', async () => {
      const target = store.companies[0]!;
      const response = await app.inject({
        method: 'GET',
        url: `${CRM1_API_PREFIX}/companies/${target.id}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe(target.name);
    });

    it('creates company on valid POST /companies', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM1_API_PREFIX}/companies`,
        payload: {
          name: 'Cyberdyne Systems Synthetic',
          taxNumber: 'US-CYBER-999',
          email: 'info@cyberdyne.synthetic',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().name).toBe('Cyberdyne Systems Synthetic');
    });

    it('returns 409 Conflict when duplicate tax number is posted for company', async () => {
      const existing = store.companies[0]!;
      const response = await app.inject({
        method: 'POST',
        url: `${CRM1_API_PREFIX}/companies`,
        payload: {
          name: 'Acme Clone Corp',
          taxNumber: existing.taxNumber,
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('CONFLICT');
      expect(response.json().message).toContain('Duplicate company detected');
    });

    it('patches company on valid PATCH /companies/:id', async () => {
      const target = store.companies[0]!;
      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM1_API_PREFIX}/companies/${target.id}`,
        payload: {
          phone: '+1-555-4321',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().phone).toBe('+1-555-4321');
    });
  });

  describe('Leads API', () => {
    it('returns seeded mock leads on GET /leads', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM1_API_PREFIX}/leads`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().items.length).toBeGreaterThanOrEqual(1);
    });

    it('creates lead on valid POST /leads', async () => {
      const contact = store.contacts[0]!;
      const response = await app.inject({
        method: 'POST',
        url: `${CRM1_API_PREFIX}/leads`,
        payload: {
          contactId: contact.id,
          status: 'New',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().status).toBe('New');
    });

    it('returns 404 on POST /leads with nonexistent contactId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM1_API_PREFIX}/leads`,
        payload: {
          contactId: '00000000-0000-4000-8000-999999999999',
          status: 'New',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('NOT_FOUND');
    });

    it('enforces SDS allowlist on PATCH /leads/:id: allows valid transition', async () => {
      const lead = store.leads.find((l) => l.status === 'New') ?? store.leads[0]!;
      lead.status = 'New';

      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM1_API_PREFIX}/leads/${lead.id}`,
        payload: {
          status: 'Working',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('Working');
    });

    it('enforces SDS allowlist on PATCH /leads/:id: returns 409 on disallowed transition', async () => {
      const lead = store.leads[0]!;
      lead.status = 'Qualified';

      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM1_API_PREFIX}/leads/${lead.id}`,
        payload: {
          status: 'New', // Disallowed: Qualified -> New
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('CONFLICT');
      expect(response.json().message).toContain('Disallowed lead status transition');
    });
  });

  describe('Imports API', () => {
    it('creates an import batch and processes rows on POST /imports', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM1_API_PREFIX}/imports`,
        payload: {
          sourceSystem: 'synthetic_crm_migration',
          rows: [
            {
              entity: 'contact',
              sourceRow: 1,
              data: {
                firstName: 'Imported',
                lastName: 'UserOne',
                email: 'imported.one@synthetic.test',
                sourceId: 'src-imp-001',
              },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      const batch = response.json();
      expect(batch.id).toBeDefined();
      expect(batch.loadedCount).toBe(1);
      expect(batch.rejectedCount).toBe(0);
    });

    it('retrieves batch detail on GET /imports/:batch', async () => {
      const seededBatch = Array.from(store.batches.values())[0]!.batch;
      const response = await app.inject({
        method: 'GET',
        url: `${CRM1_API_PREFIX}/imports/${seededBatch.id}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(seededBatch.id);
    });

    it('retrieves rejects on GET /imports/:batch/rejects', async () => {
      const seededBatch = Array.from(store.batches.values())[0]!.batch;
      const response = await app.inject({
        method: 'GET',
        url: `${CRM1_API_PREFIX}/imports/${seededBatch.id}/rejects`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().items).toBeInstanceOf(Array);
    });
  });
});
