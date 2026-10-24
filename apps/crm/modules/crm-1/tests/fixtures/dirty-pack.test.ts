import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  generateCanonicalCrm1Records,
  formatRecordsAsCsv,
  buildCrm1Manifest,
  buildCrm1ExpectedProfile,
  CSV_COLUMNS,
  SEEDED_COMPANIES,
} from '../../src/domain/dirty-data-pack.js';
import { assertConservationEquation } from '../../src/domain/qa-specs.js';
import { normalizeEmail, normalizePhone, normalizeName } from '@cs/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../../../..');

const FIXTURE_CSV = path.join(__dirname, 'dirty-pack-100.csv');
const FIXTURE_MANIFEST = path.join(__dirname, 'manifest.json');
const SAMPLE_CSV = path.join(REPO_ROOT, 'sample-data/crm-1/dirty-pack-100.csv');
const SAMPLE_MANIFEST = path.join(REPO_ROOT, 'sample-data/crm-1/manifest.json');
const SAMPLE_PROFILE = path.join(REPO_ROOT, 'sample-data/crm-1/expected-profile.json');

/**
 * Robust RFC-4180 CSV line parser supporting embedded commas inside quoted fields.
 */
function parseCsvLine(text: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

describe('CRM-1 Canonical Module Dirty Data Pack (#118, [CRM1-25])', () => {
  it('locates dirty-pack-100.csv and manifest.json in module fixtures and sample-data', () => {
    expect(fs.existsSync(FIXTURE_CSV)).toBe(true);
    expect(fs.existsSync(FIXTURE_MANIFEST)).toBe(true);
    expect(fs.existsSync(SAMPLE_CSV)).toBe(true);
    expect(fs.existsSync(SAMPLE_MANIFEST)).toBe(true);
    expect(fs.existsSync(SAMPLE_PROFILE)).toBe(true);
  });

  const rawCsv = fs.readFileSync(FIXTURE_CSV, 'utf8').trim();
  const lines = rawCsv.split('\n');
  const manifest = JSON.parse(fs.readFileSync(FIXTURE_MANIFEST, 'utf8'));
  const profile = JSON.parse(fs.readFileSync(SAMPLE_PROFILE, 'utf8'));

  describe('Acceptance Criterion 1: Dataset Sizing & Synthetic Safety (>= 100 rows, 0 PII)', () => {
    it('has exactly 1 header line and 100 data rows (total 101 lines)', () => {
      expect(lines.length).toBe(101); // 1 header + 100 data rows
      expect(manifest.totalRecords).toBe(100);
      expect(profile.fixture.rows).toBe(100);
    });

    it('contains canonical CSV headers conforming to CRM-1 Contacts domain', () => {
      const headerLine = lines[0];
      const headers = parseCsvLine(headerLine);
      expect(headers).toEqual([...CSV_COLUMNS]);
    });

    it('contains 100% synthetic data with zero real personal data or credentials', () => {
      expect(rawCsv).not.toMatch(/@(gmail|yahoo|hotmail|outlook)\.com/i);
      expect(rawCsv).not.toMatch(/password|secret|bearer/i);
      expect(rawCsv).not.toMatch(/ssn|social_security/i);

      // All generated emails use approved RFC-2606 reserved domains
      const emails = lines.slice(1).map((l) => parseCsvLine(l)[3]);
      for (const email of emails) {
        if (email.includes('@') && !email.includes('..') && !email.endsWith('@')) {
          const domain = email.split('@')[1].replace(/["\s]/g, '');
          expect(domain).toMatch(/(\.example|^example\.(com|org|net|co\.uk))$/i);
        }
      }
    });
  });

  describe('Acceptance Criterion 2: Deterministic Outcome Manifest & Conservation Equation', () => {
    it('satisfies the exact conservation balance sheet: 100 = 74 loaded + 18 rejected + 8 merged + 0 skipped (unaccounted = 0)', () => {
      const { loadedCount, rejectedCount, mergedCount, skippedCount, unaccounted } = manifest.summary;

      expect(loadedCount).toBe(74);
      expect(rejectedCount).toBe(18);
      expect(mergedCount).toBe(8);
      expect(skippedCount).toBe(0);
      expect(unaccounted).toBe(0);

      const balance = assertConservationEquation(
        manifest.totalRecords,
        loadedCount,
        rejectedCount,
        mergedCount,
        skippedCount
      );

      expect(balance.balanced).toBe(true);
      expect(balance.unaccounted).toBe(0);
      expect(loadedCount + rejectedCount + mergedCount + skippedCount).toBe(100);
    });

    it('covers all 5 required outcomes in manifest specification', () => {
      const requiredOutcomes = [
        'valid',
        'malformed',
        'null_required',
        'exact_duplicate',
        'foreign_key_missing',
      ];

      expect(manifest.summary.requiredOutcomesCovered).toEqual(
        expect.arrayContaining(requiredOutcomes)
      );

      const recordOutcomes = new Set(manifest.records.map((r: { expectedOutcome: string }) => r.expectedOutcome));
      for (const outcome of requiredOutcomes) {
        expect(recordOutcomes.has(outcome), `Outcome "${outcome}" must exist in record catalog`).toBe(true);
      }
    });

    it('enforces strictly disjoint defect categories with zero index overlap', () => {
      const categories = manifest.defectCategories;
      const seenIndices = new Set<number>();
      let totalDefectiveRecords = 0;

      for (const [categoryName, catData] of Object.entries(categories) as [
        string,
        { count: number; recordIndices: number[] }
      ][]) {
        expect(catData.count).toBe(catData.recordIndices.length);
        totalDefectiveRecords += catData.count;

        for (const idx of catData.recordIndices) {
          expect(
            seenIndices.has(idx),
            `Record index ${idx} in category ${categoryName} overlaps with another defect category`
          ).toBe(false);
          seenIndices.add(idx);
          expect(idx).toBeGreaterThanOrEqual(75);
          expect(idx).toBeLessThanOrEqual(100);
        }
      }

      // 8 duplicates + 18 rejects = 26 defective records
      expect(totalDefectiveRecords).toBe(26);
      expect(seenIndices.size).toBe(26);
      expect(manifest.summary.isDisjoint).toBe(true);
    });

    it('catalogs records 1..74 as VALID with 0 defects', () => {
      for (let i = 1; i <= 74; i++) {
        const record = manifest.records.find((r: { index: number }) => r.index === i);
        expect(record).toBeDefined();
        expect(record.status).toBe('VALID');
        expect(record.expectedOutcome).toBe('valid');
        expect(record.terminalOutcome).toBe('loaded');
        expect(record.defects).toEqual([]);
      }
    });

    it('catalogs records 75..100 as DEFECTIVE with expected outcome classifications', () => {
      for (let i = 75; i <= 100; i++) {
        const record = manifest.records.find((r: { index: number }) => r.index === i);
        expect(record).toBeDefined();
        expect(record.status).toBe('DEFECTIVE');
        expect(record.expectedOutcome).not.toBe('valid');
        expect(record.defects.length).toBeGreaterThanOrEqual(1);
        expect(record.defects[0].category).toBeDefined();
        expect(record.defects[0].reason).toBeDefined();
      }
    });
  });

  describe('Acceptance Criterion 3: Edge Case Scenarios Coverage', () => {
    it('covers all 4 mandatory edge case classes in summary', () => {
      const requiredEdgeCases = [
        'utf8_characters',
        'whitespace_padding',
        'date_format_variants',
        'boundary_numbers',
      ];

      expect(manifest.summary.edgeCasesCovered).toEqual(
        expect.arrayContaining(requiredEdgeCases)
      );
    });

    it('Row 71 covers utf8_characters (German umlauts, French accents, CJK, emoji)', () => {
      const row71 = lines[71];
      expect(row71).toContain('René');
      expect(row71).toContain('Müller-Schrödinger');
      expect(row71).toContain('🌟 Global Tech 日本語');
      expect(row71).toContain('Kurfürstendamm');
    });

    it('Row 72 covers boundary_numbers (maximum signed 32-bit int revenue: 2,147,483,647)', () => {
      const cols = parseCsvLine(lines[72]);
      expect(cols[13]).toBe('2147483647');
      expect(Number(cols[13])).toBe(2147483647);
    });

    it('Row 73 covers date_format_variants (valid space-delimited timestamp parseable as date)', () => {
      const cols = parseCsvLine(lines[73]);
      const dateStr = cols[14];
      expect(dateStr).toBe('2026-03-03 14:30:00');
      expect(Number.isNaN(new Date(dateStr).getTime())).toBe(false);
    });

    it('Row 74 covers boundary_numbers (zero revenue floor: 0)', () => {
      const cols = parseCsvLine(lines[74]);
      expect(cols[13]).toBe('0');
    });

    it('Rows 76, 80, 82, 84, 86 cover whitespace_padding (leading, trailing, and tab spaces)', () => {
      // Row 76 has padded email
      expect(lines[76]).toContain('  SOPHIA.CHEN@Alpha-Tech.EXAMPLE  ');
      // Row 80 has padded phone
      expect(lines[80]).toContain(' +1 (555) 012-7744 ');
      // Row 82 has padded phone
      expect(lines[82]).toContain(' +1 555.019.2834 ');
      // Row 84 has whitespace first name
      const row84Cols = parseCsvLine(lines[84]);
      expect(row84Cols[1].trim()).toBe('');
      // Row 86 has tab last name
      const row86Cols = parseCsvLine(lines[86]);
      expect(row86Cols[2].includes('\t')).toBe(true);
    });

    it('Rows 97-98 cover formula_injection_risk (= and + triggers)', () => {
      const row97 = lines[97];
      expect(row97).toContain("=cmd|'/C calc'!A0");
      const row98 = lines[98];
      expect(row98).toContain('+SUM(1+1)*cmd');
    });

    it('Row 99 covers out-of-bounds boundary number (negative annual revenue)', () => {
      const row99Cols = parseCsvLine(lines[99]);
      expect(row99Cols[13]).toBe('-50000');
      expect(Number(row99Cols[13])).toBeLessThan(0);
    });

    it('Row 100 covers field_too_long (500 character string exceeding 255 char boundary)', () => {
      const row100Cols = parseCsvLine(lines[100]);
      expect(row100Cols[1].length).toBe(500);
      expect(row100Cols[1].startsWith('A')).toBe(true);
    });
  });

  describe('Validation of Clean Records (Rows 1–74)', () => {
    it('all clean rows conform to Drizzle ORM schema constraints', () => {
      const seededCompanyIds = new Set(SEEDED_COMPANIES.map((c) => c.id));
      const allowedLeadStatuses = new Set(['New', 'Working', 'Qualified', 'Closed']);

      for (let i = 1; i <= 74; i++) {
        const line = lines[i];
        const cols = parseCsvLine(line);
        const [
          id,
          firstName,
          lastName,
          email,
          phone,
          address,
          companyId,
          ,
          leadStatus,
          sourceSystem,
          sourceId,
          consentStatus,
          unsubscribed,
          annualRevenue,
          createdAt,
        ] = cols;

        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(firstName.trim().length).toBeGreaterThan(0);
        expect(lastName.trim().length).toBeGreaterThan(0);
        expect(email).toContain('@');
        expect(phone.trim().length).toBeGreaterThan(5);
        expect(address.trim().length).toBeGreaterThan(0);
        expect(seededCompanyIds.has(companyId)).toBe(true);
        expect(allowedLeadStatuses.has(leadStatus)).toBe(true);
        expect(sourceSystem.trim().length).toBeGreaterThan(0);
        expect(sourceId.trim().length).toBeGreaterThan(0);
        expect(['granted', 'unknown', 'withdrawn']).toContain(consentStatus);
        expect(['true', 'false']).toContain(unsubscribed);
        expect(Number(annualRevenue)).toBeGreaterThanOrEqual(0);
        expect(Number.isNaN(new Date(createdAt).getTime())).toBe(false);
      }
    });
  });

  describe('Validation of Exact Duplicate Pairs (Rows 75–82)', () => {
    it('Rows 75 & 76 normalize to identical email key', () => {
      const email75 = parseCsvLine(lines[75])[3];
      const email76 = parseCsvLine(lines[76])[3];
      expect(normalizeEmail(email75)).toBe(normalizeEmail(email76));
      expect(normalizeEmail(email75)).toBe('sophia.chen@alpha-tech.example');
    });

    it('Rows 77 & 78 normalize to identical email key', () => {
      const email77 = parseCsvLine(lines[77])[3];
      const email78 = parseCsvLine(lines[78])[3];
      expect(normalizeEmail(email77)).toBe(normalizeEmail(email78));
      expect(normalizeEmail(email77)).toBe('marcus.vance@synthetic-corp.example');
    });

    it('Rows 79 & 80 normalize to identical phone + name compound key', () => {
      const cols79 = parseCsvLine(lines[79]);
      const cols80 = parseCsvLine(lines[80]);

      const key79 = `${normalizePhone(cols79[4])}#${normalizeName(`${cols79[1]} ${cols79[2]}`)}`;
      const key80 = `${normalizePhone(cols80[4])}#${normalizeName(`${cols80[1]} ${cols80[2]}`)}`;

      expect(key79).toBe(key80);
      expect(key79).toBe('+15550127744#david kim');
    });

    it('Rows 81 & 82 normalize to identical phone + name compound key', () => {
      const cols81 = parseCsvLine(lines[81]);
      const cols82 = parseCsvLine(lines[82]);

      const key81 = `${normalizePhone(cols81[4])}#${normalizeName(`${cols81[1]} ${cols81[2]}`)}`;
      const key82 = `${normalizePhone(cols82[4])}#${normalizeName(`${cols82[1]} ${cols82[2]}`)}`;

      expect(key81).toBe(key82);
      expect(key81).toBe('+15550192834#elena rostova');
    });
  });

  describe('Validation of Defective Rejections (Rows 83–100)', () => {
    it('Rows 83-86: NULL_REQUIRED (empty or whitespace mandatory names)', () => {
      for (let i = 83; i <= 86; i++) {
        const line = lines[i];
        const cols = parseCsvLine(line);
        const fn = cols[1];
        const ln = cols[2];
        const hasEmptyMandatory = fn.trim().length === 0 || ln.trim().length === 0;
        expect(hasEmptyMandatory).toBe(true);
      }
    });

    it('Rows 87-90: MALFORMED RFC-5322 Email Syntax', () => {
      const email87 = parseCsvLine(lines[87])[3];
      expect(email87).not.toContain('@');

      const email88 = parseCsvLine(lines[88])[3];
      expect(email88.endsWith('@')).toBe(true);

      const email89 = parseCsvLine(lines[89])[3];
      expect(email89).toContain(' ');

      const email90 = parseCsvLine(lines[90])[3];
      expect(email90).toContain('..');
    });

    it('Rows 91-92: MALFORMED Phone Numbers', () => {
      const phone91 = parseCsvLine(lines[91])[4];
      expect(phone91).toMatch(/[a-z]/i);

      const phone92 = parseCsvLine(lines[92])[4];
      expect(phone92.length).toBeLessThan(7);
    });

    it('Rows 93-94: MALFORMED Lead Status Allowlist Violations', () => {
      const allowed = ['New', 'Working', 'Qualified', 'Closed'];

      const status93 = parseCsvLine(lines[93])[8];
      expect(allowed).not.toContain(status93);
      expect(status93).toBe('Reopened');

      const status94 = parseCsvLine(lines[94])[8];
      expect(allowed).not.toContain(status94);
      expect(status94).toBe('Archived_Legacy');
    });

    it('Rows 95-96: FOREIGN_KEY_MISSING (Non-existent parent company IDs)', () => {
      const seededIds = new Set(SEEDED_COMPANIES.map((c) => c.id));

      const cid95 = parseCsvLine(lines[95])[6];
      expect(seededIds.has(cid95)).toBe(false);
      expect(cid95).toBe('00000000-0000-0000-0000-000000000000');

      const cid96 = parseCsvLine(lines[96])[6];
      expect(seededIds.has(cid96)).toBe(false);
      expect(cid96).toBe('ffffffff-ffff-ffff-ffff-ffffffffffff');
    });
  });

  describe('Acceptance Criterion 4: Determinism & Reproducibility Across Runs', () => {
    it('produces byte-identical generator output across multiple execution runs', () => {
      const run1 = generateCanonicalCrm1Records();
      const run2 = generateCanonicalCrm1Records();

      expect(run1).toEqual(run2);

      const csv1 = formatRecordsAsCsv(run1);
      const csv2 = formatRecordsAsCsv(run2);
      expect(csv1).toBe(csv2);

      const manifest1 = buildCrm1Manifest(run1);
      const manifest2 = buildCrm1Manifest(run2);
      expect(manifest1).toEqual(manifest2);
    });

    it('matches the SHA-256 fixture digest in expected-profile.json', () => {
      const computedSha = createHash('sha256').update(rawCsv + '\n', 'utf8').digest('hex');
      expect(computedSha).toBe(profile.fixture.sha256);
      expect(manifest.fixtureFile).toBe('dirty-pack-100.csv');
    });

    it('sample-data and test fixtures files are 100% byte-identical', () => {
      const sampleCsv = fs.readFileSync(SAMPLE_CSV, 'utf8');
      const fixtureCsv = fs.readFileSync(FIXTURE_CSV, 'utf8');
      expect(sampleCsv).toBe(fixtureCsv);

      const sampleManifest = fs.readFileSync(SAMPLE_MANIFEST, 'utf8');
      const fixtureManifest = fs.readFileSync(FIXTURE_MANIFEST, 'utf8');
      expect(sampleManifest).toBe(fixtureManifest);
    });
  });
});
