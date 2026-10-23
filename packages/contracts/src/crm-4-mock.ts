import type {
  FastifyPluginAsync,
  FastifyRequest,
  FastifyReply,
  FastifyInstance,
} from 'fastify';
import { randomUUID } from 'crypto';
import {
  type CRM4List,
  type CRM4Campaign,
  type CRM4Member,
  type CRM4Consent,
  type CRM4ListCreate,
  type CRM4ListPatch,
  type CRM4CampaignCreate,
  type CRM4CampaignPatch,
  type CRM4MemberCreate,
  type CRM4ConsentSet,
  type CRM4ListResponse,
  type CRM4CampaignListResponse,
  type CRM4MemberListResponse,
  CRM4ListCreateSchema,
  CRM4ListPatchSchema,
  CRM4ListQuerySchema,
  CRM4CampaignCreateSchema,
  CRM4CampaignPatchSchema,
  CRM4CampaignQuerySchema,
  CRM4MemberCreateSchema,
  CRM4MemberQuerySchema,
  CRM4ConsentSetSchema,
  CRM4_API_PREFIX,
  assertValidMemberStatus,
  assertValidConsentStatus,
  assertMonotonicOptOut,
} from './crm-4.js';
import {
  createErrorEnvelope,
  StandardErrorCodes,
} from './common.js';

// ---------------------------------------------------------------------------
// 1. Deterministic Synthetic Fixture Generators
// ---------------------------------------------------------------------------

export function createDeterministicMockLists(): CRM4List[] {
  return [
    {
      id: '40000000-0000-4000-8000-000000000001',
      name: 'Q4 Enterprise Prospects',
      description: 'Tier-1 enterprise strategic decision makers and evaluation leads.',
      campaignCount: 2,
      memberCount: 150,
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:00.000Z',
    },
    {
      id: '40000000-0000-4000-8000-000000000002',
      name: 'SMB Renewal Accounts 2026',
      description: 'Mid-market and SMB clients up for annual contract renewal.',
      campaignCount: 1,
      memberCount: 85,
      createdAt: '2026-10-05T09:30:00.000Z',
      updatedAt: '2026-10-05T09:30:00.000Z',
    },
    {
      id: '40000000-0000-4000-8000-000000000003',
      name: 'Developer Ecosystem & ISVs',
      description: 'Platform API partners, SDK contributors, and marketplace vendors.',
      campaignCount: 1,
      memberCount: 320,
      createdAt: '2026-10-10T11:00:00.000Z',
      updatedAt: '2026-10-10T11:00:00.000Z',
    },
  ];
}

export function createDeterministicMockCampaigns(): CRM4Campaign[] {
  return [
    {
      id: '41000000-0000-4000-8000-000000000001',
      name: 'Q4 Enterprise Product Launch Announcement',
      campaignDate: '2026-11-15',
      listId: '40000000-0000-4000-8000-000000000001',
      listName: 'Q4 Enterprise Prospects',
      memberCount: 150,
      createdAt: '2026-10-01T08:30:00.000Z',
      updatedAt: '2026-10-01T08:30:00.000Z',
    },
    {
      id: '41000000-0000-4000-8000-000000000002',
      name: 'Executive Webinar: Modern Cloud Migration',
      campaignDate: '2026-11-20',
      listId: '40000000-0000-4000-8000-000000000001',
      listName: 'Q4 Enterprise Prospects',
      memberCount: 95,
      createdAt: '2026-10-02T10:00:00.000Z',
      updatedAt: '2026-10-02T10:00:00.000Z',
    },
    {
      id: '41000000-0000-4000-8000-000000000003',
      name: 'Annual Developer Summit 2026 Invitation',
      campaignDate: '2026-12-01',
      listId: '40000000-0000-4000-8000-000000000003',
      listName: 'Developer Ecosystem & ISVs',
      memberCount: 320,
      createdAt: '2026-10-10T12:00:00.000Z',
      updatedAt: '2026-10-10T12:00:00.000Z',
    },
  ];
}

export function createDeterministicMockMembers(): CRM4Member[] {
  return [
    {
      id: '42000000-0000-4000-8000-000000000001',
      campaignId: '41000000-0000-4000-8000-000000000001',
      contactId: '11111111-1111-4111-8111-000000000001',
      status: 'opened',
      unsubscribed: false,
      createdAt: '2026-10-01T09:00:00.000Z',
    },
    {
      id: '42000000-0000-4000-8000-000000000002',
      campaignId: '41000000-0000-4000-8000-000000000001',
      contactId: '11111111-1111-4111-8111-000000000002',
      status: 'clicked',
      unsubscribed: false,
      createdAt: '2026-10-01T09:15:00.000Z',
    },
    {
      id: '42000000-0000-4000-8000-000000000003',
      campaignId: '41000000-0000-4000-8000-000000000001',
      contactId: '11111111-1111-4111-8111-000000000003',
      status: 'sent',
      unsubscribed: true,
      createdAt: '2026-10-01T09:30:00.000Z',
    },
    {
      id: '42000000-0000-4000-8000-000000000004',
      campaignId: '41000000-0000-4000-8000-000000000002',
      contactId: '11111111-1111-4111-8111-000000000001',
      status: 'sent',
      unsubscribed: false,
      createdAt: '2026-10-02T10:15:00.000Z',
    },
    {
      id: '42000000-0000-4000-8000-000000000005',
      campaignId: '41000000-0000-4000-8000-000000000003',
      contactId: '11111111-1111-4111-8111-000000000001',
      status: 'opened',
      unsubscribed: false,
      createdAt: '2026-10-10T12:15:00.000Z',
    },
    {
      id: '42000000-0000-4000-8000-000000000006',
      campaignId: '41000000-0000-4000-8000-000000000003',
      contactId: '11111111-1111-4111-8111-000000000002',
      status: 'clicked',
      unsubscribed: false,
      createdAt: '2026-10-10T12:30:00.000Z',
    },
  ];
}

export function createDeterministicMockConsents(): CRM4Consent[] {
  return [
    {
      id: '43000000-0000-4000-8000-000000000001',
      contactId: '11111111-1111-4111-8111-000000000001',
      status: 'subscribed',
      consentDate: '2026-09-15T08:00:00.000Z',
      source: 'webform_inbound_quote',
      createdAt: '2026-09-15T08:00:00.000Z',
      updatedAt: '2026-09-15T08:00:00.000Z',
    },
    {
      id: '43000000-0000-4000-8000-000000000002',
      contactId: '11111111-1111-4111-8111-000000000002',
      status: 'subscribed',
      consentDate: '2026-09-20T10:00:00.000Z',
      source: 'partner_referral_optin',
      createdAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
    },
    {
      id: '43000000-0000-4000-8000-000000000003',
      contactId: '11111111-1111-4111-8111-000000000003',
      status: 'unsubscribed',
      consentDate: '2026-10-01T10:00:00.000Z',
      source: 'email_campaign_unsubscribe_link',
      createdAt: '2026-09-01T08:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
    },
  ];
}

// ---------------------------------------------------------------------------
// 2. In-Memory Mock Store with Domain Invariant Enforcement
// ---------------------------------------------------------------------------

export class CRM4MockStore {
  private lists: Map<string, CRM4List> = new Map();
  private campaigns: Map<string, CRM4Campaign> = new Map();
  private members: Map<string, CRM4Member> = new Map();
  private consentsByContact: Map<string, CRM4Consent> = new Map();

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.lists.clear();
    this.campaigns.clear();
    this.members.clear();
    this.consentsByContact.clear();

    for (const list of createDeterministicMockLists()) {
      this.lists.set(list.id, { ...list });
    }
    for (const campaign of createDeterministicMockCampaigns()) {
      this.campaigns.set(campaign.id, { ...campaign });
    }
    for (const member of createDeterministicMockMembers()) {
      this.members.set(member.id, { ...member });
    }
    for (const consent of createDeterministicMockConsents()) {
      this.consentsByContact.set(consent.contactId, { ...consent });
    }
  }

  // --- Marketing Lists ---

  public getLists(query?: { search?: string | undefined; page?: number | undefined; pageSize?: number | undefined }): CRM4ListResponse {
    let all = Array.from(this.lists.values());

    if (query?.search) {
      const q = query.search.toLowerCase();
      all = all.filter((l) => l.name.toLowerCase().includes(q) || (l.description?.toLowerCase().includes(q) ?? false));
    }

    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const page = Math.max(1, query?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query?.pageSize ?? 25));
    const totalCount = all.length;
    const totalPages = Math.ceil(totalCount / pageSize) || 1;
    const offset = (page - 1) * pageSize;
    const items = all.slice(offset, offset + pageSize);

    return {
      items,
      pagination: { page, pageSize, totalCount, totalPages },
    };
  }

  public getListById(id: string): CRM4List | null {
    return this.lists.get(id) ?? null;
  }

  public createList(input: CRM4ListCreate): CRM4List {
    CRM4ListCreateSchema.parse(input);
    const now = new Date().toISOString();
    const list: CRM4List = {
      id: randomUUID(),
      name: input.name.trim(),
      description: input.description?.trim() ?? null,
      campaignCount: 0,
      memberCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.lists.set(list.id, list);
    return list;
  }

  public patchList(id: string, input: CRM4ListPatch): CRM4List {
    CRM4ListPatchSchema.parse(input);
    const existing = this.lists.get(id);
    if (!existing) {
      throw new Error(`Marketing list '${id}' not found`);
    }

    const updated: CRM4List = {
      ...existing,
      name: input.name !== undefined ? input.name.trim() : existing.name,
      description: input.description !== undefined ? input.description?.trim() ?? null : existing.description,
      updatedAt: new Date().toISOString(),
    };

    this.lists.set(id, updated);
    return updated;
  }

  // --- Campaigns ---

  public getCampaigns(query?: { listId?: string | undefined; search?: string | undefined; page?: number | undefined; pageSize?: number | undefined }): CRM4CampaignListResponse {
    let all = Array.from(this.campaigns.values());

    if (query?.listId) {
      all = all.filter((c) => c.listId === query.listId);
    }
    if (query?.search) {
      const q = query.search.toLowerCase();
      all = all.filter((c) => c.name.toLowerCase().includes(q));
    }

    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const page = Math.max(1, query?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query?.pageSize ?? 25));
    const totalCount = all.length;
    const totalPages = Math.ceil(totalCount / pageSize) || 1;
    const offset = (page - 1) * pageSize;
    const items = all.slice(offset, offset + pageSize);

    return {
      items,
      pagination: { page, pageSize, totalCount, totalPages },
    };
  }

  public getCampaignById(id: string): CRM4Campaign | null {
    return this.campaigns.get(id) ?? null;
  }

  public createCampaign(input: CRM4CampaignCreate): CRM4Campaign {
    CRM4CampaignCreateSchema.parse(input);
    const parentList = this.lists.get(input.listId);
    if (!parentList) {
      throw new Error(`Referenced marketing list '${input.listId}' does not exist`);
    }

    const now = new Date().toISOString();
    const campaign: CRM4Campaign = {
      id: randomUUID(),
      name: input.name.trim(),
      campaignDate: input.campaignDate,
      listId: input.listId,
      listName: parentList.name,
      memberCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.campaigns.set(campaign.id, campaign);

    // Increment parent list's campaign count
    this.lists.set(parentList.id, {
      ...parentList,
      campaignCount: parentList.campaignCount + 1,
      updatedAt: now,
    });

    return campaign;
  }

  public patchCampaign(id: string, input: CRM4CampaignPatch & { listId?: string }): CRM4Campaign {
    const existing = this.campaigns.get(id);
    if (!existing) {
      throw new Error(`Campaign '${id}' not found`);
    }

    // Invariant: listId is strictly immutable
    if ('listId' in input && input.listId !== undefined && input.listId !== existing.listId) {
      throw new Error(
        `Domain Invariant Violation: Campaign parent list_id is immutable after creation. Attempted change from '${existing.listId}' to '${input.listId}'.`
      );
    }

    CRM4CampaignPatchSchema.parse({
      name: input.name,
      campaignDate: input.campaignDate,
    });

    const updated: CRM4Campaign = {
      ...existing,
      name: input.name !== undefined ? input.name.trim() : existing.name,
      campaignDate: input.campaignDate !== undefined ? input.campaignDate : existing.campaignDate,
      updatedAt: new Date().toISOString(),
    };

    this.campaigns.set(id, updated);
    return updated;
  }

  // --- Campaign Members ---

  public getCampaignMembers(campaignId: string, query?: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined }): CRM4MemberListResponse {
    let all = Array.from(this.members.values()).filter((m) => m.campaignId === campaignId);

    if (query?.status) {
      all = all.filter((m) => m.status === query.status);
    }

    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const page = Math.max(1, query?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query?.pageSize ?? 25));
    const totalCount = all.length;
    const totalPages = Math.ceil(totalCount / pageSize) || 1;
    const offset = (page - 1) * pageSize;
    const items = all.slice(offset, offset + pageSize);

    return {
      items,
      pagination: { page, pageSize, totalCount, totalPages },
    };
  }

  public addCampaignMember(input: CRM4MemberCreate): CRM4Member {
    CRM4MemberCreateSchema.parse(input);
    const campaign = this.campaigns.get(input.campaignId);
    if (!campaign) {
      throw new Error(`Campaign '${input.campaignId}' does not exist`);
    }

    assertValidMemberStatus(input.status);

    // Composite uniqueness (campaignId, contactId)
    const exists = Array.from(this.members.values()).some(
      (m) => m.campaignId === input.campaignId && m.contactId === input.contactId
    );
    if (exists) {
      throw new Error(`Contact '${input.contactId}' is already a member of campaign '${input.campaignId}'`);
    }

    // Cross-check consent state at action time
    const consent = this.consentsByContact.get(input.contactId);
    const isUnsubscribed = consent ? consent.status === 'unsubscribed' : (input.unsubscribed ?? false);

    const now = new Date().toISOString();
    const member: CRM4Member = {
      id: randomUUID(),
      campaignId: input.campaignId,
      contactId: input.contactId,
      status: input.status,
      unsubscribed: isUnsubscribed,
      createdAt: now,
    };

    this.members.set(member.id, member);

    // Increment campaign member count
    this.campaigns.set(campaign.id, {
      ...campaign,
      memberCount: campaign.memberCount + 1,
      updatedAt: now,
    });

    return member;
  }

  // --- Consents (BR-CRM4-01 strictly monotonic opt-out) ---

  public getConsentByContact(contactId: string): CRM4Consent | null {
    return this.consentsByContact.get(contactId) ?? null;
  }

  public setConsent(input: CRM4ConsentSet): CRM4Consent {
    CRM4ConsentSetSchema.parse(input);
    assertValidConsentStatus(input.status);

    const existing = this.consentsByContact.get(input.contactId);
    assertMonotonicOptOut(existing?.status, input.status);

    const now = new Date().toISOString();
    const consent: CRM4Consent = {
      id: existing?.id ?? randomUUID(),
      contactId: input.contactId,
      status: input.status,
      consentDate: input.consentDate ?? now,
      source: input.source.trim(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.consentsByContact.set(input.contactId, consent);
    return consent;
  }

  // --- CSV Export with Formula Injection Neutralization ---

  public exportCampaignCsv(campaignId: string): string {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) {
      throw new Error(`Campaign '${campaignId}' not found`);
    }

    const members = Array.from(this.members.values()).filter((m) => m.campaignId === campaignId);

    const sanitize = (val: string): string => {
      if (/^[=+\-@\t\r]/.test(val)) {
        return `'${val}`;
      }
      return val;
    };

    const headers = ['member_id', 'campaign_id', 'contact_id', 'status', 'unsubscribed', 'created_at'];
    const rows = members.map((m) => [
      m.id,
      m.campaignId,
      m.contactId,
      m.status,
      String(m.unsubscribed),
      m.createdAt,
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((r) => r.map((c) => `"${sanitize(c)}"`).join(',')),
    ].join('\n');

    return csvContent;
  }
}

// Global default singleton store for deterministic test executions
export const defaultCRM4MockStore = new CRM4MockStore();

// ---------------------------------------------------------------------------
// 3. Fastify Mock Plugin Factory
// ---------------------------------------------------------------------------

export interface CRM4MockPluginOptions {
  store?: CRM4MockStore;
  prefix?: string;
}

export const crm4MockPlugin: FastifyPluginAsync<CRM4MockPluginOptions> = async (
  fastify: FastifyInstance,
  opts: CRM4MockPluginOptions = {}
) => {
  const store = opts.store ?? defaultCRM4MockStore;

  const registerRoutes = async (app: FastifyInstance) => {
    // Health check
    app.get('/health', async () => ({
      status: 'healthy',
      module: 'crm-4',
      mockServer: true,
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      entities: {
        lists: store.getLists().pagination.totalCount,
        campaigns: store.getCampaigns().pagination.totalCount,
      },
    }));

    // 1. Lists: List & Page
    app.get('/lists', async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = CRM4ListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid query parameters for marketing lists',
            details: parsed.error.issues,
          })
        );
      }
      const result = store.getLists(parsed.data);
      return reply.status(200).send(result);
    });

    // 2. Lists: Create
    app.post('/lists', async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = CRM4ListCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid marketing list payload',
            details: parsed.error.issues,
          })
        );
      }
      const created = store.createList(parsed.data);
      return reply.status(201).send(created);
    });

    // 3. Lists: Get by ID
    app.get('/lists/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const list = store.getListById(req.params.id);
      if (!list) {
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message: `Marketing list '${req.params.id}' not found`,
          })
        );
      }
      return reply.status(200).send(list);
    });

    // 4. Lists: Patch
    app.patch('/lists/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const parsed = CRM4ListPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid marketing list patch payload',
            details: parsed.error.issues,
          })
        );
      }
      try {
        const updated = store.patchList(req.params.id, parsed.data);
        return reply.status(200).send(updated);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message,
          })
        );
      }
    });

    // 5. Campaigns: List & Page
    app.get('/campaigns', async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = CRM4CampaignQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid query parameters for campaigns',
            details: parsed.error.issues,
          })
        );
      }
      const result = store.getCampaigns(parsed.data);
      return reply.status(200).send(result);
    });

    // 6. Campaigns: Create
    app.post('/campaigns', async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = CRM4CampaignCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid campaign payload',
            details: parsed.error.issues,
          })
        );
      }
      try {
        const created = store.createCampaign(parsed.data);
        return reply.status(201).send(created);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.BAD_REQUEST,
            message,
          })
        );
      }
    });

    // 7. Campaigns: Get by ID
    app.get('/campaigns/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const campaign = store.getCampaignById(req.params.id);
      if (!campaign) {
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message: `Campaign '${req.params.id}' not found`,
          })
        );
      }
      return reply.status(200).send(campaign);
    });

    // 8. Campaigns: Patch
    app.patch('/campaigns/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if ('listId' in body) {
        return reply.status(403).send(
          createErrorEnvelope({
            code: StandardErrorCodes.FORBIDDEN,
            message: 'Domain Invariant Violation: Campaign parent list_id is immutable after creation',
          })
        );
      }
      const parsed = CRM4CampaignPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid campaign patch payload',
            details: parsed.error.issues,
          })
        );
      }
      try {
        const updated = store.patchCampaign(req.params.id, req.body as any);
        return reply.status(200).send(updated);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const isInvariant = message.includes('Domain Invariant Violation');
        return reply.status(isInvariant ? 403 : 404).send(
          createErrorEnvelope({
            code: isInvariant ? StandardErrorCodes.FORBIDDEN : StandardErrorCodes.NOT_FOUND,
            message,
          })
        );
      }
    });

    // 9. Members: List by Campaign
    app.get('/campaigns/:id/members', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const parsed = CRM4MemberQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid query parameters for campaign members',
            details: parsed.error.issues,
          })
        );
      }
      const result = store.getCampaignMembers(req.params.id, parsed.data);
      return reply.status(200).send(result);
    });

    // 10. Members: Add Member
    app.post('/campaigns/:id/members', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const body = { ...(req.body as object), campaignId: req.params.id };
      const parsed = CRM4MemberCreateSchema.safeParse(body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid member payload',
            details: parsed.error.issues,
          })
        );
      }
      try {
        const created = store.addCampaignMember(parsed.data);
        return reply.status(201).send(created);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const isConflict = message.includes('already a member');
        return reply.status(isConflict ? 409 : 400).send(
          createErrorEnvelope({
            code: isConflict ? StandardErrorCodes.CONFLICT : StandardErrorCodes.BAD_REQUEST,
            message,
          })
        );
      }
    });

    // 11. Consents: Read Consent by Contact UUID
    app.get('/consents/:contact', async (req: FastifyRequest<{ Params: { contact: string } }>, reply: FastifyReply) => {
      const consent = store.getConsentByContact(req.params.contact);
      if (!consent) {
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message: `Consent record for contact '${req.params.contact}' not found`,
          })
        );
      }
      return reply.status(200).send(consent);
    });

    // 12. Consents: Set Consent (enforcing BR-CRM4-01 monotonic opt-out)
    app.post('/consents', async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = CRM4ConsentSetSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid consent payload',
            details: parsed.error.issues,
          })
        );
      }
      try {
        const result = store.setConsent(parsed.data);
        return reply.status(200).send(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const isMonotonicViolation = message.includes('BR-CRM4-01');
        return reply.status(isMonotonicViolation ? 409 : 400).send(
          createErrorEnvelope({
            code: isMonotonicViolation ? StandardErrorCodes.CONFLICT : StandardErrorCodes.BAD_REQUEST,
            message,
          })
        );
      }
    });

    // 13. CSV Export: Export Campaign Members
    app.get('/campaigns/:id/export', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const csv = store.exportCampaignCsv(req.params.id);
        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="campaign-${req.params.id}-members.csv"`)
          .status(200)
          .send(csv);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message,
          })
        );
      }
    });
  };

  if (fastify.prefix && fastify.prefix.length > 0) {
    await registerRoutes(fastify);
  } else {
    await fastify.register(registerRoutes, { prefix: opts.prefix ?? CRM4_API_PREFIX });
  }
};
