
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
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
