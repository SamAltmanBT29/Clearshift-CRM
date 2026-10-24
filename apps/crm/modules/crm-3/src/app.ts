import Fastify, { type FastifyInstance } from 'fastify';
import { AppError } from '@cs/kernel';
import { jwtPlugin } from '@cs/identity';
import { CRM3_API_PREFIX } from '@clearshift/contracts';
import { crm3Routes, type Crm3RoutesOptions } from './routes/crm3.routes.js';
import { Crm3Service, crm3Service } from './services/crm3.service.js';

export interface AppOptions extends Crm3RoutesOptions {
  service?: Crm3Service | undefined;
  enforceAuth?: boolean | undefined;
}

/**
 * Builds and configures the Fastify application for CRM-3 Support Tickets & Activities.
 * Uses inject-ready architecture with prefix /api/v1/crm-tickets.
 */
export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  app.register(jwtPlugin);

  app.setErrorHandler((error, request, reply) => {
    const correlationId =
      (request.headers['x-correlation-id'] as string) ||
      'corr-' + Date.now();

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        details: error.details,
        correlation_id: correlationId,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    }

    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode ?? 500;
    return reply.status(statusCode).send({
      code: 'INTERNAL_SERVER_ERROR',
      message: err?.message || 'An unexpected error occurred',
      details: [],
      correlation_id: correlationId,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: err?.message || 'An unexpected error occurred',
        details: [],
      },
    });
  });

  const service = opts.service ?? crm3Service;
  const enforceAuth = opts.enforceAuth ?? true;

  app.register(crm3Routes, {
    prefix: CRM3_API_PREFIX,
    service,
    auditService: opts.auditService,
    enforceAuth,
  });

  return app;
}
