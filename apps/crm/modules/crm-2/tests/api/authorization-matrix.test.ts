import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { CRM2_API_PREFIX } from '@clearshift/contracts';
import { Roles, jwtPlugin, signAccessToken } from '@cs/identity';
import type { ReferenceResolver } from '@cs/kernel';
import { crm2Routes } from '../../src/routes/crm2.routes.js';
import { crm2AuthPlugin } from '../../src/plugins/auth.js';
import { Crm2Service } from '../../src/services/crm2.service.js';

describe('CRM-2 Comprehensive Authorization & Role Matrix Tests (AU-01..AU-15)', () => {
  let app: FastifyInstance;
  let service: Crm2Service;
  let viewerToken: string;
  let editorToken: string;
  let migrationToken: string;
  let adminToken: string;

  let existingDealId: string;
  let existingQuoteId: string;

  const mockContactResolver: ReferenceResolver = {
    async exists(entityType: string, id: string): Promise<boolean> {
      if (entityType === 'contact') {
        return id === '90000000-0000-4000-8000-000000000001';
      }
      return false;
    },
    async get<T>(entityType: string, id: string): Promise<T | null> {
      if (entityType === 'contact' && id === '90000000-0000-4000-8000-000000000001') {
        return { firstName: 'Sarah', lastName: 'Connor' } as unknown as T;
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

    viewerToken = await signAccessToken('user-viewer-1', [Roles.VIEWER]);
    editorToken = await signAccessToken('user-editor-1', [Roles.EDITOR]);
    migrationToken = await signAccessToken('user-migrator-1', [Roles.MIGRATION_RUNNER]);
    adminToken = await signAccessToken('user-admin-1', [Roles.ADMIN]);

    // Seed baseline deal and quote for read/patch testing
    const baseDeal = await service.createDeal({
      name: 'Authorization Test Base Deal',
      value: '50000.00',
      currency: 'USD',
      stage_name: 'New',
      close_date: '2026-12-31',
    });
    existingDealId = baseDeal.id;

    const baseQuote = await service.createQuote({
      deal_id: existingDealId,
      quote_number: 'Q-AUTH-BASE-01',
      date: '2026-10-23',
      amount: '25000.00',
      currency: 'USD',
    });
    existingQuoteId = baseQuote.id;
  });

  // ---------------------------------------------------------------------------
  // 1. Unauthenticated Requests (401 Unauthorized)
  // ---------------------------------------------------------------------------
  describe('Unauthenticated Request Handling (401)', () => {
    it('AU-01: GET /stages without token returns 401', async () => {
      const res = await app.inject({ method: 'GET', url: `${CRM2_API_PREFIX}/stages` });
      expect(res.statusCode).toBe(401);
    });

    it('AU-02: GET /deals without token returns 401', async () => {
      const res = await app.inject({ method: 'GET', url: `${CRM2_API_PREFIX}/deals` });
      expect(res.statusCode).toBe(401);
    });

    it('AU-03: POST /deals without token returns 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        payload: { name: 'Unauth Deal', value: '1000.00', currency: 'USD', stage_name: 'New', close_date: '2026-11-30' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('AU-04: POST /quotes without token returns 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes`,
        payload: { deal_id: existingDealId, quote_number: 'Q-UNAUTH', date: '2026-10-23', amount: '1000.00' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('AU-05: POST /import without token returns 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import`,
        payload: { batchId: 'e0000000-0000-4000-8000-000000000001', sourceRow: 1, sourceSystem: 'test', entity: 'deal', idempotencyKey: 'k', data: {} },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Read Endpoints Access Matrix
  // ---------------------------------------------------------------------------
  describe('Read Endpoints Role Matrix (VIEWER, EDITOR, ADMIN)', () => {
    it('AU-06: VIEWER can read /stages, /deals, and /quotes', async () => {
      const stagesRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/stages`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(stagesRes.statusCode).toBe(200);

      const dealsRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(dealsRes.statusCode).toBe(200);

      const quotesRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/quotes`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(quotesRes.statusCode).toBe(200);
    });

    it('AU-07: EDITOR can read /deals/:id and /quotes/:id', async () => {
      const dealRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals/${existingDealId}`,
        headers: { authorization: `Bearer ${editorToken}` },
      });
      expect(dealRes.statusCode).toBe(200);

      const quoteRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/quotes/${existingQuoteId}`,
        headers: { authorization: `Bearer ${editorToken}` },
      });
      expect(quoteRes.statusCode).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Mutation Endpoints Role Matrix (403 Forbidden vs 200/201 Success)
  // ---------------------------------------------------------------------------
  describe('Mutation Endpoints Role Matrix', () => {
    it('AU-08: VIEWER role is forbidden (403) from POST /deals', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          name: 'Forbidden Viewer Deal',
          value: '10000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-11-30',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('AU-09: VIEWER role is forbidden (403) from PATCH /deals/:id', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${existingDealId}`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { name: 'Forbidden Deal Patch' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('AU-10: VIEWER role is forbidden (403) from POST /quotes', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          deal_id: existingDealId,
          quote_number: 'Q-FORBIDDEN-01',
          date: '2026-10-23',
          amount: '10000.00',
          currency: 'USD',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('AU-11: VIEWER role is forbidden (403) from PATCH /quotes/:id', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/quotes/${existingQuoteId}`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { note: 'Forbidden quote patch' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('AU-12: EDITOR role is authorized (201) for POST /deals', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          name: 'Editor Authorized Deal',
          value: '35000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-11-30',
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().name).toBe('Editor Authorized Deal');
    });

    it('AU-13: EDITOR role is authorized (201) for POST /quotes', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          deal_id: existingDealId,
          quote_number: `Q-EDITOR-${Date.now()}`,
          date: '2026-10-23',
          amount: '12000.00',
          currency: 'USD',
        },
      });
      expect(res.statusCode).toBe(201);
    });

    it('AU-14: EDITOR role is forbidden (403) from POST /import (requires MIGRATION_RUNNER or ADMIN)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import`,
        headers: {
          authorization: `Bearer ${editorToken}`,
          'Idempotency-Key': 'idemp-editor-import-fail',
        },
        payload: {
          batchId: 'e0000000-0000-4000-8000-000000000001',
          sourceRow: 1,
          sourceSystem: 'crm2_target_adapter',
          entity: 'deal',
          idempotencyKey: 'idemp-editor-import-fail',
          data: { name: 'Editor Deal', value: '1000.00', currency: 'USD', stage_name: 'New', close_date: '2026-11-30' },
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('AU-15: MIGRATION_RUNNER and ADMIN roles are authorized (201) for POST /import', async () => {
      const resMig = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import`,
        headers: {
          authorization: `Bearer ${migrationToken}`,
          'Idempotency-Key': `idemp-mig-success-${Date.now()}`,
        },
        payload: {
          batchId: 'e0000000-0000-4000-8000-000000000001',
          sourceRow: 1,
          sourceSystem: 'crm2_target_adapter',
          entity: 'deal',
          idempotencyKey: `idemp-mig-success-${Date.now()}`,
          data: { name: 'Migrator Ingested Deal', value: '45000.00', currency: 'USD', stage_name: 'New', close_date: '2026-11-30' },
        },
      });
      expect(resMig.statusCode).toBe(201);

      const resAdmin = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import`,
        headers: {
          authorization: `Bearer ${adminToken}`,
          'Idempotency-Key': `idemp-admin-success-${Date.now()}`,
        },
        payload: {
          batchId: 'e0000000-0000-4000-8000-000000000001',
          sourceRow: 2,
          sourceSystem: 'crm2_target_adapter',
          entity: 'deal',
          idempotencyKey: `idemp-admin-success-${Date.now()}`,
          data: { name: 'Admin Ingested Deal', value: '65000.00', currency: 'USD', stage_name: 'New', close_date: '2026-11-30' },
        },
      });
      expect(resAdmin.statusCode).toBe(201);
    });
  });
});
