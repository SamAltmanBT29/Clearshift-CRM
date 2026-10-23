import { randomUUID } from 'node:crypto';
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
  CreateRunInput,
  CreateScoreInput,
  CreateReconciliationInput,
  CreateRejectInput,
  DuplicateCandidate,
  ResolveDuplicateInput,
  DuplicateAuditLogEntry,
  DetectDuplicatesInput,
  ExecuteBatchLoadInput,
  BatchExecutionReport,
  UpdateRunInput,
} from '@clearshift/contracts';
import {
  calculateQualityScore,
  verifyReconciliation,
  sanitizeCsvFormula,
} from '@clearshift/contracts';
import { DomainValidationError, DomainConflictError } from '../domain/errors.js';
import {
  DuplicateReviewQueue,
  detectExactDuplicates,
  type DuplicateDetectionResult,
} from '../domain/duplicate-policy.js';
import { assertValidTransition } from '../domain/transitions.js';
import { buildBatchSummary, type BatchSummary } from '../domain/relationships.js';
import {
  executeChunkedBatchLoad,
  type BatchLoaderOptions,
} from '../domain/batch-loader.js';

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
  private duplicateQueue: DuplicateReviewQueue = new DuplicateReviewQueue();

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

  public getRunById(id: string): MigrationRun | null {
    const run = this.runs.find((r) => r.id === id);
    return run ? { ...run } : null;
  }

  public updateRun(id: string, input: UpdateRunInput): MigrationRun {
    const existingIndex = this.runs.findIndex((r) => r.id === id);
    if (existingIndex === -1) {
      throw new DomainValidationError(`Run projection with ID '${id}' not found`);
    }

    const current = this.runs[existingIndex]!;

    // Optimistic Concurrency Control (AC 4 / 409 Conflict)
    if (input.expectedUpdatedAt) {
      const expectedTime = new Date(input.expectedUpdatedAt).getTime();
      const actualTime = current.updatedAt.getTime();
      if (actualTime > expectedTime) {
        throw new DomainConflictError(
          'Concurrent modification detected: this run record was updated concurrently by another operator. Please refresh and re-apply changes.',
          { currentUpdatedAt: current.updatedAt.toISOString(), submittedExpectedUpdatedAt: new Date(input.expectedUpdatedAt).toISOString() }
        );
      }
    }

    // Validate state transition if status is being updated
    if (input.status && input.status !== current.status) {
      assertValidTransition(current.status, input.status);
    }

    // Merge allowlisted fields
    const updatedRun: MigrationRun = {
      ...current,
      status: input.status ?? current.status,
      recordsIn: input.recordsIn !== undefined ? input.recordsIn : current.recordsIn,
      recordsOut: input.recordsOut !== undefined ? input.recordsOut : current.recordsOut,
      recordsRejected: input.recordsRejected !== undefined ? input.recordsRejected : current.recordsRejected,
      completedAt: input.completedAt !== undefined ? input.completedAt : current.completedAt,
      metadata: input.metadata !== undefined ? { ...(current.metadata ?? {}), ...input.metadata } : current.metadata,
      updatedAt: new Date(),
    };

    this.runs[existingIndex] = updatedRun;
    return { ...updatedRun };
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
  // 5. Batch Relationships & Aggregated Read Model
  // ---------------------------------------------------------------------------

  public getBatchSummary(batchId: string): BatchSummary | null {
    const runs = this.runs.filter((r) => r.batchId === batchId);
    if (runs.length === 0) {
      return null;
    }
    const module = runs[0]!.module;
    const score = this.scores.find((s) => s.batchId === batchId) ?? null;
    const reconciliation = this.reconciliations.get(batchId) ?? null;
    const rejects = this.rejects.filter((r) => r.batchId === batchId);

    return buildBatchSummary({
      batchId,
      module,
      runs,
      score,
      reconciliation,
      rejects,
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Mutation API Methods with Domain Validation
  // ---------------------------------------------------------------------------

  public recordRun(input: CreateRunInput): { run: MigrationRun; isDuplicate: boolean } {
    // 1. Business Invariant Checks
    if (input.recordsIn < 0 || input.recordsOut < 0 || input.recordsRejected < 0) {
      throw new DomainValidationError('Record counts cannot be negative', {
        recordsIn: input.recordsIn,
        recordsOut: input.recordsOut,
        recordsRejected: input.recordsRejected,
      });
    }

    if (input.recordsOut + input.recordsRejected > input.recordsIn) {
      throw new DomainValidationError(
        'Invariant violation: sum of recordsOut and recordsRejected cannot exceed recordsIn',
        {
          recordsIn: input.recordsIn,
          recordsOut: input.recordsOut,
          recordsRejected: input.recordsRejected,
        }
      );
    }

    // 2. Idempotency & Conflict Check
    const existingIndex = this.runs.findIndex(
      (r) => r.batchId === input.batchId && r.step === input.step
    );

    const now = new Date();

    if (existingIndex >= 0) {
      const existing = this.runs[existingIndex]!;
      // Exact duplicate data -> return existing (idempotent)
      if (
        existing.status === input.status &&
        existing.recordsIn === input.recordsIn &&
        existing.recordsOut === input.recordsOut &&
        existing.recordsRejected === input.recordsRejected
      ) {
        return { run: existing, isDuplicate: true };
      }

      // Assert valid state transition across the formal state machine
      if (existing.status !== input.status) {
        assertValidTransition(existing.status, input.status);
      }


      // Valid update (e.g. from pending/running to completed/failed)
      const updatedRun: MigrationRun = {
        ...existing,
        status: input.status,
        recordsIn: input.recordsIn,
        recordsOut: input.recordsOut,
        recordsRejected: input.recordsRejected,
        completedAt:
          input.completedAt ??
          (input.status === 'completed' || input.status === 'failed' || input.status === 'halted'
            ? now
            : existing.completedAt),
        metadata: input.metadata ?? existing.metadata,
        updatedAt: now,
      };

      this.runs[existingIndex] = updatedRun;
      return { run: updatedRun, isDuplicate: false };
    }

    // New run projection
    const newRun: MigrationRun = {
      id: randomUUID(),
      batchId: input.batchId,
      module: input.module,
      step: input.step,
      status: input.status,
      recordsIn: input.recordsIn,
      recordsOut: input.recordsOut,
      recordsRejected: input.recordsRejected,
      startedAt: input.startedAt ?? now,
      completedAt: input.completedAt ?? (input.status === 'completed' ? now : null),
      metadata: input.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.runs.push(newRun);
    return { run: newRun, isDuplicate: false };
  }

  public recordScore(input: CreateScoreInput): { score: QualityScore; isDuplicate: boolean } {
    // Validate bounds 0..1
    const dims = [
      { name: 'completeness', val: input.completeness },
      { name: 'validity', val: input.validity },
      { name: 'duplicateRate', val: input.duplicateRate },
      { name: 'rejectRate', val: input.rejectRate },
      { name: 'linkIntegrity', val: input.linkIntegrity },
    ];

    for (const d of dims) {
      if (d.val != null && (d.val < 0 || d.val > 1)) {
        throw new DomainValidationError(`Dimension ${d.name} must be between 0.0 and 1.0`, {
          field: d.name,
          value: d.val,
        });
      }
    }

    const isFullyScored =
      input.completeness != null &&
      input.validity != null &&
      input.duplicateRate != null &&
      input.rejectRate != null &&
      input.linkIntegrity != null;

    const calculatedScore = isFullyScored
      ? calculateQualityScore({
          completeness: input.completeness!,
          validity: input.validity!,
          duplicateRate: input.duplicateRate!,
          rejectRate: input.rejectRate!,
          linkIntegrity: input.linkIntegrity!,
        })
      : null;

    const existingIndex = this.scores.findIndex((s) => s.batchId === input.batchId);
    const now = new Date();

    if (existingIndex >= 0) {
      const existing = this.scores[existingIndex]!;
      if (
        existing.completeness === input.completeness &&
        existing.validity === input.validity &&
        existing.duplicateRate === input.duplicateRate &&
        existing.rejectRate === input.rejectRate &&
        existing.linkIntegrity === input.linkIntegrity
      ) {
        return { score: existing, isDuplicate: true };
      }

      const updatedScore: QualityScore = {
        ...existing,
        completeness: input.completeness ?? existing.completeness,
        validity: input.validity ?? existing.validity,
        duplicateRate: input.duplicateRate ?? existing.duplicateRate,
        rejectRate: input.rejectRate ?? existing.rejectRate,
        linkIntegrity: input.linkIntegrity ?? existing.linkIntegrity,
        score: calculatedScore ?? existing.score,
        isFullyScored,
        scoredAt: now,
      };

      this.scores[existingIndex] = updatedScore;
      return { score: updatedScore, isDuplicate: false };
    }

    const newScore: QualityScore = {
      id: randomUUID(),
      batchId: input.batchId,
      module: input.module,
      completeness: input.completeness ?? null,
      validity: input.validity ?? null,
      duplicateRate: input.duplicateRate ?? null,
      rejectRate: input.rejectRate ?? null,
      linkIntegrity: input.linkIntegrity ?? null,
      score: calculatedScore,
      isFullyScored,
      scoredAt: now,
      createdAt: now,
    };

    this.scores.push(newScore);
    return { score: newScore, isDuplicate: false };
  }

  public recordReconciliation(input: CreateReconciliationInput): {
    report: ReconciliationReport;
    isDuplicate: boolean;
  } {
    if (
      input.sourceCount < 0 ||
      input.loadedCount < 0 ||
      input.rejectedCount < 0 ||
      input.mergedCount < 0 ||
      input.skippedCount < 0
    ) {
      throw new DomainValidationError('Reconciliation counts cannot be negative', input);
    }

    const existing = this.reconciliations.get(input.batchId);
    if (existing) {
      const isExactMatch =
        existing.sourceCount === input.sourceCount &&
        existing.loadedCount === input.loadedCount &&
        existing.rejectedCount === input.rejectedCount &&
        existing.mergedCount === input.mergedCount &&
        existing.skippedCount === input.skippedCount;

      if (isExactMatch) {
        return { report: existing, isDuplicate: true };
      }

      throw new DomainConflictError(
        `Reconciliation report for batch '${input.batchId}' already exists and cannot be modified with different counts`,
        { batchId: input.batchId }
      );
    }

    const verification = verifyReconciliation({
      sourceCount: input.sourceCount,
      loadedCount: input.loadedCount,
      rejectedCount: input.rejectedCount,
      mergedCount: input.mergedCount,
      skippedCount: input.skippedCount,
    });

    const now = new Date();
    const report: ReconciliationReport = {
      id: randomUUID(),
      batchId: input.batchId,
      module: input.module,
      sourceCount: input.sourceCount,
      loadedCount: input.loadedCount,
      rejectedCount: input.rejectedCount,
      mergedCount: input.mergedCount,
      skippedCount: input.skippedCount,
      unaccountedCount: verification.unaccountedCount,
      status: verification.status,
      reconciledAt: now,
      createdAt: now,
    };

    this.reconciliations.set(input.batchId, report);
    return { report, isDuplicate: false };
  }

  public recordReject(input: CreateRejectInput): {
    reject: MigrationReject;
    isDuplicate: boolean;
  } {
    if (input.rowIndex < 1) {
      throw new DomainValidationError('rowIndex must be a positive integer starting at 1', {
        rowIndex: input.rowIndex,
      });
    }

    // Formula injection defense: neutralize spreadsheet formula prefixes
    const safeErrorMessage = sanitizeCsvFormula(input.errorMessage);

    const existing = this.rejects.find(
      (r) =>
        r.batchId === input.batchId &&
        r.rowIndex === input.rowIndex &&
        r.errorCode === input.errorCode
    );

    if (existing) {
      return { reject: existing, isDuplicate: true };
    }

    const now = new Date();
    const reject: MigrationReject = {
      id: randomUUID(),
      batchId: input.batchId,
      module: input.module,
      rowIndex: input.rowIndex,
      errorCode: input.errorCode,
      errorMessage: safeErrorMessage,
      rawPayloadHash: input.rawPayloadHash,
      createdAt: now,
    };

    this.rejects.push(reject);
    return { reject, isDuplicate: false };
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
    this.duplicateQueue.clear();
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

    this.duplicateQueue.addCandidate({
      id: 'e0000000-0000-0000-0000-000000000001',
      batchId: 'batch-contacts-01',
      keyType: 'email',
      normalizedKey: 'lead.ops@example.com',
      recordIds: ['rec-001', 'rec-002'],
      status: 'held_for_review',
      detectedAt: now,
      metadata: {
        originalKeys: ['  Lead.Ops@Example.COM  ', 'lead.ops@example.com'],
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Duplicate Key Policy & Human Review Audit (CRM5-12)
  // ---------------------------------------------------------------------------

  public detectDuplicates(input: DetectDuplicatesInput): DuplicateDetectionResult {
    const result = detectExactDuplicates(input.records, input.keyType, {
      batchId: input.batchId,
      autoMerge: input.autoMerge,
    });

    if (result.duplicateCandidates.length > 0) {
      this.duplicateQueue.addCandidates(result.duplicateCandidates);
    }

    return result;
  }

  public getHeldDuplicates(query?: { batchId?: string | undefined; keyType?: string | undefined }): DuplicateCandidate[] {
    return this.duplicateQueue.listHeld(query);
  }

  public resolveDuplicate(input: ResolveDuplicateInput): DuplicateAuditLogEntry {
    return this.duplicateQueue.resolve(input);
  }

  public getDuplicateAuditLogs(query?: {
    candidateId?: string | undefined;
    actorId?: string | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
  }): {
    items: DuplicateAuditLogEntry[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } {
    return this.duplicateQueue.getAuditLogs(query);
  }

  // ---------------------------------------------------------------------------
  // 9. Idempotent Retry & Chunked Load Execution (CRM5-13)
  // ---------------------------------------------------------------------------

  public async executeBatchLoad(
    input: ExecuteBatchLoadInput,
    options?: BatchLoaderOptions
  ): Promise<BatchExecutionReport> {
    const report = await executeChunkedBatchLoad(input, options);

    const now = new Date();
    const runStatus =
      report.status === 'COMPLETED'
        ? 'completed'
        : report.status === 'STOPPED_EXCESSIVE_FAILURES'
          ? 'halted'
          : 'failed';

    const existingRunIndex = this.runs.findIndex(
      (r) => r.batchId === input.batchId && r.step === input.step
    );

    const runData: MigrationRun = {
      id: existingRunIndex >= 0 ? this.runs[existingRunIndex]!.id : randomUUID(),
      batchId: input.batchId,
      module: input.module,
      step: input.step,
      status: runStatus,
      recordsIn: report.attemptedRecords,
      recordsOut: report.committedRecords,
      recordsRejected: report.failedRecords,
      startedAt: existingRunIndex >= 0 ? this.runs[existingRunIndex]!.startedAt : now,
      completedAt:
        runStatus === 'completed' || runStatus === 'halted' || runStatus === 'failed'
          ? now
          : null,
      metadata: {
        status: report.status,
        haltReason: report.haltReason,
        failureRate: report.failureRate,
        chunkSize: report.chunkSize,
        chunksProcessed: report.chunksProcessed,
      },
      createdAt: existingRunIndex >= 0 ? this.runs[existingRunIndex]!.createdAt : now,
      updatedAt: now,
    };

    if (existingRunIndex >= 0) {
      this.runs[existingRunIndex] = runData;
    } else {
      this.runs.push(runData);
    }

    // Record failed rows as rejects
    for (const fail of report.failedRows) {
      this.rejects.push({
        id: randomUUID(),
        batchId: input.batchId,
        module: input.module,
        rowIndex: fail.sourceRow,
        errorCode: fail.errorCode,
        errorMessage: fail.errorMessage,
        rawPayloadHash: `hash-${fail.idempotencyKey.slice(0, 16)}`,
        createdAt: now,
      });
    }

    return report;
  }
}
