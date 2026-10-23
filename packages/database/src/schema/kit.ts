import { pgTable, uuid, text, timestamp, jsonb, integer, bigint } from "drizzle-orm/pg-core";

/**
 * Migration Kit Batch Registry Schema (KIT-01)
 * Authoritative record of each batch execution across the 7-step migration pipeline.
 */
export const kitBatches = pgTable("kit_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchNumber: text("batch_number").notNull().unique(),
  module: text("module").notNull(),
  sourceSystem: text("source_system"),
  fileName: text("file_name"),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  checksum: text("checksum").notNull(),
  status: text("status").notNull().default("created"),
  previousStatus: text("previous_status"),
  checkpoint: text("checkpoint").notNull().default("created"),
  attempt: integer("attempt").notNull().default(1),
  maxAttempts: integer("max_attempts").notNull().default(3),
  totalRows: integer("total_rows").notNull().default(0),
  loadedRows: integer("loaded_rows").notNull().default(0),
  rejectedRows: integer("rejected_rows").notNull().default(0),
  mergedRows: integer("merged_rows").notNull().default(0),
  skippedRows: integer("skipped_rows").notNull().default(0),
  unaccountedRows: integer("unaccounted_rows").notNull().default(0),
  ruleVersion: text("rule_version").notNull().default("1.0.0"),
  codeVersion: text("code_version").notNull().default("1.0.0"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  correlationId: text("correlation_id").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdBy: text("created_by").notNull().default("system"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Migration Kit Immutable Step Ledger Schema (KIT-01)
 * Append-only ledger recording every state transition, telemetry counts, and duration.
 * UPDATE and DELETE statements are strictly blocked by database trigger.
 */
export const kitBatchSteps = pgTable("kit_batch_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => kitBatches.id, { onDelete: "restrict" }),
  stepNumber: integer("step_number").notNull(),
  stepName: text("step_name").notNull(),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  attempt: integer("attempt").notNull().default(1),
  checkpoint: text("checkpoint").notNull(),
  recordsIn: integer("records_in").notNull().default(0),
  recordsOut: integer("records_out").notNull().default(0),
  recordsRejected: integer("records_rejected").notNull().default(0),
  recordsMerged: integer("records_merged").notNull().default(0),
  recordsSkipped: integer("records_skipped").notNull().default(0),
  ruleVersion: text("rule_version").notNull().default("1.0.0"),
  codeVersion: text("code_version").notNull().default("1.0.0"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  correlationId: text("correlation_id").notNull(),
  actor: text("actor").notNull().default("system"),
  durationMs: integer("duration_ms"),
  metadata: jsonb("metadata").notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Migration Kit Raw Rows Schema (KIT-02)
 * Immutable landing table storing extracted source rows with original payload and checksum.
 * UPDATE and DELETE statements are strictly blocked by database trigger.
 */
export const rawRows = pgTable("raw_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => kitBatches.id, { onDelete: "cascade" }),
  sourceRow: integer("source_row").notNull(),
  headers: text("headers").array().notNull(),
  cells: text("cells").array().notNull(),
  payload: jsonb("payload").notNull(),
  rowHash: text("row_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Migration Kit Column Profile Reports Schema (KIT-03)
 * Stores computed per-column data health metrics (empties, invalid formats, top values).
 */
export const kitProfileReports = pgTable("kit_profile_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => kitBatches.id, { onDelete: "cascade" }),
  columnName: text("column_name").notNull(),
  emptyCount: integer("empty_count").notNull().default(0),
  invalidCount: integer("invalid_count").notNull().default(0),
  distinctCount: integer("distinct_count").notNull().default(0),
  inferredType: text("inferred_type").notNull().default("string"),
  topValuesJson: jsonb("top_values_json").notNull().default([]),
  minValue: text("min_value"),
  maxValue: text("max_value"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

