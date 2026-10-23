
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgSchema,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

export const crm2Schema = pgSchema("crm2");

export const crm2Stages = crm2Schema.table(
  "crm2_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    position: smallint("position").notNull(),
    isWon: boolean("is_won").notNull().default(false)
  },
  (table) => [
    check(
      "crm2_stages_name_check",
      sql`${table.name} IN ('New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost')`
    ),
    check(
      "crm2_stages_position_check",
      sql`${table.position} BETWEEN 1 AND 6`
    ),
    check(
      "crm2_stages_won_check",
      sql`${table.isWon} = (${table.name} = 'Won')`
    ),
    uniqueIndex("crm2_stages_name_key").on(table.name),
    uniqueIndex("crm2_stages_position_key").on(table.position)
  ]
);

export const crm2Deals = crm2Schema.table(
  "crm2_deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    contactId: uuid("contact_id"),
    value: numeric("value", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => crm2Stages.id, { onDelete: "restrict" }),
    closeDate: date("close_date"),
    sourceSystem: text("source_system"),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", {
      withTimezone: true
    }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    check(
      "crm2_deals_name_nonempty_check",
      sql`length(btrim(${table.name})) > 0`
    ),
    check(
      "crm2_deals_value_nonnegative_check",
      sql`${table.value} >= 0`
    ),
    check(
      "crm2_deals_currency_check",
      sql`${table.currency} ~ '^[A-Z]{3}$'`
    ),
    check(
      "crm2_deals_source_pair_check",
      sql`(
        ${table.sourceSystem} IS NULL AND ${table.sourceId} IS NULL
      ) OR (
        ${table.sourceSystem} IS NOT NULL AND
        ${table.sourceId} IS NOT NULL AND
        length(btrim(${table.sourceSystem})) > 0 AND
        length(btrim(${table.sourceId})) > 0
      )`
    ),
    uniqueIndex("crm2_deals_source_key").on(
      table.sourceSystem,
      table.sourceId
    ),
    index("crm2_deals_name_search_idx").on(
      sql`lower(${table.name})`
    ),
    index("crm2_deals_contact_id_idx").on(table.contactId),
    index("crm2_deals_stage_id_idx").on(table.stageId),
    index("crm2_deals_close_date_idx").on(table.closeDate)
  ]
);

export const crm2Quotes = crm2Schema.table(
  "crm2_quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteNumber: text("quote_number").notNull(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => crm2Deals.id, { onDelete: "restrict" }),
    quoteDate: date("quote_date").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    note: text("note"),
    sourceSystem: text("source_system"),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", {
      withTimezone: true
    }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    check(
      "crm2_quotes_number_nonempty_check",
      sql`length(btrim(${table.quoteNumber})) > 0`
    ),
    check(
      "crm2_quotes_amount_nonnegative_check",
      sql`${table.amount} >= 0`
    ),
    check(
      "crm2_quotes_source_pair_check",
      sql`(
        ${table.sourceSystem} IS NULL AND ${table.sourceId} IS NULL
      ) OR (
        ${table.sourceSystem} IS NOT NULL AND
        ${table.sourceId} IS NOT NULL AND
        length(btrim(${table.sourceSystem})) > 0 AND
        length(btrim(${table.sourceId})) > 0
      )`
    ),
    uniqueIndex("crm2_quotes_quote_number_key").on(table.quoteNumber),
    uniqueIndex("crm2_quotes_source_key").on(
      table.sourceSystem,
      table.sourceId
    ),
    index("crm2_quotes_deal_id_idx").on(table.dealId),
    index("crm2_quotes_quote_date_idx").on(table.quoteDate)
  ]
);

export const crm2QuoteLines = crm2Schema.table(
  "crm2_quote_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => crm2Quotes.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),
    productId: uuid("product_id"),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull().default("1.0000"),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
    lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("crm2_quote_lines_number_check", sql`${table.lineNumber} > 0`),
    check("crm2_quote_lines_description_nonempty_check", sql`length(btrim(${table.description})) > 0`),
    check("crm2_quote_lines_quantity_positive_check", sql`${table.quantity} > 0`),
    check("crm2_quote_lines_unit_price_nonnegative_check", sql`${table.unitPrice} >= 0`),
    check("crm2_quote_lines_line_total_nonnegative_check", sql`${table.lineTotal} >= 0`),
    uniqueIndex("crm2_quote_lines_quote_line_key").on(table.quoteId, table.lineNumber),
    index("crm2_quote_lines_quote_id_idx").on(table.quoteId)
  ]
);

export const crm2ImportBatches = crm2Schema.table(
  "crm2_import_batches",
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
    check("crm2_import_batches_source_system_nonempty_check", sql`length(btrim(${table.sourceSystem})) > 0`),
    check("crm2_import_batches_status_check", sql`${table.status} IN ('pending', 'processing', 'completed', 'failed')`),
    check(
      "crm2_import_batches_idempotency_pair_check",
      sql`(${table.idempotencyKey} IS NULL AND ${table.requestHash} IS NULL) OR
        (${table.idempotencyKey} IS NOT NULL AND length(btrim(${table.idempotencyKey})) > 0 AND
          ${table.requestHash} IS NOT NULL AND length(btrim(${table.requestHash})) > 0)`
    ),
    check("crm2_import_batches_loaded_count_check", sql`${table.loadedCount} >= 0`),
    check("crm2_import_batches_rejected_count_check", sql`${table.rejectedCount} >= 0`),
    uniqueIndex("crm2_import_batches_idempotency_key").on(table.idempotencyKey),
    index("crm2_import_batches_created_at_idx").on(table.createdAt)
  ]
);

export const crm2ImportReceipts = crm2Schema.table(
  "crm2_import_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => crm2ImportBatches.id, { onDelete: "cascade" }),
    sourceRow: integer("source_row").notNull(),
    entity: text("entity").notNull(),
    sourceSystem: text("source_system").notNull(),
    sourceId: text("source_id").notNull(),
    targetId: uuid("target_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("crm2_import_receipts_source_row_check", sql`${table.sourceRow} > 0`),
    check("crm2_import_receipts_entity_check", sql`${table.entity} IN ('deal', 'quote', 'stage', 'quote_line')`),
    check("crm2_import_receipts_source_system_nonempty_check", sql`length(btrim(${table.sourceSystem})) > 0`),
    check("crm2_import_receipts_source_id_nonempty_check", sql`length(btrim(${table.sourceId})) > 0`),
    check("crm2_import_receipts_idempotency_key_nonempty_check", sql`length(btrim(${table.idempotencyKey})) > 0`),
    uniqueIndex("crm2_import_receipts_idempotency_key").on(table.idempotencyKey),
    uniqueIndex("crm2_import_receipts_batch_row_entity_key").on(
      table.batchId,
      table.sourceRow,
      table.entity
    ),
    index("crm2_import_receipts_target_id_idx").on(table.targetId)
  ]
);

export const crm2ImportRejects = crm2Schema.table(
  "crm2_import_rejects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => crm2ImportBatches.id, { onDelete: "cascade" }),
    sourceRow: integer("source_row").notNull(),
    entity: text("entity").notNull(),
    reasonCode: text("reason_code").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("crm2_import_rejects_source_row_check", sql`${table.sourceRow} > 0`),
    check("crm2_import_rejects_entity_check", sql`${table.entity} IN ('deal', 'quote', 'stage', 'quote_line')`),
    check("crm2_import_rejects_reason_code_nonempty_check", sql`length(btrim(${table.reasonCode})) > 0`),
    check("crm2_import_rejects_message_nonempty_check", sql`length(btrim(${table.message})) > 0`),
    index("crm2_import_rejects_batch_id_idx").on(table.batchId)
  ]
);
