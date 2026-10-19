import {
  pgTable,
  uuid,
  varchar,
  integer,
  numeric,
  timestamp,
  boolean,
  jsonb,
  text,
  check,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * CRM-5 Migration Control Center and Reports — Drizzle Schema
 * Enforces strict PostgreSQL types, UUID primary keys, check constraints,
 * and immutable event projections.
 */

// 1. Migration Run Projections (crm5_runs)
export const crm5Runs = pgTable(
  'crm5_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: varchar('batch_id', { length: 128 }).notNull(),
    module: varchar('module', { length: 64 }).notNull(),
    step: varchar('step', { length: 32 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    recordsIn: integer('records_in').notNull().default(0),
    recordsOut: integer('records_out').notNull().default(0),
    recordsRejected: integer('records_rejected').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_crm5_runs_batch_id').on(table.batchId),
    index('idx_crm5_runs_module').on(table.module),
    check('chk_crm5_runs_records_in', sql`${table.recordsIn} >= 0`),
    check('chk_crm5_runs_records_out', sql`${table.recordsOut} >= 0`),
    check('chk_crm5_runs_records_rejected', sql`${table.recordsRejected} >= 0`),
    check(
      'chk_crm5_runs_status',
      sql`${table.status} IN ('pending', 'running', 'completed', 'failed', 'halted')`
    ),
  ]
);

// 2. Data Quality Scores (crm5_scores)
export const crm5Scores = pgTable(
  'crm5_scores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: varchar('batch_id', { length: 128 }).notNull(),
    module: varchar('module', { length: 64 }).notNull(),
    completeness: numeric('completeness', { precision: 5, scale: 4 }),
    validity: numeric('validity', { precision: 5, scale: 4 }),
    duplicateRate: numeric('duplicate_rate', { precision: 5, scale: 4 }),
    rejectRate: numeric('reject_rate', { precision: 5, scale: 4 }),
    linkIntegrity: numeric('link_integrity', { precision: 5, scale: 4 }),
    score: numeric('score', { precision: 5, scale: 2 }),
    isFullyScored: boolean('is_fully_scored').notNull().default(false),
    scoredAt: timestamp('scored_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_crm5_scores_batch_id').on(table.batchId),
    index('idx_crm5_scores_module').on(table.module),
    check(
      'chk_crm5_scores_completeness',
      sql`${table.completeness} IS NULL OR (${table.completeness} >= 0 AND ${table.completeness} <= 1)`
    ),
    check(
      'chk_crm5_scores_validity',
      sql`${table.validity} IS NULL OR (${table.validity} >= 0 AND ${table.validity} <= 1)`
    ),
    check(
      'chk_crm5_scores_duplicate_rate',
      sql`${table.duplicateRate} IS NULL OR (${table.duplicateRate} >= 0 AND ${table.duplicateRate} <= 1)`
    ),
    check(
      'chk_crm5_scores_reject_rate',
      sql`${table.rejectRate} IS NULL OR (${table.rejectRate} >= 0 AND ${table.rejectRate} <= 1)`
    ),
    check(
      'chk_crm5_scores_link_integrity',
      sql`${table.linkIntegrity} IS NULL OR (${table.linkIntegrity} >= 0 AND ${table.linkIntegrity} <= 1)`
    ),
    check(
      'chk_crm5_scores_score',
      sql`${table.score} IS NULL OR (${table.score} >= 0 AND ${table.score} <= 100)`
    ),
  ]
);

// 3. Migration Rejections (crm5_rejects)
export const crm5Rejects = pgTable(
  'crm5_rejects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: varchar('batch_id', { length: 128 }).notNull(),
    module: varchar('module', { length: 64 }).notNull(),
    rowIndex: integer('row_index').notNull(),
    errorCode: varchar('error_code', { length: 64 }).notNull(),
    errorMessage: text('error_message').notNull(),
    rawPayloadHash: varchar('raw_payload_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_crm5_rejects_batch_id').on(table.batchId),
    index('idx_crm5_rejects_module').on(table.module),
    check('chk_crm5_rejects_row_index', sql`${table.rowIndex} >= 1`),
  ]
);

// 4. Reconciliation Balance Sheets (crm5_reconciliation_reports)
export const crm5ReconciliationReports = pgTable(
  'crm5_reconciliation_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: varchar('batch_id', { length: 128 }).notNull().unique(),
    module: varchar('module', { length: 64 }).notNull(),
    sourceCount: integer('source_count').notNull().default(0),
    loadedCount: integer('loaded_count').notNull().default(0),
    rejectedCount: integer('rejected_count').notNull().default(0),
    mergedCount: integer('merged_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    unaccountedCount: integer('unaccounted_count').notNull().default(0),
    status: varchar('status', { length: 16 }).notNull(),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_crm5_recon_batch_unique').on(table.batchId),
    index('idx_crm5_recon_module').on(table.module),
    check('chk_crm5_recon_source_count', sql`${table.sourceCount} >= 0`),
    check('chk_crm5_recon_loaded_count', sql`${table.loadedCount} >= 0`),
    check('chk_crm5_recon_rejected_count', sql`${table.rejectedCount} >= 0`),
    check('chk_crm5_recon_merged_count', sql`${table.mergedCount} >= 0`),
    check('chk_crm5_recon_skipped_count', sql`${table.skippedCount} >= 0`),
    check('chk_crm5_recon_unaccounted_count', sql`${table.unaccountedCount} >= 0`),
    check('chk_crm5_recon_status', sql`${table.status} IN ('OK', 'UNBALANCED')`),
  ]
);

// Backward-compatible entity aliases named in SDS
export const crm5RunProjections = crm5Runs;
export const crm5QualityScores = crm5Scores;
export const crm5RejectProjections = crm5Rejects;
