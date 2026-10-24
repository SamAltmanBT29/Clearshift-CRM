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
  type CRM3EntityType,
  CRM3TicketCreateSchema,
  CRM3TicketPatchSchema,
  CRM3TicketListQuerySchema,
  CRM3NoteListQuerySchema,
} from '@clearshift/contracts';
import type { z } from 'zod';
import { TicketNotFoundError, DomainValidationError } from '../domain/errors.js';
import {
  assertTicketStatusTransition,
  assertValidContactReference,
  assertTicketExists,
} from '../domain/relationships.js';
import {
  InMemoryCrm3Store,
  type Crm3Store,
  type Crm3StoredImportReceipt,
} from '../store/crm3.store.js';

export type { Crm3Store, Crm3StoredImportReceipt };

export interface Crm3ServiceOptions {
  contactResolver?: ReferenceResolver;
  /** Data-access implementation; defaults to InMemoryCrm3Store. */
  store?: Crm3Store;
  /**
   * Test hook called inside the atomic import commit after the ticket and note are staged and
   * before receipts are recorded. Throwing from it simulates a failed receipt write.
   */
  onBeforeImportReceiptCommit?: () => void;
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
 * Parses service input with the shared contract schema, so every invariant holds even when the
 * service is called directly (import adapter, other in-process callers) and not through a route.
 */
function parseOrThrow<S extends z.ZodTypeAny>(schema: S, input: unknown, message: string): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new DomainValidationError(
      message,
      result.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'input',
        message: issue.message,
        code: issue.code,
      }))
    );
  }
  return result.data;
}

/**
 * CRM-3 Support Tickets & Activities Business Service
 * Encapsulates ticket domain rules, note append-only semantics, deterministic pagination,
 * and newest-first note ordering. All data access goes through the Crm3Store port.
 */
export class Crm3Service {
  private readonly store: Crm3Store;
  private contactResolver: ReferenceResolver;
  private ticketLocks = new Map<string, Promise<void>>();
  private onBeforeImportReceiptCommit: (() => void) | undefined;

  constructor(options: Crm3ServiceOptions = {}) {
    this.store = options.store ?? new InMemoryCrm3Store();
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

  public getStore(): Crm3Store {
    return this.store;
  }

  public resetStore(): void {
    this.seedSyntheticData();
  }

  /**
   * Replace all data with 32 deterministic synthetic tickets and their notes for testing
   * deterministic pagination (page=1, pageSize=25 yields 25; page=2 yields 7).
   */
  public seedSyntheticData(): void {
    this.store.clear();

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

      this.store.insertTicket({
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

      this.store.insertNote({
        id: note1Id,
        ticketId,
        authorId: 'agent-alice',
        noteText: `Initial inquiry noted for ticket #${i}`,
        createdAt: new Date(baseTimestamp + i * 3600000 + 60000).toISOString(),
      });

      this.store.insertNote({
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
    const { status, priority, contactId, search, page, pageSize } = parseOrThrow(
      CRM3TicketListQuerySchema,
      query,
      'Invalid query parameters'
    );

    const result = this.store.listTickets({ status, priority, contactId, search }, { page, pageSize });
    const items: CRM3TicketRead[] = await Promise.all(
      result.items.map((t) => this.enrichTicketWithContact(t))
    );

    return {
      items,
      page,
      pageSize,
      total: result.total,
    };
  }

  /**
   * Get ticket by ID, enriched with contact information from reference resolver.
   */
  public async getTicketById(id: string): Promise<CRM3TicketRead | null> {
    const ticket = this.store.getTicket(id);
    if (!ticket) return null;
    return this.enrichTicketWithContact(ticket);
  }

  /**
   * Create a new support ticket and its optional initial note as one atomic unit.
   * Enforces the create contract, the contact reference and the unique source key.
   */
  public async createTicket(
    input: CRM3TicketCreate,
    authorId = 'system'
  ): Promise<CRM3TicketRead> {
    const data = parseOrThrow(CRM3TicketCreateSchema, input, 'Invalid ticket input');

    await assertValidContactReference(data.contactId, this.contactResolver);

    const now = new Date().toISOString();
    const newTicket: CRM3Ticket = {
      id: randomUUID(),
      subject: data.subject,
      status: data.status,
      priority: data.priority,
      contactId: data.contactId,
      orderRef: data.orderRef ?? null,
      sourceSystem: data.sourceSystem ?? null,
      sourceId: data.sourceId ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.store.transaction(() => {
      this.store.insertTicket(newTicket);
      if (data.note) {
        this.store.insertNote({
          id: randomUUID(),
          ticketId: newTicket.id,
          authorId: authorId.trim() || 'system',
          noteText: data.note,
          createdAt: now,
        });
      }
    });

    return this.enrichTicketWithContact(newTicket);
  }

  /**
   * Update mutable ticket fields.
   * Edits to the same ticket are serialized, and every rule (enumerations, status transition,
   * contact reference) is checked against the latest stored state before anything is written.
   */
  public async updateTicket(id: string, patch: CRM3TicketPatch): Promise<CRM3TicketRead> {
    const data = parseOrThrow(CRM3TicketPatchSchema, patch, 'Invalid ticket update input');
    return this.withTicketLock(id, () => this.applyTicketPatch(id, data));
  }

  private async applyTicketPatch(id: string, patch: CRM3TicketPatch): Promise<CRM3TicketRead> {
    const current = this.store.getTicket(id);
    if (!current) {
      throw new TicketNotFoundError(id);
    }

    if (patch.status !== undefined) {
      assertTicketStatusTransition(current.status, patch.status);
    }

    if (patch.contactId !== undefined) {
      await assertValidContactReference(patch.contactId, this.contactResolver);
    }

    const updated: CRM3Ticket = {
      id: current.id,
      subject: patch.subject !== undefined ? patch.subject : current.subject,
      status: patch.status !== undefined ? patch.status : current.status,
      priority: patch.priority !== undefined ? patch.priority : current.priority,
      contactId: patch.contactId !== undefined ? patch.contactId : current.contactId,
      orderRef: patch.orderRef !== undefined ? patch.orderRef : current.orderRef,
      sourceSystem: current.sourceSystem,
      sourceId: current.sourceId,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this.store.updateTicket(updated);
    return this.enrichTicketWithContact(updated);
  }

  /**
   * List notes for a ticket, sorted newest first with deterministic tie-breaker.
   */
  public async getTicketNotes(
    ticketId: string,
    query: CRM3NoteListQuery
  ): Promise<CRM3NoteListResponse> {
    if (!this.store.getTicket(ticketId)) {
      throw new TicketNotFoundError(ticketId);
    }

    const { page, pageSize } = parseOrThrow(CRM3NoteListQuerySchema, query, 'Invalid query parameters');
    const result = this.store.listNotes(ticketId, { page, pageSize });

    return {
      items: result.items,
      page,
      pageSize,
      total: result.total,
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

    this.store.insertNote(note);
    return note;
  }

  // ---------------------------------------------------------------------------
  // Migration import support (used in-process by the CRM-3 target adapter, decision C4)
  // ---------------------------------------------------------------------------

  public findBySourceKey(sourceSystem: string, sourceId: string): CRM3Ticket | null {
    return this.store.findTicketBySourceKey(sourceSystem, sourceId);
  }

  public getImportReceiptByKey(idempotencyKey: string): Crm3StoredImportReceipt | null {
    return this.store.getImportReceiptByKey(idempotencyKey);
  }

  public getImportReceiptByRow(
    batchId: string,
    sourceRow: number,
    entity: CRM3EntityType
  ): Crm3StoredImportReceipt | null {
    return this.store.getImportReceiptByRow(batchId, sourceRow, entity);
  }

  public listImportReceipts(batchId: string): Crm3StoredImportReceipt[] {
    return this.store.listImportReceipts(batchId);
  }

  public getImportBatch(batchId: string): CRM3ImportBatch | null {
    return this.store.getImportBatch(batchId);
  }

  /**
   * Writes an imported ticket, its optional first note and their import receipts as one atomic
   * unit (create-only, decision C8). The method is synchronous, so no other operation can
   * interleave between the duplicate checks and the writes; on any failure the store
   * transaction undoes every staged change and nothing is kept.
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

    return this.store.transaction(() => {
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
      this.store.insertTicket(ticket);

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
        this.store.insertNote(note);
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
      for (const receipt of receipts) {
        this.store.insertImportReceipt(receipt);
      }

      return { kind: 'created' as const, ticket, receipts };
    });
  }

  /**
   * Creates the import batch record (status `processing`) if it does not exist yet.
   */
  public ensureImportBatch(
    batchId: string,
    sourceSystem: string,
    now: string = new Date().toISOString()
  ): void {
    if (this.store.getImportBatch(batchId)) return;
    this.store.insertImportBatch({
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
    const current = this.store.getImportBatch(batchId);
    if (!current) {
      throw new DomainValidationError(`Import batch '${batchId}' not found`, [
        { field: 'batchId', message: `Import batch '${batchId}' not found`, code: 'batch_not_found' },
      ], 404);
    }
    const updated: CRM3ImportBatch = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.store.updateImportBatch(updated);
    return updated;
  }

  public ticketExists(id: string): boolean {
    return this.store.getTicket(id) !== null;
  }

  public noteExists(id: string): boolean {
    return this.store.getNote(id) !== null;
  }

  /**
   * Read-only ticket projection for other modules (via the public ReferenceResolver).
   * Exposes no note text or contact PII.
   */
  public getTicketSummary(
    id: string
  ): Pick<CRM3Ticket, 'id' | 'subject' | 'status' | 'priority' | 'contactId'> | null {
    const ticket = this.store.getTicket(id);
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
