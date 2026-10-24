import { describe, expect, it, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  CRM2MockStore,
  crm2MockPlugin,
  createDeterministicMockStages,
  createDeterministicMockDeals,
  createDeterministicMockQuotes,
  createDeterministicMockCrm2Duplicates,
  createDeterministicMockReceipts,
} from '../src/crm-2-mock.js';
import { CRM2_API_PREFIX, CRM2_STAGES } from '../src/crm-2.js';

describe('CRM-2 Deterministic Mock Server & Store (Issue #2127 / [CRM2-14])', () => {
  let app: FastifyInstance;
  let store: CRM2MockStore;

  beforeEach(async () => {
    store = new CRM2MockStore();
    app = Fastify({ logger: false });
    await app.register(crm2MockPlugin, {
      store,
      prefix: CRM2_API_PREFIX,
    });
    await app.ready();
  });

  describe('1. Deterministic Synthetic Fixture Generators', () => {
    it('generates predictable, strictly synthetic CRM-2 fixtures with zero real PII', () => {
      const stages = createDeterministicMockStages();
      expect(stages).toHaveLength(6);
      expect(stages.map((s) => s.name)).toEqual(CRM2_STAGES);

      const deals = createDeterministicMockDeals();
      expect(deals.length).toBeGreaterThanOrEqual(6);
      expect(deals.some((d) => d.is_orphan === true)).toBe(true);
      expect(deals.some((d) => d.stage_name === 'Won')).toBe(true);
      expect(deals.some((d) => d.stage_name === 'Lost')).toBe(true);

      const quotes = createDeterministicMockQuotes();
      expect(quotes.length).toBeGreaterThanOrEqual(3);
      expect(quotes.every((q) => q.quote_number.startsWith('Q-'))).toBe(true);

      const duplicates = createDeterministicMockCrm2Duplicates();
      expect(duplicates.length).toBeGreaterThanOrEqual(1);

      const receipts = createDeterministicMockReceipts();
      expect(receipts.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('2. In-Memory Mock Store Operations & Domain Invariants', () => {
    it('retrieves paginated deals with search and stage filters', () => {
      const res1 = store.getDeals({ page: 1, pageSize: 2 });
      expect(res1.items).toHaveLength(2);
      expect(res1.pagination.totalCount).toBeGreaterThanOrEqual(6);
      expect(res1.pagination.totalPages).toBeGreaterThanOrEqual(3);
      expect(res1.pagination.hasNextPage).toBe(true);
      expect(res1.pagination.hasPreviousPage).toBe(false);

      const res2 = store.getDeals({ search: 'Acme' });
      expect(res2.items.length).toBeGreaterThanOrEqual(1);
      expect(res2.items[0].name).toContain('Acme');

      const res3 = store.getDeals({ stage: 'Proposal' });
      expect(res3.items.every((d) => d.stage_name === 'Proposal')).toBe(true);

      const resOrphan = store.getDeals({ is_orphan: true });
      expect(resOrphan.items.length).toBeGreaterThanOrEqual(1);
      expect(resOrphan.items.every((d) => d.is_orphan === true)).toBe(true);
    });

    it('creates a new deal and derives orphan status from contact_id presence', () => {
      const orphanDeal = store.createDeal({
        name: 'Inbound Pilot Engagement',
        value: '50000.00',
        currency: 'USD',
        close_date: '2026-12-15',
      });
      expect(orphanDeal.id).toBeDefined();
      expect(orphanDeal.stage_name).toBe('New');
      expect(orphanDeal.contact_id).toBeNull();
      expect(orphanDeal.is_orphan).toBe(true);

      const linkedDeal = store.createDeal({
        name: 'Strategic Enterprise Deal',
        contact_id: '00000000-0000-4000-8000-000000000001',
        value: '100000.00',
        currency: 'USD',
        close_date: '2026-12-31',
      });
      expect(linkedDeal.contact_id).toBe('00000000-0000-4000-8000-000000000001');
      expect(linkedDeal.is_orphan).toBe(false);
    });

    it('enforces legal forward state transitions and emits deal.won event on Won', () => {
      const deal = store.createDeal({
        name: 'Pipeline Transition Deal',
        value: '90000.00',
        currency: 'USD',
        close_date: '2026-11-30',
        stage_name: 'New',
      });

      // New -> Qualified
      const s1 = store.updateDeal(deal.id, { stage_name: 'Qualified' });
      expect(s1.stage_name).toBe('Qualified');

      // Qualified -> Proposal
      const s2 = store.updateDeal(deal.id, { stage_name: 'Proposal' });
      expect(s2.stage_name).toBe('Proposal');

      // Proposal -> Negotiation
      const s3 = store.updateDeal(deal.id, { stage_name: 'Negotiation' });
      expect(s3.stage_name).toBe('Negotiation');

      // Negotiation -> Won (Triggers deal.won event)
      const initialEventsCount = store.getEmittedEvents().length;
      const s4 = store.updateDeal(deal.id, { stage_name: 'Won' });
      expect(s4.stage_name).toBe('Won');

      const emitted = store.getEmittedEvents();
      expect(emitted.length).toBe(initialEventsCount + 1);
      const wonEvent = emitted[emitted.length - 1];
      expect(wonEvent.eventType).toBe('deal.won');
      expect((wonEvent.payload as any).dealId).toBe(deal.id);
    });

    it('enforces immediate transition to Lost and forbids outgoing transitions from terminal stages', () => {
      const deal = store.createDeal({
        name: 'Lost Pipeline Deal',
        value: '20000.00',
        currency: 'USD',
        close_date: '2026-11-15',
        stage_name: 'New',
      });

      // Immediate transition to Lost is allowed
      const lostDeal = store.updateDeal(deal.id, { stage_name: 'Lost' });
      expect(lostDeal.stage_name).toBe('Lost');

      // Forbidden: Lost -> Qualified
      expect(() =>
        store.updateDeal(deal.id, { stage_name: 'Qualified' })
      ).toThrowError(/cannot transition/);
    });

    it('rejects forbidden backward and skip stage transitions', () => {
      const deal = store.createDeal({
        name: 'Invalid Transition Deal',
        value: '40000.00',
        currency: 'USD',
        close_date: '2026-11-30',
        stage_name: 'New',
      });

      // Skip: New -> Won
      expect(() =>
        store.updateDeal(deal.id, { stage_name: 'Won' })
      ).toThrowError(/cannot transition/);
    });

    it('prevents deleting a deal that has active quotes (409 Conflict)', () => {
      const dealWithQuotes = store.getDeals().items[0]; // has quote Q-2026-001
      expect(() => store.deleteDeal(dealWithQuotes.id)).toThrowError(
        /Cannot delete deal.*active quote/
      );
    });

    it('allows deleting a deal without active quotes', () => {
      const standaloneDeal = store.createDeal({
        name: 'Standalone Clean Deal',
        value: '15000.00',
        currency: 'USD',
        close_date: '2026-11-30',
      });
      const result = store.deleteDeal(standaloneDeal.id);
      expect(result.success).toBe(true);
      expect(store.getDealById(standaloneDeal.id)).toBeNull();
    });

    it('creates quotes linked to deals and enforces unique quote numbers', () => {
      const deal = store.getDeals().items[1];
      const quote = store.createQuote({
        deal_id: deal.id,
        quote_number: 'Q-UNIQUE-999',
        amount: '65000.00',
        currency: 'USD',
        note: 'Special pricing proposal',
      });
      expect(quote.id).toBeDefined();
      expect(quote.quote_number).toBe('Q-UNIQUE-999');

      // Duplicate quote number rejection
      expect(() =>
        store.createQuote({
          deal_id: deal.id,
          quote_number: 'q-unique-999', // normalized case-insensitive
          amount: '70000.00',
        })
      ).toThrowError(/Duplicate Error: Quote number/);
    });

    it('rejects creating quote for non-existent deal with referential integrity error', () => {
      expect(() =>
        store.createQuote({
          deal_id: '99999999-9999-4999-8999-999999999999',
          amount: '10000.00',
        })
      ).toThrowError(/Referential Integrity Error/);
    });

    it('executes idempotent batch loads and duplicate candidate detection', () => {
      const batchResult = store.executeBatchLoad({
        batchId: 'batch-test-load-01',
        module: 'crm-2',
        step: 'load',
        chunkSize: 500,
        maxRetries: 3,
        failureThreshold: 0.1,
        minAttemptedRows: 50,
        records: [
          {
            sourceRow: 1,
            idempotencyKey: 'k-load-001',
            data: { name: 'Batch Deal 1', value: '10000.00' },
          },
        ],
      });
      expect(batchResult.status).toBe('COMPLETED');
      expect(batchResult.committedRecords).toBe(1);

      const dupResult = store.detectDuplicates({
        batchId: 'batch-dup-01',
        entity: 'deal',
        keyType: 'deal_business',
        records: [
          { id: 'd-1', keyValue: 'dup-key-val', payload: {} },
          { id: 'd-2', keyValue: 'dup-key-val', payload: {} },
        ],
      });
      expect(dupResult.duplicateGroupsCount).toBe(1);
      expect(dupResult.candidates[0].recordIds).toEqual(['d-1', 'd-2']);
    });
  });

  describe('3. Fastify HTTP Mock Endpoints', () => {
    describe('GET /health', () => {
      it('returns healthy status code 200 without authentication', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/health`,
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.status).toBe('healthy');
        expect(body.module).toBe('crm-2');
      });
    });

    describe('GET /stages', () => {
      it('returns all 6 fixed pipeline stages in canonical order', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/stages`,
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.items).toHaveLength(6);
        expect(body.items.map((s: any) => s.name)).toEqual(CRM2_STAGES);
      });
    });

    describe('GET /deals', () => {
      it('returns paginated deals list with pagination metadata', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/deals?page=1&pageSize=3`,
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.items).toHaveLength(3);
        expect(body.pagination.totalCount).toBeGreaterThanOrEqual(6);
        expect(body.pagination.hasNextPage).toBe(true);
      });

      it('filters deals by pipeline stage', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/deals?stage=Qualified`,
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.items.every((d: any) => d.stage_name === 'Qualified')).toBe(true);
      });

      it('filters orphan deals (contact_id null)', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/deals?is_orphan=true`,
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.items.length).toBeGreaterThanOrEqual(1);
        expect(body.items.every((d: any) => d.is_orphan === true)).toBe(true);
      });

      it('strictly rejects pageSize exceeding bounded limit 100 with 400 Bad Request', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/deals?pageSize=101`,
        });
        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('POST /deals', () => {
      it('creates a new deal and returns 201 Created', async () => {
        const response = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/deals`,
          payload: {
            name: 'New Cloud Computing Contract',
            value: '80000.00',
            currency: 'USD',
            close_date: '2026-12-31',
          },
        });
        expect(response.statusCode).toBe(201);
        const body = response.json();
        expect(body.id).toBeDefined();
        expect(body.name).toBe('New Cloud Computing Contract');
        expect(body.is_orphan).toBe(true);
      });

      it('rejects invalid payload missing required name or close_date with 400 Bad Request', async () => {
        const response = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/deals`,
          payload: {
            value: '80000.00',
          },
        });
        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('GET /deals/:id and PATCH /deals/:id', () => {
      it('retrieves single deal by id with 200 OK', async () => {
        const existing = store.getDeals().items[0];
        const response = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/deals/${existing.id}`,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().id).toBe(existing.id);
      });

      it('returns 404 Not Found for non-existent deal', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/deals/99999999-9999-4999-8999-999999999999`,
        });
        expect(response.statusCode).toBe(404);
        const body = response.json();
        expect(body.code).toBe('NOT_FOUND');
      });

      it('updates deal with 200 OK on valid stage transition', async () => {
        const deal = store.createDeal({
          name: 'Stage Transition HTTP Deal',
          value: '35000.00',
          currency: 'USD',
          close_date: '2026-12-31',
          stage_name: 'New',
        });

        const response = await app.inject({
          method: 'PATCH',
          url: `${CRM2_API_PREFIX}/deals/${deal.id}`,
          payload: { stage_name: 'Qualified' },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().stage_name).toBe('Qualified');
      });

      it('returns 422 Unprocessable Entity on forbidden stage transition', async () => {
        const deal = store.createDeal({
          name: 'Forbidden Transition Deal',
          value: '35000.00',
          currency: 'USD',
          close_date: '2026-12-31',
          stage_name: 'Proposal',
        });

        const response = await app.inject({
          method: 'PATCH',
          url: `${CRM2_API_PREFIX}/deals/${deal.id}`,
          payload: { stage_name: 'New' }, // Forbidden backward transition
        });
        expect(response.statusCode).toBe(422);
        const body = response.json();
        expect(body.code).toBe('INVALID_DEAL_STAGE_TRANSITION');
        expect(body.message).toContain('cannot transition');
      });
    });

    describe('DELETE /deals/:id', () => {
      it('returns 409 Conflict when attempting to delete deal with linked quotes', async () => {
        const dealWithQuotes = store.getDeals().items[0];
        const response = await app.inject({
          method: 'DELETE',
          url: `${CRM2_API_PREFIX}/deals/${dealWithQuotes.id}`,
        });
        expect(response.statusCode).toBe(409);
        const body = response.json();
        expect(body.code).toBe('CONFLICT');
      });

      it('returns 200 OK when deleting deal without linked quotes', async () => {
        const deal = store.createDeal({
          name: 'Deletable Standalone Deal',
          value: '10000.00',
          currency: 'USD',
          close_date: '2026-11-30',
        });

        const response = await app.inject({
          method: 'DELETE',
          url: `${CRM2_API_PREFIX}/deals/${deal.id}`,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().success).toBe(true);
      });
    });

    describe('Quotes Endpoints', () => {
      it('GET /quotes returns paginated quotes list with 200 OK', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/quotes`,
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.items.length).toBeGreaterThanOrEqual(3);
      });

      it('POST /quotes creates a quote with 201 Created', async () => {
        const deal = store.getDeals().items[1];
        const response = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/quotes`,
          payload: {
            deal_id: deal.id,
            quote_number: 'Q-HTTP-TEST-001',
            amount: '45000.00',
            currency: 'USD',
            note: 'HTTP Test Quote',
          },
        });
        expect(response.statusCode).toBe(201);
        expect(response.json().quote_number).toBe('Q-HTTP-TEST-001');
      });

      it('POST /quotes returns 409 Conflict on duplicate quote number', async () => {
        const deal = store.getDeals().items[1];
        const existingQuote = store.getQuotes().items[0];

        const response = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/quotes`,
          payload: {
            deal_id: deal.id,
            quote_number: existingQuote.quote_number,
            amount: '50000.00',
          },
        });
        expect(response.statusCode).toBe(409);
        expect(response.json().code).toBe('CONFLICT');
      });

      it('POST /quotes returns 422 Unprocessable Entity when deal does not exist', async () => {
        const response = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/quotes`,
          payload: {
            deal_id: '00000000-0000-4000-8000-000000000099',
            amount: '25000.00',
          },
        });
        expect(response.statusCode).toBe(422);
        expect(response.json().code).toBe('DEAL_NOT_FOUND');
      });

      it('GET /quotes/:id returns single quote with 200 OK or 404 for missing', async () => {
        const existing = store.getQuotes().items[0];
        const resOk = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/quotes/${existing.id}`,
        });
        expect(resOk.statusCode).toBe(200);
        expect(resOk.json().id).toBe(existing.id);

        const resNotFound = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/quotes/99999999-9999-4999-8999-999999999999`,
        });
        expect(resNotFound.statusCode).toBe(404);
      });

      it('PATCH /quotes/:id updates quote with 200 OK', async () => {
        const existing = store.getQuotes().items[0];
        const response = await app.inject({
          method: 'PATCH',
          url: `${CRM2_API_PREFIX}/quotes/${existing.id}`,
          payload: { amount: '130000.00' },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().amount).toBe('130000.00');
      });

      it('DELETE /quotes/:id removes quote with 200 OK', async () => {
        const deal = store.getDeals().items[1];
        const quote = store.createQuote({
          deal_id: deal.id,
          amount: '15000.00',
        });

        const response = await app.inject({
          method: 'DELETE',
          url: `${CRM2_API_PREFIX}/quotes/${quote.id}`,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().success).toBe(true);
      });
    });

    describe('Import & Batch Load Endpoints', () => {
      it('POST /import/row creates idempotent receipt with 200 OK', async () => {
        const response = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/import/row`,
          payload: {
            row: {
              sourceId: 'src_row_http_01',
              name: 'Imported Row Deal',
              value: '60000.00',
              currency: 'USD',
              closeDate: '2026-11-20',
            },
            sourceSystem: 'hubspot_crm',
          },
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.status).toBe('created');
        expect(body.idempotencyKey).toBe('crm2-hubspot_crm-src_row_http_01');
      });

      it('POST /import/batch imports collection of records with loaded counts', async () => {
        const response = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/import/batch`,
          payload: {
            batchId: 'batch-http-import-100',
            sourceSystem: 'hubspot_crm',
            rows: [
              {
                sourceId: 'src_batch_01',
                name: 'Batch Deal A',
                value: '25000.00',
                currency: 'USD',
                closeDate: '2026-12-01',
              },
            ],
          },
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.loadedCount).toBe(1);
      });

      it('GET /import/receipts lists receipts and GET /import/receipts/:key retrieves single', async () => {
        const listRes = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/import/receipts`,
        });
        expect(listRes.statusCode).toBe(200);

        const singleRes = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/import/receipts/crm2-seed-deal-101`,
        });
        expect(singleRes.statusCode).toBe(200);
        expect(singleRes.json().idempotencyKey).toBe('crm2-seed-deal-101');
      });

      it('POST /batches/execute-load returns complete BatchExecutionReport', async () => {
        const response = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/batches/execute-load`,
          payload: {
            batchId: 'batch-http-exec-01',
            module: 'crm-2',
            records: [
              {
                sourceRow: 1,
                idempotencyKey: 'key-http-01',
                data: { name: 'Exec Load Deal 1', value: '45000.00' },
              },
            ],
          },
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.status).toBe('COMPLETED');
        expect(body.committedRecords).toBe(1);
      });
    });

    describe('Deduplication Endpoints', () => {
      it('POST /duplicates/detect detects exact duplicate key matches', async () => {
        const response = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/duplicates/detect`,
          payload: {
            batchId: 'batch-dup-http-01',
            entity: 'deal',
            keyType: 'deal_business',
            records: [
              { id: 'deal-a', keyValue: 'norm_key_1', payload: {} },
              { id: 'deal-b', keyValue: 'norm_key_1', payload: {} },
            ],
          },
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.duplicateGroupsCount).toBe(1);
      });

      it('GET /duplicates/held and POST /duplicates/resolve record human review decisions', async () => {
        const heldRes = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/duplicates/held`,
        });
        expect(heldRes.statusCode).toBe(200);
        const heldItems = heldRes.json().items;
        expect(heldItems.length).toBeGreaterThanOrEqual(1);

        const candidateId = heldItems[0].id;
        const resolveRes = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/duplicates/resolve`,
          payload: {
            candidateId,
            decision: 'MERGE',
            actorId: 'operator-alice',
            keptId: heldItems[0].recordIds[0],
            mergedId: heldItems[0].recordIds[1],
            reason: 'Confirmed identical duplicate deal records',
          },
        });
        expect(resolveRes.statusCode).toBe(200);
        expect(resolveRes.json().status).toBe('resolved');

        const auditRes = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/duplicates/audit`,
        });
        expect(auditRes.statusCode).toBe(200);
        expect(auditRes.json().items.length).toBeGreaterThanOrEqual(1);
      });

      it('POST /deals/evaluate-duplicate evaluates deal against pool', async () => {
        const response = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/deals/evaluate-duplicate`,
          payload: {
            name: 'Acme Fleet Modernization Platform',
            stageId: '00000000-0000-4000-8000-000000000003',
            contactId: '00000000-0000-4000-8000-000000000001',
          },
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.isDuplicate).toBe(true);
      });

      it('POST /quotes/evaluate-duplicate evaluates quote against pool', async () => {
        const response = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/quotes/evaluate-duplicate`,
          payload: {
            quoteNumber: 'Q-2026-001',
          },
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.isDuplicate).toBe(true);
      });
    });
  });
});
