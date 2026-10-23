import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
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
const FIXTURE_DIR = path.resolve(__dirname, '../../../../../../sample-data/crm-4');
const CSV_FILE = path.join(FIXTURE_DIR, 'dirty-data-v1.csv');
const PROFILE_FILE = path.join(FIXTURE_DIR, 'expected-profile.json');

describe('CRM-4 Dirty Data Pack Reconciliation & Profiling (Issue #45 / [CRM4-10])', () => {
  it('locates dirty-data-v1.csv and expected-profile.json in sample-data/crm-4', () => {
    expect(fs.existsSync(CSV_FILE)).toBe(true);
    expect(fs.existsSync(PROFILE_FILE)).toBe(true);
  });

  const rawCsv = fs.readFileSync(CSV_FILE, 'utf8').trim();
  const lines = rawCsv.split('\n');
  const profile = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));

  describe('1. Dataset Integrity & Synthetic Safety', () => {
    it('has exactly 1 header line and 50 data rows', () => {
      expect(lines.length).toBe(51); // 1 header + 50 rows
      expect(profile.fixture.rows).toBe(50);
    });

    it('contains 0 real PII, credentials, or sensitive secrets', () => {
      expect(rawCsv).not.toMatch(/@(gmail|yahoo|hotmail|outlook)\.com/i);
      expect(rawCsv).not.toMatch(/password|secret|bearer/i);
      expect(rawCsv).not.toMatch(/ssn|social_security/i);
    });
  });

  describe('2. Reconciliation & Outcome Accounting', () => {
    it('enforces total conservation: accepted + normalized + rejected = total', () => {
      const { accept, normalize, reject } = profile.outcomes;
      expect(accept + normalize + reject).toBe(profile.fixture.rows);
      expect(accept).toBe(30);
      expect(normalize).toBe(5);
      expect(reject).toBe(15);
    });
  });

  describe('3. Validation Rule Rejections & Assertions', () => {
    it('rejects all 5 invalid member status rows (bounced, delivered, queued, failed, draft)', () => {
      const invalidStatuses = ['bounced', 'delivered', 'queued', 'failed', 'draft'];
      for (const status of invalidStatuses) {
        const result = CRM4MemberStatusSchema.safeParse(status);
        expect(result.success).toBe(false);
      }
    });

    it('rejects all 5 monotonic opt-out reversals (BR-CRM4-01)', () => {
      const rowsWithReversal = lines.slice(41, 46); // Rows 41 to 45
      expect(rowsWithReversal.length).toBe(5);

      for (const line of rowsWithReversal) {
        const cols = line.split(',');
        const consentStatus = cols[8];
        const priorConsentStatus = cols[10]?.trim();

        expect(priorConsentStatus).toBe('unsubscribed');
        expect(consentStatus).toBe('subscribed');

        expect(() => assertMonotonicOptOut(priorConsentStatus, consentStatus)).toThrow(
          /BR-CRM4-01/
        );
      }
    });

    it('rejects empty list name and malformed campaign date', () => {
      // Row 46: empty list name
      expect(CRM4ListCreateSchema.safeParse({ name: '   ' }).success).toBe(false);

      // Row 47: invalid campaign date format (25-12-2026 instead of YYYY-MM-DD)
      expect(
        CRM4CampaignCreateSchema.safeParse({
          name: 'Invalid Date',
          campaignDate: '25-12-2026',
          listId: '44444444-1111-4444-8444-000000000001',
        }).success).toBe(false);
    });

    it('sanitizes all 5 formula injection payloads by prepending a single quote', () => {
      const formulaPayloads = [
        "=cmd|'/C calc'!A0",
        '+1234567890 High Net Worth',
        '@SUM(1+1) Campaign',
        '-100 Discount Outreach',
        '\ttab_leading_source',
      ];

      for (const payload of formulaPayloads) {
        const sanitized = sanitizeCsvField(payload);
        expect(sanitized.startsWith("'")).toBe(true);
      }
    });
  });
});
