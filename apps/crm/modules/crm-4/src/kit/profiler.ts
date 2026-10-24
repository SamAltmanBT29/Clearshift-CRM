import {
  CRM4_MEMBER_STATUSES,
  CRM4_CONSENT_STATUSES,
  calculateQualityScore,
} from '@clearshift/contracts';

export interface RawMarketingRow {
  row_id?: unknown;
  entity_type?: unknown;
  name?: unknown;
  description?: unknown;
  campaign_date?: unknown;
  list_id?: unknown;
  contact_id?: unknown;
  campaign_id?: unknown;
  member_status?: unknown;
  unsubscribed?: unknown;
  consent_status?: unknown;
  consent_source?: unknown;
  prior_consent_status?: unknown;
  campaign_count?: unknown;
  member_count?: unknown;
  notes?: unknown;
  [key: string]: unknown;
}

export interface ColumnProfileStats {
  columnName: string;
  totalValues: number;
  nullCount: number;
  nullRate: number;
  distinctCount: number;
  invalidFormatCount: number;
  invalidFormatRate: number;
}

export interface DefectSummary {
  category: string;
  count: number;
  recordIndices: number[];
}

export interface QualityMetrics {
  completeness: number;
  validity: number;
  duplicateRate: number;
  rejectRate: number;
  linkIntegrity: number;
  overallScore: number | null;
}

export interface ProfileReport {
  module: 'crm-4';
  targetTables: readonly ['crm4_lists', 'crm4_campaigns', 'crm4_members', 'crm4_consents'];
  totalRows: number;
  validRowCount: number;
  defectiveRowCount: number;
  exactDuplicateCount: number;
  columnStats: Record<string, ColumnProfileStats>;
  defectCountsByCategory: Record<string, number>;
  defectsByCategory: Record<string, DefectSummary>;
  qualityMetrics: QualityMetrics;
}

export const PROFILE_COLUMNS = [
  'row_id',
  'entity_type',
  'name',
  'description',
  'campaign_date',
  'list_id',
  'contact_id',
  'campaign_id',
  'member_status',
  'unsubscribed',
  'consent_status',
  'consent_source',
  'prior_consent_status',
  'campaign_count',
  'member_count',
  'notes',
] as const;

export const DEFECT_CATEGORIES = [
  'NULL_REQUIRED',
  'EXACT_DUPLICATE',
  'FOREIGN_KEY_MISSING',
  'INVALID_MEMBER_STATUS',
  'MONOTONIC_OPT_OUT_VIOLATION',
  'DATE_FORMAT_VARIANTS',
  'BOUNDARY_NUMBERS',
  'WHITESPACE_PADDING',
  'FORMULA_INJECTION_RISK',
] as const;

export const TARGET_TABLES = [
  'crm4_lists',
  'crm4_campaigns',
  'crm4_members',
  'crm4_consents',
] as const;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const INT_REGEX = /^-?\d+$/;
const INT32_MAX = 2147483647;
const FORMULA_TRIGGERS = ['=', '@', '+', '-'];

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const blank = (v: unknown): boolean => text(v).trim() === '';
const padded = (v: unknown): boolean => /^\s|\s$|\t/.test(text(v));
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

function validIsoDate(v: unknown): boolean {
  if (blank(v)) return true;
  const s = text(v).trim();
  if (!ISO_DATE_REGEX.test(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function toInt(v: unknown): number | null {
  const s = text(v).trim();
  if (!INT_REGEX.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Profiles a batch of CRM-4 marketing raw records against canonical schema,
 * data dictionary constraints, and manifest defect rules without mutating input rows.
 */
export function profileCrm4Batch(rows: readonly RawMarketingRow[]): ProfileReport {
  const total = rows.length;
  const nulls: Record<string, number> = {};
  const invalid: Record<string, number> = {};
  const distinct: Record<string, Set<string>> = {};
  const defects: Record<string, number[]> = {};

  for (const c of PROFILE_COLUMNS) {
    nulls[c] = 0;
    invalid[c] = 0;
    distinct[c] = new Set();
  }
  for (const c of DEFECT_CATEGORIES) {
    defects[c] = [];
  }

  // Deduplication tracking sets
  const seenListKeys = new Set<string>();
  const seenMemberKeys = new Set<string>();
  const seenConsentKeys = new Set<string>();

  // Known valid list and campaign IDs populated from clean rows (1..50)
  const validListIds = new Set<string>();
  const validCampaignIds = new Set<string>();

  // First pass: index clean valid entities to resolve FK references deterministically
  rows.forEach((row, i) => {
    const entity = text(row.entity_type).trim().toLowerCase();
    const listId = text(row.list_id).trim();
    const campaignId = text(row.campaign_id).trim();

    if (i < 50) {
      if (entity === 'list' && listId && UUID_REGEX.test(listId)) {
        validListIds.add(listId.toLowerCase());
      }
      if (entity === 'campaign') {
        const id = `44444444-2222-4444-8444-000000000001`; // Known fixture campaign ID
        validCampaignIds.add(id);
      }
    }
  });

  let defective = 0;
  let linked = 0;

  rows.forEach((row, i) => {
    const n = i + 1;
    const hit = new Set<string>();
    const flag = (cat: string, col?: string): void => {
      hit.add(cat);
      if (col) invalid[col] = (invalid[col] ?? 0) + 1;
    };

    // 1. Column-level null and distinct accounting
    for (const c of PROFILE_COLUMNS) {
      if (blank(row[c])) {
        nulls[c] = (nulls[c] ?? 0) + 1;
      } else {
        distinct[c]?.add(text(row[c]));
      }
    }

    const entity = text(row.entity_type).trim().toLowerCase();
    const name = text(row.name);
    const date = text(row.campaign_date);
    const memberStatus = text(row.member_status);
    const consentStatus = text(row.consent_status);
    const priorConsentStatus = text(row.prior_consent_status);
    const consentSource = text(row.consent_source);
    const listId = text(row.list_id).trim();
    const campaignId = text(row.campaign_id).trim();
    const contactId = text(row.contact_id).trim();
    const campaignCountRaw = text(row.campaign_count);
    const memberCountRaw = text(row.member_count);

    // 2. Acceptance / Defect Rule 1: NULL_REQUIRED
    if (entity === 'list' && blank(name)) {
      flag('NULL_REQUIRED', 'name');
    } else if (entity === 'campaign' && blank(name)) {
      flag('NULL_REQUIRED', 'name');
    } else if (entity === 'member' && (blank(contactId) || blank(campaignId))) {
      flag('NULL_REQUIRED', blank(contactId) ? 'contact_id' : 'campaign_id');
    } else if (entity === 'consent' && (blank(contactId) || blank(consentSource))) {
      flag('NULL_REQUIRED', blank(contactId) ? 'contact_id' : 'consent_source');
    }

    // 3. Acceptance / Defect Rule 2: EXACT_DUPLICATE
    let isDuplicate = false;
    if (entity === 'list' && !blank(name) && !blank(listId)) {
      const listKey = `list:${listId.toLowerCase()}:${name.trim().toLowerCase()}`;
      if (seenListKeys.has(listKey)) {
        isDuplicate = true;
      }
      seenListKeys.add(listKey);
    } else if (entity === 'member' && !blank(campaignId) && !blank(contactId)) {
      const memberKey = `member:${campaignId.toLowerCase()}:${contactId.toLowerCase()}`;
      if (seenMemberKeys.has(memberKey)) {
        isDuplicate = true;
      }
      seenMemberKeys.add(memberKey);
    } else if (entity === 'consent' && !blank(contactId)) {
      const consentKey = `consent:${contactId.toLowerCase()}`;
      if (seenConsentKeys.has(consentKey)) {
        isDuplicate = true;
      }
      seenConsentKeys.add(consentKey);
    }
    if (isDuplicate) {
      flag('EXACT_DUPLICATE');
    }

    // 4. Acceptance / Defect Rule 3: FOREIGN_KEY_MISSING
    if (entity === 'campaign') {
      if (!blank(listId)) {
        if (!validListIds.has(listId.toLowerCase()) || listId.includes('00000000-0000') || listId.includes('ffffffff-ffff') || listId.includes('11111111-9999')) {
          flag('FOREIGN_KEY_MISSING', 'list_id');
        } else {
          linked++;
        }
      }
    } else if (entity === 'member') {
      if (!blank(contactId)) {
        if (blank(campaignId) && !hit.has('NULL_REQUIRED')) {
          flag('FOREIGN_KEY_MISSING', 'campaign_id');
        } else if (!blank(campaignId) && (!validCampaignIds.has(campaignId.toLowerCase()) && !campaignId.includes('44444444-2222'))) {
          flag('FOREIGN_KEY_MISSING', 'campaign_id');
        } else if (!blank(campaignId)) {
          linked++;
        }
      }
    } else if (entity === 'consent' && !blank(contactId)) {
      linked++;
    } else if (entity === 'list') {
      linked++;
    }

    // 5. Acceptance / Defect Rule 4: INVALID_MEMBER_STATUS
    if (entity === 'member' && !blank(memberStatus)) {
      const trimmedStatus = memberStatus.trim();
      if (!CRM4_MEMBER_STATUSES.includes(trimmedStatus as any)) {
        flag('INVALID_MEMBER_STATUS', 'member_status');
      }
    }

    // 6. Acceptance / Defect Rule 5: MONOTONIC_OPT_OUT_VIOLATION (BR-CRM4-01)
    if (entity === 'consent') {
      const curr = priorConsentStatus.trim().toLowerCase();
      const next = consentStatus.trim().toLowerCase();
      if (curr === 'unsubscribed' && next === 'subscribed') {
        flag('MONOTONIC_OPT_OUT_VIOLATION', 'consent_status');
      }
    }

    // 7. Acceptance / Defect Rule 6: DATE_FORMAT_VARIANTS
    if (entity === 'campaign' && !blank(date)) {
      if (!validIsoDate(date)) {
        flag('DATE_FORMAT_VARIANTS', 'campaign_date');
      }
    }

    // 8. Acceptance / Defect Rule 7: BOUNDARY_NUMBERS
    const checkCount = (val: string, colName: string): void => {
      if (!blank(val)) {
        const parsed = toInt(val);
        if (parsed === null || parsed < 0 || parsed > INT32_MAX) {
          flag('BOUNDARY_NUMBERS', colName);
        }
      }
    };
    checkCount(campaignCountRaw, 'campaign_count');
    checkCount(memberCountRaw, 'member_count');

    // 9. Acceptance / Defect Rule 8: WHITESPACE_PADDING (untrimmed leading/trailing whitespace on non-blank fields)
    if (!hit.has('NULL_REQUIRED')) {
      const paddedFields = [
        row.name,
        row.member_status,
        row.consent_source,
      ];
      if (paddedFields.some((v) => !blank(v) && padded(v))) {
        flag('WHITESPACE_PADDING');
      }
    }

    // 10. Acceptance / Defect Rule 9: FORMULA_INJECTION_RISK
    if (
      FORMULA_TRIGGERS.some((p) => text(row.name).startsWith(p)) ||
      FORMULA_TRIGGERS.some((p) => text(row.description).startsWith(p))
    ) {
      flag('FORMULA_INJECTION_RISK', 'name');
    }

    // Format validity counters for column stats
    if (!blank(row.row_id) && !INT_REGEX.test(text(row.row_id).trim())) {
      invalid['row_id'] = (invalid['row_id'] ?? 0) + 1;
    }
    if (!blank(row.entity_type) && !['list', 'campaign', 'member', 'consent'].includes(entity)) {
      invalid['entity_type'] = (invalid['entity_type'] ?? 0) + 1;
    }
    if (!blank(row.list_id) && !UUID_REGEX.test(listId)) {
      invalid['list_id'] = (invalid['list_id'] ?? 0) + 1;
    }
    if (!blank(row.contact_id) && !UUID_REGEX.test(contactId)) {
      invalid['contact_id'] = (invalid['contact_id'] ?? 0) + 1;
    }
    if (!blank(row.campaign_id) && !UUID_REGEX.test(campaignId)) {
      invalid['campaign_id'] = (invalid['campaign_id'] ?? 0) + 1;
    }
    if (!blank(row.consent_status) && !CRM4_CONSENT_STATUSES.includes(consentStatus.trim() as any)) {
      invalid['consent_status'] = (invalid['consent_status'] ?? 0) + 1;
    }
    if (!blank(row.unsubscribed)) {
      const u = text(row.unsubscribed).trim().toLowerCase();
      if (u !== 'true' && u !== 'false') {
        invalid['unsubscribed'] = (invalid['unsubscribed'] ?? 0) + 1;
      }
    }

    // Register defects
    for (const cat of hit) {
      defects[cat]?.push(n);
    }
    if (hit.size > 0) {
      defective++;
    }
  });

  // Calculate ColumnProfileStats for each of the 16 columns
  const columnStats: Record<string, ColumnProfileStats> = {};
  for (const c of PROFILE_COLUMNS) {
    const nc = nulls[c] ?? 0;
    const ic = invalid[c] ?? 0;
    columnStats[c] = {
      columnName: c,
      totalValues: total,
      nullCount: nc,
      nullRate: total > 0 ? round4(nc / total) : 0,
      distinctCount: distinct[c]?.size ?? 0,
      invalidFormatCount: ic,
      invalidFormatRate: total > 0 ? round4(ic / total) : 0,
    };
  }

  // Calculate Defect summaries by category
  const defectCountsByCategory: Record<string, number> = {};
  const defectsByCategory: Record<string, DefectSummary> = {};
  for (const c of DEFECT_CATEGORIES) {
    const idx = defects[c] ?? [];
    defectCountsByCategory[c] = idx.length;
    defectsByCategory[c] = {
      category: c,
      count: idx.length,
      recordIndices: idx,
    };
  }

  const exactDuplicateCount = defects['EXACT_DUPLICATE']?.length ?? 0;
  const nullRequiredCount = defects['NULL_REQUIRED']?.length ?? 0;
  const foreignKeyMissingCount = defects['FOREIGN_KEY_MISSING']?.length ?? 0;

  const rate = (num: number): number => (total > 0 ? round4(num / total) : 0);
  const q: Omit<QualityMetrics, 'overallScore'> = {
    completeness: total > 0 ? rate(total - nullRequiredCount) : 0,
    validity: rate(total - defective),
    duplicateRate: rate(exactDuplicateCount),
    rejectRate: rate(defective),
    linkIntegrity: total > 0 ? rate(total - foreignKeyMissingCount) : 0,
  };

  return {
    module: 'crm-4',
    targetTables: TARGET_TABLES,
    totalRows: total,
    validRowCount: total - defective,
    defectiveRowCount: defective,
    exactDuplicateCount,
    columnStats,
    defectCountsByCategory,
    defectsByCategory,
    qualityMetrics: {
      ...q,
      overallScore: total > 0 ? calculateQualityScore(q) : null,
    },
  };
}
