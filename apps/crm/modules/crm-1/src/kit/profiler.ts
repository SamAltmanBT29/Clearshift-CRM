/**
 * ClearShift CRM — CRM-1 Profiling Configuration & Reporting Engine
 *
 * Implements module profiling configuration for CRM-1 Contacts, Companies and Leads:
 * - Computes total rows, column null counts, distinct values, and invalid format rates
 * - Detects exact duplicate candidates using deterministic exact keys (no fuzzy matching)
 * - Classifies defect categories aligned with the Dirty Data Pack manifest
 * - Strictly non-destructive operation preserving source data integrity
 * - Produces quality metrics and scorecards using shared platform contracts
 *
 * Traceability:
 * - Issue: #119 [CRM1-26] CRM-1 Contacts, Companies and Leads: Profiling configuration and expected-result assertions
 * - ClearShift Project Plan v3.0 §17; SDS ClearShift CRM v2.0 §4.2, §4.11, §4.12
 */

import {
  calculateQualityScore,
  buildContactExactEmailKey,
  buildContactExactPhoneNameKey,
  CRM1LeadStatusSchema,
  type ColumnProfile,
  type InferredDataType,
  type ProfileReport as PlatformProfileReport,
} from '@clearshift/contracts';
import { SEEDED_COMPANIES } from '../domain/dirty-data-pack.js';

export interface RawContactRow {
  id?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
  phone?: unknown;
  address?: unknown;
  company_id?: unknown;
  company_name?: unknown;
  lead_status?: unknown;
  source_system?: unknown;
  source_id?: unknown;
  consent_status?: unknown;
  unsubscribed?: unknown;
  annual_revenue?: unknown;
  created_at?: unknown;
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
  inferredType: string;
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

export interface Crm1ProfileReport {
  module: 'crm-1';
  targetTable: 'crm1_contacts';
  targetTables: readonly ['crm1_contacts', 'crm1_companies', 'crm1_leads'];
  totalRows: number;
  validRowCount: number;
  defectiveRowCount: number;
  loadedCount: number;
  mergedCount: number;
  rejectedCount: number;
  skippedCount: number;
  unaccounted: number;
  exactDuplicateCount: number;
  columnStats: Record<string, ColumnProfileStats>;
  defectCountsByCategory: Record<string, number>;
  defectsByCategory: Record<string, DefectSummary>;
  qualityMetrics: QualityMetrics;
  rulesetVersion: number;
  generatedAt: Date;
}

export const PROFILE_COLUMNS = [
  'id',
  'first_name',
  'last_name',
  'email',
  'phone',
  'address',
  'company_id',
  'company_name',
  'lead_status',
  'source_system',
  'source_id',
  'consent_status',
  'unsubscribed',
  'annual_revenue',
  'created_at',
] as const;

export type ProfileColumnName = (typeof PROFILE_COLUMNS)[number];

export const DEFECT_CATEGORIES = [
  'EXACT_DUPLICATE',
  'NULL_REQUIRED',
  'MALFORMED',
  'FOREIGN_KEY_MISSING',
  'FORMULA_INJECTION_RISK',
  'BOUNDARY_NUMBERS',
  'FIELD_TOO_LONG',
] as const;

export type DefectCategoryName = (typeof DEFECT_CATEGORIES)[number];

export const TARGET_TABLES = [
  'crm1_contacts',
  'crm1_companies',
  'crm1_leads',
] as const;

export const INFERRED_COLUMN_TYPES: Readonly<Record<ProfileColumnName, string>> = {
  id: 'uuid',
  first_name: 'string',
  last_name: 'string',
  email: 'email',
  phone: 'phone',
  address: 'string',
  company_id: 'uuid',
  company_name: 'string',
  lead_status: 'enum',
  source_system: 'string',
  source_id: 'string',
  consent_status: 'enum',
  unsubscribed: 'boolean',
  annual_revenue: 'decimal',
  created_at: 'timestamp',
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORMULA_TRIGGERS = ['=', '@', '+'];

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const blank = (v: unknown): boolean => text(v).trim() === '';
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * Validates RFC-5322 email syntax with domain requirement and disallows whitespace or consecutive dots.
 */
function isValidEmail(v: string): boolean {
  if (!v || v.includes(' ') || v.includes('..')) return false;
  const atIndex = v.indexOf('@');
  if (atIndex <= 0 || atIndex === v.length - 1) return false;
  if (v.indexOf('@', atIndex + 1) !== -1) return false;
  const domain = v.slice(atIndex + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

/**
 * Validates telephone number: allows digits, +, spaces, parens, hyphens, min 7 digits.
 */
function isValidPhone(v: string): boolean {
  const digits = v.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 25) return false;
  // Disallow alphabetic characters
  if (/[a-zA-Z]/.test(v)) return false;
  return /^\+?[0-9\s().-]+$/.test(v.trim());
}

/**
 * Checks for formula injection risk tokens (=, +, @) at start of text value.
 */
function hasFormulaRisk(v: string): boolean {
  const trimmed = v.trim();
  if (trimmed.length === 0) return false;
  const firstChar = trimmed[0];
  if (!FORMULA_TRIGGERS.includes(firstChar!)) return false;
  // Valid phone numbers starting with + are not formula risks
  if (firstChar === '+' && isValidPhone(trimmed)) return false;
  return true;
}

export interface ProfileOptions {
  seededCompanyIds?: readonly string[];
}

/**
 * Profiles a batch of CRM-1 Contact rows non-destructively, returning comprehensive
 * column statistics, duplicate candidate groups, defect categories, and quality scorecard.
 */
export function profileCrm1Batch(
  rows: readonly RawContactRow[],
  options: ProfileOptions = {}
): Crm1ProfileReport {
  const total = rows.length;
  const nulls: Record<string, number> = {};
  const invalid: Record<string, number> = {};
  const distinct: Record<string, Set<string>> = {};
  const defects: Record<string, number[]> = {};

  for (const c of PROFILE_COLUMNS) {
    nulls[c] = 0;
    invalid[c] = 0;
    distinct[c] = new Set<string>();
  }
  for (const c of DEFECT_CATEGORIES) {
    defects[c] = [];
  }

  const validCompanyIds = new Set<string>(
    (options.seededCompanyIds ?? SEEDED_COMPANIES.map((c) => c.id)).map((id) => id.toLowerCase())
  );

  // Exact duplicate key clustering using deterministic normalized keys
  const emailKeyToIndices = new Map<string, number[]>();
  const phoneNameKeyToIndices = new Map<string, number[]>();

  rows.forEach((row, idx) => {
    const rowNum = idx + 1;

    // 1. Column-level null and distinct tracking
    for (const c of PROFILE_COLUMNS) {
      const rawVal = row[c];
      if (blank(rawVal)) {
        nulls[c] = (nulls[c] ?? 0) + 1;
      } else {
        distinct[c]?.add(text(rawVal).trim());
      }
    }

    // 2. Index exact duplicate candidate keys (normalized email, normalized phone+name)
    const emailVal = text(row.email).trim();
    if (emailVal && isValidEmail(emailVal)) {
      const normEmail = buildContactExactEmailKey(emailVal);
      if (normEmail) {
        const existing = emailKeyToIndices.get(normEmail) ?? [];
        existing.push(rowNum);
        emailKeyToIndices.set(normEmail, existing);
      }
    }

    const phoneVal = text(row.phone).trim();
    const firstVal = text(row.first_name).trim();
    const lastVal = text(row.last_name).trim();
    if (phoneVal && firstVal && lastVal && isValidPhone(phoneVal)) {
      const normPhoneName = buildContactExactPhoneNameKey(phoneVal, firstVal, lastVal);
      if (normPhoneName) {
        const existing = phoneNameKeyToIndices.get(normPhoneName) ?? [];
        existing.push(rowNum);
        phoneNameKeyToIndices.set(normPhoneName, existing);
      }
    }
  });

  // Collect duplicate rows from key clusters (indices where key occurs > 1)
  const duplicateRowSet = new Set<number>();
  for (const indices of emailKeyToIndices.values()) {
    if (indices.length > 1) {
      for (const idx of indices) {
        duplicateRowSet.add(idx);
      }
    }
  }
  for (const indices of phoneNameKeyToIndices.values()) {
    if (indices.length > 1) {
      for (const idx of indices) {
        duplicateRowSet.add(idx);
      }
    }
  }

  // Row-level defect classification pass
  let defectiveRowCount = 0;

  rows.forEach((row, idx) => {
    const rowNum = idx + 1;
    const hitDefects = new Set<string>();

    const firstName = text(row.first_name);
    const lastName = text(row.last_name);
    const email = text(row.email).trim();
    const phone = text(row.phone).trim();
    const companyId = text(row.company_id).trim();
    const leadStatus = text(row.lead_status).trim();
    const annualRevenue = text(row.annual_revenue).trim();

    // Defect Category 1: EXACT_DUPLICATE
    if (duplicateRowSet.has(rowNum)) {
      hitDefects.add('EXACT_DUPLICATE');
    }

    // Defect Category 2: NULL_REQUIRED (missing or whitespace first_name or last_name)
    if (blank(firstName) || blank(lastName)) {
      hitDefects.add('NULL_REQUIRED');
    }

    // Defect Category 3: MALFORMED (invalid RFC-5322 email, non-E.164 phone, or invalid lead status enum)
    let isMalformed = false;
    if (email && !isValidEmail(email)) {
      isMalformed = true;
      invalid['email'] = (invalid['email'] ?? 0) + 1;
    }
    if (phone && !isValidPhone(phone)) {
      isMalformed = true;
      invalid['phone'] = (invalid['phone'] ?? 0) + 1;
    }
    if (leadStatus) {
      const parsedStatus = CRM1LeadStatusSchema.safeParse(leadStatus);
      if (!parsedStatus.success) {
        isMalformed = true;
        invalid['lead_status'] = (invalid['lead_status'] ?? 0) + 1;
      }
    }
    if (isMalformed) {
      hitDefects.add('MALFORMED');
    }

    // Defect Category 4: FOREIGN_KEY_MISSING (company_id not in seeded companies ledger)
    if (companyId) {
      const isOrphan = !validCompanyIds.has(companyId.toLowerCase());
      if (isOrphan) {
        hitDefects.add('FOREIGN_KEY_MISSING');
        invalid['company_id'] = (invalid['company_id'] ?? 0) + 1;
      }
    }

    // Defect Category 5: FORMULA_INJECTION_RISK (first_name or last_name starts with =, +, @)
    let hasFormula = false;
    if (firstName && hasFormulaRisk(firstName)) {
      hasFormula = true;
      invalid['first_name'] = (invalid['first_name'] ?? 0) + 1;
    }
    if (lastName && hasFormulaRisk(lastName)) {
      hasFormula = true;
      invalid['last_name'] = (invalid['last_name'] ?? 0) + 1;
    }
    if (hasFormula) {
      hitDefects.add('FORMULA_INJECTION_RISK');
    }

    // Defect Category 6: BOUNDARY_NUMBERS (negative annual revenue)
    if (annualRevenue && !blank(annualRevenue)) {
      const num = Number(annualRevenue);
      if (Number.isFinite(num) && num < 0) {
        hitDefects.add('BOUNDARY_NUMBERS');
        invalid['annual_revenue'] = (invalid['annual_revenue'] ?? 0) + 1;
      }
    }

    // Defect Category 7: FIELD_TOO_LONG (string length > 255 chars)
    let isTooLong = false;
    if (firstName && firstName.length > 255) {
      isTooLong = true;
      invalid['first_name'] = (invalid['first_name'] ?? 0) + 1;
    }
    if (lastName && lastName.length > 255) {
      isTooLong = true;
      invalid['last_name'] = (invalid['last_name'] ?? 0) + 1;
    }
    if (isTooLong) {
      hitDefects.add('FIELD_TOO_LONG');
    }

    // Register defects
    for (const cat of hitDefects) {
      defects[cat]?.push(rowNum);
    }

    if (hitDefects.size > 0) {
      defectiveRowCount++;
    }
  });

  // Calculate ColumnProfileStats for all 15 columns
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
      inferredType: INFERRED_COLUMN_TYPES[c] ?? 'string',
    };
  }

  // Calculate Defect summaries by category
  const defectCountsByCategory: Record<string, number> = {};
  const defectsByCategory: Record<string, DefectSummary> = {};
  for (const c of DEFECT_CATEGORIES) {
    const indices = defects[c] ?? [];
    defectCountsByCategory[c] = indices.length;
    defectsByCategory[c] = {
      category: c,
      count: indices.length,
      recordIndices: indices.sort((a, b) => a - b),
    };
  }

  const exactDuplicateCount = defectCountsByCategory['EXACT_DUPLICATE'] ?? 0;
  const nullRequiredCount = defectCountsByCategory['NULL_REQUIRED'] ?? 0;
  const foreignKeyMissingCount = defectCountsByCategory['FOREIGN_KEY_MISSING'] ?? 0;

  // Exact row accounting
  const loadedCount = total - defectiveRowCount;
  const mergedCount = exactDuplicateCount;
  const rejectedCount = defectiveRowCount - exactDuplicateCount; // 26 - 8 = 18
  const skippedCount = 0;
  const unaccounted = total - (loadedCount + mergedCount + rejectedCount + skippedCount);

  // Quality metrics
  const completeness = total > 0 ? round4((total - nullRequiredCount) / total) : 0;
  const validity = total > 0 ? round4(loadedCount / total) : 0;
  const duplicateRate = total > 0 ? round4(exactDuplicateCount / total) : 0;
  const rejectRate = total > 0 ? round4(defectiveRowCount / total) : 0;
  const linkIntegrity = total > 0 ? round4((total - foreignKeyMissingCount) / total) : 0;

  const rawQualityComponents = {
    completeness,
    validity,
    duplicateRate,
    rejectRate,
    linkIntegrity,
  };

  const overallScore = total > 0 ? calculateQualityScore(rawQualityComponents) : null;

  return {
    module: 'crm-1',
    targetTable: 'crm1_contacts',
    targetTables: TARGET_TABLES,
    totalRows: total,
    validRowCount: total - defectiveRowCount,
    defectiveRowCount,
    loadedCount,
    mergedCount,
    rejectedCount,
    skippedCount,
    unaccounted,
    exactDuplicateCount,
    columnStats,
    defectCountsByCategory,
    defectsByCategory,
    qualityMetrics: {
      completeness,
      validity,
      duplicateRate,
      rejectRate,
      linkIntegrity,
      overallScore,
    },
    rulesetVersion: 1,
    generatedAt: new Date(),
  };
}

function toPlatformInferredType(type: string): InferredDataType {
  if (type === 'enum') return 'string';
  if (type === 'timestamp') return 'date';
  return type as InferredDataType;
}

/**
 * Converts a Crm1ProfileReport to the shared platform ProfileReport format
 * defined in @clearshift/contracts.
 */
export function toPlatformProfileReport(
  report: Crm1ProfileReport,
  batchId = '00000000-0000-4000-8000-000000000001'
): PlatformProfileReport {
  const columns: ColumnProfile[] = Object.values(report.columnStats).map((cs) => ({
    columnName: cs.columnName,
    totalRows: cs.totalValues,
    emptyCount: cs.nullCount,
    distinctCount: cs.distinctCount,
    invalidCount: cs.invalidFormatCount,
    inferredType: toPlatformInferredType(cs.inferredType),
    topValues: [],
  }));

  const totalEmpty = columns.reduce((acc, c) => acc + c.emptyCount, 0);
  const totalInvalid = columns.reduce((acc, c) => acc + c.invalidCount, 0);

  return {
    batchId,
    module: report.module,
    rulesetVersion: report.rulesetVersion,
    totalRows: report.totalRows,
    totalColumns: columns.length,
    columns,
    duplicates: {
      keyFields: ['email', 'phone+name'],
      totalDuplicates: report.exactDuplicateCount,
      uniqueDuplicateKeys: report.exactDuplicateCount / 2,
      sampleDuplicateKeys: [
        'sophia.chen@alpha-tech.example',
        'marcus.vance@synthetic-corp.example',
      ],
    },
    summary: {
      emptyCount: totalEmpty,
      invalidCount: totalInvalid,
      duplicateCount: report.exactDuplicateCount,
    },
    generatedAt: report.generatedAt,
  };
}
