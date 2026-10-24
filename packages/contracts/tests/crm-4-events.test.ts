import { describe, it, expect } from 'vitest';
import {
  CRM4EventTypes,
  CRM4EventTypeSchema,
  ListCreatedPayloadSchema,
  ListUpdatedPayloadSchema,
  CampaignCreatedPayloadSchema,
  CampaignUpdatedPayloadSchema,
  MemberAddedPayloadSchema,
  ConsentRecordedPayloadSchema,
  ConsentOptedOutPayloadSchema,
  CRM4ImportBatchLoadedPayloadSchema,
  createListCreatedEvent,
  createListUpdatedEvent,
  createCampaignCreatedEvent,
  createCampaignUpdatedEvent,
  createMemberAddedEvent,
  createConsentRecordedEvent,
  createConsentOptedOutEvent,
  createCRM4ImportBatchLoadedEvent,
} from '../src/crm-4-events.js';

describe('CRM-4 Domain Events Package (Issue #167 / [CRM4-14])', () => {
  describe('1. Event Taxonomy & Types', () => {
    it('defines canonical CRM-4 event types', () => {
      expect(CRM4EventTypes.LIST_CREATED).toBe('crm4.list.created');
      expect(CRM4EventTypes.LIST_UPDATED).toBe('crm4.list.updated');
      expect(CRM4EventTypes.CAMPAIGN_CREATED).toBe('crm4.campaign.created');
      expect(CRM4EventTypes.CAMPAIGN_UPDATED).toBe('crm4.campaign.updated');
      expect(CRM4EventTypes.MEMBER_ADDED).toBe('crm4.member.added');
      expect(CRM4EventTypes.CONSENT_RECORDED).toBe('crm4.consent.recorded');
      expect(CRM4EventTypes.CONSENT_OPTED_OUT).toBe('crm4.consent.opted_out');
      expect(CRM4EventTypes.IMPORT_BATCH_LOADED).toBe('crm4.import.batch_loaded');
    });

    it('validates all event types with CRM4EventTypeSchema', () => {
      for (const eventType of Object.values(CRM4EventTypes)) {
        expect(CRM4EventTypeSchema.parse(eventType)).toBe(eventType);
      }
    });
  });

  describe('2. Marketing List Events', () => {
    it('creates and validates a crm4.list.created event envelope', () => {
      const payload = {
        listId: '40000000-0000-4000-8000-000000000001',
        name: 'Enterprise VIP Accounts',
        description: 'Key strategic decision makers',
        campaignCount: 0,
        memberCount: 0,
        createdAt: '2026-10-23T10:00:00.000Z',
      };

      const event = createListCreatedEvent(payload, {
        correlationId: 'corr-list-001',
        producer: 'crm-4-service',
      });

      expect(event.eventType).toBe('crm4.list.created');
      expect(event.aggregateType).toBe('marketing_list');
      expect(event.aggregateId).toBe(payload.listId);
      expect(event.correlationId).toBe('corr-list-001');
      expect(event.producer).toBe('crm-4-service');
      expect(event.payload).toEqual(payload);
      expect(ListCreatedPayloadSchema.parse(event.payload)).toEqual(payload);
    });

    it('creates and validates a crm4.list.updated event envelope', () => {
      const payload = {
        listId: '40000000-0000-4000-8000-000000000001',
        name: 'Enterprise VIP Accounts - Q4 Revised',
        description: 'Updated description',
        updatedAt: '2026-10-23T10:30:00.000Z',
      };

      const event = createListUpdatedEvent(payload);
      expect(event.eventType).toBe('crm4.list.updated');
      expect(event.aggregateId).toBe(payload.listId);
      expect(event.payload.name).toBe('Enterprise VIP Accounts - Q4 Revised');
      expect(ListUpdatedPayloadSchema.parse(event.payload)).toEqual(payload);
    });
  });

  describe('3. Campaign History Events', () => {
    it('creates and validates a crm4.campaign.created event envelope', () => {
      const payload = {
        campaignId: '41000000-0000-4000-8000-000000000001',
        name: 'Annual Cloud Transformation Summit',
        campaignDate: '2026-11-20',
        listId: '40000000-0000-4000-8000-000000000001',
        memberCount: 0,
        createdAt: '2026-10-23T10:00:00.000Z',
      };

      const event = createCampaignCreatedEvent(payload);
      expect(event.eventType).toBe('crm4.campaign.created');
      expect(event.aggregateType).toBe('campaign');
      expect(event.aggregateId).toBe(payload.campaignId);
      expect(event.payload.listId).toBe(payload.listId);
      expect(CampaignCreatedPayloadSchema.parse(event.payload)).toEqual(payload);
    });

    it('creates and validates a crm4.campaign.updated event envelope', () => {
      const payload = {
        campaignId: '41000000-0000-4000-8000-000000000001',
        name: 'Cloud Transformation Summit (Rescheduled)',
        campaignDate: '2026-11-25',
        updatedAt: '2026-10-23T11:00:00.000Z',
      };

      const event = createCampaignUpdatedEvent(payload);
      expect(event.eventType).toBe('crm4.campaign.updated');
      expect(event.aggregateId).toBe(payload.campaignId);
      expect(CampaignUpdatedPayloadSchema.parse(event.payload)).toEqual(payload);
    });
  });

  describe('4. Campaign Membership Events', () => {
    it('creates and validates a crm4.member.added event envelope', () => {
      const payload = {
        memberId: '42000000-0000-4000-8000-000000000001',
        campaignId: '41000000-0000-4000-8000-000000000001',
        contactId: '11111111-1111-4111-8111-000000000001',
        status: 'opened' as const,
        unsubscribed: false,
        createdAt: '2026-10-23T10:15:00.000Z',
      };

      const event = createMemberAddedEvent(payload);
      expect(event.eventType).toBe('crm4.member.added');
      expect(event.aggregateType).toBe('campaign_member');
      expect(event.payload.status).toBe('opened');
      expect(MemberAddedPayloadSchema.parse(event.payload)).toEqual(payload);
    });
  });

  describe('5. Consent & Monotonic Opt-Out Events (BR-CRM4-01)', () => {
    it('creates and validates a standard crm4.consent.recorded event', () => {
      const payload = {
        consentId: '43000000-0000-4000-8000-000000000001',
        contactId: '11111111-1111-4111-8111-000000000001',
        status: 'subscribed' as const,
        consentDate: '2026-10-23T10:00:00.000Z',
        source: 'webform_signup',
        createdAt: '2026-10-23T10:00:00.000Z',
      };

      const event = createConsentRecordedEvent(payload);
      expect(event.eventType).toBe('crm4.consent.recorded');
      expect(event.payload.status).toBe('subscribed');
      expect(ConsentRecordedPayloadSchema.parse(event.payload)).toEqual(payload);
    });

    it('creates and validates a dedicated crm4.consent.opted_out event for monotonic auditability', () => {
      const payload = {
        consentId: '43000000-0000-4000-8000-000000000002',
        contactId: '11111111-1111-4111-8111-000000000002',
        status: 'unsubscribed' as const,
        consentDate: '2026-10-23T10:00:00.000Z',
        source: 'email_campaign_unsubscribe_link',
        previousStatus: 'subscribed' as const,
        optedOutAt: '2026-10-23T10:00:00.000Z',
      };

      const event = createConsentOptedOutEvent(payload);
      expect(event.eventType).toBe('crm4.consent.opted_out');
      expect(event.payload.status).toBe('unsubscribed');
      expect(event.payload.previousStatus).toBe('subscribed');
      expect(ConsentOptedOutPayloadSchema.parse(event.payload)).toEqual(payload);
    });
  });

  describe('6. Migration Batch Events', () => {
    it('creates and validates a crm4.import.batch_loaded event envelope', () => {
      const payload = {
        batchId: '44444444-5555-4444-8444-000000000001',
        sourceSystem: 'legacy_marketing_csv',
        loadedCount: 75,
        rejectedCount: 17,
        completedAt: '2026-10-23T10:05:00.000Z',
      };

      const event = createCRM4ImportBatchLoadedEvent(payload);
      expect(event.eventType).toBe('crm4.import.batch_loaded');
      expect(event.aggregateType).toBe('import_batch');
      expect(event.payload.loadedCount).toBe(75);
      expect(event.payload.rejectedCount).toBe(17);
      expect(CRM4ImportBatchLoadedPayloadSchema.parse(event.payload)).toEqual(payload);
    });
  });
});
