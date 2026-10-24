import { AuditService, InMemoryAuditRepository, type AuditRecord, type IAuditRepository } from '@cs/core';

export const CRM3_AUDIT_ACTIONS = {
  TICKET_CREATED: 'ticket.created',
  TICKET_UPDATED: 'ticket.updated',
  NOTE_ADDED: 'note.added',
  TICKET_IMPORTED: 'ticket.imported',
  LOAD_REQUESTED: 'load.requested',
  LOAD_FINISHED: 'load.finished',
} as const;

export type Crm3AuditAction = (typeof CRM3_AUDIT_ACTIONS)[keyof typeof CRM3_AUDIT_ACTIONS];

/** Fields whose values may hold customer free text; audit records only that they changed. */
const FREE_TEXT_FIELDS = new Set(['subject', 'noteText', 'note', 'text', 'customerEmail', 'contactEmail', 'contactName']);

export interface Crm3AuditEntry {
  actor: string;
  action: Crm3AuditAction;
  targetEntity: 'ticket' | 'note' | 'import_batch';
  targetId?: string | undefined;
  correlationId: string;
  batchId?: string | undefined;
  result?: 'success' | 'failure';
  /** Field changes as { field: { from, to } }; free-text values are replaced with '[changed]'. */
  changes?: Record<string, { from: unknown; to: unknown }> | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Removes free-text values from a change set so audit rows never copy subjects, note text or
 * customer contact details; the shared AuditService then redacts credentials and identifiers.
 */
export function redactChanges(
  changes: Record<string, { from: unknown; to: unknown }>
): Record<string, { from: unknown; to: unknown } | '[changed]'> {
  const result: Record<string, { from: unknown; to: unknown } | '[changed]'> = {};
  for (const [field, change] of Object.entries(changes)) {
    result[field] = FREE_TEXT_FIELDS.has(field) ? '[changed]' : change;
  }
  return result;
}

/**
 * CRM-3 audit trail on top of the shared @cs/core AuditService (PLT-10).
 * Append-only; records actor, action, target, correlation id and a redacted change set.
 */
export class Crm3AuditService {
  private readonly audit: AuditService;

  constructor(private readonly repo: IAuditRepository = new InMemoryAuditRepository()) {
    this.audit = new AuditService(repo);
  }

  public async record(entry: Crm3AuditEntry): Promise<AuditRecord> {
    const metadata: Record<string, unknown> = { ...(entry.metadata ?? {}) };
    for (const key of Object.keys(metadata)) {
      if (FREE_TEXT_FIELDS.has(key)) delete metadata[key];
    }
    if (entry.changes) {
      metadata['changes'] = redactChanges(entry.changes);
    }
    return this.audit.log({
      actor: entry.actor,
      action: entry.action,
      targetEntity: entry.targetEntity,
      targetId: entry.targetId,
      correlationId: entry.correlationId,
      batchId: entry.batchId,
      result: entry.result ?? 'success',
      metadata,
    });
  }

  public async query(filter?: Parameters<AuditService['query']>[0]): Promise<AuditRecord[]> {
    return this.audit.query(filter);
  }
}
