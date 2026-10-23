import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export const crm3Schema = pgSchema("crm3");

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

export const crm3Tickets = crm3Schema.table(
  "crm3_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subject: text("subject").notNull(),
    status: text("status").notNull().default("New"),
    priority: text("priority").notNull().default("Normal"),
    contactId: uuid("contact_id").notNull(),
    orderRef: text("order_ref"),
    sourceSystem: text("source_system"),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("crm3_tickets_subject_nonempty_check", sql`length(btrim(${table.subject})) > 0`),
    check(
      "crm3_tickets_status_check",
      sql`${table.status} IN ('New', 'Open', 'Waiting', 'Solved', 'Closed')`
    ),
    check(
      "crm3_tickets_priority_check",
      sql`${table.priority} IN ('Low', 'Normal', 'High', 'Urgent')`
    ),
    sourcePairCheck("crm3_tickets", table.sourceSystem, table.sourceId),
    uniqueIndex("crm3_tickets_source_key").on(table.sourceSystem, table.sourceId),
    index("crm3_tickets_contact_id_idx").on(table.contactId),
    index("crm3_tickets_status_idx").on(table.status),
    index("crm3_tickets_priority_idx").on(table.priority),
    index("crm3_tickets_created_at_idx").on(sql`${table.createdAt} DESC`)
  ]
);

export const crm3Notes = crm3Schema.table(
  "crm3_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => crm3Tickets.id, { onDelete: "cascade" }),
    authorId: text("author_id").notNull(),
    noteText: text("note_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("crm3_notes_author_id_nonempty_check", sql`length(btrim(${table.authorId})) > 0`),
    check("crm3_notes_note_text_nonempty_check", sql`length(btrim(${table.noteText})) > 0`),
    index("crm3_notes_ticket_id_idx").on(table.ticketId),
    index("crm3_notes_ticket_created_at_idx").on(table.ticketId, sql`${table.createdAt} DESC`)
  ]
);

export const crm3ImportBatches = crm3Schema.table(
  "crm3_import_batches",
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
    check("crm3_import_batches_source_system_nonempty_check", sql`length(btrim(${table.sourceSystem})) > 0`),
    check(
      "crm3_import_batches_status_check",
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed')`
    ),
    check("crm3_import_batches_loaded_count_check", sql`${table.loadedCount} >= 0`),
    check("crm3_import_batches_rejected_count_check", sql`${table.rejectedCount} >= 0`),
    check(
      "crm3_import_batches_idempotency_pair_check",
      sql`(${table.idempotencyKey} IS NULL AND ${table.requestHash} IS NULL) OR
        (${table.idempotencyKey} IS NOT NULL AND length(btrim(${table.idempotencyKey})) > 0 AND
         ${table.requestHash} IS NOT NULL AND length(btrim(${table.requestHash})) > 0)`
    ),
    uniqueIndex("crm3_import_batches_idempotency_key").on(table.idempotencyKey),
    index("crm3_import_batches_created_at_idx").on(sql`${table.createdAt} DESC`)
  ]
);

export const crm3ImportReceipts = crm3Schema.table(
  "crm3_import_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => crm3ImportBatches.id, { onDelete: "cascade" }),
    sourceRow: integer("source_row").notNull(),
    entity: text("entity").notNull(),
    sourceSystem: text("source_system").notNull(),
    sourceId: text("source_id").notNull(),
    targetId: uuid("target_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("crm3_import_receipts_source_row_check", sql`${table.sourceRow} > 0`),
    check("crm3_import_receipts_entity_check", sql`${table.entity} IN ('ticket', 'note')`),
    check("crm3_import_receipts_source_system_nonempty_check", sql`length(btrim(${table.sourceSystem})) > 0`),
    check("crm3_import_receipts_source_id_nonempty_check", sql`length(btrim(${table.sourceId})) > 0`),
    check("crm3_import_receipts_idempotency_key_nonempty_check", sql`length(btrim(${table.idempotencyKey})) > 0`),
    uniqueIndex("crm3_import_receipts_idempotency_key").on(table.idempotencyKey),
    uniqueIndex("crm3_import_receipts_batch_row_entity_key").on(table.batchId, table.sourceRow, table.entity),
    index("crm3_import_receipts_target_id_idx").on(table.targetId)
  ]
);
