import { randomUUID } from 'node:crypto';
import type { ReferenceResolver } from '@cs/kernel';
import {
  type CRM3Ticket,
  type CRM3TicketRead,
  type CRM3Note,
  type CRM3TicketCreate,
  type CRM3TicketPatch,
  type CRM3TicketListQuery,
  type CRM3NoteListQuery,
  type CRM3TicketListResponse,
  type CRM3NoteListResponse,
  type CRM3TicketStatus,
  type CRM3TicketPriority,
  type CRM3ImportBatch,
  type CRM3ImportReceipt,
  type CRM3EntityType,
  assertValidTicketStatus,
  assertValidTicketPriority,
} from '@clearshift/contracts';
import {
  TicketNotFoundError,
  NoteNotFoundError,
  DomainValidationError,
  ConflictError,
} from '../domain/errors.js';
import {
  assertTicketStatusTransition,
  assertValidContactReference,
  assertTicketExists,
} from '../domain/relationships.js';

export interface Crm3ServiceOptions {
  contactResolver?: ReferenceResolver;
  /**
   * Test hook called inside the atomic import commit after the ticket and note are staged and
   * before receipts are recorded. Throwing from it simulates a failed receipt write.
   */
  onBeforeImportReceiptCommit?: () => void;
}

/** Import receipt as stored by CRM-3, plus the canonical payload hash used for replay checks. */
export interface Crm3StoredImportReceipt extends CRM3ImportReceipt {
  payloadHash: string;
}

export interface Crm3TicketImportCommand {
  batchId: string;
  sourceRow: number;
  sourceSystem: string;
  sourceId: string;
  ticketIdempotencyKey: string;
  noteIdempotencyKey: string;
  payloadHash: string;
  subject: string;
  status: CRM3TicketStatus;
  priority: CRM3TicketPriority;
  contactId: string;
  orderRef: string | null;
  noteText: string | null;
  noteAuthorId: string;
}

export type Crm3TicketImportCommit =
  | { kind: 'created'; ticket: CRM3Ticket; receipts: Crm3StoredImportReceipt[] }
  | { kind: 'existing_receipt'; receipt: Crm3StoredImportReceipt }
  | { kind: 'duplicate_source_key'; existingTicketId: string };

/**
 * ReferenceResolver entity type for looking up a CRM-1 contact by normalized email
 * (`get(CONTACT_BY_EMAIL_ENTITY, email)` returns `{ id, email }` or null). Used by the
 * migration import path to turn the source "customer email" into a contact id.
 */
export const CONTACT_BY_EMAIL_ENTITY = 'contact_by_email';

/**
 * Synthetic CRM-1 contact resolver for standalone operation and testing.
 */
export class DefaultSyntheticContactResolver implements ReferenceResolver {
  private contacts = new Map<string, { firstName: string; lastName: string; email: string }>([
    [
      '90000000-0000-4000-8000-000000000001',
      { firstName: 'Sarah', lastName: 'Connor', email: 'sarah.connor@example.test' },
    ],
    [
      '90000000-0000-4000-8000-000000000002',
      { firstName: 'Lars', lastName: 'Lindqvist', email: 'lars.lindqvist@example.test' },
    ],
    [
      'cnt-1234',
      { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.test' },
    ],
  ]);

  async exists(entityType: string, id: string): Promise<boolean> {
    if (entityType === 'contact') {
      return this.contacts.has(id);
    }
    return false;
  }

  async get<T = unknown>(entityType: string, id: string): Promise<T | null> {
    if (entityType === 'contact') {
      const c = this.contacts.get(id);
      if (c) {
        return {
          id,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
        } as unknown as T;
      }
    }
    if (entityType === CONTACT_BY_EMAIL_ENTITY) {
      // Exact match on the normalized email (no fuzzy matching in V1).
      const email = id.trim().toLowerCase();
      for (const [contactId, c] of this.contacts) {
        if (c.email.toLowerCase() === email) {
          return { id: contactId, email: c.email } as unknown as T;
        }
      }
    }
    return null;
  }

  registerContact(id: string, firstName: string, lastName: string, email: string): void {
    this.contacts.set(id, { firstName, lastName, email });
  }
}

/**
 * CRM-3 Support Tickets & Activities Business Service
 * Encapsulates ticket domain rules, note append-only semantics, deterministic pagination,
 * and newest-first note ordering.
 */
export class Crm3Service {
  private tickets: CRM3Ticket[] = [];
  private notes: CRM3Note[] = [];
  private importBatches: CRM3ImportBatch[] = [];
  private importReceipts: Crm3StoredImportReceipt[] = [];
  private contactResolver: ReferenceResolver;
  private ticketLocks = new Map<string, Promise<void>>();
  private onBeforeImportReceiptCommit: (() => void) | undefined;

  constructor(options: Crm3ServiceOptions = {}) {
    this.contactResolver = options.contactResolver ?? new DefaultSyntheticContactResolver();
    this.onBeforeImportReceiptCommit = options.onBeforeImportReceiptCommit;
    this.seedSyntheticData();
  }

  public setContactResolver(resolver: ReferenceResolver): void {
    this.contactResolver = resolver;
  }

  public getContactResolver(): ReferenceResolver {
    return this.contactResolver;
  }

  public resetStore(): void {
    this.tickets = [];
    this.notes = [];
    this.importBatches = [];
    this.importReceipts = [];
    this.seedSyntheticData();
  }

  /**
   * Seed 32 deterministic synthetic tickets and corresponding notes for testing
   * deterministic pagination (page=1, pageSize=25 yields 25; page=2 yields 7).
   */
  public seedSyntheticData(): void {
    this.tickets = [];
    this.notes = [];

    const statuses: CRM3TicketStatus[] = ['New', 'Open', 'Waiting', 'Solved', 'Closed'];
    const priorities: CRM3TicketPriority[] = ['Low', 'Normal', 'High', 'Urgent'];
    const contactIds = [
      '90000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000002',
    ];

    const baseTimestamp = new Date('2026-10-01T10:00:00Z').getTime();

    for (let i = 1; i <= 32; i++) {
      const hexIndex = i.toString(16).padStart(12, '0');
      const ticketId = `30000000-0000-4000-8000-${hexIndex}`;
      // Stagger timestamps so record i is newer than record i - 1
      const createdAt = new Date(baseTimestamp + i * 3600000).toISOString();
      const status = statuses[(i - 1) % statuses.length] ?? 'New';
      const priority = priorities[(i - 1) % priorities.length] ?? 'Normal';
      const contactId =
        contactIds[(i - 1) % contactIds.length] ??
        '90000000-0000-4000-8000-000000000001';

      this.tickets.push({
        id: ticketId,
        subject: `Customer support request #${i}`,
        status,
        priority,
        contactId,
        orderRef: i % 2 === 0 ? `ORD-${1000 + i}` : null,
        sourceSystem: 'crm-3-seed',
        sourceId: `seed-ticket-${i}`,
        createdAt,
        updatedAt: createdAt,
      });

      // Attach 2 synthetic notes per ticket
      const note1Id = `40000000-0000-4000-8000-${(i * 2 - 1).toString(16).padStart(12, '0')}`;
      const note2Id = `40000000-0000-4000-8000-${(i * 2).toString(16).padStart(12, '0')}`;

      this.notes.push({
        id: note1Id,
        ticketId,
        authorId: 'agent-alice',
        noteText: `Initial inquiry noted for ticket #${i}`,
        createdAt: new Date(baseTimestamp + i * 3600000 + 60000).toISOString(),
      });

      this.notes.push({
        id: note2Id,
        ticketId,
        authorId: 'agent-bob',
        noteText: `Follow-up note for ticket #${i}`,
        createdAt: new Date(baseTimestamp + i * 3600000 + 120000).toISOString(),
      });
    }
  }

  /**
   * List and filter tickets with server-side filtering, case-insensitive search,
   * deterministic sorting (createdAt DESC, id DESC), and bounded pagination.
   */
  public async getTickets(query: CRM3TicketListQuery): Promise<CRM3TicketListResponse> {
    const { status, priority, contactId, search, page = 1, pageSize = 25 } = query;

    let filtered = [...this.tickets];

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
      filtered = filtered.filter((t) => {
        const matchSubject = t.subject.toLowerCase().includes(q);
        const matchOrderRef = t.orderRef ? t.orderRef.toLowerCase().includes(q) : false;
        return matchSubject || matchOrderRef;
      });
    }

    // Deterministic sort: newest first, tie-break by id DESC
    filtered.sort((a, b) => {
      const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.id.localeCompare(a.id);
    });

    const total = filtered.length;
    const offset = (page - 1) * pageSize;
    const paged = filtered.slice(offset, offset + pageSize);

    const items: CRM3TicketRead[] = await Promise.all(
      paged.map((t) => this.enrichTicketWithContact(t))
    );

    return {
      items,
      page,
      pageSize,
      total,
    };
  }

  /**
   * Get ticket by ID, enriched with contact information from reference resolver.
   */
  public async getTicketById(id: string): Promise<CRM3TicketRead | null> {
    const ticket = this.tickets.find((t) => t.id === id);
    if (!ticket) return null;
    return this.enrichTicketWithContact(ticket);
  }

  /**
   * Create a new support ticket.
   * Enforces status/priority enumerations and validates that contact exists.
   */
  public async createTicket(
    input: CRM3TicketCreate,
    authorId = 'system'
  ): Promise<CRM3TicketRead> {
    assertValidTicketStatus(input.status);
    assertValidTicketPriority(input.priority);

    await assertValidContactReference(input.contactId, this.contactResolver);

    if (input.sourceSystem && input.sourceId) {
      const trimmedSystem = input.sourceSystem.trim();
      const trimmedId = input.sourceId.trim();
      const conflict = this.tickets.some(
        (t) => t.sourceSystem === trimmedSystem && t.sourceId === trimmedId
      );
      if (conflict) {
        throw new ConflictError(
          `Ticket with source system '${trimmedSystem}' and source ID '${trimmedId}' already exists`,
          [
            {
              field: 'sourceId',
              message: `Duplicate record for source system '${trimmedSystem}' and source ID '${trimmedId}'`,
              code: 'duplicate_source_record',
            },
          ]
        );
      }
    }

    const now = new Date().toISOString();
    const id = randomUUID();

    const newTicket: CRM3Ticket = {
      id,
      subject: input.subject.trim(),
      status: input.status,
      priority: input.priority,
      contactId: input.contactId,
      orderRef: input.orderRef ? input.orderRef.trim() : null,
      sourceSystem: input.sourceSystem ? input.sourceSystem.trim() : null,
      sourceId: input.sourceId ? input.sourceId.trim() : null,
      createdAt: now,
      updatedAt: now,
    };

    this.tickets.push(newTicket);

    // Optional initial note creation
    if (input.note && input.note.trim().length > 0) {
      this.notes.push({
        id: randomUUID(),
        ticketId: id,
        authorId,
        noteText: input.note.trim(),
        createdAt: now,
      });
    }

    return this.enrichTicketWithContact(newTicket);
  }

  /**
   * Update mutable ticket fields.
   * Edits to the same ticket are serialized, and every rule (enumerations, status transition,
   * contact reference) is checked against the latest stored state before anything is written.
   */
  public async updateTicket(id: string, patch: CRM3TicketPatch): Promise<CRM3TicketRead> {
    return this.withTicketLock(id, () => this.applyTicketPatch(id, patch));
  }

  private async applyTicketPatch(id: string, patch: CRM3TicketPatch): Promise<CRM3TicketRead> {
    const index = this.tickets.findIndex((t) => t.id === id);
    if (index === -1) {
      throw new TicketNotFoundError(id);
    }
    const current = this.tickets[index];
    if (!current) {
      throw new TicketNotFoundError(id);
    }

    if (patch.status !== undefined) {
      assertValidTicketStatus(patch.status);
      assertTicketStatusTransition(current.status, patch.status);
    }

    if (patch.priority !== undefined) {
      assertValidTicketPriority(patch.priority);
    }

    if (patch.contactId !== undefined) {
      await assertValidContactReference(patch.contactId, this.contactResolver);
    }

    const updated: CRM3Ticket = {
      id: current.id,
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
      sourceSystem: current.sourceSystem,
      sourceId: current.sourceId,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this.tickets[index] = updated;
    return this.enrichTicketWithContact(updated);
  }

  /**
   * List notes for a ticket, sorted newest first with deterministic tie-breaker.
   */
  public async getTicketNotes(
    ticketId: string,
    query: CRM3NoteListQuery
  ): Promise<CRM3NoteListResponse> {
    const ticket = this.tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      throw new TicketNotFoundError(ticketId);
    }

    const { page = 1, pageSize = 25 } = query;

    const ticketNotes = this.notes.filter((n) => n.ticketId === ticketId);

    // Newest first with deterministic timestamp and id tie-breaker
    ticketNotes.sort((a, b) => {
      const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.id.localeCompare(a.id);
    });

    const total = ticketNotes.length;
    const offset = (page - 1) * pageSize;
    const items = ticketNotes.slice(offset, offset + pageSize);

    return {
      items,
      page,
      pageSize,
      total,
    };
  }

  /**
   * Append-only note creation.
   */
  public async addNote(
    ticketId: string,
    noteText: string,
    authorId: string
  ): Promise<CRM3Note> {
    await assertTicketExists(ticketId, (id) => this.ticketExists(id));

    if (!noteText || noteText.trim().length === 0) {
      throw new DomainValidationError('Note text cannot be empty', [
        { field: 'noteText', message: 'Note text must be a non-empty string' },
      ]);
    }

    const note: CRM3Note = {
      id: randomUUID(),
      ticketId,
      authorId: authorId && authorId.trim().length > 0 ? authorId.trim() : 'authenticated-user',
      noteText: noteText.trim(),
      createdAt: new Date().toISOString(),
    };

    this.notes.push(note);
    return note;
  }

  // ---------------------------------------------------------------------------
  // Migration import support (used in-process by the CRM-3 target adapter, decision C4)
  // ---------------------------------------------------------------------------

  public findBySourceKey(sourceSystem: string, sourceId: string): CRM3Ticket | null {
    return (
      this.tickets.find((t) => t.sourceSystem === sourceSystem && t.sourceId === sourceId) ?? null
    );
  }

  public getImportReceiptByKey(idempotencyKey: string): Crm3StoredImportReceipt | null {
    return this.importReceipts.find((r) => r.idempotencyKey === idempotencyKey) ?? null;
  }

  public getImportReceiptByRow(
    batchId: string,
    sourceRow: number,
    entity: CRM3EntityType
  ): Crm3StoredImportReceipt | null {
    return (
      this.importReceipts.find(
        (r) => r.batchId === batchId && r.sourceRow === sourceRow && r.entity === entity
      ) ?? null
    );
  }

  public listImportReceipts(batchId: string): Crm3StoredImportReceipt[] {
    return this.importReceipts
      .filter((r) => r.batchId === batchId)
      .sort((a, b) => a.sourceRow - b.sourceRow || a.entity.localeCompare(b.entity));
  }

  public getImportBatch(batchId: string): CRM3ImportBatch | null {
    return this.importBatches.find((b) => b.id === batchId) ?? null;
  }

  /**
   * Writes an imported ticket, its optional first note and their import receipts as one atomic
   * unit (create-only, decision C8). The method is synchronous, so no other operation can
   * interleave between the duplicate checks and the writes; on any failure every staged change
   * is rolled back and nothing is kept.
   */
  public commitTicketImport(command: Crm3TicketImportCommand): Crm3TicketImportCommit {
    const existingReceipt =
      this.getImportReceiptByKey(command.ticketIdempotencyKey) ??
      this.getImportReceiptByRow(command.batchId, command.sourceRow, 'ticket');
    if (existingReceipt) {
      return { kind: 'existing_receipt', receipt: existingReceipt };
    }

    const duplicate = this.findBySourceKey(command.sourceSystem, command.sourceId);
    if (duplicate) {
      return { kind: 'duplicate_source_key', existingTicketId: duplicate.id };
    }

    const snapshot = {
      tickets: [...this.tickets],
      notes: [...this.notes],
      importBatches: [...this.importBatches],
      importReceipts: [...this.importReceipts],
    };

    try {
      const now = new Date().toISOString();
      this.ensureImportBatch(command.batchId, command.sourceSystem, now);

      const ticket: CRM3Ticket = {
        id: randomUUID(),
        subject: command.subject,
        status: command.status,
        priority: command.priority,
        contactId: command.contactId,
        orderRef: command.orderRef,
        sourceSystem: command.sourceSystem,
        sourceId: command.sourceId,
        createdAt: now,
        updatedAt: now,
      };
      this.tickets.push(ticket);

      const receipts: Crm3StoredImportReceipt[] = [
        {
          id: randomUUID(),
          batchId: command.batchId,
          sourceRow: command.sourceRow,
          entity: 'ticket',
          sourceSystem: command.sourceSystem,
          sourceId: command.sourceId,
          targetId: ticket.id,
          idempotencyKey: command.ticketIdempotencyKey,
          payloadHash: command.payloadHash,
          createdAt: now,
        },
      ];

      if (command.noteText) {
        const note: CRM3Note = {
          id: randomUUID(),
          ticketId: ticket.id,
          authorId: command.noteAuthorId,
          noteText: command.noteText,
          createdAt: now,
        };
        this.notes.push(note);
        receipts.push({
          id: randomUUID(),
          batchId: command.batchId,
          sourceRow: command.sourceRow,
          entity: 'note',
          sourceSystem: command.sourceSystem,
          sourceId: command.sourceId,
          targetId: note.id,
          idempotencyKey: command.noteIdempotencyKey,
          payloadHash: command.payloadHash,
          createdAt: now,
        });
      }

      this.onBeforeImportReceiptCommit?.();
      this.importReceipts.push(...receipts);

      return { kind: 'created', ticket, receipts };
    } catch (error) {
      this.tickets = snapshot.tickets;
      this.notes = snapshot.notes;
      this.importBatches = snapshot.importBatches;
      this.importReceipts = snapshot.importReceipts;
      throw error;
    }
  }

  /**
   * Creates the import batch record (status `processing`) if it does not exist yet.
   */
  public ensureImportBatch(
    batchId: string,
    sourceSystem: string,
    now: string = new Date().toISOString()
  ): void {
    if (this.getImportBatch(batchId)) return;
    this.importBatches.push({
      id: batchId,
      sourceSystem,
      status: 'processing',
      idempotencyKey: null,
      requestHash: null,
      loadedCount: 0,
      rejectedCount: 0,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });
  }

  /**
   * Records a batch's state and counts (called by the CRM-3 batch loader).
   */
  public updateImportBatch(
    batchId: string,
    patch: Partial<Pick<CRM3ImportBatch, 'status' | 'loadedCount' | 'rejectedCount' | 'completedAt'>>
  ): CRM3ImportBatch {
    const index = this.importBatches.findIndex((b) => b.id === batchId);
    const current = this.importBatches[index];
    if (index === -1 || !current) {
      throw new DomainValidationError(`Import batch '${batchId}' not found`, [
        { field: 'batchId', message: `Import batch '${batchId}' not found`, code: 'batch_not_found' },
      ], 404);
    }
    const updated: CRM3ImportBatch = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.importBatches[index] = updated;
    return updated;
  }

  public ticketExists(id: string): boolean {
    return this.tickets.some((t) => t.id === id);
  }

  public noteExists(id: string): boolean {
    return this.notes.some((n) => n.id === id);
  }

  /**
   * Read-only ticket projection for other modules (via the public ReferenceResolver).
   * Exposes no note text or contact PII.
   */
  public getTicketSummary(
    id: string
  ): Pick<CRM3Ticket, 'id' | 'subject' | 'status' | 'priority' | 'contactId'> | null {
    const ticket = this.tickets.find((t) => t.id === id);
    if (!ticket) return null;
    return {
      id: ticket.id,
      subject: ticket.subject,
      status: ticket.status,
      priority: ticket.priority,
      contactId: ticket.contactId,
    };
  }

  /**
   * Runs fn after any earlier operation on the same ticket has finished, so two concurrent
   * edits cannot both validate against the same stale state.
   */
  private async withTicketLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.ticketLocks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.ticketLocks.set(id, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.ticketLocks.get(id) === tail) {
        this.ticketLocks.delete(id);
      }
    }
  }

  private async enrichTicketWithContact(ticket: CRM3Ticket): Promise<CRM3TicketRead> {
    let contactName: string | null = null;
    let contactEmail: string | null = null;

    if (ticket.contactId) {
      const contact = await this.contactResolver.get<{
        firstName?: string;
        lastName?: string;
        email?: string;
      }>('contact', ticket.contactId);

      if (contact) {
        const parts = [contact.firstName, contact.lastName].filter(Boolean);
        contactName = parts.length > 0 ? parts.join(' ') : null;
        contactEmail = contact.email ?? null;
      }
    }

    return {
      ...ticket,
      contactName,
      contactEmail,
    };
  }
}

export const crm3Service = new Crm3Service();
