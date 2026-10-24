import { describe, it, expect, beforeEach } from 'vitest';
import { BatchExecutionReportSchema, CRM3ImportBatchSchema } from '@clearshift/contracts';
import { Crm3Service, DefaultSyntheticContactResolver } from '../../src/services/crm3.service.js';
import {
  Crm3TargetAdapter,
  buildCrm3IdempotencyKey,
  type Crm3ImportRow,
} from '../../src/migration/target-adapter.js';
import {
  executeCrm3BatchLoad,
  calculateBackoffDelay,
  chunkRows,
  type Crm3BatchLoadReport,
  type Crm3BatchRowInput,
} from '../../src/domain/batch-loader.js';
import { DomainValidationError } from '../../src/domain/errors.js';

const BATCH_ID = '60000000-0000-4000-8000-000000000001';
const SARAH = 'sarah.connor@example.test';
const LARS = 'lars.lindqvist@example.test';

const ticketRow = (i: number, overrides: Partial<Crm3ImportRow> = {}): Crm3BatchRowInput => ({
  sourceRow: i,
  data: {
    subject: `Imported ticket ${i}`,
    status: 'Open',
    priority: 'Normal',
    customerEmail: SARAH,
    text: `History text for row ${i}`,
    ...overrides,
  },
});

const rows = (count: number, overrides: (i: number) => Partial<Crm3ImportRow> = () => ({})) =>
  Array.from({ length: count }, (_, idx) => ticketRow(idx + 1, overrides(idx + 1)));

/** Email lookup that throws (an outage, i.e. retryable) for emails in `down`. */
class FlakyEmailResolver extends DefaultSyntheticContactResolver {
  public down = new Set<string>();
  override async get<T = unknown>(entityType: string, id: string): Promise<T | null> {
    if (entityType === 'contact_by_email' && this.down.has(id)) {
      throw new Error('CRM-1 facade unavailable');
    }
    return super.get<T>(entityType, id);
  }
}

/** Records every importRow call so tests can check keys and attempt counts. */
class RecordingAdapter extends Crm3TargetAdapter {
  public calls: Array<{ sourceRow: number; key: string }> = [];
  override async importRow(batchId: string, sourceRow: number, key: string, data: Crm3ImportRow) {
    this.calls.push({ sourceRow, key });
    return super.importRow(batchId, sourceRow, key, data);
  }
}

function expectBalanced(report: Crm3BatchLoadReport) {
  const r = report.reconciliation;
  expect(r.unaccounted).toBe(0);
  expect(r.source).toBe(r.loaded + r.rejected + r.merged + r.skipped + r.notAttempted);
  expect(r.loaded).toBe(report.committedRecords);
  expect(r.rejected).toBe(report.failedRecords);
  expect(report.attemptedRecords).toBe(r.loaded + r.rejected);
  expect(BatchExecutionReportSchema.safeParse(report).success).toBe(true);
}

describe('CRM-3 batch loader (#146 / CRM3-13)', () => {
  let resolver: FlakyEmailResolver;
  let service: Crm3Service;
  let adapter: RecordingAdapter;
  let delays: number[];
  const sleep = async (ms: number) => {
    delays.push(ms);
  };

  beforeEach(() => {
    resolver = new FlakyEmailResolver();
    service = new Crm3Service({ contactResolver: resolver });
    adapter = new RecordingAdapter(service);
    delays = [];
  });

  const ticketReceipts = () => service.listImportReceipts(BATCH_ID).filter((r) => r.entity === 'ticket');

  describe('helpers', () => {
    it('chunks rows into consecutive groups of 500 by default', () => {
      const chunks = chunkRows(Array.from({ length: 1201 }, (_, i) => i));
      expect(chunks.map((c) => c.length)).toEqual([500, 500, 201]);
      expect(chunks.flat()).toHaveLength(1201);
      expect(() => chunkRows([1], 0)).toThrow();
    });

    it('backs off exponentially and stays bounded', () => {
      expect([0, 1, 2, 3, 4, 5, 10].map((a) => calculateBackoffDelay(a))).toEqual([50, 100, 200, 400, 800, 1000, 1000]);
      expect(calculateBackoffDelay(2, 10, 30)).toBe(30);
    });
  });

  it('loads 1,000 rows in exactly 2 chunks of 500 and completes the batch', async () => {
    const report = await executeCrm3BatchLoad({ batchId: BATCH_ID, rows: rows(1000) }, { adapter, sleep });

    expect(report.chunkSize).toBe(500);
    expect(report.chunksProcessed).toBe(2);
    expect(report).toMatchObject({
      status: 'COMPLETED',
      batchStatus: 'completed',
      totalRecords: 1000,
      attemptedRecords: 1000,
      committedRecords: 1000,
      failedRecords: 0,
      haltReason: null,
    });
    expect(report.reconciliation.result).toBe('OK');
    expectBalanced(report);
    expect(ticketReceipts()).toHaveLength(1000);

    const batch = service.getImportBatch(BATCH_ID);
    expect(CRM3ImportBatchSchema.safeParse(batch).success).toBe(true);
    expect(batch).toMatchObject({ status: 'completed', loadedCount: 1000, rejectedCount: 0 });
    expect(batch?.completedAt).not.toBeNull();
  });

  it('retries a transient failure with the same key and creates exactly one ticket', async () => {
    let failuresLeft = 2;
    const flaky = new Crm3Service({
      contactResolver: resolver,
      onBeforeImportReceiptCommit: () => {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          throw new Error('transient receipt write failure');
        }
      },
    });
    const flakyAdapter = new RecordingAdapter(flaky);

    const report = await executeCrm3BatchLoad({ batchId: BATCH_ID, rows: rows(1) }, { adapter: flakyAdapter, sleep });

    expect(report.status).toBe('COMPLETED');
    expect(report.committedRecords).toBe(1);
    expect(flakyAdapter.calls).toHaveLength(3);
    expect(new Set(flakyAdapter.calls.map((c) => c.key))).toEqual(new Set([buildCrm3IdempotencyKey(BATCH_ID, 1)]));
    expect(delays).toEqual([50, 100]);
    expect(flaky.listImportReceipts(BATCH_ID).filter((r) => r.entity === 'ticket')).toHaveLength(1);
    expect(flaky.findBySourceKey('legacy-csv', `${BATCH_ID}:1`)).not.toBeNull();
    expectBalanced(report);
  });

  it('gives up after maxRetries on a persistent outage and records the row as retryable-failed', async () => {
    resolver.down.add(LARS);
    const input = { batchId: BATCH_ID, rows: [ticketRow(1), ticketRow(2, { customerEmail: LARS })] };
    const report = await executeCrm3BatchLoad(input, { adapter, sleep });

    expect(adapter.calls.filter((c) => c.sourceRow === 2)).toHaveLength(4); // 1 try + 3 retries
    expect(delays).toEqual([50, 100, 200]);
    expect(report.failedRows).toEqual([
      expect.objectContaining({ sourceRow: 2, errorCode: 'TARGET_UNAVAILABLE', retryAttempts: 3 }),
    ]);
    expect(report.status).toBe('COMPLETED');
    expect(service.findBySourceKey('legacy-csv', `${BATCH_ID}:2`)).toBeNull();
    expectBalanced(report);
  });

  it('never retries bad-data rejects', async () => {
    const report = await executeCrm3BatchLoad(
      { batchId: BATCH_ID, rows: [ticketRow(1, { status: 'open' }), ticketRow(2, { customerEmail: 'ghost@example.test' })] },
      { adapter, sleep }
    );
    expect(adapter.calls).toHaveLength(2);
    expect(delays).toEqual([]);
    expect(report.failedRows.map((f) => [f.errorCode, f.retryAttempts])).toEqual([
      ['INVALID_STATUS', 0],
      ['CUSTOMER_UNRESOLVED', 0],
    ]);
    expect(report).toMatchObject({ status: 'FAILED', batchStatus: 'failed' });
    expectBalanced(report);
  });

  it('halts immediately once failures exceed 10% of at least 50 attempted rows and keeps committed rows', async () => {
    // Rows 1-45 valid, rows 46-100 invalid. At row 50: 5/50 = 10% (not above). At row 51: 6/51 > 10% -> halt.
    const input = { batchId: BATCH_ID, rows: rows(100, (i) => (i > 45 ? { status: 'Pending' } : {})) };
    const report = await executeCrm3BatchLoad(input, { adapter, sleep });

    expect(report).toMatchObject({
      status: 'STOPPED_EXCESSIVE_FAILURES',
      batchStatus: 'stopped_excessive_failures',
      attemptedRecords: 51,
      committedRecords: 45,
      failedRecords: 6,
    });
    expect(report.haltReason).toContain('51 attempted rows');
    expect(adapter.calls).toHaveLength(51);
    expect(report.reconciliation).toMatchObject({ notAttempted: 49, unaccounted: 0, result: 'PARTIAL' });
    expectBalanced(report);

    // No rollback: everything committed before the halt is still there with its receipts.
    expect(ticketReceipts()).toHaveLength(45);
    for (let i = 1; i <= 45; i++) {
      expect(service.findBySourceKey('legacy-csv', `${BATCH_ID}:${i}`)).not.toBeNull();
    }
    expect(service.getImportBatch(BATCH_ID)).toMatchObject({
      status: 'stopped_excessive_failures',
      loadedCount: 45,
      rejectedCount: 6,
      completedAt: null,
    });
  });

  it('does not halt before 50 rows have been attempted, even at 100% failure', async () => {
    const report = await executeCrm3BatchLoad(
      { batchId: BATCH_ID, rows: rows(49, () => ({ priority: 'Critical' })) },
      { adapter, sleep }
    );
    expect(report).toMatchObject({ status: 'FAILED', attemptedRecords: 49, failedRecords: 49, haltReason: null });
    expectBalanced(report);
  });

  it('a halted batch can be re-run after the outage and finishes with no duplicates', async () => {
    // Rows 1-40 use Sarah, rows 41-100 use Lars; Lars' lookup is down during the first run.
    const input = { batchId: BATCH_ID, rows: rows(100, (i) => (i > 40 ? { customerEmail: LARS } : {})) };
    resolver.down.add(LARS);

    const first = await executeCrm3BatchLoad(input, { adapter, sleep });
    expect(first).toMatchObject({ status: 'STOPPED_EXCESSIVE_FAILURES', committedRecords: 40, attemptedRecords: 50 });
    expectBalanced(first);
    const totalAfterFirst = (await service.getTickets({ page: 1, pageSize: 100 })).total;

    resolver.down.clear();
    const second = await executeCrm3BatchLoad(input, { adapter, sleep });

    expect(second).toMatchObject({ status: 'COMPLETED', committedRecords: 100, failedRecords: 0 });
    expectBalanced(second);
    expect(ticketReceipts()).toHaveLength(100);
    expect((await service.getTickets({ page: 1, pageSize: 100 })).total).toBe(totalAfterFirst + 60);
    expect(service.getImportBatch(BATCH_ID)).toMatchObject({ status: 'completed', loadedCount: 100, rejectedCount: 0 });

    // Rows 1-40 replayed to their original receipts.
    const firstIds = first.committedReceipts.map((r) => r.targetId);
    const secondIds = second.committedReceipts.slice(0, 40).map((r) => r.targetId);
    expect(secondIds).toEqual(firstIds);
  });

  it('re-running a completed batch creates nothing new', async () => {
    const input = { batchId: BATCH_ID, rows: rows(10) };
    await executeCrm3BatchLoad(input, { adapter, sleep });
    const before = (await service.getTickets({ page: 1, pageSize: 100 })).total;

    const again = await executeCrm3BatchLoad(input, { adapter, sleep });
    expect(again).toMatchObject({ status: 'COMPLETED', committedRecords: 10 });
    expect((await service.getTickets({ page: 1, pageSize: 100 })).total).toBe(before);
    expect(ticketReceipts()).toHaveLength(10);
  });

  it('uses a caller-supplied idempotency key unchanged', async () => {
    const input = { batchId: BATCH_ID, rows: [{ ...ticketRow(1), idempotencyKey: 'kit-key-row-1' }] };
    const report = await executeCrm3BatchLoad(input, { adapter, sleep });
    expect(adapter.calls[0]?.key).toBe('kit-key-row-1');
    expect(report.committedReceipts[0]?.idempotencyKey).toBe('kit-key-row-1');
  });

  it.each([
    ['a non-UUID batch id', { batchId: 'batch-1', rows: rows(1) }],
    ['no rows', { batchId: BATCH_ID, rows: [] }],
    ['duplicate source rows', { batchId: BATCH_ID, rows: [ticketRow(1), ticketRow(1)] }],
    ['chunk size above 1000', { batchId: BATCH_ID, rows: rows(1), chunkSize: 5000 }],
  ])('rejects %s before writing anything', async (_label, input) => {
    await expect(executeCrm3BatchLoad(input, { adapter, sleep })).rejects.toBeInstanceOf(DomainValidationError);
    expect(adapter.calls).toHaveLength(0);
    expect(service.getImportBatch(BATCH_ID)).toBeNull();
  });
});
