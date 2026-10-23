import { sql } from "drizzle-orm";
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
  uuid
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export const crm4Schema = pgSchema("crm4");

const sourcePairCheck = (
  tableName: string,
  sourceSystem: AnyPgColumn,
  sourceId: AnyPgColumn
) =>
  check(
    `${tableName}_source_pair_check`,
    sql`(${sourceSystem} IS NULL AND ${sourceId} IS NULL) OR
      (${sourceSystem} IS NOT NULL AND ${sourceId} IS NOT NULL AND
        length(btrim(${sourceSystem})) > 0 AND length(btrim(${sourceId})) > 0)`
  );

// ---------------------------------------------------------------------------
// 1. Marketing Lists Table
// ---------------------------------------------------------------------------
export const crm4Lists = crm4Schema.table(
  "crm4_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    campaignCount: integer("campaign_count").notNull().default(0),
    memberCount: integer("member_count").notNull().default(0),
    sourceSystem: text("source_system"),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("crm4_lists_name_nonempty_check", sql`length(btrim(${table.name})) > 0`),
    check("crm4_lists_campaign_count_check", sql`${table.campaignCount} >= 0`),
    check("crm4_lists_member_count_check", sql`${table.memberCount} >= 0`),
    sourcePairCheck("crm4_lists", table.sourceSystem, table.sourceId),
    uniqueIndex("crm4_lists_source_key").on(table.sourceSystem, table.sourceId),
    index("crm4_lists_name_idx").on(sql`lower(${table.name})`),
    index("crm4_lists_created_at_idx").on(sql`${table.createdAt} DESC`)
  ]
);

// ---------------------------------------------------------------------------
// 2. Campaigns Table
// ---------------------------------------------------------------------------
export const crm4Campaigns = crm4Schema.table(
  "crm4_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    campaignDate: date("campaign_date", { mode: "string" }).notNull(),
    listId: uuid("list_id")
      .notNull()
      .references(() => crm4Lists.id, { onDelete: "restrict" }),
    memberCount: integer("member_count").notNull().default(0),
    sourceSystem: text("source_system"),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("crm4_campaigns_name_nonempty_check", sql`length(btrim(${table.name})) > 0`),
    check("crm4_campaigns_member_count_check", sql`${table.memberCount} >= 0`),
    sourcePairCheck("crm4_campaigns", table.sourceSystem, table.sourceId),
    uniqueIndex("crm4_campaigns_source_key").on(table.sourceSystem, table.sourceId),
    index("crm4_campaigns_list_id_idx").on(table.listId),
    index("crm4_campaigns_date_idx").on(table.campaignDate),
    index("crm4_campaigns_created_at_idx").on(sql`${table.createdAt} DESC`)
  ]
);

// ---------------------------------------------------------------------------
// 3. Campaign Members Table
// ---------------------------------------------------------------------------
export const crm4Members = crm4Schema.table(
  "crm4_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => crm4Campaigns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull(),
    status: text("status").notNull().default("sent"),
    unsubscribed: boolean("unsubscribed").notNull().default(false),
    sourceSystem: text("source_system"),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check(
      "crm4_members_status_check",
      sql`${table.status} IN ('sent', 'opened', 'clicked')`
    ),
    sourcePairCheck("crm4_members", table.sourceSystem, table.sourceId),
    uniqueIndex("crm4_members_campaign_contact_key").on(table.campaignId, table.contactId),
    uniqueIndex("crm4_members_source_key").on(table.sourceSystem, table.sourceId),
    index("crm4_members_campaign_id_idx").on(table.campaignId),
    index("crm4_members_contact_id_idx").on(table.contactId),
    index("crm4_members_status_idx").on(table.status),
    index("crm4_members_created_at_idx").on(sql`${table.createdAt} DESC`)
  ]
);

// ---------------------------------------------------------------------------
// 4. Contact Consent Records Table (BR-CRM4-01 monotonic opt-out)
// ---------------------------------------------------------------------------
export const crm4Consents = crm4Schema.table(
  "crm4_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id").notNull(),
    status: text("status").notNull(),
    consentDate: timestamp("consent_date", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull(),
    sourceSystem: text("source_system"),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check(
      "crm4_consents_status_check",
      sql`${table.status} IN ('subscribed', 'unsubscribed')`
    ),
    check("crm4_consents_source_nonempty_check", sql`length(btrim(${table.source})) > 0`),
    sourcePairCheck("crm4_consents", table.sourceSystem, table.sourceId),
    uniqueIndex("crm4_consents_contact_id_key").on(table.contactId),
    uniqueIndex("crm4_consents_source_key").on(table.sourceSystem, table.sourceId),
    index("crm4_consents_status_idx").on(table.status),
    index("crm4_consents_updated_at_idx").on(sql`${table.updatedAt} DESC`)
  ]
);

// ---------------------------------------------------------------------------
// 5. CRM-4 Import Batches (Migration Kit integration)
// ---------------------------------------------------------------------------
export const crm4ImportBatches = crm4Schema.table(
  "crm4_import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSystem: text("source_system").notNull(),
    status: text("status").notNull().default("pending"),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash"),
    loadedCount: integer("loaded_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [
    check("crm4_import_batches_source_system_nonempty_check", sql`length(btrim(${table.sourceSystem})) > 0`),
    check("crm4_import_batches_status_check", sql`${table.status} IN ('pending', 'processing', 'completed', 'failed')`),
    check("crm4_import_batches_loaded_count_check", sql`${table.loadedCount} >= 0`),
    check("crm4_import_batches_rejected_count_check", sql`${table.rejectedCount} >= 0`),
    check(
      "crm4_import_batches_idempotency_pair_check",
      sql`(${table.idempotencyKey} IS NULL AND ${table.requestHash} IS NULL) OR
        (${table.idempotencyKey} IS NOT NULL AND length(btrim(${table.idempotencyKey})) > 0 AND
         ${table.requestHash} IS NOT NULL AND length(btrim(${table.requestHash})) > 0)`
    ),
    uniqueIndex("crm4_import_batches_idempotency_key").on(table.idempotencyKey),
    index("crm4_import_batches_created_at_idx").on(sql`${table.createdAt} DESC`)
  ]
);

// ---------------------------------------------------------------------------
// 6. CRM-4 Import Receipts (Durable idempotency receipts)
// ---------------------------------------------------------------------------
export const crm4ImportReceipts = crm4Schema.table(
  "crm4_import_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => crm4ImportBatches.id, { onDelete: "cascade" }),
    sourceRow: integer("source_row").notNull(),
    entity: text("entity").notNull(),
    sourceSystem: text("source_system").notNull(),
    sourceId: text("source_id").notNull(),
    targetId: uuid("target_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("crm4_import_receipts_source_row_check", sql`${table.sourceRow} > 0`),
    check("crm4_import_receipts_entity_check", sql`${table.entity} IN ('list', 'campaign', 'member', 'consent')`),
    check("crm4_import_receipts_source_system_nonempty_check", sql`length(btrim(${table.sourceSystem})) > 0`),
    check("crm4_import_receipts_source_id_nonempty_check", sql`length(btrim(${table.sourceId})) > 0`),
    check("crm4_import_receipts_idempotency_key_nonempty_check", sql`length(btrim(${table.idempotencyKey})) > 0`),
    uniqueIndex("crm4_import_receipts_idempotency_key").on(table.idempotencyKey),
    uniqueIndex("crm4_import_receipts_batch_row_entity_key").on(table.batchId, table.sourceRow, table.entity),
    index("crm4_import_receipts_target_id_idx").on(table.targetId),
    index("crm4_import_receipts_created_at_idx").on(sql`${table.createdAt} DESC`)
  ]
);

// Semantic aliases for cross-module or alternative references
export const crm4CampaignMembers = crm4Members;
export const crm4ConsentRecords = crm4Consents;
