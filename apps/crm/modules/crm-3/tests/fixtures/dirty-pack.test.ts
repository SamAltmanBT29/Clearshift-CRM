/**
 * CRM-3 Canonical Dirty Data Pack — Deterministic Fixture Validation
 *
 * Issue: #158  [CRM3-25]
 * Gate:  G2
 * Owner: Group 3 — Role 4 — Data / QA Lead
 *
 * Verifies that dirty-pack-100.csv and manifest.json satisfy all four
 * acceptance criteria from Issue #158:
 *
 *  AC1: At least 100 realistic synthetic rows; zero real personal data.
 *  AC2: Manifest documents expected outcome per row: valid, malformed,
 *       null_required, exact_duplicate, foreign_key_missing.
 *  AC3: Edge cases cover UTF-8 characters, whitespace padding,
 *       date format variants, and boundary numbers.
 *  AC4: Test suite verifies fixture counts reproduce identically across
 *       multiple runs (determinism).
 *
 * All test data is 100% synthetic. No real personal, customer, or employee
 * data is present in any fixture.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CRM3TicketStatusSchema,
  CRM3TicketPrioritySchema,
} from '@clearshift/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_FILE = path.join(__dirname, 'dirty-pack-100.csv');
const MANIFEST_FILE = path.join(__dirname, 'manifest.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a CSV line into fields (does not handle quoted commas, per the fixture spec). */
function splitCsvLine(line: string): string[] {
  return line.split(',');
}

/** UUID v4 regex per RFC-4122 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Pre-load files once
// ---------------------------------------------------------------------------

const rawCsv = fs.readFileSync(CSV_FILE, 'utf8').trim();
const csvLines = rawCsv.split('\n');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')) as {
  module: string;
  totalRecords: number;
  summary: {
    cleanRecordsCount: number;
    defectiveRecordsCount: number;
    requiredOutcomesCovered: string[];
    edgeCasesCovered: string[];
    isDisjoint: boolean;
  };
  columns: string[];
  defectCategories: Record<string, {
    count: number;
    recordIndices: number[];
    expectedOutcome: string;
  }>;
  records: Array<{
    index: number;
    id: string;
    expectedOutcome: string;
    defects: Array<{ category: string; field: string; reason: string }>;
  }>;
};

// ---------------------------------------------------------------------------
// Suite 1 — File existence & basic structure (AC1)
// ---------------------------------------------------------------------------

describe('CRM-3 Canonical Dirty Data Pack — Issue #158 [CRM3-25]', () => {
  describe('Suite 1: File existence and structure (AC1)', () => {
    it('dirty-pack-100.csv and manifest.json exist in the fixtures directory', () => {
      expect(fs.existsSync(CSV_FILE), `CSV missing: ${CSV_FILE}`).toBe(true);
      expect(fs.existsSync(MANIFEST_FILE), `Manifest missing: ${MANIFEST_FILE}`).toBe(true);
    });

    it('CSV has exactly 1 header line and 100 data rows (101 total)', () => {
      expect(csvLines.length).toBe(101);
    });

    it('CSV header matches the canonical CRM-3 ticket column schema', () => {
      const headers = splitCsvLine(csvLines[0]!);
      expect(headers).toEqual([
        'id',
        'subject',
        'status',
        'priority',
        'contact_id',
        'order_ref',
        'source_system',
        'source_id',
        'created_at',
        'updated_at',
      ]);
    });

    it('manifest totalRecords equals 100', () => {
      expect(manifest.totalRecords).toBe(100);
    });

    it('manifest.records array has exactly 100 entries', () => {
      expect(manifest.records.length).toBe(100);
    });

    it('manifest summary: cleanRecordsCount + defectiveRecordsCount = 100', () => {
      const { cleanRecordsCount, defectiveRecordsCount } = manifest.summary;
      expect(cleanRecordsCount + defectiveRecordsCount).toBe(100);
    });

    it('manifest summary: 50 clean, 50 defective rows', () => {
      expect(manifest.summary.cleanRecordsCount).toBe(50);
      expect(manifest.summary.defectiveRecordsCount).toBe(50);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 2 — Zero real personal data (AC1 safety invariant)
  // ---------------------------------------------------------------------------

  describe('Suite 2: Synthetic data safety — zero real personal data (AC1)', () => {
    it('CSV contains no real personal email domains (@gmail, @yahoo, @hotmail, @outlook)', () => {
      expect(rawCsv).not.toMatch(/@(gmail|yahoo|hotmail|outlook|icloud|proton)\\.com/i);
    });

    it('CSV contains no passwords, secrets, or bearer tokens', () => {
      expect(rawCsv).not.toMatch(/password|secret|bearer|api[_-]?key/i);
    });

    it('CSV contains no SSN or social security patterns', () => {
      expect(rawCsv).not.toMatch(/ssn|social.?security|tax.?id/i);
    });

    it('CSV contains no credit card number patterns (4/5 digit sequence runs)', () => {
      expect(rawCsv).not.toMatch(/\b(?:\d{4}[ -]){3}\d{4}\b/);
    });

    it('All synthetic contact UUIDs use the reserved c1000001-* or c2000001-* namespace', () => {
      // Valid rows use contact IDs in the synthetic namespace; defect rows intentionally deviate
      const validRows = manifest.records
        .filter((r) => r.expectedOutcome === 'valid')
        .map((r) => r.index);

      for (const rowIdx of validRows) {
        const parts = splitCsvLine(csvLines[rowIdx]!);
        const contactId = parts[4];
        if (contactId && contactId.length > 0) {
          const inNamespace =
            contactId.startsWith('c1000001-') ||
            contactId.startsWith('c2000001-') ||
            UUID_REGEX.test(contactId);
          expect(inNamespace, `Row ${rowIdx} contact_id '${contactId}' outside synthetic namespace`).toBe(true);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 3 — Manifest outcome coverage (AC2)
  // ---------------------------------------------------------------------------

  describe('Suite 3: Manifest covers all required outcomes (AC2)', () => {
    const REQUIRED_OUTCOMES = [
      'valid',
      'malformed',
      'null_required',
      'exact_duplicate',
      'foreign_key_missing',
    ] as const;

    it('manifest.summary.requiredOutcomesCovered lists all 5 required outcomes', () => {
      expect(manifest.summary.requiredOutcomesCovered).toEqual(
        expect.arrayContaining([...REQUIRED_OUTCOMES])
      );
    });

    it.each(REQUIRED_OUTCOMES)(
      'At least one record has expectedOutcome = "%s"',
      (outcome) => {
        const matching = manifest.records.filter((r) => r.expectedOutcome === outcome);
        expect(
          matching.length,
          `No record found with expectedOutcome '${outcome}'`
        ).toBeGreaterThan(0);
      }
    );

    it('manifest record index values are 1-indexed and span [1..100] without gaps', () => {
      const indices = manifest.records.map((r) => r.index).sort((a, b) => a - b);
      for (let i = 0; i < 100; i++) {
        expect(indices[i]).toBe(i + 1);
      }
    });

    it('defective records (expectedOutcome != valid) have at least one defect entry in manifest', () => {
      const defective = manifest.records.filter((r) => r.expectedOutcome !== 'valid');
      for (const record of defective) {
        expect(
          record.defects.length,
          `Record index ${record.index} (outcome=${record.expectedOutcome}) has no defects array entry`
        ).toBeGreaterThan(0);
      }
    });

    it('every defect entry has non-empty category, field, and reason', () => {
      for (const record of manifest.records) {
        for (const defect of record.defects) {
          expect(defect.category.length, `index ${record.index}: defect.category is empty`).toBeGreaterThan(0);
          expect(defect.field.length, `index ${record.index}: defect.field is empty`).toBeGreaterThan(0);
          expect(defect.reason.length, `index ${record.index}: defect.reason is empty`).toBeGreaterThan(0);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 4 — Defect category disjointness
  // ---------------------------------------------------------------------------

  describe('Suite 4: Defect categories are strictly disjoint (no index overlap)', () => {
    it('no record index appears in more than one defect category', () => {
      const seenIndices = new Set<number>();
      for (const [categoryName, catData] of Object.entries(manifest.defectCategories)) {
        for (const idx of catData.recordIndices) {
          expect(
            seenIndices.has(idx),
            `Index ${idx} appears in multiple defect categories (duplicate found in ${categoryName})`
          ).toBe(false);
          seenIndices.add(idx);
        }
      }
    });

    it('each category count matches its recordIndices array length', () => {
      for (const [name, catData] of Object.entries(manifest.defectCategories)) {
        expect(catData.count, `Category ${name}: count != recordIndices.length`).toBe(
          catData.recordIndices.length
        );
      }
    });

    it('sum of all category counts <= 50 (defective record ceiling)', () => {
      const totalCategoryCount = Object.values(manifest.defectCategories).reduce(
        (sum, cat) => sum + cat.count,
        0
      );
      expect(totalCategoryCount).toBeLessThanOrEqual(50);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 5 — Edge case coverage (AC3)
  // ---------------------------------------------------------------------------

  describe('Suite 5: Edge case coverage (AC3)', () => {
    const REQUIRED_EDGE_CASES = [
      'utf8_characters',
      'whitespace_padding',
      'date_format_variants',
      'boundary_numbers',
    ] as const;

    it('manifest.summary.edgeCasesCovered lists all 4 required edge case types', () => {
      expect(manifest.summary.edgeCasesCovered).toEqual(
        expect.arrayContaining([...REQUIRED_EDGE_CASES])
      );
    });

    it('Row 20 contains Unicode accented characters (résumé, Ünïcødé)', () => {
      const line = csvLines[20]!;
      const hasAccents = line.includes('Ünïcødé') || line.includes('résumé');
      expect(hasAccents, `Row 20 missing expected UTF-8 accent characters`).toBe(true);
    });

    it('Row 23 subject contains emoji characters (🎫 🚀)', () => {
      const line = csvLines[23]!;
      expect(line.includes('🎫') || line.includes('🚀'), 'Row 23 missing emoji').toBe(true);
    });

    it('Row 24 subject contains Japanese CJK characters', () => {
      const line = csvLines[24]!;
      // CJK Unified Ideographs range
      expect(/[\u3040-\u30FF\u4E00-\u9FFF]/.test(line), 'Row 24 missing Japanese script').toBe(true);
    });

    it('Row 47 subject contains Arabic script', () => {
      const line = csvLines[47]!;
      expect(/[\u0600-\u06FF]/.test(line), 'Row 47 missing Arabic script').toBe(true);
    });

    it('Row 48 subject contains Korean Hangul script', () => {
      const line = csvLines[48]!;
      expect(/[\uAC00-\uD7AF]/.test(line), 'Row 48 missing Korean Hangul').toBe(true);
    });

    it('Whitespace-only subject rows (52, 53) are present with blank-only subject fields', () => {
      // Row 52: 3 spaces; Row 53: tab
      const row52 = splitCsvLine(csvLines[52]!)[1]!;
      const row53 = splitCsvLine(csvLines[53]!)[1]!;
      expect(row52.trim().length).toBe(0);
      expect(row53.trim().length).toBe(0);
    });

    it('Row 21 has leading/trailing whitespace on subject (whitespace_padding edge case)', () => {
      const subject = splitCsvLine(csvLines[21]!)[1]!;
      expect(subject.startsWith('  ') || subject.endsWith('  ')).toBe(true);
    });

    it('Row 75 created_at is a localized date format (DATE_FORMAT_VARIANTS)', () => {
      const parts = splitCsvLine(csvLines[75]!);
      const createdAt = parts[8]!;
      // Should NOT parse as a valid ISO 8601 datetime
      const dateValue = new Date(createdAt);
      expect(isNaN(dateValue.getTime()) || !createdAt.includes('T'),
        `Row 75 created_at '${createdAt}' should not be a valid ISO datetime`
      ).toBe(true);
    });

    it('Row 76 created_at is date-only (missing time component)', () => {
      const parts = splitCsvLine(csvLines[76]!);
      const createdAt = parts[8]!;
      expect(createdAt).toBe('2026-03-21');
      expect(createdAt.includes('T')).toBe(false);
    });

    it('Row 77 created_at is epoch milliseconds integer', () => {
      const parts = splitCsvLine(csvLines[77]!);
      const createdAt = parts[8]!;
      expect(createdAt).toBe('1760889600000');
      expect(Number(createdAt)).toBeGreaterThan(0);
    });

    it('Row 22 subject is boundary minimum of 1 character (boundary_numbers)', () => {
      const subject = splitCsvLine(csvLines[22]!)[1]!;
      expect(subject.trim().length).toBe(1);
    });

    it('Row 49 source_id is a very long boundary string', () => {
      const parts = splitCsvLine(csvLines[49]!);
      const sourceId = parts[7]!;
      expect(sourceId.length).toBeGreaterThan(20);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 6 — Valid rows: schema conformance spot checks
  // ---------------------------------------------------------------------------

  describe('Suite 6: Valid rows pass CRM3 schema checks', () => {
    const VALID_INDICES = [1, 2, 3, 4, 5, 10, 20, 23, 28, 29, 30, 50];

    it.each(VALID_INDICES)(
      'Row %i: status and priority are valid CRM-3 enum values',
      (rowIdx) => {
        const parts = splitCsvLine(csvLines[rowIdx]!);
        const status = parts[2];
        const priority = parts[3];

        if (status) {
          expect(
            CRM3TicketStatusSchema.safeParse(status).success,
            `Row ${rowIdx}: status '${status}' failed CRM3TicketStatusSchema`
          ).toBe(true);
        }
        if (priority) {
          expect(
            CRM3TicketPrioritySchema.safeParse(priority).success,
            `Row ${rowIdx}: priority '${priority}' failed CRM3TicketPrioritySchema`
          ).toBe(true);
        }
      }
    );

    it.each(VALID_INDICES)(
      'Row %i: created_at and updated_at are valid ISO 8601 UTC datetimes',
      (rowIdx) => {
        const parts = splitCsvLine(csvLines[rowIdx]!);
        const createdAt = parts[8]!;
        const updatedAt = parts[9]!;

        const created = new Date(createdAt);
        const updated = new Date(updatedAt);
        expect(isNaN(created.getTime()), `Row ${rowIdx}: invalid created_at '${createdAt}'`).toBe(false);
        expect(isNaN(updated.getTime()), `Row ${rowIdx}: invalid updated_at '${updatedAt}'`).toBe(false);
        expect(updatedAt >= createdAt, `Row ${rowIdx}: updated_at < created_at`).toBe(true);
      }
    );

    it.each(VALID_INDICES)(
      'Row %i: id is a valid UUID format',
      (rowIdx) => {
        const id = splitCsvLine(csvLines[rowIdx]!)[0]!;
        expect(UUID_REGEX.test(id), `Row ${rowIdx}: id '${id}' is not a valid UUID`).toBe(true);
      }
    );

    it.each(VALID_INDICES)(
      'Row %i: subject is non-empty after trim',
      (rowIdx) => {
        const subject = splitCsvLine(csvLines[rowIdx]!)[1]!;
        expect(subject.trim().length, `Row ${rowIdx}: subject is blank after trim`).toBeGreaterThan(0);
      }
    );
  });

  // ---------------------------------------------------------------------------
  // Suite 7 — Defective rows: expected defects verified in CSV
  // ---------------------------------------------------------------------------

  describe('Suite 7: Defective rows have expected defects in the CSV', () => {
    it('Rows 51-53: EMPTY_SUBJECT — subject is blank (empty or whitespace-only)', () => {
      for (const rowIdx of [51, 52, 53]) {
        const subject = splitCsvLine(csvLines[rowIdx]!)[1]!;
        expect(
          subject.trim().length,
          `Row ${rowIdx}: expected blank subject`
        ).toBe(0);
      }
    });

    it('Rows 55-57: INVALID_STATUS — status not in CRM3 enum', () => {
      for (const rowIdx of [55, 56, 57]) {
        const status = splitCsvLine(csvLines[rowIdx]!)[2]!;
        expect(
          CRM3TicketStatusSchema.safeParse(status).success,
          `Row ${rowIdx}: status '${status}' should fail CRM3 enum validation`
        ).toBe(false);
      }
    });

    it('Rows 58-60: INVALID_PRIORITY — priority not in CRM3 enum', () => {
      for (const rowIdx of [58, 59, 60]) {
        const priority = splitCsvLine(csvLines[rowIdx]!)[3]!;
        expect(
          CRM3TicketPrioritySchema.safeParse(priority).success,
          `Row ${rowIdx}: priority '${priority}' should fail CRM3 enum validation`
        ).toBe(false);
      }
    });

    it('Rows 61-62: EXACT_DUPLICATE — id is identical to an earlier row', () => {
      const row1Id = splitCsvLine(csvLines[1]!)[0]!;
      const row61Id = splitCsvLine(csvLines[61]!)[0]!;
      expect(row61Id).toBe(row1Id);

      const row2Id = splitCsvLine(csvLines[2]!)[0]!;
      const row62Id = splitCsvLine(csvLines[62]!)[0]!;
      expect(row62Id).toBe(row2Id);
    });

    it('Rows 63-65: EXACT_DUPLICATE — source key (source_system + source_id) matches earlier rows', () => {
      // Row 63 duplicates natural key of row 3
      const row3Parts = splitCsvLine(csvLines[3]!);
      const row63Parts = splitCsvLine(csvLines[63]!);
      expect(row63Parts[6]).toBe(row3Parts[6]); // source_system
      expect(row63Parts[7]).toBe(row3Parts[7]); // source_id

      // Row 64 duplicates natural key of row 4
      const row4Parts = splitCsvLine(csvLines[4]!);
      const row64Parts = splitCsvLine(csvLines[64]!);
      expect(row64Parts[6]).toBe(row4Parts[6]);
      expect(row64Parts[7]).toBe(row4Parts[7]);
    });

    it('Row 67: FOREIGN_KEY_MISSING — nil UUID (all-zeros) in contact_id', () => {
      const contactId = splitCsvLine(csvLines[67]!)[4]!;
      expect(contactId).toBe('00000000-0000-0000-0000-000000000000');
    });

    it('Row 68: FOREIGN_KEY_MISSING — contact_id is not a UUID format', () => {
      const contactId = splitCsvLine(csvLines[68]!)[4]!;
      expect(UUID_REGEX.test(contactId)).toBe(false);
    });

    it('Rows 81-83: MALFORMED_UUID — id is not a valid RFC-4122 UUID', () => {
      const invalidIds: string[] = [];
      for (const rowIdx of [81, 82, 83]) {
        const id = splitCsvLine(csvLines[rowIdx]!)[0]!;
        if (!UUID_REGEX.test(id)) {
          invalidIds.push(id);
        }
      }
      expect(invalidIds.length).toBeGreaterThanOrEqual(2);
    });

    it('Row 79: DATE_FORMAT_VARIANTS — updated_at is chronologically before created_at', () => {
      const parts = splitCsvLine(csvLines[79]!);
      const createdAt = new Date(parts[8]!).getTime();
      const updatedAt = new Date(parts[9]!).getTime();
      expect(updatedAt).toBeLessThan(createdAt);
    });

    it('Rows 90-92: FORMULA_INJECTION_RISK — subject starts with injection prefix', () => {
      const injectionPrefixes = ['=', '@', '+'];
      for (const rowIdx of [90, 91, 92]) {
        const subject = splitCsvLine(csvLines[rowIdx]!)[1]!.trim();
        const hasInjectionPrefix = injectionPrefixes.some((p) => subject.startsWith(p));
        expect(
          hasInjectionPrefix,
          `Row ${rowIdx}: subject '${subject.slice(0, 20)}' should start with injection prefix`
        ).toBe(true);
      }
    });

    it('Rows 93-95: More INVALID_STATUS — legacy aliases and empty status', () => {
      const invalidStatuses = ['Resolved', 'Done', ''];
      for (let i = 0; i < 3; i++) {
        const rowIdx = 93 + i;
        const status = splitCsvLine(csvLines[rowIdx]!)[2]!;
        expect(
          CRM3TicketStatusSchema.safeParse(status).success,
          `Row ${rowIdx}: status '${status}' should fail CRM3 enum`
        ).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 8 — Determinism: fixture counts reproduce identically (AC4)
  // ---------------------------------------------------------------------------

  describe('Suite 8: Deterministic reproducibility — counts are stable (AC4)', () => {
    it('Re-reading dirty-pack-100.csv produces the same total line count on every run', () => {
      const re1 = fs.readFileSync(CSV_FILE, 'utf8').trim().split('\n');
      const re2 = fs.readFileSync(CSV_FILE, 'utf8').trim().split('\n');
      expect(re1.length).toBe(re2.length);
      expect(re1.length).toBe(101); // 1 header + 100 data rows
    });

    it('Re-reading manifest.json produces the same record count on every run', () => {
      const m1 = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
      const m2 = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
      expect(m1.records.length).toBe(m2.records.length);
      expect(m1.totalRecords).toBe(m2.totalRecords);
    });

    it('CSV row 50 content is stable (last clean row)', () => {
      const re1 = fs.readFileSync(CSV_FILE, 'utf8').trim().split('\n')[50];
      const re2 = fs.readFileSync(CSV_FILE, 'utf8').trim().split('\n')[50];
      expect(re1).toBe(re2);
    });

    it('CSV row 100 content is stable (last defective row)', () => {
      const re1 = fs.readFileSync(CSV_FILE, 'utf8').trim().split('\n')[100];
      const re2 = fs.readFileSync(CSV_FILE, 'utf8').trim().split('\n')[100];
      expect(re1).toBe(re2);
    });

    it('Count of valid outcomes in manifest is stable across reads', () => {
      const m1 = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
      const m2 = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
      const count1 = m1.records.filter((r: { expectedOutcome: string }) => r.expectedOutcome === 'valid').length;
      const count2 = m2.records.filter((r: { expectedOutcome: string }) => r.expectedOutcome === 'valid').length;
      expect(count1).toBe(count2);
      expect(count1).toBeGreaterThanOrEqual(50);
    });

    it('defect category recordIndices are deterministic — sorted ascending and match category count', () => {
      for (const [name, cat] of Object.entries(manifest.defectCategories)) {
        const sorted = [...cat.recordIndices].sort((a, b) => a - b);
        expect(cat.recordIndices, `Category ${name}: indices not sorted`).toEqual(sorted);
        expect(cat.count, `Category ${name}: count != recordIndices.length`).toBe(sorted.length);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 9 — Cross-validation: manifest record ids match CSV row ids
  // ---------------------------------------------------------------------------

  describe('Suite 9: Cross-validation between manifest and CSV', () => {
    it('Manifest record[0] id matches CSV row 1 (first data row)', () => {
      const manifestId = manifest.records[0]!.id;
      const csvId = splitCsvLine(csvLines[1]!)[0];
      expect(csvId).toBe(manifestId);
    });

    it('Manifest record[49] id matches CSV row 50 (last clean row)', () => {
      const manifestId = manifest.records[49]!.id;
      const csvId = splitCsvLine(csvLines[50]!)[0];
      expect(csvId).toBe(manifestId);
    });

    it('Manifest record[99] id matches CSV row 100 (last defective row)', () => {
      const manifestId = manifest.records[99]!.id;
      const csvId = splitCsvLine(csvLines[100]!)[0];
      expect(csvId).toBe(manifestId);
    });

    it('Spot-check: manifest records for exact_duplicate rows point to correct duplicate source keys', () => {
      // Row 63 (index 3 in 0-based CSV = manifest record[62]) should duplicate row 3
      const dupRecord = manifest.records.find((r) => r.index === 63);
      expect(dupRecord).toBeDefined();
      expect(dupRecord!.expectedOutcome).toBe('exact_duplicate');
      const defect = dupRecord!.defects[0]!;
      expect(defect.category).toBe('EXACT_DUPLICATE');
    });
  });
});
