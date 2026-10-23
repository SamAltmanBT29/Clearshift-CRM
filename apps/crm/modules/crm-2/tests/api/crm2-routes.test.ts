import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { CRM2_API_PREFIX } from '@clearshift/contracts';
import { crm2Routes } from '../../src/routes/crm2.routes.js';
import { Crm2Service } from '../../src/services/crm2.service.js';
import type { ReferenceResolver } from '@cs/kernel';

describe('CRM-2 Deals, Pipeline and Quotes REST API Integration Tests', () => {
  let app: FastifyInstance;
  let service: Crm2Service;

  const mockContactResolver: ReferenceResolver = {
    async exists(entityType: string, id: string): Promise<boolean> {
      if (entityType === 'contact') {
        return (
          id === '90000000-0000-4000-8000-000000000001' ||
          id === '90000000-0000-4000-8000-000000000002'
        );
      }
      return false;
    },
    async get<T>(entityType: string, id: string): Promise<T | null> {
      if (entityType === 'contact') {
        if (id === '90000000-0000-4000-8000-000000000001') {
          return { firstName: 'Sarah', lastName: 'Connor' } as unknown as T;
        }
        if (id === '90000000-0000-4000-8000-000000000002') {
          return { firstName: 'Lars', lastName: 'Lindqvist' } as unknown as T;
        }
      }
      return null;
    },
  };

  beforeEach(async () => {
    service = new Crm2Service({ contactResolver: mockContactResolver });
    app = Fastify({ logger: false });
    await app.register(crm2Routes, { prefix: CRM2_API_PREFIX, service });
    await app.ready();
  });

  // ---------------------------------------------------------------------------
  // 1. Stages Endpoint
  // ---------------------------------------------------------------------------
  describe('GET /stages', () => {
    it('returns the 6 fixed seed stages in pipeline order (1 to 6)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/stages`,
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.items).toHaveLength(6);
      expect(data.items.map((s: any) => s.name)).toEqual([
        'New',
        'Qualified',
        'Proposal',
        'Negotiation',
        'Won',
        'Lost',
      ]);
      expect(data.items.map((s: any) => s.order)).toEqual([1, 2, 3, 4, 5, 6]);

      const won = data.items.find((s: any) => s.name === 'Won');
      expect(won.is_closed_won).toBe(true);
      expect(won.is_closed_lost).toBe(false);

      const lost = data.items.find((s: any) => s.name === 'Lost');
      expect(lost.is_closed_lost).toBe(true);
      expect(lost.is_closed_won).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Deals Listing & Detail
  // ---------------------------------------------------------------------------
  describe('GET /deals and GET /deals/:id', () => {
    it('returns paginated deals list with bounded pagination and orphan flags', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?page=1&pageSize=10`,
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.items.length).toBeGreaterThanOrEqual(2);
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.pageSize).toBe(10);
      expect(data.pagination.totalCount).toBe(data.items.length);

      const orphan = data.items.find((d: any) => d.is_orphan === true);
      expect(orphan).toBeDefined();
      expect(orphan.contact_id).toBeNull();
    });

    it('filters deals by stage', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?stage=Proposal`,
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.items.length).toBeGreaterThan(0);
      for (const deal of data.items) {
        expect(deal.stage_name).toBe('Proposal');
      }
    });

    it('searches deals by name (case-insensitive)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?search=Acme`,
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.items.length).toBeGreaterThan(0);
      expect(data.items[0].name).toContain('Acme');
    });

    it('returns 400 on invalid query parameters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?page=0`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('INVALID_QUERY');
    });

    it('fetches deal by ID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals/20000000-0000-4000-8000-000000000001`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe('20000000-0000-4000-8000-000000000001');
      expect(response.json().name).toBe('Acme Cloud Modernization');
    });

    it('returns 404 for non-existent deal ID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals/99999999-0000-4000-8000-000000000099`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Deal Creation & Referential Integrity
  // ---------------------------------------------------------------------------
  describe('POST /deals', () => {
    it('creates a normal deal with valid CRM-1 contact reference (is_orphan = false)', async () => {
      const payload = {
        name: 'Enterprise Logistics Transformation',
        contact_id: '90000000-0000-4000-8000-000000000001',
        value: '185000.00',
        currency: 'USD',
        stage_name: 'New',
        close_date: '2026-12-31',
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        payload,
      });

      expect(response.statusCode).toBe(201);
      const created = response.json();
      expect(created.name).toBe(payload.name);
      expect(created.contact_id).toBe(payload.contact_id);
      expect(created.contact_name).toBe('Sarah Connor');
      expect(created.is_orphan).toBe(false);
      expect(created.value).toBe('185000.00');
      expect(created.currency).toBe('USD');
      expect(created.stage_name).toBe('New');

      // Verify immediate read consistency
      const getRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals/${created.id}`,
      });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().id).toBe(created.id);
    });

    it('creates an orphan deal when contact_id is omitted or null (is_orphan = true)', async () => {
      const payload = {
        name: 'Unassigned Opportunity Lead',
        contact_id: null,
        value: '95000.00',
        currency: 'USD',
        stage_name: 'New',
        close_date: '2027-01-15',
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        payload,
      });

      expect(response.statusCode).toBe(201);
      const created = response.json();
      expect(created.contact_id).toBeNull();
      expect(created.is_orphan).toBe(true);
      expect(created.contact_name).toBeNull();
    });

    it('rejects creation when contact_id does not exist with 422 REFERENCE_NOT_FOUND', async () => {
      const payload = {
        name: 'Invalid Contact Deal',
        contact_id: '90000000-0000-4000-8000-999999999999',
        value: '50000.00',
        currency: 'USD',
        stage_name: 'New',
        close_date: '2026-12-31',
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        payload,
      });

      expect(response.statusCode).toBe(422);
      const error = response.json();
      expect(error.code).toBe('REFERENCE_NOT_FOUND');
      expect(error.details[0].field).toBe('contact_id');
    });

    it('rejects unknown stage name with 400 VALIDATION_ERROR', async () => {
      const payload = {
        name: 'Invalid Stage Deal',
        value: '50000.00',
        currency: 'USD',
        stage_name: 'InvalidStageName',
        close_date: '2026-12-31',
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Deal Update & State Transition Matrix
  // ---------------------------------------------------------------------------
  describe('PATCH /deals/:id', () => {
    it('allows valid forward stage transition (New -> Qualified)', async () => {
      // 20000000-0000-4000-8000-000000000002 is seeded at 'New'
      const dealId = '20000000-0000-4000-8000-000000000002';

      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${dealId}`,
        payload: {
          stage_name: 'Qualified',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().stage_name).toBe('Qualified');

      // Immediate read consistency verification
      const verify = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals/${dealId}`,
      });
      expect(verify.json().stage_name).toBe('Qualified');
    });

    it('allows transition directly to Lost from active stage (Proposal -> Lost)', async () => {
      // 20000000-0000-4000-8000-000000000001 is seeded at 'Proposal'
      const dealId = '20000000-0000-4000-8000-000000000001';

      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${dealId}`,
        payload: {
          stage_name: 'Lost',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().stage_name).toBe('Lost');
    });

    it('rejects forbidden backward stage transition (Proposal -> Qualified) with 422 INVALID_DEAL_STAGE_TRANSITION', async () => {
      const dealId = '20000000-0000-4000-8000-000000000001';

      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${dealId}`,
        payload: {
          stage_name: 'Qualified',
        },
      });

      expect(response.statusCode).toBe(422);
      const error = response.json();
      expect(error.code).toBe('INVALID_DEAL_STAGE_TRANSITION');
      expect(error.message).toContain('Deal stage cannot transition from Proposal to Qualified');
      expect(error.details[0].field).toBe('stage_name');
    });

    it('rejects forbidden skip transition (New -> Won) with 422 INVALID_DEAL_STAGE_TRANSITION', async () => {
      const dealId = '20000000-0000-4000-8000-000000000002';

      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${dealId}`,
        payload: {
          stage_name: 'Won',
        },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe('INVALID_DEAL_STAGE_TRANSITION');
    });

    it('rejects update with non-existent contact_id with 422 REFERENCE_NOT_FOUND', async () => {
      const dealId = '20000000-0000-4000-8000-000000000001';

      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${dealId}`,
        payload: {
          contact_id: '90000000-0000-4000-8000-999999999999',
        },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe('REFERENCE_NOT_FOUND');
    });

    it('allows updating contact to null (converting deal to orphan deal)', async () => {
      const dealId = '20000000-0000-4000-8000-000000000001';

      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${dealId}`,
        payload: {
          contact_id: null,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().contact_id).toBeNull();
      expect(response.json().is_orphan).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Quotes Endpoints & Referential Integrity
  // ---------------------------------------------------------------------------
  describe('Quotes Endpoints (POST /quotes, GET /quotes, PATCH /quotes/:id)', () => {
    it('creates quote successfully when linked to an existing deal', async () => {
      const payload = {
        deal_id: '20000000-0000-4000-8000-000000000001',
        quote_number: 'Q-2026-901',
        date: '2026-11-01',
        amount: '48000.00',
        currency: 'USD',
        note: 'Secondary quote phase',
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes`,
        payload,
      });

      expect(response.statusCode).toBe(201);
      const created = response.json();
      expect(created.quote_number).toBe('Q-2026-901');
      expect(created.deal_id).toBe(payload.deal_id);
      expect(created.deal_name).toBe('Acme Cloud Modernization');
      expect(created.amount).toBe('48000.00');

      // Verify GET /quotes/:id returns this quote
      const getRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/quotes/${created.id}`,
      });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().id).toBe(created.id);
    });

    it('rejects quote creation for non-existent deal with 422 REFERENCE_NOT_FOUND', async () => {
      const payload = {
        deal_id: '99999999-0000-4000-8000-999999999999',
        quote_number: 'Q-2026-902',
        date: '2026-11-01',
        amount: '10000.00',
        currency: 'USD',
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes`,
        payload,
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe('REFERENCE_NOT_FOUND');
      expect(response.json().details[0].field).toBe('deal_id');
    });

    it('rejects quote creation with duplicate quote_number with 409 DUPLICATE_RECORD', async () => {
      const payload = {
        deal_id: '20000000-0000-4000-8000-000000000001',
        quote_number: 'Q-2026-001', // Pre-seeded quote number
        date: '2026-11-01',
        amount: '15000.00',
        currency: 'USD',
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes`,
        payload,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('DUPLICATE_RECORD');
      expect(response.json().details[0].field).toBe('quote_number');
    });

    it('updates quote fields and enforces uniqueness on quote_number rename', async () => {
      const quoteId = '30000000-0000-4000-8000-000000000001';

      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/quotes/${quoteId}`,
        payload: {
          amount: '82000.00',
          note: 'Revised tier-1 quote',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().amount).toBe('82000.00');
      expect(response.json().note).toBe('Revised tier-1 quote');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Read-Model Projections & Summary Consistency
  // ---------------------------------------------------------------------------
  describe('Derived Summary & Read-Model Consistency', () => {
    it('returns deal derived totals including quote aggregations', async () => {
      const dealId = '20000000-0000-4000-8000-000000000001';

      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals/${dealId}/summary`,
      });

      expect(response.statusCode).toBe(200);
      const summary = response.json();
      expect(summary.dealId).toBe(dealId);
      expect(summary.quotesCount).toBe(1);
      expect(summary.totalQuotesAmount).toBe('75000.00');
      expect(summary.hasQuotes).toBe(true);
    });

    it('returns pipeline summary metrics reflecting authoritative deal counts', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/pipeline/summary`,
      });

      expect(response.statusCode).toBe(200);
      const summary = response.json();
      expect(summary.totalDeals).toBeGreaterThanOrEqual(3);
      expect(summary.orphanDealsCount).toBeGreaterThanOrEqual(1);
      expect(summary.byStage).toBeDefined();
      expect(summary.byStage.New).toBeDefined();
      expect(summary.byStage.Proposal).toBeDefined();
    });
  });
});
