import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRM5_RUNS_V1, templateChecksum } from '../../src/kit/mapping.js';
import { RULES, RULESET_VERSION, evaluateRows, summarize, type RawRow } from '../../src/migration/rules.js';
import { parseCsv } from './csv.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const dir = path.join(root, 'sample-data/crm-5');
const csvBuf = fs.readFileSync(path.join(dir, 'dirty-data-v1.csv'));
const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected-profile.json'), 'utf8'));
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'apps/crm/modules/crm-5/tests/fixtures/manifest.json'), 'utf8'),
) as { records: { index: number; defects: { category: string }[] }[] };
const docs = fs.readFileSync(path.join(root, 'apps/crm/modules/crm-5/docs/data-quality-rules.md'), 'utf8');

const ledger = (id: string): boolean => !id.includes('missing-fk');
const rows = (): RawRow[] => parseCsv(csvBuf.toString('utf8'));
const run = (r: RawRow[]) => evaluateRows(r, ledger);
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

const CATEGORY_RULES: Record<string, string[]> = {
  NULL_REQUIRED: [1, 2, 3],
  EXACT_DUPLICATE: [17, 18],
  FOREIGN_KEY_MISSING: [6, 9],
  WHITESPACE_PADDING: [16],
  DATE_FORMAT_VARIANTS: [12, 13],
  BOUNDARY_NUMBERS: [10],
  MALFORMED_UUID: [4],
  LOGICAL_COUNT_INVARIANT_VIOLATION: [11],
  CHRONOLOGICAL_SEQUENCE_VIOLATION: [14],
  MALFORMED_JSON_METADATA: [15],
  FORMULA_INJECTION_RISK: [8],
};
const ruleId = (n: number): string => `CRM5-DQ-${String(n).padStart(3, '0')}`;

const valid: RawRow = {
  id: 'c5000001-0000-4000-8000-0000000000aa',
  batch_id: 'batch-crm-1-20261019-9001',
  module: 'crm-1',
  step: 'extract',
  status: 'completed',
  records_in: '10',
  records_out: '10',
  records_rejected: '0',
  started_at: '2026-10-19T10:00:00.000Z',
  completed_at: '2026-10-19T10:05:00.000Z',
  metadata: '{}',
};
const one = (patch: Record<string, string>) => run([{ ...valid, ...patch }])[0]!;

describe('CRM-5 data-quality rules (CRM5-08, #53)', () => {
  it('fixture matches committed checksum, size and row count', () => {
    expect(sha(csvBuf)).toBe(expected.fixture.sha256);
    expect(csvBuf.length).toBe(expected.fixture.bytes);
    expect(rows().length).toBe(expected.fixture.rows);
  });

  it('profile reproduces expected-profile.json exactly across runs', () => {
    const a = summarize(run(rows()));
    const b = summarize(run(rows()));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.outcomes).toEqual(expected.outcomes);
    expect(a.byRule).toEqual(expected.byRule);
    expect(expected.rulesetVersion).toBe(RULESET_VERSION);
  });

  it('every row outcome agrees with the committed manifest category', () => {
    const results = run(rows());
    for (const rec of manifest.records) {
      const got = results[rec.index - 1]!.violations.map((v) => v.rule_id);
      const category = rec.defects[0]?.category;
      if (!category) expect(got).toEqual([]);
      else {
        const allowed = (CATEGORY_RULES[category] ?? []).map(ruleId);
        expect(got.length > 0 && got.every((g) => allowed.includes(g))).toBe(true);
      }
    }
  });

  it('keeps raw input and file checksum unchanged', () => {
    const data = rows().map((r) => Object.freeze(r));
    const before = JSON.stringify(data);
    run(data);
    expect(JSON.stringify(data)).toBe(before);
    expect(sha(fs.readFileSync(path.join(dir, 'dirty-data-v1.csv')))).toBe(expected.fixture.sha256);
  });

  it('every rule has stable id, version, condition, reason and is documented', () => {
    expect(new Set(RULES.map((r) => r.rule_id)).size).toBe(RULES.length);
    for (const r of RULES) {
      expect(r.rule_id).toMatch(/^CRM5-DQ-\d{3}$/);
      expect(r.version).toBeGreaterThanOrEqual(1);
      expect(r.condition.length).toBeGreaterThan(0);
      expect(r.reason.length).toBeGreaterThan(0);
      expect(docs).toContain(r.rule_id);
    }
  });

  it('outcome counts add up to total rows', () => {
    const s = summarize(run(rows()));
    expect(Object.values(s.outcomes).reduce((a, b) => a + b, 0)).toBe(s.total);
  });

  describe('valid and invalid row per field and enumeration', () => {
    it('accepts a fully valid row and a row with all optional fields blank', () => {
      expect(one({}).outcome).toBe('accept');
      const blank = one({ id: '', status: '', records_in: '', records_out: '', records_rejected: '', started_at: '', completed_at: '', metadata: '' });
      expect(blank.outcome).toBe('accept');
    });

    it.each([
      ['batch_id', 'CRM5-DQ-001'],
      ['module', 'CRM5-DQ-002'],
      ['step', 'CRM5-DQ-003'],
    ])('rejects blank required field %s', (field, id) => {
      const r = one({ [field]: '   ' });
      expect(r.outcome).toBe('reject');
      expect(r.violations.map((v) => v.rule_id)).toContain(id);
    });

    it.each([
      ['id', 'not-a-uuid', 'CRM5-DQ-004'],
      ['status', 'done', 'CRM5-DQ-005'],
      ['module', 'salesforce', 'CRM5-DQ-006'],
      ['step', 'upload', 'CRM5-DQ-007'],
      ['records_in', '-1', 'CRM5-DQ-010'],
      ['records_out', '2147483648', 'CRM5-DQ-010'],
      ['records_rejected', 'abc', 'CRM5-DQ-010'],
      ['records_out', '11', 'CRM5-DQ-011'],
      ['started_at', '2026-10-19', 'CRM5-DQ-012'],
      ['completed_at', '1760889600000', 'CRM5-DQ-013'],
      ['completed_at', '2026-10-19T09:00:00.000Z', 'CRM5-DQ-014'],
      ['metadata', '{bad', 'CRM5-DQ-015'],
    ])('rejects invalid %s=%s', (field, value, id) => {
      const r = one({ [field]: value });
      expect(r.outcome).toBe('reject');
      expect(r.violations.map((v) => v.rule_id)).toEqual([id]);
    });

    it.each(['pending', 'running', 'completed', 'failed', 'halted'])('accepts status %s', (status) => {
      expect(one({ status }).outcome).toBe('accept');
    });

    it.each(['extract', 'profile', 'clean', 'map', 'load', 'validate', 'reconcile'])('accepts step %s', (step) => {
      expect(one({ step }).outcome).toBe('accept');
    });

    it('accepts boundary counts 0 and 2147483647', () => {
      expect(one({ records_in: '2147483647', records_out: '0', records_rejected: '0' }).outcome).toBe('accept');
      expect(one({ records_in: '0', records_out: '0', records_rejected: '0' }).outcome).toBe('accept');
    });

    it('accepts UTF-8 values in batch_id and metadata', () => {
      expect(one({ batch_id: 'batch-ünîcødé-9001', metadata: '{"n":"é"}' }).outcome).toBe('accept');
    });
  });

  describe('normalization, duplicates and references', () => {
    it('normalizes padding without rejecting and never alters the raw row', () => {
      const raw = { ...valid, module: '  CRM-1  ', batch_id: 'batch\tcrm-1\t9001' };
      const r = run([raw])[0]!;
      expect(r.outcome).toBe('normalize');
      expect(raw.module).toBe('  CRM-1  ');
    });

    it('counts exact duplicates as merged by id and by (batch_id, step), keeping the first row', () => {
      const r = run([valid, { ...valid }, { ...valid, id: 'c5000001-0000-4000-8000-0000000000bb' }]);
      expect(r.map((x) => x.outcome)).toEqual(['accept', 'merge', 'merge']);
      expect(r[1]!.violations.map((v) => v.code)).toContain('DUPLICATE_EXACT');
    });

    it('does not treat near-duplicates as duplicates (no fuzzy matching)', () => {
      const r = run([valid, { ...valid, id: 'c5000001-0000-4000-8000-0000000000bb', batch_id: 'batch-crm-1-20261019-9002' }]);
      expect(r.map((x) => x.outcome)).toEqual(['accept', 'accept']);
    });

    it('rejects unknown batch references with a stable code', () => {
      const r = one({ batch_id: 'batch-missing-fk-1' });
      expect(r.violations).toEqual([
        expect.objectContaining({ rule_id: 'CRM5-DQ-009', code: 'FOREIGN_KEY_MISSING', version: 1 }),
      ]);
    });

    it.each(['=SUM(A1)', '@CMD', '+1', '-1'])('rejects formula-prefixed batch_id %s', (batch_id) => {
      const r = one({ batch_id });
      expect(r.outcome).toBe('reject');
      expect(r.violations.map((v) => v.code)).toEqual(['FORMULA_PREFIX']);
    });
  });

  it('mapping-template.json matches the CRM-5 runs template and checksum', () => {
    const file = JSON.parse(fs.readFileSync(path.join(dir, 'mapping-template.json'), 'utf8'));
    expect(file.template).toEqual(JSON.parse(JSON.stringify(CRM5_RUNS_V1)));
    expect(file.checksum).toBe(templateChecksum(CRM5_RUNS_V1));
  });
});
