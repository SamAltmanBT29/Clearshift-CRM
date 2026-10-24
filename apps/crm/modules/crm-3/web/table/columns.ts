import type { DataTableColumn } from './types.js';

/**
 * Support Tickets Queue Columns matching CRM-3 Data Dictionary (`crm3.crm3_tickets`)
 * ID, Subject, Status, Priority, Contact Link, Order Ref, Created At, Updated At
 */
export const TICKETS_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Ticket ID', sortable: true, align: 'left', width: '160px' },
  { key: 'subject', header: 'Subject', sortable: true, align: 'left', width: '260px' },
  { key: 'status', header: 'Status', sortable: true, align: 'left', width: '120px' },
  { key: 'priority', header: 'Priority', sortable: true, align: 'left', width: '110px' },
  { key: 'contactName', header: 'Contact', sortable: false, align: 'left', width: '180px' },
  { key: 'orderRef', header: 'Order Ref', sortable: true, align: 'left', width: '140px' },
  { key: 'createdAt', header: 'Created At', sortable: true, align: 'left', width: '180px' },
  { key: 'updatedAt', header: 'Updated At', sortable: true, align: 'left', width: '180px' },
];

/**
 * Ticket Internal Notes Columns matching CRM-3 Data Dictionary (`crm3.crm3_notes`)
 */
export const TICKET_NOTES_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Note ID', sortable: true, align: 'left', width: '160px' },
  { key: 'ticketId', header: 'Ticket ID', sortable: true, align: 'left', width: '160px' },
  { key: 'authorId', header: 'Author', sortable: false, align: 'left', width: '160px' },
  { key: 'noteText', header: 'Note Content', sortable: false, align: 'left', width: '320px' },
  { key: 'createdAt', header: 'Created At', sortable: true, align: 'left', width: '180px' },
];

/**
 * Import Batches & Receipts Columns (`crm3.crm3_import_batches`)
 */
export const TICKET_IMPORTS_COLUMNS: DataTableColumn[] = [
  { key: 'id', header: 'Batch ID', sortable: true, align: 'left', width: '180px' },
  { key: 'sourceSystem', header: 'Source System', sortable: true, align: 'left', width: '140px' },
  { key: 'status', header: 'Status', sortable: true, align: 'left', width: '120px' },
  { key: 'loadedCount', header: 'Loaded', sortable: true, align: 'right', width: '110px' },
  { key: 'rejectedCount', header: 'Rejected', sortable: true, align: 'right', width: '110px' },
  { key: 'createdAt', header: 'Started At', sortable: true, align: 'left', width: '180px' },
  { key: 'completedAt', header: 'Completed At', sortable: false, align: 'left', width: '180px' },
];
