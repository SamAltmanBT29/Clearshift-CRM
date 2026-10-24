import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Roles, signAccessToken } from '@cs/identity';
import type { EventDeduplicator } from '@cs/core';
import {
  CRM3_API_PREFIX,
  CRM3EventTypes,
  EventEnvelopeSchema,
  TicketCreatedPayloadSchema,
  TicketUpdatedPayloadSchema,
  TicketStatusChangedPayloadSchema,
  TicketPriorityChangedPayloadSchema,
  TicketNoteAddedPayloadSchema,
  TicketImportBatchLoadedPayloadSchema,
  type EventEnvelope,
} from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import { Crm3Service } from '../../src/services/crm3.service.js';
import { Crm3AuditService } from '../../src/services/audit.js';
import { InMemoryCrm3Store } from '../../src/store/crm3.store.js';
import { Crm3TargetAdapter, buildCrm3IdempotencyKey } from '../../src/migration/target-adapter.js';
import { executeCrm3BatchLoad } from '../../src/domain/batch-loader.js';

const CONTACT = '90000000-0000-4000-8000-000000000001';
const OPEN_TICKET = '30000000-0000-4000-8000-000000000002';
const BATCH_ID = '80000000-0000-4000-8000-000000000001';
const SECRET_SUBJECT = 'Customer Jane says her card ending 4242 was charged twice';
const SECRET_NOTE = 'Called customer at +44 7700 900123, confirmed home address';

const PAYLOAD_SCHEMAS = {
  [CRM3EventTypes.TICKET_CREATED]: TicketCreatedPayloadSchema,
  [CRM3EventTypes.TICKET_UPDATED]: TicketUpdatedPayloadSchema,
  [CRM3EventTypes.TICKET_STATUS_CHANGED]: TicketStatusChangedPayloadSchema,
  [CRM3EventTypes.TICKET_PRIORITY_CHANGED]: TicketPriorityChangedPayloadSchema,
  [CRM3EventTypes.TICKET_NOTE_ADDED]: TicketNoteAddedPayloadSchema,
  [CRM3EventTypes.IMPORT_BATCH_LOADED]: TicketImportBatchLoadedPayloadSchema,
} as const;

class FailingOutboxStore extends InMemoryCrm3Store {
  public failOutbox = false;
  override appendOutboxEvent(envelope: EventEnvelope): void {
    if (this.failOutbox) throw new Error('outbox insert failed');
    super.appendOutboxEvent(envelope);
  }
}

function expectValidEvent(event: EventEnvelope) {
  expect(EventEnvelopeSchema.safeParse(event).success).toBe(true);
  const schema = PAYLOAD_SCHEMAS[event.eventType as keyof typeof PAYLOAD_SCHEMAS];
  expect(schema).toBeDefined();
  expect(schema.safeParse(event.payload).success).toBe(true);
  expect(event.version).toBe(1);
}

describe('CRM-3 transactional outbox events (CRM3-08)', () => {
  let store: FailingOutboxStore;
  let service: Crm3Service;
  let app: FastifyInstance;
  let headers: Record<string, string>;

  const outbox = () => store.listOutboxEvents(10_000);
  const types = () => outbox().map((e) => e.eventType);

  beforeEach(async () => {
    store = new FailingOutboxStore();
    service = new Crm3Service({ store });
    app = buildApp({ service, enforceAuth: true });
    await app.ready();
    const token = await signAccessToken('synthetic-editor', [Roles.EDITOR]);
    headers = { authorization: `Bearer ${token}`, 'x-correlation-id': 'corr-crm3-08' };
  });

  it('the seed itself emits no events', () => {
    expect(outbox()).toEqual([]);
  });

  describe('API create', () => {
    it('emits crm.ticket.created (and note_added for the initial note) with the shared envelope', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers,
        payload: { subject: SECRET_SUBJECT, contactId: CONTACT, priority: 'High', orderRef: 'ORD-1', note: SECRET_NOTE },
      });
      expect(response.statusCode).toBe(201);
      const ticket = response.json();

      expect(types()).toEqual([CRM3EventTypes.TICKET_CREATED, CRM3EventTypes.TICKET_NOTE_ADDED]);
      const [created, noteAdded] = outbox();
      for (const event of outbox()) expectValidEvent(event);

      // Catalog fields: event_id, event_type, schema_version, occurred_at, correlation_id, entity data.
      expect(created).toMatchObject({
        eventType: 'crm.ticket.created',
        aggregateType: 'Ticket',
        aggregateId: ticket.id,
        version: 1,
        correlationId: 'corr-crm3-08',
        payload: { ticketId: ticket.id, status: 'New', priority: 'High', contactId: CONTACT, orderRef: 'ORD-1' },
      });
      expect(created?.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(Date.parse(created?.timestamp ?? '')).not.toBeNaN();
      expect(noteAdded).toMatchObject({ aggregateType: 'Note', payload: { ticketId: ticket.id, authorId: 'synthetic-editor' } });
    });

    it('never puts subject or note text into any event', async () => {
      await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers,
        payload: { subject: SECRET_SUBJECT, contactId: CONTACT, note: SECRET_NOTE },
      });
      const json = JSON.stringify(outbox());
      expect(json).not.toContain('4242');
      expect(json).not.toContain('7700');
      expect(outbox()[0]?.payload).not.toHaveProperty('subject');
      expect(outbox()[1]?.payload).not.toHaveProperty('noteText');
    });

    it('uses a generated correlation id when none is sent', async () => {
      const created = await service.createTicket({ subject: 'No header', contactId: CONTACT, status: 'New', priority: 'Normal' });
      expect(outbox().find((e) => e.aggregateId === created.id)?.correlationId).toMatch(/^crm3-/);
    });
  });

  describe('API update', () => {
    it('status + priority change emits updated, status_changed and priority_changed', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${OPEN_TICKET}`,
        headers,
        payload: { status: 'Solved', priority: 'Urgent' },
      });
      expect(response.statusCode).toBe(200);
      expect(types()).toEqual([
        CRM3EventTypes.TICKET_UPDATED,
        CRM3EventTypes.TICKET_STATUS_CHANGED,
        CRM3EventTypes.TICKET_PRIORITY_CHANGED,
      ]);
      for (const event of outbox()) expectValidEvent(event);
      expect(outbox()[0]?.payload).toEqual({
        ticketId: OPEN_TICKET,
        status: 'Solved',
        priority: 'Urgent',
        updatedAt: response.json().updatedAt,
      });
      expect(outbox()[1]?.payload).toMatchObject({ previousStatus: 'Open', newStatus: 'Solved' });
      expect(outbox()[2]?.payload).toMatchObject({ previousPriority: 'Normal', newPriority: 'Urgent' });
      expect(new Set(outbox().map((e) => e.correlationId))).toEqual(new Set(['corr-crm3-08']));
    });

    it('a subject-only change emits crm.ticket.updated without the subject text', async () => {
      await service.updateTicket(OPEN_TICKET, { subject: SECRET_SUBJECT });
      expect(types()).toEqual([CRM3EventTypes.TICKET_UPDATED]);
      expect(outbox()[0]?.payload).not.toHaveProperty('subject');
      expect(JSON.stringify(outbox())).not.toContain('4242');
    });

    it('an edit that changes nothing (same status, same priority) emits nothing', async () => {
      await service.updateTicket(OPEN_TICKET, { status: 'Open', priority: 'Normal' });
      expect(outbox()).toEqual([]);
    });
  });

  it('adding a note emits crm.ticket.note_added without the text', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `${CRM3_API_PREFIX}/tickets/${OPEN_TICKET}/notes`,
      headers,
      payload: { noteText: SECRET_NOTE },
    });
    expect(response.statusCode).toBe(201);
    expect(types()).toEqual([CRM3EventTypes.TICKET_NOTE_ADDED]);
    expectValidEvent(outbox()[0]!);
    expect(outbox()[0]?.payload).toEqual({
      noteId: response.json().id,
      ticketId: OPEN_TICKET,
      authorId: 'synthetic-editor',
      createdAt: response.json().createdAt,
    });
  });

  describe('atomicity: the business write and its outbox row commit together', () => {
    it('create: if the outbox write fails, no ticket and no note are saved', async () => {
      const before = (await service.getTickets({ page: 1, pageSize: 100 })).total;
      store.failOutbox = true;
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers,
        payload: { subject: 'Atomic', contactId: CONTACT, note: 'n', sourceSystem: 'atomic', sourceId: 'a-1' },
      });
      expect(response.statusCode).toBe(500);
      expect((await service.getTickets({ page: 1, pageSize: 100 })).total).toBe(before);
      expect(service.findBySourceKey('atomic', 'a-1')).toBeNull();
    });

    it('update: if the outbox write fails, the ticket is unchanged', async () => {
      const before = await service.getTicketById(OPEN_TICKET);
      store.failOutbox = true;
      await expect(service.updateTicket(OPEN_TICKET, { status: 'Solved' })).rejects.toThrow('outbox insert failed');
      expect(await service.getTicketById(OPEN_TICKET)).toEqual(before);
    });

    it('note: if the outbox write fails, no note is saved', async () => {
      const before = (await service.getTicketNotes(OPEN_TICKET, { page: 1, pageSize: 100 })).total;
      store.failOutbox = true;
      await expect(service.addNote(OPEN_TICKET, 'text', 'agent')).rejects.toThrow('outbox insert failed');
      expect((await service.getTicketNotes(OPEN_TICKET, { page: 1, pageSize: 100 })).total).toBe(before);
    });

    it('import: if the outbox write fails, no ticket, note or receipt is saved and the row is retryable', async () => {
      const adapter = new Crm3TargetAdapter(service);
      store.failOutbox = true;
      const result = await adapter.importRow(BATCH_ID, 1, buildCrm3IdempotencyKey(BATCH_ID, 1), {
        subject: 'Imported',
        status: 'Closed',
        priority: 'Low',
        customerEmail: 'sarah.connor@example.test',
        text: 'history',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.reasonCode).toBe('TARGET_UNAVAILABLE');
      expect(service.listImportReceipts(BATCH_ID)).toEqual([]);
      expect(service.findBySourceKey('legacy-csv', `${BATCH_ID}:1`)).toBeNull();
    });
  });

  describe('migration import events', () => {
    const row = (i: number) => ({
      sourceRow: i,
      data: {
        subject: `Imported ${i}`,
        status: 'Solved',
        priority: 'Normal',
        customerEmail: 'sarah.connor@example.test',
        text: `history ${i}`,
      },
    });

    it('each loaded row emits ticket.created + note_added correlated to the batch; a replay emits nothing', async () => {
      const adapter = new Crm3TargetAdapter(service);
      const key = buildCrm3IdempotencyKey(BATCH_ID, 1);
      await adapter.importRow(BATCH_ID, 1, key, row(1).data);
      expect(types()).toEqual([CRM3EventTypes.TICKET_CREATED, CRM3EventTypes.TICKET_NOTE_ADDED]);
      expect(outbox().every((e) => e.correlationId === BATCH_ID)).toBe(true);

      await adapter.importRow(BATCH_ID, 1, key, row(1).data);
      expect(outbox()).toHaveLength(2);
    });

    it('a completed batch emits one crm.ticket.import_batch_loaded with its counts; a halted one emits none', async () => {
      const adapter = new Crm3TargetAdapter(service);
      const rows = Array.from({ length: 60 }, (_, i) => row(i + 1));
      // Rows 46-60 invalid -> halts at row 51 (6/51 > 10%).
      const dirty = rows.map((r) => (r.sourceRow > 45 ? { ...r, data: { ...r.data, status: 'open' } } : r));

      const halted = await executeCrm3BatchLoad({ batchId: BATCH_ID, rows: dirty }, { adapter, sleep: async () => {} });
      expect(halted.status).toBe('STOPPED_EXCESSIVE_FAILURES');
      expect(types()).not.toContain(CRM3EventTypes.IMPORT_BATCH_LOADED);

      const completed = await executeCrm3BatchLoad({ batchId: BATCH_ID, rows }, { adapter, sleep: async () => {} });
      expect(completed.status).toBe('COMPLETED');
      const batchEvents = outbox().filter((e) => e.eventType === CRM3EventTypes.IMPORT_BATCH_LOADED);
      expect(batchEvents).toHaveLength(1);
      expectValidEvent(batchEvents[0]!);
      expect(batchEvents[0]).toMatchObject({
        aggregateType: 'ImportBatch',
        aggregateId: BATCH_ID,
        correlationId: BATCH_ID,
        payload: { batchId: BATCH_ID, sourceSystem: 'legacy-csv', loadedCount: 60, rejectedCount: 0 },
      });
      // 60 tickets created once each, despite the first run + re-run.
      expect(outbox().filter((e) => e.eventType === CRM3EventTypes.TICKET_CREATED)).toHaveLength(60);
    });
  });

  describe('duplicate delivery', () => {
    it('every event has a unique, stable id and the outbox rejects a duplicate id', async () => {
      await service.createTicket({ subject: 'A', contactId: CONTACT, status: 'New', priority: 'Normal', note: 'x' });
      await service.updateTicket(OPEN_TICKET, { status: 'Solved', priority: 'High' });
      const ids = outbox().map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(() => store.appendOutboxEvent(outbox()[0]!)).toThrow(/already exists/);
    });

    it('a consumer deduplicating on event id applies each event once even if it is delivered twice', async () => {
      await service.updateTicket(OPEN_TICKET, { status: 'Solved' });
      const consumed = new Set<string>();
      const dedupe: EventDeduplicator = {
        isEventConsumed: async (_db, consumer, eventId) => consumed.has(`${consumer}:${eventId}`),
        recordConsumed: async (_db, consumer, eventId) => {
          consumed.add(`${consumer}:${eventId}`);
        },
      };
      const statusCounts = new Map<string, number>();
      const handle = async (event: EventEnvelope) => {
        if (await dedupe.isEventConsumed(null, 'crm-5-projection', event.id)) return;
        if (event.eventType === CRM3EventTypes.TICKET_STATUS_CHANGED) {
          const status = String(event.payload['newStatus']);
          statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
        }
        await dedupe.recordConsumed(null, 'crm-5-projection', event.id);
      };

      const delivered = [...outbox(), ...outbox()]; // at-least-once: every event twice
      for (const event of delivered) await handle(event);
      expect(statusCounts.get('Solved')).toBe(1);
    });
  });
});

describe('CRM-3 audit trail (CRM3-08)', () => {
  let service: Crm3Service;
  let audit: Crm3AuditService;

  beforeEach(() => {
    audit = new Crm3AuditService();
    service = new Crm3Service({ auditService: audit });
  });

  it('records create, update and note with actor, target and correlation id', async () => {
    const created = await service.createTicket(
      { subject: SECRET_SUBJECT, contactId: CONTACT, status: 'New', priority: 'Normal', note: SECRET_NOTE },
      'agent-1',
      { actorId: 'agent-1', correlationId: 'corr-a' }
    );
    await service.updateTicket(created.id, { status: 'Open', subject: 'Another secret subject 4242' }, { actorId: 'agent-2', correlationId: 'corr-b' });
    const note = await service.addNote(created.id, SECRET_NOTE, 'agent-3', { actorId: 'agent-3', correlationId: 'corr-c' });

    const records = await audit.query();
    expect(records.map((r) => [r.action, r.actor, r.correlationId, r.targetId])).toEqual([
      ['ticket.created', 'agent-1', 'corr-a', created.id],
      ['ticket.updated', 'agent-2', 'corr-b', created.id],
      ['note.added', 'agent-3', 'corr-c', note.id],
    ]);
    expect(records[1]?.metadata?.['changes']).toEqual({
      subject: '[changed]',
      status: { from: 'New', to: 'Open' },
    });
  });

  it('never stores subject text, note text or customer contact details', async () => {
    const created = await service.createTicket(
      { subject: SECRET_SUBJECT, contactId: CONTACT, status: 'New', priority: 'Normal', note: SECRET_NOTE },
      'agent-1'
    );
    await service.updateTicket(created.id, { subject: `${SECRET_SUBJECT} (edited)` });
    await service.addNote(created.id, SECRET_NOTE, 'agent-1');

    const json = JSON.stringify(await audit.query());
    expect(json).not.toContain('4242');
    expect(json).not.toContain('7700');
    expect(json).not.toContain('sarah.connor');
  });

  it('records load.requested and load.finished for a batch load', async () => {
    const adapter = new Crm3TargetAdapter(service);
    await executeCrm3BatchLoad(
      {
        batchId: BATCH_ID,
        actorId: 'runner-1',
        rows: [{ sourceRow: 1, data: { subject: 'x', status: 'New', priority: 'Low', customerEmail: 'sarah.connor@example.test' } }],
      },
      { adapter, sleep: async () => {} }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const batchRecords = await audit.query({ batchId: BATCH_ID });
    expect(batchRecords.map((r) => r.action)).toEqual(['load.requested', 'ticket.imported', 'load.finished']);
    expect(batchRecords[0]?.actor).toBe('runner-1');
  });

  it('a failing audit sink does not fail or undo the committed write', async () => {
    const broken = new Crm3AuditService({
      append: async () => {
        throw new Error('audit db down');
      },
      query: async () => [],
    } as never);
    const resilient = new Crm3Service({ auditService: broken });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const created = await resilient.createTicket({ subject: 'Still saved', contactId: CONTACT, status: 'New', priority: 'Normal' });
    expect(await resilient.getTicketById(created.id)).not.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('audit write failed for ticket.created'));
    errorSpy.mockRestore();
  });
});
