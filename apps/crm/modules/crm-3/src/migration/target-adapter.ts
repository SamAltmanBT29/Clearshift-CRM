import { z } from 'zod';
import type { TargetAdapter, TargetAdapterResult, TargetAdapterError, ImportReceipt } from '@cs/kit';
import { ok, err, type Result } from '@cs/kernel';
import { computeIdempotencyKey, normalizeEmail } from '@cs/core';
import {
  CRM3_TICKET_STATUSES,
  CRM3_TICKET_PRIORITIES,
  computeCanonicalPayloadHash,
  type CRM3TicketStatus,
  type CRM3TicketPriority,
  type CRM3EntityType,
} from '@clearshift/contracts';
import {
  Crm3Service,
  crm3Service,
  CONTACT_BY_EMAIL_ENTITY,
  type Crm3StoredImportReceipt,
} from '../services/crm3.service.js';

export const CRM3_IMPORT_SCHEMA_VERSION = 1;

/** Source system recorded for CSV/XLSX rows that carry no source system of their own. */
export const CRM3_DEFAULT_SOURCE_SYSTEM = 'legacy-csv';

/** Author recorded on the first note created from the source "text" column. */
export const CRM3_IMPORT_NOTE_AUTHOR = 'kit-import';

/**
 * Stable reject reason codes (decision D3). A rejected row is bad data and must not be retried.
 */
export const CRM3_IMPORT_REJECT_CODES = {
  INVALID_ROW: 'INVALID_ROW',
  INVALID_BATCH_ID: 'INVALID_BATCH_ID',
  INVALID_SOURCE_ROW: 'INVALID_SOURCE_ROW',
  INVALID_IDEMPOTENCY_KEY: 'INVALID_IDEMPOTENCY_KEY',
  EMPTY_SUBJECT: 'EMPTY_SUBJECT',
  INVALID_STATUS: 'INVALID_STATUS',
  INVALID_PRIORITY: 'INVALID_PRIORITY',
  INVALID_EMAIL: 'INVALID_EMAIL',
  CUSTOMER_UNRESOLVED: 'CUSTOMER_UNRESOLVED',
  DUPLICATE_SOURCE_KEY: 'DUPLICATE_SOURCE_KEY',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
} as const;

/**
 * Infrastructure failures. The row is not bad data; the loader (CRM3-13) may retry it with the
 * same idempotency key.
 */
export const CRM3_IMPORT_RETRYABLE_CODES = {
  TARGET_UNAVAILABLE: 'TARGET_UNAVAILABLE',
} as const;

export type Crm3ImportReasonCode =
  | (typeof CRM3_IMPORT_REJECT_CODES)[keyof typeof CRM3_IMPORT_REJECT_CODES]
  | (typeof CRM3_IMPORT_RETRYABLE_CODES)[keyof typeof CRM3_IMPORT_RETRYABLE_CODES];

export function isRetryableReasonCode(reasonCode: string): boolean {
  return Object.values<string>(CRM3_IMPORT_RETRYABLE_CODES).includes(reasonCode);
}

/**
 * Clean ticket row handed over by the Migration Kit after cleaning/mapping.
 * Source columns: subject, status, priority, customer email, text. Status and priority must
 * already be canonical values; normalizing variants such as "open" is the cleaner's job.
 * (Defined here until the CRM-3 field registry from CRM3-10 exists.)
 */
export const Crm3ImportRowSchema = z.object({
  subject: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  priority: z.string().nullable().optional(),
  customerEmail: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  orderRef: z.string().nullable().optional(),
  sourceSystem: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
});
export type Crm3ImportRow = z.infer<typeof Crm3ImportRowSchema>;

interface ValidatedTicketRow {
  subject: string;
  status: CRM3TicketStatus;
  priority: CRM3TicketPriority;
  customerEmail: string;
  text: string | null;
  orderRef: string | null;
  sourceSystem: string;
  sourceId: string;
}

export interface Crm3RowAssessment {
  sourceRow: number;
  outcome: 'valid' | 'rejected';
  reasonCode?: Crm3ImportReasonCode;
  field?: string;
  message?: string;
}

/**
 * Deterministic idempotency key for a source row: SHA-256 of
 * batch ID + source row + target entity + schema version (shared @cs/core builder).
 */
export function buildCrm3IdempotencyKey(
  batchId: string,
  sourceRow: number,
  entity: CRM3EntityType = 'ticket'
): string {
  return computeIdempotencyKey(batchId, sourceRow, entity, String(CRM3_IMPORT_SCHEMA_VERSION));
}

const BatchIdSchema = z.string().uuid();
const EmailSchema = z.string().email();

const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

class RowRejection extends Error {
  constructor(
    public readonly reasonCode: Crm3ImportReasonCode,
    message: string,
    public readonly field?: string
  ) {
    super(message);
  }
}

/**
 * CRM-3 Support Tickets Migration Kit target adapter (KIT-08, decision C4).
 * Loads tickets in-process through the CRM-3 service. Create-only (decision C8): an existing
 * (sourceSystem, sourceId) is rejected, never updated. The ticket, its first note and both
 * import receipts commit atomically. Business-rule failures are returned as rejects with a
 * stable reason code; infrastructure failures are returned as retryable.
 */
export class Crm3TargetAdapter implements TargetAdapter<Crm3ImportRow> {
  public readonly module = 'crm-3';
  public readonly entity = 'ticket';
  public readonly schemaVersion = CRM3_IMPORT_SCHEMA_VERSION;

  constructor(private readonly service: Crm3Service = crm3Service) {}

  public getService(): Crm3Service {
    return this.service;
  }

  /**
   * Dry run: validates every row and resolves customers read-only. Writes no tickets, notes,
   * batches or receipts.
   */
  public async preflight(
    batchId: string,
    rows: Crm3ImportRow[]
  ): Promise<Result<{ validCount: number; rejectCount: number }, TargetAdapterError>> {
    const assessed = await this.assessRows(batchId, rows);
    if (!assessed.ok) return assessed;

    const validCount = assessed.value.filter((a) => a.outcome === 'valid').length;
    return ok({ validCount, rejectCount: assessed.value.length - validCount });
  }

  /**
   * Per-row dry-run assessment (row numbers are 1-based positions in `rows`). Also rejects a
   * source key repeated earlier in the same batch. Fails as a whole only on an infrastructure
   * error, so the dry run never misreports an outage as bad data.
   */
  public async assessRows(
    batchId: string,
    rows: Crm3ImportRow[]
  ): Promise<Result<Crm3RowAssessment[], TargetAdapterError>> {
    if (!BatchIdSchema.safeParse(batchId).success) {
      return err({
        reasonCode: CRM3_IMPORT_REJECT_CODES.INVALID_BATCH_ID,
        message: `Batch id '${batchId}' must be a UUID`,
        field: 'batchId',
      });
    }

    const seenSourceKeys = new Set<string>();
    const assessments: Crm3RowAssessment[] = [];

    for (const [index, raw] of rows.entries()) {
      const sourceRow = index + 1;
      try {
        const row = this.validateRow(batchId, sourceRow, raw);
        await this.resolveContactId(row.customerEmail);

        const sourceKey = `${row.sourceSystem}\u0000${row.sourceId}`;
        if (seenSourceKeys.has(sourceKey) || this.service.findBySourceKey(row.sourceSystem, row.sourceId)) {
          throw new RowRejection(
            CRM3_IMPORT_REJECT_CODES.DUPLICATE_SOURCE_KEY,
            `A ticket with source key (${row.sourceSystem}, ${row.sourceId}) already exists`,
            'sourceId'
          );
        }
        seenSourceKeys.add(sourceKey);
        assessments.push({ sourceRow, outcome: 'valid' });
      } catch (error) {
        if (error instanceof RowRejection) {
          assessments.push({
            sourceRow,
            outcome: 'rejected',
            reasonCode: error.reasonCode,
            message: error.message,
            ...(error.field ? { field: error.field } : {}),
          });
          continue;
        }
        return err(this.toInfrastructureError(error));
      }
    }

    return ok(assessments);
  }

  /**
   * Imports one row. A replay with the same idempotency key and the same canonical payload
   * returns the existing receipt and creates nothing; the same key with a different payload is
   * rejected with IDEMPOTENCY_CONFLICT.
   */
  public async importRow(
    batchId: string,
    sourceRow: number,
    idempotencyKey: string,
    cleanData: Crm3ImportRow
  ): Promise<Result<TargetAdapterResult, TargetAdapterError>> {
    try {
      if (!BatchIdSchema.safeParse(batchId).success) {
        throw new RowRejection(
          CRM3_IMPORT_REJECT_CODES.INVALID_BATCH_ID,
          `Batch id '${batchId}' must be a UUID`,
          'batchId'
        );
      }
      if (!Number.isInteger(sourceRow) || sourceRow < 1) {
        throw new RowRejection(
          CRM3_IMPORT_REJECT_CODES.INVALID_SOURCE_ROW,
          'Source row must be a positive integer',
          'sourceRow'
        );
      }
      if (!idempotencyKey || idempotencyKey.trim().length === 0) {
        throw new RowRejection(
          CRM3_IMPORT_REJECT_CODES.INVALID_IDEMPOTENCY_KEY,
          'Idempotency key is required',
          'idempotencyKey'
        );
      }

      const row = this.validateRow(batchId, sourceRow, cleanData);
      const payloadHash = computeCanonicalPayloadHash({
        entity: this.entity,
        schemaVersion: this.schemaVersion,
        batchId,
        sourceRow,
        data: row,
      });

      const replay = this.checkReplay(idempotencyKey, payloadHash);
      if (replay) return replay;

      const contactId = await this.resolveContactId(row.customerEmail);

      const commit = this.service.commitTicketImport({
        batchId,
        sourceRow,
        sourceSystem: row.sourceSystem,
        sourceId: row.sourceId,
        ticketIdempotencyKey: idempotencyKey,
        noteIdempotencyKey: buildCrm3IdempotencyKey(batchId, sourceRow, 'note'),
        payloadHash,
        subject: row.subject,
        status: row.status,
        priority: row.priority,
        contactId,
        orderRef: row.orderRef,
        noteText: row.text,
        noteAuthorId: CRM3_IMPORT_NOTE_AUTHOR,
      });

      if (commit.kind === 'existing_receipt') {
        // Another call committed this row while the customer was being resolved.
        return this.checkReplay(idempotencyKey, payloadHash) ?? this.conflict(idempotencyKey);
      }
      if (commit.kind === 'duplicate_source_key') {
        throw new RowRejection(
          CRM3_IMPORT_REJECT_CODES.DUPLICATE_SOURCE_KEY,
          `A ticket with source key (${row.sourceSystem}, ${row.sourceId}) already exists (${commit.existingTicketId})`,
          'sourceId'
        );
      }

      const ticketReceipt = commit.receipts.find((r) => r.entity === 'ticket');
      if (!ticketReceipt) {
        throw new Error('Import commit returned no ticket receipt');
      }
      return ok({ targetId: commit.ticket.id, receipt: this.toKitReceipt(ticketReceipt) });
    } catch (error) {
      if (error instanceof RowRejection) {
        return err({
          reasonCode: error.reasonCode,
          message: error.message,
          ...(error.field ? { field: error.field } : {}),
        });
      }
      return err(this.toInfrastructureError(error));
    }
  }

  private checkReplay(
    idempotencyKey: string,
    payloadHash: string
  ): Result<TargetAdapterResult, TargetAdapterError> | null {
    const existing = this.service.getImportReceiptByKey(idempotencyKey);
    if (!existing) return null;
    if (existing.entity === 'ticket' && existing.payloadHash === payloadHash) {
      return ok({ targetId: existing.targetId, receipt: this.toKitReceipt(existing) });
    }
    return this.conflict(idempotencyKey);
  }

  private conflict(idempotencyKey: string): Result<TargetAdapterResult, TargetAdapterError> {
    return err({
      reasonCode: CRM3_IMPORT_REJECT_CODES.IDEMPOTENCY_CONFLICT,
      message: `Idempotency key '${idempotencyKey}' or this batch row was already used with a different payload`,
      field: 'idempotencyKey',
    });
  }

  private validateRow(batchId: string, sourceRow: number, raw: unknown): ValidatedTicketRow {
    const parsed = Crm3ImportRowSchema.safeParse(raw);
    if (!parsed.success) {
      throw new RowRejection(CRM3_IMPORT_REJECT_CODES.INVALID_ROW, 'Row is not a ticket record');
    }
    const data = parsed.data;

    const subject = blankToNull(data.subject);
    if (!subject) {
      throw new RowRejection(CRM3_IMPORT_REJECT_CODES.EMPTY_SUBJECT, 'Subject is required', 'subject');
    }

    const status = data.status?.trim() ?? '';
    if (!(CRM3_TICKET_STATUSES as readonly string[]).includes(status)) {
      throw new RowRejection(
        CRM3_IMPORT_REJECT_CODES.INVALID_STATUS,
        `Status '${status}' is not one of ${CRM3_TICKET_STATUSES.join(', ')}`,
        'status'
      );
    }

    const priority = data.priority?.trim() ?? '';
    if (!(CRM3_TICKET_PRIORITIES as readonly string[]).includes(priority)) {
      throw new RowRejection(
        CRM3_IMPORT_REJECT_CODES.INVALID_PRIORITY,
        `Priority '${priority}' is not one of ${CRM3_TICKET_PRIORITIES.join(', ')}`,
        'priority'
      );
    }

    const rawEmail = blankToNull(data.customerEmail);
    const customerEmail = rawEmail ? normalizeEmail(rawEmail) : '';
    if (!EmailSchema.safeParse(customerEmail).success) {
      throw new RowRejection(
        CRM3_IMPORT_REJECT_CODES.INVALID_EMAIL,
        'Customer email is missing or not a valid email address',
        'customerEmail'
      );
    }

    return {
      subject,
      status: status as CRM3TicketStatus,
      priority: priority as CRM3TicketPriority,
      customerEmail,
      text: blankToNull(data.text),
      orderRef: blankToNull(data.orderRef),
      sourceSystem: blankToNull(data.sourceSystem) ?? CRM3_DEFAULT_SOURCE_SYSTEM,
      sourceId: blankToNull(data.sourceId) ?? `${batchId}:${sourceRow}`,
    };
  }

  /**
   * Resolves the customer email to a CRM-1 contact id through the ReferenceResolver port
   * (decision C7). An unknown email is a reject (CUSTOMER_UNRESOLVED, decision C6); a resolver
   * failure propagates as an infrastructure error.
   */
  private async resolveContactId(customerEmail: string): Promise<string> {
    const contact = await this.service
      .getContactResolver()
      .get<{ id?: string }>(CONTACT_BY_EMAIL_ENTITY, customerEmail);
    if (!contact?.id) {
      throw new RowRejection(
        CRM3_IMPORT_REJECT_CODES.CUSTOMER_UNRESOLVED,
        'Customer email does not resolve to a CRM-1 contact',
        'customerEmail'
      );
    }
    return contact.id;
  }

  private toInfrastructureError(error: unknown): TargetAdapterError {
    return {
      reasonCode: CRM3_IMPORT_RETRYABLE_CODES.TARGET_UNAVAILABLE,
      message: `Import target failed; row not written and safe to retry: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  private toKitReceipt(receipt: Crm3StoredImportReceipt): ImportReceipt {
    return {
      batchId: receipt.batchId,
      sourceRow: receipt.sourceRow,
      entity: receipt.entity,
      schemaVersion: this.schemaVersion,
      idempotencyKey: receipt.idempotencyKey,
      targetId: receipt.targetId,
      kind: 'created',
      createdAt: new Date(receipt.createdAt),
    };
  }
}
