import { describe, expect, it } from 'vitest';
import {
  CRM1CompanyListQuerySchema,
  CRM1ContactListQuerySchema,
  CRM1ImportListQuerySchema,
  CRM1LeadListQuerySchema,
} from '@clearshift/contracts/crm-1';

describe('CRM-1 server list query contracts', () => {
  it('defaults contact paging to page 1 and page size 25', () => {
    expect(CRM1ContactListQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
    });
  });

  it('accepts only documented contact filters and validates boolean query values', () => {
    expect(CRM1ContactListQuerySchema.parse({
      search: '  Alex alex@example.test ',
      page: '2',
      pageSize: '10',
      leadStatus: 'Working',
      consentStatus: 'withdrawn',
      unsubscribed: 'true',
      companyId: '11111111-1111-4111-8111-111111111111',
    })).toEqual({
      search: 'Alex alex@example.test',
      page: 2,
      pageSize: 10,
      leadStatus: 'Working',
      consentStatus: 'withdrawn',
      unsubscribed: true,
      companyId: '11111111-1111-4111-8111-111111111111',
    });

    expect(CRM1ContactListQuerySchema.safeParse({ unsubscribed: 'yes' }).success).toBe(false);
    expect(CRM1ContactListQuerySchema.safeParse({ unexpected: 'ignored?' }).success).toBe(false);
  });

  it('validates collection-specific company and lead filters', () => {
    expect(CRM1CompanyListQuerySchema.parse({
      sourceSystem: '  legacy-crm ',
    }).sourceSystem).toBe('legacy-crm');
    expect(CRM1LeadListQuerySchema.parse({
      status: 'Qualified',
      sourceSystem: 'web_form',
    })).toMatchObject({ page: 1, pageSize: 25, status: 'Qualified', sourceSystem: 'web_form' });
    expect(CRM1LeadListQuerySchema.safeParse({ status: 'Won' }).success).toBe(false);
  });

  it('validates bounded import batch pagination and status filters', () => {
    expect(CRM1ImportListQuerySchema.parse({ status: 'completed' })).toEqual({
      page: 1,
      pageSize: 25,
      status: 'completed',
    });
    expect(CRM1ImportListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(CRM1ImportListQuerySchema.safeParse({ status: 'running' }).success).toBe(false);
  });
});
