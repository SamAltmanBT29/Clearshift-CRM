import { describe, it, expect, beforeEach } from 'vitest';
import type { CRM3Note, CRM3TicketCreate, CRM3TicketPatch } from '@clearshift/contracts';
import { Crm3Service } from '../../src/services/crm3.service.js';
import { InMemoryCrm3Store } from '../../src/store/crm3.store.js';
import { DomainValidationError, ConflictError, ContactReferenceError } from '../../src/domain/errors.js';
import {
  makeInvalidTicket,
  makeTicketCreateInput,
  FACTORY_OTHER_CONTACT_ID,
  type InvalidTicketKind,
} from '../factories/crm3.factories.js';

const SEED_TICKET = '30000000-0000-4000-8000-000000000001';

class NoteFailingStore extends InMemoryCrm3Store {
  public failNotes = false;
  override insertNote(note: CRM3Note): void {
    if (this.failNotes) throw new Error('note insert failed');
    super.insertNote(note);
  }
}

describe('CRM-3 service-level invariants (#28 / CRM3-05)', () => {
  let service: Crm3Service;
  const total = async (s: Crm3Service = service) => (await s.getTickets({ page: 1, pageSize: 100 })).total;

  beforeEach(() => {
    service = new Crm3Service();
  });

  describe('createTicket', () => {
    it('creates a ticket with contract defaults and trimmed values', async () => {
      const created = await service.createTicket(
        makeTicketCreateInput(1, { subject: '  Padded subject  ', orderRef: ' ORD-9 ' }),
        'agent-1'
      );
      expect(created).toMatchObject({ subject: 'Padded subject', orderRef: 'ORD-9', status: 'New', priority: 'Normal' });
      expect(created.createdAt).toBe(created.updatedAt);
    });

    it.each<[InvalidTicketKind, string]>([
      ['empty_subject', 'subject'],
      ['bad_status', 'status'],
      ['bad_priority', 'priority'],
      ['malformed_contact', 'contactId'],
      ['unknown_field', 'input'],
    ])('rejects %s with a 400 field-level error (not a raw Error) and writes nothing', async (kind, field) => {
      const before = await total();
      const promise = service.createTicket(makeInvalidTicket(kind) as unknown as CRM3TicketCreate);
      await expect(promise).rejects.toBeInstanceOf(DomainValidationError);
      await expect(
        service.createTicket(makeInvalidTicket(kind) as unknown as CRM3TicketCreate)
      ).rejects.toMatchObject({ statusCode: 400, details: [expect.objectContaining({ field })] });
      expect(await total()).toBe(before);
    });

    it('rejects a half source key (sourceSystem without sourceId) with 400', async () => {
      await expect(
        service.createTicket(makeInvalidTicket('half_source_key') as unknown as CRM3TicketCreate)
      ).rejects.toMatchObject({ statusCode: 400, details: [expect.objectContaining({ field: 'sourceId', code: 'check_violation' })] });
    });

    it('rejects a duplicate (sourceSystem, sourceId) with 409 and creates nothing', async () => {
      const before = await total();
      await expect(
        service.createTicket(makeInvalidTicket('duplicate_source_key') as unknown as CRM3TicketCreate)
      ).rejects.toBeInstanceOf(ConflictError);
      expect(await total()).toBe(before);
    });

    it('rejects an unknown contact with 422 and creates nothing', async () => {
      const before = await total();
      await expect(
        service.createTicket(makeTicketCreateInput(2, { contactId: '99999999-9999-4999-8999-999999999999' }))
      ).rejects.toBeInstanceOf(ContactReferenceError);
      expect(await total()).toBe(before);
    });

    it('creates the ticket and its initial note atomically: if the note fails, no ticket remains', async () => {
      const store = new NoteFailingStore();
      const atomic = new Crm3Service({ store });
      const before = await total(atomic);
      store.failNotes = true;

      await expect(
        atomic.createTicket(makeTicketCreateInput(3, { note: 'First note', sourceSystem: 'f', sourceId: 'atomic-1' }))
      ).rejects.toThrow('note insert failed');

      expect(await total(atomic)).toBe(before);
      expect(atomic.findBySourceKey('f', 'atomic-1')).toBeNull();
    });

    it('writes the initial note with the given author', async () => {
      const created = await service.createTicket(makeTicketCreateInput(4, { note: 'Initial context' }), 'agent-7');
      const notes = await service.getTicketNotes(created.id, { page: 1, pageSize: 25 });
      expect(notes.items).toEqual([expect.objectContaining({ authorId: 'agent-7', noteText: 'Initial context' })]);
    });
  });

  describe('updateTicket', () => {
    it('changes only allowlisted fields and refreshes updatedAt', async () => {
      const before = await service.getTicketById(SEED_TICKET);
      const updated = await service.updateTicket(SEED_TICKET, {
        subject: ' New subject ',
        priority: 'Urgent',
        orderRef: null,
        contactId: FACTORY_OTHER_CONTACT_ID,
      });
      expect(updated).toMatchObject({
        id: SEED_TICKET,
        subject: 'New subject',
        priority: 'Urgent',
        orderRef: null,
        contactId: FACTORY_OTHER_CONTACT_ID,
        status: before?.status,
        sourceSystem: before?.sourceSystem,
        sourceId: before?.sourceId,
        createdAt: before?.createdAt,
      });
      expect(updated.updatedAt > (before?.updatedAt ?? '')).toBe(true);
    });

    it.each<[string, Record<string, unknown>]>([
      ['empty body', {}],
      ['empty subject', { subject: '  ' }],
      ['invalid status', { status: 'Pending' }],
      ['invalid priority', { priority: 'Critical' }],
      ['malformed contact', { contactId: 'abc' }],
      ['protected field id', { id: SEED_TICKET }],
      ['protected field sourceId', { sourceId: 'x' }],
      ['protected field createdAt', { createdAt: '2026-01-01T00:00:00.000Z' }],
    ])('rejects %s with 400 and leaves the ticket unchanged', async (_label, patch) => {
      const before = await service.getTicketById(SEED_TICKET);
      await expect(service.updateTicket(SEED_TICKET, patch as CRM3TicketPatch)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(await service.getTicketById(SEED_TICKET)).toEqual(before);
    });

    it('rejects an unknown ticket with 404', async () => {
      await expect(
        service.updateTicket('00000000-0000-4000-8000-000000000999', { priority: 'Low' })
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('queries', () => {
    it.each<[string, Record<string, unknown>]>([
      ['pageSize above 100', { pageSize: 101 }],
      ['page 0', { page: 0 }],
      ['unknown status', { status: 'Pending' }],
      ['malformed contact filter', { contactId: 'abc' }],
    ])('getTickets rejects %s with 400', async (_label, query) => {
      await expect(service.getTickets(query as never)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('getTicketNotes rejects pageSize above 100 with 400', async () => {
      await expect(service.getTicketNotes(SEED_TICKET, { page: 1, pageSize: 500 })).rejects.toMatchObject({
        statusCode: 400,
      });
    });
  });

  it('accepts an injected store (repository port)', async () => {
    const store = new InMemoryCrm3Store();
    const injected = new Crm3Service({ store });
    expect(injected.getStore()).toBe(store);
    expect(store.listTickets({}, { page: 1, pageSize: 100 }).total).toBe(32);
  });
});
