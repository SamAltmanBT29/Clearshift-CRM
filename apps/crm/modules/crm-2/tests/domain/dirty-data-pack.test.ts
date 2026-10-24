import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateCanonicalCrm2Records,
  formatRecordsAsCsv,
  buildCrm2Manifest,
  buildCrm2ExpectedProfile,
} from '../../src/domain/dirty-data-pack-generator.js';
import {
  CRM2_DIRTY_DATA_PACK_PLAN,
  assertConservationEquation,
  buildDealExactBusinessKey,
  buildQuoteExactKey,
} from '../../src/domain/qa-specs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../../../..');
const SAMPLE_DATA_DIR = path.join(REPO_ROOT, 'sample-data/crm-2');

describe('CRM-2 Canonical Module Dirty Data Pack (Issue #138 / [CRM2-25])', () => {
  const records = generateCanonicalCrm2Records();
  const csvContent = formatRecordsAsCsv(records);
  const manifest = buildCrm2Manifest(records);
  const profile = buildCrm2ExpectedProfile(csvContent, records);

  describe('1. Dataset Sizing & Row Conservation Balance Sheet', () => {
    it('generates exactly 100 rows with continuous 1-indexed source row numbers', () => {
      expect(records).toHaveLength(100);
      records.forEach((r, idx) => {
        expect(r.sourceRow).toBe(idx + 1);
      });
    });

    it('satisfies the conservation equation: source = loaded + rejected + merged + skipped (unaccounted = 0)', () => {
      const loaded = records.filter((r) => r.expectedOutcome === 'loaded').length;
      const rejected = records.filter((r) => r.expectedOutcome === 'rejected').length;
      const merged = records.filter((r) => r.expectedOutcome === 'merged').length;
      const skipped = records.filter((r) => r.expectedOutcome === 'skipped').length;

      expect(loaded).toBe(75);
      expect(rejected).toBe(17);
      expect(merged).toBe(8);
      expect(skipped).toBe(0);

      const balance = assertConservationEquation({
        sourceCount: records.length,
        loadedCount: loaded,
        rejectedCount: rejected,
        mergedCount: merged,
        skippedCount: skipped,
      });

      expect(balance.valid).toBe(true);
      expect(balance.unaccounted).toBe(0);
      expect(balance.terminalSum).toBe(100);
    });

    it('matches the approved G1 Dirty Data Pack plan targets', () => {
      expect(records.length).toBe(CRM2_DIRTY_DATA_PACK_PLAN.module100Plan.totalSourceRows);
      expect(manifest.cleanRecordsCount).toBe(CRM2_DIRTY_DATA_PACK_PLAN.module100Plan.expectedLoaded);
      expect(manifest.conservationEquation.rejected).toBe(
        CRM2_DIRTY_DATA_PACK_PLAN.module100Plan.expectedRejected
      );
      expect(manifest.conservationEquation.merged).toBe(
        CRM2_DIRTY_DATA_PACK_PLAN.module100Plan.expectedMerged
      );
      expect(manifest.conservationEquation.skipped).toBe(
        CRM2_DIRTY_DATA_PACK_PLAN.module100Plan.expectedSkipped
      );
      expect(manifest.conservationEquation.unaccounted).toBe(0);
    });
  });

  describe('2. Defect Scenarios & Classification Integrity', () => {
    it('contains clean standard deals (55 rows) with valid attributes', () => {
      const cleanDeals = records.filter(
        (r) => r.category === 'golden_baseline' && r.entityType === 'deal' && r.contactId !== ''
      );
      expect(cleanDeals).toHaveLength(55);
      cleanDeals.forEach((d) => {
        expect(d.expectedOutcome).toBe('loaded');
        expect(d.name.trim().length).toBeGreaterThan(0);
        expect(parseFloat(d.value)).toBeGreaterThan(0);
        expect(['USD', 'EUR', 'GBP']).toContain(d.currency);
        expect(['New', 'Qualified', 'Proposal', 'Negotiation']).toContain(d.stageName);
        expect(d.closeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    });

    it('contains clean orphan deals (10 rows) with nullable contact_id', () => {
      const orphanDeals = records.filter(
        (r) => r.category === 'golden_baseline' && r.entityType === 'deal' && r.contactId === ''
      );
      expect(orphanDeals).toHaveLength(10);
      orphanDeals.forEach((d) => {
        expect(d.expectedOutcome).toBe('loaded');
        expect(d.name).toContain('Inbound Opportunity');
        expect(d.contactId).toBe('');
      });
    });

    it('contains clean quotes (10 rows) linked to parent deals', () => {
      const cleanQuotes = records.filter(
        (r) => r.category === 'golden_baseline' && r.entityType === 'quote'
      );
      expect(cleanQuotes).toHaveLength(10);
      cleanQuotes.forEach((q) => {
        expect(q.expectedOutcome).toBe('loaded');
        expect(q.quoteNumber).toMatch(/^Q-2026-\d{4}$/);
        expect(q.dealId).toMatch(/^d1000000-0000-4000-8000-\d{12}$/);
      });
    });

    it('contains exact duplicate deal candidates (4 rows / 2 pairs)', () => {
      const dupDeals = records.filter((r) => r.reasonCode === 'EXACT_DEAL_DUPLICATE');
      expect(dupDeals).toHaveLength(4);
      dupDeals.forEach((d) => {
        expect(d.expectedOutcome).toBe('merged');
      });

      // Verify Pair 1 normalizes identically
      const key1A = buildDealExactBusinessKey({
        name: dupDeals[0]!.name,
        stageId: dupDeals[0]!.stageName,
        contactId: dupDeals[0]!.contactId,
      });
      const key1B = buildDealExactBusinessKey({
        name: dupDeals[1]!.name,
        stageId: dupDeals[1]!.stageName,
        contactId: dupDeals[1]!.contactId,
      });
      expect(key1A).toBe(key1B);

      // Verify Pair 2 (orphans) normalizes identically
      const key2A = buildDealExactBusinessKey({
        name: dupDeals[2]!.name,
        stageId: dupDeals[2]!.stageName,
        contactId: dupDeals[2]!.contactId,
      });
      const key2B = buildDealExactBusinessKey({
        name: dupDeals[3]!.name,
        stageId: dupDeals[3]!.stageName,
        contactId: dupDeals[3]!.contactId,
      });
      expect(key2A).toBe(key2B);
    });

    it('contains exact duplicate quote candidates (4 rows / 2 pairs)', () => {
      const dupQuotes = records.filter((r) => r.reasonCode === 'EXACT_QUOTE_NUMBER_MATCH');
      expect(dupQuotes).toHaveLength(4);
      dupQuotes.forEach((q) => {
        expect(q.expectedOutcome).toBe('merged');
      });

      // Pair 1
      const qKey1A = buildQuoteExactKey(dupQuotes[0]!.quoteNumber);
      const qKey1B = buildQuoteExactKey(dupQuotes[1]!.quoteNumber);
      expect(qKey1A).toBe(qKey1B);

      // Pair 2
      const qKey2A = buildQuoteExactKey(dupQuotes[2]!.quoteNumber);
      const qKey2B = buildQuoteExactKey(dupQuotes[3]!.quoteNumber);
      expect(qKey2A).toBe(qKey2B);
    });

    it('contains negative monetary value defects (3 rows)', () => {
      const negDeals = records.filter((r) => r.reasonCode === 'NEGATIVE_VALUE');
      expect(negDeals).toHaveLength(3);
      negDeals.forEach((d) => {
        expect(d.expectedOutcome).toBe('rejected');
        expect(parseFloat(d.value)).toBeLessThan(0);
      });
    });

    it('contains invalid currency defects (3 rows)', () => {
      const invalidCurr = records.filter((r) => r.reasonCode === 'INVALID_CURRENCY');
      expect(invalidCurr).toHaveLength(3);
      invalidCurr.forEach((d) => {
        expect(d.expectedOutcome).toBe('rejected');
        expect(d.currency).not.toMatch(/^[A-Z]{3}$/);
      });
    });

    it('contains empty mandatory deal name defects (3 rows)', () => {
      const emptyNames = records.filter((r) => r.reasonCode === 'EMPTY_MANDATORY_FIELD');
      expect(emptyNames).toHaveLength(3);
      emptyNames.forEach((d) => {
        expect(d.expectedOutcome).toBe('rejected');
        expect(d.name.trim()).toBe('');
      });
    });

    it('contains invalid pipeline stage defects (3 rows)', () => {
      const invalidStages = records.filter((r) => r.reasonCode === 'INVALID_STAGE');
      expect(invalidStages).toHaveLength(3);
      invalidStages.forEach((d) => {
        expect(d.expectedOutcome).toBe('rejected');
        expect(['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']).not.toContain(
          d.stageName
        );
      });
    });

    it('contains malformed close date defects (3 rows)', () => {
      const badDates = records.filter((r) => r.reasonCode === 'INVALID_DATE_FORMAT');
      expect(badDates).toHaveLength(3);
      badDates.forEach((d) => {
        expect(d.expectedOutcome).toBe('rejected');
        expect(d.closeDate).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    });

    it('contains missing parent deal references on quotes (2 rows)', () => {
      const orphanQuotes = records.filter((r) => r.reasonCode === 'PARENT_DEAL_NOT_FOUND');
      expect(orphanQuotes).toHaveLength(2);
      orphanQuotes.forEach((q) => {
        expect(q.expectedOutcome).toBe('rejected');
        expect(q.entityType).toBe('quote');
      });
    });
  });

  describe('3. Determinism, UTF-8 & Security Edge Cases', () => {
    it('produces byte-for-byte identical output across multiple generator runs', () => {
      const run1 = generateCanonicalCrm2Records();
      const run2 = generateCanonicalCrm2Records();
      const csv1 = formatRecordsAsCsv(run1);
      const csv2 = formatRecordsAsCsv(run2);

      expect(csv1).toBe(csv2);
      expect(run1).toEqual(run2);
    });

    it('preserves UTF-8 multi-byte characters without mojibake or corruption', () => {
      const utf8Names = records
        .map((r) => r.name)
        .filter((n) => n.includes('München') || n.includes('São Paulo') || n.includes('Zürich'));
      expect(utf8Names.length).toBeGreaterThan(0);
      utf8Names.forEach((name) => {
        expect(name).toMatch(/[^\x00-\x7F]/); // Contains non-ASCII UTF-8
      });
    });

    it('sanitizes formula injection edge case on row 10', () => {
      const row10 = records.find((r) => r.sourceRow === 10);
      expect(row10).toBeDefined();
      expect(row10!.name).toMatch(/^'=CMD/); // Escaped with leading single-quote
    });
  });

  describe('4. Manifest & Expected Profile Artifacts', () => {
    it('manifest documents complete metadata and conservation balance sheet', () => {
      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.module).toBe('crm-2');
      expect(manifest.totalRecords).toBe(100);
      expect(manifest.cleanRecordsCount).toBe(75);
      expect(manifest.defectiveRecordsCount).toBe(25);
      expect(manifest.conservationEquation.isBalanced).toBe(true);
      expect(manifest.records).toHaveLength(100);

      // Verify each record has required fields
      for (const rec of manifest.records) {
        expect(rec.sourceRow).toBeGreaterThan(0);
        expect(['deal', 'quote']).toContain(rec.entityType);
        expect(['loaded', 'rejected', 'merged', 'skipped']).toContain(rec.expectedOutcome);
        expect(rec.businessKey.length).toBeGreaterThan(0);
      }
    });

    it('expected-profile documents fixture hash, row counts, and column metrics', () => {
      expect(profile.schemaVersion).toBe(1);
      expect(profile.fixture.file).toBe('dirty-data-v1.csv');
      expect(profile.fixture.rows).toBe(100);
      expect(profile.fixture.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(profile.fixture.bytes).toBeGreaterThan(10000);
      expect(profile.outcomes.loaded).toBe(75);
      expect(profile.outcomes.rejected).toBe(17);
      expect(profile.outcomes.merged).toBe(8);
      expect(profile.outcomes.skipped).toBe(0);
    });

    it('persisted sample-data/crm-2 artifacts match generated memory representations', () => {
      const csvPath = path.join(SAMPLE_DATA_DIR, 'dirty-data-v1.csv');
      const manifestPath = path.join(SAMPLE_DATA_DIR, 'manifest.json');
      const profilePath = path.join(SAMPLE_DATA_DIR, 'expected-profile.json');

      expect(fs.existsSync(csvPath)).toBe(true);
      expect(fs.existsSync(manifestPath)).toBe(true);
      expect(fs.existsSync(profilePath)).toBe(true);

      const diskCsv = fs.readFileSync(csvPath, 'utf-8');
      const diskManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const diskProfile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));

      expect(diskCsv).toBe(csvContent);
      expect(diskManifest).toEqual(manifest);
      expect(diskProfile).toEqual(profile);
    });
  });
});
