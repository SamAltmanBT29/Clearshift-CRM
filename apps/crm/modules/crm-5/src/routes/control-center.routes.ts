import type { FastifyPluginAsync } from 'fastify';
import {
  RunsQuerySchema,
  ScoresQuerySchema,
  RejectsQuerySchema,
  CreateRunInputSchema,
  CreateScoreInputSchema,
  CreateReconciliationInputSchema,
  CreateRejectInputSchema,
  DetectDuplicatesInputSchema,
  ResolveDuplicateInputSchema,
  ExecuteBatchLoadInputSchema,
} from '@clearshift/contracts';
import { ControlCenterService } from '../services/control-center.service.js';
import {
  DomainValidationError,
  DomainConflictError,
  AutoMergeForbiddenError,
  DuplicateCandidateNotFoundError,
} from '../domain/errors.js';

export interface ControlCenterRouteOptions {
  service?: ControlCenterService | undefined;
}

/**
 * Fastify Routes for CRM-5 Migration Control Center & Reports
 * Base Prefix: /api/v1/crm-control
 */
export const controlCenterRoutes: FastifyPluginAsync<ControlCenterRouteOptions> = async (
  fastify,
  opts
) => {
  const service = opts.service ?? new ControlCenterService();

  // Health check
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      module: 'crm-5',
      name: 'Migration Control Center and Reports',
      version: '1.0.0',
    };
  });

  // 1. GET /runs
  fastify.get('/runs', async (request, reply) => {
    const parsed = RunsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid query parameters',
          details: parsed.error.issues,
        },
      });
    }

    const result = service.getRuns(parsed.data);
    return reply.status(200).send(result);
  });

  // 2. GET /scores
  fastify.get('/scores', async (request, reply) => {
    const parsed = ScoresQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid query parameters',
          details: parsed.error.issues,
        },
      });
    }

    const result = service.getScores(parsed.data);
    return reply.status(200).send(result);
  });

  // 3. GET /rejects
  fastify.get('/rejects', async (request, reply) => {
    const parsed = RejectsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid query parameters',
          details: parsed.error.issues,
        },
      });
    }

    const result = service.getRejects(parsed.data);
    return reply.status(200).send(result);
  });

  // 4. GET /reconciliation/:batch
  fastify.get<{ Params: { batch: string } }>('/reconciliation/:batch', async (request, reply) => {
    const batchId = request.params.batch;
    if (!batchId || batchId.trim().length === 0) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Batch identifier is required',
        },
      });
    }

    const report = service.getReconciliation(batchId);
    if (!report) {
      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Reconciliation report not found for batch '${batchId}'`,
        },
      });
    }

    return reply.status(200).send(report);
  });

  // 5. GET /batches/:batch - Aggregated batch summary & read-model consistency
  fastify.get<{ Params: { batch: string } }>('/batches/:batch', async (request, reply) => {
    const batchId = request.params.batch;
    if (!batchId || batchId.trim().length === 0) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Batch identifier is required',
        },
      });
    }

    const summary = service.getBatchSummary(batchId);
    if (!summary) {
      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Batch summary not found for batch '${batchId}'`,
        },
      });
    }

    return reply.status(200).send(summary);
  });

  // ---------------------------------------------------------------------------
  // Mutation API Endpoints (POST /runs, /scores, /reconciliation, /rejects)
  // ---------------------------------------------------------------------------


  // 5. POST /runs - Ingest/update run projection
  fastify.post('/runs', async (request, reply) => {
    const parsed = CreateRunInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid run payload',
          details: parsed.error.issues,
        },
      });
    }

    try {
      const result = service.recordRun(parsed.data);
      const statusCode = result.isDuplicate ? 200 : 201;
      return reply.status(statusCode).send(result.run);
    } catch (err: unknown) {
      if (err instanceof DomainValidationError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      if (err instanceof DomainConflictError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      throw err;
    }
  });

  // 6. POST /scores - Ingest quality score
  fastify.post('/scores', async (request, reply) => {
    const parsed = CreateScoreInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid quality score payload',
          details: parsed.error.issues,
        },
      });
    }

    try {
      const result = service.recordScore(parsed.data);
      const statusCode = result.isDuplicate ? 200 : 201;
      return reply.status(statusCode).send(result.score);
    } catch (err: unknown) {
      if (err instanceof DomainValidationError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      if (err instanceof DomainConflictError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      throw err;
    }
  });

  // 7. POST /reconciliation - Ingest/audit reconciliation report
  fastify.post('/reconciliation', async (request, reply) => {
    const parsed = CreateReconciliationInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid reconciliation payload',
          details: parsed.error.issues,
        },
      });
    }

    try {
      const result = service.recordReconciliation(parsed.data);
      const statusCode = result.isDuplicate ? 200 : 201;
      return reply.status(statusCode).send(result.report);
    } catch (err: unknown) {
      if (err instanceof DomainValidationError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      if (err instanceof DomainConflictError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      throw err;
    }
  });

  // 8. POST /rejects - Ingest rejection audit record
  fastify.post('/rejects', async (request, reply) => {
    const parsed = CreateRejectInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid rejection payload',
          details: parsed.error.issues,
        },
      });
    }

    try {
      const result = service.recordReject(parsed.data);
      const statusCode = result.isDuplicate ? 200 : 201;
      return reply.status(statusCode).send(result.reject);
    } catch (err: unknown) {
      if (err instanceof DomainValidationError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      if (err instanceof DomainConflictError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      throw err;
    }
  });

  // 9. POST /duplicates/detect - Detect exact duplicate candidates
  fastify.post('/duplicates/detect', async (request, reply) => {
    const parsed = DetectDuplicatesInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid duplicate detection payload',
          details: parsed.error.issues,
        },
      });
    }

    try {
      const result = service.detectDuplicates(parsed.data);
      return reply.status(200).send(result);
    } catch (err: unknown) {
      if (err instanceof AutoMergeForbiddenError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      throw err;
    }
  });

  // 10. GET /duplicates/held - List duplicate candidates held for human review
  fastify.get<{ Querystring: { batchId?: string; keyType?: string } }>(
    '/duplicates/held',
    async (request, reply) => {
      const items = service.getHeldDuplicates(request.query);
      return reply.status(200).send({
        items,
        total: items.length,
      });
    }
  );

  // 11. POST /duplicates/resolve - Record human merge decision with audit trail
  fastify.post('/duplicates/resolve', async (request, reply) => {
    const parsed = ResolveDuplicateInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid duplicate resolution payload',
          details: parsed.error.issues,
        },
      });
    }

    try {
      const audit = service.resolveDuplicate(parsed.data);
      return reply.status(200).send({
        status: 'resolved',
        audit,
      });
    } catch (err: unknown) {
      if (err instanceof DuplicateCandidateNotFoundError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
          },
        });
      }
      if (err instanceof DomainValidationError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      throw err;
    }
  });

  // 12. GET /duplicates/audit - Query duplicate resolution audit logs
  fastify.get<{
    Querystring: {
      candidateId?: string;
      actorId?: string;
      page?: number;
      pageSize?: number;
    };
  }>('/duplicates/audit', async (request, reply) => {
    const logs = service.getDuplicateAuditLogs(request.query);
    return reply.status(200).send(logs);
  });

  // 13. POST /batches/execute-load - Execute chunked batch load with bounded retries & stop threshold
  fastify.post('/batches/execute-load', async (request, reply) => {
    const parsed = ExecuteBatchLoadInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid batch load execution payload',
          details: parsed.error.issues,
        },
      });
    }

    try {
      const report = await service.executeBatchLoad(parsed.data);
      return reply.status(200).send(report);
    } catch (err: unknown) {
      if (err instanceof DomainValidationError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      throw err;
    }
  });
};

