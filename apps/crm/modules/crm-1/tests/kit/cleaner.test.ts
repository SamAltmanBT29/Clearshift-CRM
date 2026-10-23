import { describe, it, expect } from 'vitest';
import {
  cleanRows,
  cleanContactRows,
  cleanCompanyRows,
  cleanLeadRows,
  Crm1Cleaner,
} from '../../src/kit/cleaner.js';

const baseContact = {
  id: 'c1000001-0000-4000-8000-000000000001',
  first_name: 'John',
  last_name: 'Smith',
  email: 'john.smith@synthetic.example',
  phone: '+15550100100',
};

const baseCompany = {
  id: 'c2000001-0000-4000-8000-000000000001',
  name: 'Acme Industrial Corp',
  tax_number: 'US123456789',
};

const baseLead = {
  id: 'c3000001-0000-4000-8000-000000000001',
  contact_id: 'c1000001-0000-4000-8000-000000000001',
  status: 'New',
};

describe('CRM-1 cleaning rules and field audit (#120, [CRM1-27])', () => {
  it('trims whitespace (RL-TEXT-01) and audits each change', () => {
    const { rows, audit } = cleanRows([
      {
        ...baseContact,
        first_name: '  John  ',
        last_name: 'Smith   ',
      },
    ]);
    expect(rows[0]?.first_name).toBe('John');
    expect(rows[0]?.last_name).toBe('Smith');
    expect(audit).toEqual([
      { source_row: 1, field_name: 'first_name', original_value: '  John  ', cleaned_value: 'John', rule_id: 'RL-TEXT-01' },
      { source_row: 1, field_name: 'last_name', original_value: 'Smith   ', cleaned_value: 'Smith', rule_id: 'RL-TEXT-01' },
    ]);
  });

  it('collapses repeated inner spaces (RL-TEXT-01)', () => {
    const { rows, audit } = cleanRows([
      {
        ...baseCompany,
        name: 'Acme   Industrial   Corp',
      },
    ]);
    expect(rows[0]?.name).toBe('Acme Industrial Corp');
    expect(audit[0]?.rule_id).toBe('RL-TEXT-01');
  });

  it('removes control characters (RL-TEXT-02)', () => {
    const { rows, audit } = cleanRows([
      {
        ...baseContact,
        first_name: 'Jo\u0001hn',
      },
    ]);
    expect(rows[0]?.first_name).toBe('John');
    expect(audit[0]?.rule_id).toBe('RL-TEXT-02');
  });

  it('normalizes names to proper casing (RL-NAME-01)', () => {
    const { rows, audit } = cleanRows([
      {
        ...baseContact,
        first_name: 'mcdonald',
        last_name: "o'brien",
      },
    ]);
    expect(rows[0]?.first_name).toBe('McDonald');
    expect(rows[0]?.last_name).toBe("O'Brien");
    expect(audit.some((a) => a.rule_id === 'RL-NAME-01')).toBe(true);
  });

  it('handles hyphenated names in proper casing (RL-NAME-01)', () => {
    const { rows } = cleanRows([
      {
        ...baseContact,
        last_name: 'smith-jones',
      },
    ]);
    expect(rows[0]?.last_name).toBe('Smith-Jones');
  });

  it('lowercases email addresses and trims whitespace (RL-EMAIL-01)', () => {
    const { rows, audit } = cleanRows([
      {
        ...baseContact,
        email: '  Alice.Cooper@Synthetic-Domain.EXAMPLE  ',
      },
    ]);
    expect(rows[0]?.email).toBe('alice.cooper@synthetic-domain.example');
    expect(audit.some((a) => a.rule_id === 'RL-EMAIL-01')).toBe(true);
  });

  it('normalizes phone numbers and adds country code for 10-digit inputs (RL-PHONE-01)', () => {
    const { rows, audit } = cleanRows(
      [
        { ...baseContact, phone: '(555) 019-2834' },
        { ...baseContact, phone: '+44 20 7946 0958' },
      ],
      { phoneCountry: '+1' }
    );
    expect(rows[0]?.phone).toBe('+15550192834');
    expect(rows[1]?.phone).toBe('+442079460958');
    expect(audit.some((a) => a.rule_id === 'RL-PHONE-01')).toBe(true);
  });

  it('normalizes tax numbers by uppercasing and stripping punctuation (RL-TAX-01)', () => {
    const { rows, audit } = cleanRows([
      {
        ...baseCompany,
        tax_number: ' us-ein. 12-345 6789 ',
      },
    ]);
    expect(rows[0]?.tax_number).toBe('USEIN123456789');
    expect(audit.some((a) => a.rule_id === 'RL-TAX-01')).toBe(true);
  });

  it('coerces dates across supported date formats to ISO format (RL-DATE-01)', () => {
    const resYmd = cleanRows([{ ...baseContact, created_at: '2026-10-19' }]);
    const resDmy = cleanRows([{ ...baseContact, created_at: '19-10-2026' }], { dateFormat: 'DD-MM-YYYY' });
    const resSlashDmy = cleanRows([{ ...baseContact, created_at: '19/10/2026' }], { dateFormat: 'DD/MM/YYYY' });
    const resMdy = cleanRows([{ ...baseContact, created_at: '10/19/2026' }], { dateFormat: 'MM/DD/YYYY' });

    expect(resYmd.rows[0]?.created_at).toBe('2026-10-19T00:00:00.000Z');
    expect(resDmy.rows[0]?.created_at).toBe('2026-10-19T00:00:00.000Z');
    expect(resSlashDmy.rows[0]?.created_at).toBe('2026-10-19T00:00:00.000Z');
    expect(resMdy.rows[0]?.created_at).toBe('2026-10-19T00:00:00.000Z');
  });

  it('leaves dates that do not match the declared format unchanged without audit entries', () => {
    const { rows, audit } = cleanRows(
      [{ ...baseContact, created_at: '1760889600000', updated_at: '31-02-2026' }],
      { dateFormat: 'DD-MM-YYYY' }
    );
    expect(rows[0]?.created_at).toBe('1760889600000');
    expect(rows[0]?.updated_at).toBe('31-02-2026');
    expect(audit).toEqual([]);
  });

  it('normalizes lead status to allowed transition values (RL-ENUM-01)', () => {
    const { rows, audit } = cleanRows([
      { ...baseLead, status: 'working' },
      { ...baseLead, status: 'QUALIFIED' },
    ]);
    expect(rows[0]?.status).toBe('Working');
    expect(rows[1]?.status).toBe('Qualified');
    expect(audit.some((a) => a.rule_id === 'RL-ENUM-01')).toBe(true);
  });

  it('lowercases consent status values (RL-ENUM-01)', () => {
    const { rows, audit } = cleanRows([
      { ...baseContact, consent_status: 'GRANTED' },
    ]);
    expect(rows[0]?.consent_status).toBe('granted');
    expect(audit.some((a) => a.rule_id === 'RL-ENUM-01')).toBe(true);
  });

  it('rejects rows missing required fields with structured reason code', () => {
    const { rows, rejects } = cleanRows([
      { ...baseContact, first_name: '   ', last_name: '' },
    ]);
    expect(rows).toEqual([]);
    expect(rejects.length).toBe(2);
    expect(rejects.map((r) => r.field_name)).toEqual(['first_name', 'last_name']);
    expect(rejects[0]?.reason_code).toBe('REQUIRED_FIELD_MISSING');
    expect(rejects[0]?.source_row).toBe(1);
  });

  it('rejects rows with malformed email syntax', () => {
    const { rows, rejects } = cleanRows([
      { ...baseContact, email: 'not-a-valid-email' },
    ]);
    expect(rows).toEqual([]);
    expect(rejects.some((r) => r.reason_code === 'INVALID_EMAIL')).toBe(true);
  });

  it('rejects rows with alphabetic characters in phone numbers', () => {
    const { rows, rejects } = cleanRows([
      { ...baseContact, phone: 'CALL-BOB-NOW' },
    ]);
    expect(rows).toEqual([]);
    expect(rejects.some((r) => r.reason_code === 'INVALID_PHONE')).toBe(true);
  });

  it('rejects rows with formula injection prefixes', () => {
    const { rows, rejects } = cleanRows([
      { ...baseContact, first_name: '=cmd|"/C calc"!A0' },
    ]);
    expect(rows).toEqual([]);
    expect(rejects.some((r) => r.reason_code === 'FORMULA_INJECTION_RISK')).toBe(true);
  });

  it('skips disabled cleaning rules when instructed', () => {
    const { rows, audit } = cleanRows(
      [{ ...baseContact, first_name: 'mcdonald' }],
      { disabledRules: ['RL-NAME-01'] }
    );
    expect(rows[0]?.first_name).toBe('mcdonald');
    expect(audit.filter((a) => a.rule_id === 'RL-NAME-01')).toEqual([]);
  });

  it('never mutates raw input and behaves deterministically across runs', () => {
    const input = [{ ...baseContact, first_name: '  ALICE  ', email: '  ALICE@EXAMPLE.COM ' }];
    const originalSnapshot = JSON.stringify(input);

    const run1 = cleanRows(input);
    const run2 = cleanRows(input);

    expect(JSON.stringify(input)).toBe(originalSnapshot);
    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });

  it('emits zero audit entries and zero rejects for pristine data', () => {
    const { audit, rejects } = cleanRows([baseContact]);
    expect(audit).toEqual([]);
    expect(rejects).toEqual([]);
  });

  it('supports entity-specific helper methods and class instance', () => {
    const contactRes = cleanContactRows([baseContact]);
    expect(contactRes.rows.length).toBe(1);

    const companyRes = cleanCompanyRows([baseCompany]);
    expect(companyRes.rows.length).toBe(1);

    const leadRes = cleanLeadRows([baseLead]);
    expect(leadRes.rows.length).toBe(1);

    const cleaner = new Crm1Cleaner();
    const result = cleaner.clean([baseContact]);
    expect(result.rows.length).toBe(1);
  });
});
