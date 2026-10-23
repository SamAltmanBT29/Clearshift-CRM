import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  profileCrm4Batch,
  PROFILE_COLUMNS,
  DEFECT_CATEGORIES,
  TARGET_TABLES,
  type RawMarketingRow,
} from '../../src/kit/profiler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_FILE = path.join(__dirname, '../fixtures/dirty-pack-100.csv');
const MANIFEST_FILE = path.join(__dirname, '../fixtures/manifest.json');

/**
 * Parses standard RFC-4180 CSV preserving quoted fields
 */
function parseCsv(csvText: string): RawMarketingRow[] {
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',');
  const rows: RawMarketingRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const commaIndices: number[] = [];
    let inQuotes = false;
    for (let c = 0; c < line.length; c++) {
      if (line[c] === '"') inQuotes = !inQuotes;
      if (line[c] === ',' && !inQuotes) commaIndices.push(c);
      if (commaIndices.length === headers.length - 1) break;
    }

    const rowObj: RawMarketingRow = {};
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

describe('CRM-4 Profiling Configuration & Manifest Assertions (#179 / [CRM4-26])', () => {
  const csvContent = fs.readFileSync(CSV_FILE, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  const rows = parseCsv(csvContent);

  // -------------------------------------------------------------------------
  // Acceptance Criterion 1: Total Rows, Null Counts, Distinct Values & Rates
  // -------------------------------------------------------------------------
  describe('Acceptance Criterion 1: Total Rows, Null Counts, Distinct Values & Invalid Rates', () => {
    it('profiler accurately computes total rows and target metadata', () => {
      const report = profileCrm4Batch(rows);

      expect(report.totalRows).toBe(100);
      expect(report.module).toBe('crm-4');
      expect(report.targetTables).toEqual(TARGET_TABLES);
    });

    it('computes complete profiling statistics for all 16 module columns', () => {
      const report = profileCrm4Batch(rows);

      expect(PROFILE_COLUMNS).toHaveLength(16);
      for (const col of PROFILE_COLUMNS) {
        const stat = report.columnStats[col];
        expect(stat, `Column stats for ${col} must be defined`).toBeDefined();
        expect(stat.columnName).toBe(col);
        expect(stat.totalValues).toBe(100);
        expect(stat.nullCount).toBeGreaterThanOrEqual(0);
        expect(stat.nullRate).toBeGreaterThanOrEqual(0);
        expect(stat.nullRate).toBeLessThanOrEqual(1);
        expect(stat.distinctCount).toBeGreaterThanOrEqual(0);
        expect(stat.invalidFormatCount).toBeGreaterThanOrEqual(0);
        expect(stat.invalidFormatRate).toBeGreaterThanOrEqual(0);
        expect(stat.invalidFormatRate).toBeLessThanOrEqual(1);
      }
    });

    it('accurately detects null counts in mandatory candidate fields', () => {
      const report = profileCrm4Batch(rows);

      // name, contact_id, campaign_id have null entries from rows 51-57
      expect(report.columnStats.name.nullCount).toBeGreaterThanOrEqual(2);
      expect(report.columnStats.contact_id.nullCount).toBeGreaterThanOrEqual(2);
      expect(report.columnStats.campaign_id.nullCount).toBeGreaterThanOrEqual(1);
    });

    it('accurately identifies distinct values in categorical and identifier columns', () => {
      const report = profileCrm4Batch(rows);

      // entity_type contains list, campaign, member, consent
      expect(report.columnStats.entity_type.distinctCount).toBe(4);
      // member_status contains sent, opened, clicked plus dirty variants
      expect(report.columnStats.member_status.distinctCount).toBeGreaterThanOrEqual(3);
      // consent_status contains subscribed, unsubscribed
      expect(report.columnStats.consent_status.distinctCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criterion 2: Exact Duplicate Candidate Count Matches Manifest
  // -------------------------------------------------------------------------
  describe('Acceptance Criterion 2: Exact Duplicate Candidate Count Matches Manifest', () => {
    it('exact duplicate candidate count matches manifest expectation exactly (6 records)', () => {
      const report = profileCrm4Batch(rows);

      const expectedCount = manifest.defectCategories.EXACT_DUPLICATE.count;
      expect(report.exactDuplicateCount).toBe(expectedCount);
      expect(report.exactDuplicateCount).toBe(6);
    });

    it('exact duplicate candidate record indices match manifest recordIndices exactly', () => {
      const report = profileCrm4Batch(rows);

      expect(report.defectsByCategory.EXACT_DUPLICATE.recordIndices).toEqual(
        manifest.defectCategories.EXACT_DUPLICATE.recordIndices
      );
      expect(report.defectsByCategory.EXACT_DUPLICATE.recordIndices).toEqual([58, 59, 60, 61, 62, 63]);
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criterion 3: Non-Destructive Execution (Source Data Untouched)
  // -------------------------------------------------------------------------
  describe('Acceptance Criterion 3: Non-Destructive Execution (Source Data Untouched)', () => {
    it('profiling operation is strictly read-only and does not mutate source rows array or objects', () => {
      const originalSnapshot = JSON.parse(JSON.stringify(rows));
      const report = profileCrm4Batch(rows);

      expect(report).toBeDefined();
      expect(rows).toEqual(originalSnapshot);
      expect(rows).toHaveLength(100);
    });

    it('multiple sequential profiling passes leave source data unmodified', () => {
      const snapshotBefore = JSON.parse(JSON.stringify(rows));
      profileCrm4Batch(rows);
      profileCrm4Batch(rows);
      profileCrm4Batch(rows);

      expect(rows).toEqual(snapshotBefore);
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criterion 4: Automated Assertions Confirm Manifest Pre-Calculations
  // -------------------------------------------------------------------------
  describe('Acceptance Criterion 4: Automated Assertions Confirm Profiler Matches Pre-Calculated Manifest Numbers', () => {
    it('total valid and defective counts match manifest pre-calculated numbers exactly (50 / 50 / 100)', () => {
      const report = profileCrm4Batch(rows);

      expect(report.validRowCount).toBe(manifest.summary.cleanRecordsCount); // 50
      expect(report.defectiveRowCount).toBe(manifest.summary.defectiveRecordsCount); // 50
      expect(report.validRowCount + report.defectiveRowCount).toBe(manifest.totalRecords); // 100
    });

    it('every pre-calculated defect category count matches the manifest identically', () => {
      const report = profileCrm4Batch(rows);

      for (const [categoryName, manifestCategory] of Object.entries(
        manifest.defectCategories
      ) as [string, { count: number; recordIndices: number[] }][]) {
        const detectedDefect = report.defectsByCategory[categoryName];
        expect(detectedDefect, `Category ${categoryName} must exist in profiler output`).toBeDefined();
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

    it('asserts foreign key missing defects match rows 64 to 69', () => {
      const report = profileCrm4Batch(rows);

      expect(report.defectsByCategory.FOREIGN_KEY_MISSING.count).toBe(6);
      expect(report.defectsByCategory.FOREIGN_KEY_MISSING.recordIndices).toEqual([64, 65, 66, 67, 68, 69]);
    });

    it('asserts invalid member status defects match rows 70 to 75', () => {
      const report = profileCrm4Batch(rows);

      expect(report.defectsByCategory.INVALID_MEMBER_STATUS.count).toBe(6);
      expect(report.defectsByCategory.INVALID_MEMBER_STATUS.recordIndices).toEqual([70, 71, 72, 73, 74, 75]);
    });

    it('asserts monotonic opt-out violations (BR-CRM4-01) match rows 76 to 80', () => {
      const report = profileCrm4Batch(rows);

      expect(report.defectsByCategory.MONOTONIC_OPT_OUT_VIOLATION.count).toBe(5);
      expect(report.defectsByCategory.MONOTONIC_OPT_OUT_VIOLATION.recordIndices).toEqual([76, 77, 78, 79, 80]);
    });

    it('asserts date format variants match rows 81 to 86', () => {
      const report = profileCrm4Batch(rows);

      expect(report.defectsByCategory.DATE_FORMAT_VARIANTS.count).toBe(6);
      expect(report.defectsByCategory.DATE_FORMAT_VARIANTS.recordIndices).toEqual([81, 82, 83, 84, 85, 86]);
    });

    it('asserts boundary number defects match rows 87 to 91', () => {
      const report = profileCrm4Batch(rows);

      expect(report.defectsByCategory.BOUNDARY_NUMBERS.count).toBe(5);
      expect(report.defectsByCategory.BOUNDARY_NUMBERS.recordIndices).toEqual([87, 88, 89, 90, 91]);
    });

    it('asserts whitespace padding defects match rows 92 to 96', () => {
      const report = profileCrm4Batch(rows);

      expect(report.defectsByCategory.WHITESPACE_PADDING.count).toBe(5);
      expect(report.defectsByCategory.WHITESPACE_PADDING.recordIndices).toEqual([92, 93, 94, 95, 96]);
    });

    it('asserts formula injection risks match rows 97 to 100', () => {
      const report = profileCrm4Batch(rows);

      expect(report.defectsByCategory.FORMULA_INJECTION_RISK.count).toBe(4);
      expect(report.defectsByCategory.FORMULA_INJECTION_RISK.recordIndices).toEqual([97, 98, 99, 100]);
    });

    it('quality metrics compute normalized 5-dimension scores correctly', () => {
      const report = profileCrm4Batch(rows);

      expect(report.qualityMetrics.completeness).toBe(0.93); // (100 - 7) / 100
      expect(report.qualityMetrics.validity).toBe(0.5);      // 50 / 100
      expect(report.qualityMetrics.duplicateRate).toBe(0.06); // 6 / 100
      expect(report.qualityMetrics.rejectRate).toBe(0.5);    // 50 / 100
      expect(report.qualityMetrics.linkIntegrity).toBe(0.94); // (100 - 6) / 100
      expect(report.qualityMetrics.overallScore).toBeGreaterThan(0);
      expect(report.qualityMetrics.overallScore).toBeLessThanOrEqual(100);
    });

    it('overallScore adheres strictly to standard quality score formula contract', () => {
      const { qualityMetrics: q } = profileCrm4Batch(rows);
      const expected =
        Math.round(
          (100 *
            (q.completeness +
              q.validity +
              (1 - q.duplicateRate) +
              (1 - q.rejectRate) +
              q.linkIntegrity)) /
            5 *
            100
        ) / 100;
      expect(q.overallScore).toBe(expected);
    });
  });

  // -------------------------------------------------------------------------
  // Determinism & Edge Cases
  // -------------------------------------------------------------------------
  describe('Determinism & Edge Cases', () => {
    it('produces identical report across repeated profiling passes', () => {
      const pass1 = profileCrm4Batch(rows);
      const pass2 = profileCrm4Batch(rows);

      expect(JSON.stringify(pass1)).toBe(JSON.stringify(pass2));
    });

    it('handles empty row batch safely without throwing', () => {
      const emptyReport = profileCrm4Batch([]);

      expect(emptyReport.totalRows).toBe(0);
      expect(emptyReport.validRowCount).toBe(0);
      expect(emptyReport.defectiveRowCount).toBe(0);
      expect(emptyReport.exactDuplicateCount).toBe(0);
      expect(emptyReport.qualityMetrics.overallScore).toBeNull();
      for (const col of PROFILE_COLUMNS) {
        expect(emptyReport.columnStats[col].totalValues).toBe(0);
        expect(emptyReport.columnStats[col].nullRate).toBe(0);
      }
    });
  });
});
