import {
  CrmModuleSchema,
  MigrationRunStatusSchema,
  MigrationStepSchema,
  calculateQualityScore,
} from '@clearshift/contracts';

export interface RawRunRow {
  id?: unknown;
  batch_id?: unknown;
  module?: unknown;
  step?: unknown;
  status?: unknown;
  records_in?: unknown;
  records_out?: unknown;
  records_rejected?: unknown;
  started_at?: unknown;
  completed_at?: unknown;
  metadata?: unknown;
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
  module: 'crm-5';
  targetTable: 'crm5_runs';
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
  'id',
  'batch_id',
  'module',
  'step',
  'status',
  'records_in',
  'records_out',
  'records_rejected',
  'started_at',
  'completed_at',
  'metadata',
] as const;

export const DEFECT_CATEGORIES = [
  'NULL_REQUIRED',
  'EXACT_DUPLICATE',
  'FOREIGN_KEY_MISSING',
  'WHITESPACE_PADDING',
  'DATE_FORMAT_VARIANTS',
  'BOUNDARY_NUMBERS',
  'MALFORMED_UUID',
  'LOGICAL_COUNT_INVARIANT_VIOLATION',
  'CHRONOLOGICAL_SEQUENCE_VIOLATION',
  'MALFORMED_JSON_METADATA',
  'FORMULA_INJECTION_RISK',
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const INT = /^-?\d+$/;
const INT32_MAX = 2147483647;
const FORMULA = ['=', '@', '+', '-'];

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const blank = (v: unknown): boolean => text(v).trim() === '';
const padded = (v: unknown): boolean => /^\s|\s$|\t/.test(text(v));
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

function validIsoTs(v: unknown): boolean {
  if (blank(v)) return true;
  const s = text(v).trim();
  if (!ISO_TS.test(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s.slice(0, 10);
}

function validJson(v: unknown): boolean {
  if (blank(v)) return true;
  try {
    JSON.parse(text(v));
    return true;
  } catch {
    return false;
  }
}

function toInt(v: unknown): number | null {
  const s = text(v).trim();
  if (!INT.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

const ts = (v: unknown): number => new Date(text(v).trim()).getTime();

export function profileCrm5Batch(rows: readonly RawRunRow[]): ProfileReport {
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
  for (const c of DEFECT_CATEGORIES) defects[c] = [];

  const seenId = new Set<string>();
  const seenKey = new Set<string>();
  let defective = 0;
  let linked = 0;

  rows.forEach((row, i) => {
    const n = i + 1;
    const hit = new Set<string>();
    const flag = (cat: string, col?: string): void => {
      hit.add(cat);
      if (col) invalid[col] = (invalid[col] ?? 0) + 1;
    };

    for (const c of PROFILE_COLUMNS) {
      if (blank(row[c])) nulls[c] = (nulls[c] ?? 0) + 1;
      else distinct[c]?.add(text(row[c]));
    }

    const batch = text(row.batch_id).trim();
    const mod = text(row.module).trim();
    const step = text(row.step).trim();
    const id = text(row.id).trim();

    if (!batch || !mod || !step) flag('NULL_REQUIRED');

    let dup = false;
    if (id && UUID.test(id)) {
      if (seenId.has(id)) dup = true;
      seenId.add(id);
    }
    if (batch && step) {
      const key = `${batch}:${step}`;
      if (seenKey.has(key)) dup = true;
      seenKey.add(key);
    }
    if (dup) flag('EXACT_DUPLICATE');

    if (mod && batch) {
      if (!CrmModuleSchema.safeParse(mod).success || batch.includes('missing-fk')) {
        flag('FOREIGN_KEY_MISSING');
      } else linked++;
    }

    if (['module', 'batch_id', 'step', 'status'].some((c) => padded(row[c]))) flag('WHITESPACE_PADDING');

    if (!validIsoTs(row.started_at)) flag('DATE_FORMAT_VARIANTS', 'started_at');
    if (!validIsoTs(row.completed_at)) flag('DATE_FORMAT_VARIANTS', 'completed_at');

    const nums = [row.records_in, row.records_out, row.records_rejected].map((v) => (blank(v) ? 0 : toInt(v)));
    if (nums.some((v) => v === null || v < 0 || v > INT32_MAX)) flag('BOUNDARY_NUMBERS', 'records_in');
    else {
      const [rin = 0, rout = 0, rrej = 0] = nums as number[];
      if (rout + rrej > rin) flag('LOGICAL_COUNT_INVARIANT_VIOLATION');
    }

    if (id && !UUID.test(id)) flag('MALFORMED_UUID', 'id');

    if (!blank(row.started_at) && !blank(row.completed_at) && validIsoTs(row.started_at) && validIsoTs(row.completed_at)) {
      if (ts(row.completed_at) < ts(row.started_at)) flag('CHRONOLOGICAL_SEQUENCE_VIOLATION');
    }

    if (!validJson(row.metadata)) flag('MALFORMED_JSON_METADATA', 'metadata');

    if (FORMULA.some((p) => text(row.batch_id).startsWith(p))) flag('FORMULA_INJECTION_RISK');

    if (mod && !CrmModuleSchema.safeParse(mod).success) invalid['module'] = (invalid['module'] ?? 0) + 1;
    if (step && !MigrationStepSchema.safeParse(step).success) invalid['step'] = (invalid['step'] ?? 0) + 1;
    const status = text(row.status).trim();
    if (status && !MigrationRunStatusSchema.safeParse(status).success) invalid['status'] = (invalid['status'] ?? 0) + 1;

    for (const c of hit) defects[c]?.push(n);
    if (hit.size) defective++;
  });

  const columnStats: Record<string, ColumnProfileStats> = {};
  for (const c of PROFILE_COLUMNS) {
    const nc = nulls[c] ?? 0;
    const ic = invalid[c] ?? 0;
    columnStats[c] = {
      columnName: c,
      totalValues: total,
      nullCount: nc,
      nullRate: total ? round4(nc / total) : 0,
      distinctCount: distinct[c]?.size ?? 0,
      invalidFormatCount: ic,
      invalidFormatRate: total ? round4(ic / total) : 0,
    };
  }

  const defectCountsByCategory: Record<string, number> = {};
  const defectsByCategory: Record<string, DefectSummary> = {};
  for (const c of DEFECT_CATEGORIES) {
    const idx = defects[c] ?? [];
    defectCountsByCategory[c] = idx.length;
    defectsByCategory[c] = { category: c, count: idx.length, recordIndices: idx };
  }

  const rate = (num: number): number => (total ? round4(num / total) : 0);
  const exactDuplicateCount = defects['EXACT_DUPLICATE']?.length ?? 0;
  const q = {
    completeness: total ? rate(total - (defects['NULL_REQUIRED']?.length ?? 0)) : 0,
    validity: rate(total - defective),
    duplicateRate: rate(exactDuplicateCount),
    rejectRate: rate(defective),
    linkIntegrity: rate(linked),
  };

  return {
    module: 'crm-5',
    targetTable: 'crm5_runs',
    totalRows: total,
    validRowCount: total - defective,
    defectiveRowCount: defective,
    exactDuplicateCount,
    columnStats,
    defectCountsByCategory,
    defectsByCategory,
    qualityMetrics: { ...q, overallScore: total ? calculateQualityScore(q) : null },
  };
}
