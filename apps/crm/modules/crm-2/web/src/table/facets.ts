import type { FilterFacet } from './types.js';

/**
 * Standard CRM-2 Deals Filter Facets
 * Mapped to CRM-2 Data Dictionary (`crm2.crm2_deals`) and approved V1 schema
 */
export const CRM2_DEALS_FACETS: FilterFacet[] = [
  {
    id: 'stage',
    label: 'Pipeline Stage',
    paramKey: 'stage',
    options: [
      { value: '', label: 'All Stages' },
      { value: 'New', label: 'New' },
      { value: 'Qualified', label: 'Qualified' },
      { value: 'Proposal', label: 'Proposal' },
      { value: 'Negotiation', label: 'Negotiation' },
      { value: 'Won', label: 'Won' },
      { value: 'Lost', label: 'Lost' },
    ],
  },
  {
    id: 'is_orphan',
    label: 'Orphan Status',
    paramKey: 'is_orphan',
    options: [
      { value: '', label: 'All Deals' },
      { value: 'false', label: 'Linked to Contact' },
      { value: 'true', label: 'Orphan (Unlinked)' },
    ],
  },
  {
    id: 'source_system',
    label: 'Source System',
    paramKey: 'source_system',
    options: [
      { value: '', label: 'All Sources' },
      { value: 'hubspot', label: 'HubSpot' },
      { value: 'salesforce', label: 'Salesforce' },
      { value: 'csv_import', label: 'CSV Import' },
      { value: 'manual', label: 'Manual Entry' },
    ],
  },
];

/**
 * Standard CRM-2 Quotes Filter Facets (`crm2.crm2_quotes`)
 */
export const CRM2_QUOTES_FACETS: FilterFacet[] = [
  {
    id: 'source_system',
    label: 'Source System',
    paramKey: 'source_system',
    options: [
      { value: '', label: 'All Sources' },
      { value: 'csv_import', label: 'CSV Import' },
      { value: 'manual', label: 'Manual Entry' },
      { value: 'erp_sync', label: 'ERP Sync' },
    ],
  },
];

/**
 * Standard CRM-2 Duplicate Candidate Review Facets
 */
export const CRM2_DUPLICATES_FACETS: FilterFacet[] = [
  {
    id: 'entity',
    label: 'Entity Type',
    paramKey: 'entity',
    options: [
      { value: '', label: 'All Entities' },
      { value: 'deal', label: 'Deal' },
      { value: 'quote', label: 'Quote' },
    ],
  },
  {
    id: 'status',
    label: 'Resolution Status',
    paramKey: 'status',
    options: [
      { value: '', label: 'All Statuses' },
      { value: 'pending', label: 'Pending Review' },
      { value: 'resolved', label: 'Resolved' },
      { value: 'ignored', label: 'Dismissed' },
    ],
  },
];
