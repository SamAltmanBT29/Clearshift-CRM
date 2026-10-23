import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  CRM4MemberStatusSchema,
  assertMonotonicOptOut,
  CRM4ListCreateSchema,
  CRM4CampaignCreateSchema,
} from '@clearshift/contracts';
import { sanitizeCsvField } from '../../src/policies/masking.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_FILE = path.join(__dirname, 'dirty-pack-100.csv');
const MANIFEST_FILE = path.join(__dirname, 'manifest.json');
const SAMPLE_CSV = path.resolve(__dirname, '../../../../../../sample-data/crm-4/dirty-pack-100.csv');
const SAMPLE_MANIFEST = path.resolve(__dirname, '../../../../../../sample-data/crm-4/manifest.json');

describe('CRM-4 Canonical Module Dirty Data Pack (#178 / [CRM4-25])', () => {
  it('should locate dirty-pack-100.csv and manifest.json in both module fixtures and sample-data', () => {
    expect(fs.existsSync(CSV_FILE)).toBe(true);
    expect(fs.existsSync(MANIFEST_FILE)).toBe(true);
    expect(fs.existsSync(SAMPLE_CSV)).toBe(true);
    expect(fs.existsSync(SAMPLE_MANIFEST)).toBe(true);
  });

  const rawCsv = fs.readFileSync(CSV_FILE, 'utf8').trim();
  const lines = rawCsv.split('\n');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));

  describe('Acceptance Criterion 1: Dataset Structure and 100% Synthetic Records (>= 100 rows, 0 PII)', () => {
    it('should have exactly 1 header line and 100 data rows', () => {
      expect(lines.length).toBe(101); // 1 header + 100 data rows
      expect(manifest.totalRecords).toBe(100);
      expect(manifest.records.length).toBe(100);
    });

    it('should have standard canonical CSV headers', () => {
      const headerLine = lines[0];
      const headers = headerLine.split(',');
      expect(headers).toEqual([
        'row_id',
        'entity_type',
        'name',
        'description',
        'campaign_date',
        'list_id',
        'contact_id',
        'campaign_id',
        'member_status',
        'unsubscribed',
        'consent_status',
        'consent_source',
        'prior_consent_status',
        'campaign_count',
        'member_count',
        'notes',
      ]);
    });

    it('should contain purely synthetic data with zero real personal data', () => {
      // Ensure zero consumer/real email providers exist
      expect(rawCsv).not.toMatch(/@(gmail|yahoo|hotmail|outlook)\.com/i);
      // Ensure zero credentials or secret tokens exist
      expect(rawCsv).not.toMatch(/password|secret|bearer/i);
      // Ensure zero sensitive government identifiers exist
      expect(rawCsv).not.toMatch(/ssn|social_security|national_id/i);
    });

    it('should partition exactly 50 clean records and 50 defective records', () => {
      expect(manifest.summary.cleanRecordsCount).toBe(50);
      expect(manifest.summary.defectiveRecordsCount).toBe(50);

      const validRecords = manifest.records.filter((r: { status: string }) => r.status === 'VALID');
      const defectiveRecords = manifest.records.filter((r: { status: string }) => r.status === 'DEFECTIVE');

      expect(validRecords.length).toBe(50);
      expect(defectiveRecords.length).toBe(50);
    });
  });

  describe('Acceptance Criterion 2: Manifest Documented Outcomes', () => {
    it('manifest should cover all required outcomes per Issue #178 specification', () => {
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

      const recordOutcomes = new Set(
        manifest.records.map((r: { expectedOutcome: string }) => r.expectedOutcome)
      );

      for (const outcome of requiredOutcomes) {
        expect(
          recordOutcomes.has(outcome),
          `Outcome "${outcome}" must be present in record catalog`
        ).toBe(true);
      }
    });

    it('should map every 1-indexed record from 1 to 100 without gaps', () => {
      for (let i = 1; i <= 100; i++) {
        const rec = manifest.records.find((r: { index: number }) => r.index === i);
        expect(rec).toBeDefined();
        expect(rec.index).toBe(i);
        expect(rec.expectedOutcome).toBeDefined();
      }
    });
  });

  describe('Acceptance Criterion 3: Required Edge Cases Coverage', () => {
    it('manifest should declare coverage of all 4 required edge cases', () => {
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

    it('contains valid UTF-8 international characters in marketing list names', () => {
      const utf8Records = manifest.records.filter((r: { hasUtf8?: boolean }) => r.hasUtf8);
      expect(utf8Records.length).toBeGreaterThanOrEqual(4);

      // Verify specific international names appear in raw CSV
      expect(rawCsv).toContain('Café Münich');
      expect(rawCsv).toContain('München Developers');
      expect(rawCsv).toContain('東京 Launch Community');
      expect(rawCsv).toContain('São Paulo Tech');
      expect(rawCsv).toContain('Zürich FinTech');
    });

    it('contains whitespace padding edge cases (indices 92 to 96)', () => {
      const wsCategory = manifest.defectCategories.WHITESPACE_PADDING;
      expect(wsCategory.count).toBe(5);
      expect(wsCategory.recordIndices).toEqual([92, 93, 94, 95, 96]);

      for (const idx of wsCategory.recordIndices) {
        const line = lines[idx];
        expect(line).toMatch(/\s{2,}|\t/);
      }
    });

    it('contains date format variants (indices 81 to 86)', () => {
      const dateCategory = manifest.defectCategories.DATE_FORMAT_VARIANTS;
      expect(dateCategory.count).toBe(6);
      expect(dateCategory.recordIndices).toEqual([81, 82, 83, 84, 85, 86]);

      for (const idx of dateCategory.recordIndices) {
        const line = lines[idx];
        const cols = line.split(',');
        const campaignDate = cols[4];
        // Must not match standard ISO YYYY-MM-DD
        expect(campaignDate).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('contains boundary number anomalies (indices 87 to 91)', () => {
      const boundaryCategory = manifest.defectCategories.BOUNDARY_NUMBERS;
      expect(boundaryCategory.count).toBe(5);
      expect(boundaryCategory.recordIndices).toEqual([87, 88, 89, 90, 91]);

      for (const idx of boundaryCategory.recordIndices) {
        const line = lines[idx];
        const cols = line.split(',');
        const campaignCount = cols[13];
        const memberCount = cols[14];
        const hasNegativeOrOverflow =
          campaignCount.startsWith('-') ||
          memberCount.startsWith('-') ||
          campaignCount.length >= 10 ||
          memberCount.length >= 10;
        expect(hasNegativeOrOverflow).toBe(true);
      }
    });

    it('contains formula injection payloads (indices 97 to 100)', () => {
      const formulaCategory = manifest.defectCategories.FORMULA_INJECTION_RISK;
      expect(formulaCategory.count).toBe(4);
      expect(formulaCategory.recordIndices).toEqual([97, 98, 99, 100]);

      for (const idx of formulaCategory.recordIndices) {
        const line = lines[idx];
        const cols = line.split(',');
        const name = cols[2];
        expect(name).toMatch(/^[=+\-@]/);
      }
    });
  });

  describe('Acceptance Criterion 4: Defect Category Disjointness & Partitioning', () => {
    it('should enforce strictly disjoint defect categories with zero index overlap', () => {
      const categories = manifest.defectCategories;
      const seenIndices = new Set<number>();
      let totalDefectCount = 0;

      for (const [, catData] of Object.entries(categories) as [
        string,
        { count: number; recordIndices: number[] }
      ][]) {
        expect(catData.count).toBe(catData.recordIndices.length);
        totalDefectCount += catData.count;

        for (const index of catData.recordIndices) {
          expect(
            seenIndices.has(index),
            `Index ${index} must belong to exactly one defect category`
          ).toBe(false);
          seenIndices.add(index);
        }
      }

      // Exactly 50 defective rows
      expect(totalDefectCount).toBe(50);
      expect(seenIndices.size).toBe(50);

      // Verify defective indices are strictly between 51 and 100
      for (const index of seenIndices) {
        expect(index).toBeGreaterThanOrEqual(51);
        expect(index).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('Acceptance Criterion 5: Validation Rules & Domain Invariants', () => {
    it('rejects all invalid member statuses (indices 70 to 75)', () => {
      const statusCategory = manifest.defectCategories.INVALID_MEMBER_STATUS;
      for (const idx of statusCategory.recordIndices) {
        const line = lines[idx];
        const cols = line.split(',');
        const status = cols[8];
        const parseResult = CRM4MemberStatusSchema.safeParse(status);
        expect(parseResult.success).toBe(false);
      }
    });

    it('rejects all monotonic opt-out reversals per BR-CRM4-01 (indices 76 to 80)', () => {
      const optOutCategory = manifest.defectCategories.MONOTONIC_OPT_OUT_VIOLATION;
      for (const idx of optOutCategory.recordIndices) {
        const line = lines[idx];
        const cols = line.split(',');
        const consentStatus = cols[10];
        const priorConsentStatus = cols[12];

        expect(priorConsentStatus).toBe('unsubscribed');
        expect(consentStatus).toBe('subscribed');

        expect(() => assertMonotonicOptOut(priorConsentStatus, consentStatus)).toThrow(
          /BR-CRM4-01/
        );
      }
    });

    it('rejects missing or empty mandatory list names', () => {
      // Row 51 has empty name, Row 52 has whitespace-only name
      expect(CRM4ListCreateSchema.safeParse({ name: '' }).success).toBe(false);
      expect(CRM4ListCreateSchema.safeParse({ name: '   ' }).success).toBe(false);
    });

    it('rejects malformed campaign date strings', () => {
      const badDates = ['31/12/2026', '12-31-2026', '2026.11.15', 'invalid-epoch-date'];
      for (const badDate of badDates) {
        expect(
          CRM4CampaignCreateSchema.safeParse({
            name: 'Test',
            campaignDate: badDate,
            listId: '44444444-1111-4444-8444-000000000001',
          }).success
        ).toBe(false);
      }
    });

    it('sanitizes formula injection payloads by prepending a single quote', () => {
      const payloads = [
        "=cmd|'/C calc'!A0",
        '+1234567890 Strategic Accounts',
        '@SUM(1+1) High Value Outreach',
        '-100 Discount Campaign',
      ];

      for (const payload of payloads) {
        const sanitized = sanitizeCsvField(payload);
        expect(sanitized.startsWith("'")).toBe(true);
      }
    });
  });

  describe('Acceptance Criterion 6: Deterministic Reproducibility Across Multiple Runs', () => {
    it('verifies SHA-256 checksum matches between fixture and manifest', () => {
      const hash = crypto.createHash('sha256').update(rawCsv + '\n').digest('hex');
      expect(hash).toBe(manifest.sha256);
    });

    it('verifies byte-for-byte identity between test fixture and sample-data directory', () => {
      const sampleCsv = fs.readFileSync(SAMPLE_CSV, 'utf8').trim();
      const sampleManifest = JSON.parse(fs.readFileSync(SAMPLE_MANIFEST, 'utf8'));

      expect(sampleCsv).toBe(rawCsv);
      expect(sampleManifest).toEqual(manifest);
    });

    it('reproduces identically across independent parsing passes', () => {
      for (let run = 1; run <= 3; run++) {
        const passCsv = fs.readFileSync(CSV_FILE, 'utf8').trim();
        const passLines = passCsv.split('\n');
        expect(passLines.length).toBe(101);
        expect(passCsv.length).toBe(rawCsv.length);

        const passHash = crypto.createHash('sha256').update(passCsv + '\n').digest('hex');
        expect(passHash).toBe(manifest.sha256);
      }
    });
  });
});
