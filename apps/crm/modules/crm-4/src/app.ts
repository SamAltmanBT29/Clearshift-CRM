import Fastify, { type FastifyInstance } from 'fastify';
import { AppError } from '@cs/kernel';
import { jwtPlugin } from '@cs/identity';
import { crm4AuthPlugin } from './plugins/auth.js';
import { crm4Routes, type Crm4RouteOptions } from './routes/crm4.routes.js';
import { Crm4Service, crm4Service } from './services/crm4.service.js';
import { Crm4AuditService, crm4Audit } from './services/audit.js';

export interface AppOptions extends Crm4RouteOptions {
  service?: Crm4Service | undefined;
  auditService?: Crm4AuditService | undefined;
  authEnabled?: boolean | undefined;
}

/**
 * Builds and configures the Fastify application for CRM-4 Marketing Lists and Campaign History.
 * Uses inject-ready architecture with route prefix /api/v1/crm-marketing.
 */
export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  const authEnabled = opts.authEnabled ?? true;

  if (authEnabled) {
    app.register(jwtPlugin);
    app.register(crm4AuthPlugin);
  }

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

  const service = opts.service ?? crm4Service;
  const auditService = opts.auditService ?? crm4Audit;

  app.register(crm4Routes, {
    prefix: '/api/v1/crm-marketing',
    service,
    auditService,
    authEnabled,
  });

  return app;
}
