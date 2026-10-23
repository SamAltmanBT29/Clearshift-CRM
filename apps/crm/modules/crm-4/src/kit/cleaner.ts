import {
  normalizeEmail,
  normalizePhone,
  RlName01Rule,
} from '@cs/core';
import {
  CRM4_MEMBER_STATUSES,
  CRM4_CONSENT_STATUSES,
  type CRM4MemberStatus,
} from '@clearshift/contracts';

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

export interface CleanSummary {
  totalInputRows: number;
  cleanedRowCount: number;
  rejectedRowCount: number;
  totalModifications: number;
}

export interface CleanResult {
  rows: Record<string, string>[];
  audit: AuditEntry[];
  rejects: RowReject[];
  summary: CleanSummary;
}

export type DateFormat =
  | 'YYYY-MM-DD'
  | 'DD-MM-YYYY'
  | 'DD/MM/YYYY'
  | 'MM/DD/YYYY'
  | 'YYYY.MM.DD'
  | 'YYYY/MM/DD'
  | 'auto';

export type Crm4EntityType = 'list' | 'campaign' | 'member' | 'consent' | 'auto';

export interface CleanOptions {
  dateFormat?: DateFormat | undefined;
  phoneCountry?: string | undefined;
  disabledRules?: readonly string[] | undefined;
  requiredFields?: readonly string[] | undefined;
  entity?: Crm4EntityType | undefined;
  neutralizeFormulaPrefix?: boolean | undefined;
}

export const CLEANING_RULES_VERSION = 1;

/**
 * Default entity-specific required fields for CRM-4.
 */
export const CRM4_ENTITY_REQUIRED_FIELDS: Record<'list' | 'campaign' | 'member' | 'consent', readonly string[]> = {
  list: ['name'],
  campaign: ['name', 'campaign_date', 'list_id'],
  member: ['campaign_id', 'contact_id', 'member_status'],
  consent: ['contact_id', 'consent_status', 'consent_source'],
};

const LOWERCASE_FIELDS = [
  'member_status',
  'consent_status',
  'prior_consent_status',
  'unsubscribed',
];

const DATE_FIELDS = [
  'campaign_date',
  'date',
  'started_at',
  'completed_at',
  'created_at',
  'updated_at',
];

const PERSON_NAME_FIELDS = [
  'first_name',
  'last_name',
  'full_name',
  'contact_name',
];

const EMAIL_FIELDS = [
  'email',
  'contact_email',
];

const PHONE_FIELDS = [
  'phone',
  'mobile',
  'telephone',
];

const MONTH_NAMES = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
];

const nameCleanerInstance = new RlName01Rule();

/**
 * Coerces various date representations into canonical ISO-8601 (YYYY-MM-DD).
 */
function toCanonicalIsoDate(value: string, preferredFormat: DateFormat = 'auto'): string | null {
  const v = value.trim();
  if (!v) return null;

  // 1. Standard ISO: YYYY-MM-DD
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (isoMatch && isoMatch[1] && isoMatch[2] && isoMatch[3]) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() + 1 === m &&
      date.getUTCDate() === d
    ) {
      return v;
    }
  }

  // 2. Slash format: DD/MM/YYYY or MM/DD/YYYY
  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (slashMatch && slashMatch[1] && slashMatch[2] && slashMatch[3]) {
    const p1 = parseInt(slashMatch[1], 10);
    const p2 = parseInt(slashMatch[2], 10);
    const y = parseInt(slashMatch[3], 10);

    let d = p1;
    let m = p2;
    if (preferredFormat === 'MM/DD/YYYY' || (p1 <= 12 && p2 > 12)) {
      m = p1;
      d = p2;
    }
    const date = new Date(Date.UTC(y, m - 1, d));
    if (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() + 1 === m &&
      date.getUTCDate() === d
    ) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 3. Dot format: YYYY.MM.DD
  const dotMatch = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(v);
  if (dotMatch && dotMatch[1] && dotMatch[2] && dotMatch[3]) {
    const y = parseInt(dotMatch[1], 10);
    const m = parseInt(dotMatch[2], 10);
    const d = parseInt(dotMatch[3], 10);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() + 1 === m &&
      date.getUTCDate() === d
    ) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 4. Dash format with year at end: DD-MM-YYYY or MM-DD-YYYY
  const dashMatch = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(v);
  if (dashMatch && dashMatch[1] && dashMatch[2] && dashMatch[3]) {
    const p1 = parseInt(dashMatch[1], 10);
    const p2 = parseInt(dashMatch[2], 10);
    const y = parseInt(dashMatch[3], 10);

    let d = p1;
    let m = p2;
    if (preferredFormat === 'MM/DD/YYYY' || (p1 <= 12 && p2 > 12)) {
      m = p1;
      d = p2;
    }
    const date = new Date(Date.UTC(y, m - 1, d));
    if (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() + 1 === m &&
      date.getUTCDate() === d
    ) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 5. Slash format with year at start: YYYY/MM/DD
  const yearSlashMatch = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(v);
  if (yearSlashMatch && yearSlashMatch[1] && yearSlashMatch[2] && yearSlashMatch[3]) {
    const y = parseInt(yearSlashMatch[1], 10);
    const m = parseInt(yearSlashMatch[2], 10);
    const d = parseInt(yearSlashMatch[3], 10);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() + 1 === m &&
      date.getUTCDate() === d
    ) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 6. English text date: "November 15 2026" or "15 November 2026"
  const textDateMatch = /^([A-Za-z]+)\s+(\d{1,2})[,\s]+(\d{4})$/.exec(v);
  if (textDateMatch && textDateMatch[1] && textDateMatch[2] && textDateMatch[3]) {
    const monthName = textDateMatch[1].toLowerCase().slice(0, 3);
    const mIdx = MONTH_NAMES.indexOf(monthName);
    if (mIdx >= 0) {
      const d = parseInt(textDateMatch[2], 10);
      const y = parseInt(textDateMatch[3], 10);
      const m = mIdx + 1;
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  const textDateMatchDayFirst = /^(\d{1,2})\s+([A-Za-z]+)[,\s]+(\d{4})$/.exec(v);
  if (textDateMatchDayFirst && textDateMatchDayFirst[1] && textDateMatchDayFirst[2] && textDateMatchDayFirst[3]) {
    const monthName = textDateMatchDayFirst[2].toLowerCase().slice(0, 3);
    const mIdx = MONTH_NAMES.indexOf(monthName);
    if (mIdx >= 0) {
      const d = parseInt(textDateMatchDayFirst[1], 10);
      const y = parseInt(textDateMatchDayFirst[3], 10);
      const m = mIdx + 1;
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return null;
}

type CleaningRule = {
  id: string;
  name: string;
  apply: (field: string, value: string, options: CleanOptions, sourceRow: number) => string;
};

const CLEANING_RULES: CleaningRule[] = [
  // 1. Control character stripping (RL-TEXT-02)
  {
    id: 'RL-TEXT-02',
    name: 'Control Character Removal',
    apply: (_f, v) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''),
  },
  // 2. Whitespace trimming & multi-space collapse (RL-TEXT-01)
  {
    id: 'RL-TEXT-01',
    name: 'Whitespace Normalization',
    apply: (_f, v) => v.trim().replace(/[ \t]{2,}/g, ' '),
  },
  // 3. Person name proper casing (RL-NAME-01)
  {
    id: 'RL-NAME-01',
    name: 'Proper Name Casing',
    apply: (f, v, _o, sourceRow) => {
      if (!PERSON_NAME_FIELDS.includes(f)) return v;
      if (v.trim() === '') return v;
      const res = nameCleanerInstance.apply(v, {
        batchId: 'crm4-clean',
        sourceRow,
        fieldName: f,
        isRequired: false,
      });
      return typeof res.newValue === 'string' ? res.newValue : v;
    },
  },
  // 4. Email normalization (RL-EMAIL-01)
  {
    id: 'RL-EMAIL-01',
    name: 'Email Normalization',
    apply: (f, v) => (EMAIL_FIELDS.includes(f) && v.trim() !== '' ? normalizeEmail(v) : v),
  },
  // 5. Phone normalization (RL-PHONE-01)
  {
    id: 'RL-PHONE-01',
    name: 'Phone Normalization',
    apply: (f, v, o) => {
      if (!PHONE_FIELDS.includes(f) || v.trim() === '') return v;
      const p = normalizePhone(v);
      return o.phoneCountry && /^\d{10}$/.test(p) ? `${o.phoneCountry}${p}` : p;
    },
  },
  // 6. Date coercion to ISO-8601 (RL-DATE-01)
  {
    id: 'RL-DATE-01',
    name: 'Date Coercion',
    apply: (f, v, o) => {
      if (!DATE_FIELDS.includes(f) || v.trim() === '') return v;
      const coerced = toCanonicalIsoDate(v, o.dateFormat);
      return coerced ?? v;
    },
  },
  // 7. Enum & status normalization (RL-ENUM-01)
  {
    id: 'RL-ENUM-01',
    name: 'Status & Enum Alignment',
    apply: (f, v) => {
      if (!LOWERCASE_FIELDS.includes(f) || v.trim() === '') return v;
      return v.toLowerCase().trim();
    },
  },
  // 8. Formula injection prefix neutralization (RL-FORMULA-01)
  {
    id: 'RL-FORMULA-01',
    name: 'Formula Injection Neutralization',
    apply: (f, v, o) => {
      if (!o.neutralizeFormulaPrefix) return v;
      if (PHONE_FIELDS.includes(f)) return v; // Leading '+' is valid on phone
      if (/^[=+\-@]/.test(v)) {
        return `'${v}`;
      }
      return v;
    },
  },
];

/**
 * Determines the target CRM-4 entity type from row payload or declared options.
 */
function resolveEntityType(row: Record<string, string>, declared?: Crm4EntityType): 'list' | 'campaign' | 'member' | 'consent' {
  if (declared && declared !== 'auto') {
    return declared;
  }
  const typeField = (row['entity_type'] || '').trim().toLowerCase();
  if (typeField === 'list' || typeField === 'campaign' || typeField === 'member' || typeField === 'consent') {
    return typeField;
  }
  if (row['campaign_date'] || row['list_id']) return 'campaign';
  if (row['member_status'] || row['campaign_id']) return 'member';
  if (row['consent_status'] || row['consent_source'] || row['prior_consent_status']) return 'consent';
  return 'list';
}

/**
 * Cleans a batch of CRM-4 marketing rows, executing active cleaning rules,
 * emitting field-level audit entries, and evaluating structured row rejections.
 */
export function cleanRows(
  input: readonly Record<string, string>[],
  options: CleanOptions = {}
): CleanResult {
  const activeRules = CLEANING_RULES.filter((r) => !options.disabledRules?.includes(r.id));
  const cleanedRows: Record<string, string>[] = [];
  const audit: AuditEntry[] = [];
  const rejects: RowReject[] = [];

  input.forEach((raw, i) => {
    const source_row = i + 1;
    const clean: Record<string, string> = {};
    let rowRejected = false;

    // 1. Execute active cleaning rules per field
    for (const [field, original] of Object.entries(raw)) {
      let value = original ?? '';
      for (const rule of activeRules) {
        const next = rule.apply(field, value, options, source_row);
        if (next !== value) {
          audit.push({
            source_row,
            field_name: field,
            original_value: value,
            cleaned_value: next,
            rule_id: rule.id,
          });
          value = next;
        }
      }
      clean[field] = value;
    }

    // 2. Identify entity type and applicable required fields
    const entityType = resolveEntityType(clean, options.entity);
    const requiredFields = options.requiredFields && options.requiredFields.length > 0
      ? options.requiredFields
      : CRM4_ENTITY_REQUIRED_FIELDS[entityType];

    // 3. Evaluate Unrecoverable Rejection 1: REQUIRED_FIELD_MISSING
    for (const field of requiredFields) {
      const val = clean[field];
      if (val === undefined || val === null || val.trim() === '') {
        rejects.push({
          source_row,
          field_name: field,
          reason_code: 'REQUIRED_FIELD_MISSING',
          reason: `Required field '${field}' is missing or empty for entity '${entityType}'`,
        });
        rowRejected = true;
      }
    }

    // 4. Evaluate Unrecoverable Rejection 2: INVALID_MEMBER_STATUS
    if (entityType === 'member') {
      const status = (clean['member_status'] || clean['status'] || '').trim().toLowerCase();
      if (status !== '' && !CRM4_MEMBER_STATUSES.includes(status as CRM4MemberStatus)) {
        rejects.push({
          source_row,
          field_name: 'member_status',
          reason_code: 'INVALID_MEMBER_STATUS',
          reason: `Member status '${status}' is not in allowed allowlist: ${CRM4_MEMBER_STATUSES.join(', ')}`,
        });
        rowRejected = true;
      }
    }

    // 5. Evaluate Unrecoverable Rejection 3: MONOTONIC_OPT_OUT_VIOLATION (BR-CRM4-01)
    if (entityType === 'consent') {
      const prior = (clean['prior_consent_status'] || '').trim().toLowerCase();
      const current = (clean['consent_status'] || clean['status'] || '').trim().toLowerCase();
      if (prior === 'unsubscribed' && current === 'subscribed') {
        rejects.push({
          source_row,
          field_name: 'consent_status',
          reason_code: 'MONOTONIC_OPT_OUT_VIOLATION',
          reason: 'Domain rule violation (BR-CRM4-01): Opt-out is strictly monotonic. Once unsubscribed, re-subscription via import is prohibited.',
        });
        rowRejected = true;
      }
    }

    // 6. Evaluate Unrecoverable Rejection 4: INVALID_DATE_FORMAT
    if (entityType === 'campaign') {
      const dateVal = (clean['campaign_date'] || clean['date'] || '').trim();
      if (dateVal !== '' && !toCanonicalIsoDate(dateVal, options.dateFormat)) {
        rejects.push({
          source_row,
          field_name: 'campaign_date',
          reason_code: 'INVALID_DATE_FORMAT',
          reason: `Campaign date '${dateVal}' cannot be parsed into canonical YYYY-MM-DD date format`,
        });
        rowRejected = true;
      }
    }

    // 7. Evaluate Security Rejection 5: FORMULA_INJECTION_RISK (Command Injection)
    const nameVal = (clean['name'] || '').trim();
    if (nameVal.startsWith('=cmd|') || nameVal.startsWith('=HYPERLINK(')) {
      rejects.push({
        source_row,
        field_name: 'name',
        reason_code: 'FORMULA_INJECTION_RISK',
        reason: `Malicious spreadsheet calculation payload detected in field 'name'`,
      });
      rowRejected = true;
    }

    // Row terminal state accounting: row is either accepted into cleanedRows or rejected
    if (!rowRejected) {
      cleanedRows.push(clean);
    }
  });

  return {
    rows: cleanedRows,
    audit,
    rejects,
    summary: {
      totalInputRows: input.length,
      cleanedRowCount: cleanedRows.length,
      rejectedRowCount: rejects.length,
      totalModifications: audit.length,
    },
  };
}

/**
 * Entity-specific convenience cleaners for CRM-4 Marketing entities.
 */
export const cleanListRows = (
  input: readonly Record<string, string>[],
  options: CleanOptions = {}
): CleanResult => cleanRows(input, { ...options, entity: 'list' });

export const cleanCampaignRows = (
  input: readonly Record<string, string>[],
  options: CleanOptions = {}
): CleanResult => cleanRows(input, { ...options, entity: 'campaign' });

export const cleanMemberRows = (
  input: readonly Record<string, string>[],
  options: CleanOptions = {}
): CleanResult => cleanRows(input, { ...options, entity: 'member' });

export const cleanConsentRows = (
  input: readonly Record<string, string>[],
  options: CleanOptions = {}
): CleanResult => cleanRows(input, { ...options, entity: 'consent' });
