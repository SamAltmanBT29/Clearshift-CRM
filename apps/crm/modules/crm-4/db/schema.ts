import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * PostgreSQL schema 'crm4' per SDS ClearShift CRM v2.0 §4 / Data Dictionary
 */
export const crm4Schema = pgSchema('crm4');

// ---------------------------------------------------------------------------
// 1. Marketing Lists (crm4_lists)
// ---------------------------------------------------------------------------
export const crm4Lists = crm4Schema.table(
  'crm4_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    campaignCount: integer('campaign_count').notNull().default(0),
    memberCount: integer('member_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('chk_crm4_lists_name_nonempty', sql`length(btrim(${table.name})) > 0`),
    check('chk_crm4_lists_campaign_count_nonnegative', sql`${table.campaignCount} >= 0`),
    check('chk_crm4_lists_member_count_nonnegative', sql`${table.memberCount} >= 0`),
    index('idx_crm4_lists_name_search').on(sql`lower(${table.name})`),
    index('idx_crm4_lists_created_at').on(sql`${table.createdAt} DESC`),
  ]
);

// ---------------------------------------------------------------------------
// 2. Campaigns (crm4_campaigns)
// ---------------------------------------------------------------------------
export const crm4Campaigns = crm4Schema.table(
  'crm4_campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    campaignDate: date('campaign_date').notNull(),
    listId: uuid('list_id')
      .notNull()
      .references(() => crm4Lists.id, { onDelete: 'restrict' }),
    memberCount: integer('member_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('chk_crm4_campaigns_name_nonempty', sql`length(btrim(${table.name})) > 0`),
    check('chk_crm4_campaigns_member_count_nonnegative', sql`${table.memberCount} >= 0`),
    index('idx_crm4_campaigns_list_id').on(table.listId),
    index('idx_crm4_campaigns_date').on(table.campaignDate),
    index('idx_crm4_campaigns_created_at').on(sql`${table.createdAt} DESC`),
  ]
);

// ---------------------------------------------------------------------------
// 3. Campaign Members (crm4_members)
// ---------------------------------------------------------------------------
export const crm4Members = crm4Schema.table(
  'crm4_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => crm4Campaigns.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').notNull(),
    status: text('status').notNull().default('sent'),
    unsubscribed: boolean('unsubscribed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'chk_crm4_members_status_valid',
      sql`${table.status} IN ('sent', 'opened', 'clicked')`
    ),
    uniqueIndex('idx_crm4_members_campaign_contact').on(table.campaignId, table.contactId),
    index('idx_crm4_members_campaign_id').on(table.campaignId),
    index('idx_crm4_members_contact_id').on(table.contactId),
    index('idx_crm4_members_status').on(table.status),
    index('idx_crm4_members_created_at').on(sql`${table.createdAt} DESC`),
  ]
);

// ---------------------------------------------------------------------------
// 4. Contact Consents (crm4_consents)
// ---------------------------------------------------------------------------
export const crm4Consents = crm4Schema.table(
  'crm4_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id').notNull(),
    status: text('status').notNull().default('subscribed'),
    consentDate: timestamp('consent_date', { withTimezone: true }).notNull().defaultNow(),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'chk_crm4_consents_status_valid',
      sql`${table.status} IN ('subscribed', 'unsubscribed')`
    ),
    check('chk_crm4_consents_source_nonempty', sql`length(btrim(${table.source})) > 0`),
    uniqueIndex('idx_crm4_consents_contact_id').on(table.contactId),
    index('idx_crm4_consents_status').on(table.status),
    index('idx_crm4_consents_updated_at').on(sql`${table.updatedAt} DESC`),
  ]
);

// ---------------------------------------------------------------------------
// 5. Migration Import Batches (crm4_import_batches)
// ---------------------------------------------------------------------------
export const crm4ImportBatches = crm4Schema.table(
  'crm4_import_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceSystem: text('source_system').notNull(),
    status: text('status').notNull().default('pending'),
    idempotencyKey: text('idempotency_key'),
    requestHash: text('request_hash'),
    loadedCount: integer('loaded_count').notNull().default(0),
    rejectedCount: integer('rejected_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'chk_crm4_import_batches_source_system_nonempty',
      sql`length(btrim(${table.sourceSystem})) > 0`
    ),
    check(
      'chk_crm4_import_batches_status_valid',
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed')`
    ),
    check(
      'chk_crm4_import_batches_idempotency_pair',
      sql`(${table.idempotencyKey} IS NULL AND ${table.requestHash} IS NULL) OR
        (${table.idempotencyKey} IS NOT NULL AND length(btrim(${table.idempotencyKey})) > 0 AND
          ${table.requestHash} IS NOT NULL AND length(btrim(${table.requestHash})) > 0)`
    ),
    check('chk_crm4_import_batches_loaded_nonnegative', sql`${table.loadedCount} >= 0`),
    check('chk_crm4_import_batches_rejected_nonnegative', sql`${table.rejectedCount} >= 0`),
    uniqueIndex('idx_crm4_import_batches_idempotency').on(table.idempotencyKey),
    index('idx_crm4_import_batches_created_at').on(table.createdAt),
  ]
);

// ---------------------------------------------------------------------------
// 6. Migration Import Receipts (crm4_import_receipts)
// ---------------------------------------------------------------------------
export const crm4ImportReceipts = crm4Schema.table(
  'crm4_import_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => crm4ImportBatches.id, { onDelete: 'cascade' }),
    sourceRow: integer('source_row').notNull(),
    entity: text('entity').notNull(),
    sourceSystem: text('source_system').notNull(),
    sourceId: text('source_id').notNull(),
    targetId: uuid('target_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('chk_crm4_import_receipts_source_row_positive', sql`${table.sourceRow} > 0`),
    check(
      'chk_crm4_import_receipts_entity_valid',
      sql`${table.entity} IN ('list', 'campaign', 'member', 'consent')`
    ),
    check(
      'chk_crm4_import_receipts_source_system_nonempty',
      sql`length(btrim(${table.sourceSystem})) > 0`
    ),
    check(
      'chk_crm4_import_receipts_source_id_nonempty',
      sql`length(btrim(${table.sourceId})) > 0`
    ),
    check(
      'chk_crm4_import_receipts_idempotency_nonempty',
      sql`length(btrim(${table.idempotencyKey})) > 0`
    ),
    uniqueIndex('idx_crm4_import_receipts_idempotency').on(table.idempotencyKey),
    uniqueIndex('idx_crm4_import_receipts_batch_row_entity').on(
      table.batchId,
      table.sourceRow,
      table.entity
    ),
    index('idx_crm4_import_receipts_target_id').on(table.targetId),
  ]
);

// ---------------------------------------------------------------------------
// 7. Migration Import Rejects (crm4_import_rejects)
// ---------------------------------------------------------------------------
export const crm4ImportRejects = crm4Schema.table(
  'crm4_import_rejects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => crm4ImportBatches.id, { onDelete: 'cascade' }),
    sourceRow: integer('source_row').notNull(),
    entity: text('entity').notNull(),
    reasonCode: text('reason_code').notNull(),
    message: text('message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('chk_crm4_import_rejects_source_row_positive', sql`${table.sourceRow} > 0`),
    check(
      'chk_crm4_import_rejects_entity_valid',
      sql`${table.entity} IN ('list', 'campaign', 'member', 'consent')`
    ),
    check(
      'chk_crm4_import_rejects_reason_code_nonempty',
      sql`length(btrim(${table.reasonCode})) > 0`
    ),
    check(
      'chk_crm4_import_rejects_message_nonempty',
      sql`length(btrim(${table.message})) > 0`
    ),
    index('idx_crm4_import_rejects_batch_id').on(table.batchId),
  ]
);

// Aliases for conveniency and consistency
export const crm4MarketingLists = crm4Lists;
export const crm4MarketingCampaigns = crm4Campaigns;
export const crm4CampaignMembers = crm4Members;
export const crm4ContactConsents = crm4Consents;
export const crm4ConsentRecords = crm4Consents;
