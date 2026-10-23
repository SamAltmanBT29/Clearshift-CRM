import type { FilterFacet } from './types.js';

/**
 * Standard CRM-5 Migration Run Filter Facets
 * Adheres to Section 10 of CRM-5 Data Dictionary & Crm5Contracts
 */
export const CRM5_RUNS_FACETS: FilterFacet[] = [
  {
    id: 'module',
    label: 'Module',
    paramKey: 'module',
    options: [
      { value: '', label: 'All Modules' },
      { value: 'crm-1', label: 'CRM-1 (Contacts & Accounts)' },
      { value: 'crm-2', label: 'CRM-2 (Deals & Pipelines)' },
      { value: 'crm-3', label: 'CRM-3 (Activities & Tasks)' },
      { value: 'crm-4', label: 'CRM-4 (Analytics & Insights)' },
      { value: 'crm-5', label: 'CRM-5 (Migration Control)' },
    ],
  },
  {
    id: 'status',
    label: 'Status',
    paramKey: 'status',
    options: [
      { value: '', label: 'All Statuses' },
      { value: 'pending', label: 'Pending' },
      { value: 'running', label: 'Running' },
      { value: 'completed', label: 'Completed' },
      { value: 'failed', label: 'Failed' },
      { value: 'halted', label: 'Halted' },
    ],
  },
  {
    id: 'step',
    label: 'Migration Step',
    paramKey: 'step',
    options: [
      { value: '', label: 'All Steps' },
      { value: 'extract', label: 'Extract' },
      { value: 'profile', label: 'Profile' },
      { value: 'clean', label: 'Clean' },
      { value: 'map', label: 'Map' },
      { value: 'load', label: 'Load' },
      { value: 'validate', label: 'Validate' },
      { value: 'reconcile', label: 'Reconcile' },
    ],
  },
];

/**
 * Standard CRM-5 Quality Scores Filter Facets
 */
export const CRM5_SCORES_FACETS: FilterFacet[] = [
  {
    id: 'module',
    label: 'Module',
    paramKey: 'module',
    options: [
      { value: '', label: 'All Modules' },
      { value: 'crm-1', label: 'CRM-1 (Contacts & Accounts)' },
      { value: 'crm-2', label: 'CRM-2 (Deals & Pipelines)' },
      { value: 'crm-3', label: 'CRM-3 (Activities & Tasks)' },
      { value: 'crm-4', label: 'CRM-4 (Analytics & Insights)' },
      { value: 'crm-5', label: 'CRM-5 (Migration Control)' },
    ],
  },
];

export const CRM5_REJECTS_FACETS: FilterFacet[] = [
  {
    id: 'module',
    label: 'Module',
    paramKey: 'module',
    options: [
      { value: '', label: 'All Modules' },
      { value: 'crm-1', label: 'CRM-1 (Contacts & Accounts)' },
      { value: 'crm-2', label: 'CRM-2 (Deals & Pipelines)' },
      { value: 'crm-3', label: 'CRM-3 (Activities & Tasks)' },
      { value: 'crm-4', label: 'CRM-4 (Analytics & Insights)' },
      { value: 'crm-5', label: 'CRM-5 (Migration Control)' },
    ],
  },
  {
    id: 'category',
    label: 'Error Category',
    paramKey: 'category',
    options: [
      { value: '', label: 'All Categories' },
      { value: 'Constraint Violation', label: 'Constraint Violation' },
      { value: 'Integrity & Conservation', label: 'Integrity & Conservation' },
      { value: 'Data Validation', label: 'Data Validation' },
      { value: 'Security & Injection', label: 'Security & Injection' },
      { value: 'Lifecycle & Chronology', label: 'Lifecycle & Chronology' },
    ],
  },
  {
    id: 'errorCode',
    label: 'Error Code',
    paramKey: 'errorCode',
    options: [
      { value: '', label: 'All Error Codes' },
      { value: 'DUPLICATE_SKU', label: 'DUPLICATE_SKU' },
      { value: 'INVALID_TAX_ID', label: 'INVALID_TAX_ID' },
      { value: 'EXACT_DUPLICATE', label: 'EXACT_DUPLICATE' },
      { value: 'COUNT_INVARIANT_VIOLATION', label: 'COUNT_INVARIANT_VIOLATION' },
      { value: 'FORMULA_PREFIX', label: 'FORMULA_PREFIX' },
      { value: 'REQUIRED_FIELD_MISSING', label: 'REQUIRED_FIELD_MISSING' },
      { value: 'FOREIGN_KEY_MISSING', label: 'FOREIGN_KEY_MISSING' },
      { value: 'MALFORMED_UUID', label: 'MALFORMED_UUID' },
    ],
  },
];
