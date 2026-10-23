import { pgTable, uuid, varchar, integer, boolean, timestamp, numeric, char, text } from 'drizzle-orm/pg-core';

/**
 * CRM-2 Drizzle Schema definitions (PostgreSQL 18.6)
 * SDS ClearShift CRM v2.0, V1: FR-CRM2-01..05
 */

export const crm2Stages = pgTable('crm2_stages', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 32 }).notNull().unique(),
  order: integer('order').notNull().unique(),
  isClosedWon: boolean('is_closed_won').notNull().default(false),
  isClosedLost: boolean('is_closed_lost').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const crm2Deals = pgTable('crm2_deals', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  contactId: uuid('contact_id'), // Nullable foreign key: enables orphan deals
  contactName: varchar('contact_name', { length: 255 }),
  value: numeric('value', { precision: 14, scale: 2 }).notNull().default('0.00'),
  currency: char('currency', { length: 3 }).notNull().default('USD'),
  stageId: uuid('stage_id').notNull().references(() => crm2Stages.id),
  closeDate: varchar('close_date', { length: 10 }).notNull(), // YYYY-MM-DD
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const crm2Quotes = pgTable('crm2_quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  dealId: uuid('deal_id').notNull().references(() => crm2Deals.id),
  quoteNumber: varchar('quote_number', { length: 64 }).notNull().unique(),
  date: varchar('date', { length: 10 }).notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull().default('0.00'),
  currency: char('currency', { length: 3 }).notNull().default('USD'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
