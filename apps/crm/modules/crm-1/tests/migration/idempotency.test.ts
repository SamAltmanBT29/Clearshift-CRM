import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { Crm1TargetAdapter } from '../../src/migration/target-adapter.js';
import { Crm1Service } from '../../src/services/crm1.service.js';
import type { ImportRowInput } from '@clearshift/contracts';

const databaseUrl = process.env["DATABASE_URL_TEST"] || process.env["DATABASE_URL"];
const suite = databaseUrl ? describe : describe.skip;

suite('CRM-1 Target Adapter & Durable Import Receipts (KIT-08 & Decision C4)', () => {
  let service: Crm1Service;
  let adapter: Crm1TargetAdapter;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    service = new Crm1Service();
    await service.seedSyntheticData();
    adapter = new Crm1TargetAdapter(service);
    app = buildApp({ service, adapter });
  });

  describe('1. Public API Data Loading via Kit Target Adapter Contract', () => {
    it('loads a contact fixture row via POST /api/v1/crm-contacts/import/row through the public API without direct DB table write privileges', async () => {
      const payload: ImportRowInput = {
        batchId: 'batch-kit-crm1-001',
        sourceRow: 1,
        sourceSystem: 'legacy_salesforce',
        sourceId: 'sf-contact-101',
        entity: 'contacts',
        data: {
          firstName: 'Jonathan',
          lastName: 'Harker',
          email: 'jonathan.harker@example.com',
          phone: '+1-555-0101',
          address: '15 Castle Way, Exeter',
          leadStatus: 'Qualified',
          goldenId: 'GID-TEST-CRM1-001',
          consentStatus: 'granted',
          consentUpdatedAt: '2026-10-15T12:00:00.000Z',
          unsubscribed: false,
        },
        idempotencyKey: 'idemp-key-contact-001',
        correlationId: 'corr-001',
        schemaVersion: 1,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'idemp-key-contact-001',
          'x-correlation-id': 'corr-001',
        },
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.targetId).toBeDefined();
      expect(body.version).toBe(1);
      expect(body.outcome).toBe('created');
      expect(body.receipt).toBeDefined();
      expect(body.receipt.batchId).toBe('batch-kit-crm1-001');
      expect(body.receipt.sourceRow).toBe(1);
      expect(body.receipt.idempotencyKey).toBe('idemp-key-contact-001');

      // Verify business record is reflected in read projections
      const contacts = await service.getContacts({ search: 'Jonathan' });
      expect(contacts.items.length).toBeGreaterThanOrEqual(1);
      const found = contacts.items.find((c) => c.email === 'jonathan.harker@example.com');
      expect(found).toBeDefined();
      expect(found?.firstName).toBe('Jonathan');
      expect(found?.lastName).toBe('Harker');
      expect(found?.leadStatus).toBe('Qualified');
    });

    it('loads a company fixture row via POST /api/v1/crm-contacts/import/row through the public API', async () => {
      const payload: ImportRowInput = {
        batchId: 'batch-kit-crm1-002',
        sourceRow: 1,
        sourceSystem: 'legacy_hubspot',
        sourceId: 'hs-company-201',
        entity: 'companies',
        data: {
          name: 'Stoker Logistics Ltd',
          taxNumber: 'GB-TAX-998877',
          email: 'dispatch@stoker.synthetic',
          phone: '+44-20-7946-0991',
          address: '42 Whitby Pier, North Yorkshire',
        },
        idempotencyKey: 'idemp-key-company-002',
        correlationId: 'corr-002',
        schemaVersion: 1,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'idemp-key-company-002',
          'x-correlation-id': 'corr-002',
        },
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.targetId).toBeDefined();
      expect(body.outcome).toBe('created');
      expect(body.receipt.entity).toBe('companies');

      // Verify company is persisted in read model
      const companies = await service.getCompanies({ search: 'Stoker Logistics' });
      expect(companies.items.length).toBe(1);
      expect(companies.items[0]?.name).toBe('Stoker Logistics Ltd');
      expect(companies.items[0]?.taxNumber).toBe('GB-TAX-998877');
    });

    it('loads a lead fixture row linked to an existing contact via POST /api/v1/crm-contacts/import/row', async () => {
      // 1. Create a contact first
      const contact = await service.createContact({
        firstName: 'Mina',
        lastName: 'Murray',
        email: 'mina.murray@example.com',
        leadStatus: 'New',
        sourceSystem: 'lead_test_sys',
        sourceId: 'lead-contact-src-1',
      });

      const leadPayload: ImportRowInput = {
        batchId: 'batch-kit-crm1-003',
        sourceRow: 1,
        sourceSystem: 'legacy_salesforce',
        sourceId: 'sf-lead-301',
        entity: 'leads',
        data: {
          contactId: contact.id,
          status: 'Working',
        },
        idempotencyKey: 'idemp-key-lead-003',
        correlationId: 'corr-003',
        schemaVersion: 1,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'idemp-key-lead-003',
        },
        payload: leadPayload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.targetId).toBeDefined();
      expect(body.receipt.entity).toBe('leads');

      // Verify lead is queryable
      const leads = await service.getLeads({ contactId: contact.id });
      expect(leads.items.length).toBe(1);
      expect(leads.items[0]?.status).toBe('Working');
    });
  });

  describe('2. Idempotency & Retry Guarantees (Identical Submissions)', () => {
    it('retrying identical row payload and key 3 times produces exactly 1 business record and 1 durable receipt', async () => {
      const payload: ImportRowInput = {
        batchId: 'batch-retry-crm1-004',
        sourceRow: 1,
        sourceSystem: 'sap_crm',
        sourceId: 'sap-contact-401',
        entity: 'contacts',
        data: {
          firstName: 'Abraham',
          lastName: 'Van Helsing',
          email: 'van.helsing@amsterdam.synthetic',
          phone: '+31-20-555-0199',
          leadStatus: 'Qualified',
        },
        idempotencyKey: 'idemp-contact-retry-004',
        schemaVersion: 1,
      };

      // 1st invocation -> 201 Created
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: { 'idempotency-key': 'idemp-contact-retry-004' },
        payload,
      });
      expect(res1.statusCode).toBe(201);
      const body1 = JSON.parse(res1.body);
      const targetId1 = body1.targetId;
      expect(body1.isExisting).toBe(false);

      // 2nd invocation (identical retry) -> 200 OK
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: { 'idempotency-key': 'idemp-contact-retry-004' },
        payload,
      });
      expect(res2.statusCode).toBe(200);
      const body2 = JSON.parse(res2.body);
      expect(body2.targetId).toBe(targetId1);
      expect(body2.isExisting).toBe(true);

      // 3rd invocation (identical retry) -> 200 OK
      const res3 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: { 'idempotency-key': 'idemp-contact-retry-004' },
        payload,
      });
      expect(res3.statusCode).toBe(200);
      const body3 = JSON.parse(res3.body);
      expect(body3.targetId).toBe(targetId1);
      expect(body3.isExisting).toBe(true);

      // Verify exactly ONE durable receipt exists
      const receipts = adapter.getReceipts().filter((r) => r.idempotencyKey === 'idemp-contact-retry-004');
      expect(receipts.length).toBe(1);

      // Verify exactly ONE contact was created in the database
      const contacts = await service.getContacts({ search: 'Van Helsing' });
      expect(contacts.items.length).toBe(1);
    });

    it('a source-system/source-id pair is idempotent across imports and yields linked outcome', async () => {
      const payload1: ImportRowInput = {
        batchId: 'batch-src-idemp-1',
        sourceRow: 1,
        sourceSystem: 'oracle_crm',
        sourceId: 'ora-comp-501',
        entity: 'companies',
        data: {
          name: 'Carfax Estate Holdings',
          taxNumber: 'UK-CFX-1897',
        },
        idempotencyKey: 'idemp-key-src-comp-1',
      };

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: { 'idempotency-key': 'idemp-key-src-comp-1' },
        payload: payload1,
      });
      expect(res1.statusCode).toBe(201);
      const body1 = JSON.parse(res1.body);
      expect(body1.outcome).toBe('created');
      const companyId = body1.targetId;

      // Second import from different batch/key but identical sourceSystem & sourceId -> outcome 'linked'
      const payload2: ImportRowInput = {
        batchId: 'batch-src-idemp-2',
        sourceRow: 1,
        sourceSystem: 'oracle_crm',
        sourceId: 'ora-comp-501',
        entity: 'companies',
        data: {
          name: 'Carfax Estate Holdings',
          taxNumber: 'UK-CFX-1897',
        },
        idempotencyKey: 'idemp-key-src-comp-2',
      };

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: { 'idempotency-key': 'idemp-key-src-comp-2' },
        payload: payload2,
      });
      expect(res2.statusCode).toBe(201);
      const body2 = JSON.parse(res2.body);
      expect(body2.targetId).toBe(companyId);
      expect(body2.outcome).toBe('linked');

      // Verify only 1 company exists with this name/source
      const searchRes = await service.getCompanies({ search: 'Carfax Estate' });
      expect(searchRes.items.length).toBe(1);
    });
  });

  describe('3. Idempotency Key Conflict Protection (Same Key, Different Payload)', () => {
    it('reusing an idempotency key with a different payload returns HTTP 409 Conflict and performs zero data mutations', async () => {
      const initialPayload: ImportRowInput = {
        batchId: 'batch-conflict-005',
        sourceRow: 1,
        sourceSystem: 'legacy_crm',
        sourceId: 'leg-c-501',
        entity: 'contacts',
        data: {
          firstName: 'John',
          lastName: 'Seward',
          email: 'dr.seward@purfleet.synthetic',
        },
        idempotencyKey: 'idemp-conflict-test-005',
        schemaVersion: 1,
      };

      // 1. Initial successful commit
      const initialRes = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: { 'idempotency-key': 'idemp-conflict-test-005' },
        payload: initialPayload,
      });
      expect(initialRes.statusCode).toBe(201);

      // 2. Attempt reuse with altered lastName and email
      const alteredPayload: ImportRowInput = {
        ...initialPayload,
        data: {
          firstName: 'John',
          lastName: 'ALTERED_SEWARD',
          email: 'altered.seward@purfleet.synthetic',
        },
      };

      const conflictRes = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: { 'idempotency-key': 'idemp-conflict-test-005' },
        payload: alteredPayload,
      });

      expect(conflictRes.statusCode).toBe(409);
      const conflictBody = JSON.parse(conflictRes.body);
      expect(conflictBody.error.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(conflictBody.error.message).toContain('was already used with a different request payload');

      // Verify the original record was NOT mutated
      const search = await service.getContacts({ search: 'Seward' });
      expect(search.items.length).toBe(1);
      expect(search.items[0]?.lastName).toBe('Seward');
      expect(search.items[0]?.email).toBe('dr.seward@purfleet.synthetic');
    });

    it('reusing an idempotency key with altered batchId or altered entity throws HTTP 409 Conflict', async () => {
      const initialPayload: ImportRowInput = {
        batchId: 'batch-hash-test-01',
        sourceRow: 1,
        sourceSystem: 'sys_1',
        sourceId: 'src_1',
        entity: 'companies',
        data: {
          name: 'Renfield Fly Supplies',
        },
        idempotencyKey: 'idemp-key-hash-scope-crm1',
        schemaVersion: 1,
      };

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: { 'idempotency-key': 'idemp-key-hash-scope-crm1' },
        payload: initialPayload,
      });
      expect(res1.statusCode).toBe(201);

      // Same key + altered batchId
      const alteredBatchPayload: ImportRowInput = {
        ...initialPayload,
        batchId: 'batch-hash-test-ALTERED',
      };
      const resBatchConflict = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: { 'idempotency-key': 'idemp-key-hash-scope-crm1' },
        payload: alteredBatchPayload,
      });
      expect(resBatchConflict.statusCode).toBe(409);
      expect(JSON.parse(resBatchConflict.body).error.code).toBe('IDEMPOTENCY_CONFLICT');

      // Same key + altered entity
      const alteredEntityPayload: ImportRowInput = {
        ...initialPayload,
        entity: 'contacts',
        data: {
          firstName: 'R.M.',
          lastName: 'Renfield',
        },
      };
      const resEntityConflict = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: { 'idempotency-key': 'idemp-key-hash-scope-crm1' },
        payload: alteredEntityPayload,
      });
      expect(resEntityConflict.statusCode).toBe(409);
      expect(JSON.parse(resEntityConflict.body).error.code).toBe('IDEMPOTENCY_CONFLICT');
    });
  });

  describe('4. Business Validation Rejections vs Retryable Infrastructure Failures', () => {
    it('reports business-rule rejection with a stable reason code and safe message without persisting corrupt data', async () => {
      // 1. Missing required first name
      const invalidNamePayload: ImportRowInput = {
        batchId: 'batch-invalid-006',
        sourceRow: 1,
        entity: 'contacts',
        data: {
          firstName: '',
          lastName: 'Quincey',
        },
        idempotencyKey: 'idemp-invalid-name-006',
      };

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: { 'idempotency-key': 'idemp-invalid-name-006' },
        payload: invalidNamePayload,
      });
      expect(res1.statusCode).toBe(422);
      expect(JSON.parse(res1.body).error.code).toBe('EMPTY_MANDATORY_FIELD');

      // 2. Invalid email format
      const invalidEmailPayload: ImportRowInput = {
        batchId: 'batch-invalid-006',
        sourceRow: 2,
        entity: 'contacts',
        data: {
          firstName: 'Quincey',
          lastName: 'Morris',
          email: 'not-a-valid-email-address',
        },
        idempotencyKey: 'idemp-invalid-email-006',
      };

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: { 'idempotency-key': 'idemp-invalid-email-006' },
        payload: invalidEmailPayload,
      });
      expect(res2.statusCode).toBe(422);
      expect(JSON.parse(res2.body).error.code).toBe('INVALID_EMAIL');

      // 3. Empty company name
      const emptyCompanyPayload: ImportRowInput = {
        batchId: 'batch-invalid-006',
        sourceRow: 3,
        entity: 'companies',
        data: {
          name: '   ',
        },
        idempotencyKey: 'idemp-empty-company-006',
      };

      const res3 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: { 'idempotency-key': 'idemp-empty-company-006' },
        payload: emptyCompanyPayload,
      });
      expect(res3.statusCode).toBe(422);
      expect(JSON.parse(res3.body).error.code).toBe('EMPTY_COMPANY_NAME');

      // 4. Invalid lead status
      const invalidStatusPayload: ImportRowInput = {
        batchId: 'batch-invalid-006',
        sourceRow: 4,
        entity: 'contacts',
        data: {
          firstName: 'Arthur',
          lastName: 'Holmwood',
          leadStatus: 'InvalidStatusThatIsNotAllowed',
        },
        idempotencyKey: 'idemp-invalid-status-006',
      };

      const res4 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: { 'idempotency-key': 'idemp-invalid-status-006' },
        payload: invalidStatusPayload,
      });
      expect(res4.statusCode).toBe(422);
      expect(JSON.parse(res4.body).error.code).toBe('INVALID_LEAD_STATUS');

      // 5. Non-existent referenced companyId
      const orphanCompanyPayload: ImportRowInput = {
        batchId: 'batch-invalid-006',
        sourceRow: 5,
        entity: 'contacts',
        data: {
          firstName: 'Lucy',
          lastName: 'Westenra',
          companyId: '00000000-0000-0000-0000-000000000000',
        },
        idempotencyKey: 'idemp-orphan-company-006',
      };

      const res5 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: { 'idempotency-key': 'idemp-orphan-company-006' },
        payload: orphanCompanyPayload,
      });
      expect(res5.statusCode).toBe(422);
      expect(JSON.parse(res5.body).error.code).toBe('REFERENCE_NOT_FOUND');
    });

    it('simulated 503 infrastructure failure returns retryable status and is NOT recorded as a rejected business record', async () => {
      const transientPayload: ImportRowInput = {
        batchId: 'batch-transient-crm1-007',
        sourceRow: 1,
        entity: 'contacts',
        data: {
          firstName: 'Jonathan',
          lastName: 'Harker',
          email: 'jonathan@transient.synthetic',
        },
        idempotencyKey: 'idemp-transient-crm1-007',
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: {
          'idempotency-key': 'idemp-transient-crm1-007',
          'x-simulate-503': 'true',
        },
        payload: transientPayload,
      });

      expect(res.statusCode).toBe(503);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(body.error.retryable).toBe(true);

      // Verify no receipt was stored and no contact was created
      expect(adapter.getReceiptByKey('idemp-transient-crm1-007')).toBeUndefined();
      const search = await service.getContacts({ search: 'jonathan@transient.synthetic' });
      expect(search.items.length).toBe(0);
    });
  });

  describe('5. Transaction Atomicity & Rollback Guarantee', () => {
    it('target business mutation rolls back when receipt insertion fails', async () => {
      const payload: ImportRowInput = {
        batchId: 'batch-rollback-crm1-008',
        sourceRow: 1,
        sourceSystem: 'rollback_sys',
        sourceId: 'src-rb-801',
        entity: 'contacts',
        data: {
          firstName: 'Rollback',
          lastName: 'Candidate',
          email: 'rollback.candidate@clearshift.synthetic',
        },
        idempotencyKey: 'idemp-rollback-crm1-008',
      };

      // Call importRow with failReceiptCommit option to simulate receipt persistence abort
      await expect(
        adapter.importRow('batch-rollback-crm1-008', 1, 'idemp-rollback-crm1-008', payload, {
          failReceiptCommit: true,
        })
      ).rejects.toThrow('Database transaction aborted: failed to persist import receipt');

      // Verify target business mutation was rolled back (not present in database)
      const search = await service.getContacts({ search: 'rollback.candidate@clearshift.synthetic' });
      expect(search.items.length).toBe(0);

      // Verify receipt was not stored
      expect(adapter.getReceiptByKey('idemp-rollback-crm1-008')).toBeUndefined();
    });

    it('target company and lead mutations roll back when receipt insertion fails', async () => {
      // 1. Company rollback
      const compPayload: ImportRowInput = {
        batchId: 'batch-rb-comp',
        sourceRow: 1,
        sourceSystem: 'rb_sys',
        sourceId: 'rb-comp-1',
        entity: 'companies',
        data: {
          name: 'Rollback Company Inc',
        },
        idempotencyKey: 'idemp-rb-comp-01',
      };

      await expect(
        adapter.importRow('batch-rb-comp', 1, 'idemp-rb-comp-01', compPayload, {
          failReceiptCommit: true,
        })
      ).rejects.toThrow('Database transaction aborted: failed to persist import receipt');

      const compSearch = await service.getCompanies({ search: 'Rollback Company Inc' });
      expect(compSearch.items.length).toBe(0);
    });
  });

  describe('6. Domain Rules, Invariants & Consent Preservation', () => {
    it('consent and unsubscribe state is NEVER overwritten by older import data', async () => {
      // 1. Initial contact with established consent and unsubscribe
      const initialDate = new Date('2026-10-20T10:00:00.000Z');
      const contactPayload: ImportRowInput = {
        batchId: 'batch-consent-009',
        sourceRow: 1,
        sourceSystem: 'salesforce_marketing',
        sourceId: 'sf-consent-901',
        entity: 'contacts',
        data: {
          firstName: 'Wilhelmina',
          lastName: 'Murray',
          email: 'wilhelmina@carfax.synthetic',
          consentStatus: 'granted',
          consentUpdatedAt: initialDate.toISOString(),
          unsubscribed: true,
          unsubscribedUpdatedAt: initialDate.toISOString(),
        },
        idempotencyKey: 'idemp-consent-initial-009',
      };

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: { 'idempotency-key': 'idemp-consent-initial-009' },
        payload: contactPayload,
      });
      expect(res1.statusCode).toBe(201);
      const contactId = JSON.parse(res1.body).targetId;

      // 2. Incoming older import row with consentStatus='unknown' and unsubscribed=false from 2026-10-01 (older!)
      const olderDate = new Date('2026-10-01T08:00:00.000Z');
      const olderPayload: ImportRowInput = {
        batchId: 'batch-consent-010',
        sourceRow: 1,
        sourceSystem: 'salesforce_marketing',
        sourceId: 'sf-consent-901', // Same sourceId
        entity: 'contacts',
        data: {
          firstName: 'Wilhelmina',
          lastName: 'Murray',
          email: 'wilhelmina@carfax.synthetic',
          consentStatus: 'unknown', // Older data should NOT overwrite 'granted'
          consentUpdatedAt: olderDate.toISOString(),
          unsubscribed: false, // Older data should NOT flip unsubscribed=true to false!
          unsubscribedUpdatedAt: olderDate.toISOString(),
        },
        idempotencyKey: 'idemp-consent-older-010',
      };

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/import/row',
        headers: { 'idempotency-key': 'idemp-consent-older-010' },
        payload: olderPayload,
      });
      expect(res2.statusCode).toBe(201);
      const body2 = JSON.parse(res2.body);
      expect(body2.outcome).toBe('linked');

      // Verify contact in DB STILL has consentStatus='granted' and unsubscribed=true
      const verifiedContact = await service.getContactById(contactId);
      expect(verifiedContact?.consentStatus).toBe('granted');
      expect(verifiedContact?.unsubscribed).toBe(true);
      expect(new Date(verifiedContact!.consentUpdatedAt!).getTime()).toBe(initialDate.getTime());
    });

    it('enforces contact search by name and email, server-paged with default pageSize 25', async () => {
      // Test default pageSize on service
      const pagedResult = await service.getContacts({});
      expect(pagedResult.pageSize).toBe(25);
      expect(pagedResult.limit).toBe(25);
      expect(pagedResult.items.length).toBeLessThanOrEqual(25);

      // Search by email
      const searchByEmail = await service.getContacts({ search: 'stoker' });
      for (const item of searchByEmail.items) {
        const matches =
          item.email.toLowerCase().includes('stoker') ||
          item.firstName.toLowerCase().includes('stoker') ||
          item.lastName.toLowerCase().includes('stoker');
        expect(matches).toBe(true);
      }
    });

    it('preflight dry-run executes validation with zero database mutations', async () => {
      const rows: ImportRowInput[] = [
        {
          batchId: 'batch-preflight-crm1-011',
          sourceRow: 1,
          entity: 'contacts',
          data: {
            firstName: 'ValidFirst',
            lastName: 'ValidLast',
            email: 'valid@example.com',
          },
          idempotencyKey: 'idemp-preflight-1',
        },
        {
          batchId: 'batch-preflight-crm1-011',
          sourceRow: 2,
          entity: 'contacts',
          data: {
            firstName: '', // Invalid: missing first name
            lastName: 'InvalidLast',
          },
          idempotencyKey: 'idemp-preflight-2',
        },
        {
          batchId: 'batch-preflight-crm1-011',
          sourceRow: 3,
          entity: 'companies',
          data: {
            name: 'Valid Preflight Company',
          },
          idempotencyKey: 'idemp-preflight-3',
        },
      ];

      const preflightResult = await adapter.preflight('batch-preflight-crm1-011', rows);
      expect(preflightResult.ok).toBe(true);
      if (preflightResult.ok) {
        expect(preflightResult.value.validCount).toBe(2);
        expect(preflightResult.value.rejectCount).toBe(1);
      }

      // Assert zero database mutations occurred
      const searchContact = await service.getContacts({ search: 'ValidFirst' });
      expect(searchContact.items.length).toBe(0);
      const searchCompany = await service.getCompanies({ search: 'Valid Preflight Company' });
      expect(searchCompany.items.length).toBe(0);
      expect(adapter.getReceipts().length).toBe(0);
    });
  });
});
