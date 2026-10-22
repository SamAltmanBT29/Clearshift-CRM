import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  jsonb,
  check,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * CRM-5 Migration Import Receipts (crm5_import_receipts)
 * Durable receipt committed atomically with the target business record
 * in the same local database transaction (Decision C4 & KIT-08).
 */
export const crm5ImportReceipts = pgTable(
  'crm5_import_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: varchar('batch_id', { length: 128 }).notNull(),
    sourceRow: integer('source_row').notNull(),
    sourceSystem: varchar('source_system', { length: 64 }),
    sourceId: varchar('source_id', { length: 128 }),
    entity: varchar('entity', { length: 64 }).notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    idempotencyKey: varchar('idempotency_key', { length: 256 }).notNull(),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    targetId: uuid('target_id').notNull(),
    kind: varchar('kind', { length: 32 }).notNull().default('created'),
    outcome: varchar('outcome', { length: 32 }).notNull().default('created'),
    responsePayload: jsonb('response_payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_crm5_receipts_idempotency_key').on(table.idempotencyKey),
    index('idx_crm5_receipts_batch_row').on(table.batchId, table.sourceRow),
    index('idx_crm5_receipts_target_id').on(table.targetId),
    check('chk_crm5_receipts_source_row', sql`${table.sourceRow} >= 1`),
  ]
);

export type Crm5ImportReceipt = typeof crm5ImportReceipts.$inferSelect;
export type NewCrm5ImportReceipt = typeof crm5ImportReceipts.$inferInsert;
