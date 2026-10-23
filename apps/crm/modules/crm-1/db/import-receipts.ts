import { crm1ImportReceipts, crm1ImportRejects, crm1ImportBatches } from './schema.js';

export {
  crm1ImportReceipts,
  crm1ImportRejects,
  crm1ImportBatches,
};

export type Crm1ImportReceipt = typeof crm1ImportReceipts.$inferSelect;
export type NewCrm1ImportReceipt = typeof crm1ImportReceipts.$inferInsert;

export type Crm1ImportReject = typeof crm1ImportRejects.$inferSelect;
export type NewCrm1ImportReject = typeof crm1ImportRejects.$inferInsert;

export type Crm1ImportBatch = typeof crm1ImportBatches.$inferSelect;
export type NewCrm1ImportBatch = typeof crm1ImportBatches.$inferInsert;
