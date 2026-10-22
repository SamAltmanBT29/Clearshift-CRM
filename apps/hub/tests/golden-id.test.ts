import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import {
  GoldenIdService,
  InMemoryGoldenIdRepository,
  assertNotDisplayGidAsKey,
  formatDisplayGid,
  isUuid,
  isDisplayGid,
} from '../src/golden-id/index.js';
import { goldenIdRoutes } from '../src/routes/golden-id.js';

describe('[PLT-07] Golden ID Map and Idempotent Source Identity Service', () => {
  let app: FastifyInstance;
  let repository: InMemoryGoldenIdRepository;
  let service: GoldenIdService;
  let auditLogs: any[] = [];

  const mockAuditService = {
    logPrivilegedAction: async (entry: any) => {
      auditLogs.push(entry);
      return entry;
    },
    logMergeDecision: async (entry: any) => {
      auditLogs.push({ ...entry, action: 'merge.decided' });
      return entry;
    },
  };

  beforeEach(async () => {
    auditLogs = [];
    repository = new InMemoryGoldenIdRepository();
    service = new GoldenIdService({
      repository,
      auditService: mockAuditService,
    });

    app = fastify();
    await app.register(goldenIdRoutes, { service });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('Acceptance Criterion 1: Idempotency across repeated calls', () => {
    it('returns the same Golden ID across repeated upsert calls for same entity/source-system/source-id', async () => {
      const payload = {
        entityType: 'contact',
        sourceSystem: 'crm_legacy',
        sourceId: 'cust-9001',
      };

      // Call 1: Creates new mapping
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/id-map',
        payload,
      });
      expect(res1.statusCode).toBe(201);
      const json1 = res1.json();
      expect(json1.status).toBe('created');
      expect(isUuid(json1.goldenRecordId)).toBe(true);
      expect(json1.displayGid).toMatch(/^GID-CNT-[A-Z0-9]+$/);

      // Call 2: Returns existing mapping idempotently
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/id-map',
        payload,
      });
      expect(res2.statusCode).toBe(200);
      const json2 = res2.json();
      expect(json2.status).toBe('existing');
      expect(json2.goldenRecordId).toBe(json1.goldenRecordId);
      expect(json2.displayGid).toBe(json1.displayGid);

      // Call 3: Query endpoint also returns identical Golden ID
      const lookupRes = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/id-map?entityType=contact&sourceSystem=crm_legacy&sourceId=cust-9001',
      });
      expect(lookupRes.statusCode).toBe(200);
      const lookupJson = lookupRes.json();
      expect(lookupJson.goldenRecordId).toBe(json1.goldenRecordId);
      expect(lookupJson.displayGid).toBe(json1.displayGid);
    });

    it('stores source identifiers strictly as text strings without lossy numeric coercion', async () => {
      // Leading zero identifier
      const leadingZeroPayload = {
        entityType: 'customer',
        sourceSystem: 'erp_sap',
        sourceId: '000049281',
      };

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/id-map',
        payload: leadingZeroPayload,
      });
      expect(res1.statusCode).toBe(201);
      expect(res1.json().sourceId).toBe('000049281');

      // 64-bit integer string preservation
      const bigintStringPayload = {
        entityType: 'company',
        sourceSystem: 'tax_agency',
        sourceId: '9223372036854775807',
      };

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/id-map',
        payload: bigintStringPayload,
      });
      expect(res2.statusCode).toBe(201);
      expect(res2.json().sourceId).toBe('9223372036854775807');
    });
  });

  describe('Acceptance Criterion 2: Entity namespace collision prevention', () => {
    it('mints distinct Golden IDs for different entity types sharing identical sourceSystem and sourceId', async () => {
      const contactPayload = {
        entityType: 'contact',
        sourceSystem: 'salesforce',
        sourceId: 'ID-100',
      };

      const companyPayload = {
        entityType: 'company',
        sourceSystem: 'salesforce',
        sourceId: 'ID-100',
      };

      const productPayload = {
        entityType: 'product',
        sourceSystem: 'salesforce',
        sourceId: 'ID-100',
      };

      const [resContact, resCompany, resProduct] = await Promise.all([
        app.inject({ method: 'POST', url: '/api/v1/hub/id-map', payload: contactPayload }),
        app.inject({ method: 'POST', url: '/api/v1/hub/id-map', payload: companyPayload }),
        app.inject({ method: 'POST', url: '/api/v1/hub/id-map', payload: productPayload }),
      ]);

      expect(resContact.statusCode).toBe(201);
      expect(resCompany.statusCode).toBe(201);
      expect(resProduct.statusCode).toBe(201);

      const contactId = resContact.json().goldenRecordId;
      const companyId = resCompany.json().goldenRecordId;
      const productId = resProduct.json().goldenRecordId;

      // Invariant: Different entity types must NEVER collide
      expect(contactId).not.toBe(companyId);
      expect(contactId).not.toBe(productId);
      expect(companyId).not.toBe(productId);

      // Verify display prefixes reflect their respective namespaces
      expect(resContact.json().displayGid).toMatch(/^GID-CNT-/);
      expect(resCompany.json().displayGid).toMatch(/^GID-COM-/);
      expect(resProduct.json().displayGid).toMatch(/^GID-PRD-/);
    });

    it('rejects cross-entity type merge attempts', async () => {
      const cRes = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/id-map',
        payload: { entityType: 'contact', sourceSystem: 'sys1', sourceId: '1' },
      });
      const pRes = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/id-map',
        payload: { entityType: 'product', sourceSystem: 'sys2', sourceId: '2' },
      });

      const contactGid = cRes.json().goldenRecordId;
      const productGid = pRes.json().goldenRecordId;

      const mergeRes = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/id-map/merge',
        payload: {
          targetGoldenRecordId: contactGid,
          sourceGoldenRecordId: productGid,
          actor: 'admin_user',
          reason: 'Erroneous cross-type merge test',
        },
      });

      expect(mergeRes.statusCode).toBe(400);
      expect(mergeRes.json().message).toContain('Cannot merge records across different entity types');
    });
  });

  describe('Acceptance Criterion 3: High concurrency upsert creates exactly one map row', () => {
    it('creates exactly one map row when 50 concurrent requests upsert the same key', async () => {
      const payload = {
        entityType: 'customer',
        sourceSystem: 'concurrent_source',
        sourceId: 'concurrent-row-777',
      };

      // Fire 50 concurrent HTTP requests simultaneously
      const concurrencyLevel = 50;
      const requests = Array.from({ length: concurrencyLevel }, () =>
        app.inject({
          method: 'POST',
          url: '/api/v1/hub/id-map',
          payload,
        })
      );

      const responses = await Promise.all(requests);

      // All requests must return HTTP 200 or 201
      responses.forEach((res) => {
        expect([200, 201]).toContain(res.statusCode);
      });

      // All responses must share the exact same goldenRecordId and displayGid
      const firstId = responses[0]!.json().goldenRecordId;
      const firstDisplay = responses[0]!.json().displayGid;

      responses.forEach((res) => {
        expect(res.json().goldenRecordId).toBe(firstId);
        expect(res.json().displayGid).toBe(firstDisplay);
      });

      // Verify that exactly ONE mapping row exists in the repository
      const allMappings = await repository.findSourceMappingsByGoldenId(firstId);
      expect(allMappings.length).toBe(1);
      expect(allMappings[0]!.sourceId).toBe('concurrent-row-777');
      expect(allMappings[0]!.sourceSystem).toBe('concurrent_source');
    });
  });

  describe('Acceptance Criterion 4: Conflicting evidence opens review and does not auto-merge', () => {
    it('flags review_required and does not auto-merge when conflicting tax number evidence is detected', async () => {
      // 1. Initial Company Record with tax number TAX-100 and phone +15551234
      const comp1 = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/id-map',
        payload: {
          entityType: 'company',
          sourceSystem: 'crm_eu',
          sourceId: 'comp-101',
          evidence: {
            name: 'Acme Corp EU',
            taxNumber: 'DE123456789',
            phone: '+4912345678',
          },
        },
      });
      expect(comp1.statusCode).toBe(201);
      const gid1 = comp1.json().goldenRecordId;

      // 2. Second Company with matching Tax Number but conflicting Phone and different sourceId
      const comp2 = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/id-map',
        payload: {
          entityType: 'company',
          sourceSystem: 'crm_us',
          sourceId: 'comp-202',
          evidence: {
            name: 'Acme US Division',
            taxNumber: 'DE-123.456.789', // Matches normalized tax DE123456789
            phone: '+18889990000', // Conflicting phone!
          },
        },
      });

      expect(comp2.statusCode).toBe(201);
      const json2 = comp2.json();
      expect(json2.status).toBe('review_required');
      expect(json2.reviewCandidate).toBeDefined();
      expect(json2.reviewCandidate.conflictType).toBe('phone_conflict');
      expect(json2.reviewCandidate.conflictingGoldenRecordId).toBe(gid1);

      // Invariant: Must NOT auto-merge; second company receives its own distinct Golden Record
      expect(json2.goldenRecordId).not.toBe(gid1);

      // Verify both separate Golden Records remain unmerged in storage
      const detail1 = await repository.findGoldenRecordById(gid1);
      const detail2 = await repository.findGoldenRecordById(json2.goldenRecordId);
      expect(detail1?.status).toBe('active');
      expect(detail2?.status).toBe('active');
    });

    it('flags review_required when ambiguous evidence matches multiple distinct Golden Records', async () => {
      // Create contact 1
      await app.inject({
        method: 'POST',
        url: '/api/v1/hub/id-map',
        payload: {
          entityType: 'contact',
          sourceSystem: 'sys_a',
          sourceId: 'cnt_a',
          evidence: { email: 'shared@clearshift.com' },
        },
      });

      // Create contact 2 with separate email
      await app.inject({
        method: 'POST',
        url: '/api/v1/hub/id-map',
        payload: {
          entityType: 'contact',
          sourceSystem: 'sys_b',
          sourceId: 'cnt_b',
          evidence: { phone: '+15550001111' },
        },
      });

      // Candidate matches both email of contact 1 and phone of contact 2
      const ambiguousRes = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/id-map',
        payload: {
          entityType: 'contact',
          sourceSystem: 'sys_c',
          sourceId: 'cnt_c',
          evidence: {
            email: 'shared@clearshift.com',
            phone: '+1 555 000 1111',
          },
        },
      });

      expect(ambiguousRes.statusCode).toBe(201);
      const ambiguousJson = ambiguousRes.json();
      expect(ambiguousJson.status).toBe('review_required');
      expect(ambiguousJson.reviewCandidate.conflictType).toBe('ambiguous_match');
    });

    it('executes human-governed merge and updates mapping history and audit log', async () => {
      // Create two records
      const r1 = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/id-map',
        payload: { entityType: 'contact', sourceSystem: 'hubspot', sourceId: 'hs_1' },
      });
      const r2 = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/id-map',
        payload: { entityType: 'contact', sourceSystem: 'salesforce', sourceId: 'sf_2' },
      });

      const survivorId = r1.json().goldenRecordId;
      const subsumedId = r2.json().goldenRecordId;

      // Execute human merge via POST /merge
      const mergeRes = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/id-map/merge',
        payload: {
          targetGoldenRecordId: survivorId,
          sourceGoldenRecordId: subsumedId,
          actor: 'integration_reviewer_jane',
          reason: 'Verified duplicate identity during Gate G2 review',
        },
      });

      expect(mergeRes.statusCode).toBe(200);
      const mergeJson = mergeRes.json();

      // Survivor record retains active status and now holds both mappings
      expect(mergeJson.record.id).toBe(survivorId);
      expect(mergeJson.mappings.length).toBe(2);
      expect(mergeJson.mappings.some((m: any) => m.sourceId === 'hs_1')).toBe(true);
      expect(mergeJson.mappings.some((m: any) => m.sourceId === 'sf_2')).toBe(true);

      // Subsumed record is marked merged
      const subsumedRecord = await repository.findGoldenRecordById(subsumedId);
      expect(subsumedRecord?.status).toBe('merged');
      expect(subsumedRecord?.mergedIntoId).toBe(survivorId);

      // Verify audit event was logged
      const mergeAudit = auditLogs.find((l) => l.action === 'merge.decided');
      expect(mergeAudit).toBeDefined();
      expect(mergeAudit.actor).toBe('integration_reviewer_jane');
    });
  });

  describe('Acceptance Criterion 5: No display GID used as primary or foreign key', () => {
    it('throws invariant violation if display GID is used in assertNotDisplayGidAsKey', () => {
      expect(() => {
        assertNotDisplayGidAsKey('GID-CNT-88AB33CD', 'customer_id');
      }).toThrow(/\[PLT-07 Invariant Violation\] Display GID/);

      expect(() => {
        assertNotDisplayGidAsKey('GID-COM-001');
      }).toThrow(/cannot be used as a primary or foreign key/);
    });

    it('rejects lookup endpoint when caller passes a display GID instead of primary UUID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/id-map/GID-CNT-12345678',
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.code).toBe('BAD_REQUEST');
      expect(json.message).toContain('Display GID');
      expect(json.message).toContain('cannot be used as a primary key lookup parameter');
    });

    it('rejects non-UUID parameters in /api/v1/hub/id-map/:goldenRecordId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/id-map/invalid-not-a-uuid',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('BAD_REQUEST');
    });

    it('rejects display GID passed as target or source in merge endpoint', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/id-map/merge',
        payload: {
          targetGoldenRecordId: 'GID-CNT-AAAA1111',
          sourceGoldenRecordId: 'GID-CNT-BBBB2222',
          actor: 'tester',
          reason: 'Test display GID rejection',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('BAD_REQUEST');
    });
  });

  describe('Explicit Not Found Semantics and History Retrieval', () => {
    it('returns HTTP 404 with standard error envelope when source mapping does not exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/id-map?entityType=contact&sourceSystem=unknown_sys&sourceId=missing_id',
      });

      expect(res.statusCode).toBe(404);
      const json = res.json();
      expect(json.code).toBe('NOT_FOUND');
      expect(json.message).toContain('Source identity mapping not found');
      expect(res.headers['x-correlation-id']).toBeDefined();
    });

    it('returns HTTP 404 when querying nonexistent Golden Record UUID', async () => {
      const nonExistentUuid = 'a0000000-0000-0000-0000-000000000000';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/hub/id-map/${nonExistentUuid}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
    });

    it('returns full mapping history for a Golden Record', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/id-map',
        payload: {
          entityType: 'vendor',
          sourceSystem: 'erp_vendor_feed',
          sourceId: 'vnd_881',
        },
      });
      const gid = createRes.json().goldenRecordId;

      const historyRes = await app.inject({
        method: 'GET',
        url: `/api/v1/hub/id-map/${gid}/history`,
      });

      expect(historyRes.statusCode).toBe(200);
      const json = historyRes.json();
      expect(json.goldenRecordId).toBe(gid);
      expect(json.history.length).toBeGreaterThanOrEqual(1);
      expect(json.history[0].action).toBe('mapped');
      expect(json.history[0].sourceSystem).toBe('erp_vendor_feed');
    });
  });
});
