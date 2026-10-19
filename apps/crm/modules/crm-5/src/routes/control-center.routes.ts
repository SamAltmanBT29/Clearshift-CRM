import type { FastifyPluginAsync } from 'fastify';
import {
  RunsQuerySchema,
  ScoresQuerySchema,
  RejectsQuerySchema,
} from '@clearshift/contracts';
import { ControlCenterService } from '../services/control-center.service.js';

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
};
