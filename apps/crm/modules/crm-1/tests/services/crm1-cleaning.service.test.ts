import { describe, it, expect } from 'vitest';
import {
  Crm1CleaningService,
  crm1CleaningService,
} from '../../src/services/crm1-cleaning.service.js';

describe('Crm1CleaningService (#120, [CRM1-27])', () => {
  const service = new Crm1CleaningService();

  const testContacts = [
    {
      id: 'c1000001-0000-4000-8000-000000000001',
      first_name: '  Marcus  ',
      last_name: 'Vance  ',
      email: 'MARCUS.VANCE@SYNTHETIC-CORP.EXAMPLE',
      phone: '(555) 010-4491',
    },
    {
      id: 'c1000002-0000-4000-8000-000000000002',
      first_name: '   ',
      last_name: 'Montgomery',
      email: 'montgomery@example.com',
    },
  ];

  const testCompanies = [
    {
      id: 'c2000001-0000-4000-8000-000000000001',
      name: '  Apex   Robotics  International ',
      tax_number: ' US-EIN. 123456789 ',
    },
  ];

  const testLeads = [
    {
      id: 'c3000001-0000-4000-8000-000000000001',
      contact_id: 'c1000001-0000-4000-8000-000000000001',
      status: 'working',
    },
  ];

  it('cleans contact records with whitespace, email lowercasing and phone normalization', () => {
    const result = service.cleanContacts([testContacts[0]!], { phoneCountry: '+1' });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]?.first_name).toBe('Marcus');
    expect(result.rows[0]?.last_name).toBe('Vance');
    expect(result.rows[0]?.email).toBe('marcus.vance@synthetic-corp.example');
    expect(result.rows[0]?.phone).toBe('+15550104491');
    expect(result.audit.length).toBeGreaterThan(0);
    expect(result.rejects.length).toBe(0);
  });

  it('rejects contact rows with missing mandatory name fields', () => {
    const result = service.cleanContacts([testContacts[1]!]);
    expect(result.rows.length).toBe(0);
    expect(result.rejects.length).toBe(1);
    expect(result.rejects[0]?.field_name).toBe('first_name');
    expect(result.rejects[0]?.reason_code).toBe('REQUIRED_FIELD_MISSING');
  });

  it('cleans companies with proper tax normalization and collapsed whitespace', () => {
    const result = service.cleanCompanies(testCompanies);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]?.name).toBe('Apex Robotics International');
    expect(result.rows[0]?.tax_number).toBe('USEIN123456789');
    expect(result.audit.some((a) => a.rule_id === 'RL-TAX-01')).toBe(true);
  });

  it('cleans leads with canonical status allowlist normalization', () => {
    const result = service.cleanLeads(testLeads);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]?.status).toBe('Working');
    expect(result.audit.some((a) => a.rule_id === 'RL-ENUM-01')).toBe(true);
  });

  it('processes batch cleaning and computes comprehensive summary metrics', () => {
    const batchResult = service.processBatchCleaning(
      [testContacts[0]!, testContacts[1]!],
      'batch-crm1-test-01',
      { phoneCountry: '+1' }
    );

    expect(batchResult.batchId).toBe('batch-crm1-test-01');
    expect(batchResult.timestamp).toBeDefined();
    expect(batchResult.summary.totalRows).toBe(2);
    expect(batchResult.summary.cleanedRows).toBe(1);
    expect(batchResult.summary.rejectedRows).toBe(1);
    expect(batchResult.summary.auditEntriesCount).toBeGreaterThan(0);
    expect(batchResult.summary.byReasonCode['REQUIRED_FIELD_MISSING']).toBe(1);
    expect(batchResult.summary.byRule['RL-TEXT-01']).toBeGreaterThan(0);
  });

  it('exposes shared singleton crm1CleaningService instance', () => {
    expect(crm1CleaningService).toBeInstanceOf(Crm1CleaningService);
  });
});
