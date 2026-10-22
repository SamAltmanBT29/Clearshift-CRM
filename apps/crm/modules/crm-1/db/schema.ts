import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  index,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export const crm1Schema = pgSchema("crm1");

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

export const crm1Companies = crm1Schema.table(
  "crm1_companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    taxNumber: text("tax_number"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    sourceSystem: text("source_system"),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("crm1_companies_name_nonempty_check", sql`length(btrim(${table.name})) > 0`),
    sourcePairCheck("crm1_companies", table.sourceSystem, table.sourceId),
    uniqueIndex("crm1_companies_source_key").on(table.sourceSystem, table.sourceId),
    index("crm1_companies_name_search_idx").on(sql`lower(${table.name})`)
  ]
);

export const crm1Contacts = crm1Schema.table(
  "crm1_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    companyId: uuid("company_id").references(() => crm1Companies.id, { onDelete: "restrict" }),
    leadStatus: text("lead_status"),
    goldenId: text("golden_id").notNull(),
    sourceSystem: text("source_system"),
    sourceId: text("source_id"),
    consentStatus: text("consent_status").notNull().default("unknown"),
    consentUpdatedAt: timestamp("consent_updated_at", { withTimezone: true }),
    unsubscribed: boolean("unsubscribed").notNull().default(false),
    unsubscribedUpdatedAt: timestamp("unsubscribed_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("crm1_contacts_first_name_nonempty_check", sql`length(btrim(${table.firstName})) > 0`),
    check("crm1_contacts_last_name_nonempty_check", sql`length(btrim(${table.lastName})) > 0`),
    check(
      "crm1_contacts_golden_id_nonempty_check",
      sql`length(btrim(${table.goldenId})) > 0`
    ),
    check(
      "crm1_contacts_lead_status_check",
      sql`${table.leadStatus} IS NULL OR ${table.leadStatus} IN ('New', 'Working', 'Qualified', 'Closed')`
    ),
    check(
      "crm1_contacts_consent_status_check",
      sql`${table.consentStatus} IN ('unknown', 'granted', 'withdrawn')`
    ),
    check(
      "crm1_contacts_consent_timestamp_check",
      sql`(${table.consentStatus} = 'unknown' AND ${table.consentUpdatedAt} IS NULL) OR
        (${table.consentStatus} <> 'unknown' AND ${table.consentUpdatedAt} IS NOT NULL)`
    ),
    check(
      "crm1_contacts_unsubscribed_timestamp_check",
      sql`${table.unsubscribed} = false OR ${table.unsubscribedUpdatedAt} IS NOT NULL`
    ),
    sourcePairCheck("crm1_contacts", table.sourceSystem, table.sourceId),
    uniqueIndex("crm1_contacts_golden_id_key").on(table.goldenId),
    uniqueIndex("crm1_contacts_source_key").on(table.sourceSystem, table.sourceId),
    index("crm1_contacts_name_search_idx").on(
      sql`lower(${table.firstName})`,
      sql`lower(${table.lastName})`
    ),
    index("crm1_contacts_email_search_idx").on(sql`lower(${table.email})`),
    index("crm1_contacts_company_id_idx").on(table.companyId)
  ]
);

export const crm1Leads = crm1Schema.table(
  "crm1_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => crm1Contacts.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    sourceSystem: text("source_system"),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check(
      "crm1_leads_status_check",
      sql`${table.status} IN ('New', 'Working', 'Qualified', 'Closed')`
    ),
    sourcePairCheck("crm1_leads", table.sourceSystem, table.sourceId),
    uniqueIndex("crm1_leads_source_key").on(table.sourceSystem, table.sourceId),
    index("crm1_leads_contact_id_idx").on(table.contactId),
    index("crm1_leads_status_idx").on(table.status)
  ]
);

export const crm1ImportBatches = crm1Schema.table(
  "crm1_import_batches",
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
    check(
      "crm1_import_batches_source_system_nonempty_check",
      sql`length(btrim(${table.sourceSystem})) > 0`
    ),
    check(
      "crm1_import_batches_status_check",
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed')`
    ),
    check(
      "crm1_import_batches_idempotency_pair_check",
      sql`(${table.idempotencyKey} IS NULL AND ${table.requestHash} IS NULL) OR
        (${table.idempotencyKey} IS NOT NULL AND length(btrim(${table.idempotencyKey})) > 0 AND
          ${table.requestHash} IS NOT NULL AND length(btrim(${table.requestHash})) > 0)`
    ),
    check(
      "crm1_import_batches_loaded_count_check",
      sql`${table.loadedCount} >= 0`
    ),
    check(
      "crm1_import_batches_rejected_count_check",
      sql`${table.rejectedCount} >= 0`
    ),
    uniqueIndex("crm1_import_batches_idempotency_key").on(table.idempotencyKey),
    index("crm1_import_batches_created_at_idx").on(table.createdAt)
  ]
);

export const crm1ImportReceipts = crm1Schema.table(
  "crm1_import_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => crm1ImportBatches.id, { onDelete: "cascade" }),
    sourceRow: integer("source_row").notNull(),
    entity: text("entity").notNull(),
    sourceSystem: text("source_system").notNull(),
    sourceId: text("source_id").notNull(),
    targetId: uuid("target_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("crm1_import_receipts_source_row_check", sql`${table.sourceRow} > 0`),
    check(
      "crm1_import_receipts_entity_check",
      sql`${table.entity} IN ('contact', 'company', 'lead')`
    ),
    check(
      "crm1_import_receipts_source_system_nonempty_check",
      sql`length(btrim(${table.sourceSystem})) > 0`
    ),
    check(
      "crm1_import_receipts_source_id_nonempty_check",
      sql`length(btrim(${table.sourceId})) > 0`
    ),
    check(
      "crm1_import_receipts_idempotency_key_nonempty_check",
      sql`length(btrim(${table.idempotencyKey})) > 0`
    ),
    uniqueIndex("crm1_import_receipts_idempotency_key").on(table.idempotencyKey),
    uniqueIndex("crm1_import_receipts_batch_row_entity_key").on(
      table.batchId,
      table.sourceRow,
      table.entity
    ),
    index("crm1_import_receipts_target_id_idx").on(table.targetId)
  ]
);

export const crm1ImportRejects = crm1Schema.table(
  "crm1_import_rejects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => crm1ImportBatches.id, { onDelete: "cascade" }),
    sourceRow: integer("source_row").notNull(),
    entity: text("entity").notNull(),
    reasonCode: text("reason_code").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("crm1_import_rejects_source_row_check", sql`${table.sourceRow} > 0`),
    check(
      "crm1_import_rejects_entity_check",
      sql`${table.entity} IN ('contact', 'company', 'lead')`
    ),
    check(
      "crm1_import_rejects_reason_code_nonempty_check",
      sql`length(btrim(${table.reasonCode})) > 0`
    ),
    check(
      "crm1_import_rejects_message_nonempty_check",
      sql`length(btrim(${table.message})) > 0`
    ),
    index("crm1_import_rejects_batch_id_idx").on(table.batchId)
  ]
);
