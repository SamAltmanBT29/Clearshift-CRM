import type {
  FastifyPluginAsync,
  FastifyRequest,
  FastifyReply,
  FastifyInstance,
} from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  type CRM3Ticket,
  type CRM3TicketRead,
  type CRM3Note,
  type CRM3ImportBatch,
  type CRM3ImportReceipt,
  type CRM3TicketStatus,
  type CRM3TicketPriority,
  CRM3TicketCreateSchema,
  CRM3TicketPatchSchema,
  CRM3NoteCreateSchema,
  CRM3TicketListQuerySchema,
  CRM3NoteListQuerySchema,
  CRM3ImportBatchSchema,
  CRM3_API_PREFIX,
  assertValidTicketStatus,
  assertValidTicketPriority,
} from './crm-3.js';
import {
  createErrorEnvelope,
  StandardErrorCodes,
} from './common.js';

// ---------------------------------------------------------------------------
// 1. Deterministic Synthetic Fixture Generators
// ---------------------------------------------------------------------------

export function createDeterministicMockTickets(): CRM3TicketRead[] {
  const baseTimestamp = new Date('2026-10-01T10:00:00Z').getTime();
  const statuses: CRM3TicketStatus[] = ['New', 'Open', 'Waiting', 'Solved', 'Closed'];
  const priorities: CRM3TicketPriority[] = ['Low', 'Normal', 'High', 'Urgent'];
  const contacts = [
    {
      id: '90000000-0000-4000-8000-000000000001',
      name: 'Sarah Connor',
      email: 'sarah.connor@clearshift.synthetic',
    },
    {
      id: '90000000-0000-4000-8000-000000000002',
      name: 'Lars Lindqvist',
      email: 'lars.lindqvist@clearshift.synthetic',
    },
  ];

  const tickets: CRM3TicketRead[] = [];
  for (let i = 1; i <= 30; i++) {
    const hexIndex = i.toString(16).padStart(12, '0');
    const id = `30000000-0000-4000-8000-${hexIndex}`;
    const createdAt = new Date(baseTimestamp + i * 3600000).toISOString();
    const status = statuses[(i - 1) % statuses.length] ?? 'New';
    const priority = priorities[(i - 1) % priorities.length] ?? 'Normal';
    const contact = contacts[(i - 1) % contacts.length]!;

    tickets.push({
      id,
      subject: `Synthetic Support Issue #${i}: Integration connectivity`,
      status,
      priority,
      contactId: contact.id,
      contactName: contact.name,
      contactEmail: contact.email,
      orderRef: i % 2 === 0 ? `ORD-${2000 + i}` : null,
      sourceSystem: 'jira_migration',
      sourceId: `JIRA-TCK-${1000 + i}`,
      createdAt,
      updatedAt: createdAt,
    });
  }
  return tickets;
}

export function createDeterministicMockNotes(): CRM3Note[] {
  const baseTimestamp = new Date('2026-10-01T10:00:00Z').getTime();
  const notes: CRM3Note[] = [];

  for (let i = 1; i <= 30; i++) {
    const hexIndex = i.toString(16).padStart(12, '0');
    const ticketId = `30000000-0000-4000-8000-${hexIndex}`;

    const note1Id = `40000000-0000-4000-8000-${(i * 2 - 1).toString(16).padStart(12, '0')}`;
    const note2Id = `40000000-0000-4000-8000-${(i * 2).toString(16).padStart(12, '0')}`;

    notes.push({
      id: note1Id,
      ticketId,
      authorId: 'agent.sarah@clearshift.synthetic',
      noteText: `Diagnostic note #1 for ticket #${i}`,
      createdAt: new Date(baseTimestamp + i * 3600000 + 60000).toISOString(),
    });

    notes.push({
      id: note2Id,
      ticketId,
      authorId: 'agent.marcus@clearshift.synthetic',
      noteText: `Resolution proposal #2 for ticket #${i}`,
      createdAt: new Date(baseTimestamp + i * 3600000 + 120000).toISOString(),
    });
  }
  return notes;
}

// ---------------------------------------------------------------------------
// 2. In-Memory Mock State Store
// ---------------------------------------------------------------------------

export class Crm3MockStateStore {
  public tickets: CRM3TicketRead[] = [];
  public notes: CRM3Note[] = [];
  public batches = new Map<
    string,
    {
      batch: CRM3ImportBatch;
      receipts: CRM3ImportReceipt[];
    }
  >();

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.tickets = createDeterministicMockTickets();
    this.notes = createDeterministicMockNotes();
    this.batches.clear();
  }
}

// ---------------------------------------------------------------------------
// 3. Fastify Mock Server Plugin
// ---------------------------------------------------------------------------

export interface Crm3MockServerOptions {
  store?: Crm3MockStateStore;
  prefix?: string;
}

export const crm3MockServerPlugin: FastifyPluginAsync<Crm3MockServerOptions> = async (
  fastify: FastifyInstance,
  options: Crm3MockServerOptions = {}
) => {
  const store = options.store ?? new Crm3MockStateStore();

  const registerRoutes = async (app: FastifyInstance) => {
    // -------------------------------------------------------------------------
    // Health Check
    // -------------------------------------------------------------------------
    app.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.status(200).send({
        status: 'healthy',
        module: 'crm-3',
        mockServer: true,
        entities: {
          tickets: store.tickets.length,
          notes: store.notes.length,
          batches: store.batches.size,
        },
      });
    });

    // -------------------------------------------------------------------------
    // Tickets API
    // -------------------------------------------------------------------------
    app.get('/tickets', async (request: FastifyRequest, reply: FastifyReply) => {
      const queryResult = CRM3TicketListQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Invalid ticket list query parameters',
            details: queryResult.error.issues,
          })
        );
      }

      const { status, priority, contactId, search, page = 1, pageSize = 25 } =
        queryResult.data;

      let filtered = [...store.tickets];

      if (status) {
        assertValidTicketStatus(status);
        filtered = filtered.filter((t) => t.status === status);
      }

      if (priority) {
        assertValidTicketPriority(priority);
        filtered = filtered.filter((t) => t.priority === priority);
      }

      if (contactId) {
        filtered = filtered.filter((t) => t.contactId === contactId);
      }

      if (search && search.trim().length > 0) {
        const q = search.trim().toLowerCase();
        filtered = filtered.filter(
          (t) =>
            t.subject.toLowerCase().includes(q) ||
            (t.orderRef && t.orderRef.toLowerCase().includes(q))
        );
      }

      // Deterministic sort: newest first, tie-break by id DESC
      filtered.sort((a, b) => {
        const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (timeDiff !== 0) return timeDiff;
        return b.id.localeCompare(a.id);
      });

      const total = filtered.length;
      const startIndex = (page - 1) * pageSize;
      const items = filtered.slice(startIndex, startIndex + pageSize);

      return reply.status(200).send({
        items,
        page,
        pageSize,
        total,
      });
    });

    app.get(
      '/tickets/:id',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const { id } = request.params;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(id)) {
          return reply.status(400).send(
            createErrorEnvelope({
              code: StandardErrorCodes.VALIDATION_ERROR,
              message: 'Invalid ticket UUID parameter',
            })
          );
        }

        const found = store.tickets.find((t) => t.id === id);
        if (!found) {
          return reply.status(404).send(
            createErrorEnvelope({
              code: StandardErrorCodes.NOT_FOUND,
              message: `Ticket with id '${id}' not found`,
            })
          );
        }
        return reply.status(200).send(found);
      }
    );

    app.post('/tickets', async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = CRM3TicketCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Validation failed for ticket creation',
            details: parsed.error.issues,
          })
        );
      }

      const body = parsed.data;
      const now = new Date().toISOString();
      const newTicket: CRM3TicketRead = {
        id: randomUUID(),
        subject: body.subject,
        status: body.status,
        priority: body.priority,
        contactId: body.contactId,
        contactName: 'Synthetic Contact',
        contactEmail: 'contact@clearshift.synthetic',
        orderRef: body.orderRef ?? null,
        sourceSystem: body.sourceSystem ?? 'mock_server',
        sourceId: body.sourceId ?? `mock_${Date.now()}`,
        createdAt: now,
        updatedAt: now,
      };

      store.tickets.unshift(newTicket);

      if (body.note) {
        store.notes.unshift({
          id: randomUUID(),
          ticketId: newTicket.id,
          authorId: 'mock-agent',
          noteText: body.note,
          createdAt: now,
        });
      }

      return reply.status(201).send(newTicket);
    });

    app.patch(
      '/tickets/:id',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const { id } = request.params;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(id)) {
          return reply.status(400).send(
            createErrorEnvelope({
              code: StandardErrorCodes.VALIDATION_ERROR,
              message: 'Invalid ticket UUID parameter',
            })
          );
        }

        const idx = store.tickets.findIndex((t) => t.id === id);
        if (idx === -1) {
          return reply.status(404).send(
            createErrorEnvelope({
              code: StandardErrorCodes.NOT_FOUND,
              message: `Ticket with id '${id}' not found`,
            })
          );
        }

        const parsed = CRM3TicketPatchSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send(
            createErrorEnvelope({
              code: StandardErrorCodes.VALIDATION_ERROR,
              message: 'Validation failed for ticket patch',
              details: parsed.error.issues,
            })
          );
        }

        const patch = parsed.data;
        const current = store.tickets[idx]!;

        const updated: CRM3TicketRead = {
          ...current,
          subject: patch.subject !== undefined ? patch.subject.trim() : current.subject,
          status: patch.status !== undefined ? patch.status : current.status,
          priority: patch.priority !== undefined ? patch.priority : current.priority,
          contactId: patch.contactId !== undefined ? patch.contactId : current.contactId,
          orderRef:
            patch.orderRef !== undefined
              ? patch.orderRef === null
                ? null
                : patch.orderRef.trim()
              : current.orderRef,
          updatedAt: new Date().toISOString(),
        };

        store.tickets[idx] = updated;
        return reply.status(200).send(updated);
      }
    );

    // -------------------------------------------------------------------------
    // Notes API
    // -------------------------------------------------------------------------
    app.get(
      '/tickets/:id/notes',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const { id } = request.params;
        const ticketExists = store.tickets.some((t) => t.id === id);
        if (!ticketExists) {
          return reply.status(404).send(
            createErrorEnvelope({
              code: StandardErrorCodes.NOT_FOUND,
              message: `Ticket with id '${id}' not found`,
            })
          );
        }

        const queryResult = CRM3NoteListQuerySchema.safeParse(request.query);
        if (!queryResult.success) {
          return reply.status(400).send(
            createErrorEnvelope({
              code: StandardErrorCodes.VALIDATION_ERROR,
              message: 'Invalid note list query parameters',
              details: queryResult.error.issues,
            })
          );
        }

        const { page = 1, pageSize = 25 } = queryResult.data;
        const ticketNotes = store.notes.filter((n) => n.ticketId === id);

        ticketNotes.sort((a, b) => {
          const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          if (timeDiff !== 0) return timeDiff;
          return b.id.localeCompare(a.id);
        });

        const total = ticketNotes.length;
        const startIndex = (page - 1) * pageSize;
        const items = ticketNotes.slice(startIndex, startIndex + pageSize);

        return reply.status(200).send({
          items,
          page,
          pageSize,
          total,
        });
      }
    );

    app.post('/notes', async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = CRM3NoteCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Validation failed for note creation',
            details: parsed.error.issues,
          })
        );
      }

      const body = parsed.data;
      const ticketExists = store.tickets.some((t) => t.id === body.ticketId);
      if (!ticketExists) {
        return reply.status(404).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message: `Referenced ticket '${body.ticketId}' not found`,
          })
        );
      }

      const newNote: CRM3Note = {
        id: randomUUID(),
        ticketId: body.ticketId,
        authorId: body.authorId || 'mock-agent',
        noteText: body.noteText,
        createdAt: new Date().toISOString(),
      };

      store.notes.unshift(newNote);
      return reply.status(201).send(newNote);
    });

    app.post(
      '/tickets/:id/notes',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const { id } = request.params;
        const ticketExists = store.tickets.some((t) => t.id === id);
        if (!ticketExists) {
          return reply.status(404).send(
            createErrorEnvelope({
              code: StandardErrorCodes.NOT_FOUND,
              message: `Ticket with id '${id}' not found`,
            })
          );
        }

        const body = request.body as any;
        if (!body || typeof body.noteText !== 'string' || body.noteText.trim().length === 0) {
          return reply.status(400).send(
            createErrorEnvelope({
              code: StandardErrorCodes.VALIDATION_ERROR,
              message: 'Note text must be a non-empty string',
            })
          );
        }

        const newNote: CRM3Note = {
          id: randomUUID(),
          ticketId: id,
          authorId: body.authorId || 'mock-agent',
          noteText: body.noteText.trim(),
          createdAt: new Date().toISOString(),
        };

        store.notes.unshift(newNote);
        return reply.status(201).send(newNote);
      }
    );

    // -------------------------------------------------------------------------
    // Migration Kit Import Stubs
    // -------------------------------------------------------------------------
    app.post('/imports', async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as any;
      if (!body || !body.sourceSystem) {
        return reply.status(400).send(
          createErrorEnvelope({
            code: StandardErrorCodes.VALIDATION_ERROR,
            message: 'Import payload must specify sourceSystem',
          })
        );
      }

      const batchId = body.batchId || randomUUID();
      const rows = Array.isArray(body.rows) ? body.rows : [];

      const batch: CRM3ImportBatch = {
        id: batchId,
        sourceSystem: body.sourceSystem,
        status: 'completed',
        loadedCount: rows.length,
        rejectedCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };

      const receipts: CRM3ImportReceipt[] = rows.map((r: any, idx: number) => ({
        id: randomUUID(),
        batchId,
        sourceRow: r.sourceRow || idx + 1,
        entity: r.entity || 'ticket',
        sourceSystem: body.sourceSystem,
        sourceId: r.sourceId || `src_${idx + 1}`,
        targetId: randomUUID(),
        idempotencyKey: `batch_${batchId}_row_${idx + 1}`,
        createdAt: new Date().toISOString(),
      }));

      store.batches.set(batchId, { batch, receipts });
      return reply.status(201).send(batch);
    });

    app.get(
      '/imports/:batch',
      async (request: FastifyRequest<{ Params: { batch: string } }>, reply: FastifyReply) => {
        const { batch: batchId } = request.params;
        const record = store.batches.get(batchId);
        if (!record) {
          return reply.status(404).send(
            createErrorEnvelope({
              code: StandardErrorCodes.NOT_FOUND,
              message: `Import batch '${batchId}' not found`,
            })
          );
        }

        return reply.status(200).send({
          ...record.batch,
          receipts: record.receipts,
        });
      }
    );
  };

  if (fastify.prefix && fastify.prefix.length > 0) {
    await registerRoutes(fastify);
  } else {
    await fastify.register(registerRoutes, {
      prefix: options.prefix ?? CRM3_API_PREFIX,
    });
  }
};
