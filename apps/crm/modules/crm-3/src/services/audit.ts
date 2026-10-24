import { randomUUID } from 'node:crypto';
import { AuditService, InMemoryAuditRepository, type AuditRecord as CoreAuditRecord, type IAuditRepository } from '@cs/core';
import { redactSensitiveObject } from '../policies/masking.js';

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
  action: Crm3AuditAction | string;
  targetEntity: 'ticket' | 'note' | 'import_batch' | string;
  targetId?: string | undefined;
  correlationId: string;
  batchId?: string | undefined;
  result?: 'success' | 'failure' | 'rejected' | 'halted' | undefined;
  changes?: Record<string, { from: unknown; to: unknown }> | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface AuditEventInput {
  actor: string;
  action: string;
  entity: string;
  entityId?: string | null | undefined;
  batchId?: string | null | undefined;
  result?: 'success' | 'failure' | 'rejected' | 'halted' | undefined;
  diff?: Record<string, unknown> | null | undefined;
  metadata?: Record<string, unknown> | null | undefined;
}

export interface AuditRecord {
  id: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string | null;
  batchId: string | null;
  result: string;
  diffRedacted: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export function redactChanges(
  changes: Record<string, { from: unknown; to: unknown }>
): Record<string, { from: unknown; to: unknown } | '[changed]'> {
  const result: Record<string, { from: unknown; to: unknown } | '[changed]'> = {};
  for (const [field, change] of Object.entries(changes)) {
    result[field] = FREE_TEXT_FIELDS.has(field) ? '[changed]' : change;
  }
  return result;
}

export class Crm3AuditService {
  private inMemoryLedger: AuditRecord[] = [];
  private readonly audit: AuditService;

  constructor(private readonly repo: IAuditRepository = new InMemoryAuditRepository()) {
    this.audit = new AuditService(repo);
  }

  public async record(entry: Crm3AuditEntry): Promise<CoreAuditRecord> {
    const metadata: Record<string, unknown> = { ...(entry.metadata ?? {}) };
    for (const key of Object.keys(metadata)) {
      if (FREE_TEXT_FIELDS.has(key)) delete metadata[key];
    }
    if (entry.changes) {
      metadata['changes'] = redactChanges(entry.changes);
    }

    const legacyRec: AuditRecord = {
      id: randomUUID(),
      actor: entry.actor || 'system',
      action: entry.action,
      entity: entry.targetEntity,
      entityId: entry.targetId ?? null,
      batchId: entry.batchId ?? null,
      result: entry.result ?? 'success',
      diffRedacted: entry.changes ? (redactSensitiveObject(entry.changes) as Record<string, unknown>) : null,
      metadata,
      createdAt: new Date(),
    };
    this.inMemoryLedger.push(legacyRec);

    return this.audit.log({
      actor: entry.actor,
      action: entry.action,
      targetEntity: entry.targetEntity,
      targetId: entry.targetId,
      correlationId: entry.correlationId,
      batchId: entry.batchId,
      result: entry.result === 'failure' ? 'failure' : 'success',
      metadata,
    });
  }

  public async logEvent(input: AuditEventInput): Promise<AuditRecord> {
    const sanitizedDiff = input.diff
      ? (redactSensitiveObject(input.diff) as Record<string, unknown>)
      : null;
    const sanitizedMetadata = input.metadata
      ? (redactSensitiveObject(input.metadata) as Record<string, unknown>)
      : null;

    const record: AuditRecord = {
      id: randomUUID(),
      actor: input.actor || 'system',
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      batchId: input.batchId ?? null,
      result: input.result ?? 'success',
      diffRedacted: sanitizedDiff,
      metadata: sanitizedMetadata,
      createdAt: new Date(),
    };

    this.inMemoryLedger.push(record);
    return record;
  }

  public getAuditEvents(filters?: {
    entity?: string | undefined;
    entityId?: string | undefined;
    actor?: string | undefined;
    action?: string | undefined;
    batchId?: string | undefined;
  }): AuditRecord[] {
    return this.inMemoryLedger.filter((rec) => {
      if (filters?.entity && rec.entity !== filters.entity) return false;
      if (filters?.entityId && rec.entityId !== filters.entityId) return false;
      if (filters?.actor && rec.actor !== filters.actor) return false;
      if (filters?.action && rec.action !== filters.action) return false;
      if (filters?.batchId && rec.batchId !== filters.batchId) return false;
      return true;
    });
  }

  public async query(filter?: Parameters<AuditService['query']>[0]): Promise<CoreAuditRecord[]> {
    return this.audit.query(filter);
  }

  public resetLedger(): void {
    this.inMemoryLedger = [];
    if ('clear' in this.repo && typeof (this.repo as any).clear === 'function') {
      (this.repo as any).clear();
    }
  }
}

export const crm3Audit = new Crm3AuditService();
