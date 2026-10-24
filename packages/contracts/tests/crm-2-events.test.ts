import { describe, it, expect } from 'vitest';
import {
  CRM2EventTypes,
  CRM2EventTypeSchema,
  DealCreatedPayloadSchema,
  DealUpdatedPayloadSchema,
  DealStageChangedPayloadSchema,
  DealWonPayloadSchema,
  DealLostPayloadSchema,
  QuoteCreatedPayloadSchema,
  QuoteUpdatedPayloadSchema,
  QuoteAcceptedPayloadSchema,
  CRM2DuplicateDetectedPayloadSchema,
  CRM2DuplicateResolvedPayloadSchema,
  CRM2ImportBatchLoadedPayloadSchema,
  createDealCreatedEvent,
  createDealUpdatedEvent,
  createDealStageChangedEvent,
  createDealWonEvent,
  createDealLostEvent,
  createQuoteCreatedEvent,
  createQuoteUpdatedEvent,
  createQuoteAcceptedEvent,
  createCRM2DuplicateDetectedEvent,
  createCRM2DuplicateResolvedEvent,
  createCRM2ImportBatchLoadedEvent,
} from '../src/crm-2-events.js';

describe('CRM-2 Domain Events Package (Issue #2127 / [CRM2-14])', () => {
  describe('1. Event Taxonomy & Types', () => {
    it('defines canonical CRM-2 event types matching SDS ClearShift CRM v2.0 §8', () => {
      expect(CRM2EventTypes.DEAL_CREATED).toBe('crm2.deal.created');
      expect(CRM2EventTypes.DEAL_UPDATED).toBe('crm2.deal.updated');
      expect(CRM2EventTypes.DEAL_STAGE_CHANGED).toBe('crm2.deal.stage_changed');
      expect(CRM2EventTypes.DEAL_WON).toBe('deal.won');
      expect(CRM2EventTypes.DEAL_LOST).toBe('crm2.deal.lost');
      expect(CRM2EventTypes.QUOTE_CREATED).toBe('crm2.quote.created');
      expect(CRM2EventTypes.QUOTE_UPDATED).toBe('crm2.quote.updated');
      expect(CRM2EventTypes.QUOTE_ACCEPTED).toBe('crm2.quote.accepted');
      expect(CRM2EventTypes.DUPLICATE_DETECTED).toBe('crm2.duplicate.detected');
      expect(CRM2EventTypes.DUPLICATE_RESOLVED).toBe('crm2.duplicate.resolved');
      expect(CRM2EventTypes.IMPORT_BATCH_LOADED).toBe('crm2.import.batch_loaded');
    });

    it('validates all canonical event types against CRM2EventTypeSchema', () => {
      for (const eventType of Object.values(CRM2EventTypes)) {
        expect(CRM2EventTypeSchema.parse(eventType)).toBe(eventType);
      }
    });
  });

  describe('2. Deal Domain Events', () => {
    it('creates and validates a crm2.deal.created event envelope', () => {
      const payload = {
        dealId: '20000000-0000-4000-8000-000000000001',
        name: 'Enterprise Logistics Expansion',
        contactId: '00000000-0000-4000-8000-000000000001',
        contactName: 'Alex Morgan',
        value: '150000.00',
        currency: 'USD',
        stageId: '00000000-0000-4000-8000-000000000001',
        stageName: 'New' as const,
        closeDate: '2026-12-31',
        isOrphan: false,
        sourceSystem: 'hubspot_migration',
        sourceId: 'hs_deal_101',
        createdAt: '2026-10-24T10:00:00.000Z',
      };

      const event = createDealCreatedEvent(payload, {
        correlationId: 'corr-deal-001',
        producer: 'crm-2-service',
      });

      expect(event.eventType).toBe('crm2.deal.created');
      expect(event.aggregateType).toBe('Deal');
      expect(event.aggregateId).toBe(payload.dealId);
      expect(event.correlationId).toBe('corr-deal-001');
      expect(event.producer).toBe('crm-2-service');
      expect(event.payload).toEqual(payload);
      expect(DealCreatedPayloadSchema.parse(event.payload)).toEqual(payload);
    });

    it('creates and validates a crm2.deal.updated event envelope', () => {
      const payload = {
        dealId: '20000000-0000-4000-8000-000000000001',
        changes: { value: '175000.00' },
        previousState: { value: '150000.00' },
        updatedAt: '2026-10-24T10:30:00.000Z',
      };

      const event = createDealUpdatedEvent(payload);
      expect(event.eventType).toBe('crm2.deal.updated');
      expect(event.aggregateId).toBe(payload.dealId);
      expect(event.payload.changes).toEqual({ value: '175000.00' });
      expect(DealUpdatedPayloadSchema.parse(event.payload)).toEqual(payload);
    });

    it('creates and validates a crm2.deal.stage_changed event envelope', () => {
      const payload = {
        dealId: '20000000-0000-4000-8000-000000000001',
        previousStage: 'New' as const,
        newStage: 'Qualified' as const,
        changedAt: '2026-10-24T11:00:00.000Z',
      };

      const event = createDealStageChangedEvent(payload);
      expect(event.eventType).toBe('crm2.deal.stage_changed');
      expect(event.aggregateId).toBe(payload.dealId);
      expect(event.payload.previousStage).toBe('New');
      expect(event.payload.newStage).toBe('Qualified');
      expect(DealStageChangedPayloadSchema.parse(event.payload)).toEqual(payload);
    });

    it('creates canonical deal.won domain event (FR-CRM2-08) for ERP-3 order creation', () => {
      const payload = {
        dealId: '20000000-0000-4000-8000-000000000004',
        dealName: 'Summit Healthcare Predictive Analytics',
        name: 'Summit Healthcare Predictive Analytics',
        customerId: '00000000-0000-4000-8000-000000000001',
        amount: '180000.00',
        currency: 'USD',
        closeDate: '2026-10-20',
        stageName: 'Won' as const,
        wonAt: '2026-10-20T16:00:00.000Z',
      };

      const event = createDealWonEvent(payload, {
        correlationId: 'corr-erp3-order-create-99',
      });

      expect(event.eventType).toBe('deal.won');
      expect(event.aggregateType).toBe('Deal');
      expect(event.aggregateId).toBe(payload.dealId);
      expect(event.correlationId).toBe('corr-erp3-order-create-99');
      expect(event.payload.dealId).toBe(payload.dealId);
      expect(event.payload.customerId).toBe(payload.customerId);
      expect(event.payload.amount).toBe('180000.00');
      expect(event.payload.currency).toBe('USD');
      expect(event.payload.stageName).toBe('Won');
      expect(DealWonPayloadSchema.parse(event.payload).amount).toBe('180000.00');
    });

    it('creates and validates a crm2.deal.lost event envelope', () => {
      const payload = {
        dealId: '20000000-0000-4000-8000-000000000005',
        previousStage: 'Proposal' as const,
        stageName: 'Lost' as const,
        lossReason: 'Competitor price undercut by 15%',
        lostAt: '2026-10-24T12:00:00.000Z',
      };

      const event = createDealLostEvent(payload);
      expect(event.eventType).toBe('crm2.deal.lost');
      expect(event.aggregateId).toBe(payload.dealId);
      expect(event.payload.lossReason).toBe('Competitor price undercut by 15%');
      expect(DealLostPayloadSchema.parse(event.payload)).toEqual(payload);
    });
  });

  describe('3. Quote Domain Events', () => {
    it('creates and validates a crm2.quote.created event envelope', () => {
      const payload = {
        quoteId: '30000000-0000-4000-8000-000000000001',
        dealId: '20000000-0000-4000-8000-000000000001',
        quoteNumber: 'Q-2026-001',
        date: '2026-10-15',
        amount: '125000.00',
        currency: 'USD',
        note: 'Tier-1 client quote',
        createdAt: '2026-10-15T09:00:00.000Z',
      };

      const event = createQuoteCreatedEvent(payload);
      expect(event.eventType).toBe('crm2.quote.created');
      expect(event.aggregateType).toBe('Quote');
      expect(event.aggregateId).toBe(payload.quoteId);
      expect(event.payload.quoteNumber).toBe('Q-2026-001');
      expect(QuoteCreatedPayloadSchema.parse(event.payload)).toEqual(payload);
    });

    it('creates and validates a crm2.quote.updated event envelope', () => {
      const payload = {
        quoteId: '30000000-0000-4000-8000-000000000001',
        amount: '135000.00',
        note: 'Revised with SLA tier',
        updatedAt: '2026-10-20T10:00:00.000Z',
      };

      const event = createQuoteUpdatedEvent(payload);
      expect(event.eventType).toBe('crm2.quote.updated');
      expect(event.aggregateId).toBe(payload.quoteId);
      expect(event.payload.amount).toBe('135000.00');
      expect(QuoteUpdatedPayloadSchema.parse(event.payload)).toEqual(payload);
    });

    it('creates and validates a crm2.quote.accepted event envelope', () => {
      const payload = {
        quoteId: '30000000-0000-4000-8000-000000000001',
        dealId: '20000000-0000-4000-8000-000000000001',
        quoteNumber: 'Q-2026-001',
        amount: '125000.00',
        currency: 'USD',
        acceptedAt: '2026-10-24T14:00:00.000Z',
      };

      const event = createQuoteAcceptedEvent(payload);
      expect(event.eventType).toBe('crm2.quote.accepted');
      expect(event.aggregateId).toBe(payload.quoteId);
      expect(QuoteAcceptedPayloadSchema.parse(event.payload)).toEqual(payload);
    });
  });

  describe('4. Deduplication & Import Events', () => {
    it('creates and validates a crm2.duplicate.detected event envelope', () => {
      const payload = {
        candidateId: '50000000-0000-4000-8000-000000000001',
        batchId: 'batch-crm2-001',
        entity: 'deal' as const,
        keyType: 'deal_business',
        normalizedKey: 'acme fleet#00000000-0000-4000-8000-000000000001#00000000-0000-4000-8000-000000000001',
        recordIds: ['20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000099'],
        detectedAt: '2026-10-24T14:10:00.000Z',
      };

      const event = createCRM2DuplicateDetectedEvent(payload);
      expect(event.eventType).toBe('crm2.duplicate.detected');
      expect(event.aggregateType).toBe('crm2_duplicate_candidate');
      expect(event.payload.recordIds).toHaveLength(2);
      expect(CRM2DuplicateDetectedPayloadSchema.parse(event.payload)).toEqual(payload);
    });

    it('creates and validates a crm2.duplicate.resolved event envelope', () => {
      const payload = {
        candidateId: '50000000-0000-4000-8000-000000000001',
        decision: 'MERGE' as const,
        actorId: 'operator-user-1',
        keptId: '20000000-0000-4000-8000-000000000001',
        mergedId: '20000000-0000-4000-8000-000000000099',
        reason: 'Verified exact duplicate from disparate migration sources',
        resolvedAt: '2026-10-24T14:20:00.000Z',
      };

      const event = createCRM2DuplicateResolvedEvent(payload);
      expect(event.eventType).toBe('crm2.duplicate.resolved');
      expect(event.payload.decision).toBe('MERGE');
      expect(CRM2DuplicateResolvedPayloadSchema.parse(event.payload)).toEqual(payload);
    });

    it('creates and validates a crm2.import.batch_loaded event envelope', () => {
      const payload = {
        batchId: 'batch-crm2-load-100',
        sourceSystem: 'hubspot_crm',
        loadedCount: 95,
        rejectedCount: 5,
        completedAt: '2026-10-24T14:30:00.000Z',
      };

      const event = createCRM2ImportBatchLoadedEvent(payload);
      expect(event.eventType).toBe('crm2.import.batch_loaded');
      expect(event.payload.loadedCount).toBe(95);
      expect(CRM2ImportBatchLoadedPayloadSchema.parse(event.payload)).toEqual(payload);
    });
  });

  describe('5. Schema Validation & Guardrails', () => {
    it('rejects invalid deal values or non-ISO currencies in payloads', () => {
      expect(
        DealCreatedPayloadSchema.safeParse({
          dealId: '20000000-0000-4000-8000-000000000001',
          name: 'Invalid Deal',
          value: 'invalid-number',
          currency: 'USD',
          stageId: '00000000-0000-4000-8000-000000000001',
          stageName: 'New',
          closeDate: '2026-12-31',
          isOrphan: false,
          createdAt: '2026-10-24T10:00:00.000Z',
        }).success
      ).toBe(false);

      expect(
        DealCreatedPayloadSchema.safeParse({
          dealId: '20000000-0000-4000-8000-000000000001',
          name: 'Invalid Currency',
          value: '1000.00',
          currency: 'dollars',
          stageId: '00000000-0000-4000-8000-000000000001',
          stageName: 'New',
          closeDate: '2026-12-31',
          isOrphan: false,
          createdAt: '2026-10-24T10:00:00.000Z',
        }).success
      ).toBe(false);
    });

    it('rejects invalid stage name in DealStageChanged payload', () => {
      expect(
        DealStageChangedPayloadSchema.safeParse({
          dealId: '20000000-0000-4000-8000-000000000001',
          previousStage: 'New',
          newStage: 'Archived', // Invalid stage
          changedAt: '2026-10-24T10:00:00.000Z',
        }).success
      ).toBe(false);
    });

    it('rejects deal.won payload missing required currency or decimal amount', () => {
      expect(
        DealWonPayloadSchema.safeParse({
          dealId: '20000000-0000-4000-8000-000000000001',
          amount: 'abc',
          currency: 'USD',
        }).success
      ).toBe(false);
    });
  });
});
