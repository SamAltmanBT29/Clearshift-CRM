import type {
  FastifyPluginAsync,
  FastifyRequest,
  FastifyReply,
  FastifyInstance,
} from 'fastify';
import {
  type MigrationRun,
  type QualityScore,
  type MigrationReject,
  type ReconciliationReport,
  type DuplicateCandidate,
  type DuplicateAuditLogEntry,
  type BatchSummaryContract,
  type ImportReceipt,
  type CrmModule,
  type MigrationRunStatus,
  CRM5_API_PREFIX,
  RunsQuerySchema,
  ScoresQuerySchema,
  RejectsQuerySchema,
  DetectDuplicatesInputSchema,
  ResolveDuplicateInputSchema,
  computeQualityScore,
  verifyReconciliation,
  normalizeExactKey,
} from './crm-5.js';
import {
  createErrorEnvelope,
  StandardErrorCodes,
} from './common.js';

// ---------------------------------------------------------------------------
// 1. Deterministic Synthetic Fixture Generators
// ---------------------------------------------------------------------------

export function createDeterministicMockRuns(): MigrationRun[] {
  return [
    {
      id: '50000000-0000-4000-8000-000000000001',
      batchId: 'batch-contacts-v1-001',
      module: 'crm-1',
      step: 'load',
      status: 'completed',
      recordsIn: 500,
      recordsOut: 492,
      recordsRejected: 8,
      startedAt: new Date('2026-10-23T08:00:00.000Z'),
      completedAt: new Date('2026-10-23T08:02:15.000Z'),
      metadata: { sourceFile: 'contacts-chunk-1.csv', chunkSize: 500 },
      createdAt: new Date('2026-10-23T08:00:00.000Z'),
      updatedAt: new Date('2026-10-23T08:02:15.000Z'),
    },
    {
      id: '50000000-0000-4000-8000-000000000002',
      batchId: 'batch-deals-v1-002',
      module: 'crm-2',
      step: 'load',
      status: 'completed',
      recordsIn: 250,
      recordsOut: 245,
      recordsRejected: 5,
      startedAt: new Date('2026-10-23T08:30:00.000Z'),
      completedAt: new Date('2026-10-23T08:31:45.000Z'),
      metadata: { sourceFile: 'deals-chunk-1.csv', chunkSize: 250 },
      createdAt: new Date('2026-10-23T08:30:00.000Z'),
      updatedAt: new Date('2026-10-23T08:31:45.000Z'),
    },
    {
      id: '50000000-0000-4000-8000-000000000003',
      batchId: 'batch-tickets-v1-003',
      module: 'crm-3',
      step: 'clean',
      status: 'running',
      recordsIn: 300,
      recordsOut: 150,
      recordsRejected: 0,
      startedAt: new Date('2026-10-23T09:00:00.000Z'),
      completedAt: null,
      metadata: { sourceFile: 'tickets-chunk-1.csv' },
      createdAt: new Date('2026-10-23T09:00:00.000Z'),
      updatedAt: new Date('2026-10-23T09:00:00.000Z'),
    },
    {
      id: '50000000-0000-4000-8000-000000000004',
      batchId: 'batch-campaigns-v1-004',
      module: 'crm-4',
      step: 'validate',
      status: 'failed',
      recordsIn: 100,
      recordsOut: 85,
      recordsRejected: 15,
      startedAt: new Date('2026-10-23T09:30:00.000Z'),
      completedAt: new Date('2026-10-23T09:31:10.000Z'),
      metadata: { failureReason: 'High unsubscribe rejection threshold exceeded' },
      createdAt: new Date('2026-10-23T09:30:00.000Z'),
      updatedAt: new Date('2026-10-23T09:31:10.000Z'),
    },
  ];
}

export function createDeterministicMockScores(): QualityScore[] {
  return [
    {
      id: '51000000-0000-4000-8000-000000000001',
      batchId: 'batch-contacts-v1-001',
      module: 'crm-1',
      completeness: 0.98,
      validity: 0.97,
      duplicateRate: 0.01,
      rejectRate: 0.016,
      linkIntegrity: 0.985,
      score: 98.18,
      isFullyScored: true,
      scoredAt: new Date('2026-10-23T08:03:00.000Z'),
      createdAt: new Date('2026-10-23T08:03:00.000Z'),
    },
    {
      id: '51000000-0000-4000-8000-000000000002',
      batchId: 'batch-deals-v1-002',
      module: 'crm-2',
      completeness: 0.95,
      validity: 0.96,
      duplicateRate: 0.02,
      rejectRate: 0.02,
      linkIntegrity: 0.95,
      score: 96.4,
      isFullyScored: true,
      scoredAt: new Date('2026-10-23T08:32:00.000Z'),
      createdAt: new Date('2026-10-23T08:32:00.000Z'),
    },
  ];
}

export function createDeterministicMockRejects(): MigrationReject[] {
  return [
    {
      id: '52000000-0000-4000-8000-000000000001',
      batchId: 'batch-contacts-v1-001',
      module: 'crm-1',
      rowIndex: 42,
      errorCode: 'INVALID_EMAIL',
      errorMessage: "Email format failed RFC 5322 validation: 'bad-email@'",
      rawPayloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      createdAt: new Date('2026-10-23T08:01:30.000Z'),
    },
    {
      id: '52000000-0000-4000-8000-000000000002',
      batchId: 'batch-contacts-v1-001',
      module: 'crm-1',
      rowIndex: 88,
      errorCode: 'MISSING_REQUIRED_FIELD',
      errorMessage: 'Contact name is required and cannot be empty',
      rawPayloadHash: 'f4c8996fb92427ae41e4649b934ca495991b7852b855e3b0c44298fc1c149afb',
      createdAt: new Date('2026-10-23T08:01:45.000Z'),
    },
    {
      id: '52000000-0000-4000-8000-000000000003',
      batchId: 'batch-deals-v1-002',
      module: 'crm-2',
      rowIndex: 12,
      errorCode: 'INVALID_CURRENCY',
      errorMessage: 'Currency must be an ISO-4217 3-letter uppercase code',
      rawPayloadHash: '991b7852b855e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495',
      createdAt: new Date('2026-10-23T08:31:00.000Z'),
    },
  ];
}

export function createDeterministicMockReconciliation(): ReconciliationReport[] {
  return [
    {
      id: '53000000-0000-4000-8000-000000000001',
      batchId: 'batch-contacts-v1-001',
      module: 'crm-1',
      sourceCount: 500,
      loadedCount: 490,
      rejectedCount: 8,
      mergedCount: 2,
      skippedCount: 0,
      unaccountedCount: 0,
      status: 'OK',
      reconciledAt: new Date('2026-10-23T08:05:00.000Z'),
      createdAt: new Date('2026-10-23T08:05:00.000Z'),
    },
    {
      id: '53000000-0000-4000-8000-000000000002',
      batchId: 'batch-deals-v1-002',
      module: 'crm-2',
      sourceCount: 250,
      loadedCount: 245,
      rejectedCount: 5,
      mergedCount: 0,
      skippedCount: 0,
      unaccountedCount: 0,
      status: 'OK',
      reconciledAt: new Date('2026-10-23T08:35:00.000Z'),
      createdAt: new Date('2026-10-23T08:35:00.000Z'),
    },
  ];
}

export function createDeterministicMockDuplicates(): DuplicateCandidate[] {
  return [
    {
      id: '54000000-0000-4000-8000-000000000001',
      batchId: 'batch-contacts-v1-001',
      module: 'crm-1',
      keyType: 'email',
      normalizedKey: 'sarah.connor@clearshift.synthetic',
      recordIds: [
        '00000000-0000-4000-8000-000000000010',
        '00000000-0000-4000-8000-000000000011',
      ],
      status: 'held_for_review',
      detectedAt: new Date('2026-10-23T08:02:00.000Z'),
      metadata: { detectionAlgorithm: 'exact_normalized_key' },
    },
  ];
}

export function createDeterministicMockAuditLogs(): DuplicateAuditLogEntry[] {
  return [
    {
      id: '55000000-0000-4000-8000-000000000001',
      candidateId: '54000000-0000-4000-8000-000000000000',
      decision: 'MERGE',
      actorId: 'operator-1',
      timestamp: new Date('2026-10-23T08:10:00.000Z'),
      keptId: '00000000-0000-4000-8000-000000000001',
      mergedId: '00000000-0000-4000-8000-000000000002',
      reason: 'Exact email match confirmed by operator',
      keyType: 'email',
      normalizedKey: 'alex.morgan@clearshift.synthetic',
    },
  ];
}

// ---------------------------------------------------------------------------
// 2. In-Memory Mock State Store
// ---------------------------------------------------------------------------

export class Crm5MockStateStore {
  public runs: MigrationRun[] = [];
  public scores: QualityScore[] = [];
  public rejects: MigrationReject[] = [];
  public reconciliations: ReconciliationReport[] = [];
  public duplicates: DuplicateCandidate[] = [];
  public auditLogs: DuplicateAuditLogEntry[] = [];
  public receipts: ImportReceipt[] = [];

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.runs = createDeterministicMockRuns();
    this.scores = createDeterministicMockScores();
    this.rejects = createDeterministicMockRejects();
    this.reconciliations = createDeterministicMockReconciliation();
    this.duplicates = createDeterministicMockDuplicates();
    this.auditLogs = createDeterministicMockAuditLogs();
    this.receipts = [];
  }

  public getRuns(query: {
    page?: number | undefined;
    pageSize?: number | undefined;
    module?: CrmModule | undefined;
    batchId?: string | undefined;
    status?: MigrationRunStatus | undefined;
  }): { items: MigrationRun[]; total: number; page: number; pageSize: number; totalPages: number } {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    let filtered = [...this.runs];
    if (query.module) {
      filtered = filtered.filter((r) => r.module === query.module);
    }
    if (query.batchId) {
      filtered = filtered.filter((r) => r.batchId === query.batchId);
    }
    if (query.status) {
      filtered = filtered.filter((r) => r.status === query.status);
    }

    // Deterministic sort: startedAt desc, id asc
    filtered.sort((a, b) => {
      const diff = b.startedAt.getTime() - a.startedAt.getTime();
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });

    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return { items, total, page, pageSize, totalPages };
  }

  public getScores(query: {
    page?: number | undefined;
    pageSize?: number | undefined;
    module?: CrmModule | undefined;
    batchId?: string | undefined;
  }): { items: QualityScore[]; total: number; page: number; pageSize: number; averageScore: number | null } {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    let filtered = [...this.scores];
    if (query.module) {
      filtered = filtered.filter((s) => s.module === query.module);
    }
    if (query.batchId) {
      filtered = filtered.filter((s) => s.batchId === query.batchId);
    }

    filtered.sort((a, b) => b.scoredAt.getTime() - a.scoredAt.getTime());

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    const scoredItems = filtered.filter((s) => s.score !== null);
    const averageScore =
      scoredItems.length > 0
        ? Math.round(
            (scoredItems.reduce((sum, s) => sum + (s.score ?? 0), 0) / scoredItems.length) * 100
          ) / 100
        : null;

    return { items, total, page, pageSize, averageScore };
  }

  public getRejects(query: {
    page?: number | undefined;
    pageSize?: number | undefined;
    module?: CrmModule | undefined;
    batchId?: string | undefined;
  }): { items: MigrationReject[]; total: number; page: number; pageSize: number } {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    let filtered = [...this.rejects];
    if (query.module) {
      filtered = filtered.filter((rej) => rej.module === query.module);
    }
    if (query.batchId) {
      filtered = filtered.filter((rej) => rej.batchId === query.batchId);
    }

    filtered.sort((a, b) => a.rowIndex - b.rowIndex);

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return { items, total, page, pageSize };
  }

  public getReconciliation(batchId: string): ReconciliationReport | undefined {
    return this.reconciliations.find((r) => r.batchId === batchId);
  }

  public detectDuplicates(params: {
    batchId?: string | undefined;
    module?: CrmModule | undefined;
    keyType: string;
    records: Array<{ id: string; keyValue: string; payload?: Record<string, unknown> | undefined }>;
  }): { detectedCount: number; candidates: DuplicateCandidate[] } {
    const groups = new Map<string, string[]>();

    for (const record of params.records) {
      const normalized = normalizeExactKey(params.keyType, record.keyValue);
      if (!groups.has(normalized)) {
        groups.set(normalized, []);
      }
      groups.get(normalized)!.push(record.id);
    }

    const createdCandidates: DuplicateCandidate[] = [];

    for (const [normalizedKey, recordIds] of groups.entries()) {
      if (recordIds.length >= 2) {
        const candidate: DuplicateCandidate = {
          id: `54000000-0000-4000-8000-${String(this.duplicates.length + 1).padStart(12, '0')}`,
          batchId: params.batchId,
          module: params.module,
          keyType: params.keyType as any,
          normalizedKey,
          recordIds,
          status: 'held_for_review',
          detectedAt: new Date(),
        };
        this.duplicates.push(candidate);
        createdCandidates.push(candidate);
      }
    }

    return {
      detectedCount: createdCandidates.length,
      candidates: createdCandidates,
    };
  }

  public resolveDuplicate(params: {
    candidateId: string;
    decision: 'MERGE' | 'REJECT_DUPLICATE' | 'KEEP_SEPARATE';
    actorId: string;
    keptId: string;
    mergedId: string;
    reason: string;
    metadata?: Record<string, unknown> | undefined;
  }): DuplicateCandidate | undefined {
    const candidate = this.duplicates.find((c) => c.id === params.candidateId);
    if (!candidate) {
      return undefined;
    }

    candidate.status = 'resolved';

    const auditEntry: DuplicateAuditLogEntry = {
      id: `55000000-0000-4000-8000-${String(this.auditLogs.length + 1).padStart(12, '0')}`,
      candidateId: params.candidateId,
      decision: params.decision,
      actorId: params.actorId,
      timestamp: new Date(),
      keptId: params.keptId,
      mergedId: params.mergedId,
      reason: params.reason,
      keyType: candidate.keyType,
      normalizedKey: candidate.normalizedKey,
      metadata: params.metadata,
    };
    this.auditLogs.push(auditEntry);

    return candidate;
  }

  public getBatchSummary(batchId: string): BatchSummaryContract | undefined {
    const batchRuns = this.runs.filter((r) => r.batchId === batchId);
    if (batchRuns.length === 0) {
      return undefined;
    }

    const firstRun = batchRuns[0]!;
    const totalRecordsIn = batchRuns.reduce((sum, r) => sum + r.recordsIn, 0);
    const totalRecordsOut = batchRuns.reduce((sum, r) => sum + r.recordsOut, 0);
    const totalRecordsRejected = batchRuns.reduce((sum, r) => sum + r.recordsRejected, 0);
    const stepsCompleted = batchRuns.filter((r) => r.status === 'completed').length;
    const stepsTotal = 7; // extract, profile, clean, map, load, validate, reconcile
    const progressPercentage = Math.min(100, Math.round((stepsCompleted / stepsTotal) * 100));

    const score = this.scores.find((s) => s.batchId === batchId) ?? null;
    const reconciliation = this.reconciliations.find((r) => r.batchId === batchId) ?? null;

    return {
      batchId,
      module: firstRun.module,
      status: firstRun.status,
      totals: {
        totalRecordsIn,
        totalRecordsOut,
        totalRecordsRejected,
        stepsCompleted,
        stepsTotal,
        progressPercentage,
      },
      score,
      reconciliation,
      consistency: {
        isConsistent: reconciliation ? reconciliation.status === 'OK' : true,
        warnings: [],
        errors: [],
      },
      updatedAt: new Date(),
    };
  }
}

// ---------------------------------------------------------------------------
// 3. Fastify Mock Server Plugin
// ---------------------------------------------------------------------------

export interface Crm5MockServerPluginOptions {
  store?: Crm5MockStateStore;
  prefix?: string;
}

export const crm5MockServerPlugin: FastifyPluginAsync<Crm5MockServerPluginOptions> = async (
  fastify: FastifyInstance,
  opts
) => {
  const store = opts.store ?? new Crm5MockStateStore();

  // GET /health
  fastify.get('/health', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      status: 'healthy',
      module: 'crm-5',
      version: '1.0.0',
      mockServer: true,
      timestamp: new Date().toISOString(),
      entities: {
        runs: store.runs.length,
        scores: store.scores.length,
        rejects: store.rejects.length,
        reconciliations: store.reconciliations.length,
        duplicates: store.duplicates.length,
      },
    });
  });

  // GET /runs
  fastify.get('/runs', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = RunsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return reply.status(400).send(
        createErrorEnvelope({
          code: StandardErrorCodes.BAD_REQUEST,
          message: 'Invalid runs query parameters',
          details: parseResult.error.errors,
        })
      );
    }
    const result = store.getRuns(parseResult.data);
    return reply.status(200).send({
      data: result.items,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
      },
    });
  });

  // GET /scores
  fastify.get('/scores', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = ScoresQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return reply.status(400).send(
        createErrorEnvelope({
          code: StandardErrorCodes.BAD_REQUEST,
          message: 'Invalid scores query parameters',
          details: parseResult.error.errors,
        })
      );
    }
    const result = store.getScores(parseResult.data);
    return reply.status(200).send({
      data: result.items,
      averageScore: result.averageScore,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
      },
    });
  });

  // GET /rejects
  fastify.get('/rejects', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = RejectsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return reply.status(400).send(
        createErrorEnvelope({
          code: StandardErrorCodes.BAD_REQUEST,
          message: 'Invalid rejects query parameters',
          details: parseResult.error.errors,
        })
      );
    }
    const result = store.getRejects(parseResult.data);
    return reply.status(200).send({
      data: result.items,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
      },
    });
  });

  // GET /reconciliation/:batch
  fastify.get('/reconciliation/:batch', async (req: FastifyRequest<{ Params: { batch: string } }>, reply: FastifyReply) => {
    const batchId = req.params.batch;
    const report = store.getReconciliation(batchId);
    if (!report) {
      return reply.status(404).send(
        createErrorEnvelope({
          code: StandardErrorCodes.NOT_FOUND,
          message: `Reconciliation report for batch '${batchId}' not found`,
        })
      );
    }
    return reply.status(200).send(report);
  });

  // GET /reconciliation
  fastify.get('/reconciliation', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      data: store.reconciliations,
      total: store.reconciliations.length,
    });
  });

  // POST /duplicates/detect
  fastify.post('/duplicates/detect', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = DetectDuplicatesInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send(
        createErrorEnvelope({
          code: StandardErrorCodes.BAD_REQUEST,
          message: 'Invalid duplicate detection payload',
          details: parseResult.error.errors,
        })
      );
    }
    const result = store.detectDuplicates(parseResult.data);
    return reply.status(200).send(result);
  });

  // GET /duplicates/held
  fastify.get('/duplicates/held', async (_req: FastifyRequest, reply: FastifyReply) => {
    const held = store.duplicates.filter((d) => d.status === 'held_for_review');
    return reply.status(200).send({
      data: held,
      total: held.length,
    });
  });

  // POST /duplicates/resolve
  fastify.post('/duplicates/resolve', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = ResolveDuplicateInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send(
        createErrorEnvelope({
          code: StandardErrorCodes.BAD_REQUEST,
          message: 'Invalid duplicate resolution payload',
          details: parseResult.error.errors,
        })
      );
    }
    const resolved = store.resolveDuplicate(parseResult.data);
    if (!resolved) {
      return reply.status(404).send(
        createErrorEnvelope({
          code: StandardErrorCodes.NOT_FOUND,
          message: `Duplicate candidate '${parseResult.data.candidateId}' not found`,
        })
      );
    }
    return reply.status(200).send({
      success: true,
      candidate: resolved,
    });
  });

  // GET /duplicates/audit
  fastify.get('/duplicates/audit', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      data: store.auditLogs,
      total: store.auditLogs.length,
    });
  });

  // GET /batches/:batch
  fastify.get('/batches/:batch', async (req: FastifyRequest<{ Params: { batch: string } }>, reply: FastifyReply) => {
    const batchId = req.params.batch;
    const summary = store.getBatchSummary(batchId);
    if (!summary) {
      return reply.status(404).send(
        createErrorEnvelope({
          code: StandardErrorCodes.NOT_FOUND,
          message: `Batch '${batchId}' not found`,
        })
      );
    }
    return reply.status(200).send(summary);
  });

  // POST /import/row (Mock idempotent row loader)
  fastify.post('/import/row', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { batchId?: string; sourceRow?: number; idempotencyKey?: string };
    if (!body?.batchId || !body?.sourceRow || !body?.idempotencyKey) {
      return reply.status(400).send(
        createErrorEnvelope({
          code: StandardErrorCodes.BAD_REQUEST,
          message: 'Missing batchId, sourceRow, or idempotencyKey',
        })
      );
    }

    const receipt: ImportReceipt = {
      batchId: body.batchId,
      sourceRow: body.sourceRow,
      idempotencyKey: body.idempotencyKey,
      targetId: `receipt-${Date.now()}`,
      kind: 'created',
      committedAt: new Date(),
    };
    store.receipts.push(receipt);

    return reply.status(201).send(receipt);
  });
};
