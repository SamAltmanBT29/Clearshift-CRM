import { describe, it, expect, beforeEach } from 'vitest';
import { computeIdempotencyKey } from '@cs/core';
import { Crm3Service, DefaultSyntheticContactResolver } from '../../src/services/crm3.service.js';
import {
  Crm3TargetAdapter,
  buildCrm3IdempotencyKey,
  type Crm3ImportRow,
} from '../../src/migration/target-adapter.js';

const BATCH_ID = '50000000-0000-4000-8000-000000000002';

const row = (overrides: Partial<Crm3ImportRow> = {}): Crm3ImportRow => ({
  subject: 'Refund not received',
  status: 'Solved',
  priority: 'Normal',
  customerEmail: 'lars.lindqvist@example.test',
  text: 'Refund issued on 2026-09-30.',
  ...overrides,
});

class SlowEmailResolver extends DefaultSyntheticContactResolver {
  override async get<T = unknown>(entityType: string, id: string): Promise<T | null> {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return super.get<T>(entityType, id);
  }
}

describe('CRM-3 import idempotency and atomic receipts (#144 / CRM3-11)', () => {
  let service: Crm3Service;
  let adapter: Crm3TargetAdapter;

  beforeEach(() => {
    service = new Crm3Service();
    adapter = new Crm3TargetAdapter(service);
  });

  const ticketTotal = async (s: Crm3Service = service) => (await s.getTickets({ page: 1, pageSize: 100 })).total;

  it('builds keys with the shared @cs/core builder from batch, row, entity and schema version', () => {
    expect(buildCrm3IdempotencyKey(BATCH_ID, 7)).toBe(computeIdempotencyKey(BATCH_ID, 7, 'ticket', '1'));
    expect(buildCrm3IdempotencyKey(BATCH_ID, 7, 'note')).toBe(computeIdempotencyKey(BATCH_ID, 7, 'note', '1'));
    expect(buildCrm3IdempotencyKey(BATCH_ID, 7)).not.toBe(buildCrm3IdempotencyKey(BATCH_ID, 8));
  });

  it('replaying the same row and key 3 times creates one ticket, one note and returns the same receipt', async () => {
    const key = buildCrm3IdempotencyKey(BATCH_ID, 1);
    const before = await ticketTotal();

    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await adapter.importRow(BATCH_ID, 1, key, row()));
    }

    expect(results.every((r) => r.ok)).toBe(true);
    const targetIds = new Set(results.map((r) => (r.ok ? r.value.targetId : '')));
    expect(targetIds.size).toBe(1);
    expect(await ticketTotal()).toBe(before + 1);
    expect(service.listImportReceipts(BATCH_ID)).toHaveLength(2);

    const [targetId] = [...targetIds];
    expect((await service.getTicketNotes(targetId!, { page: 1, pageSize: 25 })).total).toBe(1);
    const first = results[0];
    const last = results[2];
    if (first?.ok && last?.ok) {
      expect(last.value.receipt).toEqual(first.value.receipt);
    }
  });

  it('treats a whitespace/case-only email difference as the same canonical payload', async () => {
    const key = buildCrm3IdempotencyKey(BATCH_ID, 1);
    await adapter.importRow(BATCH_ID, 1, key, row());
    const replay = await adapter.importRow(BATCH_ID, 1, key, row({ customerEmail: '  LARS.Lindqvist@example.test' }));
    expect(replay.ok).toBe(true);
    expect(service.listImportReceipts(BATCH_ID)).toHaveLength(2);
  });

  it('rejects the same key with a different payload (IDEMPOTENCY_CONFLICT) and changes nothing', async () => {
    const key = buildCrm3IdempotencyKey(BATCH_ID, 1);
    const first = await adapter.importRow(BATCH_ID, 1, key, row());
    expect(first.ok).toBe(true);
    const stateBefore = JSON.stringify(await service.getTickets({ page: 1, pageSize: 100 }));

    const conflict = await adapter.importRow(BATCH_ID, 1, key, row({ subject: 'Different subject' }));
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.reasonCode).toBe('IDEMPOTENCY_CONFLICT');

    expect(JSON.stringify(await service.getTickets({ page: 1, pageSize: 100 }))).toBe(stateBefore);
    expect(service.listImportReceipts(BATCH_ID)).toHaveLength(2);
  });

  it('rejects the same batch row under a different key (IDEMPOTENCY_CONFLICT)', async () => {
    await adapter.importRow(BATCH_ID, 1, buildCrm3IdempotencyKey(BATCH_ID, 1), row());
    const result = await adapter.importRow(BATCH_ID, 1, 'some-other-key', row({ sourceId: 'other' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reasonCode).toBe('IDEMPOTENCY_CONFLICT');
    expect(service.listImportReceipts(BATCH_ID)).toHaveLength(2);
  });

  it('concurrent replays of one row still create exactly one ticket', async () => {
    const slow = new Crm3Service({ contactResolver: new SlowEmailResolver() });
    const slowAdapter = new Crm3TargetAdapter(slow);
    const key = buildCrm3IdempotencyKey(BATCH_ID, 1);
    const before = await ticketTotal(slow);

    const results = await Promise.all([
      slowAdapter.importRow(BATCH_ID, 1, key, row()),
      slowAdapter.importRow(BATCH_ID, 1, key, row()),
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    expect(await ticketTotal(slow)).toBe(before + 1);
    expect(slow.listImportReceipts(BATCH_ID)).toHaveLength(2);
  });

  describe('atomicity: ticket, note and receipts commit together', () => {
    it('leaves no ticket, note, batch or receipt when the receipt write fails', async () => {
      const failing = new Crm3Service({
        onBeforeImportReceiptCommit: () => {
          throw new Error('receipt insert failed');
        },
      });
      const failingAdapter = new Crm3TargetAdapter(failing);
      const before = JSON.stringify(await failing.getTickets({ page: 1, pageSize: 100 }));

      const result = await failingAdapter.importRow(BATCH_ID, 1, buildCrm3IdempotencyKey(BATCH_ID, 1), row());

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.reasonCode).toBe('TARGET_UNAVAILABLE');
      expect(JSON.stringify(await failing.getTickets({ page: 1, pageSize: 100 }))).toBe(before);
      expect(failing.findBySourceKey('legacy-csv', `${BATCH_ID}:1`)).toBeNull();
      expect(failing.listImportReceipts(BATCH_ID)).toEqual([]);
      expect(failing.getImportBatch(BATCH_ID)).toBeNull();
    });

    it('a retry with the same key after a failed commit loads the row once', async () => {
      let failNext = true;
      const flaky = new Crm3Service({
        onBeforeImportReceiptCommit: () => {
          if (failNext) {
            failNext = false;
            throw new Error('transient receipt failure');
          }
        },
      });
      const flakyAdapter = new Crm3TargetAdapter(flaky);
      const key = buildCrm3IdempotencyKey(BATCH_ID, 1);
      const before = await ticketTotal(flaky);

      const first = await flakyAdapter.importRow(BATCH_ID, 1, key, row());
      const retry = await flakyAdapter.importRow(BATCH_ID, 1, key, row());

      expect(first.ok).toBe(false);
      expect(retry.ok).toBe(true);
      expect(await ticketTotal(flaky)).toBe(before + 1);
      expect(flaky.listImportReceipts(BATCH_ID)).toHaveLength(2);
    });
  });
});
