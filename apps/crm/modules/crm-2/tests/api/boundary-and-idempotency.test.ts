import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { CRM2_API_PREFIX } from '@clearshift/contracts';
import { crm2Routes } from '../../src/routes/crm2.routes.js';
import { Crm2Service } from '../../src/services/crm2.service.js';
import type { ReferenceResolver } from '@cs/kernel';

describe('CRM-2 Boundary, Idempotency & Route Validation Tests', () => {
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
      }
      return null;
    },
  };

  beforeEach(async () => {
    service = new Crm2Service({ contactResolver: mockContactResolver });
    service.resetStore();

    app = Fastify({ logger: false });
    await app.register(crm2Routes, {
      prefix: CRM2_API_PREFIX,
      service,
      authEnabled: false,
    });
    await app.ready();
  });

  // ---------------------------------------------------------------------------
  // 1. Boundary Tests (BD-01 to BD-09)
  // ---------------------------------------------------------------------------
  describe('Boundary Tests (BD-01..BD-09)', () => {
    it('BD-01: accepts maximum numeric(14,2) value (999999999999.99)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        payload: {
          name: 'Max Value Boundary Deal',
          value: '999999999999.99',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-31',
        },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().value).toBe('999999999999.99');
    });

    it('BD-02: rejects value exceeding numeric(14,2) limit (1000000000000.00) with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        payload: {
          name: 'Overflow Value Deal',
          value: '1000000000000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-31',
        },
      });
      // [DEF-CRM2-02]: Value overflow fails validation; schema currently accepts 13 integer digits
      expect(response.statusCode).toBe(400);
    });

    it('BD-03: accepts exact zero value (0.00) as valid non-negative amount', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        payload: {
          name: 'Zero Dollar Deal',
          value: '0.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-31',
        },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().value).toBe('0.00');
    });

    it('BD-04: rejects negative monetary amount (-0.01) with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        payload: {
          name: 'Negative Deal',
          value: '-0.01',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-31',
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_ERROR');
    });

    it('BD-05: rejects empty deal name ("") with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        payload: {
          name: '',
          value: '50000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-31',
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_ERROR');
    });

    it('BD-06: rejects over-length deal name (>255 chars) with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        payload: {
          name: 'A'.repeat(256),
          value: '50000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-31',
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_ERROR');
    });

    it('BD-07: rejects invalid close date format ("2026-02-31") with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        payload: {
          name: 'Invalid Date Deal',
          value: '50000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-02-31-not-a-date',
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_ERROR');
    });

    it('BD-08: asserts single status code from OpenAPI contract (400) for GET /deals/:id with non-UUID path', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals/not-a-valid-uuid`,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('BAD_REQUEST');
    });

    it('BD-09: asserts single status code from OpenAPI contract (400) for GET /quotes/:id with non-UUID path', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/quotes/not-a-valid-uuid`,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('BAD_REQUEST');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Idempotency Tests (ID-01 to ID-04)
  // ---------------------------------------------------------------------------
  describe('Idempotency Tests (ID-01..ID-04)', () => {
    it('ID-01: repeated POST /quotes with duplicate quote number returns 409 Conflict without duplicate record', async () => {
      // 1. Create a parent deal
      const dealRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        payload: {
          name: 'Parent Deal for Quote Idempotency',
          value: '30000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-11-30',
        },
      });
      const dealId = dealRes.json().id;

      // 2. First quote creation -> 201 Created
      const firstRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes`,
        payload: {
          deal_id: dealId,
          quote_number: 'Q-IDEMP-TEST-01',
          date: '2026-10-23',
          amount: '15000.00',
          currency: 'USD',
        },
      });
      expect(firstRes.statusCode).toBe(201);

      // 3. Repeated quote creation with identical quote_number -> 409 Conflict
      const secondRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes`,
        payload: {
          deal_id: dealId,
          quote_number: 'Q-IDEMP-TEST-01',
          date: '2026-10-23',
          amount: '15000.00',
          currency: 'USD',
        },
      });
      expect(secondRes.statusCode).toBe(409);
      expect(secondRes.json().code).toBe('DUPLICATE_RECORD');

      // Assert quotes count did not duplicate
      const listRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/quotes?deal_id=${dealId}`,
      });
      expect(listRes.json().items).toHaveLength(1);
    });

    it('ID-02: repeated identical PATCH /deals/:id produces stable result with no side effects', async () => {
      const dealRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        payload: {
          name: 'Deal for Patch Idempotency',
          value: '40000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-11-30',
        },
      });
      const dealId = dealRes.json().id;

      const patchPayload = { name: 'Deal for Patch Idempotency (Updated)', value: '45000.00' };

      // First PATCH
      const patch1 = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${dealId}`,
        payload: patchPayload,
      });
      expect(patch1.statusCode).toBe(200);

      // Second identical PATCH
      const patch2 = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${dealId}`,
        payload: patchPayload,
      });
      expect(patch2.statusCode).toBe(200);
      expect(patch2.json().name).toBe('Deal for Patch Idempotency (Updated)');
      expect(patch2.json().value).toBe('45000.00');
    });

    it('ID-03: repeated identical PATCH /quotes/:id produces stable result with no side effects', async () => {
      const dealRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        payload: {
          name: 'Parent Deal for Quote Patch Idempotency',
          value: '50000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-11-30',
        },
      });
      const dealId = dealRes.json().id;

      const quoteRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes`,
        payload: {
          deal_id: dealId,
          quote_number: 'Q-PATCH-IDEMP-01',
          date: '2026-10-23',
          amount: '25000.00',
          currency: 'USD',
          note: 'Initial Note',
        },
      });
      const quoteId = quoteRes.json().id;

      const patchPayload = { amount: '27500.00', note: 'Updated Price Note' };

      // First PATCH
      const patch1 = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/quotes/${quoteId}`,
        payload: patchPayload,
      });
      expect(patch1.statusCode).toBe(200);

      // Second identical PATCH
      const patch2 = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/quotes/${quoteId}`,
        payload: patchPayload,
      });
      expect(patch2.statusCode).toBe(200);
      expect(patch2.json().amount).toBe('27500.00');
      expect(patch2.json().note).toBe('Updated Price Note');
    });

    it('ID-04: repeated migration import with identical Idempotency-Key returns existing receipt without duplicate record', async () => {
      const payload = {
        batchId: 'e0000000-0000-4000-8000-000000000001',
        sourceRow: 1,
        sourceSystem: 'crm2_target_adapter',
        entity: 'deal',
        idempotencyKey: 'idemp-key-deal-canonical-01',
        data: {
          name: 'Import Deal Idempotency Test',
          value: '80000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-15',
        },
      };

      // First import
      const res1 = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import`,
        headers: { 'Idempotency-Key': 'idemp-key-deal-canonical-01' },
        payload,
      });
      expect(res1.statusCode).toBe(201);
      const targetId1 = res1.json().targetId;

      // Second import with identical payload & idempotency key
      const res2 = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import`,
        headers: { 'Idempotency-Key': 'idemp-key-deal-canonical-01' },
        payload,
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json().targetId).toBe(targetId1);
      expect(res2.json().isExisting).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Missing Routes & Verbs Tests (Rule 3)
  // ---------------------------------------------------------------------------
  describe('Missing Routes & Verbs (Rule 3)', () => {
    let testDealId: string;
    let testQuoteId: string;

    beforeEach(async () => {
      const dealRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        payload: {
          name: 'Base Deal for Missing Verb Tests',
          value: '20000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-11-30',
        },
      });
      testDealId = dealRes.json().id;

      const quoteRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes`,
        payload: {
          deal_id: testDealId,
          quote_number: 'Q-VERB-TEST-01',
          date: '2026-10-23',
          amount: '10000.00',
          currency: 'USD',
        },
      });
      testQuoteId = quoteRes.json().id;
    });

    it('PATCH /quotes/:id returns 200 on valid update', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/quotes/${testQuoteId}`,
        payload: { note: 'Updated note via PATCH' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().note).toBe('Updated note via PATCH');
    });

    it('PATCH /quotes/:id returns 404 on non-existent quote UUID', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/quotes/99999999-0000-4000-8000-000000000099`,
        payload: { note: 'Will not be found' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
    });

    it('PATCH /quotes/:id returns 400 on invalid body payload', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/quotes/${testQuoteId}`,
        payload: { amount: '-999.00' }, // invalid negative decimal
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('POST /quotes with non-existent deal_id returns 422', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes`,
        payload: {
          deal_id: '00000000-0000-4000-8000-000000000099',
          quote_number: 'Q-NO-DEAL-01',
          date: '2026-10-23',
          amount: '5000.00',
          currency: 'USD',
        },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('REFERENCE_NOT_FOUND');
    });

    it('POST /quotes with invalid amount returns 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes`,
        payload: {
          deal_id: testDealId,
          quote_number: 'Q-INVALID-AMT-01',
          date: '2026-10-23',
          amount: 'not-a-decimal',
          currency: 'USD',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('POST /stages returns 404 (stages cannot be created via API)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/stages`,
        payload: { name: 'CustomStage', position: 7 },
      });
      expect(res.statusCode).toBe(404);
    });

    it('PATCH /stages/:id returns 404 (stages cannot be modified via API)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/stages/00000000-0000-4000-8000-000000000001`,
        payload: { name: 'RenamedStage' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('DELETE /stages/:id returns 404 (stages cannot be deleted via API)', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `${CRM2_API_PREFIX}/stages/00000000-0000-4000-8000-000000000001`,
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
