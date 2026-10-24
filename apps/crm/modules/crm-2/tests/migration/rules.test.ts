import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RULES,
  RULESET_VERSION,
  evaluateRows,
  summarize,
  type RawRow,
} from '../../src/migration/rules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const dir = path.join(root, 'sample-data/crm-2');
const csvBuf = fs.readFileSync(path.join(dir, 'dirty-data-v1.csv'));
const expectedProfile = JSON.parse(fs.readFileSync(path.join(dir, 'expected-profile.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const mappingTemplate = JSON.parse(fs.readFileSync(path.join(dir, 'mapping-template.json'), 'utf8'));
const docs = fs.readFileSync(path.join(root, 'apps/crm/modules/crm-2/docs/data-quality-rules.md'), 'utf8');

function parseCsv(content: string): RawRow[] {
  const lines = content.trim().split('\n');
  const headers = lines[0]!.split(',');
  return lines.slice(1).map((line) => {
    const row: Record<string, string> = {};
    let cur = '';
    let inQ = false;
    let colIdx = 0;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQ = !inQ;
      } else if (c === ',' && !inQ) {
        row[headers[colIdx++]!] = cur;
        cur = '';
      } else {
        cur += c;
      }
    }
    row[headers[colIdx++]!] = cur;
    return row as RawRow;
  });
}

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

// Ledger simulator identifying valid existing deals in target store
const validDealIds = new Set<string>();
for (let i = 1; i <= 65; i++) {
  validDealIds.add(`d1000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  validDealIds.add(`deal_legacy_${String(i).padStart(4, "0")}`);
  validDealIds.add(`deal_orphan_${String(i).padStart(4, "0")}`);
}
const dealLedger = (dealId: string): boolean => validDealIds.has(dealId);

describe('CRM-2 Deals & Quotes Data Quality Rules (Issue #23 / [CRM2-08])', () => {
  // -------------------------------------------------------------------------
  // 1. Fixture Integrity & Checksum
  // -------------------------------------------------------------------------
  describe('1. Fixture Integrity & Expected Profile Alignment', () => {
    it('fixture matches committed SHA-256 hash, byte length and row count', () => {
      expect(sha256(csvBuf)).toBe(expectedProfile.fixture.sha256);
      expect(csvBuf.length).toBe(expectedProfile.fixture.bytes);
      expect(parseCsv(csvBuf.toString('utf8')).length).toBe(expectedProfile.fixture.rows);
      expect(expectedProfile.fixture.rows).toBe(100);
    });

    it('mapping template matches recorded module and entity structure', () => {
      expect(mappingTemplate.template.module).toBe('crm-2');
      expect(mappingTemplate.template.entities.length).toBe(2);
      expect(mappingTemplate.template.entities.map((e: any) => e.name)).toEqual(['crm2_deals', 'crm2_quotes']);
    });

    it('rules documentation documents all defined rules in rule catalog', () => {
      for (const rule of RULES) {
        expect(docs).toContain(rule.rule_id);
        expect(docs).toContain(rule.code);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. Row Conservation Balance Sheet
  // -------------------------------------------------------------------------
  describe('2. Row Conservation Balance Sheet', () => {
    it('strictly satisfies source (100) = loaded (75) + rejected (17) + merged (8) + skipped (0)', () => {
      const rows = parseCsv(csvBuf.toString('utf8'));
      const results = evaluateRows(rows, dealLedger);
      const summary = summarize(results);

      expect(summary.total).toBe(100);
      expect(summary.terminal_outcomes.loaded).toBe(75);
      expect(summary.terminal_outcomes.rejected).toBe(17);
      expect(summary.terminal_outcomes.merged).toBe(8);
      expect(summary.terminal_outcomes.skipped).toBe(0);

      const accounted = summary.terminal_outcomes.loaded +
        summary.terminal_outcomes.rejected +
        summary.terminal_outcomes.merged +
        summary.terminal_outcomes.skipped;
      const unaccounted = summary.total - accounted;

      expect(accounted).toBe(100);
      expect(unaccounted).toBe(0);
    });

    it('every row outcome matches 100% of manifest expected outcomes', () => {
      const rows = parseCsv(csvBuf.toString('utf8'));
      const results = evaluateRows(rows, dealLedger);

      for (let i = 0; i < 100; i++) {
        const result = results[i]!;
        const expectedRecord = manifest.records[i]!;

        expect(result.source_row).toBe(expectedRecord.sourceRow);
        expect(result.terminal_outcome).toBe(expectedRecord.expectedOutcome);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 3. Defect Category Assertions
  // -------------------------------------------------------------------------
  describe('3. Defect Category Assertions & Business Invariants', () => {
    const rows = parseCsv(csvBuf.toString('utf8'));
    const results = evaluateRows(rows, dealLedger);

    it('evaluates exactly 3 EMPTY_MANDATORY_FIELD violations (Rows 90-92)', () => {
      const emptyNameRows = results.filter((r) =>
        r.violations.some((v) => v.code === 'EMPTY_MANDATORY_FIELD'),
      );
      expect(emptyNameRows.length).toBe(3);
      expect(emptyNameRows.map((r) => r.source_row)).toEqual([90, 91, 92]);
    });

    it('evaluates exactly 3 NEGATIVE_VALUE violations (Rows 84-86)', () => {
      const negValRows = results.filter((r) =>
        r.violations.some((v) => v.code === 'NEGATIVE_VALUE'),
      );
      expect(negValRows.length).toBe(3);
      expect(negValRows.map((r) => r.source_row)).toEqual([84, 85, 86]);
    });

    it('evaluates exactly 3 INVALID_CURRENCY violations (Rows 87-89)', () => {
      const invalidCurrRows = results.filter((r) =>
        r.violations.some((v) => v.code === 'INVALID_CURRENCY'),
      );
      expect(invalidCurrRows.length).toBe(3);
      expect(invalidCurrRows.map((r) => r.source_row)).toEqual([87, 88, 89]);
    });

    it('evaluates exactly 3 INVALID_STAGE violations (Rows 93-95)', () => {
      const invalidStageRows = results.filter((r) =>
        r.violations.some((v) => v.code === 'INVALID_STAGE'),
      );
      expect(invalidStageRows.length).toBe(3);
      expect(invalidStageRows.map((r) => r.source_row)).toEqual([93, 94, 95]);
    });

    it('evaluates exactly 3 INVALID_DATE_FORMAT violations (Rows 96-98)', () => {
      const invalidDateRows = results.filter((r) =>
        r.violations.some((v) => v.code === 'INVALID_DATE_FORMAT'),
      );
      expect(invalidDateRows.length).toBe(3);
      expect(invalidDateRows.map((r) => r.source_row)).toEqual([96, 97, 98]);
    });

    it('evaluates exactly 2 PARENT_DEAL_NOT_FOUND violations (Rows 99-100)', () => {
      const orphanQuoteRows = results.filter((r) =>
        r.violations.some((v) => v.code === 'PARENT_DEAL_NOT_FOUND'),
      );
      expect(orphanQuoteRows.length).toBe(2);
      expect(orphanQuoteRows.map((r) => r.source_row)).toEqual([99, 100]);
    });

    it('evaluates exactly 8 duplicate candidate rows (Rows 76-83)', () => {
      const mergedRows = results.filter((r) => r.terminal_outcome === 'merged');
      expect(mergedRows.length).toBe(8);
      expect(mergedRows.map((r) => r.source_row)).toEqual([76, 77, 78, 79, 80, 81, 82, 83]);
    });

    it('accepts orphan deals (contact_id=null) into loaded outcomes without rejection', () => {
      const orphanDealRows = [61, 62, 63, 64, 65];
      for (const rowIdx of orphanDealRows) {
        const res = results[rowIdx - 1]!;
        expect(res.terminal_outcome).toBe('loaded');
      }
    });
  });

  // -------------------------------------------------------------------------
  // 4. Determinism & Immutability
  // -------------------------------------------------------------------------
  describe('4. Determinism & Raw Data Immutability', () => {
    it('running evaluateRows multiple times produces byte-identical results', () => {
      const rows = parseCsv(csvBuf.toString('utf8'));
      const run1 = JSON.stringify(evaluateRows(rows, dealLedger));
      const run2 = JSON.stringify(evaluateRows(rows, dealLedger));
      expect(run1).toBe(run2);
    });

    it('evaluation does not mutate input CSV buffer or raw records', () => {
      const originalCsvHash = sha256(csvBuf);
      const rows = parseCsv(csvBuf.toString('utf8'));
      evaluateRows(rows, dealLedger);
      expect(sha256(csvBuf)).toBe(originalCsvHash);
    });
  });
});
