import { describe, it, expect } from 'vitest';
import React from 'react';
import { CleaningAuditPage } from '../../web/pages/CleaningAuditPage.js';
import { CRM1_CLEANING_ROUTE } from '../../web/routes.js';
import { CLEANING_AUDIT_COLUMNS, CLEANING_REJECTS_COLUMNS } from '../../web/table/columns.js';

describe('CleaningAuditPage Frontend Component (#120, [CRM1-27])', () => {
  const sampleAudit = [
    {
      source_row: 1,
      field_name: 'first_name',
      original_value: '  John  ',
      cleaned_value: 'John',
      rule_id: 'RL-TEXT-01',
    },
    {
      source_row: 1,
      field_name: 'email',
      original_value: 'JOHN@EXAMPLE.COM',
      cleaned_value: 'john@example.com',
      rule_id: 'RL-EMAIL-01',
    },
  ];

  const sampleRejects = [
    {
      source_row: 2,
      field_name: 'first_name',
      reason_code: 'REQUIRED_FIELD_MISSING',
      reason: 'first_name is required and cannot be empty',
    },
  ];

  const sampleSummary = {
    totalRows: 2,
    cleanedRows: 1,
    rejectedRows: 1,
    auditEntriesCount: 2,
    byRule: {
      'RL-TEXT-01': 1,
      'RL-EMAIL-01': 1,
    },
  };

  it('instantiates CleaningAuditPage React element successfully', () => {
    const element = React.createElement(CleaningAuditPage, {
      auditEntries: sampleAudit,
      rejectEntries: sampleRejects,
      summary: sampleSummary,
    });
    expect(element).toBeDefined();
    expect(element.type).toBe(CleaningAuditPage);
  });

  it('exposes CRM1_CLEANING_ROUTE metadata with valid fullPath and breadcrumbs', () => {
    expect(CRM1_CLEANING_ROUTE.id).toBe('crm1-cleaning');
    expect(CRM1_CLEANING_ROUTE.fullPath).toBe('/crm-1/cleaning');
    expect(CRM1_CLEANING_ROUTE.title).toBe('Cleaning Rules & Field Audit');
    expect(CRM1_CLEANING_ROUTE.breadcrumbs.length).toBeGreaterThanOrEqual(3);
  });

  it('exports CLEANING_AUDIT_COLUMNS and CLEANING_REJECTS_COLUMNS with required fields', () => {
    expect(CLEANING_AUDIT_COLUMNS.map((c) => c.key)).toEqual([
      'source_row',
      'field_name',
      'original_value',
      'cleaned_value',
      'rule_id',
    ]);

    expect(CLEANING_REJECTS_COLUMNS.map((c) => c.key)).toEqual([
      'source_row',
      'field_name',
      'reason_code',
      'reason',
    ]);
  });
});
