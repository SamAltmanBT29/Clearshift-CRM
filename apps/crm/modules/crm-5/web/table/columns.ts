import type { DataTableColumn } from './types.js';

/**
 * Migration Runs Data Table Columns matching CRM-5 Data Dictionary (Section 2.1)
 */
export const RUNS_COLUMNS: DataTableColumn[] = [
  { key: 'batchId', header: 'Batch ID', sortable: true, align: 'left', width: '180px' },
  { key: 'module', header: 'Module', sortable: true, align: 'left', width: '120px' },
  { key: 'step', header: 'Step', sortable: true, align: 'left', width: '120px' },
  { key: 'status', header: 'Status', sortable: true, align: 'left', width: '120px' },
  { key: 'recordsIn', header: 'Records In', sortable: true, align: 'right', width: '120px' },
  { key: 'recordsOut', header: 'Records Out', sortable: true, align: 'right', width: '120px' },
  { key: 'recordsRejected', header: 'Rejected', sortable: true, align: 'right', width: '120px' },
  { key: 'startedAt', header: 'Started At', sortable: true, align: 'left', width: '180px' },
  { key: 'completedAt', header: 'Completed At', sortable: false, align: 'left', width: '180px' },
];

/**
 * Quality Scores Data Table Columns matching CRM-5 Data Dictionary (Section 2.2)
 */
export const SCORES_COLUMNS: DataTableColumn[] = [
  { key: 'batchId', header: 'Batch ID', sortable: true, align: 'left', width: '180px' },
  { key: 'module', header: 'Module', sortable: true, align: 'left', width: '120px' },
  { key: 'score', header: 'Score (%)', sortable: true, align: 'right', width: '120px' },
  { key: 'completeness', header: 'Completeness', sortable: true, align: 'right', width: '130px' },
  { key: 'validity', header: 'Validity', sortable: true, align: 'right', width: '120px' },
  { key: 'duplicateRate', header: 'Duplicate Rate', sortable: true, align: 'right', width: '140px' },
  { key: 'rejectRate', header: 'Reject Rate', sortable: true, align: 'right', width: '130px' },
  { key: 'linkIntegrity', header: 'Link Integrity', sortable: true, align: 'right', width: '140px' },
  { key: 'isFullyScored', header: 'Fully Scored', sortable: false, align: 'center', width: '130px' },
  { key: 'scoredAt', header: 'Scored At', sortable: true, align: 'left', width: '180px' },
];

/**
 * Rejections Data Table Columns matching CRM-5 Data Dictionary (Section 2.3)
 */
export const REJECTS_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Rejection ID', sortable: false, align: 'left', width: '160px' },
  { key: 'batchId', header: 'Batch ID', sortable: true, align: 'left', width: '180px' },
  { key: 'module', header: 'Module', sortable: true, align: 'left', width: '120px' },
  { key: 'rowIndex', header: 'Row Index', sortable: true, align: 'right', width: '110px' },
  { key: 'errorCode', header: 'Error Code', sortable: true, align: 'left', width: '180px' },
  { key: 'errorMessage', header: 'Description', sortable: false, align: 'left', width: '280px' },
  { key: 'rawPayloadHash', header: 'Payload Hash', sortable: false, align: 'left', width: '160px' },
  { key: 'createdAt', header: 'Created At', sortable: true, align: 'left', width: '180px' },
];

/**
 * Reconciliation Data Table Columns matching CRM-5 Data Dictionary (Section 2.4)
 */
export const RECONCILIATION_COLUMNS: DataTableColumn[] = [
  { key: 'batchId', header: 'Batch ID', sortable: true, align: 'left', width: '180px' },
  { key: 'module', header: 'Module', sortable: true, align: 'left', width: '120px' },
  { key: 'sourceCount', header: 'Source', sortable: true, align: 'right', width: '110px' },
  { key: 'loadedCount', header: 'Migrated', sortable: true, align: 'right', width: '110px' },
  { key: 'rejectedCount', header: 'Rejected', sortable: true, align: 'right', width: '110px' },
  { key: 'mergedCount', header: 'Merged', sortable: true, align: 'right', width: '110px' },
  { key: 'skippedCount', header: 'Skipped', sortable: true, align: 'right', width: '110px' },
  { key: 'unaccountedCount', header: 'Discrepancy', sortable: true, align: 'right', width: '130px' },
  { key: 'status', header: 'Status', sortable: true, align: 'left', width: '130px' },
  { key: 'reconciledAt', header: 'Reconciled At', sortable: true, align: 'left', width: '180px' },
];
