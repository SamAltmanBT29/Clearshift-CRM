import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { profileCrm5Batch, type RawRunRow } from '../../src/kit/profiler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_FILE = path.join(__dirname, '../fixtures/dirty-pack-100.csv');
const MANIFEST_FILE = path.join(__dirname, '../fixtures/manifest.json');

function parseCsv(csvText: string): RawRunRow[] {
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',');
  const rows: RawRunRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Simple split preserving quotes for metadata
    const commaIndices: number[] = [];
    let inQuotes = false;
    for (let c = 0; c < line.length; c++) {
      if (line[c] === '"') inQuotes = !inQuotes;
      if (line[c] === ',' && !inQuotes) commaIndices.push(c);
      if (commaIndices.length === headers.length - 1) break;
    }

    const rowObj: RawRunRow = {};
    let lastIdx = 0;
    for (let h = 0; h < headers.length; h++) {
      const nextIdx = h < commaIndices.length ? commaIndices[h] : line.length;
      let cell = line.substring(lastIdx, nextIdx);
      if (cell.startsWith('"') && cell.endsWith('"')) {
        cell = cell.slice(1, -1).replace(/""/g, '"');
      }
      rowObj[headers[h]] = cell;
      lastIdx = nextIdx + 1;
    }
    rows.push(rowObj);
  }
  return rows;
}

describe('CRM-5 Profiling Configuration & Manifest Assertions (#199, [CRM5-26])', () => {
  const csvContent = fs.readFileSync(CSV_FILE, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  const rows = parseCsv(csvContent);

  describe('Acceptance Criterion 1: Total Rows, Null Counts, Distinct Values & Invalid Rates', () => {
    it('profiler accurately computes total rows and column statistics', () => {
      const report = profileCrm5Batch(rows);

      expect(report.totalRows).toBe(100);
      expect(report.module).toBe('crm-5');
      expect(report.targetTable).toBe('crm5_runs');

      // Check column stats existence
      const cols = [
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
      ];
      for (const col of cols) {
        const stat = report.columnStats[col];
        expect(stat).toBeDefined();
        expect(stat.totalValues).toBe(100);
        expect(stat.nullCount).toBeGreaterThanOrEqual(0);
        expect(stat.nullRate).toBeGreaterThanOrEqual(0);
        expect(stat.distinctCount).toBeGreaterThan(0);
        expect(stat.invalidFormatRate).toBeGreaterThanOrEqual(0);
      }
    });

    it('identifies null counts in mandatory fields', () => {
      const report = profileCrm5Batch(rows);

      // batch_id, module, step have known null rows from NULL_REQUIRED (rows 51-57)
      expect(report.columnStats.batch_id.nullCount).toBeGreaterThanOrEqual(1);
      expect(report.columnStats.module.nullCount).toBeGreaterThanOrEqual(1);
      expect(report.columnStats.step.nullCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Acceptance Criterion 2: Exact Duplicate Candidate Count Matches Manifest', () => {
    it('exact duplicate candidate count matches manifest expectation', () => {
      const report = profileCrm5Batch(rows);

      const expectedDuplicateCount = manifest.defectCategories.EXACT_DUPLICATE.count;
      expect(report.exactDuplicateCount).toBe(expectedDuplicateCount);
      expect(report.exactDuplicateCount).toBe(5);

      // Indices must match manifest recordIndices
      expect(report.defectsByCategory.EXACT_DUPLICATE.recordIndices).toEqual(
        manifest.defectCategories.EXACT_DUPLICATE.recordIndices
      );
    });
  });

  describe('Acceptance Criterion 3: Non-Destructive Execution (Source Data Untouched)', () => {
    it('profiling operation is strictly non-destructive and preserves original rows and references', () => {
      const originalCopy = JSON.parse(JSON.stringify(rows));
      const report = profileCrm5Batch(rows);

      expect(report).toBeDefined();
      // Ensure rows are 100% identical before and after profiling
      expect(rows).toEqual(originalCopy);
    });
  });

  describe('Acceptance Criterion 4: Automated Assertions Confirm Profiler Matches Pre-Calculated Manifest Numbers', () => {
    it('total valid and defective counts match manifest pre-calculated numbers', () => {
      const report = profileCrm5Batch(rows);

      expect(report.validRowCount).toBe(manifest.summary.cleanRecordsCount); // 50
      expect(report.defectiveRowCount).toBe(manifest.summary.defectiveRecordsCount); // 50
      expect(report.validRowCount + report.defectiveRowCount).toBe(manifest.totalRecords); // 100
    });

    it('each pre-calculated defect category count matches the manifest identically', () => {
      const report = profileCrm5Batch(rows);

      for (const [categoryName, manifestCategory] of Object.entries(
        manifest.defectCategories
      ) as [string, { count: number; recordIndices: number[] }][]) {
        const detectedDefect = report.defectsByCategory[categoryName];
        expect(detectedDefect, `Category ${categoryName} should be present in profile report`).toBeDefined();
        expect(
          detectedDefect.count,
          `Detected count for ${categoryName} must match manifest expectation`
        ).toBe(manifestCategory.count);
        expect(
          detectedDefect.recordIndices,
          `Record indices for ${categoryName} must match manifest expectation`
        ).toEqual(manifestCategory.recordIndices);
      }
    });

    it('quality metrics compute normalized 5-dimension scores correctly', () => {
      const report = profileCrm5Batch(rows);

      expect(report.qualityMetrics.completeness).toBeGreaterThan(0);
      expect(report.qualityMetrics.completeness).toBeLessThanOrEqual(1);

      expect(report.qualityMetrics.validity).toBe(0.5); // 50 / 100
      expect(report.qualityMetrics.duplicateRate).toBe(0.05); // 5 / 100
      expect(report.qualityMetrics.rejectRate).toBe(0.5); // 50 / 100
      expect(report.qualityMetrics.overallScore).toBeGreaterThan(0);
      expect(report.qualityMetrics.overallScore).toBeLessThanOrEqual(100);
    });
  });

  describe('Determinism, score contract and empty input', () => {
    it('same fixture yields identical reports across runs', () => {
      const a = profileCrm5Batch(rows);
      const b = profileCrm5Batch(rows);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('overallScore follows the exact contract formula', () => {
      const { qualityMetrics: q } = profileCrm5Batch(rows);
      const expected =
        Math.round(
          100 * (q.completeness + q.validity + (1 - q.duplicateRate) + (1 - q.rejectRate) + q.linkIntegrity) / 5 * 100
        ) / 100;
      expect(q.overallScore).toBe(expected);
    });

    it('reports invalid format counts and rates per column', () => {
      const report = profileCrm5Batch(rows);
      expect(report.columnStats.id.invalidFormatCount).toBe(4);
      expect(report.columnStats.id.invalidFormatRate).toBe(0.04);
      expect(report.columnStats.metadata.invalidFormatCount).toBe(3);
    });

    it('empty batch yields zero rows and N/A score', () => {
      const report = profileCrm5Batch([]);
      expect(report.totalRows).toBe(0);
      expect(report.qualityMetrics.overallScore).toBe(null);
    });
  });
});
