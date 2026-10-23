import { describe, it, expect } from 'vitest';
import { crm1MappingService } from '../../src/services/crm1-mapping.service.js';

describe('Crm1MappingService (#121, [CRM1-28])', () => {
  it('lists templates filtered by entity', () => {
    const all = crm1MappingService.listTemplates();
    expect(all.length).toBe(6);

    const contactTemplates = crm1MappingService.listTemplates('crm1_contacts');
    expect(contactTemplates.length).toBe(2);
    expect(contactTemplates.every((t) => t.entity === 'crm1_contacts')).toBe(true);

    const leadTemplates = crm1MappingService.listTemplates('crm1_leads');
    expect(leadTemplates.length).toBe(2);
    expect(leadTemplates.every((t) => t.entity === 'crm1_leads')).toBe(true);
  });

  it('retrieves template with SHA-256 checksum or throws 404 for missing template', () => {
    const { template, checksum } = crm1MappingService.getTemplate('crm1-contacts-canonical');
    expect(template.id).toBe('crm1-contacts-canonical');
    expect(template.version).toBe(1);
    expect(checksum).toMatch(/^[0-9a-f]{64}$/);

    expect(() => crm1MappingService.getTemplate('non-existent-template')).toThrow(
      "Mapping template 'non-existent-template' not found"
    );
  });

  it('exposes enum dictionaries matching CRM SDS standards', () => {
    const enums = crm1MappingService.getEnumDictionaries();
    expect(enums.lead_status.allowlist).toEqual(['New', 'Working', 'Qualified', 'Closed']);
    expect(enums.consent_status.allowlist).toEqual(['unknown', 'granted', 'withdrawn']);
    expect(enums.boolean.allowlist).toEqual(['true', 'false']);
  });

  it('validates dry-run readiness and halts on unmapped required target attributes', () => {
    // Valid: contains required fields 'first_name', 'last_name'
    const result = crm1MappingService.validateDryRun('crm1-contacts-canonical', [
      'first_name',
      'last_name',
      'email',
    ]);
    expect(result.ready).toBe(true);
    expect(result.mappedFieldsCount).toBe(17);

    // Invalid: missing 'last_name'
    expect(() =>
      crm1MappingService.validateDryRun('crm1-contacts-canonical', ['first_name', 'email'])
    ).toThrow('Unmapped required target fields for crm1-contacts-canonical@1');
  });

  it('processes batch mapping with mixed valid and invalid rows', () => {
    const rawBatch = [
      {
        first_name: 'Alice',
        last_name: 'Smith',
        email: 'alice.smith@synthetic.example',
        phone: '+15550100111',
        lead_status: 'in_progress',
      },
      {
        first_name: 'Bob',
        last_name: 'Jones',
        email: 'bob.jones@synthetic.example',
        lead_status: 'converted',
      },
      {
        // Missing required 'first_name' and 'last_name'
        email: 'invalid@synthetic.example',
      },
    ];

    const result = crm1MappingService.processBatchMapping(
      'crm1-contacts-canonical',
      rawBatch,
      { sourceColumns: ['first_name', 'last_name', 'email', 'phone', 'lead_status'] }
    );

    expect(result.totalRows).toBe(3);
    expect(result.successfulCount).toBe(2);
    expect(result.failedCount).toBe(1);

    expect(result.rows[0]?.['firstName']).toBe('Alice');
    expect(result.rows[0]?.['leadStatus']).toBe('Working');
    expect(result.rows[1]?.['firstName']).toBe('Bob');
    expect(result.rows[1]?.['leadStatus']).toBe('Qualified');

    expect(result.failures[0]?.sourceRow).toBe(3);
    expect(result.failures[0]?.errors.length).toBe(2);
  });
});
