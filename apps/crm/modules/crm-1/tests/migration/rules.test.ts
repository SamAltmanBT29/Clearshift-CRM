import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CRM1_CONTACTS_CANONICAL_V1,
  templateChecksum,
} from '../../src/kit/mapping-defaults.js';
import {
  RULES,
  RULESET_VERSION,
  evaluateRows,
  summarize,
  type RawRow,
} from '../../src/migration/rules.js';
import {
  generateCanonicalCrm1Rows,
  formatRowsToCsv,
  companyRegistryLedger,
  KNOWN_COMPANY_IDS,
} from '../../src/migration/dirty-data-generator.js';
import { parseCsv } from './csv.js';
import {
  ContactsQuerySchema,
  CRM1LeadStatusSchema,
  CRM1ConsentStatusSchema,
} from '@clearshift/contracts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const dir = path.join(root, 'sample-data/crm-1');

// Ensure directory exists
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const csvPath = path.join(dir, 'dirty-data-v1.csv');
if (!fs.existsSync(csvPath)) {
  const generatedRows = generateCanonicalCrm1Rows();
  const generatedCsv = formatRowsToCsv(generatedRows);
  fs.writeFileSync(csvPath, generatedCsv, 'utf8');
}

const csvBuf = fs.readFileSync(csvPath);
const sha256 = createHash('sha256').update(csvBuf).digest('hex');

const profilePath = path.join(dir, 'expected-profile.json');
const expected = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
const fixtureMeta = expected.fixtures?.['dirty-data-v1.csv'] || expected.fixture;
const expectedOutcomes = expected.rulesOutcomes || expected.outcomes;

const docsPath = path.join(root, 'apps/crm/modules/crm-1/docs/data-quality-rules.md');
const docs = fs.existsSync(docsPath) ? fs.readFileSync(docsPath, 'utf8') : '';

const rows = (): RawRow[] => parseCsv(csvBuf.toString('utf8'));
const run = (r: RawRow[]) => evaluateRows(r, companyRegistryLedger);
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

const valid: RawRow = {
  id: 'c1000001-0000-4000-8000-000000000099',
  first_name: 'Alexander',
  last_name: 'Hamilton',
  email: 'alexander.hamilton@synthetic.example.com',
  phone: '+1 (555) 012-3456',
  address: '100 Broadway Ave, New York, NY',
  company_id: KNOWN_COMPANY_IDS[0]!,
  lead_status: 'Qualified',
  golden_id: 'GLD-0099',
  source_system: 'salesforce',
  source_id: 'SRC-9999',
  consent_status: 'granted',
  consent_updated_at: '2026-10-01T12:00:00.000Z',
  unsubscribed: 'false',
  unsubscribed_updated_at: '',
  created_at: '2026-09-01T08:00:00.000Z',
  updated_at: '2026-10-01T12:00:00.000Z',
};

const one = (patch: Record<string, string>) => run([{ ...valid, ...patch }])[0]!;

describe('CRM-1 data-quality rules (CRM1-08, #13)', () => {
  it('fixture matches committed checksum, size and row count', () => {
    expect(sha(csvBuf)).toBe(fixtureMeta.sha256);
    expect(csvBuf.length).toBe(fixtureMeta.bytes);
    expect(rows().length).toBe(fixtureMeta.rows);
    expect(rows().length).toBe(100);
  });

  it('profile reproduces expected-profile.json exactly across runs', () => {
    const a = summarize(run(rows()));
    const b = summarize(run(rows()));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.outcomes).toEqual(expectedOutcomes);
    expect(a.byRule).toEqual(expected.byRule);
    expect(expected.rulesetVersion).toBe(RULESET_VERSION);
  });

  it('keeps raw input and file checksum unchanged', () => {
    const data = rows().map((r) => Object.freeze(r));
    const before = JSON.stringify(data);
    run(data);
    expect(JSON.stringify(data)).toBe(before);
    expect(sha(fs.readFileSync(path.join(dir, 'dirty-data-v1.csv')))).toBe(fixtureMeta.sha256);
  });

  it('every rule has stable id, version, condition, reason and is documented', () => {
    expect(new Set(RULES.map((r) => r.rule_id)).size).toBe(RULES.length);
    for (const r of RULES) {
      expect(r.rule_id).toMatch(/^CRM1-DQ-\d{3}$/);
      expect(r.version).toBeGreaterThanOrEqual(1);
      expect(r.condition.length).toBeGreaterThan(0);
      expect(r.reason.length).toBeGreaterThan(0);
      expect(docs).toContain(r.rule_id);
    }
  });

  it('outcome counts add up to total rows (100 = accept + normalize + merge + reject)', () => {
    const s = summarize(run(rows()));
    expect(Object.values(s.outcomes).reduce((a, b) => a + b, 0)).toBe(s.total);
    expect(s.total).toBe(100);
    expect(s.outcomes.accept).toBe(54);
    expect(s.outcomes.normalize).toBe(8);
    expect(s.outcomes.merge).toBe(4);
    expect(s.outcomes.reject).toBe(34);
  });

  describe('valid and invalid row per field and enumeration', () => {
    it('accepts a fully valid row and a row with all optional fields blank', () => {
      expect(one({}).outcome).toBe('accept');
      const blank = one({
        id: '',
        email: '',
        phone: '',
        address: '',
        company_id: '',
        lead_status: '',
        golden_id: '',
        source_system: '',
        source_id: '',
        consent_status: '',
        consent_updated_at: '',
        unsubscribed: '',
        unsubscribed_updated_at: '',
        created_at: '',
        updated_at: '',
      });
      expect(blank.outcome).toBe('accept');
    });

    it.each([
      ['first_name', 'CRM1-DQ-001'],
      ['last_name', 'CRM1-DQ-002'],
    ])('rejects blank required field %s', (field, id) => {
      const r = one({ [field]: '   ' });
      expect(r.outcome).toBe('reject');
      expect(r.violations.map((v) => v.rule_id)).toContain(id);
    });

    it.each([
      ['id', 'not-a-valid-uuid', 'CRM1-DQ-003'],
      ['email', 'invalid-email-format', 'CRM1-DQ-004'],
      ['phone', '123', 'CRM1-DQ-005'],
      ['lead_status', 'Won', 'CRM1-DQ-006'],
      ['company_id', 'not-a-uuid', 'CRM1-DQ-007'],
      ['company_id', 'c2000001-0000-4000-8000-999999999999', 'CRM1-DQ-008'],
      ['consent_status', 'opted_in', 'CRM1-DQ-010'],
      ['address', 'X'.repeat(300), 'CRM1-DQ-011'],
      ['created_at', '2026/09/01 12:00', 'CRM1-DQ-012'],
      ['updated_at', 'invalid-timestamp', 'CRM1-DQ-013'],
      ['updated_at', '2026-08-01T00:00:00.000Z', 'CRM1-DQ-014'],
    ])('rejects invalid %s=%s', (field, value, id) => {
      const r = one({ [field]: value });
      expect(r.outcome).toBe('reject');
      expect(r.violations.map((v) => v.rule_id)).toContain(id);
    });

    it.each(['New', 'Working', 'Qualified', 'Closed'])('accepts lead_status %s', (lead_status) => {
      expect(one({ lead_status }).outcome).toBe('accept');
    });

    it.each(['unknown', 'granted', 'withdrawn'])('accepts consent_status %s', (consent_status) => {
      expect(one({ consent_status }).outcome).toBe('accept');
    });

    it.each(['true', 'false'])('accepts unsubscribed %s', (unsubscribed) => {
      expect(one({ unsubscribed }).outcome).toBe('accept');
    });

    it('accepts valid phone numbers with plus prefix and varied formatting', () => {
      expect(one({ phone: '+1 (555) 019-2834' }).outcome).toBe('accept');
      expect(one({ phone: '+44 20 7946 0912' }).outcome).toBe('accept');
      expect(one({ phone: '555-019-2834' }).outcome).toBe('accept');
    });

    it('accepts UTF-8 international characters in name and address', () => {
      expect(one({ first_name: 'Renée', last_name: 'Müller', address: 'Königsallee 42' }).outcome).toBe('accept');
    });
  });

  describe('normalization, duplicates and references', () => {
    it('normalizes padding without rejecting and never alters the raw row', () => {
      const raw = { ...valid, first_name: '  Alexander  ', email: '  ALEXANDER.HAMILTON@SYNTHETIC.EXAMPLE.COM  ' };
      const r = run([raw])[0]!;
      expect(r.outcome).toBe('normalize');
      expect(raw.first_name).toBe('  Alexander  ');
      expect(raw.email).toBe('  ALEXANDER.HAMILTON@SYNTHETIC.EXAMPLE.COM  ');
    });

    it('counts exact duplicates as merged by id, email, phone+name, and source key', () => {
      const r = run([
        valid,
        { ...valid }, // dup id
        { ...valid, id: 'c1000001-0000-4000-8000-000000000088' }, // dup email
        { ...valid, id: 'c1000001-0000-4000-8000-000000000087', email: 'diff@synthetic.example.com' }, // dup phone+name
      ]);
      expect(r.map((x) => x.outcome)).toEqual(['accept', 'merge', 'merge', 'merge']);
      expect(r[1]!.violations.map((v) => v.code)).toContain('DUPLICATE_EXACT');
    });

    it('does not treat near-duplicates as duplicates (no fuzzy matching in V1)', () => {
      const r = run([
        valid,
        {
          ...valid,
          id: 'c1000001-0000-4000-8000-000000000086',
          email: 'alex.hamilton@synthetic.example.com',
          phone: '+1 (555) 012-3457',
          source_id: 'SRC-9998',
        },
      ]);
      expect(r.map((x) => x.outcome)).toEqual(['accept', 'accept']);
    });

    it('rejects unknown company references with stable code FOREIGN_KEY_MISSING', () => {
      const r = one({ company_id: 'c2000001-0000-4000-8000-000000099999' });
      expect(r.violations).toEqual([
        expect.objectContaining({
          rule_id: 'CRM1-DQ-008',
          code: 'FOREIGN_KEY_MISSING',
          version: 1,
        }),
      ]);
    });

    it.each(['=SUM(A1:A10)', '@CMD|calc', '+HYPERLINK("http://evil.com")', '-100'])('rejects formula-prefixed field %s', (formula) => {
      const r = one({ first_name: formula });
      expect(r.outcome).toBe('reject');
      expect(r.violations.map((v) => v.code)).toContain('FORMULA_PREFIX');
    });
  });

  describe('domain invariants for CRM-1 Contacts, Companies and Leads', () => {
    it('contact search is by name/email, page size default 25 and server-paged', () => {
      const parsedDefault = ContactsQuerySchema.parse({});
      expect(parsedDefault.page).toBe(1);
      expect(parsedDefault.pageSize).toBe(25);
      expect(parsedDefault.limit).toBe(25);

      const parsedSearch = ContactsQuerySchema.parse({ search: 'Hamilton', page: 2, pageSize: 50 });
      expect(parsedSearch.search).toBe('Hamilton');
      expect(parsedSearch.page).toBe(2);
      expect(parsedSearch.pageSize).toBe(50);
    });

    it('enforces lead status CRM SDS allowlist', () => {
      expect(CRM1LeadStatusSchema.options).toEqual(['New', 'Working', 'Qualified', 'Closed']);
    });

    it('enforces consent status allowlist', () => {
      expect(CRM1ConsentStatusSchema.options).toEqual(['unknown', 'granted', 'withdrawn']);
    });

    it('company link is optional and if present must refer to an existing company', () => {
      expect(one({ company_id: '' }).outcome).toBe('accept');
      expect(one({ company_id: KNOWN_COMPANY_IDS[0]! }).outcome).toBe('accept');
      expect(one({ company_id: 'c2000001-0000-4000-8000-999999999999' }).outcome).toBe('reject');
    });
  });

  it('mapping-template.json matches the CRM-1 contacts canonical template and checksum', () => {
    const file = JSON.parse(fs.readFileSync(path.join(dir, 'mapping-template.json'), 'utf8'));
    expect(file.template).toEqual(JSON.parse(JSON.stringify(CRM1_CONTACTS_CANONICAL_V1)));
    expect(file.checksum).toBe(templateChecksum(CRM1_CONTACTS_CANONICAL_V1));
  });
});
