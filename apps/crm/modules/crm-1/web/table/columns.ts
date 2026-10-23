import type { DataTableColumn } from './types.js';

/**
 * Contacts Data Table Columns matching CRM-1 Data Dictionary (`crm1.crm1_contacts`)
 */
export const CONTACTS_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Contact ID', sortable: true, align: 'left', width: '180px' },
  { key: 'firstName', header: 'First Name', sortable: true, align: 'left', width: '140px' },
  { key: 'lastName', header: 'Last Name', sortable: true, align: 'left', width: '140px' },
  { key: 'email', header: 'Email', sortable: true, align: 'left', width: '220px' },
  { key: 'phone', header: 'Phone', sortable: false, align: 'left', width: '140px' },
  { key: 'companyId', header: 'Company ID', sortable: false, align: 'left', width: '160px' },
  { key: 'leadStatus', header: 'Lead Status', sortable: true, align: 'left', width: '130px' },
  { key: 'goldenId', header: 'Golden ID', sortable: true, align: 'left', width: '160px' },
  { key: 'consentStatus', header: 'Consent', sortable: true, align: 'left', width: '120px' },
  { key: 'unsubscribed', header: 'Unsubscribed', sortable: false, align: 'center', width: '120px' },
  { key: 'createdAt', header: 'Created At', sortable: true, align: 'left', width: '180px' },
];

/**
 * Companies Data Table Columns matching CRM-1 Data Dictionary (`crm1.crm1_companies`)
 */
export const COMPANIES_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Company ID', sortable: true, align: 'left', width: '180px' },
  { key: 'name', header: 'Company Name', sortable: true, align: 'left', width: '200px' },
  { key: 'taxNumber', header: 'Tax Number', sortable: true, align: 'left', width: '150px' },
  { key: 'email', header: 'Email', sortable: false, align: 'left', width: '220px' },
  { key: 'phone', header: 'Phone', sortable: false, align: 'left', width: '140px' },
  { key: 'address', header: 'Address', sortable: false, align: 'left', width: '200px' },
  { key: 'sourceSystem', header: 'Source System', sortable: true, align: 'left', width: '140px' },
  { key: 'sourceId', header: 'Source ID', sortable: false, align: 'left', width: '140px' },
  { key: 'createdAt', header: 'Created At', sortable: true, align: 'left', width: '180px' },
];

/**
 * Leads Data Table Columns matching CRM-1 Data Dictionary (`crm1.crm1_leads`)
 */
export const LEADS_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Lead ID', sortable: true, align: 'left', width: '180px' },
  { key: 'contactId', header: 'Contact ID', sortable: true, align: 'left', width: '180px' },
  { key: 'status', header: 'Workflow Status', sortable: true, align: 'left', width: '140px' },
  { key: 'sourceSystem', header: 'Source System', sortable: true, align: 'left', width: '140px' },
  { key: 'sourceId', header: 'Source ID', sortable: false, align: 'left', width: '140px' },
  { key: 'createdAt', header: 'Created At', sortable: true, align: 'left', width: '180px' },
];

/**
 * Duplicate Candidate Review Queue Columns
 */
export const DUPLICATES_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Candidate ID', sortable: false, align: 'left', width: '160px' },
  { key: 'entity', header: 'Entity', sortable: true, align: 'left', width: '120px' },
  { key: 'matchKey', header: 'Match Key', sortable: true, align: 'left', width: '200px' },
  { key: 'matchType', header: 'Match Type', sortable: true, align: 'left', width: '150px' },
  { key: 'existingId', header: 'Primary ID', sortable: false, align: 'left', width: '160px' },
  { key: 'incomingId', header: 'Incoming ID', sortable: false, align: 'left', width: '160px' },
  { key: 'status', header: 'Review Status', sortable: true, align: 'left', width: '130px' },
  { key: 'detectedAt', header: 'Detected At', sortable: true, align: 'left', width: '180px' },
];

/**
 * Import Batches & Receipts Columns
 */
export const IMPORTS_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Batch ID', sortable: true, align: 'left', width: '180px' },
  { key: 'sourceSystem', header: 'Source System', sortable: true, align: 'left', width: '140px' },
  { key: 'status', header: 'Status', sortable: true, align: 'left', width: '130px' },
  { key: 'loadedCount', header: 'Loaded', sortable: true, align: 'right', width: '110px' },
  { key: 'rejectedCount', header: 'Rejected', sortable: true, align: 'right', width: '110px' },
  { key: 'createdAt', header: 'Started At', sortable: true, align: 'left', width: '180px' },
  { key: 'completedAt', header: 'Completed At', sortable: false, align: 'left', width: '180px' },
];

/**
 * Cleaning Rule Audit Trail Columns (CRM1-27)
 */
export const CLEANING_AUDIT_COLUMNS: DataTableColumn[] = [
  { key: 'source_row', header: 'Source Row', sortable: true, align: 'right', width: '110px' },
  { key: 'field_name', header: 'Field Name', sortable: true, align: 'left', width: '160px' },
  { key: 'original_value', header: 'Original Value', sortable: false, align: 'left', width: '220px' },
  { key: 'cleaned_value', header: 'Cleaned Value', sortable: false, align: 'left', width: '220px' },
  { key: 'rule_id', header: 'Cleaning Rule ID', sortable: true, align: 'left', width: '150px' },
];

/**
 * Cleaning Rejection Columns (CRM1-27)
 */
export const CLEANING_REJECTS_COLUMNS: DataTableColumn[] = [
  { key: 'source_row', header: 'Source Row', sortable: true, align: 'right', width: '110px' },
  { key: 'field_name', header: 'Field Name', sortable: true, align: 'left', width: '160px' },
  { key: 'reason_code', header: 'Reason Code', sortable: true, align: 'left', width: '200px' },
  { key: 'reason', header: 'Rejection Description', sortable: false, align: 'left', width: '300px' },
];
