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
    index('idx_crm4_members_contact_id').on(table.contactId),
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
  ]
);

// Aliases for conveniency and consistency
export const crm4MarketingLists = crm4Lists;
export const crm4MarketingCampaigns = crm4Campaigns;
export const crm4CampaignMembers = crm4Members;
export const crm4ContactConsents = crm4Consents;
