import { describe, it, expect } from 'vitest';
import { crm4MappingService } from '../../src/services/crm4-mapping.service.js';

describe('Crm4MappingService (#181, [CRM4-28])', () => {
  it('lists templates filtered by entity', () => {
    const all = crm4MappingService.listTemplates();
    expect(all.length).toBe(8); // 2 per each of the 4 entities

    const listTemplates = crm4MappingService.listTemplates('crm4_lists');
    expect(listTemplates.length).toBe(2);
    expect(listTemplates.every((t) => t.entity === 'crm4_lists')).toBe(true);

    const campaignTemplates = crm4MappingService.listTemplates('crm4_campaigns');
    expect(campaignTemplates.length).toBe(2);
    expect(campaignTemplates.every((t) => t.entity === 'crm4_campaigns')).toBe(true);

    const memberTemplates = crm4MappingService.listTemplates('crm4_members');
    expect(memberTemplates.length).toBe(2);
    expect(memberTemplates.every((t) => t.entity === 'crm4_members')).toBe(true);

    const consentTemplates = crm4MappingService.listTemplates('crm4_consents');
    expect(consentTemplates.length).toBe(2);
    expect(consentTemplates.every((t) => t.entity === 'crm4_consents')).toBe(true);
  });

  it('retrieves template with SHA-256 checksum or throws 404 for missing template', () => {
    const { template, checksum } = crm4MappingService.getTemplate('crm4-lists-canonical');
    expect(template.id).toBe('crm4-lists-canonical');
    expect(template.version).toBe(1);
    expect(checksum).toMatch(/^[0-9a-f]{64}$/);

    expect(() => crm4MappingService.getTemplate('non-existent-template')).toThrow(
      "Mapping template 'non-existent-template' not found"
    );
  });

  it('exposes enum dictionaries matching CRM-4 SDS standards', () => {
    const enums = crm4MappingService.getEnumDictionaries();
    expect(enums.member_status.allowlist).toEqual(['sent', 'opened', 'clicked']);
    expect(enums.consent_status.allowlist).toEqual(['subscribed', 'unsubscribed']);
    expect(enums.boolean.allowlist).toEqual(['true', 'false']);
  });

  it('validates dry-run readiness and halts on unmapped required target attributes', () => {
    // Valid: contains required field 'name'
    const result = crm4MappingService.validateDryRun('crm4-lists-canonical', [
      'id',
      'name',
      'description',
    ]);
    expect(result.ready).toBe(true);
    expect(result.mappedFieldsCount).toBe(7);

    // Invalid: missing 'name'
    expect(() =>
      crm4MappingService.validateDryRun('crm4-lists-canonical', ['id', 'description'])
    ).toThrow('Unmapped required target fields for crm4-lists-canonical@1');
  });

  it('processes batch mapping with mixed valid and invalid rows', () => {
    const rawBatch = [
      {
        name: 'Sydney Meetup',
        campaign_date: '2026-11-10',
        list_id: '44444444-1111-4444-8444-000000000001',
        member_count: '50',
      },
      {
        name: 'Melbourne Workshop',
        campaign_date: '2026-12-01',
        list_id: '44444444-1111-4444-8444-000000000001',
        member_count: '35',
      },
      {
        // Missing required 'name' and invalid date
        campaign_date: 'invalid-date',
        list_id: '44444444-1111-4444-8444-000000000001',
      },
    ];

    const result = crm4MappingService.processBatchMapping(
      'crm4-campaigns-canonical',
      rawBatch,
      { sourceColumns: ['name', 'campaign_date', 'list_id', 'member_count'] }
    );

    expect(result.totalRows).toBe(3);
    expect(result.successfulCount).toBe(2);
    expect(result.failedCount).toBe(1);

    expect(result.rows[0]?.['name']).toBe('Sydney Meetup');
    expect(result.rows[0]?.['campaignDate']).toBe('2026-11-10');
    expect(result.rows[1]?.['name']).toBe('Melbourne Workshop');

    expect(result.failures[0]?.sourceRow).toBe(3);
    expect(result.failures[0]?.errors.length).toBeGreaterThanOrEqual(1);
  });
});
