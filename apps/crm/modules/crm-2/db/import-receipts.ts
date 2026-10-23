import {
  crm2ImportReceipts,
  crm2ImportRejects,
  crm2ImportBatches,
  crm2QuoteLines,
} from './schema.js';

export {
  crm2ImportReceipts,
  crm2ImportRejects,
  crm2ImportBatches,
  crm2QuoteLines,
};

export type Crm2ImportReceipt = typeof crm2ImportReceipts.$inferSelect;
export type NewCrm2ImportReceipt = typeof crm2ImportReceipts.$inferInsert;

export type Crm2ImportReject = typeof crm2ImportRejects.$inferSelect;
export type NewCrm2ImportReject = typeof crm2ImportRejects.$inferInsert;

export type Crm2ImportBatch = typeof crm2ImportBatches.$inferSelect;
export type NewCrm2ImportBatch = typeof crm2ImportBatches.$inferInsert;

export type Crm2QuoteLine = typeof crm2QuoteLines.$inferSelect;
export type NewCrm2QuoteLine = typeof crm2QuoteLines.$inferInsert;
