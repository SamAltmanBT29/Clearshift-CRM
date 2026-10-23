import {
  normalizeEmail,
  normalizePhone,
  normalizeName,
  normalizeTaxNumber,
} from '@cs/core';

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

export type Crm1EntityType = 'contact' | 'company' | 'lead' | 'auto';

export interface CleanOptions {
  dateFormat?: DateFormat | undefined;
  phoneCountry?: string | undefined;
  disabledRules?: readonly string[] | undefined;
  requiredFields?: readonly string[] | undefined;
  entity?: Crm1EntityType | undefined;
}

export const CLEANING_RULES_VERSION = 1;

/**
 * Default entity-specific required fields for CRM-1.
 */
export const CRM1_ENTITY_REQUIRED_FIELDS: Record<'contact' | 'company' | 'lead', readonly string[]> = {
  contact: ['first_name', 'last_name'],
  company: ['name'],
  lead: ['contact_id', 'status'],
};

const LOWERCASE_FIELDS = [
  'module',
  'step',
  'status',
  'consent_status',
  'consentStatus',
];

const DATE_FIELDS = [
  'started_at',
  'completed_at',
  'created_at',
  'createdAt',
  'updated_at',
  'updatedAt',
  'consent_updated_at',
  'consentUpdatedAt',
  'unsubscribed_updated_at',
  'unsubscribedUpdatedAt',
  'dob',
  'closed_at',
];

const NAME_FIELDS = [
  'first_name',
  'firstName',
  'last_name',
  'lastName',
  'full_name',
  'fullName',
  'contact_name',
  'contactName',
];

const EMAIL_FIELDS = [
  'email',
  'contact_email',
  'contactEmail',
];

const PHONE_FIELDS = [
  'phone',
  'mobile',
  'telephone',
];

const TAX_FIELDS = [
  'tax_number',
  'taxNumber',
  'ein',
  'vat_number',
  'vatNumber',
];

const LEAD_STATUS_ALLOWLIST: Record<string, string> = {
  new: 'New',
  working: 'Working',
  qualified: 'Qualified',
  closed: 'Closed',
};

const CONSENT_STATUS_ALLOWLIST = new Set(['unknown', 'granted', 'withdrawn']);

const DATE_PATTERNS: Record<DateFormat, { re: RegExp; order: [number, number, number] }> = {
  'YYYY-MM-DD': { re: /^(\d{4})-(\d{2})-(\d{2})$/, order: [1, 2, 3] },
  'DD-MM-YYYY': { re: /^(\d{2})-(\d{2})-(\d{4})$/, order: [3, 2, 1] },
  'DD/MM/YYYY': { re: /^(\d{2})\/(\d{2})\/(\d{4})$/, order: [3, 2, 1] },
  'MM/DD/YYYY': { re: /^(\d{2})\/(\d{2})\/(\d{4})$/, order: [3, 1, 2] },
};

function toIso(value: string, format: DateFormat): string | null {
  const pattern = DATE_PATTERNS[format];
  if (!pattern) return null;
  const m = pattern.re.exec(value);
  if (!m) return null;
  const [y, mo, d] = pattern.order.map((i) => m[i] ?? '');
  const monthNum = Number(mo);
  const dayNum = Number(d);
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) {
    return null;
  }
  const date = new Date(`${y}-${mo}-${d}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(`${y}-${mo}-${d}`)
    ? date.toISOString()
    : null;
}

/**
 * Proper casing for names (RL-NAME-01) supporting prefixes like McDonald, O'Brien, etc.
 */
const KNOWN_SPECIAL_NAMES: Record<string, string> = {
  obrien: "O'Brien",
  oconnor: "O'Connor",
  oneill: "O'Neill",
  omally: "O'Malley",
  mcdonald: "McDonald",
  mcdonnell: "McDonnell",
  mcgregor: "McGregor",
  mckenzie: "McKenzie",
  macarthur: "MacArthur",
  macintyre: "MacIntyre",
};

function formatProperName(name: string): string {
  if (!name) return name;
  return name
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLowerCase();
      const strippedKey = lower.replace(/['’]/g, '');
      if (KNOWN_SPECIAL_NAMES[strippedKey]) {
        return KNOWN_SPECIAL_NAMES[strippedKey]!;
      }
      if (lower.startsWith("o'") && lower.length > 2) {
        return "O'" + lower.charAt(2).toUpperCase() + lower.slice(3);
      }
      if (lower.startsWith("o’") && lower.length > 2) {
        return "O’" + lower.charAt(2).toUpperCase() + lower.slice(3);
      }
      if (lower.startsWith('mc') && lower.length > 2) {
        return 'Mc' + lower.charAt(2).toUpperCase() + lower.slice(3);
      }
      if (word.includes('-')) {
        return word
          .split('-')
          .map((sub) => (sub.length > 0 ? sub.charAt(0).toUpperCase() + sub.slice(1).toLowerCase() : sub))
          .join('-');
      }
      return word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word;
    })
    .join(' ');
}

type Rule = {
  id: string;
  apply: (field: string, value: string, options: CleanOptions) => string;
};

const RULES: Rule[] = [
  // 1. RL-TEXT-02: Control character stripping
  {
    id: 'RL-TEXT-02',
    apply: (_f, v) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''),
  },
  // 2. RL-TEXT-01: Whitespace trimming and multiple space collapse
  {
    id: 'RL-TEXT-01',
    apply: (_f, v) => v.trim().replace(/[ \t]{2,}/g, ' '),
  },
  // 3. RL-NAME-01: Name normalization and proper casing
  {
    id: 'RL-NAME-01',
    apply: (f, v) => (NAME_FIELDS.includes(f) ? formatProperName(v) : v),
  },
  // 4. RL-ENUM-01: Enum/status lowercasing & canonical allowlist casing
  {
    id: 'RL-ENUM-01',
    apply: (f, v) => {
      const isLeadStatus =
        f === 'lead_status' ||
        f === 'leadStatus' ||
        (f === 'status' && LEAD_STATUS_ALLOWLIST[v.toLowerCase()] !== undefined);
      if (isLeadStatus) {
        return LEAD_STATUS_ALLOWLIST[v.toLowerCase()] ?? v;
      }
      if (LOWERCASE_FIELDS.includes(f)) {
        return v.toLowerCase();
      }
      return v;
    },
  },
  // 5. RL-EMAIL-01: Email normalization (trim & lowercase)
  {
    id: 'RL-EMAIL-01',
    apply: (f, v) => (EMAIL_FIELDS.includes(f) ? normalizeEmail(v) : v),
  },
  // 6. RL-PHONE-01: Phone normalization (+digits and optional country code)
  {
    id: 'RL-PHONE-01',
    apply: (f, v, o) => {
      if (!PHONE_FIELDS.includes(f)) return v;
      const p = normalizePhone(v);
      return o.phoneCountry && /^\d{10}$/.test(p) ? `${o.phoneCountry}${p}` : p;
    },
  },
  // 7. RL-TAX-01: Tax number normalization (uppercase, strip delimiters)
  {
    id: 'RL-TAX-01',
    apply: (f, v) => (TAX_FIELDS.includes(f) ? normalizeTaxNumber(v) : v),
  },
  // 8. RL-DATE-01: Date coercion to ISO format
  {
    id: 'RL-DATE-01',
    apply: (f, v, o) => (DATE_FIELDS.includes(f) ? (toIso(v, o.dateFormat ?? 'YYYY-MM-DD') ?? v) : v),
  },
];

/**
 * Resolves required fields for row evaluation based on explicit options or entity heuristics.
 */
function resolveRequiredFields(raw: Record<string, string>, options: CleanOptions): string[] {
  if (options.requiredFields && options.requiredFields.length > 0) {
    return [...options.requiredFields];
  }

  const entity = options.entity ?? 'auto';

  if (entity === 'contact') {
    return raw['firstName'] !== undefined || raw['lastName'] !== undefined
      ? ['firstName', 'lastName']
      : ['first_name', 'last_name'];
  }
  if (entity === 'company') {
    return ['name'];
  }
  if (entity === 'lead') {
    return raw['contactId'] !== undefined ? ['contactId', 'status'] : ['contact_id', 'status'];
  }

  // Auto-detection heuristics for CRM-1 entities
  if (raw['batch_id'] !== undefined && raw['step'] !== undefined) {
    return ['batch_id', 'module', 'step'];
  }
  if (raw['first_name'] !== undefined || raw['last_name'] !== undefined) {
    return ['first_name', 'last_name'];
  }
  if (raw['firstName'] !== undefined || raw['lastName'] !== undefined) {
    return ['firstName', 'lastName'];
  }
  if (raw['contact_id'] !== undefined || raw['contactId'] !== undefined) {
    return raw['contact_id'] !== undefined ? ['contact_id', 'status'] : ['contactId', 'status'];
  }
  if (raw['name'] !== undefined && (raw['tax_number'] !== undefined || raw['taxNumber'] !== undefined)) {
    return ['name'];
  }

  return [];
}

/**
 * Validates a cleaned row against unrecoverable domain anomalies.
 */
function validateRowAnomalies(
  source_row: number,
  raw: Record<string, string>,
  clean: Record<string, string>,
  requiredFields: string[]
): RowReject[] {
  const rejects: RowReject[] = [];

  // Check required fields
  for (const field_name of requiredFields) {
    const val = clean[field_name];
    if (val === undefined || val === null || val.trim().length === 0) {
      rejects.push({
        source_row,
        field_name,
        reason_code: 'REQUIRED_FIELD_MISSING',
        reason: `${field_name} is required and cannot be empty`,
      });
    }
  }

  // Check formula injection prefix on non-numeric/non-phone fields
  for (const [field, val] of Object.entries(clean)) {
    if (PHONE_FIELDS.includes(field)) continue;
    if (/^[=+\-@]/.test(val) && val.length > 1 && !/^[+-]?\d/.test(val)) {
      rejects.push({
        source_row,
        field_name: field,
        reason_code: 'FORMULA_INJECTION_RISK',
        reason: `Field '${field}' contains unsafe spreadsheet formula prefix character`,
      });
    }
  }

  // Check email syntax validity if email is present
  for (const field of EMAIL_FIELDS) {
    const emailVal = clean[field];
    if (emailVal && emailVal.length > 0) {
      const parts = emailVal.split('@');
      if (parts.length !== 2 || !parts[0] || !parts[1] || !parts[1].includes('.')) {
        rejects.push({
          source_row,
          field_name: field,
          reason_code: 'INVALID_EMAIL',
          reason: `Email '${emailVal}' is not a valid format`,
        });
      }
    }
  }

  // Check phone syntax if raw phone contains illegal alphabet characters
  for (const field of PHONE_FIELDS) {
    const rawPhone = raw[field];
    if (rawPhone && /[A-Za-z]/.test(rawPhone)) {
      rejects.push({
        source_row,
        field_name: field,
        reason_code: 'INVALID_PHONE',
        reason: `Phone number '${rawPhone}' contains invalid alphabetic characters`,
      });
    }
  }

  // Check lead status allowlist if present
  const leadStatus = clean['lead_status'] ?? clean['leadStatus'] ?? clean['status'];
  if (leadStatus && (clean['contact_id'] !== undefined || clean['contactId'] !== undefined)) {
    if (!['New', 'Working', 'Qualified', 'Closed'].includes(leadStatus)) {
      rejects.push({
        source_row,
        field_name: clean['lead_status'] !== undefined ? 'lead_status' : clean['leadStatus'] !== undefined ? 'leadStatus' : 'status',
        reason_code: 'INVALID_LEAD_STATUS',
        reason: `Lead status '${leadStatus}' is not in allowed transitions (New, Working, Qualified, Closed)`,
      });
    }
  }

  return rejects;
}

/**
 * Clean source records across all CRM-1 entities, recording field-level audits
 * and structured row rejections without mutating raw inputs.
 */
export function cleanRows(
  input: readonly Record<string, string>[],
  options: CleanOptions = {}
): CleanResult {
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

    const requiredFields = resolveRequiredFields(raw, options);
    const rowRejects = validateRowAnomalies(source_row, raw, clean, requiredFields);

    if (rowRejects.length > 0) {
      rejects.push(...rowRejects);
    } else {
      rows.push(clean);
    }
  });

  return { rows, audit, rejects };
}

/**
 * Specialized cleaner for Contacts.
 */
export function cleanContactRows(
  input: readonly Record<string, string>[],
  options: Omit<CleanOptions, 'entity'> = {}
): CleanResult {
  return cleanRows(input, { ...options, entity: 'contact' });
}

/**
 * Specialized cleaner for Companies.
 */
export function cleanCompanyRows(
  input: readonly Record<string, string>[],
  options: Omit<CleanOptions, 'entity'> = {}
): CleanResult {
  return cleanRows(input, { ...options, entity: 'company' });
}

/**
 * Specialized cleaner for Leads.
 */
export function cleanLeadRows(
  input: readonly Record<string, string>[],
  options: Omit<CleanOptions, 'entity'> = {}
): CleanResult {
  return cleanRows(input, { ...options, entity: 'lead' });
}

/**
 * Object-oriented cleaner adapter for CRM-1 pipelines.
 */
export class Crm1Cleaner {
  constructor(private readonly defaultOptions: CleanOptions = {}) {}

  public clean(input: readonly Record<string, string>[], overrides?: CleanOptions): CleanResult {
    return cleanRows(input, { ...this.defaultOptions, ...overrides });
  }

  public cleanContacts(input: readonly Record<string, string>[], overrides?: CleanOptions): CleanResult {
    return cleanContactRows(input, { ...this.defaultOptions, ...overrides });
  }

  public cleanCompanies(input: readonly Record<string, string>[], overrides?: CleanOptions): CleanResult {
    return cleanCompanyRows(input, { ...this.defaultOptions, ...overrides });
  }

  public cleanLeads(input: readonly Record<string, string>[], overrides?: CleanOptions): CleanResult {
    return cleanLeadRows(input, { ...this.defaultOptions, ...overrides });
  }
}
