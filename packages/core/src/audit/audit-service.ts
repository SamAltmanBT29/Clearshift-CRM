import { AuditEntryInput, AuditRecord, AuditQueryFilter } from "./types.js";
import { redactSensitiveData, redactErrorMessage } from "../logging/redact.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and, gte, lte } from "drizzle-orm";

/**
 * Custom Error indicating an illegal attempt to mutate an immutable audit trail
 */
export class AuditImmutabilityError extends Error {
  constructor(message: string = "Audit records are append-only and cannot be mutated or deleted.") {
    super(message);
    this.name = "AuditImmutabilityError";
  }
}

/**
 * Storage interface for audit entries
 */
export interface IAuditRepository {
  append(entry: AuditEntryInput): Promise<AuditRecord>;
  query(filter?: AuditQueryFilter | undefined): Promise<AuditRecord[]>;
  update?(): never;
  delete?(): never;
  count(): Promise<number>;
  clear?(): Promise<void>;
}

/**
 * In-Memory Audit Repository for fast tests and non-persistent environments
 */
export class InMemoryAuditRepository implements IAuditRepository {
  private records: AuditRecord[] = [];

  async append(entry: AuditEntryInput): Promise<AuditRecord> {
    const record: AuditRecord = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      occurredAt: new Date(),
      actor: entry.actor,
      actorRole: entry.actorRole,
      action: entry.action,
      targetEntity: entry.targetEntity,
      targetId: entry.targetId,
      correlationId: entry.correlationId,
      batchId: entry.batchId,
      result: entry.result,
      reason: entry.reason,
      metadata: entry.metadata,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
    };

    this.records.push(record);
    return record;
  }

  async query(filter?: AuditQueryFilter | undefined): Promise<AuditRecord[]> {
    let result = [...this.records];

    if (filter?.actor) {
      result = result.filter((r) => r.actor === filter.actor);
    }
    if (filter?.action) {
      result = result.filter((r) => r.action === filter.action);
    }
    if (filter?.targetEntity) {
      result = result.filter((r) => r.targetEntity === filter.targetEntity);
    }
    if (filter?.targetId) {
      result = result.filter((r) => r.targetId === filter.targetId);
    }
    if (filter?.correlationId) {
      result = result.filter((r) => r.correlationId === filter.correlationId);
    }
    if (filter?.batchId) {
      result = result.filter((r) => r.batchId === filter.batchId);
    }
    if (filter?.result) {
      result = result.filter((r) => r.result === filter.result);
    }
    if (filter?.since) {
      result = result.filter((r) => r.occurredAt >= filter.since!);
    }
    if (filter?.until) {
      result = result.filter((r) => r.occurredAt <= filter.until!);
    }

    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? 100;
    return result.slice(offset, offset + limit);
  }

  update(): never {
    throw new AuditImmutabilityError("Application role cannot update audit records (append-only policy)");
  }

  delete(): never {
    throw new AuditImmutabilityError("Application role cannot delete audit records (append-only policy)");
  }

  async count(): Promise<number> {
    return this.records.length;
  }

  async clear(): Promise<void> {
    this.records = [];
  }
}

let cachedAuditLogs: any = null;
async function getAuditLogsTable(): Promise<any> {
  if (!cachedAuditLogs) {
    const dbModule = await import("@cs/db");
    cachedAuditLogs = dbModule.auditLogs;
  }
  return cachedAuditLogs;
}

/**
 * PostgreSQL Audit Repository backed by Drizzle ORM
 */
export class PgAuditRepository implements IAuditRepository {
  constructor(private db: NodePgDatabase) {}

  async append(entry: AuditEntryInput): Promise<AuditRecord> {
    const table = await getAuditLogsTable();
    const [inserted] = await (this.db as any)
      .insert(table)
      .values({
        actor: entry.actor,
        actorRole: entry.actorRole ?? null,
        action: entry.action,
        targetEntity: entry.targetEntity,
        targetId: entry.targetId ?? null,
        correlationId: entry.correlationId,
        batchId: entry.batchId ?? null,
        result: entry.result,
        reason: entry.reason ?? null,
        metadata: entry.metadata ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      })
      .returning();

    return inserted as AuditRecord;
  }

  async query(filter?: AuditQueryFilter | undefined): Promise<AuditRecord[]> {
    const table = await getAuditLogsTable();
    const conditions = [];

    if (filter?.actor) conditions.push(eq(table.actor, filter.actor));
    if (filter?.action) conditions.push(eq(table.action, filter.action));
    if (filter?.targetEntity) conditions.push(eq(table.targetEntity, filter.targetEntity));
    if (filter?.targetId) conditions.push(eq(table.targetId, filter.targetId));
    if (filter?.correlationId) conditions.push(eq(table.correlationId, filter.correlationId));
    if (filter?.batchId) conditions.push(eq(table.batchId, filter.batchId));
    if (filter?.result) conditions.push(eq(table.result, filter.result));
    if (filter?.since) conditions.push(gte(table.occurredAt, filter.since));
    if (filter?.until) conditions.push(lte(table.occurredAt, filter.until));

    const query = (this.db as any).select().from(table);
    if (conditions.length > 0) {
      query.where(and(...conditions));
    }

    const rows = await query
      .limit(filter?.limit ?? 100)
      .offset(filter?.offset ?? 0)
      .orderBy(table.occurredAt);

    return rows as AuditRecord[];
  }

  update(): never {
    throw new AuditImmutabilityError("Application role cannot update audit records (append-only policy)");
  }

  delete(): never {
    throw new AuditImmutabilityError("Application role cannot delete audit records (append-only policy)");
  }

  async count(): Promise<number> {
    const table = await getAuditLogsTable();
    const rows = await (this.db as any).select().from(table);
    return rows.length;
  }

  async clear(): Promise<void> {
    const table = await getAuditLogsTable();
    await (this.db as any).delete(table);
  }
}

/**
 * Audit Service implementing PLT-10 requirements:
 * Sanitizes metadata and reasons, validates inputs, and writes to append-only audit trail.
 */
export class AuditService {
  constructor(private repo: IAuditRepository) {}

  async log(entry: AuditEntryInput): Promise<AuditRecord> {
    if (!entry.actor || entry.actor.trim() === "") {
      throw new Error("Audit actor is required");
    }
    if (!entry.action || entry.action.trim() === "") {
      throw new Error("Audit action is required");
    }
    if (!entry.correlationId || entry.correlationId.trim() === "") {
      throw new Error("Audit correlationId is required");
    }
    if (!entry.targetEntity || entry.targetEntity.trim() === "") {
      throw new Error("Audit targetEntity is required");
    }

    // Strict sensitive data redaction: never store passwords, tokens, full bank/salary
    const sanitizedMetadata = entry.metadata
      ? redactSensitiveData(entry.metadata)
      : undefined;

    const sanitizedReason = entry.reason
      ? redactErrorMessage(entry.reason)
      : undefined;

    return await this.repo.append({
      actor: entry.actor,
      actorRole: entry.actorRole,
      action: entry.action,
      targetEntity: entry.targetEntity,
      targetId: entry.targetId,
      correlationId: entry.correlationId,
      batchId: entry.batchId,
      result: entry.result,
      reason: sanitizedReason,
      metadata: sanitizedMetadata,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
    });
  }

  async query(filter?: AuditQueryFilter | undefined): Promise<AuditRecord[]> {
    return await this.repo.query(filter);
  }

  /**
   * Helper to audit data exports
   */
  async logExport(params: {
    actor: string;
    correlationId: string;
    exportType: string;
    entityType: string;
    recordCount: number;
    destination?: string | undefined;
  }): Promise<AuditRecord> {
    return await this.log({
      actor: params.actor,
      action: "export.generated",
      targetEntity: params.entityType,
      correlationId: params.correlationId,
      result: "success",
      metadata: {
        exportType: params.exportType,
        recordCount: params.recordCount,
        destination: params.destination,
      },
    });
  }

  /**
   * Helper to audit merge decisions
   */
  async logMergeDecision(params: {
    actor: string;
    correlationId: string;
    survivingGoldenId: string;
    subsumedSourceId: string;
    decision: "approved" | "rejected";
    approverNotes?: string | undefined;
  }): Promise<AuditRecord> {
    return await this.log({
      actor: params.actor,
      action: "merge.decided",
      targetEntity: "golden_id",
      targetId: params.survivingGoldenId,
      correlationId: params.correlationId,
      result: "success",
      reason: `Merge ${params.decision}: ${params.subsumedSourceId} -> ${params.survivingGoldenId}`,
      metadata: {
        survivingGoldenId: params.survivingGoldenId,
        subsumedSourceId: params.subsumedSourceId,
        decision: params.decision,
        notes: params.approverNotes,
      },
    });
  }

  /**
   * Helper to audit role changes
   */
  async logRoleChange(params: {
    actor: string;
    correlationId: string;
    targetUserId: string;
    oldRoles: string[];
    newRoles: string[];
  }): Promise<AuditRecord> {
    return await this.log({
      actor: params.actor,
      action: "role.changed",
      targetEntity: "user",
      targetId: params.targetUserId,
      correlationId: params.correlationId,
      result: "success",
      metadata: {
        oldRoles: params.oldRoles,
        newRoles: params.newRoles,
      },
    });
  }

  /**
   * Helper to audit financial postings
   */
  async logFinancialPosting(params: {
    actor: string;
    correlationId: string;
    journalEntryId: string;
    periodId: string;
    totalAmount: string;
    action?: "journal.posted" | "journal.reversed" | undefined;
  }): Promise<AuditRecord> {
    return await this.log({
      actor: params.actor,
      action: params.action ?? "journal.posted",
      targetEntity: "journal_entry",
      targetId: params.journalEntryId,
      correlationId: params.correlationId,
      result: "success",
      metadata: {
        periodId: params.periodId,
        totalAmount: params.totalAmount,
      },
    });
  }

  /**
   * Helper to audit authentication failures
   */
  async logAuthFailure(params: {
    username: string;
    correlationId: string;
    reason: string;
    ipAddress?: string | undefined;
  }): Promise<AuditRecord> {
    return await this.log({
      actor: params.username,
      action: "auth.failed",
      targetEntity: "session",
      correlationId: params.correlationId,
      result: "failure",
      reason: params.reason,
      ipAddress: params.ipAddress,
    });
  }
}
