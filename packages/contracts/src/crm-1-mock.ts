import type {
  FastifyPluginAsync,
  FastifyRequest,
  FastifyReply,
  FastifyInstance,
} from 'fastify';
import {
  type CRM1Contact,
  type CRM1Company,
  type CRM1Lead,
  type CRM1ImportBatch,
  type CRM1ImportReject,
  CRM1ContactCreateSchema,
  CRM1ContactPatchSchema,
  CRM1CompanyCreateSchema,
  CRM1CompanyPatchSchema,
  CRM1LeadCreateSchema,
  CRM1LeadPatchSchema,
  CRM1ImportCreateSchema,
  CRM1ListQuerySchema,
  CRM1_API_PREFIX,
  type CRM1LeadStatus,
} from './crm-1.js';
import {
  createErrorEnvelope,
  StandardErrorCodes,
} from './common.js';
import {
  evaluateContactDuplicate,
  evaluateCompanyDuplicate,
  assertValidLeadTransition,
  canTransitionLeadStatus,
  type ContactCandidate,
  type CompanyCandidate,
} from './crm-1-duplicates.js';

// ---------------------------------------------------------------------------
// 1. Deterministic Synthetic Fixture Generators
// ---------------------------------------------------------------------------

export function createDeterministicMockContacts(): CRM1Contact[] {
  return [
    {
      id: '00000000-0000-4000-8000-000000000001',
      firstName: 'Alex',
      lastName: 'Morgan',
      email: 'alex.morgan@clearshift.synthetic',
      phone: '+1-555-0101',
      address: '100 Silicon Way, San Jose, CA',
      companyId: '00000000-0000-4000-9000-000000000001',
      leadStatus: 'Working',
      goldenId: 'GID-SYNTH-CONTACT-001',
      sourceSystem: 'hubspot_migration',
      sourceId: 'src_hs_1001',
      consentStatus: 'granted',
      consentUpdatedAt: '2026-01-15T08:00:00.000Z',
      unsubscribed: false,
      unsubscribedUpdatedAt: null,
      createdAt: '2026-01-15T08:00:00.000Z',
      updatedAt: '2026-01-15T08:00:00.000Z',
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      firstName: 'Jordan',
      lastName: 'Taylor',
      email: 'jordan.taylor@clearshift.synthetic',
      phone: '+1-555-0102',
      address: '200 Market Street, San Francisco, CA',
      companyId: '00000000-0000-4000-9000-000000000002',
      leadStatus: 'Qualified',
      goldenId: 'GID-SYNTH-CONTACT-002',
      sourceSystem: 'salesforce_migration',
      sourceId: 'src_sf_2002',
      consentStatus: 'unknown',
      consentUpdatedAt: null,
      unsubscribed: false,
      unsubscribedUpdatedAt: null,
      createdAt: '2026-01-16T09:30:00.000Z',
      updatedAt: '2026-01-16T09:30:00.000Z',
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      firstName: 'Sam',
      lastName: 'Rivera',
      email: 'sam.rivera@clearshift.synthetic',
      phone: '+1-555-0103',
      address: '300 Broadway, New York, NY',
      companyId: null,
      leadStatus: 'New',
      goldenId: 'GID-SYNTH-CONTACT-003',
      sourceSystem: 'csv_seed',
      sourceId: 'src_csv_3003',
      consentStatus: 'withdrawn',
      consentUpdatedAt: '2026-01-17T11:00:00.000Z',
      unsubscribed: true,
      unsubscribedUpdatedAt: '2026-01-17T11:00:00.000Z',
      createdAt: '2026-01-17T11:00:00.000Z',
      updatedAt: '2026-01-17T11:00:00.000Z',
    },
  ];
}

export function createDeterministicMockCompanies(): CRM1Company[] {
  return [
    {
      id: '00000000-0000-4000-9000-000000000001',
      name: 'Acme Dynamics Synthetic Corp',
      taxNumber: 'US-TAX-100000001',
      email: 'billing@acme.synthetic',
      phone: '+1-555-0901',
      address: '100 Corporate Blvd, Austin, TX',
      sourceSystem: 'hubspot_migration',
      sourceId: 'src_comp_1001',
      createdAt: '2026-01-10T00:00:00.000Z',
      updatedAt: '2026-01-10T00:00:00.000Z',
    },
    {
      id: '00000000-0000-4000-9000-000000000002',
      name: 'Global Tech Synthetic LLC',
      taxNumber: 'US-TAX-100000002',
      email: 'finance@globaltech.synthetic',
      phone: '+1-555-0902',
      address: '200 Innovation Way, Boston, MA',
      sourceSystem: 'salesforce_migration',
      sourceId: 'src_comp_2002',
      createdAt: '2026-01-11T00:00:00.000Z',
      updatedAt: '2026-01-11T00:00:00.000Z',
    },
  ];
}

export function createDeterministicMockLeads(): CRM1Lead[] {
  return [
    {
      id: '00000000-0000-4000-7000-000000000001',
      contactId: '00000000-0000-4000-8000-000000000001',
      status: 'Working',
      sourceSystem: 'hubspot_migration',
      sourceId: 'src_lead_1001',
      createdAt: '2026-01-15T08:05:00.000Z',
      updatedAt: '2026-01-15T08:05:00.000Z',
    },
    {
      id: '00000000-0000-4000-7000-000000000002',
      contactId: '00000000-0000-4000-8000-000000000002',
      status: 'Qualified',
      sourceSystem: 'salesforce_migration',
      sourceId: 'src_lead_2002',
      createdAt: '2026-01-16T09:35:00.000Z',
      updatedAt: '2026-01-16T09:35:00.000Z',
    },
  ];
}

export function createDeterministicMockBatches(): {
  batch: CRM1ImportBatch;
  receipts: Array<{ sourceRow: number; entity: 'contact' | 'company' | 'lead'; targetId: string; createdAt: string }>;
  rejects: CRM1ImportReject[];
} {
  const batchId = '00000000-0000-4000-6000-000000000001';
  return {
    batch: {
      id: batchId,
      sourceSystem: 'seed_batch_fixture',
      status: 'completed',
      loadedCount: 2,
      rejectedCount: 1,
      createdAt: '2026-01-20T00:00:00.000Z',
      updatedAt: '2026-01-20T00:05:00.000Z',
      completedAt: '2026-01-20T00:05:00.000Z',
    },
    receipts: [
      {
        sourceRow: 1,
        entity: 'company',
        targetId: '00000000-0000-4000-9000-000000000001',
        createdAt: '2026-01-20T00:01:00.000Z',
      },
      {
        sourceRow: 2,
        entity: 'contact',
        targetId: '00000000-0000-4000-8000-000000000001',
        createdAt: '2026-01-20T00:02:00.000Z',
      },
    ],
    rejects: [
      {
        id: '00000000-0000-4000-5000-000000000001',
        batchId,
        sourceRow: 3,
        entity: 'contact',
        reasonCode: 'INVALID_EMAIL_FORMAT',
        message: 'Invalid email address provided in row 3',
        createdAt: '2026-01-20T00:03:00.000Z',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 2. Deterministic In-Memory State Store
// ---------------------------------------------------------------------------

export class Crm1MockStateStore {
  contacts: CRM1Contact[] = createDeterministicMockContacts();
  companies: CRM1Company[] = createDeterministicMockCompanies();
  leads: CRM1Lead[] = createDeterministicMockLeads();
  batches = new Map<string, { batch: CRM1ImportBatch; receipts: any[]; rejects: CRM1ImportReject[] }>();

  constructor() {
    this.reset();
  }

  reset(): void {
    this.contacts = createDeterministicMockContacts();
    this.companies = createDeterministicMockCompanies();
    this.leads = createDeterministicMockLeads();
    this.batches.clear();
    const mockBatch = createDeterministicMockBatches();
    this.batches.set(mockBatch.batch.id, mockBatch);
  }
}

// ---------------------------------------------------------------------------
// 3. Fastify Deterministic Mock Server Plugin
// ---------------------------------------------------------------------------

export interface Crm1MockServerOptions {
  prefix?: string;
  store?: Crm1MockStateStore;
}

export const crm1MockServerPlugin: FastifyPluginAsync<Crm1MockServerOptions> = async (
  fastify,
  options
) => {
  const store = options.store ?? new Crm1MockStateStore();

  const registerRoutes = async (app: FastifyInstance) => {
    // Health check
    app.get('/health', async () => ({
      status: 'healthy',
      module: 'crm-1',
      mockServer: true,
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      entities: {
        contacts: store.contacts.length,
        companies: store.companies.length,
        leads: store.leads.length,
        batches: store.batches.size,
      },
    }));

    // -------------------------------------------------------------------------
    // Contacts
    // -------------------------------------------------------------------------

    app.get('/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
      const queryResult = CRM1ListQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid contact list query parameters',
            details: queryResult.error.issues,
          })
        );
      }

      const { page, pageSize, search } = queryResult.data;
      let filtered = [...store.contacts];
      if (search) {
        const s = search.toLowerCase();
        filtered = filtered.filter(
          (c) =>
            c.firstName.toLowerCase().includes(s) ||
            c.lastName.toLowerCase().includes(s) ||
            (c.email && c.email.toLowerCase().includes(s))
        );
      }

      const total = filtered.length;
      const startIndex = (page - 1) * pageSize;
      const items = filtered.slice(startIndex, startIndex + pageSize);

      return reply.status(200).send({
        items,
        page,
        pageSize,
        total,
      });
    });

    app.get('/contacts/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { id } = request.params;
      const found = store.contacts.find((c) => c.id === id);
      if (!found) {
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message: `Contact with id '${id}' not found`,
          })
        );
      }
      return reply.status(200).send(found);
    });

    app.post('/contacts', async (request: FastifyRequest, reply) => {
      const parsed = CRM1ContactCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Validation failed for contact creation',
            details: parsed.error.issues,
          })
        );
      }

      const body = parsed.data;

      // Referential check for companyId
      if (body.companyId && !store.companies.some((c) => c.id === body.companyId)) {
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message: `Referenced companyId '${body.companyId}' not found`,
          })
        );
      }

      // Exact duplicate check
      const candidate: ContactCandidate = {
        firstName: body.firstName,
        lastName: body.lastName,
      };
      if (body.email !== undefined) candidate.email = body.email;
      if (body.phone !== undefined) candidate.phone = body.phone;

      const dupResult = evaluateContactDuplicate(candidate, store.contacts);
      if (dupResult.outcome === 'EXACT_MATCH') {
        return reply.status(409).send(
          createErrorEnvelope({
            code: StandardErrorCodes.CONFLICT,
            message: `Duplicate contact detected: ${dupResult.reason}`,
            details: dupResult.candidateMatches,
          })
        );
      }
      if (dupResult.outcome === 'AMBIGUOUS_REVIEW_REQUIRED') {
        return reply.status(409).send(
          createErrorEnvelope({
            code: StandardErrorCodes.CONFLICT,
            message: `Ambiguous duplicate match requires human review: ${dupResult.reason}`,
            details: dupResult.candidateMatches,
          })
        );
      }

      const newContact: CRM1Contact = {
        id: `00000000-0000-4000-8000-${String(store.contacts.length + 1).padStart(12, '0')}`,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email ?? null,
        phone: body.phone ?? null,
        address: body.address ?? null,
        companyId: body.companyId ?? null,
        leadStatus: body.leadStatus ?? 'New',
        goldenId: body.goldenId ?? `GID-SYNTH-${Date.now()}`,
        sourceSystem: body.sourceSystem ?? 'api_mock',
        sourceId: body.sourceId ?? `src_${Date.now()}`,
        consentStatus: 'unknown',
        consentUpdatedAt: null,
        unsubscribed: false,
        unsubscribedUpdatedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      store.contacts.push(newContact);
      return reply.status(201).send(newContact);
    });

    app.patch('/contacts/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { id } = request.params;
      const contactIndex = store.contacts.findIndex((c) => c.id === id);
      if (contactIndex === -1) {
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message: `Contact with id '${id}' not found`,
          })
        );
      }

      const parsed = CRM1ContactPatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Validation failed for contact patch',
            details: parsed.error.issues,
          })
        );
      }

      const patch = parsed.data;
      const existing = store.contacts[contactIndex]!;

      if (patch.companyId && !store.companies.some((c) => c.id === patch.companyId)) {
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message: `Referenced companyId '${patch.companyId}' not found`,
          })
        );
      }

      const updated: CRM1Contact = {
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
        sourceSystem: patch.sourceSystem !== undefined ? patch.sourceSystem : existing.sourceSystem,
        sourceId: patch.sourceId !== undefined ? patch.sourceId : existing.sourceId,
        email: patch.email !== undefined ? patch.email : existing.email,
        phone: patch.phone !== undefined ? patch.phone : existing.phone,
        firstName: patch.firstName !== undefined ? patch.firstName : existing.firstName,
        lastName: patch.lastName !== undefined ? patch.lastName : existing.lastName,
        address: patch.address !== undefined ? patch.address : existing.address,
        companyId: patch.companyId !== undefined ? patch.companyId : existing.companyId,
        leadStatus: patch.leadStatus !== undefined ? patch.leadStatus : existing.leadStatus,
        goldenId: patch.goldenId !== undefined ? patch.goldenId : existing.goldenId,
        consentStatus: patch.consentStatus !== undefined ? patch.consentStatus : existing.consentStatus,
        consentUpdatedAt: patch.consentUpdatedAt !== undefined ? patch.consentUpdatedAt : existing.consentUpdatedAt,
        unsubscribed: patch.unsubscribed !== undefined ? patch.unsubscribed : existing.unsubscribed,
        unsubscribedUpdatedAt: patch.unsubscribedUpdatedAt !== undefined ? patch.unsubscribedUpdatedAt : existing.unsubscribedUpdatedAt,
      };

      store.contacts[contactIndex] = updated;
      return reply.status(200).send(updated);
    });

    // -------------------------------------------------------------------------
    // Companies
    // -------------------------------------------------------------------------

    app.get('/companies', async (request: FastifyRequest, reply) => {
      const queryResult = CRM1ListQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid company list query parameters',
            details: queryResult.error.issues,
          })
        );
      }

      const { page, pageSize, search } = queryResult.data;
      let filtered = [...store.companies];
      if (search) {
        const s = search.toLowerCase();
        filtered = filtered.filter(
          (c) =>
            c.name.toLowerCase().includes(s) ||
            (c.taxNumber && c.taxNumber.toLowerCase().includes(s))
        );
      }

      const total = filtered.length;
      const startIndex = (page - 1) * pageSize;
      const items = filtered.slice(startIndex, startIndex + pageSize);

      return reply.status(200).send({
        items,
        page,
        pageSize,
        total,
      });
    });

    app.get('/companies/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { id } = request.params;
      const found = store.companies.find((c) => c.id === id);
      if (!found) {
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message: `Company with id '${id}' not found`,
          })
        );
      }
      return reply.status(200).send(found);
    });

    app.post('/companies', async (request: FastifyRequest, reply) => {
      const parsed = CRM1CompanyCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Validation failed for company creation',
            details: parsed.error.issues,
          })
        );
      }

      const body = parsed.data;

      // Company tax number duplicate evaluation
      const compCandidate: CompanyCandidate = {
        name: body.name,
      };
      if (body.taxNumber !== undefined) compCandidate.taxNumber = body.taxNumber;

      const dupComp = evaluateCompanyDuplicate(compCandidate, store.companies);
      if (dupComp.outcome === 'EXACT_MATCH') {
        return reply.status(409).send(
          createErrorEnvelope({
            code: StandardErrorCodes.CONFLICT,
            message: `Duplicate company detected: ${dupComp.reason}`,
            details: dupComp.candidateMatches,
          })
        );
      }
      if (dupComp.outcome === 'AMBIGUOUS_REVIEW_REQUIRED') {
        return reply.status(409).send(
          createErrorEnvelope({
            code: StandardErrorCodes.CONFLICT,
            message: `Ambiguous company match requires human review: ${dupComp.reason}`,
            details: dupComp.candidateMatches,
          })
        );
      }

      const newCompany: CRM1Company = {
        id: `00000000-0000-4000-9000-${String(store.companies.length + 1).padStart(12, '0')}`,
        name: body.name,
        taxNumber: body.taxNumber ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        address: body.address ?? null,
        sourceSystem: body.sourceSystem ?? 'api_mock',
        sourceId: body.sourceId ?? `comp_${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      store.companies.push(newCompany);
      return reply.status(201).send(newCompany);
    });

    app.patch('/companies/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { id } = request.params;
      const idx = store.companies.findIndex((c) => c.id === id);
      if (idx === -1) {
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message: `Company with id '${id}' not found`,
          })
        );
      }

      const parsed = CRM1CompanyPatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Validation failed for company patch',
            details: parsed.error.issues,
          })
        );
      }

      const patch = parsed.data;
      const existing = store.companies[idx]!;

      const updated: CRM1Company = {
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
        name: patch.name !== undefined ? patch.name : existing.name,
        taxNumber: patch.taxNumber !== undefined ? patch.taxNumber : existing.taxNumber,
        email: patch.email !== undefined ? patch.email : existing.email,
        phone: patch.phone !== undefined ? patch.phone : existing.phone,
        address: patch.address !== undefined ? patch.address : existing.address,
        sourceSystem: patch.sourceSystem !== undefined ? patch.sourceSystem : existing.sourceSystem,
        sourceId: patch.sourceId !== undefined ? patch.sourceId : existing.sourceId,
      };

      store.companies[idx] = updated;
      return reply.status(200).send(updated);
    });

    // -------------------------------------------------------------------------
    // Leads
    // -------------------------------------------------------------------------

    app.get('/leads', async (request: FastifyRequest, reply) => {
      const queryResult = CRM1ListQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid lead list query parameters',
            details: queryResult.error.issues,
          })
        );
      }

      const { page, pageSize } = queryResult.data;
      const total = store.leads.length;
      const startIndex = (page - 1) * pageSize;
      const items = store.leads.slice(startIndex, startIndex + pageSize);

      return reply.status(200).send({
        items,
        page,
        pageSize,
        total,
      });
    });

    app.get('/leads/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { id } = request.params;
      const found = store.leads.find((l) => l.id === id);
      if (!found) {
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message: `Lead with id '${id}' not found`,
          })
        );
      }
      return reply.status(200).send(found);
    });

    app.post('/leads', async (request: FastifyRequest, reply) => {
      const parsed = CRM1LeadCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Validation failed for lead creation',
            details: parsed.error.issues,
          })
        );
      }

      const body = parsed.data;
      if (!store.contacts.some((c) => c.id === body.contactId)) {
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message: `Referenced contactId '${body.contactId}' not found`,
          })
        );
      }

      const newLead: CRM1Lead = {
        id: `00000000-0000-4000-7000-${String(store.leads.length + 1).padStart(12, '0')}`,
        contactId: body.contactId,
        status: body.status,
        sourceSystem: body.sourceSystem ?? 'api_mock',
        sourceId: body.sourceId ?? `lead_${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      store.leads.push(newLead);
      return reply.status(201).send(newLead);
    });

    app.patch('/leads/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { id } = request.params;
      const idx = store.leads.findIndex((l) => l.id === id);
      if (idx === -1) {
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message: `Lead with id '${id}' not found`,
          })
        );
      }

      const parsed = CRM1LeadPatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Validation failed for lead patch',
            details: parsed.error.issues,
          })
        );
      }

      const patch = parsed.data;
      const existing = store.leads[idx]!;

      if (patch.status && !canTransitionLeadStatus(existing.status, patch.status)) {
        return reply.status(409).send(
          createErrorEnvelope({
            code: StandardErrorCodes.CONFLICT,
            message: `Disallowed lead status transition from '${existing.status}' to '${patch.status}'`,
          })
        );
      }

      if (patch.contactId && !store.contacts.some((c) => c.id === patch.contactId)) {
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message: `Referenced contactId '${patch.contactId}' not found`,
          })
        );
      }

      const updated: CRM1Lead = {
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
        contactId: patch.contactId !== undefined ? patch.contactId : existing.contactId,
        status: patch.status !== undefined ? patch.status : existing.status,
        sourceSystem: patch.sourceSystem !== undefined ? patch.sourceSystem : existing.sourceSystem,
        sourceId: patch.sourceId !== undefined ? patch.sourceId : existing.sourceId,
      };

      store.leads[idx] = updated;
      return reply.status(200).send(updated);
    });

    // -------------------------------------------------------------------------
    // Imports & Rejects
    // -------------------------------------------------------------------------

    app.post('/imports', async (request: FastifyRequest, reply) => {
      const parsed = CRM1ImportCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Validation failed for import creation',
            details: parsed.error.issues,
          })
        );
      }

      const body = parsed.data;
      const batchId = `00000000-0000-4000-6000-${String(store.batches.size + 1).padStart(12, '0')}`;
      const batch: CRM1ImportBatch = {
        id: batchId,
        sourceSystem: body.sourceSystem,
        status: 'completed',
        loadedCount: body.rows.length,
        rejectedCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };

      const receipts = body.rows.map((row, i) => ({
        sourceRow: row.sourceRow,
        entity: row.entity,
        targetId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        createdAt: new Date().toISOString(),
      }));

      store.batches.set(batchId, { batch, receipts, rejects: [] });
      return reply.status(201).send(batch);
    });

    app.get('/imports/:batch', async (request: FastifyRequest<{ Params: { batch: string } }>, reply) => {
      const { batch: batchId } = request.params;
      const record = store.batches.get(batchId);
      if (!record) {
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message: `Import batch '${batchId}' not found`,
          })
        );
      }

      return reply.status(200).send({
        ...record.batch,
        receipts: record.receipts,
      });
    });

    app.get('/imports/:batch/rejects', async (request: FastifyRequest<{ Params: { batch: string } }>, reply) => {
      const { batch: batchId } = request.params;
      const record = store.batches.get(batchId);
      if (!record) {
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message: `Import batch '${batchId}' not found`,
          })
        );
      }

      const queryResult = CRM1ListQuerySchema.safeParse(request.query);
      const page = queryResult.success ? queryResult.data.page : 1;
      const pageSize = queryResult.success ? queryResult.data.pageSize : 25;

      const items = record.rejects.slice((page - 1) * pageSize, page * pageSize);
      return reply.status(200).send({
        items,
        page,
        pageSize,
        total: record.rejects.length,
      });
    });
  };

  if (fastify.prefix && fastify.prefix.length > 0) {
    await registerRoutes(fastify);
  } else {
    await fastify.register(registerRoutes, { prefix: options.prefix ?? CRM1_API_PREFIX });
  }
};
