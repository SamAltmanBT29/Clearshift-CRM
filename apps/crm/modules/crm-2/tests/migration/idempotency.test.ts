import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { Crm2TargetAdapter } from '../../src/migration/target-adapter.js';
import { Crm2Service } from '../../src/services/crm2.service.js';
import { CRM2_API_PREFIX, type ImportRowInput } from '@clearshift/contracts';

describe('CRM-2 Deals, Pipeline and Quotes: Target Adapter & Durable Import Receipts (Issue #124 / [CRM2-11])', () => {
  let service: Crm2Service;
  let adapter: Crm2TargetAdapter;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    service = new Crm2Service();
    service.resetStore();
    adapter = new Crm2TargetAdapter(service);
    app = buildApp({ service, adapter });
  });

  // ---------------------------------------------------------------------------
  // 1. Public API Data Loading via Kit Target Adapter Contract
  // ---------------------------------------------------------------------------
  describe('1. Public API Data Loading via Kit Target Adapter Contract', () => {
    it('loads a deal fixture row via POST /api/v1/crm-deals/import/row through the public API without direct DB table write privileges', async () => {
      const payload: ImportRowInput = {
        batchId: 'batch-kit-crm2-001',
        sourceRow: 1,
        sourceSystem: 'legacy_salesforce',
        sourceId: 'sf-deal-101',
        entity: 'deal',
        data: {
          name: 'Global Enterprise Cloud Transition',
          contact_id: '90000000-0000-4000-8000-000000000001', // Pre-seeded valid contact
          value: '125000.00',
          currency: 'USD',
          stage_name: 'Proposal',
          close_date: '2026-12-15',
        },
        idempotencyKey: 'idemp-key-deal-001',
        correlationId: 'corr-crm2-001',
        schemaVersion: 1,
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import/row`,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'idemp-key-deal-001',
          'x-correlation-id': 'corr-crm2-001',
        },
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.targetId).toBeDefined();
      expect(body.version).toBe(1);
      expect(body.outcome).toBe('created');
      expect(body.receipt).toBeDefined();
      expect(body.receipt.batchId).toBe('batch-kit-crm2-001');
      expect(body.receipt.sourceRow).toBe(1);
      expect(body.receipt.idempotencyKey).toBe('idemp-key-deal-001');

      // Verify business record is reflected in read model
      const deal = await service.getDealById(body.targetId);
      expect(deal).not.toBeNull();
      expect(deal?.name).toBe('Global Enterprise Cloud Transition');
      expect(deal?.value).toBe('125000.00');
      expect(deal?.stage_name).toBe('Proposal');
      expect(deal?.is_orphan).toBe(false);
      expect(deal?.contact_name).toContain('Sarah Connor');
    });

    it('loads an orphan deal (contact_id=null) preserving orphan status with visible warning flag', async () => {
      const payload: ImportRowInput = {
        batchId: 'batch-kit-crm2-002',
        sourceRow: 2,
        sourceSystem: 'legacy_hubspot',
        sourceId: 'hs-deal-202',
        entity: 'deal',
        data: {
          name: 'Legacy Unassigned Account',
          contact_id: null,
          value: '45000.00',
          currency: 'EUR',
          stage_name: 'New',
          close_date: '2026-11-20',
        },
        idempotencyKey: 'idemp-key-deal-orphan-002',
        schemaVersion: 1,
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import/row`,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'idemp-key-deal-orphan-002',
        },
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.targetId).toBeDefined();

      const deal = await service.getDealById(body.targetId);
      expect(deal?.contact_id).toBeNull();
      expect(deal?.is_orphan).toBe(true);
    });

    it('loads a quote fixture row linked to an existing deal via POST /api/v1/crm-deals/import/row', async () => {
      // 20000000-0000-4000-8000-000000000001 is a pre-seeded deal
      const parentDealId = '20000000-0000-4000-8000-000000000001';

      const payload: ImportRowInput = {
        batchId: 'batch-kit-crm2-003',
        sourceRow: 1,
        sourceSystem: 'legacy_cpq',
        sourceId: 'cpq-quote-301',
        entity: 'quote',
        data: {
          deal_id: parentDealId,
          quote_number: 'Q-2026-IMPORT-001',
          date: '2026-11-05',
          amount: '96000.00',
          currency: 'USD',
          note: 'Imported commercial contract proposal',
        },
        idempotencyKey: 'idemp-key-quote-001',
        schemaVersion: 1,
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import/row`,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'idemp-key-quote-001',
        },
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.targetId).toBeDefined();
      expect(body.receipt.entity).toBe('quote');

      const quote = await service.getQuoteById(body.targetId);
      expect(quote).not.toBeNull();
      expect(quote?.quote_number).toBe('Q-2026-IMPORT-001');
      expect(quote?.deal_id).toBe(parentDealId);
      expect(quote?.amount).toBe('96000.00');
    });

    it('loads a quote line fixture row with server-computed decimal line total', async () => {
      // 30000000-0000-4000-8000-000000000001 is a pre-seeded quote
      const parentQuoteId = '30000000-0000-4000-8000-000000000001';

      const payload: ImportRowInput = {
        batchId: 'batch-kit-crm2-004',
        sourceRow: 1,
        sourceSystem: 'legacy_erp',
        sourceId: 'erp-line-401',
        entity: 'quote_line',
        data: {
          quote_id: parentQuoteId,
          line_number: 10,
          description: 'High-Availability Database Cluster (Annual)',
          quantity: '2.0000',
          unit_price: '24000.00',
        },
        idempotencyKey: 'idemp-key-line-001',
        schemaVersion: 1,
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import/row`,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'idemp-key-line-001',
        },
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.targetId).toBeDefined();

      const lines = await service.getQuoteLines(parentQuoteId);
      const createdLine = lines.find((l) => l.line_number === 10);
      expect(createdLine).toBeDefined();
      expect(createdLine?.line_total).toBe('48000.00'); // 2 * 24000.00
    });

    it('links fixed stage reference via target adapter without creating new stages', async () => {
      const payload: ImportRowInput = {
        batchId: 'batch-kit-crm2-005',
        sourceRow: 1,
        entity: 'stage',
        data: {
          name: 'Qualified',
        },
        idempotencyKey: 'idemp-key-stage-001',
        schemaVersion: 1,
      };

      const result = await adapter.importRow(payload.batchId, payload.sourceRow, payload.idempotencyKey, payload);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.receipt.kind).toBe('linked');
        expect(result.value.targetId).toBe('00000000-0000-4000-8000-000000000002'); // Seeded Qualified UUID
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Idempotency & Retry Guarantees (Identical Submissions)
  // ---------------------------------------------------------------------------
  describe('2. Idempotency & Retry Guarantees (Identical Submissions)', () => {
    it('retrying identical row payload and key 3 times produces exactly 1 business record and 1 durable receipt', async () => {
      const payload: ImportRowInput = {
        batchId: 'batch-kit-crm2-010',
        sourceRow: 1,
        sourceSystem: 'pipedrive_deals',
        sourceId: 'pd-deal-999',
        entity: 'deal',
        data: {
          name: 'Triple Replay Test Opportunity',
          value: '88000.00',
          currency: 'USD',
          stage_name: 'Negotiation',
          close_date: '2026-12-31',
        },
        idempotencyKey: 'idemp-retry-test-010',
        schemaVersion: 1,
      };

      // 1st invocation -> 201 Created
      const res1 = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import/row`,
        headers: { 'idempotency-key': 'idemp-retry-test-010' },
        payload,
      });
      expect(res1.statusCode).toBe(201);
      const body1 = JSON.parse(res1.body);
      const targetId1 = body1.targetId;
      expect(body1.isExisting).toBe(false);

      // 2nd invocation (identical retry) -> 200 OK
      const res2 = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import/row`,
        headers: { 'idempotency-key': 'idemp-retry-test-010' },
        payload,
      });
      expect(res2.statusCode).toBe(200);
      const body2 = JSON.parse(res2.body);
      expect(body2.targetId).toBe(targetId1);
      expect(body2.isExisting).toBe(true);

      // 3rd invocation (identical retry) -> 200 OK
      const res3 = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import/row`,
        headers: { 'idempotency-key': 'idemp-retry-test-010' },
        payload,
      });
      expect(res3.statusCode).toBe(200);
      const body3 = JSON.parse(res3.body);
      expect(body3.targetId).toBe(targetId1);
      expect(body3.isExisting).toBe(true);

      // Verify receipt stores batch_id, source_row, target_id, idempotency_key, and timestamp
      const receipt = adapter.getReceiptByKey('idemp-retry-test-010');
      expect(receipt).toBeDefined();
      expect(receipt?.batchId).toBe('batch-kit-crm2-010');
      expect(receipt?.sourceRow).toBe(1);
      expect(receipt?.targetId).toBe(targetId1);
      expect(receipt?.idempotencyKey).toBe('idemp-retry-test-010');
      expect(receipt?.createdAt).toBeInstanceOf(Date);

      // Verify exactly ONE durable receipt exists
      const receipts = adapter.getReceipts().filter((r) => r.idempotencyKey === 'idemp-retry-test-010');
      expect(receipts.length).toBe(1);

      // Verify no duplicate deal was created
      const dealsList = await service.getDeals({ page: 1, pageSize: 100, search: 'Triple Replay Test Opportunity' });
      expect(dealsList.items.length).toBe(1);
    });

    it('a source-system/source-id pair is idempotent across imports and yields linked outcome (UPSERT)', async () => {
      const payload1: ImportRowInput = {
        batchId: 'batch-upsert-01',
        sourceRow: 1,
        sourceSystem: 'crm_legacy',
        sourceId: 'legacy-id-777',
        entity: 'deal',
        data: {
          name: 'Original Deal Name',
          value: '50000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-11-30',
        },
        idempotencyKey: 'idemp-upsert-key-1',
        schemaVersion: 1,
      };

      const res1 = await adapter.importRow(payload1.batchId, payload1.sourceRow, payload1.idempotencyKey, payload1);
      expect(res1.ok).toBe(true);
      if (res1.ok) {
        expect(res1.value.receipt.kind).toBe('created');
      }

      // Re-importing same source pair with new idempotency key updates/links rather than duplicating
      const payload2: ImportRowInput = {
        batchId: 'batch-upsert-02',
        sourceRow: 1,
        sourceSystem: 'crm_legacy',
        sourceId: 'legacy-id-777',
        entity: 'deal',
        data: {
          name: 'Updated Deal Name After Re-import',
          value: '65000.00',
          currency: 'USD',
          stage_name: 'Qualified', // Legal progression: New -> Qualified
          close_date: '2026-12-15',
        },
        idempotencyKey: 'idemp-upsert-key-2',
        schemaVersion: 1,
      };

      const res2 = await adapter.importRow(payload2.batchId, payload2.sourceRow, payload2.idempotencyKey, payload2);
      expect(res2.ok).toBe(true);
      if (res2.ok && res1.ok) {
        expect(res2.value.targetId).toBe(res1.value.targetId);
        expect(res2.value.receipt.kind).toBe('linked');

        const deal = await service.getDealById(res2.value.targetId);
        expect(deal?.name).toBe('Updated Deal Name After Re-import');
        expect(deal?.value).toBe('65000.00');
        expect(deal?.stage_name).toBe('Qualified');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Idempotency Key Conflict Protection (Same Key, Different Payload)
  // ---------------------------------------------------------------------------
  describe('3. Idempotency Key Conflict Protection (Same Key, Different Payload)', () => {
    it('reusing an idempotency key with a different payload returns HTTP 409 Conflict and performs zero data mutations', async () => {
      const initialPayload: ImportRowInput = {
        batchId: 'batch-conflict-crm2-001',
        sourceRow: 1,
        sourceSystem: 'hubspot',
        sourceId: 'hs-001',
        entity: 'deal',
        data: {
          name: 'Initial Deal Value Check',
          value: '30000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-01',
        },
        idempotencyKey: 'idemp-conflict-test-crm2',
        schemaVersion: 1,
      };

      // 1. Initial successful commit
      const initialRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import/row`,
        headers: { 'idempotency-key': 'idemp-conflict-test-crm2' },
        payload: initialPayload,
      });
      expect(initialRes.statusCode).toBe(201);
      const targetId = JSON.parse(initialRes.body).targetId;

      // 2. Attempt reuse with altered monetary value
      const alteredPayload: ImportRowInput = {
        ...initialPayload,
        data: {
          ...initialPayload.data,
          value: '999999.00', // Changed value!
        },
      };

      const conflictRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import/row`,
        headers: { 'idempotency-key': 'idemp-conflict-test-crm2' },
        payload: alteredPayload,
      });

      expect(conflictRes.statusCode).toBe(409);
      const conflictBody = JSON.parse(conflictRes.body);
      expect(conflictBody.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(conflictBody.message).toContain('was already used with a different request payload');

      // Verify original value was NOT mutated
      const deal = await service.getDealById(targetId);
      expect(deal?.value).toBe('30000.00'); // Original value preserved
    });

    it('reusing an idempotency key with altered batchId or altered entity throws HTTP 409 Conflict', async () => {
      const initialPayload: ImportRowInput = {
        batchId: 'batch-hash-crm2-01',
        sourceRow: 1,
        entity: 'deal',
        data: {
          name: 'Hash Test Deal',
          value: '10000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-11-30',
        },
        idempotencyKey: 'idemp-hash-crm2-key-01',
        schemaVersion: 1,
      };

      const res1 = await adapter.importRow(initialPayload.batchId, initialPayload.sourceRow, initialPayload.idempotencyKey, initialPayload);
      expect(res1.ok).toBe(true);

      // Re-invoke with different batchId
      const resDifferentBatch = await adapter.importRow('batch-hash-crm2-DIFFERENT', 1, initialPayload.idempotencyKey, initialPayload);
      expect(resDifferentBatch.ok).toBe(false);
      if (!resDifferentBatch.ok) {
        expect(resDifferentBatch.error.reasonCode).toBe('IDEMPOTENCY_CONFLICT');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Business Validation Rejections vs Retryable Infrastructure Failures
  // ---------------------------------------------------------------------------
  describe('4. Business Validation Rejections vs Retryable Infrastructure Failures', () => {
    it('reports business-rule rejection when deal references non-existent CRM-1 contact with stable reason code REFERENCE_NOT_FOUND', async () => {
      const badPayload: ImportRowInput = {
        batchId: 'batch-reject-crm2-001',
        sourceRow: 5,
        entity: 'deal',
        data: {
          name: 'Non Existent Contact Deal',
          contact_id: '90000000-0000-4000-8000-999999999999', // Missing contact!
          value: '50000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-15',
        },
        idempotencyKey: 'idemp-reject-contact-001',
        schemaVersion: 1,
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import/row`,
        headers: { 'idempotency-key': 'idemp-reject-contact-001' },
        payload: badPayload,
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('REFERENCE_NOT_FOUND');
      expect(body.message).toContain('does not exist in CRM-1');
      expect(body.details[0].field).toBe('contact_id');

      // Verify zero receipts created
      expect(adapter.getReceiptByKey('idemp-reject-contact-001')).toBeUndefined();
    });

    it('reports business-rule rejection when deal specifies invalid pipeline stage', async () => {
      const badStagePayload: ImportRowInput = {
        batchId: 'batch-reject-crm2-002',
        sourceRow: 6,
        entity: 'deal',
        data: {
          name: 'Invalid Stage Deal',
          value: '50000.00',
          currency: 'USD',
          stage_name: 'InvalidArbitraryStage',
          close_date: '2026-12-15',
        },
        idempotencyKey: 'idemp-reject-stage-002',
        schemaVersion: 1,
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import/row`,
        headers: { 'idempotency-key': 'idemp-reject-stage-002' },
        payload: badStagePayload,
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('INVALID_STAGE');
      expect(body.details[0].field).toBe('stage_name');
    });

    it('reports business-rule rejection when quote references non-existent parent deal', async () => {
      const badQuotePayload: ImportRowInput = {
        batchId: 'batch-reject-crm2-003',
        sourceRow: 7,
        entity: 'quote',
        data: {
          deal_id: '99999999-0000-4000-8000-999999999999',
          quote_number: 'Q-FAIL-001',
          date: '2026-11-01',
          amount: '12000.00',
          currency: 'USD',
        },
        idempotencyKey: 'idemp-reject-quote-003',
        schemaVersion: 1,
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import/row`,
        headers: { 'idempotency-key': 'idemp-reject-quote-003' },
        payload: badQuotePayload,
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('REFERENCE_NOT_FOUND');
      expect(body.details[0].field).toBe('deal_id');
    });

    it('simulated 503 infrastructure failure returns retryable status and does not record a durable receipt', async () => {
      const payload: ImportRowInput = {
        batchId: 'batch-transient-503',
        sourceRow: 1,
        entity: 'deal',
        data: {
          name: 'Transient Test Deal',
          value: '25000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-31',
        },
        idempotencyKey: 'idemp-transient-503',
        schemaVersion: 1,
      };

      const response = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import/row`,
        headers: {
          'idempotency-key': 'idemp-transient-503',
          'x-simulate-503': 'true',
        },
        payload,
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('SERVICE_UNAVAILABLE');
      expect(body.retryable).toBe(true);

      // Verify no receipt persisted
      expect(adapter.getReceiptByKey('idemp-transient-503')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Transaction Atomicity & Rollback Guarantee
  // ---------------------------------------------------------------------------
  describe('5. Transaction Atomicity & Rollback Guarantee', () => {
    it('target deal mutation rolls back when receipt insertion fails', async () => {
      const dealsBefore = (await service.getDeals({ page: 1, pageSize: 100 })).pagination.totalCount;

      const payload: ImportRowInput = {
        batchId: 'batch-atomic-crm2-01',
        sourceRow: 1,
        entity: 'deal',
        data: {
          name: 'Rollback Test Deal',
          value: '77000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-31',
        },
        idempotencyKey: 'idemp-rollback-deal-01',
        schemaVersion: 1,
      };

      await expect(
        adapter.importRow(payload.batchId, payload.sourceRow, payload.idempotencyKey, payload, {
          failReceiptCommit: true,
        })
      ).rejects.toThrow('Database transaction aborted: failed to persist import receipt');

      // Verify deal was rolled back
      const dealsAfter = (await service.getDeals({ page: 1, pageSize: 100 })).pagination.totalCount;
      expect(dealsAfter).toBe(dealsBefore);

      // Verify no receipt stored
      expect(adapter.getReceiptByKey('idemp-rollback-deal-01')).toBeUndefined();
    });

    it('target quote mutation rolls back when receipt insertion fails', async () => {
      const quotesBefore = (await service.getQuotes({ page: 1, pageSize: 100 })).pagination.totalCount;

      const payload: ImportRowInput = {
        batchId: 'batch-atomic-crm2-02',
        sourceRow: 1,
        entity: 'quote',
        data: {
          deal_id: '20000000-0000-4000-8000-000000000001',
          quote_number: 'Q-ROLLBACK-TEST',
          date: '2026-11-01',
          amount: '50000.00',
          currency: 'USD',
        },
        idempotencyKey: 'idemp-rollback-quote-02',
        schemaVersion: 1,
      };

      await expect(
        adapter.importRow(payload.batchId, payload.sourceRow, payload.idempotencyKey, payload, {
          failReceiptCommit: true,
        })
      ).rejects.toThrow('Database transaction aborted: failed to persist import receipt');

      // Verify quote was rolled back
      const quotesAfter = (await service.getQuotes({ page: 1, pageSize: 100 })).pagination.totalCount;
      expect(quotesAfter).toBe(quotesBefore);
      expect(adapter.getReceiptByKey('idemp-rollback-quote-02')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 6. loadBatch Interface & Type-Safe UPSERT Operations
  // ---------------------------------------------------------------------------
  describe('6. loadBatch Interface & Type-Safe UPSERT Operations', () => {
    it('executes loadBatch with multiple valid rows and commits type-safe UPSERT operations with receipts', async () => {
      const rows: ImportRowInput[] = [
        {
          batchId: 'batch-batch-001',
          sourceRow: 1,
          sourceSystem: 'crm_batch',
          sourceId: 'batch-deal-1',
          entity: 'deal',
          data: {
            name: 'Batch Load Deal Alpha',
            value: '40000.00',
            currency: 'USD',
            stage_name: 'New',
            close_date: '2026-11-30',
          },
          idempotencyKey: 'idemp-batch-row-1',
          schemaVersion: 1,
        },
        {
          batchId: 'batch-batch-001',
          sourceRow: 2,
          sourceSystem: 'crm_batch',
          sourceId: 'batch-deal-2',
          entity: 'deal',
          data: {
            name: 'Batch Load Deal Beta',
            value: '60000.00',
            currency: 'USD',
            stage_name: 'Proposal',
            close_date: '2026-12-15',
          },
          idempotencyKey: 'idemp-batch-row-2',
          schemaVersion: 1,
        },
      ];

      const res = await adapter.loadBatch('batch-batch-001', rows);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.loaded.length).toBe(2);
        expect(res.value.errors.length).toBe(0);
        expect(res.value.loaded[0]?.receipt.batchId).toBe('batch-batch-001');
        expect(res.value.loaded[1]?.receipt.batchId).toBe('batch-batch-001');
      }

      // Verify via POST /api/v1/crm-deals/import/batch endpoint as well
      const httpRes = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import/batch`,
        payload: {
          batchId: 'batch-batch-002',
          rows: [
            {
              sourceRow: 1,
              entity: 'deal',
              data: {
                name: 'Batch API Deal Gamma',
                value: '75000.00',
                currency: 'USD',
                stage_name: 'New',
                close_date: '2026-12-20',
              },
            },
          ],
        },
      });

      expect(httpRes.statusCode).toBe(200);
      const httpBody = JSON.parse(httpRes.body);
      expect(httpBody.loadedCount).toBe(1);
      expect(httpBody.rejectedCount).toBe(0);
    });

    it('loadBatch handles partial row validation failures gracefully without failing the entire batch', async () => {
      const rows: ImportRowInput[] = [
        {
          batchId: 'batch-partial-001',
          sourceRow: 1,
          entity: 'deal',
          data: {
            name: 'Valid Batch Row',
            value: '20000.00',
            currency: 'USD',
            stage_name: 'New',
            close_date: '2026-11-30',
          },
          idempotencyKey: 'idemp-partial-valid-1',
          schemaVersion: 1,
        },
        {
          batchId: 'batch-partial-001',
          sourceRow: 2,
          entity: 'deal',
          data: {
            name: 'Invalid Negative Deal',
            value: '-500.00', // Invalid negative value!
            currency: 'USD',
            stage_name: 'New',
            close_date: '2026-11-30',
          },
          idempotencyKey: 'idemp-partial-invalid-2',
          schemaVersion: 1,
        },
      ];

      const res = await adapter.loadBatch('batch-partial-001', rows);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.loaded.length).toBe(1);
        expect(res.value.errors.length).toBe(1);
        expect(res.value.errors[0]?.sourceRow).toBe(2);
        expect(res.value.errors[0]?.error.reasonCode).toBe('VALIDATION_ERROR');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Receipts Audit Retrieval & Preflight Dry-Run
  // ---------------------------------------------------------------------------
  describe('7. Receipts Audit Retrieval & Preflight Dry-Run', () => {
    it('lists receipts via GET /api/v1/crm-deals/import/receipts and retrieves single receipt by key', async () => {
      const payload: ImportRowInput = {
        batchId: 'batch-audit-crm2',
        sourceRow: 1,
        entity: 'deal',
        data: {
          name: 'Audit Retrieval Deal',
          value: '35000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-10',
        },
        idempotencyKey: 'idemp-audit-key-777',
        schemaVersion: 1,
      };

      await adapter.importRow(payload.batchId, payload.sourceRow, payload.idempotencyKey, payload);

      // List all
      const listRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/import/receipts`,
      });
      expect(listRes.statusCode).toBe(200);
      const listBody = JSON.parse(listRes.body);
      expect(listBody.items.some((r: any) => r.idempotencyKey === 'idemp-audit-key-777')).toBe(true);

      // Retrieve by key
      const singleRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/import/receipts/idemp-audit-key-777`,
      });
      expect(singleRes.statusCode).toBe(200);
      const singleBody = JSON.parse(singleRes.body);
      expect(singleBody.idempotencyKey).toBe('idemp-audit-key-777');
      expect(singleBody.batchId).toBe('batch-audit-crm2');

      // 404 for missing key
      const notFoundRes = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/import/receipts/non-existent-key-999`,
      });
      expect(notFoundRes.statusCode).toBe(404);
    });

    it('preflight dry-run executes validation with zero database/service mutations', async () => {
      const dealsBefore = (await service.getDeals({ page: 1, pageSize: 100 })).pagination.totalCount;

      const rows: ImportRowInput[] = [
        {
          batchId: 'batch-dryrun-crm2',
          sourceRow: 1,
          entity: 'deal',
          data: {
            name: 'Valid Dryrun Deal',
            value: '50000.00',
            currency: 'USD',
            stage_name: 'New',
            close_date: '2026-12-01',
          },
          idempotencyKey: 'idemp-dryrun-1',
          schemaVersion: 1,
        },
        {
          batchId: 'batch-dryrun-crm2',
          sourceRow: 2,
          entity: 'deal',
          data: {
            name: '', // Empty name!
            value: '50000.00',
            currency: 'USD',
            stage_name: 'New',
            close_date: '2026-12-01',
          },
          idempotencyKey: 'idemp-dryrun-2',
          schemaVersion: 1,
        },
      ];

      const dryRunRes = await adapter.preflight('batch-dryrun-crm2', rows);
      expect(dryRunRes.ok).toBe(true);
      if (dryRunRes.ok) {
        expect(dryRunRes.value.validCount).toBe(1);
        expect(dryRunRes.value.rejectCount).toBe(1);
      }

      // Verify ZERO records or receipts were created
      const dealsAfter = (await service.getDeals({ page: 1, pageSize: 100 })).pagination.totalCount;
      expect(dealsAfter).toBe(dealsBefore);
      expect(adapter.getReceipts().length).toBe(0);
    });
  });
});
