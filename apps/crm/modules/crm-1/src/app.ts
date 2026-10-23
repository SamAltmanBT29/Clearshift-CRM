import Fastify, { type FastifyInstance } from 'fastify';
import { AppError } from '@cs/kernel';
import { jwtPlugin } from '@cs/identity';
import { crm1AuthPlugin } from './plugins/auth.js';
import { crm1Routes, type Crm1RouteOptions } from './routes/crm1.routes.js';
import { importRoutes, type ImportRouteOptions } from './routes/import.js';
import { Crm1TargetAdapter } from './migration/target-adapter.js';
import { Crm1Service } from './services/crm1.service.js';
import { Crm1AuditService, crm1Audit } from './services/audit.js';

export interface AppOptions extends Crm1RouteOptions, ImportRouteOptions {
  auditService?: Crm1AuditService | undefined;
  adapter?: Crm1TargetAdapter | undefined;
}

/**
 * Builds and configures the Fastify application for CRM-1.
 * Uses inject-ready architecture with prefix /api/v1/crm-contacts.
 */
export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  app.register(jwtPlugin);
  app.register(crm1AuthPlugin);

  app.setErrorHandler((error, request, reply) => {
    const correlationId = (request.headers['x-correlation-id'] as string) || 'corr-' + Date.now();

    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
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
      return;
    }

    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode ?? 500;
    reply.status(statusCode).send({
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

  const adapter = opts.adapter ?? new Crm1TargetAdapter(opts.service);
  const service = opts.service ?? adapter.getService();
  const auditService = opts.auditService ?? crm1Audit;

  app.register(crm1Routes, {
    prefix: '/api/v1/crm-contacts',
    service,
    auditService,
  });

  app.register(importRoutes, {
    prefix: '/api/v1/crm-contacts',
    adapter,
  });

  return app;
}
