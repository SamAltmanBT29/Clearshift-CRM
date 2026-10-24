import type { FilterFacet } from './types.js';

/**
 * Standard CRM-3 Support Tickets Filter Facets
 * Mapped to CRM-3 Data Dictionary (`crm3_tickets`)
 */
export const CRM3_TICKETS_FACETS: FilterFacet[] = [
  {
    id: 'status',
    label: 'Status',
    paramKey: 'status',
    options: [
      { value: '', label: 'All Statuses' },
      { value: 'New', label: 'New' },
      { value: 'Open', label: 'Open' },
      { value: 'Waiting', label: 'Waiting' },
      { value: 'Solved', label: 'Solved' },
      { value: 'Closed', label: 'Closed' },
    ],
  },
  {
    id: 'priority',
    label: 'Priority',
    paramKey: 'priority',
    options: [
      { value: '', label: 'All Priorities' },
      { value: 'Low', label: 'Low' },
      { value: 'Normal', label: 'Normal' },
      { value: 'High', label: 'High' },
      { value: 'Urgent', label: 'Urgent' },
    ],
  },
];

/**
 * Standard CRM-3 Import Batches Facets (`crm3_import_batches`)
 */
export const CRM3_IMPORTS_FACETS: FilterFacet[] = [
  {
    id: 'status',
    label: 'Batch Status',
    paramKey: 'status',
    options: [
      { value: '', label: 'All Statuses' },
      { value: 'pending', label: 'Pending' },
      { value: 'processing', label: 'Processing' },
      { value: 'completed', label: 'Completed' },
      { value: 'failed', label: 'Failed' },
    ],
  },
];
