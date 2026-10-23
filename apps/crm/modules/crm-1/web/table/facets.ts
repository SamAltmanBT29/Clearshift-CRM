import type { FilterFacet } from './types.js';

/**
 * Standard CRM-1 Contacts Filter Facets
 * Mapped to CRM-1 Data Dictionary (`crm1_contacts`)
 */
export const CRM1_CONTACTS_FACETS: FilterFacet[] = [
  {
    id: 'leadStatus',
    label: 'Lead Status',
    paramKey: 'leadStatus',
    options: [
      { value: '', label: 'All Lead Statuses' },
      { value: 'New', label: 'New' },
      { value: 'Working', label: 'Working' },
      { value: 'Qualified', label: 'Qualified' },
      { value: 'Closed', label: 'Closed' },
    ],
  },
  {
    id: 'consentStatus',
    label: 'Consent',
    paramKey: 'consentStatus',
    options: [
      { value: '', label: 'All Consent States' },
      { value: 'unknown', label: 'Unknown' },
      { value: 'granted', label: 'Granted' },
      { value: 'withdrawn', label: 'Withdrawn' },
    ],
  },
  {
    id: 'unsubscribed',
    label: 'Subscription',
    paramKey: 'unsubscribed',
    options: [
      { value: '', label: 'All Subscriptions' },
      { value: 'false', label: 'Subscribed' },
      { value: 'true', label: 'Unsubscribed' },
    ],
  },
];

/**
 * Standard CRM-1 Companies Filter Facets (`crm1_companies`)
 */
export const CRM1_COMPANIES_FACETS: FilterFacet[] = [
  {
    id: 'sourceSystem',
    label: 'Source System',
    paramKey: 'sourceSystem',
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
 * Standard CRM-1 Leads Filter Facets (`crm1_leads`)
 */
export const CRM1_LEADS_FACETS: FilterFacet[] = [
  {
    id: 'status',
    label: 'Status',
    paramKey: 'status',
    options: [
      { value: '', label: 'All Statuses' },
      { value: 'New', label: 'New' },
      { value: 'Working', label: 'Working' },
      { value: 'Qualified', label: 'Qualified' },
      { value: 'Closed', label: 'Closed' },
    ],
  },
  {
    id: 'sourceSystem',
    label: 'Source System',
    paramKey: 'sourceSystem',
    options: [
      { value: '', label: 'All Sources' },
      { value: 'web_form', label: 'Web Form' },
      { value: 'campaign', label: 'Marketing Campaign' },
      { value: 'csv_import', label: 'CSV Import' },
      { value: 'outreach', label: 'Sales Outreach' },
    ],
  },
];

/**
 * Standard CRM-1 Duplicate Candidate Review Facets
 */
export const CRM1_DUPLICATES_FACETS: FilterFacet[] = [
  {
    id: 'entity',
    label: 'Entity Type',
    paramKey: 'entity',
    options: [
      { value: '', label: 'All Entities' },
      { value: 'contact', label: 'Contact' },
      { value: 'company', label: 'Company' },
    ],
  },
  {
    id: 'status',
    label: 'Resolution Status',
    paramKey: 'status',
    options: [
      { value: '', label: 'All Statuses' },
      { value: 'pending', label: 'Pending Review' },
      { value: 'merged', label: 'Merged' },
      { value: 'dismissed', label: 'Dismissed' },
    ],
  },
];

/**
 * Standard CRM-1 Import Batches Facets (`crm1_import_batches`)
 */
export const CRM1_IMPORTS_FACETS: FilterFacet[] = [
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
