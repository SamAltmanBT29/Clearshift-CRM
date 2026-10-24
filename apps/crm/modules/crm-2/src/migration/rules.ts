import { CRM2_STAGES, type Crm2StageName } from '@clearshift/contracts';

export const RULESET_VERSION = 1;

export type RowOutcome = 'accept' | 'normalize' | 'merge' | 'reject';
export type TerminalOutcome = 'loaded' | 'merged' | 'rejected' | 'skipped';
export type RawRow = Readonly<Record<string, string>>;

export interface RuleContext {
  row: RawRow;
  clean: Record<string, string>;
  seenDealKeys: Set<string>;
  seenQuoteNumbers: Set<string>;
  dealExists: (dealId: string) => boolean;
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
  terminal_outcome: TerminalOutcome;
  violations: Violation[];
}

export interface DatasetSummary {
  total: number;
  outcomes: Record<RowOutcome, number>;
  terminal_outcomes: Record<TerminalOutcome, number>;
  byRule: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Constants & Validation Patterns
// ---------------------------------------------------------------------------
const ALLOWED_ENTITIES = ['deal', 'quote'] as const;
const ALLOWED_STAGES = [...CRM2_STAGES] as readonly string[];
const ALLOWED_CURRENCIES = ['USD', 'EUR', 'GBP'] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PADDED_FIELDS = ['source_system', 'source_id', 'name', 'currency', 'stage_name', 'close_date', 'quote_number', 'deal_id'];

const v = (c: RuleContext, f: string): string => c.clean[f] ?? '';
const isDeal = (c: RuleContext): boolean => v(c, 'entity_type') === 'deal';
const isQuote = (c: RuleContext): boolean => v(c, 'entity_type') === 'quote';

const validDecimal = (val: string): boolean => {
  if (val === '' || val === null || val === undefined) return false;
  const num = Number(val);
  return !Number.isNaN(num) && num >= 0 && /^-?\d+(\.\d+)?$/.test(val);
};

const validDate = (val: string): boolean => {
  if (!ISO_DATE.test(val)) return false;
  const ts = Date.parse(val);
  if (Number.isNaN(ts)) return false;
  const d = new Date(val);
  return d.toISOString().slice(0, 10) === val;
};

const rule = (
  n: number,
  field: string,
  outcome: Rule['outcome'],
  code: string,
  condition: string,
  reason: string,
  violates: Rule['violates'],
): Rule => ({
  rule_id: `CRM2-DQ-${String(n).padStart(3, '0')}`,
  version: 1,
  field,
  condition,
  outcome,
  code,
  reason,
  violates,
});

// ---------------------------------------------------------------------------
// CRM-2 Rules Catalog
// ---------------------------------------------------------------------------
export const RULES: readonly Rule[] = [
  // 1. Mandatory entity_type
  rule(1, 'entity_type', 'reject', 'REQUIRED_FIELD_MISSING', 'entity_type empty or not deal/quote', 'entity_type must be either "deal" or "quote"', (c) => !ALLOWED_ENTITIES.includes(v(c, 'entity_type') as any)),

  // 2. Mandatory source_system & source_id
  rule(2, 'source_system', 'reject', 'REQUIRED_FIELD_MISSING', 'source_system empty after trim', 'source_system is required for provenance tracking', (c) => v(c, 'source_system') === ''),
  rule(3, 'source_id', 'reject', 'REQUIRED_FIELD_MISSING', 'source_id empty after trim', 'source_id is required for source record mapping', (c) => v(c, 'source_id') === ''),

  // 3. Mandatory deal name
  rule(4, 'name', 'reject', 'EMPTY_MANDATORY_FIELD', 'name empty after trim on deal entity', 'Mandatory deal name is required and cannot be blank', (c) => isDeal(c) && v(c, 'name') === ''),

  // 4. Monetary value validation
  rule(5, 'value', 'reject', 'NEGATIVE_VALUE', 'value empty, non-numeric, or negative', 'Deal monetary value must be a non-negative decimal quantity', (c) => !validDecimal(v(c, 'value'))),

  // 5. Currency allowlist validation
  rule(6, 'currency', 'reject', 'INVALID_CURRENCY', 'currency not in ISO 4217 allowlist (USD, EUR, GBP)', 'Currency must be an ISO 4217 three-letter uppercase code', (c) => !ALLOWED_CURRENCIES.includes(v(c, 'currency') as any)),

  // 6. Pipeline stage allowlist validation
  rule(7, 'stage_name', 'reject', 'INVALID_STAGE', 'stage_name on deal entity not in standard allowlist', 'Specified pipeline stage does not exist in standard stage allowlist', (c) => isDeal(c) && !ALLOWED_STAGES.includes(v(c, 'stage_name'))),

  // 7. Close date validation
  rule(8, 'close_date', 'reject', 'INVALID_DATE_FORMAT', 'close_date on deal not valid ISO 8601 YYYY-MM-DD', 'Close date must conform to ISO 8601 format (YYYY-MM-DD)', (c) => isDeal(c) && !validDate(v(c, 'close_date'))),

  // 8. Quote quote_number mandatory
  rule(9, 'quote_number', 'reject', 'EMPTY_MANDATORY_FIELD', 'quote_number empty after trim on quote entity', 'Quote number is required for quote records', (c) => isQuote(c) && v(c, 'quote_number') === ''),

  // 9. Quote parent deal existence
  rule(10, 'deal_id', 'reject', 'PARENT_DEAL_NOT_FOUND', 'parent deal_id missing or not found in target store', 'Referenced parent deal does not exist in target database', (c) => isQuote(c) && (v(c, 'deal_id') === '' || !c.dealExists(v(c, 'deal_id')))),

  // 10. Formula injection security guard
  rule(11, 'name', 'reject', 'FORMULA_PREFIX', 'name starts with spreadsheet formula prefix (=, +, -, @)', 'Spreadsheet formula injection risks are rejected', (c) => /^[=+\-@]/.test(c.row['name'] ?? '')),

  // 11. Normalization: Whitespace trimming
  rule(12, 'name', 'normalize', 'WHITESPACE_NORMALIZED', 'leading/trailing whitespace or tabs in text fields', 'Whitespace trimmed and strings normalized', (c) => PADDED_FIELDS.some((f) => /^\s|\s$|[\t\r\n]/.test(c.row[f] ?? ''))),

  // 12. Normalization: Currency uppercase
  rule(13, 'currency', 'normalize', 'CURRENCY_NORMALIZED', 'currency provided in lowercase or mixed case', 'Currency code normalized to uppercase', (c) => (c.row['currency'] ?? '') !== (c.row['currency'] ?? '').toUpperCase()),

  // 13. Exact duplicate deal candidate key
  rule(14, 'name', 'merge', 'EXACT_DEAL_DUPLICATE', 'deal business key matching another record in batch', 'Exact duplicate deal candidate key detected; classified for merge resolution', (c) => {
    if (!isDeal(c)) return false;
    const nameNorm = v(c, 'name').toLowerCase();
    const stageNorm = v(c, 'stage_name').toLowerCase();
    const contactNorm = v(c, 'contact_id') ? v(c, 'contact_id').toLowerCase() : 'orphan';
    const key = `${nameNorm}#${stageNorm}#${contactNorm}`;
    return c.seenDealKeys.has(key);
  }),

  // 14. Exact duplicate quote number key
  rule(15, 'quote_number', 'merge', 'EXACT_QUOTE_NUMBER_MATCH', 'quote_number matching another quote in batch', 'Exact duplicate quote number detected; classified for merge resolution', (c) => {
    if (!isQuote(c)) return false;
    const qNum = v(c, 'quote_number').toUpperCase();
    return c.seenQuoteNumbers.has(qNum);
  }),
];

const PRECEDENCE: Record<RowOutcome, number> = { accept: 0, normalize: 1, merge: 2, reject: 3 };

export function normalizeRow(row: RawRow): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [k, val] of Object.entries(row)) {
    let t = val.trim();
    if (k === 'currency') t = t.toUpperCase();
    clean[k] = t;
  }
  return clean;
}

export function evaluateRows(
  rows: readonly RawRow[],
  dealExists: (dealId: string) => boolean,
): RowResult[] {
  // Pre-calculate frequencies to detect all duplicate candidate rows (manifest standard)
  const dealKeyCounts = new Map<string, number>();
  const quoteNumberCounts = new Map<string, number>();

  for (const row of rows) {
    const clean = normalizeRow(row);
    if (clean['entity_type'] === 'deal') {
      const nameNorm = clean['name']?.toLowerCase() ?? '';
      const stageNorm = clean['stage_name']?.toLowerCase() ?? '';
      const contactNorm = clean['contact_id'] ? clean['contact_id'].toLowerCase() : 'orphan';
      if (nameNorm && stageNorm) {
        const key = `${nameNorm}#${stageNorm}#${contactNorm}`;
        dealKeyCounts.set(key, (dealKeyCounts.get(key) ?? 0) + 1);
      }
    } else if (clean['entity_type'] === 'quote') {
      const qNum = clean['quote_number']?.toUpperCase() ?? '';
      if (qNum) {
        quoteNumberCounts.set(qNum, (quoteNumberCounts.get(qNum) ?? 0) + 1);
      }
    }
  }

  const seenDealKeys = new Set<string>();
  for (const [key, count] of dealKeyCounts.entries()) {
    if (count > 1) seenDealKeys.add(key);
  }

  const seenQuoteNumbers = new Set<string>();
  for (const [qNum, count] of quoteNumberCounts.entries()) {
    if (count > 1) seenQuoteNumbers.add(qNum);
  }

  return rows.map((row, i) => {
    const clean = normalizeRow(row);
    const ctx: RuleContext = { row, clean, seenDealKeys, seenQuoteNumbers, dealExists };

    const violations: Violation[] = RULES
      .filter((r) => r.violates(ctx))
      .map(({ rule_id, version, field, code, reason }) => ({ rule_id, version, field, code, reason }));

    const outcome = RULES
      .filter((r) => violations.some((x) => x.rule_id === r.rule_id))
      .reduce<RowOutcome>(
        (acc, r) => (PRECEDENCE[r.outcome] > PRECEDENCE[acc] ? r.outcome : acc),
        'accept',
      );

    const terminal_outcome: TerminalOutcome =
      outcome === 'reject' ? 'rejected' : outcome === 'merge' ? 'merged' : 'loaded';

    return { source_row: i + 1, outcome, terminal_outcome, violations };
  });
}

export function summarize(results: readonly RowResult[]): DatasetSummary {
  const outcomes: Record<RowOutcome, number> = { accept: 0, normalize: 0, merge: 0, reject: 0 };
  const terminal_outcomes: Record<TerminalOutcome, number> = { loaded: 0, merged: 0, rejected: 0, skipped: 0 };
  const byRule: Record<string, number> = Object.fromEntries(RULES.map((r) => [r.rule_id, 0]));

  for (const r of results) {
    outcomes[r.outcome]++;
    terminal_outcomes[r.terminal_outcome]++;
    for (const x of r.violations) {
      byRule[x.rule_id] = (byRule[x.rule_id] ?? 0) + 1;
    }
  }

  return { total: results.length, outcomes, terminal_outcomes, byRule };
}
