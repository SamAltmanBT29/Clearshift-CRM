import { createHash } from 'node:crypto';
import { AppError } from '@cs/kernel';
import {
  normalizeEmail,
  normalizePhone,
  normalizeName,
  normalizeTaxNumber,
} from '@cs/core';

export type FieldType =
  | 'string'
  | 'uuid'
  | 'integer'
  | 'numeric'
  | 'date'
  | 'boolean'
  | 'email'
  | 'phone'
  | 'json';

export interface FieldMapping {
  readonly source: string;
  readonly target: string;
  readonly type: FieldType;
  readonly required?: boolean | undefined;
  readonly enumName?: keyof typeof ENUMS | undefined;
  readonly defaultValue?: unknown | undefined;
  readonly omitWhenBlank?: boolean | undefined;
}

export type Crm1TargetEntity = 'crm1_contacts' | 'crm1_companies' | 'crm1_leads';

export interface MappingTemplate {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly entity: Crm1TargetEntity;
  readonly fields: readonly FieldMapping[];
}

export interface MappingError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export type MappingResult =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly errors: readonly MappingError[] };

const INT32_MAX = 2147483647;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TS_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * CRM-1 Canonical Enums and Synonym Translation Dictionaries
 * Aligned with CRM SDS allowlist and schema check constraints.
 */
export const ENUMS = {
  lead_status: {
    allowlist: ['New', 'Working', 'Qualified', 'Closed'] as const,
    translations: {
      new: 'New',
      open: 'New',
      created: 'New',
      incoming: 'New',
      uncontacted: 'New',
      prospect: 'New',
      working: 'Working',
      in_progress: 'Working',
      'in-progress': 'Working',
      contacted: 'Working',
      active: 'Working',
      engaged: 'Working',
      attempted: 'Working',
      qualified: 'Qualified',
      qualify: 'Qualified',
      approved: 'Qualified',
      converted: 'Qualified',
      sales_qualified: 'Qualified',
      marketing_qualified: 'Qualified',
      sql: 'Qualified',
      mql: 'Qualified',
      closed: 'Closed',
      won: 'Closed',
      lost: 'Closed',
      dead: 'Closed',
      disqualified: 'Closed',
      unqualified: 'Closed',
      archive: 'Closed',
      archived: 'Closed',
    } as Record<string, 'New' | 'Working' | 'Qualified' | 'Closed'>,
  },
  consent_status: {
    allowlist: ['unknown', 'granted', 'withdrawn'] as const,
    translations: {
      unknown: 'unknown',
      pending: 'unknown',
      none: 'unknown',
      null: 'unknown',
      unspecified: 'unknown',
      not_set: 'unknown',
      empty: 'unknown',
      granted: 'granted',
      yes: 'granted',
      true: 'granted',
      '1': 'granted',
      opt_in: 'granted',
      'opt-in': 'granted',
      optin: 'granted',
      subscribed: 'granted',
      consented: 'granted',
      agreed: 'granted',
      withdrawn: 'withdrawn',
      no: 'withdrawn',
      false: 'withdrawn',
      '0': 'withdrawn',
      opt_out: 'withdrawn',
      'opt-out': 'withdrawn',
      optout: 'withdrawn',
      unsubscribed: 'withdrawn',
      revoked: 'withdrawn',
      rejected: 'withdrawn',
    } as Record<string, 'unknown' | 'granted' | 'withdrawn'>,
  },
  boolean: {
    allowlist: ['true', 'false'] as const,
    translations: {
      true: 'true',
      yes: 'true',
      '1': 'true',
      t: 'true',
      y: 'true',
      false: 'false',
      no: 'false',
      '0': 'false',
      f: 'false',
      n: 'false',
    } as Record<string, 'true' | 'false'>,
  },
} as const;

export type LeadStatus = (typeof ENUMS.lead_status.allowlist)[number];
export type ConsentStatus = (typeof ENUMS.consent_status.allowlist)[number];

// ---------------------------------------------------------------------------
// CRM-1 Versioned Mapping Templates
// ---------------------------------------------------------------------------

export const CRM1_CONTACTS_CANONICAL_V1: MappingTemplate = {
  id: 'crm1-contacts-canonical',
  name: 'CRM-1 Contacts Canonical',
  version: 1,
  entity: 'crm1_contacts',
  fields: [
    { source: 'id', target: 'id', type: 'uuid' },
    { source: 'first_name', target: 'firstName', type: 'string', required: true },
    { source: 'last_name', target: 'lastName', type: 'string', required: true },
    { source: 'email', target: 'email', type: 'email' },
    { source: 'phone', target: 'phone', type: 'phone' },
    { source: 'address', target: 'address', type: 'string' },
    { source: 'company_id', target: 'companyId', type: 'uuid' },
    { source: 'lead_status', target: 'leadStatus', type: 'string', enumName: 'lead_status' },
    { source: 'golden_id', target: 'goldenId', type: 'string' },
    { source: 'source_system', target: 'sourceSystem', type: 'string' },
    { source: 'source_id', target: 'sourceId', type: 'string' },
    { source: 'consent_status', target: 'consentStatus', type: 'string', enumName: 'consent_status', defaultValue: 'unknown' },
    { source: 'consent_updated_at', target: 'consentUpdatedAt', type: 'date' },
    { source: 'unsubscribed', target: 'unsubscribed', type: 'boolean', defaultValue: false },
    { source: 'unsubscribed_updated_at', target: 'unsubscribedUpdatedAt', type: 'date' },
    { source: 'created_at', target: 'createdAt', type: 'date', omitWhenBlank: true },
    { source: 'updated_at', target: 'updatedAt', type: 'date' },
  ],
};

export const CRM1_CONTACTS_LEGACY_V1: MappingTemplate = {
  id: 'crm1-contacts-legacy',
  name: 'CRM-1 Contacts Legacy Export',
  version: 1,
  entity: 'crm1_contacts',
  fields: [
    { source: 'ContactId', target: 'id', type: 'uuid' },
    { source: 'FirstName', target: 'firstName', type: 'string', required: true },
    { source: 'LastName', target: 'lastName', type: 'string', required: true },
    { source: 'EmailAddress', target: 'email', type: 'email' },
    { source: 'PhoneNumber', target: 'phone', type: 'phone' },
    { source: 'MailingAddress', target: 'address', type: 'string' },
    { source: 'CompanyRef', target: 'companyId', type: 'uuid' },
    { source: 'LeadStage', target: 'leadStatus', type: 'string', enumName: 'lead_status' },
    { source: 'ExternalSystem', target: 'sourceSystem', type: 'string' },
    { source: 'ExternalId', target: 'sourceId', type: 'string' },
    { source: 'OptInConsent', target: 'consentStatus', type: 'string', enumName: 'consent_status', defaultValue: 'unknown' },
    { source: 'OptOutFlag', target: 'unsubscribed', type: 'boolean', defaultValue: false },
  ],
};

export const CRM1_COMPANIES_CANONICAL_V1: MappingTemplate = {
  id: 'crm1-companies-canonical',
  name: 'CRM-1 Companies Canonical',
  version: 1,
  entity: 'crm1_companies',
  fields: [
    { source: 'id', target: 'id', type: 'uuid' },
    { source: 'name', target: 'name', type: 'string', required: true },
    { source: 'tax_number', target: 'taxNumber', type: 'string' },
    { source: 'email', target: 'email', type: 'email' },
    { source: 'phone', target: 'phone', type: 'phone' },
    { source: 'address', target: 'address', type: 'string' },
    { source: 'source_system', target: 'sourceSystem', type: 'string' },
    { source: 'source_id', target: 'sourceId', type: 'string' },
    { source: 'created_at', target: 'createdAt', type: 'date', omitWhenBlank: true },
    { source: 'updated_at', target: 'updatedAt', type: 'date' },
  ],
};

export const CRM1_COMPANIES_LEGACY_V1: MappingTemplate = {
  id: 'crm1-companies-legacy',
  name: 'CRM-1 Companies Legacy Export',
  version: 1,
  entity: 'crm1_companies',
  fields: [
    { source: 'CompanyId', target: 'id', type: 'uuid' },
    { source: 'CompanyName', target: 'name', type: 'string', required: true },
    { source: 'TaxId', target: 'taxNumber', type: 'string' },
    { source: 'CorporateEmail', target: 'email', type: 'email' },
    { source: 'WorkPhone', target: 'phone', type: 'phone' },
    { source: 'OfficeAddress', target: 'address', type: 'string' },
    { source: 'SourceOrigin', target: 'sourceSystem', type: 'string' },
    { source: 'LegacyRecordId', target: 'sourceId', type: 'string' },
  ],
};

export const CRM1_LEADS_CANONICAL_V1: MappingTemplate = {
  id: 'crm1-leads-canonical',
  name: 'CRM-1 Leads Canonical',
  version: 1,
  entity: 'crm1_leads',
  fields: [
    { source: 'id', target: 'id', type: 'uuid' },
    { source: 'contact_id', target: 'contactId', type: 'uuid', required: true },
    { source: 'status', target: 'status', type: 'string', required: true, enumName: 'lead_status' },
    { source: 'source_system', target: 'sourceSystem', type: 'string' },
    { source: 'source_id', target: 'sourceId', type: 'string' },
    { source: 'created_at', target: 'createdAt', type: 'date', omitWhenBlank: true },
    { source: 'updated_at', target: 'updatedAt', type: 'date' },
  ],
};

export const CRM1_LEADS_LEGACY_V1: MappingTemplate = {
  id: 'crm1-leads-legacy',
  name: 'CRM-1 Leads Legacy Export',
  version: 1,
  entity: 'crm1_leads',
  fields: [
    { source: 'LeadId', target: 'id', type: 'uuid' },
    { source: 'ContactRef', target: 'contactId', type: 'uuid', required: true },
    { source: 'LeadStatus', target: 'status', type: 'string', required: true, enumName: 'lead_status' },
    { source: 'SystemCode', target: 'sourceSystem', type: 'string' },
    { source: 'OldId', target: 'sourceId', type: 'string' },
  ],
};

export const MAPPING_TEMPLATES: readonly MappingTemplate[] = [
  CRM1_CONTACTS_CANONICAL_V1,
  CRM1_CONTACTS_LEGACY_V1,
  CRM1_COMPANIES_CANONICAL_V1,
  CRM1_COMPANIES_LEGACY_V1,
  CRM1_LEADS_CANONICAL_V1,
  CRM1_LEADS_LEGACY_V1,
];

// ---------------------------------------------------------------------------
// Template Lookups & Cryptographic Checksum
// ---------------------------------------------------------------------------

export function getTemplate(id: string, version?: number | undefined): MappingTemplate | undefined {
  const matches = MAPPING_TEMPLATES.filter(
    (t) => t.id === id && (version === undefined || t.version === version)
  );
  return matches.sort((a, b) => b.version - a.version)[0];
}

export function listTemplates(entity?: Crm1TargetEntity | undefined): readonly MappingTemplate[] {
  if (!entity) return MAPPING_TEMPLATES;
  return MAPPING_TEMPLATES.filter((t) => t.entity === entity);
}

export function templateChecksum(template: MappingTemplate): string {
  return createHash('sha256').update(JSON.stringify(template)).digest('hex');
}

// ---------------------------------------------------------------------------
// Dry Run Readiness & Validation Guard
// ---------------------------------------------------------------------------

export function assertDryRunReady(
  template: MappingTemplate,
  sourceColumns: readonly string[]
): void {
  const columns = new Set(sourceColumns.map((c) => c.trim().toLowerCase()));
  const missing = template.fields.filter(
    (f) => f.required && !columns.has(f.source.trim().toLowerCase())
  );

  if (missing.length > 0) {
    throw new AppError(
      'MAPPING_INCOMPLETE',
      `Unmapped required target fields for ${template.id}@${template.version}`,
      400,
      missing.map((f) => ({
        field: f.target,
        code: 'MISSING_SOURCE_COLUMN',
        message: `source column "${f.source}" not found in source file headers`,
      }))
    );
  }
}

export function validateTemplate(
  template: MappingTemplate,
  sourceColumns?: readonly string[]
): {
  readonly valid: boolean;
  readonly missingRequiredFields: readonly string[];
  readonly errors: readonly string[];
} {
  const missingRequiredFields: string[] = [];
  const errors: string[] = [];

  if (sourceColumns && sourceColumns.length > 0) {
    const colSet = new Set(sourceColumns.map((c) => c.trim().toLowerCase()));
    for (const f of template.fields) {
      if (f.required && !colSet.has(f.source.trim().toLowerCase())) {
        missingRequiredFields.push(f.target);
        errors.push(
          `Required target field '${f.target}' has no matching source column '${f.source}' in headers`
        );
      }
    }
  }

  // Duplicate target mappings check
  const targetCounts = new Map<string, number>();
  for (const f of template.fields) {
    targetCounts.set(f.target, (targetCounts.get(f.target) ?? 0) + 1);
  }
  for (const [target, count] of targetCounts.entries()) {
    if (count > 1) {
      errors.push(`Target field '${target}' is mapped ${count} times in template '${template.id}'`);
    }
  }

  return {
    valid: missingRequiredFields.length === 0 && errors.length === 0,
    missingRequiredFields,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Value Translation & Type Coercion Logic
// ---------------------------------------------------------------------------

export function translateEnum(name: keyof typeof ENUMS, raw: string): string | null {
  const def = ENUMS[name];
  const key = raw.trim().toLowerCase();
  const value = (def.translations as Record<string, string>)[key] ?? raw.trim();
  const allowlist = def.allowlist as readonly string[];
  const matched = allowlist.find(
    (item) => item.toLowerCase() === value.toLowerCase()
  );
  return matched ?? null;
}

function coerce(
  field: FieldMapping,
  raw: string
): { readonly value: unknown } | { readonly code: string; readonly message: string } {
  const bad = (code: string) => ({ code, message: `"${raw}" is not a valid ${field.type}` });

  switch (field.type) {
    case 'string':
      return { value: raw };

    case 'uuid':
      return UUID_REGEX.test(raw) ? { value: raw.toLowerCase() } : bad('INVALID_UUID');

    case 'integer': {
      const n = Number(raw);
      return /^-?\d+$/.test(raw) && Number.isInteger(n) && n >= 0 && n <= INT32_MAX
        ? { value: n }
        : bad('INVALID_INTEGER');
    }

    case 'numeric': {
      const n = Number(raw);
      return raw !== '' && Number.isFinite(n)
        ? { value: Math.round(n * 10000) / 10000 }
        : bad('INVALID_NUMERIC');
    }

    case 'date': {
      if (!ISO_TS_REGEX.test(raw)) {
        return bad('INVALID_DATE');
      }
      const parsed = Date.parse(raw);
      return !Number.isNaN(parsed) ? { value: new Date(parsed) } : bad('INVALID_DATE');
    }

    case 'boolean': {
      const lower = raw.trim().toLowerCase();
      const translated = translateEnum('boolean', lower);
      if (translated === 'true') return { value: true };
      if (translated === 'false') return { value: false };
      return bad('INVALID_BOOLEAN');
    }

    case 'email': {
      const normalized = normalizeEmail(raw);
      return normalized.includes('@') ? { value: normalized } : bad('INVALID_EMAIL');
    }

    case 'phone': {
      const normalized = normalizePhone(raw);
      return normalized.length >= 7 ? { value: normalized } : bad('INVALID_PHONE');
    }

    case 'json': {
      try {
        return { value: JSON.parse(raw) as unknown };
      } catch {
        return bad('INVALID_JSON');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Deterministic Row Mapping Engine
// ---------------------------------------------------------------------------

export function mapRow(
  source: Readonly<Record<string, unknown>>,
  template: MappingTemplate
): MappingResult {
  const value: Record<string, unknown> = {};
  const errors: MappingError[] = [];

  for (const f of template.fields) {
    const rawVal = source[f.source];
    const raw = rawVal === null || rawVal === undefined ? '' : String(rawVal).trim();

    if (raw === '') {
      if (f.required) {
        errors.push({
          field: f.target,
          code: 'MISSING_REQUIRED_FIELD',
          message: `Source field "${f.source}" is required for target "${f.target}"`,
        });
      } else if (!f.omitWhenBlank) {
        value[f.target] = f.defaultValue !== undefined ? f.defaultValue : null;
      }
      continue;
    }

    let input = raw;
    if (f.enumName) {
      const translated = translateEnum(f.enumName, raw);
      if (translated === null) {
        errors.push({
          field: f.target,
          code: 'INVALID_ENUM_VALUE',
          message: `"${raw}" is not in the ${f.enumName} allowlist: [${ENUMS[f.enumName].allowlist.join(', ')}]`,
        });
        continue;
      }
      input = translated;
    }

    const coerced = coerce(f, input);
    if ('value' in coerced) {
      value[f.target] = coerced.value;
    } else {
      errors.push({ field: f.target, ...coerced });
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}
