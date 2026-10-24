import { describe, it, expect } from 'vitest';
import { getTableColumns, getTableName } from 'drizzle-orm';
import {
  crm4Schema,
  crm4Lists,
  crm4Campaigns,
  crm4Members,
  crm4Consents,
  crm4ImportBatches,
  crm4ImportReceipts,
  crm4MarketingLists,
  crm4MarketingCampaigns,
  crm4CampaignMembers,
  crm4ContactConsents,
  crm4ConsentRecords,
} from '../../db/schema.js';

describe('CRM-4 Relational Schema & Invariants (Issue #36 / [CRM4-01])', () => {
  describe('PostgreSQL Schema Definition', () => {
    it('is registered under the "crm4" PostgreSQL schema', () => {
      expect(crm4Schema).toBeDefined();
      expect(crm4Schema.schemaName).toBe('crm4');
    });
  });

  describe('1. crm4_lists Table Schema', () => {
    it('defines correct table name and columns', () => {
      expect(getTableName(crm4Lists)).toBe('crm4_lists');
      const columns = getTableColumns(crm4Lists);

      expect(columns.id).toBeDefined();
      expect(columns.id.primary).toBe(true);
      expect(columns.name).toBeDefined();
      expect(columns.name.notNull).toBe(true);
      expect(columns.description).toBeDefined();
      expect(columns.description.notNull).toBe(false);
      expect(columns.campaignCount).toBeDefined();
      expect(columns.campaignCount.notNull).toBe(true);
      expect(columns.memberCount).toBeDefined();
      expect(columns.memberCount.notNull).toBe(true);
      expect(columns.createdAt).toBeDefined();
      expect(columns.createdAt.notNull).toBe(true);
      expect(columns.updatedAt).toBeDefined();
      expect(columns.updatedAt.notNull).toBe(true);

      // Aliases
      expect(crm4MarketingLists).toBe(crm4Lists);
    });
  });

  describe('2. crm4_campaigns Table Schema', () => {
    it('defines correct table name, columns, and foreign key to crm4_lists', () => {
      expect(getTableName(crm4Campaigns)).toBe('crm4_campaigns');
      const columns = getTableColumns(crm4Campaigns);

      expect(columns.id).toBeDefined();
      expect(columns.id.primary).toBe(true);
      expect(columns.name).toBeDefined();
      expect(columns.name.notNull).toBe(true);
      expect(columns.campaignDate).toBeDefined();
      expect(columns.campaignDate.notNull).toBe(true);
      expect(columns.listId).toBeDefined();
      expect(columns.listId.notNull).toBe(true);
      expect(columns.memberCount).toBeDefined();
      expect(columns.memberCount.notNull).toBe(true);
      expect(columns.createdAt).toBeDefined();
      expect(columns.createdAt.notNull).toBe(true);
      expect(columns.updatedAt).toBeDefined();
      expect(columns.updatedAt.notNull).toBe(true);

      // Aliases
      expect(crm4MarketingCampaigns).toBe(crm4Campaigns);
    });
  });

  describe('3. crm4_members Table Schema', () => {
    it('defines correct table name, columns, and membership attributes', () => {
      expect(getTableName(crm4Members)).toBe('crm4_members');
      const columns = getTableColumns(crm4Members);

      expect(columns.id).toBeDefined();
      expect(columns.id.primary).toBe(true);
      expect(columns.campaignId).toBeDefined();
      expect(columns.campaignId.notNull).toBe(true);
      expect(columns.contactId).toBeDefined();
      expect(columns.contactId.notNull).toBe(true);
      expect(columns.status).toBeDefined();
      expect(columns.status.notNull).toBe(true);
      expect(columns.unsubscribed).toBeDefined();
      expect(columns.unsubscribed.notNull).toBe(true);
      expect(columns.createdAt).toBeDefined();
      expect(columns.createdAt.notNull).toBe(true);

      // Aliases
      expect(crm4CampaignMembers).toBe(crm4Members);
    });
  });

  describe('4. crm4_consents Table Schema', () => {
    it('defines correct table name, columns, and consent fields', () => {
      expect(getTableName(crm4Consents)).toBe('crm4_consents');
      const columns = getTableColumns(crm4Consents);

      expect(columns.id).toBeDefined();
      expect(columns.id.primary).toBe(true);
      expect(columns.contactId).toBeDefined();
      expect(columns.contactId.notNull).toBe(true);
      expect(columns.status).toBeDefined();
      expect(columns.status.notNull).toBe(true);
      expect(columns.consentDate).toBeDefined();
      expect(columns.consentDate.notNull).toBe(true);
      expect(columns.source).toBeDefined();
      expect(columns.source.notNull).toBe(true);
      expect(columns.createdAt).toBeDefined();
      expect(columns.createdAt.notNull).toBe(true);
      expect(columns.updatedAt).toBeDefined();
      expect(columns.updatedAt.notNull).toBe(true);

      // Aliases
      expect(crm4ContactConsents).toBe(crm4Consents);
      expect(crm4ConsentRecords).toBe(crm4Consents);
    });
  });

  describe('5. crm4_import_batches & crm4_import_receipts Schema', () => {
    it('defines correct table names and columns for migration kit integration', () => {
      expect(getTableName(crm4ImportBatches)).toBe('crm4_import_batches');
      const batchCols = getTableColumns(crm4ImportBatches);
      expect(batchCols.id.primary).toBe(true);
      expect(batchCols.sourceSystem.notNull).toBe(true);
      expect(batchCols.status.notNull).toBe(true);
      expect(batchCols.loadedCount.notNull).toBe(true);
      expect(batchCols.rejectedCount.notNull).toBe(true);

      expect(getTableName(crm4ImportReceipts)).toBe('crm4_import_receipts');
      const receiptCols = getTableColumns(crm4ImportReceipts);
      expect(receiptCols.id.primary).toBe(true);
      expect(receiptCols.batchId.notNull).toBe(true);
      expect(receiptCols.sourceRow.notNull).toBe(true);
      expect(receiptCols.entity.notNull).toBe(true);
      expect(receiptCols.idempotencyKey.notNull).toBe(true);
    });
  });
});
