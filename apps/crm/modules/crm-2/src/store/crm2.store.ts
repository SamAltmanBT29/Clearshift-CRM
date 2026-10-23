import crypto from 'node:crypto';
import {
  type Crm2StageName,
  type Stage,
  type Deal,
  type Quote,
  type CreateDealInput,
  type UpdateDealInput,
  type CreateQuoteInput,
  type UpdateQuoteInput,
  type DealsQuery,
  type QuotesQuery,
  assertValidStageName,
} from '@clearshift/contracts';

/**
 * CRM-2 Relational Data Store
 * Fully adheres to PostgreSQL 18.6 Drizzle schema (crm2_stages, crm2_deals, crm2_quotes)
 * and enforces all V1 domain invariants.
 */
export class Crm2Store {
  private stages: Stage[] = [];
  private deals: Deal[] = [];
  private quotes: Quote[] = [];

  constructor() {
    this.seed();
  }

  public seed(): void {
    this.seedStages();
    this.seedDeals();
    this.seedQuotes();
  }

  public reset(): void {
    this.stages = [];
    this.deals = [];
    this.quotes = [];
    this.seed();
  }

  /**
   * Seeds the 6 fixed pipeline stages.
   * Domain rule: Stage records are seeded and cannot be renamed/duplicated.
   */
  private seedStages(): void {
    const fixedStages: { name: Crm2StageName; order: number; isWon?: boolean; isLost?: boolean }[] = [
      { name: 'New', order: 1 },
      { name: 'Qualified', order: 2 },
      { name: 'Proposal', order: 3 },
      { name: 'Negotiation', order: 4 },
      { name: 'Won', order: 5, isWon: true },
      { name: 'Lost', order: 6, isLost: true },
    ];

    const now = new Date('2026-10-01T00:00:00.000Z').toISOString();

    this.stages = fixedStages.map((s, idx) => ({
      id: `10000000-0000-4000-8000-00000000000${idx + 1}`,
      name: s.name,
      order: s.order,
      is_closed_won: Boolean(s.isWon),
      is_closed_lost: Boolean(s.isLost),
      created_at: now,
      updated_at: now,
    }));
  }

  private seedDeals(): void {
    const stageMap = new Map<Crm2StageName, Stage>();
    for (const st of this.stages) {
      stageMap.set(st.name, st);
    }

    const now = new Date('2026-10-15T10:00:00.000Z').toISOString();

    const rawDeals: Array<{
      id: string;
      name: string;
      contact_id: string | null;
      contact_name: string | null;
      value: string;
      currency: string;
      stage_name: Crm2StageName;
      close_date: string;
    }> = [
      {
        id: '20000000-0000-4000-8000-000000000001',
        name: 'Acme Cloud Modernization',
        contact_id: '90000000-0000-4000-8000-000000000001',
        contact_name: 'Sarah Connor',
        value: '75000.00',
        currency: 'USD',
        stage_name: 'Proposal',
        close_date: '2026-11-30',
      },
      {
        id: '20000000-0000-4000-8000-000000000002',
        name: 'Inbound Enterprise Lead [Orphan Deal]',
        contact_id: null, // Null contact creates orphan deal
        contact_name: null,
        value: '125000.00',
        currency: 'USD',
        stage_name: 'New',
        close_date: '2026-12-15',
      },
      {
        id: '20000000-0000-4000-8000-000000000003',
        name: 'Starlight Retail POS Upgrade',
        contact_id: '90000000-0000-4000-8000-000000000002',
        contact_name: 'Marcus Vance',
        value: '42500.50',
        currency: 'EUR',
        stage_name: 'Qualified',
        close_date: '2026-11-20',
      },
      {
        id: '20000000-0000-4000-8000-000000000004',
        name: 'Fintech High-Frequency Gateway',
        contact_id: '90000000-0000-4000-8000-000000000003',
        contact_name: 'Elena Rostova',
        value: '220000.00',
        currency: 'USD',
        stage_name: 'Negotiation',
        close_date: '2026-11-10',
      },
      {
        id: '20000000-0000-4000-8000-000000000005',
        name: 'Nordic Healthcare Telemetry',
        contact_id: '90000000-0000-4000-8000-000000000004',
        contact_name: 'Lars Lindqvist',
        value: '310000.00',
        currency: 'EUR',
        stage_name: 'Won',
        close_date: '2026-10-20',
      },
      {
        id: '20000000-0000-4000-8000-000000000006',
        name: 'Legacy Migration Subcontract [Orphan Deal]',
        contact_id: null, // Second orphan deal
        contact_name: null,
        value: '18500.00',
        currency: 'GBP',
        stage_name: 'Lost',
        close_date: '2026-10-18',
      },
      {
        id: '20000000-0000-4000-8000-000000000007',
        name: 'Helios Energy Smart Grid Integration',
        contact_id: '90000000-0000-4000-8000-000000000005',
        contact_name: 'David Chen',
        value: '580000.00',
        currency: 'USD',
        stage_name: 'Proposal',
        close_date: '2026-12-01',
      },
      {
        id: '20000000-0000-4000-8000-000000000008',
        name: 'BlueWave Logistics Tracking V2',
        contact_id: '90000000-0000-4000-8000-000000000006',
        contact_name: 'Rachel Adams',
        value: '95000.00',
        currency: 'USD',
        stage_name: 'Qualified',
        close_date: '2026-11-25',
      },
      {
        id: '20000000-0000-4000-8000-000000000009',
        name: 'Quantum Bio Analytics Suite',
        contact_id: '90000000-0000-4000-8000-000000000007',
        contact_name: 'Dr. Aris Thorne',
        value: '450000.00',
        currency: 'EUR',
        stage_name: 'Negotiation',
        close_date: '2026-12-20',
      },
      {
        id: '20000000-0000-4000-8000-000000000010',
        name: 'Apex Robotics Fleet Controller',
        contact_id: '90000000-0000-4000-8000-000000000008',
        contact_name: 'Siddharth Rao',
        value: '185000.00',
        currency: 'USD',
        stage_name: 'Won',
        close_date: '2026-10-15',
      },
      {
        id: '20000000-0000-4000-8000-000000000011',
        name: 'Global Edu Tech Platform Rollout',
        contact_id: '90000000-0000-4000-8000-000000000009',
        contact_name: 'Camila Rodriguez',
        value: '62000.00',
        currency: 'USD',
        stage_name: 'New',
        close_date: '2026-12-10',
      },
      {
        id: '20000000-0000-4000-8000-000000000012',
        name: 'Ironclad Security Appliance Supply',
        contact_id: '90000000-0000-4000-8000-000000000010',
        contact_name: 'Klaus Schmidt',
        value: '35000.00',
        currency: 'EUR',
        stage_name: 'Lost',
        close_date: '2026-10-05',
      },
    ];

    this.deals = rawDeals.map((d) => {
      const stage = stageMap.get(d.stage_name) ?? this.stages[0]!;
      return {
        id: d.id,
        name: d.name,
        contact_id: d.contact_id,
        contact_name: d.contact_name,
        value: d.value,
        currency: d.currency,
        stage_id: stage.id,
        stage_name: stage.name,
        close_date: d.close_date,
        is_orphan: d.contact_id === null,
        created_at: now,
        updated_at: now,
      };
    });
  }

  private seedQuotes(): void {
    const now = new Date('2026-10-15T12:00:00.000Z').toISOString();
    this.quotes = [
      {
        id: '30000000-0000-4000-8000-000000000001',
        deal_id: '20000000-0000-4000-8000-000000000001',
        deal_name: 'Acme Cloud Modernization',
        quote_number: 'Q-2026-001',
        date: '2026-10-10',
        amount: '75000.00',
        currency: 'USD',
        note: 'Complete cloud modernization scope, including data migration and 6 months SLA support.',
        created_at: now,
        updated_at: now,
      },
      {
        id: '30000000-0000-4000-8000-000000000002',
        deal_id: '20000000-0000-4000-8000-000000000003',
        deal_name: 'Starlight Retail POS Upgrade',
        quote_number: 'Q-2026-002',
        date: '2026-10-12',
        amount: '42500.50',
        currency: 'EUR',
        note: 'Point of sale terminal hardware and software deployment for 25 branches.',
        created_at: now,
        updated_at: now,
      },
      {
        id: '30000000-0000-4000-8000-000000000003',
        deal_id: '20000000-0000-4000-8000-000000000004',
        deal_name: 'Fintech High-Frequency Gateway',
        quote_number: 'Q-2026-003',
        date: '2026-10-14',
        amount: '220000.00',
        currency: 'USD',
        note: 'Sub-millisecond trade routing engine license and initial deployment.',
        created_at: now,
        updated_at: now,
      },
    ];
  }

  // Stages
  public getStages(): Stage[] {
    return [...this.stages].sort((a, b) => a.order - b.order);
  }

  public getStageByName(name: Crm2StageName): Stage | undefined {
    return this.stages.find((s) => s.name === name);
  }

  public getStageById(id: string): Stage | undefined {
    return this.stages.find((s) => s.id === id);
  }

  // Deals
  public getDeals(query: Partial<DealsQuery> = {}): { items: Deal[]; totalCount: number; totalPages: number } {
    let filtered = [...this.deals];

    if (query.stage) {
      filtered = filtered.filter((d) => d.stage_name === query.stage);
    }

    if (query.search && query.search.trim() !== '') {
      const q = query.search.trim().toLowerCase();
      filtered = filtered.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          (d.contact_name !== null && d.contact_name !== undefined && d.contact_name.toLowerCase().includes(q))
      );
    }

    // Deterministic sort: created_at DESC, then name ASC
    filtered.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.name.localeCompare(b.name));

    const totalCount = filtered.length;
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, query.pageSize ?? 10);
    const totalPages = Math.ceil(totalCount / pageSize) || 1;

    const startIndex = (page - 1) * pageSize;
    const items = filtered.slice(startIndex, startIndex + pageSize);

    return { items, totalCount, totalPages };
  }

  public getDealById(id: string): Deal | undefined {
    return this.deals.find((d) => d.id === id);
  }

  public createDeal(input: CreateDealInput): Deal {
    assertValidStageName(input.stage_name);
    const stage = this.getStageByName(input.stage_name);
    if (!stage) {
      throw new Error(`Stage not found: ${input.stage_name}`);
    }

    const now = new Date().toISOString();
    const contactId = input.contact_id && input.contact_id.trim() !== '' ? input.contact_id.trim() : null;
    const isOrphan = contactId === null;

    const deal: Deal = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      contact_id: contactId,
      contact_name: contactId ? `Contact (${contactId.slice(0, 8)})` : null,
      value: input.value,
      currency: input.currency || 'USD',
      stage_id: stage.id,
      stage_name: stage.name,
      close_date: input.close_date,
      is_orphan: isOrphan,
      created_at: now,
      updated_at: now,
    };

    this.deals.unshift(deal);
    return deal;
  }

  public updateDeal(id: string, input: UpdateDealInput): Deal {
    const deal = this.deals.find((d) => d.id === id);
    if (!deal) {
      throw new Error(`Deal not found: ${id}`);
    }

    if (input.stage_name !== undefined) {
      assertValidStageName(input.stage_name);
      const stage = this.getStageByName(input.stage_name);
      if (stage) {
        deal.stage_id = stage.id;
        deal.stage_name = stage.name;
      }
    }

    if (input.name !== undefined) deal.name = input.name.trim();
    if (input.value !== undefined) deal.value = input.value;
    if (input.currency !== undefined) deal.currency = input.currency;
    if (input.close_date !== undefined) deal.close_date = input.close_date;
    if (input.contact_id !== undefined) {
      const contactId = input.contact_id && input.contact_id.trim() !== '' ? input.contact_id.trim() : null;
      deal.contact_id = contactId;
      deal.is_orphan = contactId === null;
      if (contactId === null) {
        deal.contact_name = null;
      } else {
        deal.contact_name = `Contact (${contactId.slice(0, 8)})`;
      }
    }

    deal.updated_at = new Date().toISOString();
    return deal;
  }

  // Quotes
  public getQuotes(query: Partial<QuotesQuery> = {}): { items: Quote[]; totalCount: number; totalPages: number } {
    let filtered = [...this.quotes];

    if (query.deal_id) {
      filtered = filtered.filter((q) => q.deal_id === query.deal_id);
    }

    filtered.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.date.localeCompare(a.date));

    const totalCount = filtered.length;
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, query.pageSize ?? 10);
    const totalPages = Math.ceil(totalCount / pageSize) || 1;

    const startIndex = (page - 1) * pageSize;
    const items = filtered.slice(startIndex, startIndex + pageSize);

    return { items, totalCount, totalPages };
  }

  public getQuoteById(id: string): Quote | undefined {
    return this.quotes.find((q) => q.id === id);
  }

  public createQuote(input: CreateQuoteInput): Quote {
    const existing = this.quotes.find(
      (q) => q.quote_number.toLowerCase() === input.quote_number.trim().toLowerCase()
    );
    if (existing) {
      throw new Error(`Domain Invariant Violation: Quote number '${input.quote_number}' must be unique.`);
    }

    const deal = this.getDealById(input.deal_id);
    if (!deal) {
      throw new Error(`Referenced deal does not exist: ${input.deal_id}`);
    }

    const now = new Date().toISOString();
    const quote: Quote = {
      id: crypto.randomUUID(),
      deal_id: input.deal_id,
      deal_name: deal.name,
      quote_number: input.quote_number.trim(),
      date: input.date,
      amount: input.amount,
      currency: input.currency || deal.currency || 'USD',
      note: input.note ? input.note.trim() : null,
      created_at: now,
      updated_at: now,
    };

    this.quotes.unshift(quote);
    return quote;
  }

  public updateQuote(id: string, input: UpdateQuoteInput): Quote {
    const quote = this.quotes.find((q) => q.id === id);
    if (!quote) {
      throw new Error(`Quote not found: ${id}`);
    }

    if (input.quote_number !== undefined && input.quote_number.trim() !== quote.quote_number) {
      const trimmedNumber = input.quote_number.trim();
      const existing = this.quotes.find(
        (q) => q.quote_number.toLowerCase() === trimmedNumber.toLowerCase() && q.id !== id
      );
      if (existing) {
        throw new Error(`Domain Invariant Violation: Quote number '${trimmedNumber}' is already in use.`);
      }
      quote.quote_number = trimmedNumber;
    }

    if (input.date !== undefined) quote.date = input.date;
    if (input.amount !== undefined) quote.amount = input.amount;
    if (input.currency !== undefined) quote.currency = input.currency;
    if (input.note !== undefined) quote.note = input.note ? input.note.trim() : null;

    quote.updated_at = new Date().toISOString();
    return quote;
  }
}

export const crm2Store = new Crm2Store();
