import {
  CRM1LeadStatusSchema,
  CRM1ConsentStatusSchema,
} from '@clearshift/contracts';
import {
  normalizeEmail,
  normalizePhone,
  normalizeName,
} from '@cs/core';

export const RULESET_VERSION = 1;

export type RowOutcome = 'accept' | 'normalize' | 'merge' | 'reject';
export type RawRow = Readonly<Record<string, string>>;

export interface RuleContext {
  row: RawRow;
  clean: Record<string, string>;
  seenIds: Set<string>;
  seenEmails: Set<string>;
  seenPhoneNames: Set<string>;
  seenSourceKeys: Set<string>;
  companyExists: (companyId: string) => boolean;
}

export interface Rule {
  rule_id: string;
  version: number;
  field: string;
  condition: string;
  outcome: Exclude<RowOutcome, 'accept'>;
  code: string;
  reason: string;
  violates: (c: RuleContext) => boolean;
}

export interface Violation {
  rule_id: string;
  version: number;
  field: string;
  code: string;
  reason: string;
}

export interface RowResult {
  source_row: number;
  outcome: RowOutcome;
  violations: Violation[];
}

export interface DatasetSummary {
  total: number;
  outcomes: Record<RowOutcome, number>;
  byRule: Record<string, number>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TS_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FORMULA_PREFIX_REGEX = /^[=+\-@]/;

const PADDED_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'address',
  'lead_status',
  'consent_status',
  'source_system',
  'source_id',
  'golden_id',
] as const;

const leadStatuses = CRM1LeadStatusSchema.options as readonly string[];
const consentStatuses = CRM1ConsentStatusSchema.options as readonly string[];

const v = (c: RuleContext, f: string): string => c.clean[f] ?? '';
const rawV = (c: RuleContext, f: string): string => c.row[f] ?? '';

const validTs = (s: string): boolean =>
  s !== '' && ISO_TS_REGEX.test(s) && !Number.isNaN(Date.parse(s));

const validPhone = (s: string): boolean => {
  if (s === '') return true;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return false;
  return /^[+]?[\d\s().-]+(x|ext\.?)?[\d\s]*$/i.test(s);
};

const hasFormula = (raw: string, isPhone = false): boolean => {
  if (!FORMULA_PREFIX_REGEX.test(raw)) return false;
  if (isPhone && /^\+[\d\s().-]+$/.test(raw)) return false;
  return true;
};

const rule = (
  n: number,
  field: string,
  outcome: Rule['outcome'],
  code: string,
  condition: string,
  reason: string,
  violates: Rule['violates']
): Rule => ({
  rule_id: `CRM1-DQ-${String(n).padStart(3, '0')}`,
  version: 1,
  field,
  condition,
  outcome,
  code,
  reason,
  violates,
});

export const RULES: readonly Rule[] = [
  // Required fields
  rule(1, 'first_name', 'reject', 'REQUIRED_FIELD_MISSING', 'first_name empty after trim', 'first_name is required', (c) => v(c, 'first_name') === ''),
  rule(2, 'last_name', 'reject', 'REQUIRED_FIELD_MISSING', 'last_name empty after trim', 'last_name is required', (c) => v(c, 'last_name') === ''),

  // Identifiers & UUIDs
  rule(3, 'id', 'reject', 'MALFORMED_UUID', 'id present and not a lowercase-normalized UUID', 'id must be a valid UUID', (c) => v(c, 'id') !== '' && !UUID_REGEX.test(v(c, 'id'))),

  // Email format
  rule(4, 'email', 'reject', 'MALFORMED_EMAIL', 'email present and not valid RFC-5322 format', 'email must be valid RFC-5322 format', (c) => v(c, 'email') !== '' && !EMAIL_REGEX.test(v(c, 'email'))),

  // Phone format
  rule(5, 'phone', 'reject', 'MALFORMED_PHONE', 'phone present and has fewer than 7 digits or invalid characters', 'phone must contain at least 7 digits and valid telephone characters', (c) => v(c, 'phone') !== '' && !validPhone(v(c, 'phone'))),

  // Lead status allowlist
  rule(6, 'lead_status', 'reject', 'INVALID_ENUM_VALUE', 'lead_status present and not in allowlist', 'lead_status must be one of: New, Working, Qualified, Closed', (c) => v(c, 'lead_status') !== '' && !leadStatuses.includes(v(c, 'lead_status'))),

  // Company ID UUID format
  rule(7, 'company_id', 'reject', 'MALFORMED_UUID', 'company_id present and not a valid UUID', 'company_id must be a valid UUID', (c) => v(c, 'company_id') !== '' && !UUID_REGEX.test(v(c, 'company_id'))),

  // Referential integrity: company foreign key
  rule(8, 'company_id', 'reject', 'FOREIGN_KEY_MISSING', 'company_id present, valid UUID, but not found in company registry', 'referenced company does not exist in crm1_companies', (c) => v(c, 'company_id') !== '' && UUID_REGEX.test(v(c, 'company_id')) && !hasFormula(rawV(c, 'company_id')) && !c.companyExists(v(c, 'company_id'))),

  // Formula injection prefix
  rule(9, 'formula_prefix', 'reject', 'FORMULA_PREFIX', 'raw text field starts with spreadsheet formula prefix (=, +, -, or @)', 'spreadsheet formula prefixes are not allowed', (c) => {
    return Object.entries(c.row).some(([f, val]) => hasFormula(val, f === 'phone'));
  }),

  // Consent status allowlist
  rule(10, 'consent_status', 'reject', 'INVALID_ENUM_VALUE', 'consent_status present and not in allowlist', 'consent_status must be one of: unknown, granted, withdrawn', (c) => v(c, 'consent_status') !== '' && !consentStatuses.includes(v(c, 'consent_status'))),

  // Maximum field length boundary
  rule(11, 'field_length', 'reject', 'STRING_TOO_LONG', 'field length exceeds 255 character schema constraint', 'field length cannot exceed 255 characters', (c) => {
    return Object.values(c.clean).some((val) => val.length > 255);
  }),

  // Timestamp validations
  rule(12, 'created_at', 'reject', 'INVALID_TIMESTAMP', 'created_at present and not ISO-8601 timestamp', 'created_at must be ISO-8601 (YYYY-MM-DDThh:mm:ss[.fff]Z)', (c) => v(c, 'created_at') !== '' && !validTs(v(c, 'created_at'))),
  rule(13, 'updated_at', 'reject', 'INVALID_TIMESTAMP', 'updated_at present and not ISO-8601 timestamp', 'updated_at must be ISO-8601 (YYYY-MM-DDThh:mm:ss[.fff]Z)', (c) => v(c, 'updated_at') !== '' && !validTs(v(c, 'updated_at'))),
  rule(14, 'updated_at', 'reject', 'CHRONOLOGY_VIOLATION', 'updated_at earlier than created_at', 'updated_at cannot precede created_at', (c) => validTs(v(c, 'created_at')) && validTs(v(c, 'updated_at')) && Date.parse(v(c, 'updated_at')) < Date.parse(v(c, 'created_at'))),

  // Normalization: whitespace padding
  rule(15, 'whitespace', 'normalize', 'WHITESPACE_NORMALIZED', 'leading/trailing whitespace or tabs in text/email/phone/enum fields', 'whitespace trimmed and normalized; raw value preserved', (c) => {
    return PADDED_FIELDS.some((f) => /^\s|\s$|[\t\r\n]/.test(c.row[f] ?? ''));
  }),

  // Duplicate checks (deterministic exact matching)
  rule(16, 'id', 'merge', 'DUPLICATE_EXACT', 'id already seen earlier in the batch', 'exact duplicate id; first row wins, later rows counted as merged, raw rows kept', (c) => v(c, 'id') !== '' && UUID_REGEX.test(v(c, 'id')) && c.seenIds.has(v(c, 'id'))),
  rule(17, 'email', 'merge', 'DUPLICATE_EXACT', 'normalized email already seen earlier in the batch', 'exact duplicate normalized email key; first row wins, later rows counted as merged, raw rows kept', (c) => v(c, 'email') !== '' && EMAIL_REGEX.test(v(c, 'email')) && c.seenEmails.has(normalizeEmail(v(c, 'email')))),
  rule(18, 'phone_name', 'merge', 'DUPLICATE_EXACT', 'normalized compound (phone, name) already seen earlier in the batch', 'exact duplicate compound (phone, name) key; first row wins, later rows counted as merged, raw rows kept', (c) => {
    if (v(c, 'phone') === '' || v(c, 'first_name') === '' || v(c, 'last_name') === '') return false;
    if (!validPhone(v(c, 'phone'))) return false;
    const key = `${normalizePhone(v(c, 'phone'))}#${normalizeName(`${v(c, 'first_name')} ${v(c, 'last_name')}`)}`;
    return c.seenPhoneNames.has(key);
  }),
  rule(19, 'source_key', 'merge', 'DUPLICATE_EXACT', '(source_system, source_id) natural key already seen earlier in the batch', 'exact duplicate source-system and source-id pair; first row wins, later rows counted as merged, raw rows kept', (c) => {
    if (v(c, 'source_system') === '' || v(c, 'source_id') === '') return false;
    const key = `${v(c, 'source_system')}#${v(c, 'source_id')}`;
    return c.seenSourceKeys.has(key);
  }),
];

const PRECEDENCE: Record<RowOutcome, number> = { accept: 0, normalize: 1, merge: 2, reject: 3 };

export function normalizeRow(row: RawRow): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [k, val] of Object.entries(row)) {
    const t = val.trim();
    if (k === 'email') {
      clean[k] = t.toLowerCase();
    } else if (k === 'consent_status' || k === 'unsubscribed') {
      clean[k] = t.toLowerCase();
    } else if (k === 'id' || k === 'company_id') {
      clean[k] = t.toLowerCase();
    } else {
      clean[k] = t;
    }
  }
  return clean;
}

export function evaluateRows(
  rows: readonly RawRow[],
  companyExists: (companyId: string) => boolean = () => true
): RowResult[] {
  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();
  const seenPhoneNames = new Set<string>();
  const seenSourceKeys = new Set<string>();

  return rows.map((row, i) => {
    const clean = normalizeRow(row);
    const ctx: RuleContext = {
      row,
      clean,
      seenIds,
      seenEmails,
      seenPhoneNames,
      seenSourceKeys,
      companyExists,
    };

    const violations: Violation[] = RULES
      .filter((r) => r.violates(ctx))
      .map(({ rule_id, version, field, code, reason }) => ({
        rule_id,
        version,
        field,
        code,
        reason,
      }));

    const outcome = RULES
      .filter((r) => violations.some((x) => x.rule_id === r.rule_id))
      .reduce<RowOutcome>(
        (acc, r) => (PRECEDENCE[r.outcome] > PRECEDENCE[acc] ? r.outcome : acc),
        'accept'
      );

    // Only register identifiers/keys if the record is NOT rejected
    if (outcome !== 'reject') {
      if (clean['id'] && UUID_REGEX.test(clean['id'])) {
        seenIds.add(clean['id']);
      }
      if (clean['email'] && EMAIL_REGEX.test(clean['email'])) {
        seenEmails.add(normalizeEmail(clean['email']));
      }
      if (clean['phone'] && clean['first_name'] && clean['last_name'] && validPhone(clean['phone'])) {
        const key = `${normalizePhone(clean['phone'])}#${normalizeName(`${clean['first_name']} ${clean['last_name']}`)}`;
        seenPhoneNames.add(key);
      }
      if (clean['source_system'] && clean['source_id']) {
        const key = `${clean['source_system']}#${clean['source_id']}`;
        seenSourceKeys.add(key);
      }
    }

    return { source_row: i + 1, outcome, violations };
  });
}

export function summarize(results: readonly RowResult[]): DatasetSummary {
  const outcomes: Record<RowOutcome, number> = { accept: 0, normalize: 0, merge: 0, reject: 0 };
  const byRule: Record<string, number> = Object.fromEntries(RULES.map((r) => [r.rule_id, 0]));

  for (const r of results) {
    outcomes[r.outcome]++;
    for (const x of r.violations) {
      byRule[x.rule_id] = (byRule[x.rule_id] ?? 0) + 1;
    }
  }

  return { total: results.length, outcomes, byRule };
}
