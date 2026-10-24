import type {
  FastifyPluginAsync,
  FastifyRequest,
  FastifyReply,
} from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  type Deal,
  type Quote,
  type Stage,
  type CreateDealInput,
  type UpdateDealInput,
  type DealsQuery,
  type CreateQuoteInput,
  type UpdateQuoteInput,
  type QuotesQuery,
  type Crm2ImportRow,
  type Crm2ImportReceipt,
  type Crm2BatchExecutionReport,
  type Crm2ExecuteBatchLoadOutput,
  type Crm2DetectDuplicatesInput,
  type Crm2ResolveDuplicateInput,
  type Crm2DuplicateCandidate,
  type Crm2DuplicateAuditLogEntry,
  type Crm2EvaluateDealDuplicateInput,
  type Crm2EvaluateQuoteDuplicateInput,
  type Crm2StageName,
  CreateDealInputSchema,
  UpdateDealInputSchema,
  DealsQuerySchema,
  CreateQuoteInputSchema,
  UpdateQuoteInputSchema,
  QuotesQuerySchema,
  Crm2ImportRowSchema,
  Crm2ExecuteBatchLoadInputSchema,
  Crm2DetectDuplicatesInputSchema,
  Crm2ResolveDuplicateInputSchema,
  Crm2EvaluateDealDuplicateInputSchema,
  Crm2EvaluateQuoteDuplicateInputSchema,
  CRM2_API_PREFIX,
  CRM2_STAGES,
  CRM2_STAGE_SEEDS,
  assertDealStageTransition,
  assertValidStageName,
  evaluateDealDuplicate,
  evaluateQuoteDuplicate,
  buildQuoteExactKey,
} from './crm-2.js';

const normalizeQuoteNumber = buildQuoteExactKey;
import {
  createErrorEnvelope,
  StandardErrorCodes,
} from './common.js';
import {
  createDealWonEvent,
  type DealWonPayload,
} from './crm-2-events.js';
import type { EventEnvelope } from './events.js';

// ---------------------------------------------------------------------------
// 1. Deterministic Synthetic Fixture Generators (100% Synthetic, Zero PII)
// ---------------------------------------------------------------------------

export function createDeterministicMockStages(): Stage[] {
  return CRM2_STAGE_SEEDS.map((s) => ({
    id: s.id,
    name: s.name,
    order: s.order,
    is_closed_won: s.is_closed_won,
    is_closed_lost: s.is_closed_lost,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }));
}

export function createDeterministicMockDeals(): Deal[] {
  return [
    {
      id: '20000000-0000-4000-8000-000000000001',
      name: 'Acme Fleet Modernization Platform',
      contact_id: '00000000-0000-4000-8000-000000000001',
      contact_name: 'Alex Morgan',
      value: '125000.00',
      currency: 'USD',
      stage_id: '00000000-0000-4000-8000-000000000003',
      stage_name: 'Proposal',
      close_date: '2026-11-30',
      is_orphan: false,
      source_system: 'hubspot_migration',
      source_id: 'hs_deal_101',
      created_at: '2026-10-01T08:00:00.000Z',
      updated_at: '2026-10-01T08:00:00.000Z',
    },
    {
      id: '20000000-0000-4000-8000-000000000002',
      name: 'Global Logistics Warehouse Automation',
      contact_id: '00000000-0000-4000-8000-000000000002',
      contact_name: 'Jordan Taylor',
      value: '75000.00',
      currency: 'USD',
      stage_id: '00000000-0000-4000-8000-000000000002',
      stage_name: 'Qualified',
      close_date: '2026-12-15',
      is_orphan: false,
      source_system: 'salesforce_migration',
      source_id: 'sf_deal_202',
      created_at: '2026-10-05T09:30:00.000Z',
      updated_at: '2026-10-05T09:30:00.000Z',
    },
    {
      id: '20000000-0000-4000-8000-000000000003',
      name: 'Nordic Cloud Infrastructure Expansion',
      contact_id: '00000000-0000-4000-8000-000000000003',
      contact_name: 'Robin Chen',
      value: '250000.00',
      currency: 'EUR',
      stage_id: '00000000-0000-4000-8000-000000000004',
      stage_name: 'Negotiation',
      close_date: '2026-12-31',
      is_orphan: false,
      source_system: 'hubspot_migration',
      source_id: 'hs_deal_303',
      created_at: '2026-10-10T11:00:00.000Z',
      updated_at: '2026-10-10T11:00:00.000Z',
    },
    {
      id: '20000000-0000-4000-8000-000000000004',
      name: 'Summit Healthcare Predictive Analytics',
      contact_id: '00000000-0000-4000-8000-000000000001',
      contact_name: 'Alex Morgan',
      value: '180000.00',
      currency: 'USD',
      stage_id: '00000000-0000-4000-8000-000000000005',
      stage_name: 'Won',
      close_date: '2026-10-20',
      is_orphan: false,
      source_system: 'salesforce_migration',
      source_id: 'sf_deal_404',
      created_at: '2026-09-15T14:00:00.000Z',
      updated_at: '2026-10-20T16:00:00.000Z',
    },
    {
      id: '20000000-0000-4000-8000-000000000005',
      name: 'Pioneer Industrial IoT Sensor Array',
      contact_id: '00000000-0000-4000-8000-000000000002',
      contact_name: 'Jordan Taylor',
      value: '45000.00',
      currency: 'USD',
      stage_id: '00000000-0000-4000-8000-000000000006',
      stage_name: 'Lost',
      close_date: '2026-10-18',
      is_orphan: false,
      source_system: 'manual',
      source_id: 'man_deal_505',
      created_at: '2026-09-20T10:00:00.000Z',
      updated_at: '2026-10-18T12:00:00.000Z',
    },
    {
      id: '20000000-0000-4000-8000-000000000006',
      name: 'Unassigned Enterprise Ingest Pipeline',
      contact_id: null,
      contact_name: null,
      value: '30000.00',
      currency: 'USD',
      stage_id: '00000000-0000-4000-8000-000000000001',
      stage_name: 'New',
      close_date: '2026-11-15',
      is_orphan: true,
      source_system: 'csv_import',
      source_id: 'csv_deal_606',
      created_at: '2026-10-12T08:30:00.000Z',
      updated_at: '2026-10-12T08:30:00.000Z',
    },
  ];
}

export function createDeterministicMockQuotes(): Quote[] {
  return [
    {
      id: '30000000-0000-4000-8000-000000000001',
      deal_id: '20000000-0000-4000-8000-000000000001',
      quote_number: 'Q-2026-001',
      date: '2026-10-15',
      amount: '125000.00',
      currency: 'USD',
      note: 'Initial proposal for fleet telematics and edge gateways',
      created_at: '2026-10-15T09:00:00.000Z',
      updated_at: '2026-10-15T09:00:00.000Z',
    },
    {
      id: '30000000-0000-4000-8000-000000000002',
      deal_id: '20000000-0000-4000-8000-000000000003',
      quote_number: 'Q-2026-002',
      date: '2026-10-18',
      amount: '250000.00',
      currency: 'EUR',
      note: 'Multi-region Kubernetes deployment and managed databases',
      created_at: '2026-10-18T10:30:00.000Z',
      updated_at: '2026-10-18T10:30:00.000Z',
    },
    {
      id: '30000000-0000-4000-8000-000000000003',
      deal_id: '20000000-0000-4000-8000-000000000004',
      quote_number: 'Q-2026-003',
      date: '2026-10-10',
      amount: '180000.00',
      currency: 'USD',
      note: 'Healthcare compliance suite and predictive models',
      created_at: '2026-10-10T11:00:00.000Z',
      updated_at: '2026-10-10T11:00:00.000Z',
    },
  ];
}

export function createDeterministicMockCrm2Duplicates(): Crm2DuplicateCandidate[] {
  return [
    {
      id: '50000000-0000-4000-8000-000000000001',
      batchId: 'batch-crm2-init',
      module: 'crm-2',
      entity: 'deal',
      keyType: 'deal_business',
      normalizedKey:
        'acme fleet modernization platform#00000000-0000-4000-8000-000000000003#00000000-0000-4000-8000-000000000001',
      recordIds: [
        '20000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000099',
      ],
      status: 'held_for_review',
      detectedAt: new Date('2026-10-15T08:00:00.000Z'),
      metadata: {
        reason:
          'Identical normalized deal name, stage, and contact ID detected across import batches',
      },
    },
  ];
}

export function createDeterministicMockReceipts(): Crm2ImportReceipt[] {
  return [
    {
      id: '60000000-0000-4000-8000-000000000001',
      batchId: 'batch-crm2-init',
      sourceRow: 1,
      entity: 'deal',
      sourceSystem: 'hubspot_migration',
      sourceId: 'hs_deal_101',
      targetId: '20000000-0000-4000-8000-000000000001',
      idempotencyKey: 'crm2-seed-deal-101',
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      outcome: 'created',
      createdAt: '2026-10-01T08:00:00.000Z',
    },
  ];
}

// ---------------------------------------------------------------------------
// 2. In-Memory Mock Store with Strict Domain Invariant Enforcement
// ---------------------------------------------------------------------------

export class CRM2MockStore {
  private stages: Map<string, Stage> = new Map();
  private deals: Map<string, Deal> = new Map();
  private quotes: Map<string, Quote> = new Map();
  private duplicates: Map<string, Crm2DuplicateCandidate> = new Map();
  private duplicateAudits: Crm2DuplicateAuditLogEntry[] = [];
  private receipts: Map<string, Crm2ImportReceipt> = new Map();
  private emittedEvents: EventEnvelope<Record<string, unknown>>[] = [];

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.stages.clear();
    this.deals.clear();
    this.quotes.clear();
    this.duplicates.clear();
    this.duplicateAudits = [];
    this.receipts.clear();
    this.emittedEvents = [];

    for (const stage of createDeterministicMockStages()) {
      this.stages.set(stage.id, { ...stage });
    }
    for (const deal of createDeterministicMockDeals()) {
      this.deals.set(deal.id, { ...deal });
    }
    for (const quote of createDeterministicMockQuotes()) {
      this.quotes.set(quote.id, { ...quote });
    }
    for (const dup of createDeterministicMockCrm2Duplicates()) {
      this.duplicates.set(dup.id, { ...dup });
    }
    for (const receipt of createDeterministicMockReceipts()) {
      this.receipts.set(receipt.idempotencyKey, { ...receipt });
    }
  }

  public getEmittedEvents(): readonly EventEnvelope<Record<string, unknown>>[] {
    return this.emittedEvents;
  }

  // --- Health Probe ---

  public getHealth(): {
    status: string;
    module: string;
    name: string;
    version: string;
    timestamp: string;
  } {
    return {
      status: 'healthy',
      module: 'crm-2',
      name: 'CRM-2 Deals, Pipeline and Quotes',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  }

  // --- Pipeline Stages ---

  public getStages(): Stage[] {
    return Array.from(this.stages.values()).sort((a, b) => a.order - b.order);
  }

  public getStageById(id: string): Stage | null {
    return this.stages.get(id) ?? null;
  }

  public getStageByName(name: Crm2StageName): Stage | null {
    for (const stage of this.stages.values()) {
      if (stage.name === name) return stage;
    }
    return null;
  }

  // --- Deals ---

  public getDeals(query?: DealsQuery): {
    items: Deal[];
    pagination: {
      page: number;
      pageSize: number;
      totalCount: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } {
    let all = Array.from(this.deals.values());

    if (query?.search) {
      const q = query.search.toLowerCase().trim();
      all = all.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          (d.contact_name?.toLowerCase().includes(q) ?? false) ||
          (d.source_id?.toLowerCase().includes(q) ?? false)
      );
    }

    if (query?.stage) {
      assertValidStageName(query.stage);
      all = all.filter((d) => d.stage_name === query.stage);
    }

    if (query?.is_orphan !== undefined) {
      all = all.filter((d) => d.is_orphan === query.is_orphan);
    }

    if (query?.source_system) {
      all = all.filter((d) => d.source_system === query.source_system);
    }

    // Sorting
    const sortField = query?.sort ?? 'created_at';
    const sortOrder = query?.order ?? 'asc';
    all.sort((a, b) => {
      let valA: unknown = (a as Record<string, unknown>)[sortField] ?? '';
      let valB: unknown = (b as Record<string, unknown>)[sortField] ?? '';

      if (sortField === 'value') {
        const numA = parseFloat(String(valA)) || 0;
        const numB = parseFloat(String(valB)) || 0;
        return sortOrder === 'asc' ? numA - numB : numB - numA;
      }

      const strA = String(valA);
      const strB = String(valB);
      return sortOrder === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
    });

    const page = Math.max(1, query?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query?.pageSize ?? query?.limit ?? 10));
    const totalCount = all.length;
    const totalPages = Math.ceil(totalCount / pageSize) || 1;
    const offset = (page - 1) * pageSize;
    const items = all.slice(offset, offset + pageSize);

    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    return {
      items,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages,
        hasNextPage,
        hasPreviousPage,
      },
      total: totalCount,
      page,
      pageSize,
      totalPages,
    };
  }

  public getDealById(id: string): Deal | null {
    return this.deals.get(id) ?? null;
  }

  public createDeal(input: CreateDealInput): Deal {
    CreateDealInputSchema.parse(input);

    let stage: Stage | null = null;
    if (input.stage_name) {
      assertValidStageName(input.stage_name);
      stage = this.getStageByName(input.stage_name);
    } else {
      stage = this.getStageByName('New');
    }

    if (!stage) {
      stage = this.getStageByName('New')!;
    }

    const contactId = input.contact_id?.trim() || null;
    const isOrphan = contactId === null;
    const now = new Date().toISOString();

    const deal: Deal = {
      id: randomUUID(),
      name: input.name.trim(),
      contact_id: contactId,
      contact_name: contactId ? `Contact (${contactId.slice(0, 8)})` : null,
      value: input.value,
      currency: input.currency ?? 'USD',
      stage_id: stage.id,
      stage_name: stage.name,
      close_date: input.close_date,
      is_orphan: isOrphan,
      source_system: input.source_system ?? 'manual',
      source_id: input.source_id ?? null,
      created_at: now,
      updated_at: now,
    };

    this.deals.set(deal.id, deal);
    return deal;
  }

  public updateDeal(id: string, input: UpdateDealInput): Deal {
    UpdateDealInputSchema.parse(input);

    const existing = this.deals.get(id);
    if (!existing) {
      throw new Error(`Deal '${id}' not found`);
    }

    let targetStageName = existing.stage_name;
    let targetStageId = existing.stage_id;

    if (input.stage_name) {
      assertValidStageName(input.stage_name);
      const stage = this.getStageByName(input.stage_name);
      if (!stage) {
        throw new Error(`Stage '${input.stage_name}' not found`);
      }
      // Enforce strict state transition invariants
      assertDealStageTransition(existing.stage_name, stage.name);
      targetStageName = stage.name;
      targetStageId = stage.id;
    }

    let contactId = existing.contact_id;
    let isOrphan = existing.is_orphan;
    if (input.contact_id !== undefined) {
      contactId = input.contact_id ? input.contact_id.trim() : null;
      isOrphan = contactId === null;
    }

    const updated: Deal = {
      ...existing,
      name: input.name !== undefined ? input.name.trim() : existing.name,
      contact_id: contactId,
      contact_name: contactId ? existing.contact_name ?? `Contact (${contactId.slice(0, 8)})` : null,
      value: input.value !== undefined ? input.value : existing.value,
      currency: input.currency !== undefined ? input.currency : existing.currency,
      stage_id: targetStageId,
      stage_name: targetStageName,
      close_date: input.close_date !== undefined ? input.close_date : existing.close_date,
      is_orphan: isOrphan,
      updated_at: new Date().toISOString(),
    };

    this.deals.set(id, updated);

    // If transitioned to Won, emit canonical deal.won event (FR-CRM2-08)
    if (existing.stage_name !== 'Won' && targetStageName === 'Won') {
      const wonPayload: DealWonPayload = {
        dealId: updated.id,
        dealName: updated.name,
        name: updated.name,
        customerId: updated.contact_id,
        contactId: updated.contact_id,
        amount: updated.value,
        value: updated.value,
        currency: updated.currency,
        closeDate: updated.close_date,
        stageName: 'Won',
        wonAt: updated.updated_at,
      };
      const event = createDealWonEvent(wonPayload, {
        correlationId: `corr-deal-won-${updated.id.slice(0, 8)}`,
      });
      this.emittedEvents.push(event);
    }

    return updated;
  }

  public deleteDeal(id: string): { success: boolean; id: string } {
    const existing = this.deals.get(id);
    if (!existing) {
      throw new Error(`Deal '${id}' not found`);
    }

    // Cross-entity relational integrity invariant: cannot delete deal with active quotes
    const linkedQuotes = Array.from(this.quotes.values()).filter((q) => q.deal_id === id);
    if (linkedQuotes.length > 0) {
      const err = new Error(
        `Cannot delete deal '${id}' because it has ${linkedQuotes.length} active quote(s)`
      ) as Error & { code: string; statusCode: number };
      err.code = 'DEAL_HAS_LINKED_QUOTES';
      err.statusCode = 409;
      throw err;
    }

    this.deals.delete(id);
    return { success: true, id };
  }

  // --- Quotes ---

  public getQuotes(query?: QuotesQuery): {
    items: Quote[];
    pagination: {
      page: number;
      pageSize: number;
      totalCount: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } {
    let all = Array.from(this.quotes.values());

    if (query?.deal_id) {
      all = all.filter((q) => q.deal_id === query.deal_id);
    }

    const searchQuery = (query as Record<string, unknown> | undefined)?.['search'];
    if (typeof searchQuery === 'string' && searchQuery.trim().length > 0) {
      const s = searchQuery.toLowerCase().trim();
      all = all.filter(
        (q) =>
          q.quote_number.toLowerCase().includes(s) ||
          (q.note?.toLowerCase().includes(s) ?? false)
      );
    }

    all.sort((a, b) => b.created_at.localeCompare(a.created_at));

    const page = Math.max(1, query?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query?.pageSize ?? query?.limit ?? 10));
    const totalCount = all.length;
    const totalPages = Math.ceil(totalCount / pageSize) || 1;
    const offset = (page - 1) * pageSize;
    const items = all.slice(offset, offset + pageSize);

    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    return {
      items,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages,
        hasNextPage,
        hasPreviousPage,
      },
      total: totalCount,
      page,
      pageSize,
      totalPages,
    };
  }

  public getQuoteById(id: string): Quote | null {
    return this.quotes.get(id) ?? null;
  }

  public createQuote(input: Partial<CreateQuoteInput> & { deal_id: string; amount: string }): Quote {
    const today = new Date().toISOString().slice(0, 10);
    const quoteNumber = input.quote_number
      ? normalizeQuoteNumber(input.quote_number)
      : `Q-${new Date().getFullYear()}-${String(this.quotes.size + 1).padStart(3, '0')}`;
    const date = input.date ?? today;
    const currency = input.currency ?? 'USD';

    CreateQuoteInputSchema.parse({
      deal_id: input.deal_id,
      quote_number: quoteNumber,
      date,
      amount: input.amount,
      currency,
      note: input.note ?? null,
    });

    const deal = this.deals.get(input.deal_id);
    if (!deal) {
      const err = new Error(
        `Referential Integrity Error: Target deal '${input.deal_id}' does not exist`
      ) as Error & { code: string; statusCode: number };
      err.code = 'DEAL_NOT_FOUND';
      err.statusCode = 422;
      throw err;
    }

    // Verify quote number uniqueness (BR-CRM2-DUP-03)
    for (const q of this.quotes.values()) {
      if (normalizeQuoteNumber(q.quote_number) === quoteNumber) {
        const err = new Error(
          `Duplicate Error: Quote number '${quoteNumber}' already exists`
        ) as Error & { code: string; statusCode: number };
        err.code = 'DUPLICATE_QUOTE_NUMBER';
        err.statusCode = 409;
        throw err;
      }
    }

    const now = new Date().toISOString();

    const quote: Quote = {
      id: randomUUID(),
      deal_id: input.deal_id,
      quote_number: quoteNumber,
      date,
      amount: input.amount,
      currency,
      note: input.note?.trim() ?? null,
      created_at: now,
      updated_at: now,
    };

    this.quotes.set(quote.id, quote);
    return quote;
  }

  public updateQuote(id: string, input: UpdateQuoteInput): Quote {
    UpdateQuoteInputSchema.parse(input);

    const existing = this.quotes.get(id);
    if (!existing) {
      throw new Error(`Quote '${id}' not found`);
    }

    let quoteNumber = existing.quote_number;
    if (input.quote_number) {
      quoteNumber = normalizeQuoteNumber(input.quote_number);
      for (const [qid, q] of this.quotes.entries()) {
        if (qid !== id && normalizeQuoteNumber(q.quote_number) === quoteNumber) {
          const err = new Error(
            `Duplicate Error: Quote number '${quoteNumber}' already exists`
          ) as Error & { code: string; statusCode: number };
          err.code = 'DUPLICATE_QUOTE_NUMBER';
          err.statusCode = 409;
          throw err;
        }
      }
    }

    const updated: Quote = {
      ...existing,
      quote_number: quoteNumber,
      date: input.date ?? existing.date,
      amount: input.amount ?? existing.amount,
      currency: input.currency ?? existing.currency,
      note: input.note !== undefined ? input.note?.trim() ?? null : existing.note,
      updated_at: new Date().toISOString(),
    };

    this.quotes.set(id, updated);
    return updated;
  }

  public deleteQuote(id: string): { success: boolean; id: string } {
    const existing = this.quotes.get(id);
    if (!existing) {
      throw new Error(`Quote '${id}' not found`);
    }
    this.quotes.delete(id);
    return { success: true, id };
  }

  // --- Migration & Batch Ingestion ---

  public importRow(input: any): {
    receiptId: string;
    status: string;
    targetId: string;
    entity: string;
    idempotencyKey: string;
    receipt?: Crm2ImportReceipt;
    isExisting?: boolean;
  } {
    const rawRow = input?.row ?? input;
    const sourceSystem = input?.sourceSystem ?? rawRow?.sourceSystem ?? 'kit_import';
    const sourceId = String(rawRow?.sourceId ?? rawRow?.data?.sourceId ?? randomUUID());
    const idempotencyKey =
      input?.idempotencyKey ??
      rawRow?.idempotencyKey ??
      `crm2-${sourceSystem}-${sourceId}`;

    const existingReceipt = this.receipts.get(idempotencyKey);
    if (existingReceipt) {
      return {
        receiptId: existingReceipt.id,
        status: 'deduplicated',
        targetId: existingReceipt.targetId,
        entity: existingReceipt.entity,
        idempotencyKey,
        receipt: existingReceipt,
        isExisting: true,
      };
    }

    const targetId = randomUUID();
    const receipt: Crm2ImportReceipt = {
      id: randomUUID(),
      batchId: rawRow?.batchId ?? 'batch-import-row',
      sourceRow: rawRow?.sourceRow ?? 1,
      entity: rawRow?.entity ?? 'deal',
      sourceSystem,
      sourceId,
      targetId,
      idempotencyKey,
      payloadHash: 'hash-' + randomUUID(),
      outcome: 'created',
      createdAt: new Date().toISOString(),
    };
    this.receipts.set(idempotencyKey, receipt);

    return {
      receiptId: receipt.id,
      status: 'created',
      targetId,
      entity: receipt.entity,
      idempotencyKey,
      receipt,
      isExisting: false,
    };
  }

  public importBatch(input: {
    batchId: string;
    sourceSystem?: string;
    rows: any[];
  }): {
    batchId: string;
    totalRows: number;
    loadedCount: number;
    rejectedCount: number;
    receipts: Crm2ImportReceipt[];
    loaded: Array<{ targetId: string; receipt: Crm2ImportReceipt; isExisting: boolean }>;
    errors: Array<{ sourceRow: number; error: { reasonCode: string; message: string; field?: string } }>;
  } {
    let loadedCount = 0;
    let rejectedCount = 0;
    const receipts: Crm2ImportReceipt[] = [];
    const loaded: Array<{ targetId: string; receipt: Crm2ImportReceipt; isExisting: boolean }> = [];
    const errors: Array<{ sourceRow: number; error: { reasonCode: string; message: string; field?: string } }> = [];

    const sourceSystem = input.sourceSystem ?? 'kit_import';

    for (let i = 0; i < input.rows.length; i++) {
      const rawRow = input.rows[i];
      if (!rawRow || typeof rawRow !== 'object') {
        rejectedCount++;
        errors.push({
          sourceRow: i + 1,
          error: { reasonCode: 'INVALID_ROW', message: 'Row must be an object' },
        });
        continue;
      }

      const rowSourceSystem = rawRow.sourceSystem ?? sourceSystem;
      const sourceId = String(rawRow.sourceId ?? rawRow.data?.sourceId ?? i + 1);
      const idempotencyKey = rawRow.idempotencyKey ?? `crm2-${rowSourceSystem}-${sourceId}`;

      const existing = this.receipts.get(idempotencyKey);
      if (existing) {
        receipts.push(existing);
        loaded.push({ targetId: existing.targetId, receipt: existing, isExisting: true });
        loadedCount++;
        continue;
      }

      const targetId = randomUUID();
      const receipt: Crm2ImportReceipt = {
        id: randomUUID(),
        batchId: input.batchId,
        sourceRow: rawRow.sourceRow ?? i + 1,
        entity: rawRow.entity ?? 'deal',
        sourceSystem: rowSourceSystem,
        sourceId,
        targetId,
        idempotencyKey,
        payloadHash: 'hash-' + randomUUID(),
        outcome: 'created',
        createdAt: new Date().toISOString(),
      };
      this.receipts.set(idempotencyKey, receipt);
      receipts.push(receipt);
      loaded.push({ targetId, receipt, isExisting: false });
      loadedCount++;
    }

    return {
      batchId: input.batchId,
      totalRows: input.rows.length,
      loadedCount,
      rejectedCount,
      receipts,
      loaded,
      errors,
    };
  }

  public getImportReceipts(): { items: Crm2ImportReceipt[]; total: number } {
    const items = Array.from(this.receipts.values());
    return { items, total: items.length };
  }

  public getImportReceipt(idempotencyKey: string): Crm2ImportReceipt | null {
    return this.receipts.get(idempotencyKey) ?? null;
  }

  public executeBatchLoad(input: Crm2ExecuteBatchLoadOutput): Crm2BatchExecutionReport {
    Crm2ExecuteBatchLoadInputSchema.parse(input);

    const totalRecords = input.records.length;
    let committedRecords = 0;
    let failedRecords = 0;
    const committedReceipts: Crm2BatchExecutionReport['committedReceipts'] = [];
    const failedRows: Crm2BatchExecutionReport['failedRows'] = [];

    for (const record of input.records) {
      if (!record.data || Object.keys(record.data).length === 0) {
        failedRecords++;
        failedRows.push({
          sourceRow: record.sourceRow,
          idempotencyKey: record.idempotencyKey,
          errorCode: 'EMPTY_PAYLOAD',
          errorMessage: 'Record payload contains zero valid attributes',
          retryAttempts: 1,
        });
      } else {
        committedRecords++;
        const targetId = randomUUID();
        committedReceipts.push({
          batchId: input.batchId,
          sourceRow: record.sourceRow,
          idempotencyKey: record.idempotencyKey,
          targetId,
          kind: 'created',
          committedAt: new Date(),
        });
      }
    }

    const failureRate = totalRecords > 0 ? failedRecords / totalRecords : 0;
    const status =
      failureRate > input.failureThreshold && totalRecords >= input.minAttemptedRows
        ? 'STOPPED_EXCESSIVE_FAILURES'
        : failedRecords > 0
        ? 'FAILED'
        : 'COMPLETED';

    return {
      batchId: input.batchId,
      module: input.module,
      step: input.step,
      status,
      totalRecords,
      attemptedRecords: totalRecords,
      committedRecords,
      failedRecords,
      chunksProcessed: Math.ceil(totalRecords / input.chunkSize) || 1,
      chunkSize: input.chunkSize,
      failureRate,
      haltReason: status === 'STOPPED_EXCESSIVE_FAILURES' ? 'Failure rate exceeded 10% threshold' : null,
      committedReceipts,
      failedRows,
      executedAt: new Date(),
    };
  }

  // --- Deduplication ---

  public detectDuplicates(input: Crm2DetectDuplicatesInput): {
    totalRecords: number;
    duplicateGroupsCount: number;
    candidates: Crm2DuplicateCandidate[];
  } {
    Crm2DetectDuplicatesInputSchema.parse(input);

    const groups = new Map<string, string[]>();
    for (const record of input.records) {
      const existing = groups.get(record.keyValue) ?? [];
      existing.push(record.id);
      groups.set(record.keyValue, existing);
    }

    const candidates: Crm2DuplicateCandidate[] = [];
    for (const [keyValue, recordIds] of groups.entries()) {
      if (recordIds.length > 1) {
        const candidate: Crm2DuplicateCandidate = {
          id: randomUUID(),
          batchId: input.batchId,
          module: 'crm-2',
          entity: input.entity,
          keyType: input.keyType,
          normalizedKey: keyValue,
          recordIds,
          status: 'held_for_review',
          detectedAt: new Date(),
          metadata: { totalDuplicateCount: recordIds.length },
        };
        this.duplicates.set(candidate.id, candidate);
        candidates.push(candidate);
      }
    }

    return {
      totalRecords: input.records.length,
      duplicateGroupsCount: candidates.length,
      candidates,
    };
  }

  public getHeldDuplicates(filter?: {
    batchId?: string;
    keyType?: string;
    entity?: string;
  }): Crm2DuplicateCandidate[] {
    let items = Array.from(this.duplicates.values()).filter(
      (d) => d.status === 'held_for_review'
    );
    if (filter?.batchId) items = items.filter((d) => d.batchId === filter.batchId);
    if (filter?.keyType) items = items.filter((d) => d.keyType === filter.keyType);
    if (filter?.entity) items = items.filter((d) => d.entity === filter.entity);
    return items;
  }

  public resolveDuplicate(input: Crm2ResolveDuplicateInput): Crm2DuplicateAuditLogEntry {
    Crm2ResolveDuplicateInputSchema.parse(input);

    const candidate = this.duplicates.get(input.candidateId);
    if (!candidate) {
      throw new Error(`Duplicate candidate '${input.candidateId}' not found`);
    }

    candidate.status = 'resolved';

    const audit: Crm2DuplicateAuditLogEntry = {
      id: randomUUID(),
      candidateId: input.candidateId,
      entity: candidate.entity,
      decision: input.decision,
      actorId: input.actorId,
      timestamp: new Date(),
      keptId: input.keptId,
      mergedId: input.mergedId,
      reason: input.reason,
      keyType: candidate.keyType,
      normalizedKey: candidate.normalizedKey,
      metadata: input.metadata,
    };

    this.duplicateAudits.push(audit);
    return audit;
  }

  public getDuplicateAuditLogs(query?: {
    candidateId?: string;
    actorId?: string;
    entity?: string;
    page?: number;
    pageSize?: number;
  }): {
    items: Crm2DuplicateAuditLogEntry[];
    total: number;
    page: number;
    pageSize: number;
  } {
    let all = [...this.duplicateAudits];
    if (query?.candidateId) all = all.filter((a) => a.candidateId === query.candidateId);
    if (query?.actorId) all = all.filter((a) => a.actorId === query.actorId);
    if (query?.entity) all = all.filter((a) => a.entity === query.entity);

    const page = Math.max(1, query?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query?.pageSize ?? 25));
    const offset = (page - 1) * pageSize;
    const items = all.slice(offset, offset + pageSize);

    return {
      items,
      total: all.length,
      page,
      pageSize,
    };
  }

  public evaluateDealDuplicate(input: Crm2EvaluateDealDuplicateInput) {
    Crm2EvaluateDealDuplicateInputSchema.parse(input);
    const existingDeals = Array.from(this.deals.values()).map((d) => ({
      id: d.id,
      name: d.name,
      stageId: d.stage_id,
      stageName: d.stage_name,
      contactId: d.contact_id,
      value: d.value,
      currency: d.currency,
      sourceSystem: d.source_system,
      sourceId: d.source_id,
    }));
    const result = evaluateDealDuplicate(input, existingDeals);
    return {
      ...result,
      isDuplicate: result.outcome !== 'NO_MATCH',
    };
  }

  public evaluateQuoteDuplicate(input: Crm2EvaluateQuoteDuplicateInput) {
    Crm2EvaluateQuoteDuplicateInputSchema.parse(input);
    const existingQuotes = Array.from(this.quotes.values()).map((q) => ({
      id: q.id,
      quoteNumber: q.quote_number,
      dealId: q.deal_id,
      amount: q.amount,
      currency: q.currency,
    }));
    const result = evaluateQuoteDuplicate(input, existingQuotes);
    return {
      ...result,
      isDuplicate: result.outcome !== 'NO_MATCH',
    };
  }
}

export const Crm2MockStore = CRM2MockStore;

// ---------------------------------------------------------------------------
// 3. Fastify Mock Server Plugin Mounting All CRM-2 Routes
// ---------------------------------------------------------------------------

export interface CRM2MockPluginOptions {
  store?: CRM2MockStore | undefined;
  prefix?: string | undefined;
}

export const crm2MockPlugin: FastifyPluginAsync<CRM2MockPluginOptions> = async (
  fastify,
  opts
) => {
  const store = opts.store ?? new CRM2MockStore();

  const registerRoutes = async (app: typeof fastify) => {
    // 0. GET /health
    app.get('/health', async (_req, reply) => {
      const health = store.getHealth();
      return reply.status(200).send(health);
    });

    // 1. GET /stages
    app.get('/stages', async (_req, reply) => {
      const stages = store.getStages();
      return reply.status(200).send({ items: stages });
    });

    // 2. GET /deals
    app.get('/deals', async (req, reply) => {
      const parsed = DealsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid query parameters for deals list',
            details: parsed.error.issues,
          })
        );
      }
      const result = store.getDeals(parsed.data);
      return reply.status(200).send(result);
    });

    // 3. POST /deals
    app.post('/deals', async (req, reply) => {
      const parsed = CreateDealInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid deal payload',
            details: parsed.error.issues,
          })
        );
      }
      try {
        const created = store.createDeal(parsed.data);
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

    // 4. GET /deals/:id
    app.get<{ Params: { id: string } }>('/deals/:id', async (req, reply) => {
      const deal = store.getDealById(req.params.id);
      if (!deal) {
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message: `Deal '${req.params.id}' not found`,
          })
        );
      }
      return reply.status(200).send(deal);
    });

    // 5. PATCH /deals/:id
    app.patch<{ Params: { id: string } }>('/deals/:id', async (req, reply) => {
      const parsed = UpdateDealInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid deal update payload',
            details: parsed.error.issues,
          })
        );
      }
      try {
        const updated = store.updateDeal(req.params.id, parsed.data);
        return reply.status(200).send(updated);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const isNotFound = message.includes('not found');
        const isTransitionViolation =
          message.includes('cannot transition') || message.includes('not permitted');
        const statusCode = isNotFound ? 404 : isTransitionViolation ? 422 : 400;
        return reply.status(statusCode).send(
          createErrorEnvelope({
            code: isNotFound
              ? StandardErrorCodes.NOT_FOUND
              : isTransitionViolation
              ? 'INVALID_DEAL_STAGE_TRANSITION'
              : StandardErrorCodes.BAD_REQUEST,
            message,
          })
        );
      }
    });

    // 6. DELETE /deals/:id
    app.delete<{ Params: { id: string } }>('/deals/:id', async (req, reply) => {
      try {
        const result = store.deleteDeal(req.params.id);
        return reply.status(200).send(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const isNotFound = message.includes('not found');
        const isConflict = message.includes('Cannot delete deal');
        const statusCode = isNotFound ? 404 : isConflict ? 409 : 400;
        return reply.status(statusCode).send(
          createErrorEnvelope({
            code: isNotFound
              ? StandardErrorCodes.NOT_FOUND
              : isConflict
              ? StandardErrorCodes.CONFLICT
              : StandardErrorCodes.BAD_REQUEST,
            message,
          })
        );
      }
    });

    // 7. GET /quotes
    app.get('/quotes', async (req, reply) => {
      const parsed = QuotesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid query parameters for quotes list',
            details: parsed.error.issues,
          })
        );
      }
      const result = store.getQuotes(parsed.data);
      return reply.status(200).send(result);
    });

    // 8. POST /quotes
    app.post('/quotes', async (req, reply) => {
      const body = req.body as any;
      if (!body || typeof body !== 'object' || !body.deal_id || !body.amount) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'deal_id and amount are required for creating quote',
          })
        );
      }
      try {
        const created = store.createQuote(body);
        return reply.status(201).send(created);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const isConflict = message.includes('already exists');
        const isNotFound = message.includes('does not exist');
        const statusCode = isConflict ? 409 : isNotFound ? 422 : 400;
        return reply.status(statusCode).send(
          createErrorEnvelope({
            code: isConflict
              ? StandardErrorCodes.CONFLICT
              : isNotFound
              ? 'DEAL_NOT_FOUND'
              : StandardErrorCodes.BAD_REQUEST,
            message,
          })
        );
      }
    });

    // 9. GET /quotes/:id
    app.get<{ Params: { id: string } }>('/quotes/:id', async (req, reply) => {
      const quote = store.getQuoteById(req.params.id);
      if (!quote) {
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message: `Quote '${req.params.id}' not found`,
          })
        );
      }
      return reply.status(200).send(quote);
    });

    // 10. PATCH /quotes/:id
    app.patch<{ Params: { id: string } }>('/quotes/:id', async (req, reply) => {
      const parsed = UpdateQuoteInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid quote update payload',
            details: parsed.error.issues,
          })
        );
      }
      try {
        const updated = store.updateQuote(req.params.id, parsed.data);
        return reply.status(200).send(updated);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const isNotFound = message.includes('not found');
        const isConflict = message.includes('already exists');
        const statusCode = isNotFound ? 404 : isConflict ? 409 : 400;
        return reply.status(statusCode).send(
          createErrorEnvelope({
            code: isNotFound
              ? StandardErrorCodes.NOT_FOUND
              : isConflict
              ? StandardErrorCodes.CONFLICT
              : StandardErrorCodes.BAD_REQUEST,
            message,
          })
        );
      }
    });

    // 11. DELETE /quotes/:id
    app.delete<{ Params: { id: string } }>('/quotes/:id', async (req, reply) => {
      try {
        const result = store.deleteQuote(req.params.id);
        return reply.status(200).send(result);
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

    // 12. POST /import & POST /import/row
    const handleImportRow = async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as any;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Missing import row payload',
          })
        );
      }
      try {
        const result = store.importRow(body);
        return reply.status(200).send(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.BAD_REQUEST,
            message,
          })
        );
      }
    };
    app.post('/import', handleImportRow);
    app.post('/import/row', handleImportRow);

    // 13. POST /import/batch
    app.post('/import/batch', async (req, reply) => {
      const body = req.body as {
        batchId: string;
        sourceSystem: string;
        rows: Crm2ImportRow[];
      };
      if (!body || !body.batchId || !Array.isArray(body.rows)) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid import batch payload',
          })
        );
      }
      const result = store.importBatch(body);
      return reply.status(200).send(result);
    });

    // 14. GET /import/receipts & GET /import/receipts/:idempotencyKey
    app.get('/import/receipts', async (_req, reply) => {
      const result = store.getImportReceipts();
      return reply.status(200).send(result);
    });

    app.get<{ Params: { idempotencyKey: string } }>(
      '/import/receipts/:idempotencyKey',
      async (req, reply) => {
        const receipt = store.getImportReceipt(req.params.idempotencyKey);
        if (!receipt) {
          return reply.status(404).send(
            createErrorEnvelope({
              code: StandardErrorCodes.NOT_FOUND,
              message: `Receipt with idempotency key '${req.params.idempotencyKey}' not found`,
            })
          );
        }
        return reply.status(200).send(receipt);
      }
    );

    // 15. POST /batches/execute-load
    app.post('/batches/execute-load', async (req, reply) => {
      const parsed = Crm2ExecuteBatchLoadInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid batch load payload',
            details: parsed.error.issues,
          })
        );
      }
      const report = store.executeBatchLoad(parsed.data);
      return reply.status(200).send(report);
    });

    // 16. POST /duplicates/detect
    app.post('/duplicates/detect', async (req, reply) => {
      const parsed = Crm2DetectDuplicatesInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid duplicate detection payload',
            details: parsed.error.issues,
          })
        );
      }
      const result = store.detectDuplicates(parsed.data);
      return reply.status(200).send(result);
    });

    // 17. GET /duplicates/held
    app.get<{ Querystring: { batchId?: string; keyType?: string; entity?: string } }>(
      '/duplicates/held',
      async (req, reply) => {
        const items = store.getHeldDuplicates(req.query);
        return reply.status(200).send({ items, total: items.length });
      }
    );

    // 18. POST /duplicates/resolve
    app.post('/duplicates/resolve', async (req, reply) => {
      const parsed = Crm2ResolveDuplicateInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid duplicate resolution payload',
            details: parsed.error.issues,
          })
        );
      }
      try {
        const audit = store.resolveDuplicate(parsed.data);
        return reply.status(200).send({ status: 'resolved', audit });
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

    // 19. GET /duplicates/audit
    app.get<{
      Querystring: {
        candidateId?: string;
        actorId?: string;
        entity?: string;
        page?: number;
        pageSize?: number;
      };
    }>('/duplicates/audit', async (req, reply) => {
      const logs = store.getDuplicateAuditLogs(req.query);
      return reply.status(200).send(logs);
    });

    // 20. POST /deals/evaluate-duplicate
    app.post('/deals/evaluate-duplicate', async (req, reply) => {
      const parsed = Crm2EvaluateDealDuplicateInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid deal candidate payload',
            details: parsed.error.issues,
          })
        );
      }
      const evaluation = store.evaluateDealDuplicate(parsed.data);
      return reply.status(200).send(evaluation);
    });

    // 21. POST /quotes/evaluate-duplicate
    app.post('/quotes/evaluate-duplicate', async (req, reply) => {
      const parsed = Crm2EvaluateQuoteDuplicateInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid quote candidate payload',
            details: parsed.error.issues,
          })
        );
      }
      const evaluation = store.evaluateQuoteDuplicate(parsed.data);
      return reply.status(200).send(evaluation);
    });
  };

  if (fastify.prefix && fastify.prefix.length > 0) {
    await registerRoutes(fastify);
  } else {
    await fastify.register(registerRoutes, {
      prefix: opts.prefix ?? CRM2_API_PREFIX,
    });
  }
};

export const crm2MockServerPlugin = crm2MockPlugin;
