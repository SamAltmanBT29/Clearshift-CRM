import type { FilterFacet } from './types.js';

/**
 * Standard CRM-4 Marketing Lists Filter Facets
 * Mapped to CRM-4 Data Dictionary (`crm4_lists`)
 */
export const CRM4_MARKETING_LISTS_FACETS: FilterFacet[] = [
  {
    id: 'memberRange',
    label: 'Audience Size',
    paramKey: 'memberRange',
    options: [
      { value: '', label: 'All Audience Sizes' },
      { value: 'empty', label: 'Empty (0 Members)' },
      { value: 'small', label: '1 - 50 Members' },
      { value: 'medium', label: '51 - 250 Members' },
      { value: 'large', label: '250+ Members' },
    ],
  },
  {
    id: 'campaignActivity',
    label: 'Campaign Activity',
    paramKey: 'campaignActivity',
    options: [
      { value: '', label: 'All Activity' },
      { value: 'active', label: 'With Campaigns (>0)' },
      { value: 'none', label: 'No Campaigns (0)' },
    ],
  },
];

/**
 * Standard CRM-4 Campaigns Filter Facets (`crm4_campaigns`)
 */
export const CRM4_CAMPAIGNS_FACETS: FilterFacet[] = [
  {
    id: 'status',
    label: 'Campaign Status',
    paramKey: 'status',
    options: [
      { value: '', label: 'All Statuses' },
      { value: 'draft', label: 'Draft' },
      { value: 'scheduled', label: 'Scheduled' },
      { value: 'sent', label: 'Sent / Completed' },
    ],
  },
  {
    id: 'dateRange',
    label: 'Campaign Period',
    paramKey: 'dateRange',
    options: [
      { value: '', label: 'All Periods' },
      { value: '2026', label: '2026 Campaigns' },
      { value: '2025', label: '2025 Campaigns' },
    ],
  },
];

/**
 * Standard CRM-4 Campaign Members Filter Facets (`crm4_campaign_members`)
 * Conforms to CRM-4 member status allowlist: sent, opened, clicked
 */
export const CRM4_MEMBERS_FACETS: FilterFacet[] = [
  {
    id: 'status',
    label: 'Engagement Status',
    paramKey: 'status',
    options: [
      { value: '', label: 'All Member Statuses' },
      { value: 'sent', label: 'Sent' },
      { value: 'opened', label: 'Opened' },
      { value: 'clicked', label: 'Clicked' },
    ],
  },
  {
    id: 'unsubscribed',
    label: 'Opt-Out Status',
    paramKey: 'unsubscribed',
    options: [
      { value: '', label: 'All Opt-Out States' },
      { value: 'false', label: 'Subscribed / Active' },
      { value: 'true', label: 'Unsubscribed / Opted Out' },
    ],
  },
];

/**
 * Standard CRM-4 Contact Consent Records Filter Facets (`crm4_consent_records`)
 * Conforms to BR-CRM4-01 monotonic opt-out rule
 */
export const CRM4_CONSENTS_FACETS: FilterFacet[] = [
  {
    id: 'consentStatus',
    label: 'Consent State',
    paramKey: 'consentStatus',
    options: [
      { value: '', label: 'All Consent States' },
      { value: 'subscribed', label: 'Subscribed' },
      { value: 'unsubscribed', label: 'Unsubscribed (Opted Out)' },
    ],
  },
  {
    id: 'source',
    label: 'Source Channel',
    paramKey: 'source',
    options: [
      { value: '', label: 'All Sources' },
      { value: 'web_form', label: 'Web Form' },
      { value: 'email_unsubscribe', label: 'Email Unsubscribe Link' },
      { value: 'csv_import', label: 'CSV Import' },
      { value: 'manual', label: 'Manual Update' },
    ],
  },
];
