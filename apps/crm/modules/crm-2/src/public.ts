import { ReferenceResolver } from '@cs/kernel';
import { crm2Service, Crm2Service } from './services/crm2.service.js';

export interface DealPublicSummary {
  id: string;
  name: string;
  contactId: string | null;
  value: string;
  currency: string;
  stageId: string;
  stageName: string;
  isOrphan: boolean;
}

export interface StagePublicSummary {
  id: string;
  name: string;
  order: number;
  isWon: boolean;
}

export interface QuotePublicSummary {
  id: string;
  dealId: string;
  quoteNumber: string;
  amount: string;
  currency: string;
}

export class Crm2ReferenceResolver implements ReferenceResolver {
  constructor(private readonly service: Crm2Service = crm2Service) {}

  async exists(entityType: string, id: string): Promise<boolean> {
    if (entityType === 'deal') {
      const deal = await this.service.getDealById(id);
      return deal !== null;
    }
    if (entityType === 'stage') {
      const stages = await this.service.getStages();
      return stages.some((s) => s.id === id || s.name === id);
    }
    if (entityType === 'quote') {
      const quote = await this.service.getQuoteById(id);
      return quote !== null;
    }
    return false;
  }

  async get<T = DealPublicSummary>(entityType: string, id: string): Promise<T | null> {
    if (entityType === 'deal') {
      const deal = await this.service.getDealById(id);
      if (!deal) return null;
      const summary: DealPublicSummary = {
        id: deal.id,
        name: deal.name,
        contactId: deal.contact_id,
        value: deal.value,
        currency: deal.currency,
        stageId: deal.stage_id,
        stageName: deal.stage_name,
        isOrphan: deal.is_orphan,
      };
      return summary as unknown as T;
    }

    if (entityType === 'stage') {
      const stages = await this.service.getStages();
      const stage = stages.find((s) => s.id === id || s.name === id);
      if (!stage) return null;
      const summary: StagePublicSummary = {
        id: stage.id,
        name: stage.name,
        order: stage.order,
        isWon: stage.is_closed_won,
      };
      return summary as unknown as T;
    }

    if (entityType === 'quote') {
      const quote = await this.service.getQuoteById(id);
      if (!quote) return null;
      const summary: QuotePublicSummary = {
        id: quote.id,
        dealId: quote.deal_id,
        quoteNumber: quote.quote_number,
        amount: quote.amount,
        currency: quote.currency,
      };
      return summary as unknown as T;
    }

    return null;
  }
}

export const crm2Resolver = new Crm2ReferenceResolver();
