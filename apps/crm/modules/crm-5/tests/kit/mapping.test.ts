import { describe, it, expect } from 'vitest';
import {
  CRM5_RUNS_LEGACY_V1,
  CRM5_RUNS_V1,
  CRM5_SCORES_V1,
  assertDryRunReady,
  getTemplate,
  mapRow,
  templateChecksum,
} from '../../src/kit/mapping.js';

const row = {
  id: 'C5000001-0000-4000-8000-000000000001',
  batch_id: 'batch-1',
  module: 'CRM1',
  step: 'cleansing',
  status: 'in_progress',
  records_in: '1000',
  records_out: '950',
  records_rejected: '50',
  started_at: '2026-10-19T08:00:00.000Z',
  completed_at: '',
  metadata: '{"k":1}',
};

describe('CRM-5 mapping templates and enum translation (#201, [CRM5-28])', () => {
  it('maps a canonical row with coercion and enum translation', () => {
    const r = mapRow(row, CRM5_RUNS_V1);
    expect(r).toEqual({
      ok: true,
      value: {
        id: 'c5000001-0000-4000-8000-000000000001',
        batchId: 'batch-1',
        module: 'crm-1',
        step: 'clean',
        status: 'running',
        recordsIn: 1000,
        recordsOut: 950,
        recordsRejected: 50,
        startedAt: new Date('2026-10-19T08:00:00.000Z'),
        completedAt: null,
        metadata: { k: 1 },
      },
    });
  });

  it('maps the legacy export layout to the same target fields', () => {
    const r = mapRow(
      { BatchId: 'b-9', TargetModule: 'crm_2', PipelinePhase: 'import', ExecutionState: 'done', TotalSourceRows: '5' },
      CRM5_RUNS_LEGACY_V1,
    );
    expect(r.ok && r.value['module']).toBe('crm-2');
    expect(r.ok && r.value['step']).toBe('load');
    expect(r.ok && r.value['status']).toBe('completed');
  });

  it('applies defaults for blank optional fields', () => {
    const r = mapRow({ batch_id: 'b', module: 'crm-1', step: 'extract' }, CRM5_RUNS_V1);
    expect(r.ok && r.value['status']).toBe('pending');
    expect(r.ok && r.value['recordsIn']).toBe(0);
    expect(r.ok && 'startedAt' in r.value).toBe(false);
  });

  it('reports missing required fields', () => {
    const r = mapRow({ records_in: '1' }, CRM5_RUNS_V1);
    expect(!r.ok && r.errors.map((e) => e.field)).toEqual(['batchId', 'module', 'step']);
  });

  it('rejects values outside the enum allowlist', () => {
    const r = mapRow({ batch_id: 'b', module: 'salesforce', step: 'extract' }, CRM5_RUNS_V1);
    expect(!r.ok && r.errors[0]?.code).toBe('INVALID_ENUM_VALUE');
  });

  it('rejects invalid coercions', () => {
    const r = mapRow(
      { batch_id: 'b', module: 'crm-1', step: 'extract', records_in: '2147483648', started_at: '19/10/2026', metadata: '{x' },
      CRM5_RUNS_V1,
    );
    expect(!r.ok && r.errors.map((e) => e.code)).toEqual(['INVALID_INTEGER', 'INVALID_DATE', 'INVALID_JSON']);
  });

  it('maps scores with 4-decimal rounding', () => {
    const r = mapRow({ batch_id: 'b', module: 'crm3', completeness: '0.987654' }, CRM5_SCORES_V1);
    expect(r.ok && r.value['completeness']).toBe(0.9877);
    expect(r.ok && r.value['validity']).toBe(null);
  });

  it('blocks dry-run when a required source column is unmapped', () => {
    expect(() => assertDryRunReady(CRM5_RUNS_V1, ['id', 'batch_id', 'module'])).toThrow('Unmapped required');
    expect(() => assertDryRunReady(CRM5_RUNS_V1, ['batch_id', 'module', 'step'])).not.toThrow();
  });

  it('resolves templates by id and version with a stable checksum', () => {
    expect(getTemplate('crm5-runs-canonical')).toBe(CRM5_RUNS_V1);
    expect(getTemplate('crm5-runs-canonical', 2)).toBe(undefined);
    expect(templateChecksum(CRM5_RUNS_V1)).toBe(templateChecksum(CRM5_RUNS_V1));
    expect(templateChecksum(CRM5_RUNS_V1)).not.toBe(templateChecksum(CRM5_RUNS_LEGACY_V1));
  });

  it('is deterministic and does not mutate the source row', () => {
    const snapshot = JSON.stringify(row);
    const a = mapRow(row, CRM5_RUNS_V1);
    const b = mapRow(row, CRM5_RUNS_V1);
    expect(JSON.stringify(row)).toBe(snapshot);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
