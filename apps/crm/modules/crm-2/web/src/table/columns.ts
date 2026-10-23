import type { DataTableColumn } from './types.js';

/**
 * Deals Data Table Columns matching CRM-2 Data Dictionary (`crm2.crm2_deals`)
 */
export const DEALS_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Deal ID', sortable: true, align: 'left', width: '160px' },
  { key: 'name', header: 'Deal Name', sortable: true, align: 'left', width: '220px' },
  { key: 'contact_name', header: 'Contact / Orphan Status', sortable: true, align: 'left', width: '180px' },
  { key: 'value', header: 'Opportunity Value', sortable: true, align: 'right', width: '140px' },
  { key: 'currency', header: 'Currency', sortable: false, align: 'center', width: '90px' },
  { key: 'stage_name', header: 'Pipeline Stage', sortable: true, align: 'left', width: '140px' },
  { key: 'close_date', header: 'Close Date', sortable: true, align: 'left', width: '130px' },
  { key: 'source_system', header: 'Source System', sortable: true, align: 'left', width: '140px' },
  { key: 'created_at', header: 'Created At', sortable: true, align: 'left', width: '180px' },
];

/**
 * Quotes Data Table Columns matching CRM-2 Data Dictionary (`crm2.crm2_quotes`)
 */
export const QUOTES_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Quote ID', sortable: true, align: 'left', width: '160px' },
  { key: 'quote_number', header: 'Quote Number', sortable: true, align: 'left', width: '160px' },
  { key: 'deal_id', header: 'Linked Deal ID', sortable: true, align: 'left', width: '160px' },
  { key: 'quote_date', header: 'Issue Date', sortable: true, align: 'left', width: '130px' },
  { key: 'amount', header: 'Quote Amount', sortable: true, align: 'right', width: '140px' },
  { key: 'currency', header: 'Currency', sortable: false, align: 'center', width: '90px' },
  { key: 'note', header: 'Terms / Note', sortable: false, align: 'left', width: '200px' },
  { key: 'source_system', header: 'Source System', sortable: true, align: 'left', width: '140px' },
  { key: 'created_at', header: 'Created At', sortable: true, align: 'left', width: '180px' },
];

/**
 * Pipeline Stages Columns matching CRM-2 Data Dictionary (`crm2.crm2_stages`)
 */
export const STAGES_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Stage ID', sortable: false, align: 'left', width: '160px' },
  { key: 'position', header: 'Order', sortable: true, align: 'center', width: '90px' },
  { key: 'name', header: 'Stage Name', sortable: true, align: 'left', width: '160px' },
  { key: 'is_won', header: 'Terminal Won', sortable: true, align: 'center', width: '130px' },
];

/**
 * Quote Lines Columns matching CRM-2 Data Dictionary (`crm2.crm2_quote_lines`)
 */
export const QUOTE_LINES_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Line ID', sortable: false, align: 'left', width: '160px' },
  { key: 'quote_id', header: 'Quote ID', sortable: false, align: 'left', width: '160px' },
  { key: 'product_id', header: 'Product SKU', sortable: true, align: 'left', width: '160px' },
  { key: 'description', header: 'Description', sortable: true, align: 'left', width: '220px' },
  { key: 'quantity', header: 'Quantity', sortable: true, align: 'right', width: '100px' },
  { key: 'unit_price', header: 'Unit Price', sortable: true, align: 'right', width: '130px' },
  { key: 'total_price', header: 'Total Price', sortable: true, align: 'right', width: '140px' },
];

/**
 * Duplicate Candidate Review Queue Columns for CRM-2
 */
export const DUPLICATES_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Candidate ID', sortable: false, align: 'left', width: '160px' },
  { key: 'entityType', header: 'Entity', sortable: true, align: 'left', width: '120px' },
  { key: 'matchKey', header: 'Normalized Exact Key', sortable: true, align: 'left', width: '200px' },
  { key: 'confidenceScore', header: 'Confidence', sortable: true, align: 'center', width: '120px' },
  { key: 'status', header: 'Review Status', sortable: true, align: 'left', width: '130px' },
  { key: 'detectedAt', header: 'Detected At', sortable: true, align: 'left', width: '180px' },
];

/**
 * Import Batches & Receipts Columns for CRM-2
 */
export const IMPORTS_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Batch ID', sortable: true, align: 'left', width: '180px' },
  { key: 'sourceSystem', header: 'Source System', sortable: true, align: 'left', width: '140px' },
  { key: 'status', header: 'Status', sortable: true, align: 'left', width: '130px' },
  { key: 'loadedCount', header: 'Loaded Rows', sortable: true, align: 'right', width: '110px' },
  { key: 'rejectedCount', header: 'Rejected Rows', sortable: true, align: 'right', width: '110px' },
  { key: 'createdAt', header: 'Started At', sortable: true, align: 'left', width: '180px' },
  { key: 'completedAt', header: 'Completed At', sortable: false, align: 'left', width: '180px' },
];
