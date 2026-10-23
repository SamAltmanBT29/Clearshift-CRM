import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CRM2_API_PREFIX,
  CRM2_STAGES,
  CRM2_STAGE_SEEDS,
} from '@clearshift/contracts';
import { Roles, jwtPlugin, signAccessToken } from '@cs/identity';
import type { ReferenceResolver } from '@cs/kernel';
import { crm2Routes } from '../../src/routes/crm2.routes.js';
import { crm2AuthPlugin } from '../../src/plugins/auth.js';
import { Crm2Service } from '../../src/services/crm2.service.js';

describe('CRM-2 Deals, Pipeline and Quotes: Mutation API and Domain Validation [CRM2-03]', () => {
  let app: FastifyInstance;
  let service: Crm2Service;
  let editorToken: string;
  let viewerToken: string;
  let analystToken: string;
  let migrationToken: string;
  let adminToken: string;

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
    service.resetStore();

    app = Fastify({ logger: false });
    await app.register(jwtPlugin);
    await app.register(crm2AuthPlugin);
    await app.register(crm2Routes, {
      prefix: CRM2_API_PREFIX,
      service,
      authEnabled: true,
    });
    await app.ready();

    editorToken = await signAccessToken('user-editor-1', [Roles.EDITOR]);
    viewerToken = await signAccessToken('user-viewer-1', [Roles.VIEWER]);
    analystToken = await signAccessToken('user-analyst-1', [Roles.ANALYST]);
    migrationToken = await signAccessToken('user-migrator-1', [Roles.MIGRATION_RUNNER]);
    adminToken = await signAccessToken('user-admin-1', [Roles.ADMIN]);
  });

  // ---------------------------------------------------------------------------
  // 1. Authorization & Role-Based Access Control (AC-1, AC-8)
  // ---------------------------------------------------------------------------
  describe('Authorization & RBAC Enforcement', () => {
    it('rejects unauthenticated POST /deals with 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        payload: {
          name: 'Unauthorized Deal',
          value: '10000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-31',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.correlation_id).toBeDefined();
    });

    it('rejects VIEWER role from creating deals with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          name: 'Forbidden Viewer Deal',
          value: '10000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-31',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.code).toBe('FORBIDDEN');
    });

    it('rejects VIEWER role from patching deals with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/20000000-0000-4000-8000-000000000001`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { name: 'Attempted Update' },
      });

      expect(res.statusCode).toBe(403);
    });

    it('rejects VIEWER role from creating quotes with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          deal_id: '20000000-0000-4000-8000-000000000001',
          quote_number: 'Q-TEST-VIEWER',
          date: '2026-11-01',
          amount: '5000.00',
          currency: 'USD',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('permits EDITOR and ADMIN roles to create and update deals', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          name: 'Editor Approved Deal',
          value: '45000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-31',
        },
      });

      expect(createRes.statusCode).toBe(201);
      const created = createRes.json();
      expect(created.name).toBe('Editor Approved Deal');

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${created.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Admin Renamed Deal' },
      });

      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().name).toBe('Admin Renamed Deal');
    });

    it('permits VIEWER and ANALYST to read deals and stages', async () => {
      const stagesRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/stages`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(stagesRes.statusCode).toBe(200);

      const dealsRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: { authorization: `Bearer ${analystToken}` },
      });
      expect(dealsRes.statusCode).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Deals Mutation & Invariant Validation (AC-1, AC-2, AC-3)
  // ---------------------------------------------------------------------------
  describe('Deals Creation & Invariant Validation', () => {
    it('creates deal with valid contact and marks is_orphan as false', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          name: 'Sarah Enterprise Contract',
          contact_id: '90000000-0000-4000-8000-000000000001',
          value: '88000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-15',
        },
      });

      expect(res.statusCode).toBe(201);
      const deal = res.json();
      expect(deal.id).toBeDefined();
      expect(deal.name).toBe('Sarah Enterprise Contract');
      expect(deal.contact_id).toBe('90000000-0000-4000-8000-000000000001');
      expect(deal.contact_name).toBe('Sarah Connor');
      expect(deal.is_orphan).toBe(false);
      expect(deal.value).toBe('88000.00');
      expect(deal.currency).toBe('USD');
    });

    it('preserves orphan deals (contact_id=null) and visibly flags is_orphan=true', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          name: 'Inbound Orphan Opportunity',
          contact_id: null,
          value: '35000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-11-20',
        },
      });

      expect(res.statusCode).toBe(201);
      const deal = res.json();
      expect(deal.contact_id).toBeNull();
      expect(deal.contact_name).toBeNull();
      expect(deal.is_orphan).toBe(true);
    });

    it('rejects creation when referenced contact does not exist (422 REFERENCE_NOT_FOUND)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          name: 'Ghost Contact Deal',
          contact_id: '99999999-9999-4999-8999-999999999999',
          value: '10000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-31',
        },
      });

      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.code).toBe('REFERENCE_NOT_FOUND');
      expect(body.message).toContain('contact');
      expect(body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'contact_id', code: 'invalid_reference' }),
        ])
      );
    });

    it('rejects creation with invalid monetary value format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          name: 'Negative Value Deal',
          value: '-500.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-31',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects creation with non-ISO currency code', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          name: 'Bad Currency Deal',
          value: '10000.00',
          currency: 'dollar',
          stage_name: 'New',
          close_date: '2026-12-31',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. State Machine Transitions & Protected Fields (AC-1, AC-2, AC-3)
  // ---------------------------------------------------------------------------
  describe('Sales Pipeline State Transitions & Protected Fields', () => {
    it('executes legal step-by-step pipeline state progression', async () => {
      // 1. Initial stage is 'New'
      const dealId = '20000000-0000-4000-8000-000000000002'; // seeded as 'New'

      // New -> Qualified
      const toQualified = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${dealId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { stage_name: 'Qualified' },
      });
      expect(toQualified.statusCode).toBe(200);
      expect(toQualified.json().stage_name).toBe('Qualified');

      // Qualified -> Proposal
      const toProposal = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${dealId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { stage_name: 'Proposal' },
      });
      expect(toProposal.statusCode).toBe(200);
      expect(toProposal.json().stage_name).toBe('Proposal');

      // Proposal -> Negotiation
      const toNegotiation = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${dealId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { stage_name: 'Negotiation' },
      });
      expect(toNegotiation.statusCode).toBe(200);
      expect(toNegotiation.json().stage_name).toBe('Negotiation');

      // Negotiation -> Won
      const toWon = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${dealId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { stage_name: 'Won' },
      });
      expect(toWon.statusCode).toBe(200);
      expect(toWon.json().stage_name).toBe('Won');
    });

    it('allows transitioning from any active stage directly to Lost', async () => {
      // Seeded deal 1 is at 'Proposal' stage
      const dealId = '20000000-0000-4000-8000-000000000001';

      const toLost = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${dealId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { stage_name: 'Lost' },
      });

      expect(toLost.statusCode).toBe(200);
      expect(toLost.json().stage_name).toBe('Lost');
    });

    it('permits idempotent same-stage update (current === next)', async () => {
      const dealId = '20000000-0000-4000-8000-000000000002'; // 'New'

      const res = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${dealId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { stage_name: 'New', value: '130000.00' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().stage_name).toBe('New');
      expect(res.json().value).toBe('130000.00');
    });

    it('strictly rejects illegal skipping state transitions (422 INVALID_DEAL_STAGE_TRANSITION)', async () => {
      const dealId = '20000000-0000-4000-8000-000000000002'; // 'New'

      // Attempt to skip directly to 'Won'
      const res = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${dealId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { stage_name: 'Won' },
      });

      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.code).toBe('INVALID_DEAL_STAGE_TRANSITION');
      expect(body.message).toContain('Deal stage cannot transition from New to Won');
    });

    it('strictly rejects backward state transitions (e.g. Proposal -> New)', async () => {
      const dealId = '20000000-0000-4000-8000-000000000001'; // 'Proposal'

      const res = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${dealId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { stage_name: 'New' },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('INVALID_DEAL_STAGE_TRANSITION');
    });

    it('strictly rejects any transitions originating from terminal stages (Won or Lost)', async () => {
      // First advance deal to Won
      const createRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          name: 'Terminal Test Deal',
          value: '20000.00',
          currency: 'USD',
          stage_name: 'Negotiation',
          close_date: '2026-12-31',
        },
      });
      const deal = createRes.json();

      await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${deal.id}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { stage_name: 'Won' },
      });

      // Attempt to transition from Won to Qualified
      const res = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${deal.id}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { stage_name: 'Qualified' },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('INVALID_DEAL_STAGE_TRANSITION');
    });

    it('sanitizes user edits so browser cannot override protected system fields', async () => {
      const dealId = '20000000-0000-4000-8000-000000000001';
      const originalDeal = await service.getDealById(dealId);

      const res = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${dealId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          id: '99999999-9999-4999-8999-999999999999', // should be ignored
          created_at: '1970-01-01T00:00:00Z', // should be ignored
          updated_at: '1970-01-01T00:00:00Z', // should be ignored
          is_orphan: true, // should be ignored, derived from contact_id
          name: 'Safely Updated Name',
        },
      });

      expect(res.statusCode).toBe(200);
      const updated = res.json();
      expect(updated.id).toBe(dealId);
      expect(updated.name).toBe('Safely Updated Name');
      expect(updated.created_at).toBe(originalDeal!.created_at);
      expect(updated.is_orphan).toBe(false); // original had valid contact
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Quotes Mutation & Referential Integrity (AC-1, AC-2, AC-3)
  // ---------------------------------------------------------------------------
  describe('Quotes Mutation & Referential Integrity', () => {
    it('creates quote successfully with valid deal link and unique quote number', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          deal_id: '20000000-0000-4000-8000-000000000001',
          quote_number: 'Q-2026-MUT-001',
          date: '2026-11-15',
          amount: '12500.00',
          currency: 'USD',
          note: 'Full consulting package',
        },
      });

      expect(res.statusCode).toBe(201);
      const quote = res.json();
      expect(quote.id).toBeDefined();
      expect(quote.quote_number).toBe('Q-2026-MUT-001');
      expect(quote.amount).toBe('12500.00');
      expect(quote.deal_id).toBe('20000000-0000-4000-8000-000000000001');
    });

    it('rejects quote creation when referenced deal does not exist (422 REFERENCE_NOT_FOUND)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          deal_id: '99999999-9999-4999-8999-999999999999',
          quote_number: 'Q-2026-ORPHAN',
          date: '2026-11-15',
          amount: '10000.00',
          currency: 'USD',
        },
      });

      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.code).toBe('REFERENCE_NOT_FOUND');
      expect(body.message).toContain('deal');
    });

    it('rejects quote creation when quote number already exists (409 DUPLICATE_RECORD)', async () => {
      // Q-2026-001 already exists in synthetic seed
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          deal_id: '20000000-0000-4000-8000-000000000001',
          quote_number: 'Q-2026-001',
          date: '2026-11-20',
          amount: '5000.00',
          currency: 'USD',
        },
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.code).toBe('DUPLICATE_RECORD');
      expect(body.message).toContain('Quote with quote_number \'Q-2026-001\' already exists');
    });

    it('rejects patching quote to duplicate quote number of another quote (409 DUPLICATE_RECORD)', async () => {
      // First create a second quote
      const createRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          deal_id: '20000000-0000-4000-8000-000000000001',
          quote_number: 'Q-2026-UNIQUE-2',
          date: '2026-11-20',
          amount: '7500.00',
          currency: 'USD',
        },
      });
      const quote = createRes.json();

      // Try to rename it to Q-2026-001
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/quotes/${quote.id}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { quote_number: 'Q-2026-001' },
      });

      expect(patchRes.statusCode).toBe(409);
      expect(patchRes.json().code).toBe('DUPLICATE_RECORD');
    });

    it('permits idempotent quote update with same quote number', async () => {
      const quoteId = '30000000-0000-4000-8000-000000000001';

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/quotes/${quoteId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          quote_number: 'Q-2026-001',
          amount: '80000.00',
        },
      });

      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().amount).toBe('80000.00');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Migration Ingestion & Idempotency Guarantees (AC-3, AC-4)
  // ---------------------------------------------------------------------------
  describe('Migration Ingestion & Durable Idempotent Receipts', () => {
    it('creates deal through import write and issues durable receipt with 201 Created', async () => {
      const payload = {
        batchId: '50000000-0000-4000-8000-000000000001',
        sourceRow: 1,
        sourceSystem: 'hubspot-migration',
        entity: 'deal',
        data: {
          name: 'Imported Enterprise Deal',
          value: '175000.00',
          currency: 'USD',
          stage_name: 'Proposal',
          close_date: '2026-12-30',
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import`,
        headers: {
          authorization: `Bearer ${migrationToken}`,
          'idempotency-key': 'idemp-deal-001',
        },
        payload,
      });

      expect(res.statusCode).toBe(201);
      const result = res.json();
      expect(result.targetId).toBeDefined();
      expect(result.isExisting).toBe(false);
      expect(result.receipt).toBeDefined();
      expect(result.receipt.idempotencyKey).toBe('idemp-deal-001');
      expect(result.receipt.batchId).toBe('50000000-0000-4000-8000-000000000001');
      expect(result.receipt.sourceRow).toBe(1);
    });

    it('returns original receipt without a second mutation on repeated request with same Idempotency-Key (200 OK)', async () => {
      const payload = {
        batchId: '50000000-0000-4000-8000-000000000002',
        sourceRow: 5,
        sourceSystem: 'salesforce-migration',
        entity: 'deal',
        data: {
          name: 'Idempotent Deal Test',
          value: '95000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-31',
        },
      };

      // First call
      const firstRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import`,
        headers: {
          authorization: `Bearer ${migrationToken}`,
          'idempotency-key': 'idemp-repeat-002',
        },
        payload,
      });
      expect(firstRes.statusCode).toBe(201);
      const firstTargetId = firstRes.json().targetId;

      // Deals count before second call
      const dealsBefore = (await service.getDeals({ page: 1, pageSize: 100 })).pagination.totalCount;

      // Repeated call with same payload and key
      const secondRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import`,
        headers: {
          authorization: `Bearer ${migrationToken}`,
          'idempotency-key': 'idemp-repeat-002',
        },
        payload,
      });

      expect(secondRes.statusCode).toBe(200);
      const secondResult = secondRes.json();
      expect(secondResult.isExisting).toBe(true);
      expect(secondResult.targetId).toBe(firstTargetId);
      expect(secondResult.receipt.idempotencyKey).toBe('idemp-repeat-002');

      // Verify no second mutation occurred
      const dealsAfter = (await service.getDeals({ page: 1, pageSize: 100 })).pagination.totalCount;
      expect(dealsAfter).toBe(dealsBefore);
    });

    it('rejects repeated import request with SAME key but DIFFERENT payload (409 IDEMPOTENCY_KEY_REUSED)', async () => {
      const originalPayload = {
        batchId: '50000000-0000-4000-8000-000000000003',
        sourceRow: 10,
        sourceSystem: 'hubspot-migration',
        entity: 'deal',
        data: {
          name: 'Initial Deal Payload',
          value: '10000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-31',
        },
      };

      const res1 = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import`,
        headers: {
          authorization: `Bearer ${migrationToken}`,
          'idempotency-key': 'idemp-conflict-003',
        },
        payload: originalPayload,
      });
      expect(res1.statusCode).toBe(201);

      // Mutated payload with same idempotency key
      const conflictingPayload = {
        ...originalPayload,
        data: {
          ...originalPayload.data,
          value: '999999.00', // changed value!
        },
      };

      const res2 = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import`,
        headers: {
          authorization: `Bearer ${migrationToken}`,
          'idempotency-key': 'idemp-conflict-003',
        },
        payload: conflictingPayload,
      });

      expect(res2.statusCode).toBe(409);
      const body = res2.json();
      expect(body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('rejects import request without Idempotency-Key with 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import`,
        headers: { authorization: `Bearer ${migrationToken}` },
        payload: {
          batchId: '50000000-0000-4000-8000-000000000004',
          sourceRow: 1,
          sourceSystem: 'hubspot',
          entity: 'deal',
          data: { name: 'No Key Deal' },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('BAD_REQUEST');
    });

    it('lists persisted import receipts via GET /import/receipts', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/import/receipts`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(Array.isArray(data.items)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Security, Correlation IDs & Secrets Leakage (AC-3, AC-5)
  // ---------------------------------------------------------------------------
  describe('Security & Safe Error Responses', () => {
    it('returns custom x-correlation-id in error responses', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals/non-existent-id`,
        headers: {
          authorization: `Bearer ${viewerToken}`,
          'x-correlation-id': 'corr-audit-test-999',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.correlation_id).toBe('corr-audit-test-999');
    });

    it('does not leak SQL queries, stack traces, or internal database metadata on errors', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          name: 'Fault Injection Deal',
          value: 'invalid-number',
          close_date: 'invalid-date',
        },
      });

      expect(res.statusCode).toBe(400);
      const rawText = res.body;
      expect(rawText).not.toContain('stack');
      expect(rawText).not.toContain('SELECT ');
      expect(rawText).not.toContain('INSERT INTO');
      expect(rawText).not.toContain('crm2.');
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Domain Invariants Verification (AC-6)
  // ---------------------------------------------------------------------------
  describe('Domain Invariants: Fixed Reference Data', () => {
    it('asserts stage set is exactly [New, Qualified, Proposal, Negotiation, Won, Lost]', () => {
      expect(CRM2_STAGES).toEqual([
        'New',
        'Qualified',
        'Proposal',
        'Negotiation',
        'Won',
        'Lost',
      ]);
    });

    it('asserts canonical seeded stages have positions 1 through 6 and proper terminal flags', () => {
      expect(CRM2_STAGE_SEEDS).toHaveLength(6);
      expect(CRM2_STAGE_SEEDS.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6]);

      const won = CRM2_STAGE_SEEDS.find((s) => s.name === 'Won');
      expect(won?.is_closed_won).toBe(true);
      expect(won?.is_closed_lost).toBe(false);

      const lost = CRM2_STAGE_SEEDS.find((s) => s.name === 'Lost');
      expect(lost?.is_closed_lost).toBe(true);
      expect(lost?.is_closed_won).toBe(false);
    });
  });
});
