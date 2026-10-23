import { describe, it, expect } from 'vitest';
import {
  CRM1_CONTACTS_CANONICAL_V1,
  CRM1_CONTACTS_LEGACY_V1,
  CRM1_COMPANIES_CANONICAL_V1,
  CRM1_COMPANIES_LEGACY_V1,
  CRM1_LEADS_CANONICAL_V1,
  CRM1_LEADS_LEGACY_V1,
  assertDryRunReady,
  validateTemplate,
  getTemplate,
  listTemplates,
  mapRow,
  templateChecksum,
  translateEnum,
  ENUMS,
} from '../../src/kit/mapping-defaults.js';

const contactRow = {
  id: 'C1000001-0000-4000-8000-000000000001',
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'Jane.Doe@Synthetic.Example',
  phone: '+1 (555) 010-0100',
  address: '100 Main Street',
  company_id: 'c2000001-0000-4000-8000-000000000001',
  lead_status: 'in_progress',
  golden_id: 'GLD-001',
  source_system: 'salesforce',
  source_id: 'SF-101',
  consent_status: 'opt_in',
  unsubscribed: 'false',
  created_at: '2026-10-20T10:00:00.000Z',
  updated_at: '2026-10-20T10:00:00.000Z',
};

const companyRow = {
  id: 'c2000001-0000-4000-8000-000000000001',
  name: 'Acme Industrial Corp',
  tax_number: 'US123456789',
  email: 'info@acme-corp.synthetic.example',
  phone: '+1 555-010-0200',
  address: '200 Industrial Way',
  source_system: 'hubspot',
  source_id: 'HS-202',
  created_at: '2026-10-15T08:00:00.000Z',
  updated_at: '2026-10-15T08:00:00.000Z',
};

const leadRow = {
  id: 'c3000001-0000-4000-8000-000000000001',
  contact_id: 'c1000001-0000-4000-8000-000000000001',
  status: 'open',
  source_system: 'zoho',
  source_id: 'ZH-303',
  created_at: '2026-10-18T12:00:00.000Z',
  updated_at: '2026-10-18T12:00:00.000Z',
};

describe('CRM-1 mapping templates and value translation (#121, [CRM1-28])', () => {
  it('maps a canonical contact row with coercion, email lowercase, and enum translation', () => {
    const result = mapRow(contactRow, CRM1_CONTACTS_CANONICAL_V1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual({
      id: 'c1000001-0000-4000-8000-000000000001',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane.doe@synthetic.example',
      phone: '+15550100100',
      address: '100 Main Street',
      companyId: 'c2000001-0000-4000-8000-000000000001',
      leadStatus: 'Working',
      goldenId: 'GLD-001',
      sourceSystem: 'salesforce',
      sourceId: 'SF-101',
      consentStatus: 'granted',
      consentUpdatedAt: null,
      unsubscribed: false,
      unsubscribedUpdatedAt: null,
      createdAt: new Date('2026-10-20T10:00:00.000Z'),
      updatedAt: new Date('2026-10-20T10:00:00.000Z'),
    });
  });

  it('maps the legacy export layout for contacts correctly', () => {
    const legacyRow = {
      ContactId: 'c1000001-0000-4000-8000-000000000002',
      FirstName: 'Robert',
      LastName: 'Taylor',
      EmailAddress: 'Robert.Taylor@Synthetic.Example',
      PhoneNumber: '+15550100999',
      MailingAddress: '456 Market St',
      CompanyRef: 'c2000001-0000-4000-8000-000000000001',
      LeadStage: 'sql',
      ExternalSystem: 'legacy_crm',
      ExternalId: 'LEG-99',
      OptInConsent: 'yes',
      OptOutFlag: '0',
    };

    const result = mapRow(legacyRow, CRM1_CONTACTS_LEGACY_V1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value['firstName']).toBe('Robert');
    expect(result.value['lastName']).toBe('Taylor');
    expect(result.value['leadStatus']).toBe('Qualified');
    expect(result.value['consentStatus']).toBe('granted');
    expect(result.value['unsubscribed']).toBe(false);
  });

  it('maps a canonical company row with type coercion and normalization', () => {
    const result = mapRow(companyRow, CRM1_COMPANIES_CANONICAL_V1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual({
      id: 'c2000001-0000-4000-8000-000000000001',
      name: 'Acme Industrial Corp',
      taxNumber: 'US123456789',
      email: 'info@acme-corp.synthetic.example',
      phone: '+15550100200',
      address: '200 Industrial Way',
      sourceSystem: 'hubspot',
      sourceId: 'HS-202',
      createdAt: new Date('2026-10-15T08:00:00.000Z'),
      updatedAt: new Date('2026-10-15T08:00:00.000Z'),
    });
  });

  it('maps legacy company export fields to canonical attributes', () => {
    const legacyComp = {
      CompanyId: 'c2000001-0000-4000-8000-000000000002',
      CompanyName: 'Omni Global Ltd',
      TaxId: 'GB987654321',
      CorporateEmail: 'contact@omni.synthetic.example',
      WorkPhone: '+44 20 7946 0991',
      OfficeAddress: '10 Downing St',
      SourceOrigin: 'erp_import',
      LegacyRecordId: 'REC-555',
    };

    const result = mapRow(legacyComp, CRM1_COMPANIES_LEGACY_V1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value['name']).toBe('Omni Global Ltd');
    expect(result.value['taxNumber']).toBe('GB987654321');
    expect(result.value['sourceSystem']).toBe('erp_import');
    expect(result.value['sourceId']).toBe('REC-555');
  });

  it('maps canonical and legacy lead rows with status enum alignment', () => {
    const result = mapRow(leadRow, CRM1_LEADS_CANONICAL_V1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value['contactId']).toBe('c1000001-0000-4000-8000-000000000001');
    expect(result.value['status']).toBe('New');

    const legacyLead = {
      LeadId: 'c3000001-0000-4000-8000-000000000002',
      ContactRef: 'c1000001-0000-4000-8000-000000000001',
      LeadStatus: 'won',
      SystemCode: 'pipe_drive',
      OldId: 'PD-12',
    };

    const legResult = mapRow(legacyLead, CRM1_LEADS_LEGACY_V1);
    expect(legResult.ok).toBe(true);
    if (!legResult.ok) return;

    expect(legResult.value['status']).toBe('Closed');
  });

  it('translates various status synonyms according to CRM SDS allowlist', () => {
    expect(translateEnum('lead_status', 'new')).toBe('New');
    expect(translateEnum('lead_status', 'open')).toBe('New');
    expect(translateEnum('lead_status', 'incoming')).toBe('New');
    expect(translateEnum('lead_status', 'contacted')).toBe('Working');
    expect(translateEnum('lead_status', 'active')).toBe('Working');
    expect(translateEnum('lead_status', 'qualified')).toBe('Qualified');
    expect(translateEnum('lead_status', 'sales_qualified')).toBe('Qualified');
    expect(translateEnum('lead_status', 'won')).toBe('Closed');
    expect(translateEnum('lead_status', 'lost')).toBe('Closed');
    expect(translateEnum('lead_status', 'disqualified')).toBe('Closed');
  });

  it('translates consent status synonyms', () => {
    expect(translateEnum('consent_status', 'opt_in')).toBe('granted');
    expect(translateEnum('consent_status', 'subscribed')).toBe('granted');
    expect(translateEnum('consent_status', 'yes')).toBe('granted');
    expect(translateEnum('consent_status', 'opt_out')).toBe('withdrawn');
    expect(translateEnum('consent_status', 'revoked')).toBe('withdrawn');
    expect(translateEnum('consent_status', 'unknown')).toBe('unknown');
    expect(translateEnum('consent_status', 'pending')).toBe('unknown');
  });

  it('applies default values for blank optional fields', () => {
    const minimalContact = {
      first_name: 'Alice',
      last_name: 'Wonder',
    };

    const result = mapRow(minimalContact, CRM1_CONTACTS_CANONICAL_V1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value['firstName']).toBe('Alice');
    expect(result.value['lastName']).toBe('Wonder');
    expect(result.value['consentStatus']).toBe('unknown');
    expect(result.value['unsubscribed']).toBe(false);
    expect(result.value['address']).toBe(null);
    expect('createdAt' in result.value).toBe(false); // omitWhenBlank
  });

  it('reports missing required fields with structured error objects', () => {
    const badRow = {
      email: 'orphan@synthetic.example',
    };

    const result = mapRow(badRow, CRM1_CONTACTS_CANONICAL_V1);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors.map((e) => e.field)).toEqual(['firstName', 'lastName']);
    expect(result.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD');
  });

  it('rejects values outside the enum allowlist', () => {
    const invalidStatusRow = {
      contact_id: 'c1000001-0000-4000-8000-000000000001',
      status: 'pending_vendor_review_invalid',
    };

    const result = mapRow(invalidStatusRow, CRM1_LEADS_CANONICAL_V1);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors[0]?.code).toBe('INVALID_ENUM_VALUE');
    expect(result.errors[0]?.field).toBe('status');
  });

  it('rejects invalid type coercions for uuid, date, and boolean', () => {
    const invalidRow = {
      id: 'not-a-valid-uuid',
      first_name: 'Test',
      last_name: 'User',
      unsubscribed: 'maybe',
      updated_at: 'invalid-date-string',
    };

    const result = mapRow(invalidRow, CRM1_CONTACTS_CANONICAL_V1);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('INVALID_UUID');
    expect(codes).toContain('INVALID_BOOLEAN');
    expect(codes).toContain('INVALID_DATE');
  });

  it('blocks dry-run when required source columns are unmapped', () => {
    expect(() =>
      assertDryRunReady(CRM1_CONTACTS_CANONICAL_V1, ['id', 'email', 'phone'])
    ).toThrow('Unmapped required target fields for crm1-contacts-canonical@1');

    expect(() =>
      assertDryRunReady(CRM1_CONTACTS_CANONICAL_V1, ['first_name', 'last_name', 'email'])
    ).not.toThrow();

    expect(() =>
      assertDryRunReady(CRM1_COMPANIES_CANONICAL_V1, ['tax_number', 'email'])
    ).toThrow('Unmapped required target fields');

    expect(() =>
      assertDryRunReady(CRM1_COMPANIES_CANONICAL_V1, ['name', 'tax_number'])
    ).not.toThrow();
  });

  it('validates template structures and detects duplicate target mappings', () => {
    const validation = validateTemplate(CRM1_CONTACTS_CANONICAL_V1, ['first_name', 'last_name']);
    expect(validation.valid).toBe(true);

    const missingVal = validateTemplate(CRM1_CONTACTS_CANONICAL_V1, ['email']);
    expect(missingVal.valid).toBe(false);
    expect(missingVal.missingRequiredFields).toEqual(['firstName', 'lastName']);
  });

  it('resolves templates by id and target entity with stable checksums', () => {
    expect(getTemplate('crm1-contacts-canonical')).toBe(CRM1_CONTACTS_CANONICAL_V1);
    expect(getTemplate('crm1-contacts-canonical', 99)).toBe(undefined);
    expect(listTemplates('crm1_leads').length).toBe(2);

    const chk1 = templateChecksum(CRM1_CONTACTS_CANONICAL_V1);
    const chk2 = templateChecksum(CRM1_CONTACTS_CANONICAL_V1);
    expect(chk1).toBe(chk2);
    expect(chk1).not.toBe(templateChecksum(CRM1_CONTACTS_LEGACY_V1));
  });

  it('is purely deterministic and does not mutate the source row', () => {
    const snapshot = JSON.stringify(contactRow);
    const a = mapRow(contactRow, CRM1_CONTACTS_CANONICAL_V1);
    const b = mapRow(contactRow, CRM1_CONTACTS_CANONICAL_V1);

    expect(JSON.stringify(contactRow)).toBe(snapshot);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
