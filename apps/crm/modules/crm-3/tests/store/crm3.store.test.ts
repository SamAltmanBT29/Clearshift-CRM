import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryCrm3Store, CRM3_STORE_MAX_PAGE_SIZE } from '../../src/store/crm3.store.js';
import { ConflictError, DomainValidationError, TicketNotFoundError } from '../../src/domain/errors.js';
import { makeTicket, makeNote, factoryTicketId, factoryTime } from '../factories/crm3.factories.js';

const BATCH_ID = '72000000-0000-4000-8000-000000000001';

const batch = (id = BATCH_ID) => ({
  id,
  sourceSystem: 'legacy-csv',
  status: 'processing' as const,
  idempotencyKey: null,
  requestHash: null,
  loadedCount: 0,
  rejectedCount: 0,
  createdAt: factoryTime(0),
  updatedAt: factoryTime(0),
  completedAt: null,
});

const receipt = (sourceRow: number, key: string, targetId = factoryTicketId(1)) => ({
  id: `73000000-0000-4000-8000-${sourceRow.toString(16).padStart(12, '0')}`,
  batchId: BATCH_ID,
  sourceRow,
  entity: 'ticket' as const,
  sourceSystem: 'legacy-csv',
  sourceId: `row-${sourceRow}`,
  targetId,
  idempotencyKey: key,
  payloadHash: 'a'.repeat(64),
  createdAt: factoryTime(sourceRow),
});

describe('CRM-3 repository layer: InMemoryCrm3Store (#28 / CRM3-02)', () => {
  let store: InMemoryCrm3Store;

  beforeEach(() => {
    store = new InMemoryCrm3Store();
  });

  describe('factories', () => {
    it('are deterministic: the same sequence yields identical records', () => {
      expect(makeTicket(5)).toEqual(makeTicket(5));
      expect(makeNote(3, factoryTicketId(5))).toEqual(makeNote(3, factoryTicketId(5)));
      expect(makeTicket(5).id).not.toBe(makeTicket(6).id);
    });
  });

  describe('ticket queries', () => {
    beforeEach(() => {
      store.insertTicket(makeTicket(1, { subject: 'Printer jam', status: 'Open' }));
      store.insertTicket(makeTicket(2, { subject: 'Refund request', priority: 'High', orderRef: 'ORD-55' }));
      store.insertTicket(makeTicket(3, { subject: 'printer offline', status: 'Open', contactId: '90000000-0000-4000-8000-000000000002' }));
    });

    it('returns tickets newest first with a total', () => {
      const page = store.listTickets({}, { page: 1, pageSize: 10 });
      expect(page.total).toBe(3);
      expect(page.items.map((t) => t.id)).toEqual([factoryTicketId(3), factoryTicketId(2), factoryTicketId(1)]);
    });

    it('breaks createdAt ties by id descending', () => {
      store.clear();
      store.insertTicket(makeTicket(1, { createdAt: factoryTime(0) }));
      store.insertTicket(makeTicket(2, { createdAt: factoryTime(0) }));
      expect(store.listTickets({}, { page: 1, pageSize: 10 }).items.map((t) => t.id)).toEqual([
        factoryTicketId(2),
        factoryTicketId(1),
      ]);
    });

    it('filters by status, priority and contact, and searches subject/orderRef case-insensitively', () => {
      expect(store.listTickets({ status: 'Open' }, { page: 1, pageSize: 10 }).total).toBe(2);
      expect(store.listTickets({ priority: 'High' }, { page: 1, pageSize: 10 }).total).toBe(1);
      expect(
        store.listTickets({ contactId: '90000000-0000-4000-8000-000000000002' }, { page: 1, pageSize: 10 }).total
      ).toBe(1);
      expect(store.listTickets({ search: 'PRINTER' }, { page: 1, pageSize: 10 }).total).toBe(2);
      expect(store.listTickets({ search: 'ord-55' }, { page: 1, pageSize: 10 }).total).toBe(1);
      expect(store.listTickets({ search: 'factory' }, { page: 1, pageSize: 10 }).total).toBe(0);
    });

    it('pages without overlap', () => {
      const first = store.listTickets({}, { page: 1, pageSize: 2 });
      const second = store.listTickets({}, { page: 2, pageSize: 2 });
      expect(first.items).toHaveLength(2);
      expect(second.items).toHaveLength(1);
      expect(new Set([...first.items, ...second.items].map((t) => t.id)).size).toBe(3);
    });

    it.each([
      [{ page: 0, pageSize: 10 }],
      [{ page: 1, pageSize: 0 }],
      [{ page: 1, pageSize: CRM3_STORE_MAX_PAGE_SIZE + 1 }],
      [{ page: 1.5, pageSize: 10 }],
    ])('rejects unbounded or invalid page request %j', (page) => {
      expect(() => store.listTickets({}, page)).toThrow(DomainValidationError);
      expect(() => store.listNotes(factoryTicketId(1), page)).toThrow(DomainValidationError);
    });

    it('returns null for a missing ticket or source key', () => {
      expect(store.getTicket(factoryTicketId(99))).toBeNull();
      expect(store.findTicketBySourceKey('factory', 'nope')).toBeNull();
      expect(store.findTicketBySourceKey('factory', 'factory-ticket-2')?.id).toBe(factoryTicketId(2));
    });
  });

  describe('ticket constraints (mirror crm3_v1.sql)', () => {
    it('rejects an empty subject', () => {
      expect(() => store.insertTicket(makeTicket(1, { subject: '  ' }))).toThrow(DomainValidationError);
    });

    it('rejects a half-filled source key pair', () => {
      expect(() => store.insertTicket(makeTicket(1, { sourceId: null }))).toThrow(/both be set/);
      expect(() => store.insertTicket(makeTicket(2, { sourceSystem: null }))).toThrow(/both be set/);
      store.insertTicket(makeTicket(3, { sourceSystem: null, sourceId: null }));
      store.insertTicket(makeTicket(4, { sourceSystem: null, sourceId: null }));
      expect(store.listTickets({}, { page: 1, pageSize: 10 }).total).toBe(2);
    });

    it('rejects a duplicate source key with a 409 conflict', () => {
      store.insertTicket(makeTicket(1));
      try {
        store.insertTicket(makeTicket(2, { sourceId: 'factory-ticket-1' }));
        expect.unreachable('duplicate source key must be rejected');
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictError);
        expect(error).toMatchObject({ statusCode: 409, code: 'CONFLICT' });
      }
    });

    it('rejects a duplicate id and an update that would steal another source key', () => {
      store.insertTicket(makeTicket(1));
      store.insertTicket(makeTicket(2));
      expect(() => store.insertTicket(makeTicket(1))).toThrow(ConflictError);
      expect(() => store.updateTicket({ ...makeTicket(2), sourceId: 'factory-ticket-1' })).toThrow(ConflictError);
    });

    it('rejects updating a missing ticket with 404', () => {
      expect(() => store.updateTicket(makeTicket(9))).toThrow(TicketNotFoundError);
    });
  });

  describe('notes', () => {
    beforeEach(() => store.insertTicket(makeTicket(1)));

    it('lists notes newest first, per ticket', () => {
      store.insertNote(makeNote(1, factoryTicketId(1)));
      store.insertNote(makeNote(2, factoryTicketId(1)));
      const page = store.listNotes(factoryTicketId(1), { page: 1, pageSize: 10 });
      expect(page.items.map((n) => n.noteText)).toEqual(['Factory note 2', 'Factory note 1']);
      expect(store.getNote(makeNote(1, factoryTicketId(1)).id)).not.toBeNull();
    });

    it('rejects a note for a missing ticket (foreign key) and empty text/author', () => {
      expect(() => store.insertNote(makeNote(1, factoryTicketId(42)))).toThrow(TicketNotFoundError);
      expect(() => store.insertNote(makeNote(2, factoryTicketId(1), { noteText: ' ' }))).toThrow(DomainValidationError);
      expect(() => store.insertNote(makeNote(3, factoryTicketId(1), { authorId: '' }))).toThrow(DomainValidationError);
      expect(store.listNotes(factoryTicketId(1), { page: 1, pageSize: 10 }).total).toBe(0);
    });
  });

  describe('import batches and receipts', () => {
    it('requires an existing batch and unique key / batch row', () => {
      expect(() => store.insertImportReceipt(receipt(1, 'k1'))).toThrow(/batch/);
      store.insertImportBatch(batch());
      store.insertImportReceipt(receipt(1, 'k1'));
      expect(() => store.insertImportReceipt(receipt(2, 'k1'))).toThrow(ConflictError);
      expect(() => store.insertImportReceipt(receipt(1, 'k2'))).toThrow(ConflictError);
      expect(store.listImportReceipts(BATCH_ID)).toHaveLength(1);
      expect(store.getImportReceiptByRow(BATCH_ID, 1, 'ticket')?.idempotencyKey).toBe('k1');
    });

    it('rejects duplicate batches and updates of missing batches', () => {
      store.insertImportBatch(batch());
      expect(() => store.insertImportBatch(batch())).toThrow(ConflictError);
      expect(() => store.updateImportBatch(batch('72000000-0000-4000-8000-000000000999'))).toThrow(/not found/);
      store.updateImportBatch({ ...batch(), status: 'completed' });
      expect(store.getImportBatch(BATCH_ID)?.status).toBe('completed');
    });
  });

  describe('transactions', () => {
    it('commits every write when fn succeeds', () => {
      store.transaction(() => {
        store.insertTicket(makeTicket(1));
        store.insertNote(makeNote(1, factoryTicketId(1)));
      });
      expect(store.getTicket(factoryTicketId(1))).not.toBeNull();
      expect(store.listNotes(factoryTicketId(1), { page: 1, pageSize: 10 }).total).toBe(1);
    });

    it('undoes every write across tickets, notes, batches and receipts when fn throws', () => {
      store.insertTicket(makeTicket(1));
      expect(() =>
        store.transaction(() => {
          store.insertTicket(makeTicket(2));
          store.insertNote(makeNote(1, factoryTicketId(2)));
          store.updateTicket({ ...makeTicket(1), subject: 'Changed inside transaction' });
          store.insertImportBatch(batch());
          store.insertImportReceipt(receipt(1, 'k1', factoryTicketId(2)));
          throw new Error('boom');
        })
      ).toThrow('boom');

      expect(store.getTicket(factoryTicketId(2))).toBeNull();
      expect(store.getNote(makeNote(1, factoryTicketId(2)).id)).toBeNull();
      expect(store.getTicket(factoryTicketId(1))?.subject).toBe('Factory ticket 1');
      expect(store.getImportBatch(BATCH_ID)).toBeNull();
      expect(store.getImportReceiptByKey('k1')).toBeNull();
    });

    it('nested calls join the outer transaction', () => {
      expect(() =>
        store.transaction(() => {
          store.transaction(() => store.insertTicket(makeTicket(1)));
          throw new Error('outer fails');
        })
      ).toThrow('outer fails');
      expect(store.getTicket(factoryTicketId(1))).toBeNull();
    });

    it('a constraint violation inside a transaction rolls back earlier writes', () => {
      expect(() =>
        store.transaction(() => {
          store.insertTicket(makeTicket(1));
          store.insertNote(makeNote(1, factoryTicketId(1), { noteText: '' }));
        })
      ).toThrow(DomainValidationError);
      expect(store.getTicket(factoryTicketId(1))).toBeNull();
    });
  });
});
