import { z } from 'zod';
import {
  createEventEnvelope,
  type EventEnvelope,
} from './events.js';
import {
  CRM4MemberStatusSchema,
  CRM4ConsentStatusSchema,
} from './crm-4.js';

/**
 * CRM-4 Domain Event Taxonomy (Decision G1 & SDS ClearShift CRM v2.0 §4 / §7.1).
 * Conforms to standard outbox event envelope mandated by PLT-04 & PLT-09.
 */
export const CRM4EventTypes = {
  LIST_CREATED: 'crm4.list.created',
  LIST_UPDATED: 'crm4.list.updated',
  CAMPAIGN_CREATED: 'crm4.campaign.created',
  CAMPAIGN_UPDATED: 'crm4.campaign.updated',
  MEMBER_ADDED: 'crm4.member.added',
  CONSENT_RECORDED: 'crm4.consent.recorded',
  CONSENT_OPTED_OUT: 'crm4.consent.opted_out',
  IMPORT_BATCH_LOADED: 'crm4.import.batch_loaded',
} as const;

export type CRM4EventType = (typeof CRM4EventTypes)[keyof typeof CRM4EventTypes];

export const CRM4EventTypeSchema = z.enum([
  'crm4.list.created',
  'crm4.list.updated',
  'crm4.campaign.created',
  'crm4.campaign.updated',
  'crm4.member.added',
  'crm4.consent.recorded',
  'crm4.consent.opted_out',
  'crm4.import.batch_loaded',
]);

// ---------------------------------------------------------------------------
// 1. Event Payload Schemas
// ---------------------------------------------------------------------------

export const ListCreatedPayloadSchema = z.object({
  listId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  campaignCount: z.number().int().nonnegative().default(0),
  memberCount: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
});
export type ListCreatedPayload = z.infer<typeof ListCreatedPayloadSchema>;

export const ListUpdatedPayloadSchema = z.object({
  listId: z.string().uuid(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  updatedAt: z.string().datetime(),
});
export type ListUpdatedPayload = z.infer<typeof ListUpdatedPayloadSchema>;

export const CampaignCreatedPayloadSchema = z.object({
  campaignId: z.string().uuid(),
  name: z.string().min(1),
  campaignDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  listId: z.string().uuid(),
  memberCount: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
});
export type CampaignCreatedPayload = z.infer<typeof CampaignCreatedPayloadSchema>;

export const CampaignUpdatedPayloadSchema = z.object({
  campaignId: z.string().uuid(),
  name: z.string().min(1).optional(),
  campaignDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  updatedAt: z.string().datetime(),
});
export type CampaignUpdatedPayload = z.infer<typeof CampaignUpdatedPayloadSchema>;

export const MemberAddedPayloadSchema = z.object({
  memberId: z.string().uuid(),
  campaignId: z.string().uuid(),
  contactId: z.string().uuid(),
  status: CRM4MemberStatusSchema,
  unsubscribed: z.boolean().default(false),
  createdAt: z.string().datetime(),
});
export type MemberAddedPayload = z.infer<typeof MemberAddedPayloadSchema>;

export const ConsentRecordedPayloadSchema = z.object({
  consentId: z.string().uuid(),
  contactId: z.string().uuid(),
  status: CRM4ConsentStatusSchema,
  consentDate: z.string().datetime(),
  source: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type ConsentRecordedPayload = z.infer<typeof ConsentRecordedPayloadSchema>;

/**
 * Opt-Out event payload emitted when contact transitions to unsubscribed.
 * Enforces auditability and compliance with BR-CRM4-01 (Monotonic Opt-Out).
 */
export const ConsentOptedOutPayloadSchema = z.object({
  consentId: z.string().uuid(),
  contactId: z.string().uuid(),
  status: z.literal('unsubscribed'),
  consentDate: z.string().datetime(),
  source: z.string().min(1),
  previousStatus: CRM4ConsentStatusSchema.nullable().optional(),
  optedOutAt: z.string().datetime(),
});
export type ConsentOptedOutPayload = z.infer<typeof ConsentOptedOutPayloadSchema>;

export const CRM4ImportBatchLoadedPayloadSchema = z.object({
  batchId: z.string().uuid(),
  sourceSystem: z.string().min(1),
  loadedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  completedAt: z.string().datetime(),
});
export type CRM4ImportBatchLoadedPayload = z.infer<typeof CRM4ImportBatchLoadedPayloadSchema>;

// ---------------------------------------------------------------------------
// 2. Strongly-Typed Event Constructors
// ---------------------------------------------------------------------------

export interface CRM4EventMeta {
  correlationId?: string;
  causationId?: string;
  producer?: string;
  timestamp?: string;
}

export function createListCreatedEvent(
  payload: ListCreatedPayload,
  meta?: CRM4EventMeta
): EventEnvelope<ListCreatedPayload> {
  ListCreatedPayloadSchema.parse(payload);
  return createEventEnvelope({
    eventType: CRM4EventTypes.LIST_CREATED,
    aggregateType: 'marketing_list',
    aggregateId: payload.listId,
    payload,
    ...meta,
  });
}

export function createListUpdatedEvent(
  payload: ListUpdatedPayload,
  meta?: CRM4EventMeta
): EventEnvelope<ListUpdatedPayload> {
  ListUpdatedPayloadSchema.parse(payload);
  return createEventEnvelope({
    eventType: CRM4EventTypes.LIST_UPDATED,
    aggregateType: 'marketing_list',
    aggregateId: payload.listId,
    payload,
    ...meta,
  });
}

export function createCampaignCreatedEvent(
  payload: CampaignCreatedPayload,
  meta?: CRM4EventMeta
): EventEnvelope<CampaignCreatedPayload> {
  CampaignCreatedPayloadSchema.parse(payload);
  return createEventEnvelope({
    eventType: CRM4EventTypes.CAMPAIGN_CREATED,
    aggregateType: 'campaign',
    aggregateId: payload.campaignId,
    payload,
    ...meta,
  });
}

export function createCampaignUpdatedEvent(
  payload: CampaignUpdatedPayload,
  meta?: CRM4EventMeta
): EventEnvelope<CampaignUpdatedPayload> {
  CampaignUpdatedPayloadSchema.parse(payload);
  return createEventEnvelope({
    eventType: CRM4EventTypes.CAMPAIGN_UPDATED,
    aggregateType: 'campaign',
    aggregateId: payload.campaignId,
    payload,
    ...meta,
  });
}

export function createMemberAddedEvent(
  payload: MemberAddedPayload,
  meta?: CRM4EventMeta
): EventEnvelope<MemberAddedPayload> {
  MemberAddedPayloadSchema.parse(payload);
  return createEventEnvelope({
    eventType: CRM4EventTypes.MEMBER_ADDED,
    aggregateType: 'campaign_member',
    aggregateId: payload.memberId,
    payload,
    ...meta,
  });
}

export function createConsentRecordedEvent(
  payload: ConsentRecordedPayload,
  meta?: CRM4EventMeta
): EventEnvelope<ConsentRecordedPayload> {
  ConsentRecordedPayloadSchema.parse(payload);
  return createEventEnvelope({
    eventType: CRM4EventTypes.CONSENT_RECORDED,
    aggregateType: 'consent',
    aggregateId: payload.consentId,
    payload,
    ...meta,
  });
}

export function createConsentOptedOutEvent(
  payload: ConsentOptedOutPayload,
  meta?: CRM4EventMeta
): EventEnvelope<ConsentOptedOutPayload> {
  ConsentOptedOutPayloadSchema.parse(payload);
  return createEventEnvelope({
    eventType: CRM4EventTypes.CONSENT_OPTED_OUT,
    aggregateType: 'consent',
    aggregateId: payload.consentId,
    payload,
    ...meta,
  });
}

export function createCRM4ImportBatchLoadedEvent(
  payload: CRM4ImportBatchLoadedPayload,
  meta?: CRM4EventMeta
): EventEnvelope<CRM4ImportBatchLoadedPayload> {
  CRM4ImportBatchLoadedPayloadSchema.parse(payload);
  return createEventEnvelope({
    eventType: CRM4EventTypes.IMPORT_BATCH_LOADED,
    aggregateType: 'import_batch',
    aggregateId: payload.batchId,
    payload,
    ...meta,
  });
}
