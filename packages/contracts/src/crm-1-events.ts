import { z } from 'zod';
import {
  EventEnvelopeSchema,
  createEventEnvelope,
  type EventEnvelope,
} from './events.js';
import {
  CRM1ConsentStatusSchema,
  CRM1LeadStatusSchema,
} from './crm-1.js';

/**
 * CRM-1 Domain Event Taxonomy (Decision G1 & EV-08 / EV-12).
 * Conforms to standard outbox event envelope mandated by PLT-04 & PLT-09.
 */
export const CRM1EventTypes = {
  CONTACT_CREATED: 'crm.contact.created',
  CONTACT_UPDATED: 'crm.contact.updated',
  CONTACT_MERGED: 'crm.contact.merged',
  COMPANY_CREATED: 'crm.company.created',
  COMPANY_UPDATED: 'crm.company.updated',
  LEAD_CREATED: 'crm.lead.created',
  LEAD_STATUS_CHANGED: 'crm.lead.status_changed',
  CONTACT_CONSENT_CHANGED: 'crm.contact.consent_changed',
  IMPORT_BATCH_LOADED: 'crm.import.batch_loaded',
} as const;

export type CRM1EventType = (typeof CRM1EventTypes)[keyof typeof CRM1EventTypes];

export const CRM1EventTypeSchema = z.enum([
  'crm.contact.created',
  'crm.contact.updated',
  'crm.contact.merged',
  'crm.company.created',
  'crm.company.updated',
  'crm.lead.created',
  'crm.lead.status_changed',
  'crm.contact.consent_changed',
  'crm.import.batch_loaded',
]);

// ---------------------------------------------------------------------------
// 1. Event Payload Schemas
// ---------------------------------------------------------------------------

export const ContactCreatedPayloadSchema = z.object({
  contactId: z.string().uuid(),
  goldenId: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().nullable(),
  phone: z.string().nullable().optional(),
  companyId: z.string().uuid().nullable().optional(),
  leadStatus: CRM1LeadStatusSchema.nullable().optional(),
  sourceSystem: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
  consentStatus: CRM1ConsentStatusSchema.default('unknown'),
  createdAt: z.string().datetime(),
});
export type ContactCreatedPayload = z.infer<typeof ContactCreatedPayloadSchema>;

export const ContactUpdatedPayloadSchema = z.object({
  contactId: z.string().uuid(),
  goldenId: z.string().min(1),
  changes: z.record(z.string(), z.unknown()),
  previousState: z.record(z.string(), z.unknown()).optional(),
  updatedAt: z.string().datetime(),
});
export type ContactUpdatedPayload = z.infer<typeof ContactUpdatedPayloadSchema>;

export const ContactMergedPayloadSchema = z.object({
  survivorContactId: z.string().uuid(),
  mergedContactId: z.string().uuid(),
  survivorGoldenId: z.string().min(1),
  mergedGoldenId: z.string().min(1),
  humanReviewerId: z.string().min(1),
  reason: z.string().min(1),
  mergedAt: z.string().datetime(),
});
export type ContactMergedPayload = z.infer<typeof ContactMergedPayloadSchema>;

export const CompanyCreatedPayloadSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().min(1),
  taxNumber: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  sourceSystem: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type CompanyCreatedPayload = z.infer<typeof CompanyCreatedPayloadSchema>;

export const CompanyUpdatedPayloadSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().min(1).optional(),
  changes: z.record(z.string(), z.unknown()),
  updatedAt: z.string().datetime(),
});
export type CompanyUpdatedPayload = z.infer<typeof CompanyUpdatedPayloadSchema>;

export const LeadCreatedPayloadSchema = z.object({
  leadId: z.string().uuid(),
  contactId: z.string().uuid(),
  status: CRM1LeadStatusSchema,
  sourceSystem: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type LeadCreatedPayload = z.infer<typeof LeadCreatedPayloadSchema>;

export const LeadStatusChangedPayloadSchema = z.object({
  leadId: z.string().uuid(),
  contactId: z.string().uuid(),
  previousStatus: CRM1LeadStatusSchema,
  newStatus: CRM1LeadStatusSchema,
  changedAt: z.string().datetime(),
});
export type LeadStatusChangedPayload = z.infer<typeof LeadStatusChangedPayloadSchema>;

export const ContactConsentChangedPayloadSchema = z.object({
  contactId: z.string().uuid(),
  previousConsent: CRM1ConsentStatusSchema.optional(),
  newConsent: CRM1ConsentStatusSchema,
  consentUpdatedAt: z.string().datetime().nullable(),
  unsubscribed: z.boolean(),
  unsubscribedUpdatedAt: z.string().datetime().nullable(),
  changedAt: z.string().datetime(),
});
export type ContactConsentChangedPayload = z.infer<typeof ContactConsentChangedPayloadSchema>;

export const ImportBatchLoadedPayloadSchema = z.object({
  batchId: z.string().uuid(),
  sourceSystem: z.string().min(1),
  status: z.enum(['completed', 'failed', 'halted']),
  loadedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  completedAt: z.string().datetime(),
});
export type ImportBatchLoadedPayload = z.infer<typeof ImportBatchLoadedPayloadSchema>;

function buildEnvelopeParams<T extends Record<string, unknown>>(
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: T,
  options?: { id?: string; correlationId?: string; causationId?: string; timestamp?: string }
): Parameters<typeof createEventEnvelope<T>>[0] {
  const params: Parameters<typeof createEventEnvelope<T>>[0] = {
    eventType,
    aggregateType,
    aggregateId,
    payload,
    producer: 'crm-1',
  };
  if (options?.id !== undefined) params.id = options.id;
  if (options?.correlationId !== undefined) params.correlationId = options.correlationId;
  if (options?.causationId !== undefined) params.causationId = options.causationId;
  if (options?.timestamp !== undefined) params.timestamp = options.timestamp;
  return params;
}

export function createContactCreatedEvent(
  payload: ContactCreatedPayload,
  options?: { id?: string; correlationId?: string; causationId?: string; timestamp?: string }
): EventEnvelope<ContactCreatedPayload> {
  ContactCreatedPayloadSchema.parse(payload);
  return createEventEnvelope<ContactCreatedPayload>(
    buildEnvelopeParams(
      CRM1EventTypes.CONTACT_CREATED,
      'Contact',
      payload.contactId,
      payload,
      options
    )
  );
}

export function createContactUpdatedEvent(
  payload: ContactUpdatedPayload,
  options?: { id?: string; correlationId?: string; causationId?: string; timestamp?: string }
): EventEnvelope<ContactUpdatedPayload> {
  ContactUpdatedPayloadSchema.parse(payload);
  return createEventEnvelope<ContactUpdatedPayload>(
    buildEnvelopeParams(
      CRM1EventTypes.CONTACT_UPDATED,
      'Contact',
      payload.contactId,
      payload,
      options
    )
  );
}

export function createContactMergedEvent(
  payload: ContactMergedPayload,
  options?: { id?: string; correlationId?: string; causationId?: string; timestamp?: string }
): EventEnvelope<ContactMergedPayload> {
  ContactMergedPayloadSchema.parse(payload);
  return createEventEnvelope<ContactMergedPayload>(
    buildEnvelopeParams(
      CRM1EventTypes.CONTACT_MERGED,
      'Contact',
      payload.survivorContactId,
      payload,
      options
    )
  );
}

export function createCompanyCreatedEvent(
  payload: CompanyCreatedPayload,
  options?: { id?: string; correlationId?: string; causationId?: string; timestamp?: string }
): EventEnvelope<CompanyCreatedPayload> {
  CompanyCreatedPayloadSchema.parse(payload);
  return createEventEnvelope<CompanyCreatedPayload>(
    buildEnvelopeParams(
      CRM1EventTypes.COMPANY_CREATED,
      'Company',
      payload.companyId,
      payload,
      options
    )
  );
}

export function createCompanyUpdatedEvent(
  payload: CompanyUpdatedPayload,
  options?: { id?: string; correlationId?: string; causationId?: string; timestamp?: string }
): EventEnvelope<CompanyUpdatedPayload> {
  CompanyUpdatedPayloadSchema.parse(payload);
  return createEventEnvelope<CompanyUpdatedPayload>(
    buildEnvelopeParams(
      CRM1EventTypes.COMPANY_UPDATED,
      'Company',
      payload.companyId,
      payload,
      options
    )
  );
}

export function createLeadCreatedEvent(
  payload: LeadCreatedPayload,
  options?: { id?: string; correlationId?: string; causationId?: string; timestamp?: string }
): EventEnvelope<LeadCreatedPayload> {
  LeadCreatedPayloadSchema.parse(payload);
  return createEventEnvelope<LeadCreatedPayload>(
    buildEnvelopeParams(
      CRM1EventTypes.LEAD_CREATED,
      'Lead',
      payload.leadId,
      payload,
      options
    )
  );
}

export function createLeadStatusChangedEvent(
  payload: LeadStatusChangedPayload,
  options?: { id?: string; correlationId?: string; causationId?: string; timestamp?: string }
): EventEnvelope<LeadStatusChangedPayload> {
  LeadStatusChangedPayloadSchema.parse(payload);
  return createEventEnvelope<LeadStatusChangedPayload>(
    buildEnvelopeParams(
      CRM1EventTypes.LEAD_STATUS_CHANGED,
      'Lead',
      payload.leadId,
      payload,
      options
    )
  );
}

export function createContactConsentChangedEvent(
  payload: ContactConsentChangedPayload,
  options?: { id?: string; correlationId?: string; causationId?: string; timestamp?: string }
): EventEnvelope<ContactConsentChangedPayload> {
  ContactConsentChangedPayloadSchema.parse(payload);
  return createEventEnvelope<ContactConsentChangedPayload>(
    buildEnvelopeParams(
      CRM1EventTypes.CONTACT_CONSENT_CHANGED,
      'Contact',
      payload.contactId,
      payload,
      options
    )
  );
}

export function createImportBatchLoadedEvent(
  payload: ImportBatchLoadedPayload,
  options?: { id?: string; correlationId?: string; causationId?: string; timestamp?: string }
): EventEnvelope<ImportBatchLoadedPayload> {
  ImportBatchLoadedPayloadSchema.parse(payload);
  return createEventEnvelope<ImportBatchLoadedPayload>(
    buildEnvelopeParams(
      CRM1EventTypes.IMPORT_BATCH_LOADED,
      'ImportBatch',
      payload.batchId,
      payload,
      options
    )
  );
}
