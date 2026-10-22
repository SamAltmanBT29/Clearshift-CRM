import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CrmModuleSchema,
  MigrationStepSchema,
  MigrationRunStatusSchema,
} from '@clearshift/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_FILE = path.join(__dirname, 'dirty-pack-100.csv');
const MANIFEST_FILE = path.join(__dirname, 'manifest.json');

describe('CRM-5 Canonical Dirty Data Pack (#198, [CRM5-25])', () => {
  it('should find dirty-pack-100.csv and manifest.json in fixtures directory', () => {
    expect(fs.existsSync(CSV_FILE)).toBe(true);
    expect(fs.existsSync(MANIFEST_FILE)).toBe(true);
  });

  describe('Acceptance Criterion 1: Structure and Synthetic Records (>= 100 rows, 0 PII)', () => {
    const rawCsv = fs.readFileSync(CSV_FILE, 'utf8').trim();
    const lines = rawCsv.split('\n');

    it('should have exactly 1 header line and 100 data rows', () => {
      expect(lines.length).toBe(101); // 1 header + 100 data rows
    });

    it('should have canonical CSV headers', () => {
      const headerLine = lines[0];
      const headers = headerLine.split(',');
      expect(headers).toEqual([
        'id',
        'batch_id',
        'module',
        'step',
        'status',
        'records_in',
        'records_out',
        'records_rejected',
        'started_at',
        'completed_at',
        'metadata',
      ]);
    });

    it('should contain purely synthetic data with zero real personal data', () => {
      // Ensure no common personal email addresses, phone numbers, or passwords exist
      expect(rawCsv).not.toMatch(/@(gmail|yahoo|hotmail|outlook)\.com/i);
      expect(rawCsv).not.toMatch(/password/i);
      expect(rawCsv).not.toMatch(/ssn|social_security/i);
    });
  });

  describe('Acceptance Criterion 2 & 3: Manifest Documented Outcomes & Edge Cases', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));

    it('manifest should cover all required outcomes per Issue #198 specification', () => {
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
      for (const req of requiredOutcomes) {
        expect(recordOutcomes.has(req), `Outcome "${req}" should be present in record catalog`).toBe(true);
      }
    });

    it('manifest should cover all required edge cases per Issue #198 specification', () => {
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

    it('should enforce strictly disjoint defect categories with zero index overlap', () => {
      const categories = manifest.defectCategories;
      const seenIndices = new Set<number>();
      let totalDefectCount = 0;

      for (const [categoryName, catData] of Object.entries(categories) as [
        string,
        { count: number; recordIndices: number[] }
      ][]) {
        expect(catData.count).toBe(catData.recordIndices.length);
        totalDefectCount += catData.count;

        for (const idx of catData.recordIndices) {
          expect(
            seenIndices.has(idx),
            `Record index ${idx} in category ${categoryName} overlaps with another defect category`
          ).toBe(false);
          seenIndices.add(idx);
          expect(idx).toBeGreaterThanOrEqual(51);
          expect(idx).toBeLessThanOrEqual(100);
        }
      }

      expect(totalDefectCount).toBe(50);
      expect(seenIndices.size).toBe(50);
    });

    it('should catalog records 1..50 as VALID with 0 defects', () => {
      for (let i = 1; i <= 50; i++) {
        const record = manifest.records.find((r: { index: number }) => r.index === i);
        expect(record).toBeDefined();
        expect(record.status).toBe('VALID');
        expect(record.expectedOutcome).toBe('valid');
        expect(record.defects).toEqual([]);
      }
    });

    it('should catalog records 51..100 as DEFECTIVE with expected outcome classifications', () => {
      for (let i = 51; i <= 100; i++) {
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

  describe('Validation of Clean Records & Valid Edge Cases (Rows 1-50)', () => {
    const rawCsv = fs.readFileSync(CSV_FILE, 'utf8').trim();
    const lines = rawCsv.split('\n');

    it('standard clean rows (1-45) must conform to domain contracts and invariants', () => {
      for (let i = 1; i <= 45; i++) {
        const line = lines[i];
        const parts = line.split(',');
        const [
          id,
          batchId,
          module,
          step,
          status,
          recordsInStr,
          recordsOutStr,
          recordsRejectedStr,
          startedAtStr,
        ] = parts;

        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(batchId.length).toBeGreaterThan(0);
        expect(CrmModuleSchema.safeParse(module).success).toBe(true);
        expect(MigrationStepSchema.safeParse(step).success).toBe(true);
        expect(MigrationRunStatusSchema.safeParse(status).success).toBe(true);

        const recIn = Number(recordsInStr);
        const recOut = Number(recordsOutStr);
        const recRej = Number(recordsRejectedStr);
        expect(recIn).toBeGreaterThanOrEqual(0);
        expect(recOut).toBeGreaterThanOrEqual(0);
        expect(recRej).toBeGreaterThanOrEqual(0);
        expect(recOut + recRej).toBeLessThanOrEqual(recIn);

        const started = new Date(startedAtStr);
        expect(Number.isNaN(started.getTime())).toBe(false);
      }
    });

    it('Row 46 should handle valid multi-byte UTF-8 characters', () => {
      const line = lines[46];
      expect(line).toContain('ünîcødé');
      expect(line).toContain('Café, Zürich, 🚀, 日本語, résumé');
    });

    it('Row 47 should handle valid zero input boundary count', () => {
      const line = lines[47];
      const parts = line.split(',');
      expect(Number(parts[5])).toBe(0);
      expect(Number(parts[6])).toBe(0);
      expect(Number(parts[7])).toBe(0);
    });

    it('Row 48 should handle valid large volume scale numbers (10M records)', () => {
      const line = lines[48];
      const parts = line.split(',');
      expect(Number(parts[5])).toBe(10000000);
      expect(Number(parts[6])).toBe(9999900);
    });

    it('Row 49 should handle valid maximum signed 32-bit integer bound (2,147,483,647)', () => {
      const line = lines[49];
      const parts = line.split(',');
      expect(Number(parts[5])).toBe(2147483647);
    });

    it('Row 50 should handle valid empty metadata', () => {
      const line = lines[50];
      const parts = line.split(',');
      expect(parts[10]).toBe('');
    });
  });

  describe('Validation of Defective Records (Rows 51-100)', () => {
    const rawCsv = fs.readFileSync(CSV_FILE, 'utf8').trim();
    const lines = rawCsv.split('\n');

    it('Rows 51-57: NULL_REQUIRED (missing mandatory fields)', () => {
      for (let i = 51; i <= 57; i++) {
        const line = lines[i];
        const [, batchId, module, step] = line.split(',');
        const hasMissing = !batchId || !module || !step;
        expect(hasMissing).toBe(true);
      }
    });

    it('Rows 58-62: EXACT_DUPLICATE (duplicate primary and natural keys)', () => {
      // Row 58 duplicates Row 1's id
      const row1Id = lines[1].split(',')[0];
      const row58Id = lines[58].split(',')[0];
      expect(row58Id).toBe(row1Id);

      // Row 59 duplicates Row 2's id
      const row2Id = lines[2].split(',')[0];
      const row59Id = lines[59].split(',')[0];
      expect(row59Id).toBe(row2Id);

      // Row 61 duplicates natural key of Row 4 (batch_id, step)
      const row4Parts = lines[4].split(',');
      const row61Parts = lines[61].split(',');
      expect(row61Parts[1]).toBe(row4Parts[1]); // batch_id
      expect(row61Parts[3]).toBe(row4Parts[3]); // step
    });

    it('Rows 63-67: FOREIGN_KEY_MISSING (unresolvable batch IDs or unregistered modules)', () => {
      const row63Batch = lines[63].split(',')[1];
      expect(row63Batch).toContain('missing-fk');

      const row65Module = lines[65].split(',')[2];
      expect(CrmModuleSchema.safeParse(row65Module).success).toBe(false);

      const row66Module = lines[66].split(',')[2];
      expect(row66Module).toBe('salesforce');
    });

    it('Rows 68-72: WHITESPACE_PADDING (unstripped leading, trailing, or tab spaces)', () => {
      const row68Module = lines[68].split(',')[2];
      expect(row68Module.startsWith(' ') && row68Module.endsWith(' ')).toBe(true);

      const row69Batch = lines[69].split(',')[1];
      expect(row69Batch.endsWith('   ')).toBe(true);

      const row71Batch = lines[71].split(',')[1];
      expect(row71Batch).toContain('\t');
    });

    it('Rows 73-78: DATE_FORMAT_VARIANTS (non-ISO, localized, or epoch timestamps)', () => {
      // Row 73: localized DD/MM/YYYY
      expect(lines[73].split(',')[8]).toContain('19/10/2026');

      // Row 74: date only (missing time)
      expect(lines[74].split(',')[8]).toBe('2026-10-19');

      // Row 75: epoch milliseconds
      expect(lines[75].split(',')[8]).toBe('1760889600000');

      // Row 76: invalid month 99
      expect(lines[76].split(',')[8]).toContain('2026-99-99');
    });

    it('Rows 79-83: BOUNDARY_NUMBERS (negative counts and 32-bit int overflow)', () => {
      // Row 79: records_in = -1
      expect(Number(lines[79].split(',')[5])).toBe(-1);

      // Row 80: records_out = -5
      expect(Number(lines[80].split(',')[6])).toBe(-5);

      // Row 82: records_in = 2,147,483,648 (overflows signed 32-bit int 2147483647)
      expect(Number(lines[82].split(',')[5])).toBe(2147483648);
    });

    it('Rows 84-87: MALFORMED_UUID (invalid UUID formats)', () => {
      for (let i = 84; i <= 87; i++) {
        const id = lines[i].split(',')[0];
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        expect(uuidRegex.test(id)).toBe(false);
      }
    });

    it('Rows 88-91: LOGICAL_COUNT_INVARIANT_VIOLATION (out + rejected > in)', () => {
      for (let i = 88; i <= 91; i++) {
        const parts = lines[i].split(',');
        const recIn = Number(parts[5]);
        const recOut = Number(parts[6]);
        const recRej = Number(parts[7]);
        expect(recOut + recRej).toBeGreaterThan(recIn);
      }
    });

    it('Rows 92-94: CHRONOLOGICAL_SEQUENCE_VIOLATION (completed_at < started_at)', () => {
      for (let i = 92; i <= 94; i++) {
        const parts = lines[i].split(',');
        const start = new Date(parts[8]).getTime();
        const end = new Date(parts[9]).getTime();
        expect(end).toBeLessThan(start);
      }
    });

    it('Rows 95-97: MALFORMED_JSON_METADATA (invalid JSON syntax in metadata)', () => {
      for (let i = 95; i <= 97; i++) {
        const line = lines[i];
        const commaIndices = [];
        for (let c = 0; c < line.length; c++) {
          if (line[c] === ',') commaIndices.push(c);
          if (commaIndices.length === 10) break;
        }
        const metaStr = line.slice(commaIndices[9] + 1);
        let parsesAsValidJson = false;
        try {
          JSON.parse(metaStr.replace(/^"|"$/g, '').replace(/""/g, '"'));
          parsesAsValidJson = true;
        } catch {
          parsesAsValidJson = false;
        }
        expect(parsesAsValidJson).toBe(false);
      }
    });

    it('Rows 98-100: FORMULA_INJECTION_RISK (dangerous spreadsheet prefixes =, @, +)', () => {
      for (let i = 98; i <= 100; i++) {
        const batchId = lines[i].split(',')[1];
        const hasFormulaPrefix = ['=', '@', '+'].some((p) => batchId.startsWith(p));
        expect(hasFormulaPrefix).toBe(true);
      }
    });
  });
});
