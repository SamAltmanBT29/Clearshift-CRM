import { createHash } from 'node:crypto';
import { AppError } from '@cs/kernel';
import {
  CRM4_MEMBER_STATUSES,
  CRM4_CONSENT_STATUSES,
  type CRM4MemberStatus,
  type CRM4ConsentStatus,
} from '@clearshift/contracts';

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
  readonly alternateSources?: readonly string[] | undefined;
  readonly target: string;
  readonly type: FieldType;
  readonly required?: boolean | undefined;
  readonly enumName?: keyof typeof ENUMS | undefined;
  readonly defaultValue?: unknown | undefined;
  readonly omitWhenBlank?: boolean | undefined;
}

export type Crm4TargetEntity =
  | 'crm4_lists'
  | 'crm4_campaigns'
  | 'crm4_members'
  | 'crm4_consents';

export interface MappingTemplate {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly entity: Crm4TargetEntity;
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
 * CRM-4 Canonical Enums and Synonym Translation Dictionaries
 * Strictly aligned with CRM-4 domain invariants (FR-CRM4-01..05, BR-CRM4-01).
 */
export const ENUMS = {
  member_status: {
    allowlist: CRM4_MEMBER_STATUSES,
    translations: {
      sent: 'sent',
      send: 'sent',
      delivered: 'sent',
      deliver: 'sent',
      dispatched: 'sent',
      queued: 'sent',
      outbound: 'sent',
      opened: 'opened',
      open: 'opened',
      read: 'opened',
      viewed: 'opened',
      view: 'opened',
      clicked: 'clicked',
      click: 'clicked',
      engaged: 'clicked',
      tap: 'clicked',
      tapped: 'clicked',
    } as Record<string, CRM4MemberStatus>,
  },
  consent_status: {
    allowlist: CRM4_CONSENT_STATUSES,
    translations: {
      subscribed: 'subscribed',
      subscribe: 'subscribed',
      sub: 'subscribed',
      opt_in: 'subscribed',
      'opt-in': 'subscribed',
      optin: 'subscribed',
      granted: 'subscribed',
      grant: 'subscribed',
      yes: 'subscribed',
      true: 'subscribed',
      '1': 'subscribed',
      active: 'subscribed',
      consented: 'subscribed',
      agreed: 'subscribed',
      unsubscribed: 'unsubscribed',
      unsubscribe: 'unsubscribed',
      unsub: 'unsubscribed',
      opt_out: 'unsubscribed',
      'opt-out': 'unsubscribed',
      optout: 'unsubscribed',
      withdrawn: 'unsubscribed',
      withdraw: 'unsubscribed',
      revoked: 'unsubscribed',
      revoke: 'unsubscribed',
      no: 'unsubscribed',
      false: 'unsubscribed',
      '0': 'unsubscribed',
      rejected: 'unsubscribed',
    } as Record<string, CRM4ConsentStatus>,
  },
  boolean: {
    allowlist: ['true', 'false'] as const,
    translations: {
      true: 'true',
      yes: 'true',
      '1': 'true',
      t: 'true',
      y: 'true',
      subscribed: 'true',
      opt_in: 'true',
      false: 'false',
      no: 'false',
      '0': 'false',
      f: 'false',
      n: 'false',
      unsubscribed: 'false',
      opt_out: 'false',
    } as Record<string, 'true' | 'false'>,
  },
} as const;

export type MemberStatusType = (typeof ENUMS.member_status.allowlist)[number];
export type ConsentStatusType = (typeof ENUMS.consent_status.allowlist)[number];

// ---------------------------------------------------------------------------
// 1. Versioned Mapping Templates: Marketing Lists (crm4_lists)
// ---------------------------------------------------------------------------

export const CRM4_LISTS_CANONICAL_V1: MappingTemplate = {
  id: 'crm4-lists-canonical',
  name: 'CRM-4 Marketing Lists Canonical',
  version: 1,
  entity: 'crm4_lists',
  fields: [
    { source: 'id', alternateSources: ['source_id', 'list_id'], target: 'id', type: 'uuid' },
    { source: 'name', alternateSources: ['list_name'], target: 'name', type: 'string', required: true },
    { source: 'description', target: 'description', type: 'string' },
    { source: 'campaign_count', alternateSources: ['campaignCount'], target: 'campaignCount', type: 'integer', defaultValue: 0 },
    { source: 'member_count', alternateSources: ['memberCount'], target: 'memberCount', type: 'integer', defaultValue: 0 },
    { source: 'created_at', target: 'createdAt', type: 'date', omitWhenBlank: true },
    { source: 'updated_at', target: 'updatedAt', type: 'date' },
  ],
};

export const CRM4_LISTS_LEGACY_V1: MappingTemplate = {
  id: 'crm4-lists-legacy',
  name: 'CRM-4 Marketing Lists Legacy Export',
  version: 1,
  entity: 'crm4_lists',
  fields: [
    { source: 'ListId', target: 'id', type: 'uuid' },
    { source: 'ListName', target: 'name', type: 'string', required: true },
    { source: 'ListDescription', target: 'description', type: 'string' },
    { source: 'TotalCampaigns', target: 'campaignCount', type: 'integer', defaultValue: 0 },
    { source: 'TotalMembers', target: 'memberCount', type: 'integer', defaultValue: 0 },
  ],
};

// ---------------------------------------------------------------------------
// 2. Versioned Mapping Templates: Campaigns (crm4_campaigns)
// ---------------------------------------------------------------------------

export const CRM4_CAMPAIGNS_CANONICAL_V1: MappingTemplate = {
  id: 'crm4-campaigns-canonical',
  name: 'CRM-4 Campaigns Canonical',
  version: 1,
  entity: 'crm4_campaigns',
  fields: [
    { source: 'id', alternateSources: ['source_id', 'campaign_id'], target: 'id', type: 'uuid' },
    { source: 'name', alternateSources: ['campaign_name'], target: 'name', type: 'string', required: true },
    { source: 'campaign_date', alternateSources: ['date'], target: 'campaignDate', type: 'date', required: true },
    { source: 'list_id', alternateSources: ['listId'], target: 'listId', type: 'uuid', required: true },
    { source: 'member_count', alternateSources: ['memberCount'], target: 'memberCount', type: 'integer', defaultValue: 0 },
    { source: 'created_at', target: 'createdAt', type: 'date', omitWhenBlank: true },
    { source: 'updated_at', target: 'updatedAt', type: 'date' },
  ],
};

export const CRM4_CAMPAIGNS_LEGACY_V1: MappingTemplate = {
  id: 'crm4-campaigns-legacy',
  name: 'CRM-4 Campaigns Legacy Export',
  version: 1,
  entity: 'crm4_campaigns',
  fields: [
    { source: 'CampaignId', target: 'id', type: 'uuid' },
    { source: 'CampaignName', target: 'name', type: 'string', required: true },
    { source: 'ScheduledDate', target: 'campaignDate', type: 'date', required: true },
    { source: 'TargetListId', target: 'listId', type: 'uuid', required: true },
    { source: 'TotalAudience', target: 'memberCount', type: 'integer', defaultValue: 0 },
  ],
};

// ---------------------------------------------------------------------------
// 3. Versioned Mapping Templates: Campaign Members (crm4_members)
// ---------------------------------------------------------------------------

export const CRM4_MEMBERS_CANONICAL_V1: MappingTemplate = {
  id: 'crm4-members-canonical',
  name: 'CRM-4 Campaign Members Canonical',
  version: 1,
  entity: 'crm4_members',
  fields: [
    { source: 'id', alternateSources: ['source_id', 'member_id'], target: 'id', type: 'uuid' },
    { source: 'campaign_id', alternateSources: ['campaignId'], target: 'campaignId', type: 'uuid', required: true },
    { source: 'contact_id', alternateSources: ['contactId'], target: 'contactId', type: 'uuid', required: true },
    {
      source: 'status',
      alternateSources: ['member_status'],
      target: 'status',
      type: 'string',
      required: true,
      enumName: 'member_status',
      defaultValue: 'sent',
    },
    { source: 'unsubscribed', target: 'unsubscribed', type: 'boolean', defaultValue: false },
    { source: 'created_at', target: 'createdAt', type: 'date', omitWhenBlank: true },
  ],
};

export const CRM4_MEMBERS_LEGACY_V1: MappingTemplate = {
  id: 'crm4-members-legacy',
  name: 'CRM-4 Campaign Members Legacy Export',
  version: 1,
  entity: 'crm4_members',
  fields: [
    { source: 'MemberId', target: 'id', type: 'uuid' },
    { source: 'CampaignRef', target: 'campaignId', type: 'uuid', required: true },
    { source: 'ContactRef', target: 'contactId', type: 'uuid', required: true },
    {
      source: 'DeliveryStatus',
      target: 'status',
      type: 'string',
      required: true,
      enumName: 'member_status',
      defaultValue: 'sent',
    },
    { source: 'OptOutIndicator', target: 'unsubscribed', type: 'boolean', defaultValue: false },
  ],
};

// ---------------------------------------------------------------------------
// 4. Versioned Mapping Templates: Consent Records (crm4_consents)
// ---------------------------------------------------------------------------

export const CRM4_CONSENTS_CANONICAL_V1: MappingTemplate = {
  id: 'crm4-consents-canonical',
  name: 'CRM-4 Consents Canonical',
  version: 1,
  entity: 'crm4_consents',
  fields: [
    { source: 'id', alternateSources: ['source_id', 'consent_id'], target: 'id', type: 'uuid' },
    { source: 'contact_id', alternateSources: ['contactId'], target: 'contactId', type: 'uuid', required: true },
    {
      source: 'status',
      alternateSources: ['consent_status'],
      target: 'status',
      type: 'string',
      required: true,
      enumName: 'consent_status',
      defaultValue: 'subscribed',
    },
    {
      source: 'source',
      alternateSources: ['consent_source'],
      target: 'source',
      type: 'string',
      required: true,
    },
    { source: 'consent_date', alternateSources: ['date'], target: 'consentDate', type: 'date', omitWhenBlank: true },
    { source: 'created_at', target: 'createdAt', type: 'date', omitWhenBlank: true },
    { source: 'updated_at', target: 'updatedAt', type: 'date' },
  ],
};

export const CRM4_CONSENTS_LEGACY_V1: MappingTemplate = {
  id: 'crm4-consents-legacy',
  name: 'CRM-4 Consents Legacy Export',
  version: 1,
  entity: 'crm4_consents',
  fields: [
    { source: 'RecordId', target: 'id', type: 'uuid' },
    { source: 'ContactRef', target: 'contactId', type: 'uuid', required: true },
    {
      source: 'SubscriptionState',
      target: 'status',
      type: 'string',
      required: true,
      enumName: 'consent_status',
      defaultValue: 'subscribed',
    },
    { source: 'AcquisitionChannel', target: 'source', type: 'string', required: true },
    { source: 'Timestamp', target: 'consentDate', type: 'date' },
  ],
};

export const MAPPING_TEMPLATES: readonly MappingTemplate[] = [
  CRM4_LISTS_CANONICAL_V1,
  CRM4_LISTS_LEGACY_V1,
  CRM4_CAMPAIGNS_CANONICAL_V1,
  CRM4_CAMPAIGNS_LEGACY_V1,
  CRM4_MEMBERS_CANONICAL_V1,
  CRM4_MEMBERS_LEGACY_V1,
  CRM4_CONSENTS_CANONICAL_V1,
  CRM4_CONSENTS_LEGACY_V1,
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

export function listTemplates(entity?: Crm4TargetEntity | undefined): readonly MappingTemplate[] {
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
  const missing = template.fields.filter((f) => {
    if (!f.required) return false;
    const candidates = [f.source, ...(f.alternateSources ?? [])];
    return !candidates.some((col) => columns.has(col.trim().toLowerCase()));
  });

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
      if (f.required) {
        const candidates = [f.source, ...(f.alternateSources ?? [])];
        if (!candidates.some((c) => colSet.has(c.trim().toLowerCase()))) {
          missingRequiredFields.push(f.target);
          errors.push(
            `Required target field '${f.target}' has no matching source column '${f.source}' in headers`
          );
        }
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
      if (field.target === 'campaignDate') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
          const parsed = Date.parse(raw);
          return !Number.isNaN(parsed) ? { value: raw } : bad('INVALID_DATE');
        }
        if (ISO_TS_REGEX.test(raw) && !Number.isNaN(Date.parse(raw))) {
          return { value: new Date(raw).toISOString().slice(0, 10) };
        }
        return bad('INVALID_DATE');
      }

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
      const trimmed = raw.trim().toLowerCase();
      return trimmed.includes('@') && trimmed.includes('.') ? { value: trimmed } : bad('INVALID_EMAIL');
    }

    case 'phone': {
      const cleaned = raw.replace(/[^\d+]/g, '');
      return cleaned.length >= 7 ? { value: cleaned } : bad('INVALID_PHONE');
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
// Deterministic Row Mapping Engine & BR-CRM4-01 Guard
// ---------------------------------------------------------------------------

export function mapRow(
  source: Readonly<Record<string, unknown>>,
  template: MappingTemplate
): MappingResult {
  const value: Record<string, unknown> = {};
  const errors: MappingError[] = [];

  for (const f of template.fields) {
    const candidateKeys = [f.source, ...(f.alternateSources ?? [])];
    let rawVal: unknown = undefined;
    for (const key of candidateKeys) {
      if (source[key] !== undefined && source[key] !== null) {
        rawVal = source[key];
        break;
      }
    }

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

  // Enforce BR-CRM4-01: Monotonic Opt-Out protection
  // If mapping consent records and prior consent is known to be opt-out / unsubscribed,
  // mapping may NEVER overwrite it with consent / subscribed.
  if (template.entity === 'crm4_consents') {
    const prior = source['prior_consent_status'] ?? source['existing_status'] ?? source['current_status'];
    if (prior !== undefined && prior !== null && String(prior).trim() !== '') {
      const priorTranslated = translateEnum('consent_status', String(prior).trim());
      if (priorTranslated === 'unsubscribed' && value['status'] === 'subscribed') {
        errors.push({
          field: 'status',
          code: 'MONOTONIC_OPT_OUT_VIOLATION',
          message:
            'Domain Invariant Violation (BR-CRM4-01): Opt-out is strictly monotonic. Once unsubscribed, re-subscription via migration or bulk load is prohibited.',
        });
      }
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}
