import { normalizeEmail, normalizePhone } from '@cs/core';

export interface AuditEntry {
  source_row: number;
  field_name: string;
  original_value: string;
  cleaned_value: string;
  rule_id: string;
}

export interface RowReject {
  source_row: number;
  field_name: string;
  reason_code: string;
  reason: string;
}

export interface CleanResult {
  rows: Record<string, string>[];
  audit: AuditEntry[];
  rejects: RowReject[];
}

export type DateFormat = 'YYYY-MM-DD' | 'DD-MM-YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY';

export interface CleanOptions {
  dateFormat?: DateFormat;
  phoneCountry?: string;
  disabledRules?: readonly string[];
}

export const CLEANING_RULES_VERSION = 1;
export const REQUIRED_FIELDS = ['batch_id', 'module', 'step'] as const;

const LOWERCASE_FIELDS = ['module', 'step', 'status'];
const DATE_FIELDS = ['started_at', 'completed_at'];
const DATE_PATTERNS: Record<DateFormat, { re: RegExp; order: [number, number, number] }> = {
  'YYYY-MM-DD': { re: /^(\d{4})-(\d{2})-(\d{2})$/, order: [1, 2, 3] },
  'DD-MM-YYYY': { re: /^(\d{2})-(\d{2})-(\d{4})$/, order: [3, 2, 1] },
  'DD/MM/YYYY': { re: /^(\d{2})\/(\d{2})\/(\d{4})$/, order: [3, 2, 1] },
  'MM/DD/YYYY': { re: /^(\d{2})\/(\d{2})\/(\d{4})$/, order: [3, 1, 2] },
};

function toIso(value: string, format: DateFormat): string | null {
  const { re, order } = DATE_PATTERNS[format];
  const m = re.exec(value);
  if (!m) return null;
  const [y, mo, d] = order.map((i) => m[i] ?? '');
  const date = new Date(`${y}-${mo}-${d}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(`${y}-${mo}-${d}`) ? date.toISOString() : null;
}

type Rule = { id: string; apply: (field: string, value: string, o: CleanOptions) => string };

const RULES: Rule[] = [
  { id: 'RL-TEXT-02', apply: (_f, v) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') },
  { id: 'RL-TEXT-01', apply: (_f, v) => v.trim().replace(/[ \t]{2,}/g, ' ') },
  { id: 'RL-ENUM-01', apply: (f, v) => (LOWERCASE_FIELDS.includes(f) ? v.toLowerCase() : v) },
  { id: 'RL-EMAIL-01', apply: (f, v) => (f === 'email' ? normalizeEmail(v) : v) },
  {
    id: 'RL-PHONE-01',
    apply: (f, v, o) => {
      if (f !== 'phone') return v;
      const p = normalizePhone(v);
      return o.phoneCountry && /^\d{10}$/.test(p) ? `${o.phoneCountry}${p}` : p;
    },
  },
  {
    id: 'RL-DATE-01',
    apply: (f, v, o) => (DATE_FIELDS.includes(f) ? (toIso(v, o.dateFormat ?? 'YYYY-MM-DD') ?? v) : v),
  },
];

export function cleanRows(input: readonly Record<string, string>[], options: CleanOptions = {}): CleanResult {
  const active = RULES.filter((r) => !options.disabledRules?.includes(r.id));
  const rows: Record<string, string>[] = [];
  const audit: AuditEntry[] = [];
  const rejects: RowReject[] = [];

  input.forEach((raw, i) => {
    const source_row = i + 1;
    const clean: Record<string, string> = {};
    for (const [field, original] of Object.entries(raw)) {
      let value = original ?? '';
      for (const rule of active) {
        const next = rule.apply(field, value, options);
        if (next !== value) {
          audit.push({ source_row, field_name: field, original_value: value, cleaned_value: next, rule_id: rule.id });
          value = next;
        }
      }
      clean[field] = value;
    }
    const missing = REQUIRED_FIELDS.filter((f) => !clean[f]);
    for (const field_name of missing) {
      rejects.push({ source_row, field_name, reason_code: 'REQUIRED_FIELD_MISSING', reason: `${field_name} is required` });
    }
    if (!missing.length) rows.push(clean);
  });

  return { rows, audit, rejects };
}
