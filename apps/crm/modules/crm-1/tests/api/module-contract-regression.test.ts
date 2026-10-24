import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { Roles, signAccessToken } from '@cs/identity';
import {
  ContactSchema,
  PaginatedContactsResponseSchema,
  CompanySchema,
  PaginatedCompaniesResponseSchema,
  LeadSchema,
  PaginatedLeadsResponseSchema,
  Crm1BatchExecutionReportSchema,
  type Crm1DetectDuplicatesInput,
  type Crm1ResolveDuplicateInput,
  type Crm1ExecuteBatchLoadInput,
} from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import { Crm1Service } from '../../src/services/crm1.service.js';
import { Crm1AuditService } from '../../src/services/audit.js';
import { Crm1ReferenceResolver } from '../../src/public.js';

const BASE_PATH = '/api/v1/crm-contacts';

describe('CRM-1 Module Contract and Regression Suite (Issue #122 / [CRM1-29])', () => {
  let app: ReturnType<typeof buildApp>;
  let service: Crm1Service;
  let auditService: Crm1AuditService;
  let adminToken: string;
  let editorToken: string;
  let analystToken: string;
  let runnerToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    adminToken = await signAccessToken('contract-reg-admin', [Roles.ADMIN]);
    editorToken = await signAccessToken('contract-reg-editor', [Roles.EDITOR]);
    analystToken = await signAccessToken('contract-reg-analyst', [Roles.ANALYST]);
    runnerToken = await signAccessToken('contract-reg-runner', [Roles.MIGRATION_RUNNER]);
    viewerToken = await signAccessToken('contract-reg-viewer', [Roles.VIEWER]);
  });

  beforeEach(async () => {
    service = new Crm1Service({ inMemory: true });
    await service.seedSyntheticData();
    auditService = new Crm1AuditService();
    app = buildApp({ service, auditService });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const editorHeaders = () => ({ authorization: `Bearer ${editorToken}` });
  const viewerHeaders = () => ({ authorization: `Bearer ${viewerToken}` });
  const adminHeaders = () => ({ authorization: `Bearer ${adminToken}` });
  const analystHeaders = () => ({ authorization: `Bearer ${analystToken}` });
  const runnerHeaders = () => ({ authorization: `Bearer ${runnerToken}` });

  // ---------------------------------------------------------------------------
  // 1. Contacts Domain Lifecycle & Schema Conformance
  // ---------------------------------------------------------------------------
  describe('1. Contacts Domain Lifecycle & Schema Conformance', () => {
    it('creates, reads, updates, searches, and verifies read-only Golden ID for contacts', async () => {
      // 1. Create contact
      const createRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/contacts`,
        headers: editorHeaders(),
        payload: {
          firstName: 'Elena',
          lastName: 'Rostova',
          email: 'elena.rostova@clearshift.synthetic',
          phone: '+1-555-0999',
          address: '500 Innovation Park, Suite 400',
          companyId: '11111111-1111-4111-8111-111111111111',
          leadStatus: 'New',
        },
      });

      expect(createRes.statusCode).toBe(201);
      const created = createRes.json();
      expect(ContactSchema.safeParse(created).success).toBe(true);
      expect(created.firstName).toBe('Elena');
      expect(created.lastName).toBe('Rostova');
      expect(created.email).toBe('elena.rostova@clearshift.synthetic');
      expect(created.companyId).toBe('11111111-1111-4111-8111-111111111111');
      expect(created.goldenId).toBeDefined();
      expect(created.goldenId.length).toBeGreaterThan(0);
      const contactId = created.id;
      const initialGoldenId = created.goldenId;

      // 2. Read contact by ID
      const readRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/contacts/${contactId}`,
        headers: viewerHeaders(),
      });
      expect(readRes.statusCode).toBe(200);
      const readBody = readRes.json();
      expect(ContactSchema.safeParse(readBody).success).toBe(true);
      expect(readBody.id).toBe(contactId);
      expect(readBody.goldenId).toBe(initialGoldenId);

      // 3. Prevent tampering with immutable goldenId (403 Forbidden)
      const tamperRes = await app.inject({
        method: 'PATCH',
        url: `${BASE_PATH}/contacts/${contactId}`,
        headers: editorHeaders(),
        payload: {
          goldenId: 'tampered-golden-id',
        },
      });
      expect(tamperRes.statusCode).toBe(403);

      // 4. Valid patch without immutable fields
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `${BASE_PATH}/contacts/${contactId}`,
        headers: editorHeaders(),
        payload: {
          phone: '+1-555-9990',
        },
      });
      expect(patchRes.statusCode).toBe(200);
      const patched = patchRes.json();
      expect(patched.phone).toBe('+1-555-9990');
      expect(patched.goldenId).toBe(initialGoldenId);

      // 5. Search and paginate contacts
      const searchRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/contacts?search=Rostova&page=1&pageSize=10`,
        headers: viewerHeaders(),
      });
      expect(searchRes.statusCode).toBe(200);
      const searchBody = searchRes.json();
      expect(PaginatedContactsResponseSchema.safeParse(searchBody).success).toBe(true);
      expect(searchBody.items.some((c: any) => c.id === contactId)).toBe(true);

      // 6. Filter contacts by lead status
      const filterRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/contacts?leadStatus=New&page=1&pageSize=50`,
        headers: viewerHeaders(),
      });
      expect(filterRes.statusCode).toBe(200);
      const filterBody = filterRes.json();
      expect(PaginatedContactsResponseSchema.safeParse(filterBody).success).toBe(true);
      expect(filterBody.items.every((c: any) => c.leadStatus === 'New')).toBe(true);
    });

    it('rejects contact creation with 400 Bad Request when required fields are missing or invalid', async () => {
      const invalidEmailRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/contacts`,
        headers: editorHeaders(),
        payload: {
          firstName: 'Bad',
          lastName: 'Email',
          email: 'not-an-email',
        },
      });
      expect(invalidEmailRes.statusCode).toBe(400);

      const missingNameRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/contacts`,
        headers: editorHeaders(),
        payload: {
          email: 'valid@clearshift.synthetic',
        },
      });
      expect(missingNameRes.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Companies Domain Lifecycle & Invariants
  // ---------------------------------------------------------------------------
  describe('2. Companies Domain Lifecycle & Invariants', () => {
    it('creates, reads, updates, and searches flat companies with normalized tax numbers', async () => {
      // 1. Create company
      const createRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/companies`,
        headers: editorHeaders(),
        payload: {
          name: 'Cyberdyne Systems Corp',
          taxNumber: 'US-CYBER-999',
          email: 'contact@cyberdyne.synthetic',
          phone: '+1-555-0800',
          address: '18144 El Camino Real, Sunnyvale',
        },
      });

      expect(createRes.statusCode).toBe(201);
      const created = createRes.json();
      expect(CompanySchema.safeParse(created).success).toBe(true);
      expect(created.name).toBe('Cyberdyne Systems Corp');
      expect(created.taxNumber).toBe('US-CYBER-999');
      const companyId = created.id;

      // 2. Read company by ID
      const readRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/companies/${companyId}`,
        headers: viewerHeaders(),
      });
      expect(readRes.statusCode).toBe(200);
      const readBody = readRes.json();
      expect(CompanySchema.safeParse(readBody).success).toBe(true);
      expect(readBody.id).toBe(companyId);

      // 3. Patch company
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `${BASE_PATH}/companies/${companyId}`,
        headers: editorHeaders(),
        payload: {
          phone: '+1-555-0888',
        },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().phone).toBe('+1-555-0888');

      // 4. Search companies by taxNumber
      const taxSearchRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/companies?taxNumber=US-CYBER-999`,
        headers: viewerHeaders(),
      });
      expect(taxSearchRes.statusCode).toBe(200);
      const taxSearchBody = taxSearchRes.json();
      expect(PaginatedCompaniesResponseSchema.safeParse(taxSearchBody).success).toBe(true);
      expect(taxSearchBody.items.length).toBe(1);
      expect(taxSearchBody.items[0].id).toBe(companyId);
    });

    it('rejects company creation with 400 Bad Request when required name or tax number is missing', async () => {
      const missingTaxRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/companies`,
        headers: editorHeaders(),
        payload: {
          name: 'Company Without Tax Number',
        },
      });
      expect(missingTaxRes.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Leads Domain Lifecycle & Status Allowlist Transitions
  // ---------------------------------------------------------------------------
  describe('3. Leads Domain Lifecycle & Status Allowlist Transitions', () => {
    it('creates lead and validates forward-only status progression (New -> Working -> Qualified -> Closed)', async () => {
      // 1. Create lead with 'New' status
      const createRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/leads`,
        headers: editorHeaders(),
        payload: {
          name: 'Synthetic Lead Alpha',
          email: 'lead.alpha@clearshift.synthetic',
          status: 'New',
          contactId: '00000000-0000-4000-8000-010000000000',
        },
      });

      expect(createRes.statusCode).toBe(201);
      const lead = createRes.json();
      expect(LeadSchema.safeParse(lead).success).toBe(true);
      expect(lead.status).toBe('New');
      const leadId = lead.id;

      // 2. Transition New -> Working
      const workingRes = await app.inject({
        method: 'PATCH',
        url: `${BASE_PATH}/leads/${leadId}`,
        headers: editorHeaders(),
        payload: { status: 'Working' },
      });
      expect(workingRes.statusCode).toBe(200);
      expect(workingRes.json().status).toBe('Working');

      // 3. Transition Working -> Qualified
      const qualifiedRes = await app.inject({
        method: 'PATCH',
        url: `${BASE_PATH}/leads/${leadId}`,
        headers: editorHeaders(),
        payload: { status: 'Qualified' },
      });
      expect(qualifiedRes.statusCode).toBe(200);
      expect(qualifiedRes.json().status).toBe('Qualified');

      // 4. Transition Qualified -> Closed
      const closedRes = await app.inject({
        method: 'PATCH',
        url: `${BASE_PATH}/leads/${leadId}`,
        headers: editorHeaders(),
        payload: { status: 'Closed' },
      });
      expect(closedRes.statusCode).toBe(200);
      expect(closedRes.json().status).toBe('Closed');
    });

    it('rejects invalid backward lead status transition with 422 INVALID_LEAD_STATUS_TRANSITION', async () => {
      // Seed lead #1 is 'Working'
      const leadId = '90000000-0000-4000-8000-000000000001';

      // Attempt backward transition: Working -> New
      const backwardRes = await app.inject({
        method: 'PATCH',
        url: `${BASE_PATH}/leads/${leadId}`,
        headers: editorHeaders(),
        payload: { status: 'New' },
      });

      expect(backwardRes.statusCode).toBe(422);
      const errorBody = backwardRes.json();
      expect(errorBody.code).toBe('INVALID_LEAD_STATUS_TRANSITION');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Exact Duplicate Key Detection & Human Review (No Fuzzy Auto-Merge)
  // ---------------------------------------------------------------------------
  describe('4. Deterministic Duplicate Key Detection & Human Review (BR-CRM1-06)', () => {
    it('detects duplicate email candidates, holds for review, and forbids fuzzy auto-merge', async () => {
      // 1. Detect duplicates with case-insensitive whitespace variation
      const detectPayload: Crm1DetectDuplicatesInput = {
        batchId: 'batch-dup-reg-01',
        entity: 'contact',
        keyType: 'email',
        records: [
          { id: 'rec-1', keyValue: 'sarah.connor@clearshift.synthetic' },
          { id: 'rec-2', keyValue: '  SARAH.CONNOR@CLEARSHIFT.SYNTHETIC  ' },
          { id: 'rec-3', keyValue: 'unique.person@clearshift.synthetic' },
        ],
      };

      const detectRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/duplicates/detect`,
        headers: analystHeaders(),
        payload: detectPayload,
      });

      expect(detectRes.statusCode).toBe(200);
      const detectBody = detectRes.json();
      expect(detectBody.uniqueRecords.length).toBe(1);
      expect(detectBody.duplicateCandidates.length).toBe(1);

      const candidate = detectBody.duplicateCandidates[0];
      expect(candidate.normalizedKey).toBe('sarah.connor@clearshift.synthetic');
      expect(candidate.status).toBe('held_for_review');
      const candidateId = candidate.id;

      // 2. Reject autoMerge attempt with 422 AUTO_MERGE_FORBIDDEN
      const autoMergePayload: Crm1DetectDuplicatesInput = {
        ...detectPayload,
        autoMerge: true,
      };

      const autoMergeRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/duplicates/detect`,
        headers: analystHeaders(),
        payload: autoMergePayload,
      });

      expect(autoMergeRes.statusCode).toBe(422);
      expect(autoMergeRes.json().code).toBe('AUTO_MERGE_FORBIDDEN');

      // 3. Inspect held duplicates
      const heldRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/duplicates/held?batchId=batch-dup-reg-01`,
        headers: viewerHeaders(),
      });
      expect(heldRes.statusCode).toBe(200);
      expect(heldRes.json().items.some((c: any) => c.id === candidateId)).toBe(true);

      // 4. Human review resolution: action 'MERGE'
      const resolvePayload: Crm1ResolveDuplicateInput = {
        candidateId,
        decision: 'MERGE',
        keptId: 'rec-1',
        mergedId: 'rec-2',
        reason: 'Verified duplicate contact via manual analyst review',
        actorId: 'analyst-user-42',
      };

      const resolveRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/duplicates/resolve`,
        headers: editorHeaders(),
        payload: resolvePayload,
      });

      expect(resolveRes.statusCode).toBe(200);
      expect(resolveRes.json().decision).toBe('MERGE');

      // 5. Verify audit log entry
      const auditRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/duplicates/audit?candidateId=${candidateId}`,
        headers: viewerHeaders(),
      });
      expect(auditRes.statusCode).toBe(200);
      const auditBody = auditRes.json();
      expect(auditBody.items.length).toBeGreaterThanOrEqual(1);
      expect(auditBody.items[0].decision).toBe('MERGE');
    });

    it('detects duplicate compound keys (phone + contact name)', async () => {
      const detectPayload: Crm1DetectDuplicatesInput = {
        batchId: 'batch-dup-reg-02',
        entity: 'contact',
        keyType: 'phone_name',
        records: [
          { id: 'p1', keyValue: '+1-555-0101#Alice Anderson' },
          { id: 'p2', keyValue: '  +1-555-0101#alice   anderson  ' },
        ],
      };

      const detectRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/duplicates/detect`,
        headers: analystHeaders(),
        payload: detectPayload,
      });

      expect(detectRes.statusCode).toBe(200);
      expect(detectRes.json().duplicateCandidates.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Chunked Batch Loading & Idempotent Retry
  // ---------------------------------------------------------------------------
  describe('5. Chunked Batch Loading & Idempotent Retry (BR-CRM1-03 / BR-CRM1-07)', () => {
    it('executes batch load within threshold, verifies report schema, and processes retries idempotently', async () => {
      const batchId = 'batch-reg-load-01';
      const records = Array.from({ length: 20 }, (_, i) => ({
        sourceRow: i + 1,
        idempotencyKey: `${batchId}-row-${i + 1}`,
        data: {
          firstName: `BatchFirst${i + 1}`,
          lastName: `BatchLast${i + 1}`,
          email: `batch${i + 1}@clearshift.synthetic`,
          phone: `+1-555-${(2000 + i).toString()}`,
          leadStatus: 'New',
        },
      }));

      const loadPayload: Crm1ExecuteBatchLoadInput = {
        batchId,
        module: 'crm-1',
        step: 'load',
        chunkSize: 10,
        records,
      };

      // 1. Initial execution
      const loadRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/batches/execute-load`,
        headers: runnerHeaders(),
        payload: loadPayload,
      });

      expect(loadRes.statusCode).toBe(200);
      const report = loadRes.json();
      expect(Crm1BatchExecutionReportSchema.safeParse(report).success).toBe(true);
      expect(report.status).toBe('COMPLETED');
      expect(report.committedRecords).toBe(20);
      expect(report.failedRecords).toBe(0);
      expect(report.chunksProcessed).toBe(2);

      // 2. Fetch execution report via GET endpoint
      const reportRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/batches/${batchId}/report`,
        headers: viewerHeaders(),
      });
      expect(reportRes.statusCode).toBe(200);
      expect(Crm1BatchExecutionReportSchema.safeParse(reportRes.json()).success).toBe(true);

      // 3. Idempotent Retry: re-run identical batch load
      const retryRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/batches/execute-load`,
        headers: runnerHeaders(),
        payload: loadPayload,
      });

      expect(retryRes.statusCode).toBe(200);
      const retryReport = retryRes.json();
      expect(retryReport.status).toBe('COMPLETED');
      expect(retryReport.committedRecords).toBe(20);
      // Receipts match original run without duplicating entities
      expect(retryReport.committedReceipts.length).toBe(20);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Data Cleaning & Field Sanitization Services
  // ---------------------------------------------------------------------------
  describe('6. Data Cleaning & Field Sanitization Services', () => {
    it('cleans dirty rows, normalizes phone numbers, trims strings, and generates audit metrics', async () => {
      const cleanRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/cleaning/clean`,
        headers: runnerHeaders(),
        payload: {
          batchId: 'clean-reg-batch',
          rows: [
            {
              firstName: '  Marcus  ',
              lastName: 'Aurelius',
              email: 'MARCUS.AURELIUS@CLEARSHIFT.SYNTHETIC',
              phone: '(555) 012-3456',
              taxNumber: '  US-123-4567  ',
            },
          ],
        },
      });

      expect(cleanRes.statusCode).toBe(200);
      const cleanBody = cleanRes.json();
      expect(cleanBody.rows.length).toBe(1);
      const cleaned = cleanBody.rows[0];
      expect(cleaned.firstName).toBe('Marcus');
      expect(cleaned.email).toBe('marcus.aurelius@clearshift.synthetic');
      expect(cleanBody.summary).toBeDefined();
      expect(cleanBody.summary.totalRows).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Mapping Configuration & Template Registry
  // ---------------------------------------------------------------------------
  describe('7. Mapping Configuration & Template Registry', () => {
    it('retrieves mapping templates, validates schema, and executes dry run row transformation', async () => {
      // 1. List templates
      const listRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/mappings/templates`,
        headers: viewerHeaders(),
      });
      expect(listRes.statusCode).toBe(200);
      const templates = listRes.json().templates;
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThanOrEqual(1);

      // 2. Validate template mapping against source columns
      const validateRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/mappings/validate`,
        headers: runnerHeaders(),
        payload: {
          templateId: 'crm1-contacts-canonical',
          sourceColumns: ['first_name', 'last_name', 'email', 'phone'],
        },
      });
      expect(validateRes.statusCode).toBe(200);
      expect(validateRes.json().ready).toBe(true);

      // 3. Map sample rows
      const mapRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/mappings/map`,
        headers: runnerHeaders(),
        payload: {
          templateId: 'crm1-contacts-canonical',
          rows: [
            {
              first_name: 'Arthur',
              last_name: 'Dent',
              email: 'arthur.dent@clearshift.synthetic',
              phone: '+1-555-0424',
            },
          ],
        },
      });
      expect(mapRes.statusCode).toBe(200);
      const mapBody = mapRes.json();
      expect(mapBody.rows.length).toBe(1);
      expect(mapBody.rows[0].firstName).toBe('Arthur');
      expect(mapBody.rows[0].lastName).toBe('Dent');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Role-Based Access Control (RBAC) Matrix
  // ---------------------------------------------------------------------------
  describe('8. Role-Based Access Control (RBAC) Enforcement', () => {
    it('enforces authentication and SDS role permissions across endpoints', async () => {
      // Unauthenticated request -> 401
      const unauthRes = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/contacts`,
      });
      expect(unauthRes.statusCode).toBe(401);

      // Viewer attempting contact creation -> 403
      const viewerCreateRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/contacts`,
        headers: viewerHeaders(),
        payload: {
          firstName: 'Unauthorized',
          lastName: 'User',
          email: 'unauth@clearshift.synthetic',
        },
      });
      expect(viewerCreateRes.statusCode).toBe(403);

      // Viewer attempting batch load -> 403
      const viewerLoadRes = await app.inject({
        method: 'POST',
        url: `${BASE_PATH}/batches/execute-load`,
        headers: viewerHeaders(),
        payload: {
          batchId: 'batch-forbidden',
          records: [{ sourceRow: 1, idempotencyKey: 'k1', data: {} }],
        },
      });
      expect(viewerLoadRes.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Repeated-Read Stability & Standard Error Envelopes
  // ---------------------------------------------------------------------------
  describe('9. Repeated-Read Stability & Standard Error Envelopes', () => {
    it('produces bitwise identical responses on consecutive GET reads (read idempotency)', async () => {
      const read1 = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/contacts?page=1&pageSize=10`,
        headers: viewerHeaders(),
      });
      const read2 = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/contacts?page=1&pageSize=10`,
        headers: viewerHeaders(),
      });

      expect(read1.statusCode).toBe(200);
      expect(read2.statusCode).toBe(200);
      expect(read1.body).toBe(read2.body);
    });

    it('returns standardized error envelope for 404 not found', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const res = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/contacts/${nonExistentId}`,
        headers: viewerHeaders(),
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Public Reference Resolver (Crm1ReferenceResolver)
  // ---------------------------------------------------------------------------
  describe('10. Public Cross-Module Reference Resolver (Crm1ReferenceResolver)', () => {
    it('resolves contact and company references synchronously via in-memory service', async () => {
      const resolver = new Crm1ReferenceResolver(undefined, service);
      const validContactId = '00000000-0000-4000-8000-010000000000';
      const validCompanyId = '11111111-1111-4111-8111-111111111111';
      const invalidId = '00000000-0000-0000-0000-000000000000';

      // Check existence
      expect(await resolver.exists('contact', validContactId)).toBe(true);
      expect(await resolver.exists('contact', invalidId)).toBe(false);
      expect(await resolver.exists('company', validCompanyId)).toBe(true);
      expect(await resolver.exists('company', invalidId)).toBe(false);

      // Fetch summary
      const contactSummary = await resolver.get('contact', validContactId);
      expect(contactSummary).not.toBeNull();
      expect(contactSummary?.id).toBe(validContactId);
      expect(contactSummary?.goldenId).toBe('gid-cnt-01');

      const companySummary = await resolver.get('company', validCompanyId);
      expect(companySummary).not.toBeNull();
      expect(companySummary?.id).toBe(validCompanyId);
      expect(companySummary?.name).toBe('Acme Corporation');
    });
  });
});
