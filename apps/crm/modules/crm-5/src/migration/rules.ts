import { CrmModuleSchema, MigrationRunStatusSchema, MigrationStepSchema } from '@clearshift/contracts';

export const RULESET_VERSION = 1;

export type RowOutcome = 'accept' | 'normalize' | 'merge' | 'reject';
export type RawRow = Readonly<Record<string, string>>;

export interface RuleContext {
  row: RawRow;
  clean: Record<string, string>;
  seenIds: Set<string>;
  seenKeys: Set<string>;
  batchExists: (batchId: string) => boolean;
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const INT = /^\d+$/;
const INT32_MAX = 2147483647;
const PADDED_FIELDS = ['batch_id', 'module', 'step', 'status'];
const ENUM_FIELDS = ['module', 'step', 'status'];

const modules = CrmModuleSchema.options as readonly string[];
const steps = MigrationStepSchema.options as readonly string[];
const statuses = MigrationRunStatusSchema.options as readonly string[];

const v = (c: RuleContext, f: string): string => c.clean[f] ?? '';
const validTs = (s: string): boolean => ISO_TS.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s.slice(0, 10);
const validInt = (s: string): boolean => s === '' || (INT.test(s) && Number(s) <= INT32_MAX);
const countsValid = (c: RuleContext): boolean => ['records_in', 'records_out', 'records_rejected'].every((f) => validInt(v(c, f)));
const tsValid = (c: RuleContext): boolean => (v(c, 'started_at') === '' || validTs(v(c, 'started_at'))) && (v(c, 'completed_at') === '' || validTs(v(c, 'completed_at')));
const batchSafe = (c: RuleContext): boolean => v(c, 'batch_id') !== '' && !/^[=+\-@]/.test(c.row['batch_id'] ?? '');

function json(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

const rule = (
  n: number,
  field: string,
  outcome: Rule['outcome'],
  code: string,
  condition: string,
  reason: string,
  violates: Rule['violates'],
): Rule => ({ rule_id: `CRM5-DQ-${String(n).padStart(3, '0')}`, version: 1, field, condition, outcome, code, reason, violates });

export const RULES: readonly Rule[] = [
  rule(1, 'batch_id', 'reject', 'REQUIRED_FIELD_MISSING', 'batch_id empty after trim', 'batch_id is required', (c) => v(c, 'batch_id') === ''),
  rule(2, 'module', 'reject', 'REQUIRED_FIELD_MISSING', 'module empty after trim', 'module is required', (c) => v(c, 'module') === ''),
  rule(3, 'step', 'reject', 'REQUIRED_FIELD_MISSING', 'step empty after trim', 'step is required', (c) => v(c, 'step') === ''),
  rule(4, 'id', 'reject', 'MALFORMED_UUID', 'id present and not a lowercase-normalized UUID', 'id must be a valid UUID', (c) => v(c, 'id') !== '' && !UUID.test(v(c, 'id'))),
  rule(5, 'status', 'reject', 'INVALID_ENUM_VALUE', 'status present and not in allowlist', 'status must be one of the run status allowlist', (c) => v(c, 'status') !== '' && !statuses.includes(v(c, 'status'))),
  rule(6, 'module', 'reject', 'FOREIGN_KEY_MISSING', 'module present and not a registered CRM module', 'module is not registered in the ClearShift module registry', (c) => v(c, 'module') !== '' && !modules.includes(v(c, 'module'))),
  rule(7, 'step', 'reject', 'INVALID_ENUM_VALUE', 'step present and not in allowlist', 'step must be one of the migration step allowlist', (c) => v(c, 'step') !== '' && !steps.includes(v(c, 'step'))),
  rule(8, 'batch_id', 'reject', 'FORMULA_PREFIX', 'raw batch_id starts with = + - or @', 'spreadsheet formula prefixes are not allowed', (c) => /^[=+\-@]/.test(c.row['batch_id'] ?? '')),
  rule(9, 'batch_id', 'reject', 'FOREIGN_KEY_MISSING', 'safe batch_id not found in Kit batch ledger', 'referenced batch does not exist in the Kit batch ledger', (c) => batchSafe(c) && !c.batchExists(v(c, 'batch_id'))),
  rule(10, 'records_in', 'reject', 'OUT_OF_BOUNDS', 'records_in/out/rejected not an integer in 0..2147483647', 'record counts must be non-negative 32-bit integers', (c) => !countsValid(c)),
  rule(11, 'records_out', 'reject', 'COUNT_INVARIANT_VIOLATION', 'records_out + records_rejected > records_in', 'out plus rejected cannot exceed in', (c) => countsValid(c) && Number(v(c, 'records_out') || 0) + Number(v(c, 'records_rejected') || 0) > Number(v(c, 'records_in') || 0)),
  rule(12, 'started_at', 'reject', 'INVALID_TIMESTAMP', 'started_at present and not ISO-8601 with time and offset', 'started_at must be ISO-8601 (YYYY-MM-DDThh:mm:ss[.fff]Z)', (c) => v(c, 'started_at') !== '' && !validTs(v(c, 'started_at'))),
  rule(13, 'completed_at', 'reject', 'INVALID_TIMESTAMP', 'completed_at present and not ISO-8601 with time and offset', 'completed_at must be ISO-8601 (YYYY-MM-DDThh:mm:ss[.fff]Z)', (c) => v(c, 'completed_at') !== '' && !validTs(v(c, 'completed_at'))),
  rule(14, 'completed_at', 'reject', 'CHRONOLOGY_VIOLATION', 'completed_at earlier than started_at', 'completed_at cannot precede started_at', (c) => tsValid(c) && v(c, 'started_at') !== '' && v(c, 'completed_at') !== '' && Date.parse(v(c, 'completed_at')) < Date.parse(v(c, 'started_at'))),
  rule(15, 'metadata', 'reject', 'MALFORMED_JSON', 'metadata present and not valid JSON', 'metadata must be valid JSON', (c) => v(c, 'metadata') !== '' && !json(v(c, 'metadata'))),
  rule(16, 'batch_id', 'normalize', 'WHITESPACE_NORMALIZED', 'leading/trailing whitespace or embedded tabs in batch_id, module, step or status', 'whitespace trimmed, embedded batch_id whitespace replaced with "-", enum fields lowercased; raw value preserved', (c) => PADDED_FIELDS.some((f) => /^\s|\s$|[\t\r\n]/.test(c.row[f] ?? ''))),
  rule(17, 'id', 'merge', 'DUPLICATE_EXACT', 'id already seen earlier in the batch', 'exact duplicate id; first row wins, later rows counted as merged, raw rows kept', (c) => v(c, 'id') !== '' && UUID.test(v(c, 'id')) && c.seenIds.has(v(c, 'id'))),
  rule(18, 'batch_id', 'merge', 'DUPLICATE_EXACT', '(batch_id, step) already seen earlier in the batch', 'exact duplicate natural key; first row wins, later rows counted as merged, raw rows kept', (c) => v(c, 'batch_id') !== '' && v(c, 'step') !== '' && c.seenKeys.has(`${v(c, 'batch_id')}\u0000${v(c, 'step')}`)),
];

const PRECEDENCE: Record<RowOutcome, number> = { accept: 0, normalize: 1, merge: 2, reject: 3 };

function normalizeRow(row: RawRow): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [k, val] of Object.entries(row)) {
    const t = val.trim();
    clean[k] = ENUM_FIELDS.includes(k) || k === 'id' ? t.toLowerCase() : k === 'batch_id' ? t.replace(/\s+/g, '-') : t;
  }
  return clean;
}

export function evaluateRows(rows: readonly RawRow[], batchExists: (batchId: string) => boolean): RowResult[] {
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  return rows.map((row, i) => {
    const clean = normalizeRow(row);
    const ctx: RuleContext = { row, clean, seenIds, seenKeys, batchExists };
    const violations: Violation[] = RULES.filter((r) => r.violates(ctx)).map(({ rule_id, version, field, code, reason }) => ({ rule_id, version, field, code, reason }));
    if (clean['id'] && UUID.test(clean['id'])) seenIds.add(clean['id']);
    if (clean['batch_id'] && clean['step']) seenKeys.add(`${clean['batch_id']}\u0000${clean['step']}`);
    const outcome = RULES.filter((r) => violations.some((x) => x.rule_id === r.rule_id)).reduce<RowOutcome>(
      (acc, r) => (PRECEDENCE[r.outcome] > PRECEDENCE[acc] ? r.outcome : acc),
      'accept',
    );
    return { source_row: i + 1, outcome, violations };
  });
}

export function summarize(results: readonly RowResult[]): DatasetSummary {
  const outcomes: Record<RowOutcome, number> = { accept: 0, normalize: 0, merge: 0, reject: 0 };
  const byRule: Record<string, number> = Object.fromEntries(RULES.map((r) => [r.rule_id, 0]));
  for (const r of results) {
    outcomes[r.outcome]++;
    for (const x of r.violations) byRule[x.rule_id] = (byRule[x.rule_id] ?? 0) + 1;
  }
  return { total: results.length, outcomes, byRule };
}
