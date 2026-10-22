import { createHash } from 'node:crypto';
import {
  CrmModuleSchema,
  MigrationRunStatusSchema,
  MigrationStepSchema,
} from '@clearshift/contracts';
import { AppError } from '@cs/kernel';

export type FieldType = 'string' | 'integer' | 'numeric' | 'date' | 'json' | 'uuid';

export interface FieldMapping {
  source: string;
  target: string;
  type: FieldType;
  required?: boolean;
  enumName?: keyof typeof ENUMS;
  defaultValue?: string | number;
  omitWhenBlank?: boolean;
}

export interface MappingTemplate {
  id: string;
  name: string;
  version: number;
  entity: 'crm5_runs' | 'crm5_scores';
  fields: readonly FieldMapping[];
}

export interface MappingError {
  field: string;
  code: string;
  message: string;
}

export type MappingResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: MappingError[] };

const INT32_MAX = 2147483647;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export const ENUMS = {
  status: {
    allowlist: MigrationRunStatusSchema.options as readonly string[],
    translations: {
      in_progress: 'running', 'in-progress': 'running', active: 'running', processing: 'running',
      queued: 'pending', waiting: 'pending', created: 'pending',
      success: 'completed', done: 'completed', finished: 'completed', ok: 'completed',
      error: 'failed', aborted: 'failed', fail: 'failed',
      paused: 'halted', stopped: 'halted', suspended: 'halted', load_halted: 'halted',
    } as Record<string, string>,
  },
  step: {
    allowlist: MigrationStepSchema.options as readonly string[],
    translations: {
      extraction: 'extract', ingest: 'extract',
      profiling: 'profile', analyze: 'profile',
      cleansing: 'clean', normalize: 'clean',
      mapping: 'map', transform: 'map',
      loading: 'load', import: 'load',
      validation: 'validate', verify: 'validate',
      reconciliation: 'reconcile', audit: 'reconcile',
    } as Record<string, string>,
  },
  module: {
    allowlist: CrmModuleSchema.options as readonly string[],
    translations: {
      crm1: 'crm-1', crm2: 'crm-2', crm3: 'crm-3', crm4: 'crm-4', crm5: 'crm-5',
      crm_1: 'crm-1', crm_2: 'crm-2', crm_3: 'crm-3', crm_4: 'crm-4', crm_5: 'crm-5',
    } as Record<string, string>,
  },
} as const;

export const CRM5_RUNS_V1: MappingTemplate = {
  id: 'crm5-runs-canonical',
  name: 'CRM-5 Runs Canonical',
  version: 1,
  entity: 'crm5_runs',
  fields: [
    { source: 'id', target: 'id', type: 'uuid' },
    { source: 'batch_id', target: 'batchId', type: 'string', required: true },
    { source: 'module', target: 'module', type: 'string', required: true, enumName: 'module' },
    { source: 'step', target: 'step', type: 'string', required: true, enumName: 'step' },
    { source: 'status', target: 'status', type: 'string', enumName: 'status', defaultValue: 'pending' },
    { source: 'records_in', target: 'recordsIn', type: 'integer', defaultValue: 0 },
    { source: 'records_out', target: 'recordsOut', type: 'integer', defaultValue: 0 },
    { source: 'records_rejected', target: 'recordsRejected', type: 'integer', defaultValue: 0 },
    { source: 'started_at', target: 'startedAt', type: 'date', omitWhenBlank: true },
    { source: 'completed_at', target: 'completedAt', type: 'date' },
    { source: 'metadata', target: 'metadata', type: 'json' },
  ],
};

export const CRM5_RUNS_LEGACY_V1: MappingTemplate = {
  id: 'crm5-runs-legacy',
  name: 'CRM-5 Runs Legacy Export',
  version: 1,
  entity: 'crm5_runs',
  fields: [
    { source: 'RunId', target: 'id', type: 'uuid' },
    { source: 'BatchId', target: 'batchId', type: 'string', required: true },
    { source: 'TargetModule', target: 'module', type: 'string', required: true, enumName: 'module' },
    { source: 'PipelinePhase', target: 'step', type: 'string', required: true, enumName: 'step' },
    { source: 'ExecutionState', target: 'status', type: 'string', enumName: 'status', defaultValue: 'pending' },
    { source: 'TotalSourceRows', target: 'recordsIn', type: 'integer', defaultValue: 0 },
    { source: 'SuccessfulRows', target: 'recordsOut', type: 'integer', defaultValue: 0 },
    { source: 'FailedRows', target: 'recordsRejected', type: 'integer', defaultValue: 0 },
    { source: 'StartTime', target: 'startedAt', type: 'date', omitWhenBlank: true },
    { source: 'EndTime', target: 'completedAt', type: 'date' },
    { source: 'ContextDetails', target: 'metadata', type: 'json' },
  ],
};

export const CRM5_SCORES_V1: MappingTemplate = {
  id: 'crm5-scores-canonical',
  name: 'CRM-5 Scores Canonical',
  version: 1,
  entity: 'crm5_scores',
  fields: [
    { source: 'batch_id', target: 'batchId', type: 'string', required: true },
    { source: 'module', target: 'module', type: 'string', required: true, enumName: 'module' },
    { source: 'completeness', target: 'completeness', type: 'numeric' },
    { source: 'validity', target: 'validity', type: 'numeric' },
    { source: 'duplicate_rate', target: 'duplicateRate', type: 'numeric' },
    { source: 'reject_rate', target: 'rejectRate', type: 'numeric' },
    { source: 'link_integrity', target: 'linkIntegrity', type: 'numeric' },
  ],
};

export const MAPPING_TEMPLATES: readonly MappingTemplate[] = [CRM5_RUNS_V1, CRM5_RUNS_LEGACY_V1, CRM5_SCORES_V1];

export function getTemplate(id: string, version?: number): MappingTemplate | undefined {
  const matches = MAPPING_TEMPLATES.filter((t) => t.id === id && (version === undefined || t.version === version));
  return matches.sort((a, b) => b.version - a.version)[0];
}

export function templateChecksum(t: MappingTemplate): string {
  return createHash('sha256').update(JSON.stringify(t)).digest('hex');
}

export function assertDryRunReady(t: MappingTemplate, sourceColumns: readonly string[]): void {
  const columns = new Set(sourceColumns.map((c) => c.trim()));
  const missing = t.fields.filter((f) => f.required && !columns.has(f.source));
  if (missing.length) {
    throw new AppError(
      'MAPPING_INCOMPLETE',
      `Unmapped required target fields for ${t.id}@${t.version}`,
      400,
      missing.map((f) => ({ field: f.target, code: 'MISSING_SOURCE_COLUMN', message: `source column "${f.source}" not found` })),
    );
  }
}

function translate(name: keyof typeof ENUMS, raw: string): string | null {
  const { allowlist, translations } = ENUMS[name];
  const key = raw.trim().toLowerCase();
  const value = translations[key] ?? key;
  return allowlist.includes(value) ? value : null;
}

function coerce(f: FieldMapping, raw: string): { value: unknown } | { code: string; message: string } {
  const bad = (code: string) => ({ code, message: `"${raw}" is not a valid ${f.type}` });
  switch (f.type) {
    case 'string':
      return { value: raw };
    case 'uuid':
      return UUID.test(raw) ? { value: raw.toLowerCase() } : bad('INVALID_UUID');
    case 'integer': {
      const n = Number(raw);
      return /^-?\d+$/.test(raw) && n >= 0 && n <= INT32_MAX ? { value: n } : bad('INVALID_INTEGER');
    }
    case 'numeric': {
      const n = Number(raw);
      return raw !== '' && Number.isFinite(n) ? { value: Math.round(n * 10000) / 10000 } : bad('INVALID_NUMERIC');
    }
    case 'date':
      return ISO_TS.test(raw) && !Number.isNaN(Date.parse(raw)) ? { value: new Date(raw) } : bad('INVALID_DATE');
    case 'json':
      try {
        return { value: JSON.parse(raw) as unknown };
      } catch {
        return bad('INVALID_JSON');
      }
  }
}

export function mapRow(source: Readonly<Record<string, unknown>>, t: MappingTemplate): MappingResult {
  const value: Record<string, unknown> = {};
  const errors: MappingError[] = [];

  for (const f of t.fields) {
    const raw = source[f.source] === null || source[f.source] === undefined ? '' : String(source[f.source]).trim();
    if (raw === '') {
      if (f.required) {
        errors.push({ field: f.target, code: 'MISSING_REQUIRED_FIELD', message: `${f.source} is required` });
      } else if (!f.omitWhenBlank) {
        value[f.target] = f.defaultValue ?? null;
      }
      continue;
    }
    let input = raw;
    if (f.enumName) {
      const translated = translate(f.enumName, raw);
      if (translated === null) {
        errors.push({ field: f.target, code: 'INVALID_ENUM_VALUE', message: `"${raw}" is not in the ${f.enumName} allowlist` });
        continue;
      }
      input = translated;
    }
    const result = coerce(f, input);
    if ('value' in result) value[f.target] = result.value;
    else errors.push({ field: f.target, ...result });
  }

  return errors.length ? { ok: false, errors } : { ok: true, value };
}
