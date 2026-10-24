import { randomUUID } from 'node:crypto';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { redactSensitiveObject, maskSensitiveLog } from '../policies/masking.js';

let cachedAuditTable: any = null;
async function getAuditTable(): Promise<any> {
  if (!cachedAuditTable) {
    const dbModule = await import('@cs/db');
    cachedAuditTable = dbModule.audit;
  }
  return cachedAuditTable;
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

/**
 * CRM-3 Audit Service
 * Emits append-only audit events capturing actor, action, timestamp, entity, and correlation.
 * Automatically redacts sensitive fields (passwords, tokens, bank details, salary).
 * Never records raw rows.
 */
export class Crm3AuditService {
  private inMemoryLedger: AuditRecord[] = [];
  private db?: NodePgDatabase | undefined;

  constructor(db?: NodePgDatabase | undefined) {
    this.db = db;
  }

  /**
   * Records an audit event immutably.
   */
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

    // Store in in-memory ledger
    this.inMemoryLedger.push(record);

    // If database connection is active and valid UUID, persist to platform audit table
    if (this.db) {
      try {
        const uuidRegex =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const validEntityId =
          input.entityId && uuidRegex.test(input.entityId) ? input.entityId : null;

        const auditTable = await getAuditTable();
        await (this.db as any).insert(auditTable).values({
          id: record.id,
          actor: record.actor,
          action: record.action,
          entity: record.entity,
          entityId: validEntityId,
          diffRedacted: {
            ...record.diffRedacted,
            ...(record.batchId ? { batchId: record.batchId } : {}),
            result: record.result,
          },
          createdAt: record.createdAt,
        });
      } catch (err: any) {
        // Log safe message without throwing to prevent breaking business transactions
        const safeMsg = maskSensitiveLog(`Failed to persist audit to DB: ${err.message}`);
        console.error(safeMsg);
      }
    }

    return record;
  }

  /**
   * Retrieves audit records matching optional filters.
   */
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

  /**
   * Clears in-memory ledger (primarily for test resets).
   */
  public resetLedger(): void {
    this.inMemoryLedger = [];
  }
}

export const crm3Audit = new Crm3AuditService();
