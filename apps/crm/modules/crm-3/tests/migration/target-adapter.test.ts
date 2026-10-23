import { describe, it, expect, beforeEach } from 'vitest';
import { RowOutcome, evaluateReconciliation } from '@cs/kit';
import { CRM3ImportReceiptSchema, CRM3_TICKET_STATUSES } from '@clearshift/contracts';
import { Crm3Service, DefaultSyntheticContactResolver } from '../../src/services/crm3.service.js';
import {
  Crm3TargetAdapter,
  CRM3_DEFAULT_SOURCE_SYSTEM,
  CRM3_IMPORT_NOTE_AUTHOR,
  CRM3_IMPORT_REJECT_CODES,
  buildCrm3IdempotencyKey,
  isRetryableReasonCode,
  type Crm3ImportRow,
} from '../../src/migration/target-adapter.js';

const BATCH_ID = '50000000-0000-4000-8000-000000000001';
const SARAH = '90000000-0000-4000-8000-000000000001';

const validRow = (overrides: Partial<Crm3ImportRow> = {}): Crm3ImportRow => ({
  subject: 'Printer offline after firmware update',
  status: 'Open',
  priority: 'High',
  customerEmail: 'Sarah.Connor@Example.test ',
  text: 'Customer reports printer offline since Monday.',
  ...overrides,
});

describe('CRM-3 target adapter (#144 / CRM3-11)', () => {
  let service: Crm3Service;
  let adapter: Crm3TargetAdapter;

  beforeEach(() => {
    service = new Crm3Service({ contactResolver: new DefaultSyntheticContactResolver() });
    adapter = new Crm3TargetAdapter(service);
  });

  const countTickets = async () => (await service.getTickets({ page: 1, pageSize: 100 })).total;

  it('identifies itself to the Kit as crm-3 / ticket / schema v1', () => {
    expect(adapter.module).toBe('crm-3');
    expect(adapter.entity).toBe('ticket');
    expect(adapter.schemaVersion).toBe(1);
  });

  describe('importRow: successful load', () => {
    it('creates the ticket, its first note and both receipts', async () => {
      const key = buildCrm3IdempotencyKey(BATCH_ID, 1);
      const result = await adapter.importRow(BATCH_ID, 1, key, validRow());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const { targetId, receipt } = result.value;

      const ticket = await service.getTicketById(targetId);
      expect(ticket).toMatchObject({
        subject: 'Printer offline after firmware update',
        status: 'Open',
        priority: 'High',
        contactId: SARAH,
        contactName: 'Sarah Connor',
        orderRef: null,
        sourceSystem: CRM3_DEFAULT_SOURCE_SYSTEM,
        sourceId: `${BATCH_ID}:1`,
      });

      const notes = await service.getTicketNotes(targetId, { page: 1, pageSize: 25 });
      expect(notes.items).toHaveLength(1);
      expect(notes.items[0]).toMatchObject({
        authorId: CRM3_IMPORT_NOTE_AUTHOR,
        noteText: 'Customer reports printer offline since Monday.',
      });

      expect(receipt).toMatchObject({
        batchId: BATCH_ID,
        sourceRow: 1,
        entity: 'ticket',
        schemaVersion: 1,
        idempotencyKey: key,
        targetId,
        kind: 'created',
      });
      expect(receipt.createdAt).toBeInstanceOf(Date);

      const stored = service.listImportReceipts(BATCH_ID);
      expect(stored.map((r) => r.entity)).toEqual(['note', 'ticket']);
      for (const r of stored) {
        expect(CRM3ImportReceiptSchema.safeParse(r).success).toBe(true);
      }
      const noteReceipt = stored.find((r) => r.entity === 'note');
      expect(noteReceipt).toMatchObject({
        targetId: notes.items[0]?.id,
        idempotencyKey: buildCrm3IdempotencyKey(BATCH_ID, 1, 'note'),
      });
      expect(service.getImportBatch(BATCH_ID)).toMatchObject({ id: BATCH_ID, status: 'processing' });
    });

    it('keeps the source system/id and order reference when the row provides them', async () => {
      const result = await adapter.importRow(
        BATCH_ID,
        2,
        buildCrm3IdempotencyKey(BATCH_ID, 2),
        validRow({ sourceSystem: 'zendesk-export', sourceId: 'ZD-1001', orderRef: 'ORD-777' })
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(await service.getTicketById(result.value.targetId)).toMatchObject({
        sourceSystem: 'zendesk-export',
        sourceId: 'ZD-1001',
        orderRef: 'ORD-777',
      });
    });

    it('creates no note and one receipt when the row has no text', async () => {
      const result = await adapter.importRow(BATCH_ID, 3, buildCrm3IdempotencyKey(BATCH_ID, 3), validRow({ text: '  ' }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect((await service.getTicketNotes(result.value.targetId, { page: 1, pageSize: 25 })).total).toBe(0);
      expect(service.listImportReceipts(BATCH_ID).map((r) => r.entity)).toEqual(['ticket']);
    });

    it.each([...CRM3_TICKET_STATUSES])('may create a historical ticket directly in status %s', async (status) => {
      const row = CRM3_TICKET_STATUSES.indexOf(status) + 10;
      const result = await adapter.importRow(BATCH_ID, row, buildCrm3IdempotencyKey(BATCH_ID, row), validRow({ status }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect((await service.getTicketById(result.value.targetId))?.status).toBe(status);
    });

    it('shows the imported ticket in the read API immediately', async () => {
      const before = await countTickets();
      const result = await adapter.importRow(BATCH_ID, 4, buildCrm3IdempotencyKey(BATCH_ID, 4), validRow({ subject: 'Unique imported subject' }));
      expect(result.ok).toBe(true);
      const list = await service.getTickets({ page: 1, pageSize: 25, search: 'unique imported' });
      expect(list.total).toBe(1);
      expect(await countTickets()).toBe(before + 1);
    });
  });

  describe('importRow: rejects with stable reason codes and writes nothing', () => {
    it.each([
      ['EMPTY_SUBJECT', validRow({ subject: '   ' }), 'subject'],
      ['EMPTY_SUBJECT', validRow({ subject: null }), 'subject'],
      ['INVALID_STATUS', validRow({ status: 'open' }), 'status'],
      ['INVALID_STATUS', validRow({ status: 'NEW' }), 'status'],
      ['INVALID_STATUS', validRow({ status: undefined }), 'status'],
      ['INVALID_PRIORITY', validRow({ priority: 'Critical' }), 'priority'],
      ['INVALID_EMAIL', validRow({ customerEmail: '' }), 'customerEmail'],
      ['INVALID_EMAIL', validRow({ customerEmail: 'not-an-email' }), 'customerEmail'],
      ['CUSTOMER_UNRESOLVED', validRow({ customerEmail: 'nobody@example.test' }), 'customerEmail'],
    ] as const)('%s', async (reasonCode, row, field) => {
      const before = await countTickets();
      const result = await adapter.importRow(BATCH_ID, 1, buildCrm3IdempotencyKey(BATCH_ID, 1), row);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({ reasonCode, field });
      expect(isRetryableReasonCode(result.error.reasonCode)).toBe(false);
      expect(await countTickets()).toBe(before);
      expect(service.listImportReceipts(BATCH_ID)).toEqual([]);
      expect(service.getImportBatch(BATCH_ID)).toBeNull();
    });

    it('rejects a row that is not an object with INVALID_ROW', async () => {
      const result = await adapter.importRow(BATCH_ID, 1, 'key-1', 'subject,status' as unknown as Crm3ImportRow);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.reasonCode).toBe('INVALID_ROW');
    });

    it.each([
      ['INVALID_BATCH_ID', 'batch-7', 1, 'key-1'],
      ['INVALID_SOURCE_ROW', BATCH_ID, 0, 'key-1'],
      ['INVALID_SOURCE_ROW', BATCH_ID, 1.5, 'key-1'],
      ['INVALID_IDEMPOTENCY_KEY', BATCH_ID, 1, '  '],
    ])('%s for batch %s row %s', async (reasonCode, batchId, sourceRow, key) => {
      const result = await adapter.importRow(batchId, sourceRow, key, validRow());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.reasonCode).toBe(reasonCode);
    });

    it('rejects an existing (sourceSystem, sourceId) with DUPLICATE_SOURCE_KEY instead of updating it (create-only)', async () => {
      // Seed ticket #1 has source key (crm-3-seed, seed-ticket-1).
      const seeded = await service.getTicketById('30000000-0000-4000-8000-000000000001');
      const result = await adapter.importRow(
        BATCH_ID,
        5,
        buildCrm3IdempotencyKey(BATCH_ID, 5),
        validRow({ sourceSystem: 'crm-3-seed', sourceId: 'seed-ticket-1', subject: 'Changed subject' })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatchObject({ reasonCode: 'DUPLICATE_SOURCE_KEY', field: 'sourceId' });
      expect(await service.getTicketById('30000000-0000-4000-8000-000000000001')).toEqual(seeded);
      expect(service.listImportReceipts(BATCH_ID)).toEqual([]);
    });
  });

  describe('infrastructure failures are retryable and write nothing', () => {
    it('returns TARGET_UNAVAILABLE when the contact resolver fails', async () => {
      class EmailLookupDown extends DefaultSyntheticContactResolver {
        override async get<T = unknown>(entityType: string, id: string): Promise<T | null> {
          if (entityType === 'contact_by_email') throw new Error('CRM-1 facade unavailable');
          return super.get<T>(entityType, id);
        }
      }
      const failing = new Crm3Service({ contactResolver: new EmailLookupDown() });
      const failingAdapter = new Crm3TargetAdapter(failing);
      const before = (await failing.getTickets({ page: 1, pageSize: 100 })).total;

      const result = await failingAdapter.importRow(BATCH_ID, 1, buildCrm3IdempotencyKey(BATCH_ID, 1), validRow());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.reasonCode).toBe('TARGET_UNAVAILABLE');
      expect(isRetryableReasonCode(result.error.reasonCode)).toBe(true);
      expect((await failing.getTickets({ page: 1, pageSize: 100 })).total).toBe(before);
      expect(failing.listImportReceipts(BATCH_ID)).toEqual([]);
    });
  });

  describe('preflight (dry run)', () => {
    it('counts valid and rejected rows and changes nothing', async () => {
      const ticketsBefore = JSON.stringify(await service.getTickets({ page: 1, pageSize: 100 }));
      const rows: Crm3ImportRow[] = [
        validRow(),
        validRow({ customerEmail: 'nobody@example.test' }),
        validRow({ status: 'open' }),
        validRow({ customerEmail: 'lars.lindqvist@example.test', sourceSystem: 'zd', sourceId: 'A-1' }),
        validRow({ sourceSystem: 'zd', sourceId: 'A-1' }),
        validRow({ sourceSystem: 'crm-3-seed', sourceId: 'seed-ticket-2' }),
      ];

      const result = await adapter.preflight(BATCH_ID, rows);
      expect(result).toEqual({ ok: true, value: { validCount: 2, rejectCount: 4 } });

      const detail = await adapter.assessRows(BATCH_ID, rows);
      expect(detail.ok && detail.value.map((a) => a.reasonCode ?? 'valid')).toEqual([
        'valid',
        'CUSTOMER_UNRESOLVED',
        'INVALID_STATUS',
        'valid',
        'DUPLICATE_SOURCE_KEY',
        'DUPLICATE_SOURCE_KEY',
      ]);

      expect(JSON.stringify(await service.getTickets({ page: 1, pageSize: 100 }))).toBe(ticketsBefore);
      expect(service.listImportReceipts(BATCH_ID)).toEqual([]);
      expect(service.getImportBatch(BATCH_ID)).toBeNull();
    });

    it('fails as a whole, not as bad rows, when the resolver is down', async () => {
      const failingAdapter = new Crm3TargetAdapter(
        new Crm3Service({
          contactResolver: {
            exists: async () => true,
            get: async () => {
              throw new Error('timeout');
            },
          },
        })
      );
      const result = await failingAdapter.preflight(BATCH_ID, [validRow()]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.reasonCode).toBe('TARGET_UNAVAILABLE');
    });

    it('rejects a non-UUID batch id', async () => {
      const result = await adapter.preflight('not-a-uuid', [validRow()]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.reasonCode).toBe(CRM3_IMPORT_REJECT_CODES.INVALID_BATCH_ID);
    });
  });

  describe('row outcome accounting', () => {
    it('gives every source row exactly one outcome so the equation balances', async () => {
      const rows: Crm3ImportRow[] = [
        validRow({ subject: 'Row 1' }),
        validRow({ subject: '' }),
        validRow({ subject: 'Row 3', customerEmail: 'lars.lindqvist@example.test' }),
        validRow({ subject: 'Row 4', customerEmail: 'ghost@example.test' }),
        validRow({ subject: 'Row 5', priority: 'urgent' }),
      ];
      const outcomes: string[] = [];
      for (const [i, row] of rows.entries()) {
        const res = await adapter.importRow(BATCH_ID, i + 1, buildCrm3IdempotencyKey(BATCH_ID, i + 1), row);
        outcomes.push(res.ok ? RowOutcome.LOADED : RowOutcome.REJECTED);
      }

      const counts = {
        source: rows.length,
        loaded: outcomes.filter((o) => o === RowOutcome.LOADED).length,
        rejected: outcomes.filter((o) => o === RowOutcome.REJECTED).length,
        merged: 0,
        skipped: 0,
        pending: 0,
      };
      expect(counts).toMatchObject({ loaded: 2, rejected: 3 });
      expect(evaluateReconciliation(counts)).toEqual({ unaccounted: 0, result: 'OK' });
      expect(service.listImportReceipts(BATCH_ID).filter((r) => r.entity === 'ticket')).toHaveLength(2);
    });
  });
});
