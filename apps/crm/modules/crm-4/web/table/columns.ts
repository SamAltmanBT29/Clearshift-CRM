import type { DataTableColumn } from './types.js';

/**
 * Marketing Lists Data Table Columns matching CRM-4 Data Dictionary §2.1 (crm4_lists)
 */
export const MARKETING_LISTS_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'List ID', sortable: true, align: 'left', width: '180px' },
  { key: 'name', header: 'List Name', sortable: true, align: 'left', width: '220px' },
  { key: 'description', header: 'Description', sortable: false, align: 'left', width: '260px' },
  { key: 'campaignCount', header: 'Campaigns', sortable: true, align: 'center', width: '120px' },
  { key: 'memberCount', header: 'Members', sortable: true, align: 'center', width: '120px' },
  { key: 'createdAt', header: 'Created Date', sortable: true, align: 'left', width: '160px' },
  { key: 'updatedAt', header: 'Last Updated', sortable: true, align: 'left', width: '160px' },
];

/**
 * Campaigns Data Table Columns matching CRM-4 Data Dictionary §2.2 (crm4_campaigns)
 */
export const CAMPAIGNS_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Campaign ID', sortable: true, align: 'left', width: '180px' },
  { key: 'name', header: 'Campaign Name', sortable: true, align: 'left', width: '220px' },
  { key: 'campaignDate', header: 'Campaign Date', sortable: true, align: 'left', width: '140px' },
  { key: 'listId', header: 'Marketing List', sortable: true, align: 'left', width: '180px' },
  { key: 'memberCount', header: 'Participants', sortable: true, align: 'center', width: '130px' },
  { key: 'createdAt', header: 'Recorded Date', sortable: true, align: 'left', width: '160px' },
  { key: 'updatedAt', header: 'Last Updated', sortable: true, align: 'left', width: '160px' },
];

/**
 * Campaign Members Data Table Columns matching CRM-4 Data Dictionary §2.3 (crm4_members)
 */
export const MEMBERS_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Member ID', sortable: true, align: 'left', width: '180px' },
  { key: 'campaignId', header: 'Campaign ID', sortable: true, align: 'left', width: '180px' },
  { key: 'contactId', header: 'Contact Reference', sortable: true, align: 'left', width: '180px' },
  { key: 'status', header: 'Delivery Status', sortable: true, align: 'center', width: '140px' },
  { key: 'unsubscribed', header: 'Opt-Out Flag', sortable: true, align: 'center', width: '130px' },
  { key: 'createdAt', header: 'Recorded At', sortable: true, align: 'left', width: '160px' },
];

/**
 * Consent Records Data Table Columns matching CRM-4 Data Dictionary §2.4 (crm4_consents)
 */
export const CONSENTS_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Consent ID', sortable: true, align: 'left', width: '180px' },
  { key: 'contactId', header: 'Contact Reference', sortable: true, align: 'left', width: '180px' },
  { key: 'status', header: 'Consent Status', sortable: true, align: 'center', width: '150px' },
  { key: 'consentDate', header: 'Capture Date', sortable: true, align: 'left', width: '160px' },
  { key: 'source', header: 'Provenance / Source', sortable: true, align: 'left', width: '180px' },
  { key: 'createdAt', header: 'Recorded At', sortable: true, align: 'left', width: '160px' },
  { key: 'updatedAt', header: 'Last Updated', sortable: true, align: 'left', width: '160px' },
];

/**
 * Migration Import Receipts Data Table Columns matching CRM-4 Data Dictionary §2.6 (crm4_import_receipts)
 */
export const IMPORTS_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Receipt ID', sortable: true, align: 'left', width: '180px' },
  { key: 'batchId', header: 'Batch ID', sortable: true, align: 'left', width: '180px' },
  { key: 'sourceRow', header: 'Source Row', sortable: true, align: 'right', width: '110px' },
  { key: 'entity', header: 'Target Entity', sortable: true, align: 'left', width: '130px' },
  { key: 'sourceSystem', header: 'Source System', sortable: true, align: 'left', width: '150px' },
  { key: 'sourceId', header: 'Legacy ID', sortable: false, align: 'left', width: '140px' },
  { key: 'targetId', header: 'PostgreSQL UUID', sortable: false, align: 'left', width: '180px' },
  { key: 'createdAt', header: 'Committed At', sortable: true, align: 'left', width: '160px' },
];

/**
 * Duplicate Review Candidates Data Table Columns for CRM-4 ([CRM4-12])
 */
export const DUPLICATES_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Candidate ID', sortable: true, align: 'left', width: '180px' },
  { key: 'entity', header: 'Entity', sortable: true, align: 'left', width: '120px' },
  { key: 'keyType', header: 'Key Rule', sortable: true, align: 'left', width: '150px' },
  { key: 'normalizedKey', header: 'Matched Normalized Key', sortable: true, align: 'left', width: '220px' },
  { key: 'recordIds', header: 'Record IDs', sortable: false, align: 'left', width: '200px' },
  { key: 'status', header: 'Review Status', sortable: true, align: 'center', width: '140px' },
  { key: 'detectedAt', header: 'Detected Date', sortable: true, align: 'left', width: '160px' },
];
