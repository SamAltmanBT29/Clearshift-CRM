import type { FastifyPluginAsync } from 'fastify';
import {
  RunsQuerySchema,
  ScoresQuerySchema,
  RejectsQuerySchema,
  CreateRunInputSchema,
  CreateScoreInputSchema,
  CreateReconciliationInputSchema,
  CreateRejectInputSchema,
} from '@clearshift/contracts';
import { ControlCenterService } from '../services/control-center.service.js';
import { DomainValidationError, DomainConflictError } from '../domain/errors.js';

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
};

