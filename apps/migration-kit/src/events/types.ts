import type { EventEnvelope } from '@clearshift/contracts';
import type { OutboxRecord } from '@clearshift/database';

/**
 * Interface for writing event envelopes into the PostgreSQL transactional outbox.
 */
export interface IOutboxWriter {
  writeEvent<T extends Record<string, unknown> = Record<string, unknown>>(
    tx: unknown,
    envelope: EventEnvelope<T>
  ): Promise<OutboxRecord>;
}

/**
 * In-Memory Outbox Writer for deterministic unit testing and simulation.
 */
export class InMemoryOutboxWriter implements IOutboxWriter {
  private records: OutboxRecord[] = [];
  private stagedByTx: Map<unknown, OutboxRecord[]> = new Map();

  public async writeEvent<T extends Record<string, unknown> = Record<string, unknown>>(
    tx: unknown,
    envelope: EventEnvelope<T>
  ): Promise<OutboxRecord> {
    const record: OutboxRecord = {
      id: crypto.randomUUID(),
      eventId: envelope.id,
      eventType: envelope.eventType,
      payload: envelope,
      publishedAt: null,
      createdAt: new Date(),
      retryCount: 0,
      lastError: null,
    };

    if (tx) {
      const staged = this.stagedByTx.get(tx) ?? [];
      staged.push(record);
      this.stagedByTx.set(tx, staged);
    } else {
      this.records.push(record);
    }

    return record;
  }

  public commitTx(tx: unknown): void {
    const staged = this.stagedByTx.get(tx) ?? [];
    this.records.push(...staged);
    this.stagedByTx.delete(tx);
  }

  public rollbackTx(tx: unknown): void {
    this.stagedByTx.delete(tx);
  }

  public getRecords(): OutboxRecord[] {
    return [...this.records];
  }

  public getByBatchId(batchId: string): OutboxRecord[] {
    return this.records.filter((r) => {
      const payload = r.payload as unknown as { payload?: { batch_id?: string; batchId?: string } };
      return (
        payload?.payload?.batch_id === batchId ||
        payload?.payload?.batchId === batchId
      );
    });
  }

  public clear(): void {
    this.records = [];
    this.stagedByTx.clear();
  }
}

/**
 * Interface for consumer deduplication repository (platform.consumed_events)
 */
export interface IConsumedEventsRepository {
  isEventConsumed(consumer: string, eventId: string): Promise<boolean>;
  recordConsumed(consumer: string, eventId: string): Promise<void>;
}

/**
 * In-Memory Consumed Events Store for testing.
 */
export class InMemoryConsumedEventsStore implements IConsumedEventsRepository {
  private consumed = new Set<string>();

  private key(consumer: string, eventId: string): string {
    return `${consumer}:${eventId}`;
  }

  public async isEventConsumed(consumer: string, eventId: string): Promise<boolean> {
    return this.consumed.has(this.key(consumer, eventId));
  }

  public async recordConsumed(consumer: string, eventId: string): Promise<void> {
    this.consumed.add(this.key(consumer, eventId));
  }

  public clear(): void {
    this.consumed.clear();
  }
}

/**
 * CRM-5 Run Projection Read Model
 */
export interface Crm5RunProjection {
  id: string;
  batchId: string;
  module: string;
  step: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'halted';
  recordsIn: number;
  recordsOut: number;
  recordsRejected: number;
  startedAt: Date;
  completedAt: Date | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * CRM-5 Quality Score Projection Read Model
 */
export interface Crm5ScoreProjection {
  id: string;
  batchId: string;
  module: string;
  completeness: number | null;
  validity: number | null;
  duplicateRate: number | null;
  rejectRate: number | null;
  linkIntegrity: number | null;
  score: number | null;
  isFullyScored: boolean;
  scoredAt: Date;
  createdAt: Date;
}

/**
 * CRM-5 Reject Projection Read Model
 */
export interface Crm5RejectProjection {
  id: string;
  batchId: string;
  module: string;
  rowIndex: number;
  errorCode: string;
  errorMessage: string;
  rawPayloadHash: string;
  createdAt: Date;
}

/**
 * CRM-5 Reconciliation Report Projection Read Model
 */
export interface Crm5ReconciliationProjection {
  id: string;
  batchId: string;
  module: string;
  sourceCount: number;
  loadedCount: number;
  rejectedCount: number;
  mergedCount: number;
  skippedCount: number;
  unaccountedCount: number;
  status: 'OK' | 'UNBALANCED';
  reconciledAt: Date;
  createdAt: Date;
}

/**
 * Storage contract for CRM-5 Projections.
 */
export interface ICrm5ProjectionStore {
  getRun(batchId: string): Promise<Crm5RunProjection | null>;
  saveRun(run: Crm5RunProjection): Promise<void>;
  getScore(batchId: string): Promise<Crm5ScoreProjection | null>;
  saveScore(score: Crm5ScoreProjection): Promise<void>;
  getReconciliation(batchId: string): Promise<Crm5ReconciliationProjection | null>;
  saveReconciliation(recon: Crm5ReconciliationProjection): Promise<void>;
  listRejects(batchId: string): Promise<Crm5RejectProjection[]>;
  saveReject(reject: Crm5RejectProjection): Promise<void>;
}

/**
 * In-Memory Projection Store for CRM-5 read models.
 */
export class InMemoryCrm5ProjectionStore implements ICrm5ProjectionStore {
  private runs = new Map<string, Crm5RunProjection>();
  private scores = new Map<string, Crm5ScoreProjection>();
  private reconciliations = new Map<string, Crm5ReconciliationProjection>();
  private rejects = new Map<string, Crm5RejectProjection[]>();

  public async getRun(batchId: string): Promise<Crm5RunProjection | null> {
    const found = this.runs.get(batchId);
    return found ? { ...found } : null;
  }

  public async saveRun(run: Crm5RunProjection): Promise<void> {
    this.runs.set(run.batchId, { ...run });
  }

  public async getScore(batchId: string): Promise<Crm5ScoreProjection | null> {
    const found = this.scores.get(batchId);
    return found ? { ...found } : null;
  }

  public async saveScore(score: Crm5ScoreProjection): Promise<void> {
    this.scores.set(score.batchId, { ...score });
  }

  public async getReconciliation(batchId: string): Promise<Crm5ReconciliationProjection | null> {
    const found = this.reconciliations.get(batchId);
    return found ? { ...found } : null;
  }

  public async saveReconciliation(recon: Crm5ReconciliationProjection): Promise<void> {
    this.reconciliations.set(recon.batchId, { ...recon });
  }

  public async listRejects(batchId: string): Promise<Crm5RejectProjection[]> {
    return (this.rejects.get(batchId) ?? []).map((r) => ({ ...r }));
  }

  public async saveReject(reject: Crm5RejectProjection): Promise<void> {
    const list = this.rejects.get(reject.batchId) ?? [];
    list.push({ ...reject });
    this.rejects.set(reject.batchId, list);
  }

  public clear(): void {
    this.runs.clear();
    this.scores.clear();
    this.reconciliations.clear();
    this.rejects.clear();
  }
}
