import { describe, expect, it } from 'vitest';
import {
  CRM1EventTypes,
  CRM1EventTypeSchema,
  ContactCreatedPayloadSchema,
  ContactUpdatedPayloadSchema,
  ContactMergedPayloadSchema,
  CompanyCreatedPayloadSchema,
  CompanyUpdatedPayloadSchema,
  LeadCreatedPayloadSchema,
  LeadStatusChangedPayloadSchema,
  ContactConsentChangedPayloadSchema,
  ImportBatchLoadedPayloadSchema,
  createContactCreatedEvent,
  createContactUpdatedEvent,
  createContactMergedEvent,
  createCompanyCreatedEvent,
  createCompanyUpdatedEvent,
  createLeadCreatedEvent,
  createLeadStatusChangedEvent,
  createContactConsentChangedEvent,
  createImportBatchLoadedEvent,
} from '../src/crm-1-events.js';

describe('CRM-1 Domain Events & Outbox Envelopes', () => {
  const dummyContactId = '11111111-1111-4111-8111-111111111111';
  const dummyCompanyId = '22222222-2222-4222-8222-222222222222';
  const dummyLeadId = '33333333-3333-4333-8333-333333333333';
  const dummyBatchId = '44444444-4444-4444-8444-444444444444';

  describe('Event Type Taxonomy', () => {
    it('defines all required CRM-1 domain event type constants', () => {
      expect(CRM1EventTypes.CONTACT_CREATED).toBe('crm.contact.created');
      expect(CRM1EventTypes.CONTACT_UPDATED).toBe('crm.contact.updated');
      expect(CRM1EventTypes.CONTACT_MERGED).toBe('crm.contact.merged');
      expect(CRM1EventTypes.COMPANY_CREATED).toBe('crm.company.created');
      expect(CRM1EventTypes.COMPANY_UPDATED).toBe('crm.company.updated');
      expect(CRM1EventTypes.LEAD_CREATED).toBe('crm.lead.created');
      expect(CRM1EventTypes.LEAD_STATUS_CHANGED).toBe('crm.lead.status_changed');
      expect(CRM1EventTypes.CONTACT_CONSENT_CHANGED).toBe('crm.contact.consent_changed');
      expect(CRM1EventTypes.IMPORT_BATCH_LOADED).toBe('crm.import.batch_loaded');
    });

    it('validates event types using CRM1EventTypeSchema enum', () => {
      for (const eventType of Object.values(CRM1EventTypes)) {
        expect(CRM1EventTypeSchema.safeParse(eventType).success).toBe(true);
      }
      expect(CRM1EventTypeSchema.safeParse('crm.invalid.event').success).toBe(false);
    });
  });

  describe('createContactCreatedEvent', () => {
    it('creates a compliant outbox envelope with producer crm-1', () => {
      const payload = {
        contactId: dummyContactId,
        goldenId: 'GID-SYNTH-001',
        firstName: 'Elena',
        lastName: 'Rostova',
        email: 'elena.rostova@clearshift.synthetic',
        phone: '+1-555-0199',
        companyId: dummyCompanyId,
        leadStatus: 'New' as const,
        sourceSystem: 'hubspot',
        sourceId: 'hs_101',
        consentStatus: 'granted' as const,
        createdAt: '2026-02-01T10:00:00.000Z',
      };

      const event = createContactCreatedEvent(payload, {
        correlationId: 'corr-001',
        causationId: 'cause-001',
      });

      expect(event.eventType).toBe('crm.contact.created');
      expect(event.aggregateType).toBe('Contact');
      expect(event.aggregateId).toBe(dummyContactId);
      expect(event.producer).toBe('crm-1');
      expect(event.correlationId).toBe('corr-001');
      expect(event.causationId).toBe('cause-001');
      expect(event.payload.email).toBe('elena.rostova@clearshift.synthetic');
      expect(event.version).toBe(1);
    });

    it('rejects invalid payload on contact created', () => {
      expect(() =>
        createContactCreatedEvent({
          contactId: 'not-a-uuid',
          goldenId: '',
          firstName: '',
          lastName: '',
          email: 'bad-email',
          createdAt: 'invalid-date',
          consentStatus: 'granted',
        } as any)
      ).toThrow();
    });
  });

  describe('createContactUpdatedEvent', () => {
    it('creates contact updated envelope with delta changes', () => {
      const payload = {
        contactId: dummyContactId,
        goldenId: 'GID-SYNTH-001',
        changes: {
          email: 'elena.updated@clearshift.synthetic',
          leadStatus: 'Working' as const,
        },
        updatedAt: '2026-02-01T11:00:00.000Z',
      };

      const event = createContactUpdatedEvent(payload);
      expect(event.eventType).toBe('crm.contact.updated');
      expect(event.aggregateType).toBe('Contact');
      expect(event.aggregateId).toBe(dummyContactId);
      expect(event.payload.changes.email).toBe('elena.updated@clearshift.synthetic');
    });
  });

  describe('createContactMergedEvent (EV-08)', () => {
    it('creates contact merged event envelope with survivor and retired IDs', () => {
      const payload = {
        survivorContactId: dummyContactId,
        mergedContactId: '55555555-5555-4555-8555-555555555555',
        survivorGoldenId: 'GID-SYNTH-001',
        mergedGoldenId: 'GID-SYNTH-002',
        reason: 'Deterministic exact match on email key confirmed by operator review',
        humanReviewerId: 'user-op-101',
        mergedAt: '2026-02-01T12:00:00.000Z',
      };

      const event = createContactMergedEvent(payload);
      expect(event.eventType).toBe('crm.contact.merged');
      expect(event.aggregateType).toBe('Contact');
      expect(event.aggregateId).toBe(dummyContactId);
      expect(event.payload.mergedContactId).toBe('55555555-5555-4555-8555-555555555555');
      expect(event.payload.humanReviewerId).toBe('user-op-101');
    });
  });

  describe('createCompanyCreatedEvent & createCompanyUpdatedEvent', () => {
    it('creates company created event with valid tax number', () => {
      const payload = {
        companyId: dummyCompanyId,
        name: 'Apex Robotics Inc',
        taxNumber: 'US-TAX-987654321',
        email: 'ops@apex.synthetic',
        phone: '+1-555-0800',
        createdAt: '2026-02-01T09:00:00.000Z',
      };

      const event = createCompanyCreatedEvent(payload);
      expect(event.eventType).toBe('crm.company.created');
      expect(event.aggregateType).toBe('Company');
      expect(event.aggregateId).toBe(dummyCompanyId);
      expect(event.payload.taxNumber).toBe('US-TAX-987654321');
    });

    it('creates company updated event with changed fields', () => {
      const payload = {
        companyId: dummyCompanyId,
        changes: {
          phone: '+1-555-0899',
        },
        updatedAt: '2026-02-01T09:30:00.000Z',
      };

      const event = createCompanyUpdatedEvent(payload);
      expect(event.eventType).toBe('crm.company.updated');
      expect(event.payload.changes.phone).toBe('+1-555-0899');
    });
  });

  describe('createLeadCreatedEvent & createLeadStatusChangedEvent', () => {
    it('creates lead created event with initial status New', () => {
      const payload = {
        leadId: dummyLeadId,
        contactId: dummyContactId,
        status: 'New' as const,
        sourceSystem: 'web_form',
        sourceId: 'wf_99',
        createdAt: '2026-02-01T08:00:00.000Z',
      };

      const event = createLeadCreatedEvent(payload);
      expect(event.eventType).toBe('crm.lead.created');
      expect(event.aggregateType).toBe('Lead');
      expect(event.aggregateId).toBe(dummyLeadId);
      expect(event.payload.status).toBe('New');
    });

    it('creates lead status changed event adhering to workflow transition', () => {
      const payload = {
        leadId: dummyLeadId,
        contactId: dummyContactId,
        previousStatus: 'New' as const,
        newStatus: 'Working' as const,
        changedAt: '2026-02-01T08:30:00.000Z',
      };

      const event = createLeadStatusChangedEvent(payload);
      expect(event.eventType).toBe('crm.lead.status_changed');
      expect(event.payload.previousStatus).toBe('New');
      expect(event.payload.newStatus).toBe('Working');
    });
  });

  describe('createContactConsentChangedEvent (EV-12)', () => {
    it('creates consent changed event for CRM-4 integration', () => {
      const payload = {
        contactId: dummyContactId,
        previousConsent: 'unknown' as const,
        newConsent: 'granted' as const,
        consentUpdatedAt: '2026-02-01T14:00:00.000Z',
        unsubscribed: false,
        unsubscribedUpdatedAt: null,
        changedAt: '2026-02-01T14:00:00.000Z',
      };

      const event = createContactConsentChangedEvent(payload);
      expect(event.eventType).toBe('crm.contact.consent_changed');
      expect(event.payload.newConsent).toBe('granted');
      expect(event.payload.unsubscribed).toBe(false);
    });
  });

  describe('createImportBatchLoadedEvent (EV-05)', () => {
    it('creates import batch loaded event for ingestion tracking', () => {
      const payload = {
        batchId: dummyBatchId,
        sourceSystem: 'salesforce_migration',
        status: 'completed' as const,
        loadedCount: 450,
        rejectedCount: 50,
        completedAt: '2026-02-01T16:00:00.000Z',
      };

      const event = createImportBatchLoadedEvent(payload);
      expect(event.eventType).toBe('crm.import.batch_loaded');
      expect(event.aggregateType).toBe('ImportBatch');
      expect(event.aggregateId).toBe(dummyBatchId);
      expect(event.payload.loadedCount).toBe(450);
      expect(event.payload.rejectedCount).toBe(50);
    });

    it('rejects negative loaded or rejected counts', () => {
      expect(() =>
        createImportBatchLoadedEvent({
          batchId: dummyBatchId,
          sourceSystem: 'csv',
          status: 'completed',
          loadedCount: -1,
          rejectedCount: 0,
          completedAt: '2026-02-01T16:00:00.000Z',
        } as any)
      ).toThrow();
    });
  });
});
