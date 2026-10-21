import { describe, it, expect, beforeAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { Crm1Service } from '../../src/services/crm1.service.js';
import {
  PaginatedContactsResponseSchema,
  PaginatedCompaniesResponseSchema,
  PaginatedLeadsResponseSchema,
  PaginatedCrm1RejectsResponseSchema,
  ContactSchema,
  CompanySchema,
  LeadSchema,
  Crm1ImportRunSchema,
} from '@clearshift/contracts';

describe('CRM-1 List/Read API & Contracts (Issue #7 / [CRM1-02])', () => {
  let app: ReturnType<typeof buildApp>;
  let service: Crm1Service;

  beforeAll(async () => {
    service = new Crm1Service();
    await service.seedSyntheticData();
    app = buildApp({ service });
  });

  // ---------------------------------------------------------------------------
  // 1. Health Check Endpoint
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-contacts/health', () => {
    it('returns 200 OK with service metadata and module version', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toEqual({
        status: 'ok',
        module: 'crm-1',
        name: 'Contacts, Companies and Leads',
        version: '1.0.0',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Contacts API (/contacts)
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-contacts/contacts', () => {
    it('returns 200 with default pagination (pageSize=25) and validates against Zod contract', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      const parsed = PaginatedContactsResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);

      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(25);
      expect(body.limit).toBe(25);
      expect(body.total).toBe(32);
      expect(body.totalPages).toBe(2);
      expect(body.items.length).toBe(25);
    });

    it('returns deterministic, non-overlapping records across page 1 and page 2', async () => {
      const page1Res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts?page=1&pageSize=25',
      });
      const page2Res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts?page=2&pageSize=25',
      });

      expect(page1Res.statusCode).toBe(200);
      expect(page2Res.statusCode).toBe(200);

      const page1 = JSON.parse(page1Res.payload);
      const page2 = JSON.parse(page2Res.payload);

      expect(page1.items.length).toBe(25);
      expect(page2.items.length).toBe(7);

      const page1Ids = new Set(page1.items.map((c: { id: string }) => c.id));
      const page2Ids = new Set(page2.items.map((c: { id: string }) => c.id));

      for (const id of page2Ids) {
        expect(page1Ids.has(id)).toBe(false);
      }
    });

    it('enforces deterministic sort order: createdAt desc, then id asc', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts?page=1&pageSize=30',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      for (let i = 0; i < body.items.length - 1; i++) {
        const curr = new Date(body.items[i].createdAt).getTime();
        const next = new Date(body.items[i + 1].createdAt).getTime();
        expect(curr).toBeGreaterThanOrEqual(next);
        if (curr === next) {
          expect(body.items[i].id.localeCompare(body.items[i + 1].id)).toBeLessThanOrEqual(0);
        }
      }
    });

    it('filters contacts server-side by name (case-insensitive)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts?search=ALICE',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.total).toBe(1);
      expect(body.items[0].firstName).toBe('Alice');
      expect(body.items[0].lastName).toBe('Anderson');
    });

    it('filters contacts server-side by email search (case-insensitive)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts?search=baker@clearshift',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.total).toBe(1);
      expect(body.items[0].email).toBe('bob.baker@clearshift.synthetic');
    });

    it('filters contacts server-side by exact email', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts?email=charlie.clark@clearshift.synthetic',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.total).toBe(1);
      expect(body.items[0].firstName).toBe('Charlie');
    });

    it('filters contacts by leadStatus', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts?leadStatus=Qualified',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.items.length).toBeGreaterThan(0);
      for (const item of body.items) {
        expect(item.leadStatus).toBe('Qualified');
      }
    });

    it('filters contacts by companyId', async () => {
      const companyId = '11111111-1111-4111-8111-111111111111';
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-contacts/contacts?companyId=${companyId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.items.length).toBeGreaterThan(0);
      for (const item of body.items) {
        expect(item.companyId).toBe(companyId);
      }
    });

    it('returns empty result cleanly when search matches nothing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts?search=NONEXISTENT_NAME_XYZ',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.total).toBe(0);
      expect(body.totalPages).toBe(0);
      expect(body.items).toEqual([]);
    });

    it('rejects pageSize > 100 with 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts?pageSize=101',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('BAD_REQUEST');
      expect(body.error.message).toContain('Invalid query parameters');
    });

    it('rejects limit > 100 with 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts?limit=150',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('BAD_REQUEST');
    });

    it('rejects negative or zero page parameter with 400', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts?page=0',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('BAD_REQUEST');
    });

    it('safely ignores unknown query parameters without altering results', async () => {
      const responseWithUnknown = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts?unknownParam=dropTable&another=123',
      });

      expect(responseWithUnknown.statusCode).toBe(200);
      const body = JSON.parse(responseWithUnknown.payload);
      expect(body.total).toBe(32);
    });

    it('does not leak internal sensitive fields or secrets', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts?page=1&pageSize=5',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      for (const item of body.items) {
        expect(item.password).toBeUndefined();
        expect(item.secret).toBeUndefined();
        expect(item.bankAccount).toBeUndefined();
        expect(item.rawPayload).toBeUndefined();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Contact Detail & Mutation
  // ---------------------------------------------------------------------------
  describe('GET /contacts/:id and Mutations', () => {
    it('returns contact detail for valid existing UUID', async () => {
      const contactId = '00000000-0000-4000-8000-010000000000';
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-contacts/contacts/${contactId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      const parsed = ContactSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body.id).toBe(contactId);
      expect(body.firstName).toBe('Alice');
    });

    it('returns 404 for non-existent contact UUID', async () => {
      const nonExistent = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-contacts/contacts/${nonExistent}`,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 for malformed UUID in path', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts/not-a-uuid',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('BAD_REQUEST');
    });

    it('creates contact successfully with valid company link and initial lead status', async () => {
      const newContact = {
        firstName: 'Jonathan',
        lastName: 'Doe',
        email: 'jonathan.doe@clearshift.synthetic',
        phone: '+1-555-9999',
        companyId: '11111111-1111-4111-8111-111111111111',
        leadStatus: 'Working',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/contacts',
        payload: newContact,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.firstName).toBe('Jonathan');
      expect(body.email).toBe('jonathan.doe@clearshift.synthetic');
      expect(body.companyId).toBe(newContact.companyId);
      expect(body.leadStatus).toBe('Working');
      expect(body.goldenId).toBeDefined();
    });

    it('rejects contact creation when referenced company does not exist', async () => {
      const newContact = {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.doe@clearshift.synthetic',
        companyId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/contacts',
        payload: newContact,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('BAD_REQUEST');
      expect(body.error.message).toContain('does not exist');
    });

    it('rejects contact creation with invalid lead status not in allowlist', async () => {
      const newContact = {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.doe@clearshift.synthetic',
        leadStatus: 'InvalidStatus',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/contacts',
        payload: newContact,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('BAD_REQUEST');
    });

    it('patches existing contact fields and updates timestamp', async () => {
      const contactId = '00000000-0000-4000-8000-010000000000';
      const patchPayload = {
        firstName: 'Alicia',
        leadStatus: 'Qualified',
      };

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/crm-contacts/contacts/${contactId}`,
        payload: patchPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.firstName).toBe('Alicia');
      expect(body.leadStatus).toBe('Qualified');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Companies API (/companies)
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-contacts/companies', () => {
    it('lists companies with bounded pagination and validates against Zod schema', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/companies',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      const parsed = PaginatedCompaniesResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body.total).toBe(4);
      expect(body.items.length).toBe(4);
    });

    it('searches companies by name server-side (case-insensitive)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/companies?search=GLOBEX',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.total).toBe(1);
      expect(body.items[0].name).toBe('Globex Industries');
    });

    it('searches companies by taxNumber server-side', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/companies?taxNumber=US-ACME-001',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.total).toBe(1);
      expect(body.items[0].name).toBe('Acme Corporation');
    });

    it('creates and fetches company by ID', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/companies',
        payload: {
          name: 'Wayne Enterprises',
          taxNumber: 'US-WAYNE-999',
          city: 'Gotham',
        },
      });

      expect(createRes.statusCode).toBe(201);
      const created = JSON.parse(createRes.payload);
      expect(created.id).toBeDefined();
      expect(created.name).toBe('Wayne Enterprises');

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-contacts/companies/${created.id}`,
      });

      expect(getRes.statusCode).toBe(200);
      const fetched = JSON.parse(getRes.payload);
      expect(fetched.taxNumber).toBe('US-WAYNE-999');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Leads API (/leads)
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-contacts/leads', () => {
    it('lists leads with bounded pagination and validates against Zod schema', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/leads',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      const parsed = PaginatedLeadsResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body.total).toBe(4);
    });

    it('filters leads by status (New, Working, Qualified, Closed)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/leads?status=Working',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.total).toBe(1);
      expect(body.items[0].status).toBe('Working');
    });

    it('creates lead with valid status and fetches by ID', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/leads',
        payload: {
          name: 'New Strategic Partner',
          email: 'partner@external.synthetic',
          status: 'New',
        },
      });

      expect(createRes.statusCode).toBe(201);
      const created = JSON.parse(createRes.payload);
      expect(created.name).toBe('New Strategic Partner');

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-contacts/leads/${created.id}`,
      });
      expect(getRes.statusCode).toBe(200);
    });

    it('rejects lead creation with invalid status', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/leads',
        payload: {
          name: 'Bad Lead',
          email: 'bad@external.synthetic',
          status: 'UnknownStatus',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('BAD_REQUEST');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Imports & Rejects API (/imports)
  // ---------------------------------------------------------------------------
  describe('Imports and Rejects endpoints', () => {
    it('starts an import run with valid batch payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/imports',
        payload: {
          batchId: 'batch-test-001',
          sourceSystem: 'csv_upload',
          filename: 'contacts.csv',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      const parsed = Crm1ImportRunSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body.batchId).toBe('batch-test-001');
      expect(body.status).toBe('running');
    });

    it('fetches status of an existing import run', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/imports/batch-contacts-01',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.batchId).toBe('batch-contacts-01');
      expect(body.status).toBe('completed');
      expect(body.recordsIn).toBe(100);
      expect(body.recordsRejected).toBe(2);
    });

    it('returns 404 for unknown import batch', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/imports/batch-unknown-999',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('fetches rejects for a batch with pagination', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/imports/batch-contacts-01/rejects',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      const parsed = PaginatedCrm1RejectsResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body.total).toBe(2);
      expect(body.items.length).toBe(2);
      expect(body.items[0].errorCode).toBe('INVALID_EMAIL_FORMAT');
    });

    it('returns empty list for a batch with 0 rejects', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/imports/batch-companies-01/rejects',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.total).toBe(0);
      expect(body.items).toEqual([]);
    });
  });
});
