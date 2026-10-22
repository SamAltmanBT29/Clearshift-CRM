import { describe, it, expect } from 'vitest';
import { cleanRows } from '../../src/kit/cleaner.js';

const base = { id: 'c5000001-0000-4000-8000-000000000001', batch_id: 'b-1', module: 'crm-1', step: 'extract' };

describe('CRM-5 cleaning rules and field audit (#200, [CRM5-27])', () => {
  it('trims whitespace (RL-TEXT-01) and audits each change', () => {
    const { rows, audit } = cleanRows([{ ...base, module: ' crm-1 ', batch_id: 'b-1   ' }]);
    expect(rows[0]?.module).toBe('crm-1');
    expect(rows[0]?.batch_id).toBe('b-1');
    expect(audit).toEqual([
      { source_row: 1, field_name: 'batch_id', original_value: 'b-1   ', cleaned_value: 'b-1', rule_id: 'RL-TEXT-01' },
      { source_row: 1, field_name: 'module', original_value: ' crm-1 ', cleaned_value: 'crm-1', rule_id: 'RL-TEXT-01' },
    ]);
  });

  it('collapses repeated inner spaces', () => {
    const { rows } = cleanRows([{ ...base, batch_id: 'b   1' }]);
    expect(rows[0]?.batch_id).toBe('b 1');
  });

  it('removes control characters (RL-TEXT-02)', () => {
    const { rows, audit } = cleanRows([{ ...base, batch_id: 'b\u0001-1' }]);
    expect(rows[0]?.batch_id).toBe('b-1');
    expect(audit[0]?.rule_id).toBe('RL-TEXT-02');
  });

  it('lowercases enum fields', () => {
    const { rows, audit } = cleanRows([{ ...base, status: 'COMPLETED' }]);
    expect(rows[0]?.status).toBe('completed');
    expect(audit[0]?.rule_id).toBe('RL-ENUM-01');
  });

  it('lowercases email and normalizes phone', () => {
    const { rows, audit } = cleanRows([{ ...base, email: ' A@Example.COM ', phone: '+1 (555) 010-0199' }]);
    expect(rows[0]?.email).toBe('a@example.com');
    expect(rows[0]?.phone).toBe('+15550100199');
    expect(audit.map((a) => a.rule_id)).toEqual(['RL-TEXT-01', 'RL-EMAIL-01', 'RL-PHONE-01']);
  });

  it('adds the declared country code to 10-digit phones only', () => {
    const { rows } = cleanRows(
      [
        { ...base, phone: '98765 43210' },
        { ...base, batch_id: 'b-2', phone: '+44 20 7946 0958' },
      ],
      { phoneCountry: '+91' },
    );
    expect(rows[0]?.phone).toBe('+919876543210');
    expect(rows[1]?.phone).toBe('+442079460958');
  });

  it('coerces dates using the declared format (RL-DATE-01)', () => {
    const a = cleanRows([{ ...base, started_at: '19-10-2026' }], { dateFormat: 'DD-MM-YYYY' });
    const b = cleanRows([{ ...base, started_at: '10/19/2026' }], { dateFormat: 'MM/DD/YYYY' });
    const c = cleanRows([{ ...base, started_at: '2026-10-19' }]);
    expect(a.rows[0]?.started_at).toBe('2026-10-19T00:00:00.000Z');
    expect(b.rows[0]?.started_at).toBe('2026-10-19T00:00:00.000Z');
    expect(c.rows[0]?.started_at).toBe('2026-10-19T00:00:00.000Z');
  });

  it('leaves dates that do not match the declared format unchanged', () => {
    const { rows, audit } = cleanRows(
      [{ ...base, started_at: '1760889600000', completed_at: '31-02-2026' }],
      { dateFormat: 'DD-MM-YYYY' },
    );
    expect(rows[0]?.started_at).toBe('1760889600000');
    expect(rows[0]?.completed_at).toBe('31-02-2026');
    expect(audit).toEqual([]);
  });

  it('rejects rows missing required fields with a reason code', () => {
    const { rows, rejects } = cleanRows([{ ...base, batch_id: '   ', step: '' }]);
    expect(rows).toEqual([]);
    expect(rejects.map((r) => r.field_name)).toEqual(['batch_id', 'step']);
    expect(rejects[0]?.reason_code).toBe('REQUIRED_FIELD_MISSING');
    expect(rejects[0]?.source_row).toBe(1);
  });

  it('skips rules switched off for the run', () => {
    const { rows, audit } = cleanRows([{ ...base, module: ' CRM-1 ' }], { disabledRules: ['RL-ENUM-01'] });
    expect(rows[0]?.module).toBe('CRM-1');
    expect(audit.map((a) => a.rule_id)).toEqual(['RL-TEXT-01']);
  });

  it('never mutates raw input and is deterministic', () => {
    const input = [{ ...base, module: ' CRM-1 ' }];
    const snapshot = JSON.stringify(input);
    const a = cleanRows(input);
    const b = cleanRows(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('emits no audit entry for already clean values', () => {
    const { audit, rejects } = cleanRows([base]);
    expect(audit).toEqual([]);
    expect(rejects).toEqual([]);
  });
});
