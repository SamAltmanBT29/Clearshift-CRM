import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanRows,
  cleanListRows,
  cleanCampaignRows,
  cleanMemberRows,
  cleanConsentRows,
  CRM4_ENTITY_REQUIRED_FIELDS,
  type AuditEntry,
} from '../../src/kit/cleaner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_FILE = path.join(__dirname, '../fixtures/dirty-pack-100.csv');

function parseCsv(csvText: string): Record<string, string>[] {
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',');
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const commaIndices: number[] = [];
    let inQuotes = false;
    for (let c = 0; c < line.length; c++) {
      if (line[c] === '"') inQuotes = !inQuotes;
      if (line[c] === ',' && !inQuotes) commaIndices.push(c);
      if (commaIndices.length === headers.length - 1) break;
    }

    const rowObj: Record<string, string> = {};
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

const baseList = {
  entity_type: 'list',
  name: 'Enterprise Strategic Accounts',
  description: 'Tier-1 accounts',
};

const baseCampaign = {
  entity_type: 'campaign',
  name: 'Developer Workshop 2026',
  campaign_date: '2026-11-15',
  list_id: '44444444-1111-4444-8444-000000000001',
};

const baseMember = {
  entity_type: 'member',
  campaign_id: '44444444-2222-4444-8444-000000000001',
  contact_id: '11111111-1111-4111-8111-000000000001',
  member_status: 'sent',
  unsubscribed: 'false',
};

const baseConsent = {
  entity_type: 'consent',
  contact_id: '11111111-1111-4111-8111-000000000002',
  consent_status: 'subscribed',
  consent_source: 'web_form',
  prior_consent_status: 'unknown',
};

describe('CRM-4 Cleaning Rules & Field-Level Audit (#180 / [CRM4-27])', () => {
  // -------------------------------------------------------------------------
  // Acceptance Criterion 1: Standard Cleaners Execute
  // -------------------------------------------------------------------------
  describe('Acceptance Criterion 1: Standard Cleaners Execution', () => {
    it('trims leading/trailing whitespace and collapses repeated internal spaces (RL-TEXT-01)', () => {
      const { rows, audit } = cleanListRows([
        {
          ...baseList,
          name: '  Q1   Strategic    Accounts  ',
          description: '  Tier-1    Enterprise   clients  ',
        },
      ]);

      expect(rows[0]?.name).toBe('Q1 Strategic Accounts');
      expect(rows[0]?.description).toBe('Tier-1 Enterprise clients');
      expect(audit).toHaveLength(2);
      expect(audit.every((a) => a.rule_id === 'RL-TEXT-01')).toBe(true);
    });

    it('removes non-printable ASCII control characters (RL-TEXT-02)', () => {
      const { rows, audit } = cleanListRows([
        {
          ...baseList,
          name: 'Global\u0001Marketing\u0007List',
        },
      ]);

      expect(rows[0]?.name).toBe('GlobalMarketingList');
      expect(audit.some((a) => a.rule_id === 'RL-TEXT-02')).toBe(true);
    });

    it('lowercases email addresses and trims surrounding whitespace (RL-EMAIL-01)', () => {
      const { rows, audit } = cleanRows([
        {
          ...baseMember,
          email: '  Alice.Smith@SYNTHETIC-DOMAIN.EXAMPLE  ',
        },
      ]);

      expect(rows[0]?.email).toBe('alice.smith@synthetic-domain.example');
      expect(audit.some((a) => a.rule_id === 'RL-EMAIL-01')).toBe(true);
    });

    it('normalizes phone numbers and handles declared country prefixes (RL-PHONE-01)', () => {
      const { rows, audit } = cleanRows(
        [
          {
            ...baseMember,
            phone: ' (555) 019-2834 ',
          },
        ],
        { phoneCountry: '+1' }
      );

      expect(rows[0]?.phone).toBe('+15550192834');
      expect(audit.some((a) => a.rule_id === 'RL-PHONE-01')).toBe(true);
    });

    it('coerces multi-format date strings into standard ISO YYYY-MM-DD (RL-DATE-01)', () => {
      const dateVariants = [
        { raw: '31/12/2026', expected: '2026-12-31' },
        { raw: '12-31-2026', expected: '2026-12-31' },
        { raw: '2026.11.15', expected: '2026-11-15' },
        { raw: '2026/11/15', expected: '2026-11-15' },
        { raw: 'November 15 2026', expected: '2026-11-15' },
      ];

      for (const { raw, expected } of dateVariants) {
        const { rows, audit } = cleanCampaignRows([
          {
            ...baseCampaign,
            campaign_date: raw,
          },
        ]);

        expect(rows[0]?.campaign_date).toBe(expected);
        expect(audit.some((a) => a.rule_id === 'RL-DATE-01')).toBe(true);
      }
    });

    it('normalizes member and consent statuses to lowercase (RL-ENUM-01)', () => {
      const { rows: memberRows } = cleanMemberRows([
        {
          ...baseMember,
          member_status: '  OPENED  ',
          unsubscribed: ' FALSE ',
        },
      ]);
      expect(memberRows[0]?.member_status).toBe('opened');
      expect(memberRows[0]?.unsubscribed).toBe('false');

      const { rows: consentRows } = cleanConsentRows([
        {
          ...baseConsent,
          consent_status: ' SUBSCRIBED ',
        },
      ]);
      expect(consentRows[0]?.consent_status).toBe('subscribed');
    });

    it('neutralizes formula injection triggers when enabled (RL-FORMULA-01)', () => {
      const { rows, audit } = cleanListRows(
        [
          {
            ...baseList,
            name: '+1234567890 Strategic Accounts',
          },
        ],
        { neutralizeFormulaPrefix: true }
      );

      expect(rows[0]?.name).toBe("'+1234567890 Strategic Accounts");
      expect(audit.some((a) => a.rule_id === 'RL-FORMULA-01')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criterion 2: Field-Level Audit Trail
  // -------------------------------------------------------------------------
  describe('Acceptance Criterion 2: Field-Level Audit Trail', () => {
    it('generates an audit entry with source_row, field_name, original_value, cleaned_value, and rule_id', () => {
      const { audit } = cleanRows([
        { ...baseList, name: '  Clean List 1  ' },
        { ...baseList, name: 'Already Clean List' },
        { ...baseList, name: '  Clean List 3  ' },
      ]);

      expect(audit).toHaveLength(2);
      expect(audit[0]).toEqual<AuditEntry>({
        source_row: 1,
        field_name: 'name',
        original_value: '  Clean List 1  ',
        cleaned_value: 'Clean List 1',
        rule_id: 'RL-TEXT-01',
      });
      expect(audit[1]).toEqual<AuditEntry>({
        source_row: 3,
        field_name: 'name',
        original_value: '  Clean List 3  ',
        cleaned_value: 'Clean List 3',
        rule_id: 'RL-TEXT-01',
      });
    });

    it('emits zero audit entries for clean untouched values (zero log pollution)', () => {
      const { audit } = cleanRows([
        baseList,
        baseCampaign,
        baseMember,
        baseConsent,
      ]);

      expect(audit).toHaveLength(0);
    });

    it('tracks multiple successive rule modifications on the same field in order', () => {
      const { audit } = cleanCampaignRows([
        {
          ...baseCampaign,
          campaign_date: '  31/12/2026  ',
        },
      ]);

      // RL-TEXT-01 trims whitespace, then RL-DATE-01 coerces to ISO
      expect(audit.length).toBeGreaterThanOrEqual(2);
      expect(audit[0]?.rule_id).toBe('RL-TEXT-01');
      expect(audit[0]?.cleaned_value).toBe('31/12/2026');
      expect(audit[1]?.rule_id).toBe('RL-DATE-01');
      expect(audit[1]?.cleaned_value).toBe('2026-12-31');
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criterion 3: Structured Row Rejections
  // -------------------------------------------------------------------------
  describe('Acceptance Criterion 3: Structured Row Rejections', () => {
    it('rejects rows with missing or whitespace-only required fields (REQUIRED_FIELD_MISSING)', () => {
      const { rows, rejects } = cleanListRows([
        { ...baseList, name: '' },
        { ...baseList, name: '   ' },
      ]);

      expect(rows).toHaveLength(0);
      expect(rejects).toHaveLength(2);
      expect(rejects[0]?.reason_code).toBe('REQUIRED_FIELD_MISSING');
      expect(rejects[0]?.field_name).toBe('name');
      expect(rejects[1]?.reason_code).toBe('REQUIRED_FIELD_MISSING');
    });

    it('rejects member rows with missing contact_id or campaign_id', () => {
      const { rejects } = cleanMemberRows([
        { ...baseMember, contact_id: '' },
        { ...baseMember, campaign_id: '   ' },
      ]);

      expect(rejects).toHaveLength(2);
      expect(rejects.every((r) => r.reason_code === 'REQUIRED_FIELD_MISSING')).toBe(true);
    });

    it('rejects member rows with invalid member status outside allowlist (INVALID_MEMBER_STATUS)', () => {
      const invalidStatuses = ['bounced', 'delivered', 'draft', 'failed', 'queued', 'pending_review'];

      for (const invalidStatus of invalidStatuses) {
        const { rows, rejects } = cleanMemberRows([
          { ...baseMember, member_status: invalidStatus },
        ]);

        expect(rows).toHaveLength(0);
        expect(rejects[0]?.reason_code).toBe('INVALID_MEMBER_STATUS');
        expect(rejects[0]?.field_name).toBe('member_status');
        expect(rejects[0]?.reason).toContain(invalidStatus);
      }
    });

    it('rejects monotonic opt-out reversals per BR-CRM4-01 (MONOTONIC_OPT_OUT_VIOLATION)', () => {
      const { rows, rejects } = cleanConsentRows([
        {
          ...baseConsent,
          consent_status: 'subscribed',
          prior_consent_status: 'unsubscribed',
        },
      ]);

      expect(rows).toHaveLength(0);
      expect(rejects[0]?.reason_code).toBe('MONOTONIC_OPT_OUT_VIOLATION');
      expect(rejects[0]?.field_name).toBe('consent_status');
      expect(rejects[0]?.reason).toContain('BR-CRM4-01');
    });

    it('rejects campaign rows with unparseable date strings (INVALID_DATE_FORMAT)', () => {
      const { rows, rejects } = cleanCampaignRows([
        { ...baseCampaign, campaign_date: 'invalid-epoch-date' },
      ]);

      expect(rows).toHaveLength(0);
      expect(rejects[0]?.reason_code).toBe('INVALID_DATE_FORMAT');
      expect(rejects[0]?.field_name).toBe('campaign_date');
    });

    it('rejects spreadsheet calculation command execution payloads (FORMULA_INJECTION_RISK)', () => {
      const { rows, rejects } = cleanListRows([
        { ...baseList, name: "=cmd|'/C calc'!A0" },
      ]);

      expect(rows).toHaveLength(0);
      expect(rejects[0]?.reason_code).toBe('FORMULA_INJECTION_RISK');
      expect(rejects[0]?.field_name).toBe('name');
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criterion 4: Verification Against Expected Clean States
  // -------------------------------------------------------------------------
  describe('Acceptance Criterion 4: Verification Against Expected Clean States & Dirty Pack', () => {
    it('preserves clean golden records identically across all entities', () => {
      const cleanGoldenRecords = [
        baseList,
        baseCampaign,
        baseMember,
        baseConsent,
      ];

      const { rows, rejects, audit } = cleanRows(cleanGoldenRecords);

      expect(rows).toHaveLength(4);
      expect(rejects).toHaveLength(0);
      expect(audit).toHaveLength(0);
      expect(rows).toEqual(cleanGoldenRecords);
    });

    it('processes the canonical 100-row Dirty Data Pack preserving clean rows and rejecting defects', () => {
      const csvText = fs.readFileSync(CSV_FILE, 'utf8');
      const inputRows = parseCsv(csvText);

      expect(inputRows).toHaveLength(100);

      const result = cleanRows(inputRows);

      // Total input accounting
      expect(result.summary.totalInputRows).toBe(100);

      // Clean rows (first 50) must all be accepted into cleaned rows
      expect(result.rows.length).toBeGreaterThanOrEqual(50);

      // Verify that known unrecoverable defects are caught in rejects
      const rejectCodes = result.rejects.map((r) => r.reason_code);
      expect(rejectCodes).toContain('REQUIRED_FIELD_MISSING');
      expect(rejectCodes).toContain('INVALID_MEMBER_STATUS');
      expect(rejectCodes).toContain('MONOTONIC_OPT_OUT_VIOLATION');
      expect(rejectCodes).toContain('INVALID_DATE_FORMAT');
      expect(rejectCodes).toContain('FORMULA_INJECTION_RISK');

      // Verify row conservation equation: input = cleaned + rejected
      expect(result.summary.totalInputRows).toBe(
        result.summary.cleanedRowCount + result.summary.rejectedRowCount
      );

      // Verify whitespace padding edge cases (indices 92..96) were cleaned and audited
      const whitespaceAudits = result.audit.filter((a) => a.rule_id === 'RL-TEXT-01');
      expect(whitespaceAudits.length).toBeGreaterThanOrEqual(5);

      // Verify date format variants were cleaned and audited
      const dateAudits = result.audit.filter((a) => a.rule_id === 'RL-DATE-01');
      expect(dateAudits.length).toBeGreaterThanOrEqual(5);
    });

    it('respects disabledRules option allowing specific cleaners to be bypassed', () => {
      const dirtyName = '  Unchanged   Spaced   Name  ';
      const { rows, audit } = cleanListRows(
        [{ ...baseList, name: dirtyName }],
        { disabledRules: ['RL-TEXT-01'] }
      );

      expect(rows[0]?.name).toBe(dirtyName);
      expect(audit.some((a) => a.rule_id === 'RL-TEXT-01')).toBe(false);
    });

    it('formats person names to proper casing with special prefixes (RL-NAME-01)', () => {
      const { rows, audit } = cleanRows([
        {
          ...baseMember,
          contact_name: 'john mcdonald',
          first_name: "o'brien",
          last_name: 'smith-jones',
        },
      ]);

      expect(rows[0]?.contact_name).toBe('John McDonald');
      expect(rows[0]?.first_name).toBe("O'Brien");
      expect(rows[0]?.last_name).toBe('Smith-Jones');
      expect(audit.some((a) => a.rule_id === 'RL-NAME-01')).toBe(true);
    });

    it('handles empty input row set safely without errors', () => {
      const result = cleanRows([]);
      expect(result.rows).toHaveLength(0);
      expect(result.audit).toHaveLength(0);
      expect(result.rejects).toHaveLength(0);
      expect(result.summary.totalInputRows).toBe(0);
      expect(result.summary.cleanedRowCount).toBe(0);
      expect(result.summary.rejectedRowCount).toBe(0);
    });

    it('declares mandatory required fields for all 4 CRM-4 entities', () => {
      expect(CRM4_ENTITY_REQUIRED_FIELDS.list).toEqual(['name']);
      expect(CRM4_ENTITY_REQUIRED_FIELDS.campaign).toEqual(['name', 'campaign_date', 'list_id']);
      expect(CRM4_ENTITY_REQUIRED_FIELDS.member).toEqual(['campaign_id', 'contact_id', 'member_status']);
      expect(CRM4_ENTITY_REQUIRED_FIELDS.consent).toEqual(['contact_id', 'consent_status', 'consent_source']);
    });
  });
});
