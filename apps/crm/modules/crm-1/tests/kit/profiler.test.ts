import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  profileCrm1Batch,
  toPlatformProfileReport,
  PROFILE_COLUMNS,
  DEFECT_CATEGORIES,
  TARGET_TABLES,
  INFERRED_COLUMN_TYPES,
  type RawContactRow,
} from '../../src/kit/profiler.js';
import {
  ProfileReportSchema,
  calculateQualityScore,
} from '@clearshift/contracts';
import { assertConservationEquation } from '../../src/domain/qa-specs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_FILE = path.join(__dirname, '../fixtures/dirty-pack-100.csv');
const MANIFEST_FILE = path.join(__dirname, '../fixtures/manifest.json');
const EXPECTED_PROFILE_FILE = path.resolve(
  __dirname,
  '../../../../../../sample-data/crm-1/expected-profile.json'
);

/**
 * Parses RFC-4180 CSV text into typed row objects preserving quoted content
 */
function parseCsv(csvText: string): RawContactRow[] {
  const lines = csvText.trim().split('\n');
  const headers = lines[0]!.split(',');
  const rows: RawContactRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const commaIndices: number[] = [];
    let inQuotes = false;
    for (let c = 0; c < line.length; c++) {
      if (line[c] === '"') inQuotes = !inQuotes;
      if (line[c] === ',' && !inQuotes) commaIndices.push(c);
      if (commaIndices.length === headers.length - 1) break;
    }

    const rowObj: RawContactRow = {};
    let lastIdx = 0;
    for (let h = 0; h < headers.length; h++) {
      const nextIdx = h < commaIndices.length ? commaIndices[h]! : line.length;
      let cell = line.substring(lastIdx, nextIdx);
      if (cell.startsWith('"') && cell.endsWith('"')) {
        cell = cell.slice(1, -1).replace(/""/g, '"');
      }
      rowObj[headers[h]!] = cell;
      lastIdx = nextIdx + 1;
    }
    rows.push(rowObj);
  }
  return rows;
}

describe('CRM-1 Profiling Configuration & Manifest Assertions (#119 / [CRM1-26])', () => {
  const csvContent = fs.readFileSync(CSV_FILE, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  const expectedProfile = JSON.parse(fs.readFileSync(EXPECTED_PROFILE_FILE, 'utf8'));
  const rows = parseCsv(csvContent);

  // -------------------------------------------------------------------------
  // Acceptance Criterion 1: Total Rows, Null Counts, Distinct Values & Rates
  // -------------------------------------------------------------------------
  describe('Acceptance Criterion 1: Total Rows, Null Counts, Distinct Values & Invalid Rates', () => {
    it('profiler accurately computes total rows and module target table metadata', () => {
      const report = profileCrm1Batch(rows);

      expect(report.totalRows).toBe(100);
      expect(report.module).toBe('crm-1');
      expect(report.targetTable).toBe('crm1_contacts');
      expect(report.targetTables).toEqual(TARGET_TABLES);
    });

    it('computes complete profiling statistics for all 15 module columns', () => {
      const report = profileCrm1Batch(rows);

      expect(PROFILE_COLUMNS).toHaveLength(15);
      for (const col of PROFILE_COLUMNS) {
        const stat = report.columnStats[col];
        expect(stat, `Column stats for ${col} must be defined`).toBeDefined();
        expect(stat!.columnName).toBe(col);
        expect(stat!.totalValues).toBe(100);
        expect(stat!.nullCount).toBeGreaterThanOrEqual(0);
        expect(stat!.nullRate).toBeGreaterThanOrEqual(0);
        expect(stat!.nullRate).toBeLessThanOrEqual(1);
        expect(stat!.distinctCount).toBeGreaterThanOrEqual(0);
        expect(stat!.invalidFormatCount).toBeGreaterThanOrEqual(0);
        expect(stat!.invalidFormatRate).toBeGreaterThanOrEqual(0);
        expect(stat!.invalidFormatRate).toBeLessThanOrEqual(1);
        expect(stat!.inferredType).toBe(INFERRED_COLUMN_TYPES[col]);
      }
    });

    it('accurately computes null counts matching expected-profile.json', () => {
      const report = profileCrm1Batch(rows);

      // first_name and last_name have exactly 2 empty values each (rows 83-86)
      expect(report.columnStats.first_name!.nullCount).toBe(2);
      expect(report.columnStats.last_name!.nullCount).toBe(2);

      // All other required columns have 0 nulls in the 100-row pack
      expect(report.columnStats.id!.nullCount).toBe(0);
      expect(report.columnStats.email!.nullCount).toBe(0);
      expect(report.columnStats.phone!.nullCount).toBe(0);
      expect(report.columnStats.address!.nullCount).toBe(0);
      expect(report.columnStats.company_id!.nullCount).toBe(0);
      expect(report.columnStats.company_name!.nullCount).toBe(0);
      expect(report.columnStats.lead_status!.nullCount).toBe(0);
      expect(report.columnStats.source_system!.nullCount).toBe(0);
      expect(report.columnStats.source_id!.nullCount).toBe(0);
      expect(report.columnStats.consent_status!.nullCount).toBe(0);
      expect(report.columnStats.unsubscribed!.nullCount).toBe(0);
      expect(report.columnStats.annual_revenue!.nullCount).toBe(0);
      expect(report.columnStats.created_at!.nullCount).toBe(0);
    });

    it('accurately computes invalid format counts matching expected-profile.json', () => {
      const report = profileCrm1Batch(rows);

      // email: 4 malformed RFC-5322 rows (87-90)
      expect(report.columnStats.email!.invalidFormatCount).toBe(4);
      expect(report.columnStats.email!.invalidFormatRate).toBe(0.04);

      // phone: 2 malformed phone rows (91-92)
      expect(report.columnStats.phone!.invalidFormatCount).toBe(2);
      expect(report.columnStats.phone!.invalidFormatRate).toBe(0.02);

      // lead_status: 2 invalid enum values (93-94)
      expect(report.columnStats.lead_status!.invalidFormatCount).toBe(2);
      expect(report.columnStats.lead_status!.invalidFormatRate).toBe(0.02);

      // company_id: 2 orphan foreign key UUIDs (95-96)
      expect(report.columnStats.company_id!.invalidFormatCount).toBe(2);
      expect(report.columnStats.company_id!.invalidFormatRate).toBe(0.02);

      // first_name: 2 invalid formats (row 97 formula injection, row 100 length > 255)
      expect(report.columnStats.first_name!.invalidFormatCount).toBe(2);
      expect(report.columnStats.first_name!.invalidFormatRate).toBe(0.02);

      // last_name: 1 invalid format (row 98 formula injection)
      expect(report.columnStats.last_name!.invalidFormatCount).toBe(1);
      expect(report.columnStats.last_name!.invalidFormatRate).toBe(0.01);

      // annual_revenue: 1 boundary number violation (row 99 negative value)
      expect(report.columnStats.annual_revenue!.invalidFormatCount).toBe(1);
      expect(report.columnStats.annual_revenue!.invalidFormatRate).toBe(0.01);

      // id, address, company_name, source_system, source_id, consent_status, unsubscribed, created_at have 0 format errors
      expect(report.columnStats.id!.invalidFormatCount).toBe(0);
      expect(report.columnStats.address!.invalidFormatCount).toBe(0);
      expect(report.columnStats.company_name!.invalidFormatCount).toBe(0);
      expect(report.columnStats.source_system!.invalidFormatCount).toBe(0);
      expect(report.columnStats.source_id!.invalidFormatCount).toBe(0);
      expect(report.columnStats.consent_status!.invalidFormatCount).toBe(0);
      expect(report.columnStats.unsubscribed!.invalidFormatCount).toBe(0);
      expect(report.columnStats.created_at!.invalidFormatCount).toBe(0);
    });

    it('accurately identifies distinct values in categorical and identifier columns', () => {
      const report = profileCrm1Batch(rows);

      // Primary keys: 100 unique UUIDs
      expect(report.columnStats.id!.distinctCount).toBe(100);

      // Categorical lead statuses (New, Working, Qualified, Closed + 2 invalid = 6 distinct)
      expect(report.columnStats.lead_status!.distinctCount).toBeGreaterThanOrEqual(4);

      // Consent statuses (unknown, granted, withdrawn)
      expect(report.columnStats.consent_status!.distinctCount).toBeGreaterThanOrEqual(2);

      // Unsubscribed boolean (true, false)
      expect(report.columnStats.unsubscribed!.distinctCount).toBe(1); // all false in dirty pack
    });

    it('matches column empty and invalid counts in committed expected-profile.json', () => {
      const report = profileCrm1Batch(rows);
      const cols = expectedProfile.columns;

      for (const colName of PROFILE_COLUMNS) {
        if (cols[colName]) {
          expect(report.columnStats[colName]!.nullCount).toBe(cols[colName].emptyCount);
          expect(report.columnStats[colName]!.invalidFormatCount).toBe(cols[colName].invalidCount);
          expect(report.columnStats[colName]!.inferredType).toBe(cols[colName].inferredType);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criterion 2: Exact Duplicate Candidate Count Matches Manifest
  // -------------------------------------------------------------------------
  describe('Acceptance Criterion 2: Exact Duplicate Candidate Count Matches Manifest', () => {
    it('exact duplicate candidate count matches manifest expectation (8 duplicate rows)', () => {
      const report = profileCrm1Batch(rows);

      const expectedDuplicateCount = manifest.defectCategories.EXACT_DUPLICATE.count;
      expect(report.exactDuplicateCount).toBe(expectedDuplicateCount);
      expect(report.exactDuplicateCount).toBe(8);
    });

    it('identifies exact record indices for duplicate candidate rows (rows 75 to 82)', () => {
      const report = profileCrm1Batch(rows);

      const expectedIndices = manifest.defectCategories.EXACT_DUPLICATE.recordIndices;
      expect(report.defectsByCategory.EXACT_DUPLICATE!.recordIndices).toEqual(expectedIndices);
      expect(report.defectsByCategory.EXACT_DUPLICATE!.recordIndices).toEqual([
        75, 76, 77, 78, 79, 80, 81, 82,
      ]);
    });

    it('detects duplicate pairs by normalized exact email key', () => {
      // Row 75 & 76: Sophia Chen (sophia.chen@alpha-tech.example)
      const r75 = rows[74]!;
      const r76 = rows[75]!;
      expect(r75.email!.toString().trim().toLowerCase()).toBe(
        r76.email!.toString().trim().toLowerCase()
      );

      // Row 77 & 78: Marcus Vance (marcus.vance@synthetic-corp.example)
      const r77 = rows[76]!;
      const r78 = rows[77]!;
      expect(r77.email!.toString().trim().toLowerCase()).toBe(
        r78.email!.toString().trim().toLowerCase()
      );
    });

    it('detects duplicate pairs by normalized compound phone + name key', () => {
      // Row 79 & 80: David Kim (+1-555-012-7744 vs +1 (555) 012-7744)
      const r79 = rows[78]!;
      const r80 = rows[79]!;
      const p79 = r79.phone!.toString().replace(/\D/g, '');
      const p80 = r80.phone!.toString().replace(/\D/g, '');
      expect(p79).toBe(p80);
      expect(r79.first_name).toBe(r80.first_name);
      expect(r79.last_name).toBe(r80.last_name);

      // Row 81 & 82: Elena Rostova (+1-555-019-2834 vs +1 555.019.2834)
      const r81 = rows[80]!;
      const r82 = rows[81]!;
      const p81 = r81.phone!.toString().replace(/\D/g, '');
      const p82 = r82.phone!.toString().replace(/\D/g, '');
      expect(p81).toBe(p82);
      expect(r81.first_name).toBe(r82.first_name);
      expect(r81.last_name).toBe(r82.last_name);
    });

    it('uses deterministic exact matching and forbids fuzzy auto-merging', () => {
      const report = profileCrm1Batch(rows);

      // Exactly 4 duplicate candidate groups (8 rows)
      expect(report.exactDuplicateCount).toBe(8);
      expect(report.qualityMetrics.duplicateRate).toBe(0.08);
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criterion 3: Non-Destructive Profiling Operation
  // -------------------------------------------------------------------------
  describe('Acceptance Criterion 3: Non-Destructive Profiling Operation', () => {
    it('profiling operation is strictly read-only and does not mutate source rows array or objects', () => {
      // Deep freeze all input rows before passing to profiler
      const frozenRows = rows.map((r) => Object.freeze({ ...r }));
      Object.freeze(frozenRows);

      // Must execute cleanly without throwing mutation/freeze errors
      expect(() => profileCrm1Batch(frozenRows)).not.toThrow();

      const report = profileCrm1Batch(frozenRows);
      expect(report.totalRows).toBe(100);
    });

    it('preserves exact cell values before and after profiling pass', () => {
      const snapshotBefore = JSON.stringify(rows);
      profileCrm1Batch(rows);
      const snapshotAfter = JSON.stringify(rows);

      expect(snapshotAfter).toBe(snapshotBefore);
    });

    it('multiple sequential profiling passes leave source data unmodified and yield identical reports', () => {
      const report1 = profileCrm1Batch(rows);
      const report2 = profileCrm1Batch(rows);
      const report3 = profileCrm1Batch(rows);

      expect(report1.totalRows).toBe(report2.totalRows);
      expect(report1.validRowCount).toBe(report2.validRowCount);
      expect(report1.defectiveRowCount).toBe(report2.defectiveRowCount);
      expect(report1.exactDuplicateCount).toBe(report2.exactDuplicateCount);
      expect(report1.columnStats).toEqual(report2.columnStats);
      expect(report1.defectCountsByCategory).toEqual(report2.defectCountsByCategory);
      expect(report2.columnStats).toEqual(report3.columnStats);
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criterion 4: Automated Assertions Confirm Manifest Numbers
  // -------------------------------------------------------------------------
  describe('Acceptance Criterion 4: Automated Assertions Confirm Manifest Numbers', () => {
    it('accurately computes valid and defective row counts conforming to manifest', () => {
      const report = profileCrm1Batch(rows);

      expect(report.validRowCount).toBe(74);
      expect(report.defectiveRowCount).toBe(26);
      expect(report.validRowCount).toBe(manifest.summary.cleanRecordsCount);
      expect(report.defectiveRowCount).toBe(manifest.summary.defectiveRecordsCount);
      expect(report.validRowCount + report.defectiveRowCount).toBe(100);
    });

    it('accurately accounts for loaded, merged, rejected, and skipped terminal outcomes', () => {
      const report = profileCrm1Batch(rows);

      expect(report.loadedCount).toBe(74);
      expect(report.mergedCount).toBe(8);
      expect(report.rejectedCount).toBe(18);
      expect(report.skippedCount).toBe(0);
      expect(report.unaccounted).toBe(0);

      expect(report.loadedCount).toBe(manifest.summary.loadedCount);
      expect(report.mergedCount).toBe(manifest.summary.mergedCount);
      expect(report.rejectedCount).toBe(manifest.summary.rejectedCount);
      expect(report.skippedCount).toBe(manifest.summary.skippedCount);
      expect(report.unaccounted).toBe(manifest.summary.unaccounted);
    });

    it('satisfies the mathematical row conservation invariant: source = loaded + rejected + merged + skipped', () => {
      const report = profileCrm1Batch(rows);

      const balance = assertConservationEquation(
        report.totalRows,
        report.loadedCount,
        report.rejectedCount,
        report.mergedCount,
        report.skippedCount
      );

      expect(balance.balanced).toBe(true);
      expect(balance.unaccounted).toBe(0);
      expect(report.loadedCount + report.mergedCount + report.rejectedCount + report.skippedCount).toBe(
        100
      );
    });

    it('matches exact counts and indices for all 7 defect categories in manifest', () => {
      const report = profileCrm1Batch(rows);
      const manifestDefects = manifest.defectCategories;

      for (const cat of DEFECT_CATEGORIES) {
        const expected = manifestDefects[cat];
        expect(expected, `Defect category ${cat} must exist in manifest`).toBeDefined();
        expect(report.defectCountsByCategory[cat]).toBe(expected.count);
        expect(report.defectsByCategory[cat]!.recordIndices).toEqual(expected.recordIndices);
      }
    });

    it('asserts disjoint classification: clean rows have zero defect flags', () => {
      const report = profileCrm1Batch(rows);

      const allDefectIndices = new Set<number>();
      for (const summary of Object.values(report.defectsByCategory)) {
        for (const idx of summary.recordIndices) {
          allDefectIndices.add(idx);
        }
      }

      // Exactly 26 unique row indices have defects
      expect(allDefectIndices.size).toBe(26);

      // Rows 1-74 are strictly clean (indices 1 to 74 are absent from defect indices)
      for (let i = 1; i <= 74; i++) {
        expect(allDefectIndices.has(i)).toBe(false);
      }

      // Rows 75-100 are defective (all present)
      for (let i = 75; i <= 100; i++) {
        expect(allDefectIndices.has(i)).toBe(true);
      }
    });

    it('computes quality metrics and overall quality score using shared contracts calculator', () => {
      const report = profileCrm1Batch(rows);
      const q = report.qualityMetrics;

      expect(q.completeness).toBe(0.96);
      expect(q.validity).toBe(0.74);
      expect(q.duplicateRate).toBe(0.08);
      expect(q.rejectRate).toBe(0.26);
      expect(q.linkIntegrity).toBe(0.98);

      const expectedScore = calculateQualityScore({
        completeness: q.completeness,
        validity: q.validity,
        duplicateRate: q.duplicateRate,
        rejectRate: q.rejectRate,
        linkIntegrity: q.linkIntegrity,
      });

      expect(q.overallScore).toBe(expectedScore);
      expect(q.overallScore).toBeGreaterThanOrEqual(80);
      expect(q.overallScore).toBeLessThanOrEqual(100);
    });

    it('converts to shared platform ProfileReport schema and passes Zod contract validation', () => {
      const report = profileCrm1Batch(rows);
      const platformReport = toPlatformProfileReport(report, '550e8400-e29b-41d4-a716-446655440099');

      // Must validate against shared ProfileReportSchema without throwing
      const parsed = ProfileReportSchema.parse(platformReport);
      expect(parsed.module).toBe('crm-1');
      expect(parsed.totalRows).toBe(100);
      expect(parsed.totalColumns).toBe(15);
      expect(parsed.columns).toHaveLength(15);
      expect(parsed.duplicates.totalDuplicates).toBe(8);
      expect(parsed.summary.duplicateCount).toBe(8);
      expect(parsed.summary.emptyCount).toBe(4);
      expect(parsed.summary.invalidCount).toBe(14);
    });
  });
});
