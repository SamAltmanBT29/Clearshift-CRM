import { createHash, randomUUID } from 'node:crypto';
import {
  type Deal,
  type Stage,
  type Quote,
  type QuoteLine,
  type DealsQuery,
  type DealsListResponse,
  type CreateDealInput,
  type UpdateDealInput,
  type QuotesQuery,
  type QuotesListResponse,
  type CreateQuoteInput,
  type UpdateQuoteInput,
  type CreateQuoteLineInput,
  type Crm2StageName,
  type Crm2ImportRow,
  type Crm2ImportReceipt,
  CRM2_STAGE_SEEDS,
  CRM2_STAGES,
  assertValidStageName,
  CreateDealInputSchema,
  UpdateDealInputSchema,
  CreateQuoteInputSchema,
  UpdateQuoteInputSchema,
  CreateQuoteLineInputSchema,
  DealsQuerySchema,
  QuotesQuerySchema,
  Crm2ImportRowSchema,
} from '@clearshift/contracts';
import type { ReferenceResolver } from '@cs/kernel';
import {
  DealNotFoundError,
  QuoteNotFoundError,
  DomainValidationError,
  IdempotencyConflictError,
  IdempotencyKeyReusedError,
} from '../domain/errors.js';
import {
  assertDealStageTransition,
  assertValidContactReference,
  assertValidDealReference,
  assertValidQuoteNumber,
  isOrphanDeal,
  calculateDealDerivedTotals,
  calculatePipelineSummary,
  sanitizeDealUserEdit,
  sanitizeQuoteUserEdit,
  type DealDerivedTotals,
  type PipelineSummary,
} from '../domain/relationships.js';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

function requestDigest(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(input))).digest('hex');
}

export interface Crm2ServiceOptions {
  contactResolver?: ReferenceResolver;
}

/**
 * Default fallback ReferenceResolver for CRM-1 contacts when running in standalone mode.
 */
class DefaultSyntheticContactResolver implements ReferenceResolver {
  private knownContacts = new Map<string, { firstName: string; lastName: string }>([
    ['90000000-0000-4000-8000-000000000001', { firstName: 'Sarah', lastName: 'Connor' }],
    ['90000000-0000-4000-8000-000000000002', { firstName: 'Lars', lastName: 'Lindqvist' }],
    ['cnt-1234', { firstName: 'Jane', lastName: 'Doe' }],
  ]);

  async exists(entityType: string, id: string): Promise<boolean> {
    if (entityType === 'contact') {
      return this.knownContacts.has(id);
    }
    return false;
  }

  async get<T = unknown>(entityType: string, id: string): Promise<T | null> {
    if (entityType === 'contact') {
      const contact = this.knownContacts.get(id);
      if (contact) {
        return {
          id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: `${contact.firstName.toLowerCase()}@example.test`,
        } as unknown as T;
      }
    }
    return null;
  }

  registerContact(id: string, firstName: string, lastName: string) {
    this.knownContacts.set(id, { firstName, lastName });
  }
}

/**
 * CRM-2 Deals, Pipeline and Quotes Service
 * Authoritative business logic, state machine transitions, referential integrity,
 * and read-model projections.
 */
export class Crm2Service {
  private stages: Stage[] = [];
  private deals: Deal[] = [];
  private quotes: Quote[] = [];
  private quoteLines: QuoteLine[] = [];
  private importReceipts: Crm2ImportReceipt[] = [];
  private contactResolver: ReferenceResolver;

  constructor(options: Crm2ServiceOptions = {}) {
    this.contactResolver = options.contactResolver ?? new DefaultSyntheticContactResolver();
    this.seedSyntheticData();
  }

  public setContactResolver(resolver: ReferenceResolver): void {
    this.contactResolver = resolver;
  }

  public getContactResolver(): ReferenceResolver {
    return this.contactResolver;
  }

  public resetStore(): void {
    this.importReceipts = [];
    this.quoteLines = [];
    this.seedSyntheticData();
  }

  public seedSyntheticData(): void {
    // 1. Seed stages per SDS
    const now = '2026-10-01T00:00:00Z';
    this.stages = CRM2_STAGE_SEEDS.map((s) => ({
      id: s.id,
      name: s.name,
      order: s.order,
      is_closed_won: s.is_closed_won,
      is_closed_lost: s.is_closed_lost,
      created_at: now,
      updated_at: now,
    }));

    // 2. Seed synthetic deals (deterministic fixtures per issue #19 / #21)
    this.deals = [
      {
        id: '20000000-0000-4000-8000-000000000001',
        name: 'Acme Cloud Modernization',
        contact_id: '90000000-0000-4000-8000-000000000001',
        contact_name: 'Sarah Connor',
        value: '75000.00',
        currency: 'USD',
        stage_id: '00000000-0000-4000-8000-000000000003',
        stage_name: 'Proposal',
        close_date: '2026-11-30',
        is_orphan: false,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      },
      {
        id: '20000000-0000-4000-8000-000000000002',
        name: 'Inbound Enterprise Lead [Orphan Deal]',
        contact_id: null, // Null contact creates orphan deal
        contact_name: null,
        value: '125000.00',
        currency: 'USD',
        stage_id: '00000000-0000-4000-8000-000000000001',
        stage_name: 'New',
        close_date: '2026-12-15',
        is_orphan: true,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      },
      {
        id: '20000000-0000-4000-8000-000000000003',
        name: 'Nordic Retail POS Upgrade',
        contact_id: '90000000-0000-4000-8000-000000000002',
        contact_name: 'Lars Lindqvist',
        value: '42500.50',
        currency: 'EUR',
        stage_id: '00000000-0000-4000-8000-000000000002',
        stage_name: 'Qualified',
        close_date: '2026-11-20',
        is_orphan: false,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      },
    ];

    // 3. Seed synthetic quotes
    this.quotes = [
      {
        id: '30000000-0000-4000-8000-000000000001',
        deal_id: '20000000-0000-4000-8000-000000000001',
        deal_name: 'Acme Cloud Modernization',
        quote_number: 'Q-2026-001',
        date: '2026-10-15',
        amount: '75000.00',
        currency: 'USD',
        note: 'Tier-1 Package',
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      },
    ];
  }

  /**
   * Seeds additional deterministic synthetic fixtures for pagination, sorting, and bounded limit testing.
   */
  public seedPaginationFixtures(count = 32): void {
    this.seedSyntheticData();
    const stageNames: Crm2StageName[] = [
      'New',
      'Qualified',
      'Proposal',
      'Negotiation',
      'Won',
      'Lost',
    ];
    const currencies = ['USD', 'EUR', 'GBP'];

    for (let i = 4; i <= count; i++) {
      const stageName = stageNames[(i - 1) % stageNames.length]!;
      const stageSeed = this.stages.find((s) => s.name === stageName)!;
      const isOrphan = i % 3 === 0;
      const contactId = isOrphan
        ? null
        : i % 2 === 0
          ? '90000000-0000-4000-8000-000000000001'
          : '90000000-0000-4000-8000-000000000002';
      const contactName = isOrphan
        ? null
        : i % 2 === 0
          ? 'Sarah Connor'
          : 'Lars Lindqvist';
      const day = String(i).padStart(2, '0');
      const hex = String(i).padStart(12, '0');

      const deal: Deal = {
        id: `20000000-0000-4000-8000-${hex}`,
        name: `Synthetic Deal #${i} [${stageName}]`,
        contact_id: contactId,
        contact_name: contactName,
        value: `${(i * 1500).toFixed(2)}`,
        currency: currencies[i % currencies.length]!,
        stage_id: stageSeed.id,
        stage_name: stageName,
        close_date: `2026-11-${day}`,
        is_orphan: isOrphan,
        created_at: `2026-10-${day}T12:00:00Z`,
        updated_at: `2026-10-${day}T12:00:00Z`,
      };
      this.deals.push(deal);

      if (i <= 20) {
        this.quotes.push({
          id: `30000000-0000-4000-8000-${hex}`,
          deal_id: deal.id,
          deal_name: deal.name,
          quote_number: `Q-2026-${String(i).padStart(3, '0')}`,
          date: `2026-10-${day}`,
          amount: `${(i * 1200).toFixed(2)}`,
          currency: deal.currency,
          note: `Commercial Scope for Deal #${i}`,
          created_at: `2026-10-${day}T12:00:00Z`,
          updated_at: `2026-10-${day}T12:00:00Z`,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Stages Read API
  // ---------------------------------------------------------------------------

  public async getStages(): Promise<Stage[]> {
    return [...this.stages].sort((a, b) => a.order - b.order);
  }

  public getStageByName(name: Crm2StageName): Stage | undefined {
    return this.stages.find((s) => s.name === name);
  }

  public getStageById(id: string): Stage | undefined {
    return this.stages.find((s) => s.id === id || s.id.endsWith(id.slice(-1)));
  }

  // ---------------------------------------------------------------------------
  // Deals API & Business Logic
  // ---------------------------------------------------------------------------

  public async getDeals(query: DealsQuery): Promise<DealsListResponse> {
    const parsedQuery = DealsQuerySchema.parse(query);
    const { page, pageSize, search, stage } = parsedQuery;

    let filtered = [...this.deals];

    if (stage) {
      filtered = filtered.filter((d) => d.stage_name === stage);
    }

    if (search && search.trim() !== '') {
      const term = search.trim().toLowerCase();
      filtered = filtered.filter((d) => {
        const nameMatch = d.name.toLowerCase().includes(term);
        const contactMatch = d.contact_name ? d.contact_name.toLowerCase().includes(term) : false;
        return nameMatch || contactMatch;
      });
    }

    // Deterministic sort: created_at desc, id asc
    filtered.sort((a, b) => {
      const timeDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });

    const totalCount = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const offset = (page - 1) * pageSize;
    const items = filtered.slice(offset, offset + pageSize);

    return {
      items,
      pagination: {
        page,
        pageSize,
        limit: pageSize,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  public async getDealById(id: string): Promise<Deal | null> {
    const deal = this.deals.find((d) => d.id === id);
    return deal ? { ...deal } : null;
  }

  public async createDeal(input: CreateDealInput): Promise<Deal> {
    const validated = CreateDealInputSchema.parse(input);
    const stageName = validated.stage_name ?? 'New';
    assertValidStageName(stageName);

    // Cross-module referential integrity: contact_id must exist in CRM-1 if provided
    await assertValidContactReference(validated.contact_id, this.contactResolver);

    let contactName: string | null = null;
    const isOrphan = isOrphanDeal(validated);

    if (!isOrphan && validated.contact_id) {
      const summary = await this.contactResolver.get<{ firstName?: string; lastName?: string }>(
        'contact',
        validated.contact_id
      );
      if (summary) {
        contactName = `${summary.firstName ?? ''} ${summary.lastName ?? ''}`.trim() || null;
      }
    }

    const stageSeed = this.stages.find((s) => s.name === stageName);
    const stageId = stageSeed ? stageSeed.id : '00000000-0000-4000-8000-000000000001';

    const now = new Date().toISOString();
    const newDeal: Deal = {
      id: randomUUID(),
      name: validated.name.trim(),
      contact_id: validated.contact_id ?? null,
      contact_name: contactName,
      value: validated.value,
      currency: validated.currency,
      stage_id: stageId,
      stage_name: stageName,
      close_date: validated.close_date,
      is_orphan: isOrphan,
      source_system: validated.source_system ?? null,
      source_id: validated.source_id ?? null,
      created_at: now,
      updated_at: now,
    };

    this.deals.unshift(newDeal);
    return { ...newDeal };
  }

  public async updateDeal(id: string, input: UpdateDealInput): Promise<Deal> {
    const sanitized = sanitizeDealUserEdit(input as Record<string, unknown>) as UpdateDealInput;
    const validated = UpdateDealInputSchema.parse(sanitized);
    const index = this.deals.findIndex((d) => d.id === id);
    if (index === -1) {
      throw new DealNotFoundError(id);
    }

    const currentDeal = this.deals[index]!;

    // 1. Enforce State Transitions if stage_name is updated
    if (validated.stage_name && validated.stage_name !== currentDeal.stage_name) {
      assertValidStageName(validated.stage_name);
      assertDealStageTransition(currentDeal.stage_name, validated.stage_name);
    }

    // 2. Validate contact reference if contact_id is provided
    let contactName = currentDeal.contact_name;
    let contactId = currentDeal.contact_id;
    let isOrphan = currentDeal.is_orphan;

    if (validated.contact_id !== undefined) {
      if (validated.contact_id === null || validated.contact_id.trim() === '') {
        contactId = null;
        contactName = null;
        isOrphan = true;
      } else {
        await assertValidContactReference(validated.contact_id, this.contactResolver);
        contactId = validated.contact_id.trim();
        isOrphan = false;
        const summary = await this.contactResolver.get<{ firstName?: string; lastName?: string }>(
          'contact',
          contactId
        );
        contactName = summary
          ? `${summary.firstName ?? ''} ${summary.lastName ?? ''}`.trim() || null
          : `Contact ${contactId.slice(0, 8)}`;
      }
    }

    const nextStageName = validated.stage_name ?? currentDeal.stage_name;
    const stageSeed = this.stages.find((s) => s.name === nextStageName);
    const stageId = stageSeed ? stageSeed.id : currentDeal.stage_id;

    const updatedDeal: Deal = {
      ...currentDeal,
      name: validated.name !== undefined ? validated.name.trim() : currentDeal.name,
      contact_id: contactId,
      contact_name: contactName,
      value: validated.value !== undefined ? validated.value : currentDeal.value,
      currency: validated.currency !== undefined ? validated.currency : currentDeal.currency,
      stage_id: stageId,
      stage_name: nextStageName,
      close_date: validated.close_date !== undefined ? validated.close_date : currentDeal.close_date,
      is_orphan: isOrphan,
      updated_at: new Date().toISOString(),
    };

    this.deals[index] = updatedDeal;
    return { ...updatedDeal };
  }

  // ---------------------------------------------------------------------------
  // Quotes API & Business Logic
  // ---------------------------------------------------------------------------

  public async getQuotes(query: QuotesQuery): Promise<QuotesListResponse> {
    const parsedQuery = QuotesQuerySchema.parse(query);
    const { page, pageSize, deal_id } = parsedQuery;

    let filtered = [...this.quotes];

    if (deal_id) {
      filtered = filtered.filter((q) => q.deal_id === deal_id);
    }

    // Deterministic sort: created_at desc, id asc
    filtered.sort((a, b) => {
      const timeDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });

    const totalCount = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const offset = (page - 1) * pageSize;
    const items = filtered.slice(offset, offset + pageSize);

    return {
      items,
      pagination: {
        page,
        pageSize,
        limit: pageSize,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  public async getQuoteById(id: string): Promise<Quote | null> {
    const quote = this.quotes.find((q) => q.id === id);
    return quote ? { ...quote } : null;
  }

  public async createQuote(input: CreateQuoteInput): Promise<Quote> {
    const validated = CreateQuoteInputSchema.parse(input);

    // 1. Referential integrity: parent deal must exist
    await assertValidDealReference(validated.deal_id, (id) => this.deals.some((d) => d.id === id));

    // 2. Uniqueness: quote_number must be unique
    await assertValidQuoteNumber(validated.quote_number, (num) =>
      this.quotes.some((q) => q.quote_number.toLowerCase() === num.toLowerCase())
    );

    const deal = this.deals.find((d) => d.id === validated.deal_id);
    const now = new Date().toISOString();

    const newQuote: Quote = {
      id: randomUUID(),
      deal_id: validated.deal_id,
      deal_name: deal?.name,
      quote_number: validated.quote_number.trim(),
      date: validated.date,
      amount: validated.amount,
      currency: validated.currency,
      note: validated.note ?? null,
      source_system: validated.source_system ?? null,
      source_id: validated.source_id ?? null,
      created_at: now,
      updated_at: now,
    };

    this.quotes.unshift(newQuote);
    return { ...newQuote };
  }

  public async updateQuote(id: string, input: UpdateQuoteInput): Promise<Quote> {
    const sanitized = sanitizeQuoteUserEdit(input as Record<string, unknown>) as UpdateQuoteInput;
    const validated = UpdateQuoteInputSchema.parse(sanitized);
    const index = this.quotes.findIndex((q) => q.id === id);
    if (index === -1) {
      throw new QuoteNotFoundError(id);
    }

    const currentQuote = this.quotes[index]!;

    // If updating quote_number, enforce uniqueness
    if (
      validated.quote_number &&
      validated.quote_number.trim().toLowerCase() !== currentQuote.quote_number.toLowerCase()
    ) {
      await assertValidQuoteNumber(validated.quote_number, (num) =>
        this.quotes.some((q) => q.id !== id && q.quote_number.toLowerCase() === num.toLowerCase())
      );
    }

    const updatedQuote: Quote = {
      ...currentQuote,
      quote_number: validated.quote_number ? validated.quote_number.trim() : currentQuote.quote_number,
      date: validated.date ?? currentQuote.date,
      amount: validated.amount ?? currentQuote.amount,
      currency: validated.currency ?? currentQuote.currency,
      note: validated.note !== undefined ? validated.note : currentQuote.note,
      updated_at: new Date().toISOString(),
    };

    this.quotes[index] = updatedQuote;
    return { ...updatedQuote };
  }

  // ---------------------------------------------------------------------------
  // Projections & Derived Consistency
  // ---------------------------------------------------------------------------

  public async getDealDerivedTotals(dealId: string): Promise<DealDerivedTotals> {
    const deal = await this.getDealById(dealId);
    if (!deal) {
      throw new DealNotFoundError(dealId);
    }
    return calculateDealDerivedTotals(deal, this.quotes);
  }

  public async getPipelineSummary(): Promise<PipelineSummary> {
    return calculatePipelineSummary(this.deals);
  }

  public async getDealBySource(sourceSystem: string, sourceId: string): Promise<Deal | null> {
    const deal = this.deals.find(
      (d) => d.source_system === sourceSystem && d.source_id === sourceId
    );
    return deal ? { ...deal } : null;
  }

  public async getQuoteBySource(sourceSystem: string, sourceId: string): Promise<Quote | null> {
    const quote = this.quotes.find(
      (q) => q.source_system === sourceSystem && q.source_id === sourceId
    );
    return quote ? { ...quote } : null;
  }

  public async getQuoteByNumber(quoteNumber: string): Promise<Quote | null> {
    const quote = this.quotes.find(
      (q) => q.quote_number.toLowerCase() === quoteNumber.toLowerCase()
    );
    return quote ? { ...quote } : null;
  }

  public async deleteDeal(id: string): Promise<boolean> {
    const initialLen = this.deals.length;
    this.deals = this.deals.filter((d) => d.id !== id);
    return this.deals.length < initialLen;
  }

  public async deleteQuote(id: string): Promise<boolean> {
    const initialLen = this.quotes.length;
    this.quotes = this.quotes.filter((q) => q.id !== id);
    return this.quotes.length < initialLen;
  }

  public async createQuoteLine(input: CreateQuoteLineInput): Promise<QuoteLine> {
    const validated = CreateQuoteLineInputSchema.parse(input);
    const quote = this.quotes.find((q) => q.id === validated.quote_id);
    if (!quote) {
      throw new QuoteNotFoundError(validated.quote_id);
    }

    const qty = parseFloat(validated.quantity);
    const price = parseFloat(validated.unit_price);
    const computedTotal = (qty * price).toFixed(2);

    const now = new Date().toISOString();
    const line: QuoteLine = {
      id: randomUUID(),
      quote_id: validated.quote_id,
      line_number: validated.line_number,
      product_id: validated.product_id ?? null,
      description: validated.description.trim(),
      quantity: validated.quantity,
      unit_price: validated.unit_price,
      line_total: validated.line_total ?? computedTotal,
      created_at: now,
      updated_at: now,
    };

    this.quoteLines.unshift(line);
    return { ...line };
  }

  public async getQuoteLines(quoteId: string): Promise<QuoteLine[]> {
    return this.quoteLines
      .filter((l) => l.quote_id === quoteId)
      .map((l) => ({ ...l }));
  }

  public async deleteQuoteLine(id: string): Promise<boolean> {
    const initialLen = this.quoteLines.length;
    this.quoteLines = this.quoteLines.filter((l) => l.id !== id);
    return this.quoteLines.length < initialLen;
  }

  public snapshotState() {
    return {
      deals: [...this.deals],
      quotes: [...this.quotes],
      quoteLines: [...this.quoteLines],
      importReceipts: [...this.importReceipts],
    };
  }

  public restoreState(snapshot: {
    deals: Deal[];
    quotes: Quote[];
    quoteLines: QuoteLine[];
    importReceipts: Crm2ImportReceipt[];
  }): void {
    this.deals = [...snapshot.deals];
    this.quotes = [...snapshot.quotes];
    this.quoteLines = [...snapshot.quoteLines];
    this.importReceipts = [...snapshot.importReceipts];
  }

  // ---------------------------------------------------------------------------
  // Migration Kit Ingestion & Durable Idempotent Import Receipts
  // ---------------------------------------------------------------------------

  public async importRow(
    input: Crm2ImportRow,
    idempotencyKey?: string
  ): Promise<{ targetId: string; receipt: Crm2ImportReceipt; isExisting: boolean }> {
    const key = idempotencyKey || input.idempotencyKey;
    if (!key || key.trim() === '') {
      throw new DomainValidationError(
        'Missing required Idempotency-Key header or field',
        [{ field: 'idempotencyKey', message: 'Idempotency key is required', code: 'required' }],
        400
      );
    }

    const digest = requestDigest(input.data);
    const existing = this.importReceipts.find((r) => r.idempotencyKey === key);
    if (existing) {
      if (existing.payloadHash === digest) {
        return { targetId: existing.targetId, receipt: { ...existing }, isExisting: true };
      }
      throw new IdempotencyKeyReusedError(
        'Idempotency-Key was already used for a different import request',
        [{ field: 'idempotencyKey', message: 'Payload mismatch for reused idempotency key', code: 'idempotency_conflict' }]
      );
    }

    let targetId: string;
    let sourceId: string = (input.data['sourceId'] as string) || (input.data['source_id'] as string) || '';
    let outcome: 'created' | 'linked' = 'created';

    const entityLower = input.entity.toLowerCase();

    if (entityLower === 'deal' || entityLower === 'deals') {
      const dealInput = {
        name: input.data['name'] as string,
        contact_id: (input.data['contact_id'] ?? input.data['contactId'] ?? null) as string | null,
        value: String(input.data['value'] ?? ''),
        currency: (input.data['currency'] as string) || 'USD',
        stage_name: (input.data['stage_name'] ?? input.data['stageName'] ?? 'New') as any,
        close_date: (input.data['close_date'] ?? input.data['closeDate'] ?? '') as string,
        source_system: input.sourceSystem,
        source_id: sourceId || undefined,
      };

      const parseResult = CreateDealInputSchema.safeParse(dealInput);
      if (!parseResult.success) {
        throw new DomainValidationError('Invalid import deal payload', parseResult.error.issues, 422);
      }

      // Check if deal already exists for type-safe UPSERT
      const existing = (sourceId
        ? this.deals.find((d) => d.source_system === input.sourceSystem && d.source_id === sourceId)
        : null) || (input.data['id'] ? this.deals.find((d) => d.id === input.data['id']) : null);

      if (existing) {
        const updated = await this.updateDeal(existing.id, parseResult.data);
        targetId = updated.id;
        outcome = 'linked';
      } else {
        const created = await this.createDeal(parseResult.data);
        targetId = created.id;
        outcome = 'created';
      }
      if (!sourceId) sourceId = targetId;
    } else if (entityLower === 'quote' || entityLower === 'quotes') {
      const quoteInput = {
        deal_id: (input.data['deal_id'] ?? input.data['dealId'] ?? '') as string,
        quote_number: (input.data['quote_number'] ?? input.data['quoteNumber'] ?? '') as string,
        date: (input.data['date'] ?? input.data['quote_date'] ?? input.data['quoteDate'] ?? '') as string,
        amount: String(input.data['amount'] ?? ''),
        currency: (input.data['currency'] as string) || 'USD',
        note: (input.data['note'] as string | null | undefined) ?? null,
        source_system: input.sourceSystem,
        source_id: sourceId || undefined,
      };

      const parseResult = CreateQuoteInputSchema.safeParse(quoteInput);
      if (!parseResult.success) {
        throw new DomainValidationError('Invalid import quote payload', parseResult.error.issues, 422);
      }

      // Check if quote already exists for type-safe UPSERT
      const existing = (sourceId
        ? this.quotes.find((q) => q.source_system === input.sourceSystem && q.source_id === sourceId)
        : null) || this.quotes.find((q) => q.quote_number.toLowerCase() === parseResult.data.quote_number.toLowerCase());

      if (existing) {
        const updated = await this.updateQuote(existing.id, parseResult.data);
        targetId = updated.id;
        outcome = 'linked';
      } else {
        const created = await this.createQuote(parseResult.data);
        targetId = created.id;
        outcome = 'created';
      }
      if (!sourceId) sourceId = targetId;
    } else if (entityLower === 'stage' || entityLower === 'stages') {
      const stageName = (input.data['name'] ?? input.data['stage_name'] ?? input.data['stageName']) as string;
      const stage = this.stages.find(
        (s) => s.name.toLowerCase() === String(stageName).toLowerCase() || s.id === input.data['id']
      );
      if (!stage) {
        throw new DomainValidationError(
          `Pipeline stage '${stageName}' does not exist in fixed 6-stage reference set`,
          [{ field: 'stage_name', message: 'Stage not found', code: 'invalid_stage' }],
          422
        );
      }
      targetId = stage.id;
      outcome = 'linked';
      if (!sourceId) sourceId = targetId;
    } else if (entityLower === 'quote_line' || entityLower === 'quote_lines' || entityLower === 'quotelines') {
      const lineInput = {
        quote_id: (input.data['quote_id'] ?? input.data['quoteId'] ?? '') as string,
        line_number: Number(input.data['line_number'] ?? input.data['lineNumber'] ?? 1),
        product_id: (input.data['product_id'] ?? input.data['productId'] ?? null) as string | null,
        description: String(input.data['description'] ?? ''),
        quantity: String(input.data['quantity'] ?? '1.0000'),
        unit_price: String(input.data['unit_price'] ?? input.data['unitPrice'] ?? '0.00'),
        line_total: input.data['line_total'] ? String(input.data['line_total']) : undefined,
      };

      const parseResult = CreateQuoteLineInputSchema.safeParse(lineInput);
      if (!parseResult.success) {
        throw new DomainValidationError('Invalid import quote line payload', parseResult.error.issues, 422);
      }

      const existing = this.quoteLines.find(
        (l) => l.quote_id === parseResult.data.quote_id && l.line_number === parseResult.data.line_number
      );

      if (existing) {
        existing.description = parseResult.data.description;
        existing.quantity = parseResult.data.quantity;
        existing.unit_price = parseResult.data.unit_price;
        const qty = parseFloat(existing.quantity);
        const price = parseFloat(existing.unit_price);
        existing.line_total = (qty * price).toFixed(2);
        existing.updated_at = new Date().toISOString();
        targetId = existing.id;
        outcome = 'linked';
      } else {
        const created = await this.createQuoteLine(parseResult.data);
        targetId = created.id;
        outcome = 'created';
      }
      if (!sourceId) sourceId = targetId;
    } else {
      throw new DomainValidationError(
        `Unsupported import entity: ${input.entity}`,
        [{ field: 'entity', message: "Entity must be 'deal', 'quote', 'stage', or 'quote_line'", code: 'invalid_entity' }],
        422
      );
    }

    const receipt: Crm2ImportReceipt = {
      id: randomUUID(),
      batchId: input.batchId,
      sourceRow: input.sourceRow,
      entity: input.entity,
      sourceSystem: input.sourceSystem,
      sourceId,
      targetId,
      idempotencyKey: key,
      payloadHash: digest,
      kind: outcome,
      outcome: outcome,
      createdAt: new Date().toISOString(),
    };

    this.importReceipts.push(receipt);
    return { targetId, receipt: { ...receipt }, isExisting: false };
  }

  public getReceipts(): Crm2ImportReceipt[] {
    return [...this.importReceipts];
  }

  public getReceiptByKey(key: string): Crm2ImportReceipt | undefined {
    return this.importReceipts.find((r) => r.idempotencyKey === key);
  }

  public deleteReceipt(key: string): boolean {
    const initialLen = this.importReceipts.length;
    this.importReceipts = this.importReceipts.filter((r) => r.idempotencyKey !== key);
    return this.importReceipts.length < initialLen;
  }
}

export const crm2Service = new Crm2Service();
