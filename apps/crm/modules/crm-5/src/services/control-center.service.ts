import type {
  MigrationRun,
  RunsQuery,
  PaginatedRunsResponse,
  QualityScore,
  ScoresQuery,
  ScoresResponse,
  MigrationReject,
  RejectsQuery,
  PaginatedRejectsResponse,
  ReconciliationReport,
} from '@clearshift/contracts';

/**
 * CRM-5 Control Center Service
 * Provides server-side filtered, bounded, and deterministically sorted read models
 * for migration run events, quality scores, rejects, and reconciliation balance sheets.
 * Strictly read-only towards other CRM modules.
 */
export class ControlCenterService {
  private runs: MigrationRun[] = [];
  private scores: QualityScore[] = [];
  private rejects: MigrationReject[] = [];
  private reconciliations: Map<string, ReconciliationReport> = new Map();

  constructor() {
    this.seedSyntheticData();
  }

  // ---------------------------------------------------------------------------
  // 1. Migration Runs Projections
  // ---------------------------------------------------------------------------

  public getRuns(query: RunsQuery): PaginatedRunsResponse {
    let filtered = [...this.runs];

    if (query.module) {
      filtered = filtered.filter((r) => r.module === query.module);
    }
    if (query.batchId) {
      const target = query.batchId.toLowerCase();
      filtered = filtered.filter((r) => r.batchId.toLowerCase().includes(target));
    }
    if (query.status) {
      filtered = filtered.filter((r) => r.status === query.status);
    }

    // Stable, deterministic sort: startedAt desc, id asc
    filtered.sort((a, b) => {
      const diff = b.startedAt.getTime() - a.startedAt.getTime();
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });

    const total = filtered.length;
    const page = query.page;
    const pageSize = query.pageSize;
    const totalPages = Math.ceil(total / pageSize) || (total === 0 ? 0 : 1);
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      limit: pageSize,
      totalPages,
    };
  }

  // ---------------------------------------------------------------------------
  // 2. Data Quality Scores
  // ---------------------------------------------------------------------------

  public getScores(query: ScoresQuery): ScoresResponse {
    let filtered = [...this.scores];

    if (query.module) {
      filtered = filtered.filter((s) => s.module === query.module);
    }
    if (query.batchId) {
      const target = query.batchId.toLowerCase();
      filtered = filtered.filter((s) => s.batchId.toLowerCase().includes(target));
    }

    filtered.sort((a, b) => b.scoredAt.getTime() - a.scoredAt.getTime());

    // Average score includes only fully scored batches
    const fullyScored = filtered.filter((s) => s.isFullyScored && s.score != null);
    const averageScore =
      fullyScored.length > 0
        ? Math.round(
            (fullyScored.reduce((acc, s) => acc + (s.score ?? 0), 0) / fullyScored.length) * 100
          ) / 100
        : null;

    const total = filtered.length;
    const page = query.page;
    const pageSize = query.pageSize;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      limit: pageSize,
      averageScore,
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Migration Rejects
  // ---------------------------------------------------------------------------

  public getRejects(query: RejectsQuery): PaginatedRejectsResponse {
    let filtered = [...this.rejects];

    if (query.module) {
      filtered = filtered.filter((r) => r.module === query.module);
    }
    if (query.batchId) {
      const target = query.batchId.toLowerCase();
      filtered = filtered.filter((r) => r.batchId.toLowerCase().includes(target));
    }

    filtered.sort((a, b) => a.rowIndex - b.rowIndex);

    const total = filtered.length;
    const page = query.page;
    const pageSize = query.pageSize;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      limit: pageSize,
    };
  }

  // ---------------------------------------------------------------------------
  // 4. Reconciliation Reports
  // ---------------------------------------------------------------------------

  public getReconciliation(batchId: string): ReconciliationReport | null {
    return this.reconciliations.get(batchId) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Helpers for testing / ingestion
  // ---------------------------------------------------------------------------

  public addRun(run: MigrationRun): void {
    // Tolerates duplicate events and deduplicates by id
    const existingIndex = this.runs.findIndex((r) => r.id === run.id);
    if (existingIndex >= 0) {
      this.runs[existingIndex] = run;
    } else {
      this.runs.push(run);
    }
  }

  public addScore(score: QualityScore): void {
    const existingIndex = this.scores.findIndex((s) => s.id === score.id);
    if (existingIndex >= 0) {
      this.scores[existingIndex] = score;
    } else {
      this.scores.push(score);
    }
  }

  public addReject(reject: MigrationReject): void {
    const existingIndex = this.rejects.findIndex((r) => r.id === reject.id);
    if (existingIndex >= 0) {
      this.rejects[existingIndex] = reject;
    } else {
      this.rejects.push(reject);
    }
  }

  public addReconciliation(report: ReconciliationReport): void {
    this.reconciliations.set(report.batchId, report);
  }

  public clear(): void {
    this.runs = [];
    this.scores = [];
    this.rejects = [];
    this.reconciliations.clear();
  }

  private seedSyntheticData(): void {
    const now = new Date('2026-10-18T10:00:00Z');
    const earlier = new Date('2026-10-18T09:30:00Z');

    this.addRun({
      id: 'a0000000-0000-0000-0000-000000000001',
      batchId: 'batch-contacts-01',
      module: 'crm-1',
      step: 'load',
      status: 'completed',
      recordsIn: 1000,
      recordsOut: 980,
      recordsRejected: 20,
      startedAt: earlier,
      completedAt: now,
      metadata: { source: 'csv', checksum: 'sha256-synthetic-01' },
      createdAt: earlier,
      updatedAt: now,
    });

    this.addRun({
      id: 'a0000000-0000-0000-0000-000000000002',
      batchId: 'batch-deals-02',
      module: 'crm-2',
      step: 'validate',
      status: 'running',
      recordsIn: 500,
      recordsOut: 450,
      recordsRejected: 50,
      startedAt: now,
      completedAt: null,
      metadata: { source: 'hubspot', checksum: 'sha256-synthetic-02' },
      createdAt: now,
      updatedAt: now,
    });

    this.addScore({
      id: 'b0000000-0000-0000-0000-000000000001',
      batchId: 'batch-contacts-01',
      module: 'crm-1',
      completeness: 0.98,
      validity: 0.95,
      duplicateRate: 0.02,
      rejectRate: 0.02,
      linkIntegrity: 1.0,
      score: 97.8,
      isFullyScored: true,
      scoredAt: now,
      createdAt: now,
    });

    this.addReject({
      id: 'c0000000-0000-0000-0000-000000000001',
      batchId: 'batch-contacts-01',
      module: 'crm-1',
      rowIndex: 42,
      errorCode: 'INVALID_EMAIL_FORMAT',
      errorMessage: 'Contact row has malformed email syntax',
      rawPayloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      createdAt: now,
    });

    this.addReconciliation({
      id: 'd0000000-0000-0000-0000-000000000001',
      batchId: 'batch-contacts-01',
      module: 'crm-1',
      sourceCount: 1000,
      loadedCount: 980,
      rejectedCount: 20,
      mergedCount: 0,
      skippedCount: 0,
      unaccountedCount: 0,
      status: 'OK',
      reconciledAt: now,
      createdAt: now,
    });
  }
}
