import type {
  CRM3Ticket,
  CRM3Note,
  CRM3ImportBatch,
  CRM3ImportReceipt,
  CRM3EntityType,
  CRM3TicketStatus,
  CRM3TicketPriority,
} from '@clearshift/contracts';
import { ConflictError, DomainValidationError, TicketNotFoundError } from '../domain/errors.js';

/** Import receipt as stored by CRM-3, plus the canonical payload hash used for replay checks. */
export interface Crm3StoredImportReceipt extends CRM3ImportReceipt {
  payloadHash: string;
}

export interface Crm3TicketFilter {
  status?: CRM3TicketStatus | undefined;
  priority?: CRM3TicketPriority | undefined;
  contactId?: string | undefined;
  /** Case-insensitive match on subject and orderRef only. */
  search?: string | undefined;
}

export interface Crm3PageRequest {
  page: number;
  pageSize: number;
}

export interface Crm3Page<T> {
  items: T[];
  total: number;
}

export const CRM3_STORE_MAX_PAGE_SIZE = 100;

/**
 * CRM-3 data-access port. The service depends on this interface only, so a PostgreSQL
 * implementation (Drizzle, crm3 schema) can replace the in-memory one without touching domain
 * rules. Every read is bounded; writes enforce the same constraints as `crm3_v1.sql`, so the
 * store is the second line of defence behind the service's validation.
 */
export interface Crm3Store {
  listTickets(filter: Crm3TicketFilter, page: Crm3PageRequest): Crm3Page<CRM3Ticket>;
  getTicket(id: string): CRM3Ticket | null;
  findTicketBySourceKey(sourceSystem: string, sourceId: string): CRM3Ticket | null;
  insertTicket(ticket: CRM3Ticket): void;
  updateTicket(ticket: CRM3Ticket): void;

  /** Notes newest first (createdAt DESC, id DESC). */
  listNotes(ticketId: string, page: Crm3PageRequest): Crm3Page<CRM3Note>;
  getNote(id: string): CRM3Note | null;
  insertNote(note: CRM3Note): void;

  getImportBatch(batchId: string): CRM3ImportBatch | null;
  insertImportBatch(batch: CRM3ImportBatch): void;
  updateImportBatch(batch: CRM3ImportBatch): void;

  getImportReceiptByKey(idempotencyKey: string): Crm3StoredImportReceipt | null;
  getImportReceiptByRow(batchId: string, sourceRow: number, entity: CRM3EntityType): Crm3StoredImportReceipt | null;
  listImportReceipts(batchId: string): Crm3StoredImportReceipt[];
  insertImportReceipt(receipt: Crm3StoredImportReceipt): void;

  /**
   * Runs fn as one all-or-nothing unit: if fn throws, every write made inside it is undone.
   * Nested calls join the outer transaction.
   */
  transaction<T>(fn: () => T): T;

  /** Removes all data (tests and synthetic reseeding only). */
  clear(): void;
}

interface StoreState {
  tickets: CRM3Ticket[];
  notes: CRM3Note[];
  importBatches: CRM3ImportBatch[];
  importReceipts: Crm3StoredImportReceipt[];
}

const newestFirst = <T extends { createdAt: string; id: string }>(a: T, b: T): number => {
  const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  if (timeDiff !== 0) return timeDiff;
  return b.id.localeCompare(a.id);
};

function assertPage(page: Crm3PageRequest): void {
  if (
    !Number.isInteger(page.page) ||
    page.page < 1 ||
    !Number.isInteger(page.pageSize) ||
    page.pageSize < 1 ||
    page.pageSize > CRM3_STORE_MAX_PAGE_SIZE
  ) {
    throw new DomainValidationError('Page request out of bounds', [
      {
        field: 'pageSize',
        message: `page must be >= 1 and pageSize between 1 and ${CRM3_STORE_MAX_PAGE_SIZE}`,
        code: 'page_out_of_bounds',
      },
    ]);
  }
}

function slicePage<T>(rows: T[], page: Crm3PageRequest): Crm3Page<T> {
  const offset = (page.page - 1) * page.pageSize;
  return { items: rows.slice(offset, offset + page.pageSize), total: rows.length };
}

function checkViolation(field: string, message: string): DomainValidationError {
  return new DomainValidationError(message, [{ field, message, code: 'check_violation' }]);
}

/**
 * Default in-memory implementation of the CRM-3 store. Records are treated as immutable values
 * (updates replace the stored object), so a transaction can snapshot and restore by array copy.
 */
export class InMemoryCrm3Store implements Crm3Store {
  private state: StoreState = { tickets: [], notes: [], importBatches: [], importReceipts: [] };
  private transactionDepth = 0;

  listTickets(filter: Crm3TicketFilter, page: Crm3PageRequest): Crm3Page<CRM3Ticket> {
    assertPage(page);
    const search = filter.search?.trim().toLowerCase();
    const rows = this.state.tickets
      .filter((t) => !filter.status || t.status === filter.status)
      .filter((t) => !filter.priority || t.priority === filter.priority)
      .filter((t) => !filter.contactId || t.contactId === filter.contactId)
      .filter(
        (t) =>
          !search ||
          t.subject.toLowerCase().includes(search) ||
          (t.orderRef ? t.orderRef.toLowerCase().includes(search) : false)
      )
      .sort(newestFirst);
    return slicePage(rows, page);
  }

  getTicket(id: string): CRM3Ticket | null {
    return this.state.tickets.find((t) => t.id === id) ?? null;
  }

  findTicketBySourceKey(sourceSystem: string, sourceId: string): CRM3Ticket | null {
    return this.state.tickets.find((t) => t.sourceSystem === sourceSystem && t.sourceId === sourceId) ?? null;
  }

  insertTicket(ticket: CRM3Ticket): void {
    if (this.getTicket(ticket.id)) {
      throw new ConflictError(`Ticket '${ticket.id}' already exists`, [
        { field: 'id', message: 'Ticket id must be unique', code: 'duplicate_id' },
      ]);
    }
    this.assertTicketRow(ticket);
    this.state.tickets = [...this.state.tickets, ticket];
  }

  updateTicket(ticket: CRM3Ticket): void {
    const index = this.state.tickets.findIndex((t) => t.id === ticket.id);
    if (index === -1) {
      throw new TicketNotFoundError(ticket.id);
    }
    this.assertTicketRow(ticket);
    const tickets = [...this.state.tickets];
    tickets[index] = ticket;
    this.state.tickets = tickets;
  }

  listNotes(ticketId: string, page: Crm3PageRequest): Crm3Page<CRM3Note> {
    assertPage(page);
    return slicePage(this.state.notes.filter((n) => n.ticketId === ticketId).sort(newestFirst), page);
  }

  getNote(id: string): CRM3Note | null {
    return this.state.notes.find((n) => n.id === id) ?? null;
  }

  insertNote(note: CRM3Note): void {
    if (!this.getTicket(note.ticketId)) {
      throw new TicketNotFoundError(note.ticketId);
    }
    if (note.noteText.trim().length === 0) {
      throw checkViolation('noteText', 'Note text must be non-empty');
    }
    if (note.authorId.trim().length === 0) {
      throw checkViolation('authorId', 'Note author must be non-empty');
    }
    this.state.notes = [...this.state.notes, note];
  }

  getImportBatch(batchId: string): CRM3ImportBatch | null {
    return this.state.importBatches.find((b) => b.id === batchId) ?? null;
  }

  insertImportBatch(batch: CRM3ImportBatch): void {
    if (this.getImportBatch(batch.id)) {
      throw new ConflictError(`Import batch '${batch.id}' already exists`, [
        { field: 'batchId', message: 'Batch id must be unique', code: 'duplicate_id' },
      ]);
    }
    this.state.importBatches = [...this.state.importBatches, batch];
  }

  updateImportBatch(batch: CRM3ImportBatch): void {
    const index = this.state.importBatches.findIndex((b) => b.id === batch.id);
    if (index === -1) {
      throw new DomainValidationError(
        `Import batch '${batch.id}' not found`,
        [{ field: 'batchId', message: `Import batch '${batch.id}' not found`, code: 'batch_not_found' }],
        404
      );
    }
    const batches = [...this.state.importBatches];
    batches[index] = batch;
    this.state.importBatches = batches;
  }

  getImportReceiptByKey(idempotencyKey: string): Crm3StoredImportReceipt | null {
    return this.state.importReceipts.find((r) => r.idempotencyKey === idempotencyKey) ?? null;
  }

  getImportReceiptByRow(batchId: string, sourceRow: number, entity: CRM3EntityType): Crm3StoredImportReceipt | null {
    return (
      this.state.importReceipts.find(
        (r) => r.batchId === batchId && r.sourceRow === sourceRow && r.entity === entity
      ) ?? null
    );
  }

  listImportReceipts(batchId: string): Crm3StoredImportReceipt[] {
    return this.state.importReceipts
      .filter((r) => r.batchId === batchId)
      .sort((a, b) => a.sourceRow - b.sourceRow || a.entity.localeCompare(b.entity));
  }

  insertImportReceipt(receipt: Crm3StoredImportReceipt): void {
    if (!this.getImportBatch(receipt.batchId)) {
      throw new DomainValidationError(
        `Import batch '${receipt.batchId}' not found`,
        [{ field: 'batchId', message: 'Receipt must reference an existing batch', code: 'foreign_key_violation' }],
        404
      );
    }
    if (
      this.getImportReceiptByKey(receipt.idempotencyKey) ||
      this.getImportReceiptByRow(receipt.batchId, receipt.sourceRow, receipt.entity)
    ) {
      throw new ConflictError('Import receipt already exists for this key or batch row', [
        { field: 'idempotencyKey', message: 'Receipt key and batch row must be unique', code: 'duplicate_receipt' },
      ]);
    }
    this.state.importReceipts = [...this.state.importReceipts, receipt];
  }

  transaction<T>(fn: () => T): T {
    if (this.transactionDepth > 0) {
      return fn();
    }
    const snapshot: StoreState = { ...this.state };
    this.transactionDepth += 1;
    try {
      return fn();
    } catch (error) {
      this.state = snapshot;
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  clear(): void {
    this.state = { tickets: [], notes: [], importBatches: [], importReceipts: [] };
  }

  /** Mirrors the crm3_tickets CHECK and UNIQUE constraints. */
  private assertTicketRow(ticket: CRM3Ticket): void {
    if (ticket.subject.trim().length === 0) {
      throw checkViolation('subject', 'Subject must be non-empty');
    }
    const hasSystem = ticket.sourceSystem !== null && ticket.sourceSystem.trim().length > 0;
    const hasId = ticket.sourceId !== null && ticket.sourceId.trim().length > 0;
    if (hasSystem !== hasId) {
      throw checkViolation('sourceId', 'sourceSystem and sourceId must both be set or both be empty');
    }
    if (hasSystem && hasId) {
      const clash = this.state.tickets.find(
        (t) => t.id !== ticket.id && t.sourceSystem === ticket.sourceSystem && t.sourceId === ticket.sourceId
      );
      if (clash) {
        throw new ConflictError(
          `Ticket with source system '${ticket.sourceSystem}' and source ID '${ticket.sourceId}' already exists`,
          [
            {
              field: 'sourceId',
              message: `Duplicate record for source system '${ticket.sourceSystem}' and source ID '${ticket.sourceId}'`,
              code: 'duplicate_source_record',
            },
          ]
        );
      }
    }
  }
}
