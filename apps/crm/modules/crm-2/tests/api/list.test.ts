import { describe, it, expect, beforeAll } from 'vitest';
import { Roles, signAccessToken } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { Crm2Service } from '../../src/services/crm2.service.js';
import {
  CRM2_API_PREFIX,
  CRM2_STAGES,
  CRM2_STAGE_SEEDS,
  assertValidStageName,
  DealsListResponseSchema,
  StagesListResponseSchema,
  QuotesListResponseSchema,
  DealSchema,
  QuoteSchema,
  Crm2HealthResponseSchema,
} from '@clearshift/contracts';

describe('CRM-2 Deals, Pipeline and Quotes: List/Read API & Contracts (Issue #17 / [CRM2-02])', () => {
  let app: ReturnType<typeof buildApp>;
  let service: Crm2Service;
  let viewerHeaders: { authorization: string };
  let editorHeaders: { authorization: string };
  let adminHeaders: { authorization: string };

  beforeAll(async () => {
    service = new Crm2Service();
    service.seedPaginationFixtures(32);
    app = buildApp({ service, enforceAuth: true });
    await app.ready();

    const viewerToken = await signAccessToken('synthetic-viewer', [Roles.VIEWER]);
    viewerHeaders = { authorization: `Bearer ${viewerToken}` };

    const editorToken = await signAccessToken('synthetic-editor', [
      Roles.EDITOR,
      Roles.VIEWER,
      Roles.MIGRATION_RUNNER,
    ]);
    editorHeaders = { authorization: `Bearer ${editorToken}` };

    const adminToken = await signAccessToken('synthetic-admin', [Roles.ADMIN]);
    adminHeaders = { authorization: `Bearer ${adminToken}` };
  });

  // ---------------------------------------------------------------------------
  // 1. Health Check Endpoint
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-deals/health', () => {
    it('returns 200 OK with service metadata and module version without requiring auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/health`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      const parsed = Crm2HealthResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body).toEqual({
        status: 'ok',
        module: 'crm-2',
        name: 'CRM-2 Deals, Pipeline and Quotes',
        version: '1.0.0',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Fixed Stages API (/stages)
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-deals/stages', () => {
    it('returns the 6 fixed pipeline stages in deterministic order (1..6) and validates against Zod contract', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/stages`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      const parsed = StagesListResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);

      expect(body.items).toHaveLength(6);
      expect(body.items.map((s: { name: string }) => s.name)).toEqual([
        'New',
        'Qualified',
        'Proposal',
        'Negotiation',
        'Won',
        'Lost',
      ]);
      expect(body.items.map((s: { order: number }) => s.order)).toEqual([1, 2, 3, 4, 5, 6]);

      const won = body.items.find((s: { name: string }) => s.name === 'Won');
      expect(won.is_closed_won).toBe(true);
      expect(won.is_closed_lost).toBe(false);

      const lost = body.items.find((s: { name: string }) => s.name === 'Lost');
      expect(lost.is_closed_lost).toBe(true);
      expect(lost.is_closed_won).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Deals API (/deals): Bounded Pagination & Determinism
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-deals/deals: Bounded Paging & Determinism', () => {
    it('returns 200 with default pagination (pageSize=10) and validates against Zod contract', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      const parsed = DealsListResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);

      expect(body.pagination.page).toBe(1);
      expect(body.pagination.pageSize).toBe(10);
      expect(body.pagination.totalCount).toBe(32);
      expect(body.pagination.totalPages).toBe(4);
      expect(body.items.length).toBe(10);
    });

    it('returns deterministic, non-overlapping records across page 1 and page 2', async () => {
      const page1Res = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?page=1&pageSize=15`,
        headers: viewerHeaders,
      });
      const page2Res = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?page=2&pageSize=15`,
        headers: viewerHeaders,
      });

      expect(page1Res.statusCode).toBe(200);
      expect(page2Res.statusCode).toBe(200);

      const page1 = JSON.parse(page1Res.payload);
      const page2 = JSON.parse(page2Res.payload);

      expect(page1.items.length).toBe(15);
      expect(page2.items.length).toBe(15);

      const page1Ids = new Set(page1.items.map((d: { id: string }) => d.id));
      const page2Ids = new Set(page2.items.map((d: { id: string }) => d.id));

      for (const id of page2Ids) {
        expect(page1Ids.has(id)).toBe(false);
      }
    });

    it('enforces deterministic sort order: created_at desc, then id asc', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?page=1&pageSize=20`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      for (let i = 0; i < body.items.length - 1; i++) {
        const curr = new Date(body.items[i].created_at).getTime();
        const next = new Date(body.items[i + 1].created_at).getTime();
        expect(curr).toBeGreaterThanOrEqual(next);
        if (curr === next) {
          expect(body.items[i].id.localeCompare(body.items[i + 1].id)).toBeLessThanOrEqual(0);
        }
      }
    });

    it('supports alternative limit parameter equivalent to pageSize', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?limit=5`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.pagination.pageSize).toBe(5);
      expect(body.items.length).toBe(5);
    });

    it('strictly rejects pageSize > 100 with 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?pageSize=101`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('INVALID_QUERY');
    });

    it('strictly rejects limit > 100 with 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?limit=150`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('INVALID_QUERY');
    });

    it('strictly rejects negative or zero page parameter with 400 Bad Request', async () => {
      const resZero = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?page=0`,
        headers: viewerHeaders,
      });
      expect(resZero.statusCode).toBe(400);

      const resNegative = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?page=-5`,
        headers: viewerHeaders,
      });
      expect(resNegative.statusCode).toBe(400);
    });

    it('safely ignores unknown query parameters without altering results', async () => {
      const cleanRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?page=1&pageSize=10`,
        headers: viewerHeaders,
      });
      const dirtyRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?page=1&pageSize=10&unexpectedArg=attack&foo=bar`,
        headers: viewerHeaders,
      });

      expect(cleanRes.statusCode).toBe(200);
      expect(dirtyRes.statusCode).toBe(200);
      expect(JSON.parse(cleanRes.payload).items).toEqual(JSON.parse(dirtyRes.payload).items);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Server-Side Filtering & Search
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-deals/deals: Server-Side Search & Filter', () => {
    it('filters deals by stage (Proposal)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?stage=Proposal`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.items.length).toBeGreaterThan(0);
      for (const deal of body.items) {
        expect(deal.stage_name).toBe('Proposal');
      }
    });

    it('filters deals by stage (Won)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?stage=Won`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.items.length).toBeGreaterThan(0);
      for (const deal of body.items) {
        expect(deal.stage_name).toBe('Won');
      }
    });

    it('rejects invalid stage filter value with 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?stage=NotARealStage`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('INVALID_QUERY');
    });

    it('searches deals server-side by deal name (case-insensitive)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?search=acme`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items[0].name).toContain('Acme Cloud Modernization');
    });

    it('searches deals server-side by contact name (case-insensitive)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?search=sarah`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.items.length).toBeGreaterThan(0);
      const matched = body.items.find((d: { contact_name: string | null }) =>
        d.contact_name?.toLowerCase().includes('sarah')
      );
      expect(matched).toBeDefined();
    });

    it('returns empty result cleanly when search matches nothing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?search=nonexistent_xyz_deal_99999`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.items).toEqual([]);
      expect(body.pagination.totalCount).toBe(0);
      expect(body.pagination.hasNextPage).toBe(false);
    });

    it('sorts deals by name in ascending order when sort=name&order=asc', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?pageSize=10&sort=name&order=asc`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.items.length).toBe(10);
      const names = body.items.map((d: { name: string }) => d.name);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sorted);
    });

    it('sorts deals by value in descending order when sort=value&order=desc', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?pageSize=10&sort=value&order=desc`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.items.length).toBe(10);
      const values = body.items.map((d: { value: string }) => Number.parseFloat(d.value));
      for (let i = 0; i < values.length - 1; i++) {
        expect(values[i]).toBeGreaterThanOrEqual(values[i + 1]!);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Deal Detail & ID Validation
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/crm-deals/deals/:id', () => {
    it('returns deal detail for valid existing UUID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals/20000000-0000-4000-8000-000000000001`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      const parsed = DealSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body.id).toBe('20000000-0000-4000-8000-000000000001');
      expect(body.name).toBe('Acme Cloud Modernization');
      expect(body.currency).toBe('USD');
      expect(body.is_orphan).toBe(false);
    });

    it('returns 404 for non-existent deal UUID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals/99999999-9999-4999-8999-999999999999`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('NOT_FOUND');
    });

    it('returns 400 for malformed UUID in path', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals/invalid-uuid-format`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('BAD_REQUEST');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Quotes API (/quotes and /quotes/:id)
  // ---------------------------------------------------------------------------
  describe('Quotes API: GET /quotes and GET /quotes/:id', () => {
    it('returns paginated quotes list validating against Zod contract', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/quotes?page=1&pageSize=10`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      const parsed = QuotesListResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.pagination.page).toBe(1);
    });

    it('sorts quotes by amount in descending order when sort=amount&order=desc', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/quotes?page=1&pageSize=10&sort=amount&order=desc`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      const amounts = body.items.map((q: { amount: string }) => Number.parseFloat(q.amount));
      for (let i = 0; i < amounts.length - 1; i++) {
        expect(amounts[i]).toBeGreaterThanOrEqual(amounts[i + 1]!);
      }
    });

    it('filters quotes by deal_id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/quotes?deal_id=20000000-0000-4000-8000-000000000001`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.items.length).toBe(1);
      expect(body.items[0].quote_number).toBe('Q-2026-001');
      expect(body.items[0].deal_id).toBe('20000000-0000-4000-8000-000000000001');
    });

    it('fetches single quote by ID and validates against QuoteSchema', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/quotes/30000000-0000-4000-8000-000000000001`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      const parsed = QuoteSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body.quote_number).toBe('Q-2026-001');
      expect(body.amount).toBe('75000.00');
    });

    it('returns 404 for non-existent quote UUID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/quotes/88888888-8888-4888-8888-888888888888`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('NOT_FOUND');
    });

    it('returns 400 for malformed quote UUID in path', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/quotes/not-a-uuid`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('BAD_REQUEST');
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Domain Invariants (Issue #17 Non-Negotiable Specifications)
  // ---------------------------------------------------------------------------
  describe('Domain Invariants Enforcement', () => {
    it('restricts stage set exactly to: New, Qualified, Proposal, Negotiation, Won, Lost', () => {
      expect(CRM2_STAGES).toEqual([
        'New',
        'Qualified',
        'Proposal',
        'Negotiation',
        'Won',
        'Lost',
      ]);

      for (const stage of CRM2_STAGES) {
        expect(() => assertValidStageName(stage)).not.toThrow();
      }

      expect(() => assertValidStageName('Draft')).toThrow(/Domain Invariant Violation/);
      expect(() => assertValidStageName('Active')).toThrow(/Domain Invariant Violation/);
      expect(() => assertValidStageName('Closed')).toThrow(/Domain Invariant Violation/);
    });

    it('flags orphan deals with is_orphan=true and contact_id=null without hiding them', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?search=Orphan`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.items.length).toBeGreaterThan(0);

      const orphan = body.items.find((d: { is_orphan: boolean }) => d.is_orphan === true);
      expect(orphan).toBeDefined();
      expect(orphan.contact_id).toBeNull();
    });

    it('enforces explicit ISO 4217 currency code and non-negative decimal value on all deals', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?pageSize=30`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      for (const deal of body.items) {
        expect(deal.currency).toMatch(/^[A-Z]{3}$/);
        expect(deal.value).toMatch(/^\d+(\.\d{1,4})?$/);
        expect(Number(deal.value)).toBeGreaterThanOrEqual(0);
      }
    });

    it('never leaks private database fields, secrets, raw-row JSON, or internal audit payloads', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals?page=1&pageSize=5`,
        headers: viewerHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      for (const deal of body.items) {
        expect(deal).not.toHaveProperty('password');
        expect(deal).not.toHaveProperty('secret');
        expect(deal).not.toHaveProperty('salary');
        expect(deal).not.toHaveProperty('bank_data');
        expect(deal).not.toHaveProperty('raw_row_json');
        expect(deal).not.toHaveProperty('audit_payload');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Authentication & Role-Based Access Control (RBAC)
  // ---------------------------------------------------------------------------
  describe('Authentication & RBAC Enforcement', () => {
    it('rejects unauthenticated GET /deals with 401 Unauthorized', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals`,
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
    });

    it('rejects malformed Bearer token with 401 Unauthorized', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: { authorization: 'Bearer invalid.jwt.token' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
    });

    it('permits VIEWER role with MODULE_READ to read deals and quotes', async () => {
      const dealsRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: viewerHeaders,
      });
      expect(dealsRes.statusCode).toBe(200);

      const quotesRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/quotes`,
        headers: viewerHeaders,
      });
      expect(quotesRes.statusCode).toBe(200);
    });

    it('rejects VIEWER role with 403 Forbidden when attempting POST /deals (requires editor/admin)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: viewerHeaders,
        payload: {
          name: 'Forbidden Deal Creation',
          value: '50000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-31',
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('FORBIDDEN');
    });

    it('rejects VIEWER role with 403 Forbidden when attempting PATCH /deals/:id', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/20000000-0000-4000-8000-000000000001`,
        headers: viewerHeaders,
        payload: {
          name: 'Unauthorized Update',
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('FORBIDDEN');
    });

    it('permits EDITOR role to perform deal mutations', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: editorHeaders,
        payload: {
          name: 'Permitted Editor Deal',
          value: '45000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-31',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.name).toBe('Permitted Editor Deal');
    });
  });
});
