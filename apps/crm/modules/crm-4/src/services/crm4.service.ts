import { randomUUID } from 'node:crypto';
import { AppError } from '@cs/kernel';
import {
  type CRM4List,
  type CRM4ListCreate,
  type CRM4ListPatch,
  type CRM4Campaign,
  type CRM4CampaignCreate,
  type CRM4CampaignPatch,
  type CRM4Member,
  type CRM4MemberCreate,
  type CRM4Consent,
  type CRM4ConsentSet,
  assertMonotonicOptOut,
  assertValidMemberStatus,
} from '@clearshift/contracts';
import { sanitizeCsvField, redactSensitiveObject } from '../policies/masking.js';

export class Crm4Service {
  private lists: Map<string, CRM4List> = new Map();
  private campaigns: Map<string, CRM4Campaign> = new Map();
  private members: Map<string, CRM4Member> = new Map();
  private consents: Map<string, CRM4Consent> = new Map(); // Keyed by contactId

  constructor() {
    this.seedSyntheticData();
  }

  /**
   * Captures an in-memory snapshot of all owned entity state for transactional atomicity & rollback.
   */
  public snapshotState() {
    return {
      lists: new Map(this.lists),
      campaigns: new Map(this.campaigns),
      members: new Map(this.members),
      consents: new Map(this.consents),
    };
  }

  /**
   * Restores in-memory state from a previously captured snapshot.
   */
  public restoreState(snapshot: {
    lists: Map<string, CRM4List>;
    campaigns: Map<string, CRM4Campaign>;
    members: Map<string, CRM4Member>;
    consents: Map<string, CRM4Consent>;
  }): void {
    this.lists = new Map(snapshot.lists);
    this.campaigns = new Map(snapshot.campaigns);
    this.members = new Map(snapshot.members);
    this.consents = new Map(snapshot.consents);
  }

  /**
   * Resets and populates deterministic synthetic fixtures.
   */
  public seedSyntheticData(): void {
    this.lists.clear();
    this.campaigns.clear();
    this.members.clear();
    this.consents.clear();

    const nowIso = new Date().toISOString();

    // 1. Synthetic Lists
    const list1Id = '44444444-1111-4444-8444-000000000001';
    const list2Id = '44444444-1111-4444-8444-000000000002';

    this.lists.set(list1Id, {
      id: list1Id,
      name: 'Q4 Enterprise Prospects',
      description: 'Synthetic marketing list for Q4 enterprise outreach',
      campaignCount: 1,
      memberCount: 2,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    this.lists.set(list2Id, {
      id: list2Id,
      name: 'Product Beta Advocates',
      description: 'Synthetic list for early product feedback',
      campaignCount: 1,
      memberCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 2. Synthetic Campaigns
    const camp1Id = '44444444-2222-4444-8444-000000000001';
    const camp2Id = '44444444-2222-4444-8444-000000000002';

    this.campaigns.set(camp1Id, {
      id: camp1Id,
      name: 'Q4 Product Launch Announcement',
      campaignDate: '2026-11-01',
      listId: list1Id,
      listName: 'Q4 Enterprise Prospects',
      memberCount: 2,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    this.campaigns.set(camp2Id, {
      id: camp2Id,
      name: 'Beta User Feedback Drive',
      campaignDate: '2026-11-15',
      listId: list2Id,
      listName: 'Product Beta Advocates',
      memberCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 3. Synthetic Consents
    const contact1Id = '11111111-1111-4111-8111-000000000001';
    const contact2Id = '11111111-1111-4111-8111-000000000002'; // Known unsubscribed!
    const contact3Id = '11111111-1111-4111-8111-000000000003';

    this.consents.set(contact1Id, {
      id: randomUUID(),
      contactId: contact1Id,
      status: 'subscribed',
      consentDate: nowIso,
      source: 'web_form',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    this.consents.set(contact2Id, {
      id: randomUUID(),
      contactId: contact2Id,
      status: 'unsubscribed', // BR-CRM4-01 target
      consentDate: nowIso,
      source: 'unsubscribe_link',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    this.consents.set(contact3Id, {
      id: randomUUID(),
      contactId: contact3Id,
      status: 'subscribed',
      consentDate: nowIso,
      source: 'csv_import',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 4. Synthetic Members
    const mem1Id = '44444444-3333-4444-8444-000000000001';
    const mem2Id = '44444444-3333-4444-8444-000000000002';

    this.members.set(mem1Id, {
      id: mem1Id,
      campaignId: camp1Id,
      contactId: contact1Id,
      status: 'sent',
      unsubscribed: false,
      createdAt: nowIso,
    });

    this.members.set(mem2Id, {
      id: mem2Id,
      campaignId: camp1Id,
      contactId: contact2Id,
      status: 'opened',
      unsubscribed: true,
      createdAt: nowIso,
    });
  }

  // =========================================================================
  // Marketing Lists
  // =========================================================================

  public async getLists(params: { search?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {}) {
    let all = Array.from(this.lists.values());

    if (params.search) {
      const q = params.search.toLowerCase();
      all = all.filter((l) => l.name.toLowerCase().includes(q) || (l.description && l.description.toLowerCase().includes(q)));
    }

    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));

    const page = params.page && params.page > 0 ? params.page : 1;
    const pageSize = params.pageSize && params.pageSize > 0 ? Math.min(params.pageSize, 100) : 25;
    const totalCount = all.length;
    const totalPages = Math.ceil(totalCount / pageSize);
    const start = (page - 1) * pageSize;
    const items = all.slice(start, start + pageSize);

    return {
      items,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages,
      },
    };
  }

  public async getListById(id: string): Promise<CRM4List> {
    const list = this.lists.get(id);
    if (!list) {
      throw new AppError('NOT_FOUND', `Marketing list with ID '${id}' not found`, 404);
    }
    return list;
  }

  public async createList(data: CRM4ListCreate): Promise<CRM4List> {
    const nowIso = new Date().toISOString();
    const list: CRM4List = {
      id: randomUUID(),
      name: data.name,
      description: data.description ?? null,
      campaignCount: 0,
      memberCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.lists.set(list.id, list);
    return list;
  }

  public async patchList(id: string, data: CRM4ListPatch): Promise<CRM4List> {
    const existing = await this.getListById(id);
    const updated: CRM4List = {
      ...existing,
      ...(data.name ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.lists.set(id, updated);
    return updated;
  }

  // =========================================================================
  // Campaigns
  // =========================================================================

  public async getCampaigns(params: { listId?: string | undefined; search?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {}) {
    let all = Array.from(this.campaigns.values());

    if (params.listId) {
      all = all.filter((c) => c.listId === params.listId);
    }
    if (params.search) {
      const q = params.search.toLowerCase();
      all = all.filter((c) => c.name.toLowerCase().includes(q));
    }

    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));

    const page = params.page && params.page > 0 ? params.page : 1;
    const pageSize = params.pageSize && params.pageSize > 0 ? Math.min(params.pageSize, 100) : 25;
    const totalCount = all.length;
    const totalPages = Math.ceil(totalCount / pageSize);
    const start = (page - 1) * pageSize;
    const items = all.slice(start, start + pageSize);

    return {
      items,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages,
      },
    };
  }

  public async getCampaignById(id: string): Promise<CRM4Campaign> {
    const campaign = this.campaigns.get(id);
    if (!campaign) {
      throw new AppError('NOT_FOUND', `Campaign with ID '${id}' not found`, 404);
    }
    return campaign;
  }

  public async createCampaign(data: CRM4CampaignCreate): Promise<CRM4Campaign> {
    // Verify referenced list exists
    const list = this.lists.get(data.listId);
    if (!list) {
      throw new AppError('NOT_FOUND', `Referenced marketing list '${data.listId}' not found`, 404);
    }

    const nowIso = new Date().toISOString();
    const campaign: CRM4Campaign = {
      id: randomUUID(),
      name: data.name,
      campaignDate: data.campaignDate,
      listId: data.listId,
      listName: list.name,
      memberCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.campaigns.set(campaign.id, campaign);
    list.campaignCount += 1;
    return campaign;
  }

  public async patchCampaign(id: string, data: CRM4CampaignPatch & { listId?: string }): Promise<CRM4Campaign> {
    const existing = await this.getCampaignById(id);

    // Enforce listId immutability invariant
    if (data.listId && data.listId !== existing.listId) {
      throw new AppError('FORBIDDEN', 'Campaign listId is immutable and cannot be modified after creation', 403);
    }

    const updated: CRM4Campaign = {
      ...existing,
      ...(data.name ? { name: data.name } : {}),
      ...(data.campaignDate ? { campaignDate: data.campaignDate } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.campaigns.set(id, updated);
    return updated;
  }

  // =========================================================================
  // Campaign Members
  // =========================================================================

  public async getCampaignMembers(
    campaignId: string,
    params: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {}
  ) {
    // Assert campaign exists
    await this.getCampaignById(campaignId);

    let all = Array.from(this.members.values()).filter((m) => m.campaignId === campaignId);

    if (params.status) {
      all = all.filter((m) => m.status === params.status);
    }

    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));

    const page = params.page && params.page > 0 ? params.page : 1;
    const pageSize = params.pageSize && params.pageSize > 0 ? Math.min(params.pageSize, 100) : 25;
    const totalCount = all.length;
    const totalPages = Math.ceil(totalCount / pageSize);
    const start = (page - 1) * pageSize;
    const items = all.slice(start, start + pageSize);

    return {
      items,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages,
      },
    };
  }

  public async addCampaignMember(data: CRM4MemberCreate): Promise<CRM4Member> {
    const campaign = await this.getCampaignById(data.campaignId);

    // Assert status invariant: strictly sent, opened, clicked
    assertValidMemberStatus(data.status);

    // Check existing consent at action time
    const consent = this.consents.get(data.contactId);
    const isUnsubscribed = consent ? consent.status === 'unsubscribed' : false;

    // Check duplicate membership
    const existing = Array.from(this.members.values()).find(
      (m) => m.campaignId === data.campaignId && m.contactId === data.contactId
    );
    if (existing) {
      throw new AppError('CONFLICT', `Contact '${data.contactId}' is already a member of campaign '${data.campaignId}'`, 409);
    }

    const member: CRM4Member = {
      id: randomUUID(),
      campaignId: data.campaignId,
      contactId: data.contactId,
      status: data.status,
      unsubscribed: isUnsubscribed || (data.unsubscribed ?? false),
      createdAt: new Date().toISOString(),
    };

    this.members.set(member.id, member);
    campaign.memberCount += 1;
    return member;
  }

  // =========================================================================
  // Consents & BR-CRM4-01 Monotonic Opt-Out Invariant
  // =========================================================================

  public async getConsent(contactId: string): Promise<CRM4Consent> {
    const consent = this.consents.get(contactId);
    if (!consent) {
      throw new AppError('NOT_FOUND', `Consent record for contact '${contactId}' not found`, 404);
    }
    return consent;
  }

  public async setConsent(data: CRM4ConsentSet): Promise<CRM4Consent> {
    const existing = this.consents.get(data.contactId);

    // Enforce BR-CRM4-01: A known opt-out / unsubscribe cannot be overwritten with subscribed
    if (existing) {
      try {
        assertMonotonicOptOut(existing.status, data.status);
      } catch (err: any) {
        throw new AppError(
          'CONFLICT',
          err.message || 'Domain Invariant Violation (BR-CRM4-01): Known opt-out cannot be changed to subscribed.',
          409
        );
      }
    }

    const nowIso = new Date().toISOString();
    const consent: CRM4Consent = {
      id: existing ? existing.id : randomUUID(),
      contactId: data.contactId,
      status: data.status,
      consentDate: data.consentDate ?? nowIso,
      source: data.source,
      createdAt: existing ? existing.createdAt : nowIso,
      updatedAt: nowIso,
    };

    this.consents.set(data.contactId, consent);

    // Update member unsubscribe flag if contact has now unsubscribed
    if (data.status === 'unsubscribed') {
      for (const m of this.members.values()) {
        if (m.contactId === data.contactId) {
          m.unsubscribed = true;
        }
      }
    }

    return consent;
  }

  public async getListByName(name: string): Promise<CRM4List | undefined> {
    const trimmed = name.trim().toLowerCase();
    return Array.from(this.lists.values()).find((l) => l.name.trim().toLowerCase() === trimmed);
  }

  public async getCampaignByName(name: string, listId?: string): Promise<CRM4Campaign | undefined> {
    const trimmed = name.trim().toLowerCase();
    return Array.from(this.campaigns.values()).find(
      (c) => c.name.trim().toLowerCase() === trimmed && (!listId || c.listId === listId)
    );
  }

  public async getMember(campaignId: string, contactId: string): Promise<CRM4Member | undefined> {
    return Array.from(this.members.values()).find(
      (m) => m.campaignId === campaignId && m.contactId === contactId
    );
  }

  // =========================================================================
  // CSV Export with Consent Re-check & Formula Injection Protection
  // =========================================================================

  public async exportCampaignMembersCsv(campaignId: string): Promise<string> {
    const campaign = await this.getCampaignById(campaignId);
    const members = Array.from(this.members.values()).filter((m) => m.campaignId === campaignId);

    const headers = ['MemberId', 'CampaignName', 'ContactId', 'Status', 'Unsubscribed', 'CreatedAt'];
    const rows: string[] = [headers.join(',')];

    for (const mem of members) {
      // Re-verify consent at export time
      const consent = this.consents.get(mem.contactId);
      const isUnsubscribed = mem.unsubscribed || (consent ? consent.status === 'unsubscribed' : false);

      const rowValues = [
        sanitizeCsvField(mem.id),
        sanitizeCsvField(campaign.name),
        sanitizeCsvField(mem.contactId),
        sanitizeCsvField(mem.status),
        sanitizeCsvField(isUnsubscribed ? 'true' : 'false'),
        sanitizeCsvField(mem.createdAt),
      ];
      rows.push(rowValues.join(','));
    }

    return rows.join('\n');
  }
}

export const crm4Service = new Crm4Service();
