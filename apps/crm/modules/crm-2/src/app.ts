import Fastify, { type FastifyInstance } from 'fastify';
import { AppError } from '@cs/kernel';
import { jwtPlugin } from '@cs/identity';
import { CRM2_API_PREFIX } from '@clearshift/contracts';
import { crm2AuthPlugin } from './plugins/auth.js';
import { crm2Routes, type Crm2RoutesOptions } from './routes/crm2.routes.js';
import { Crm2Service, crm2Service } from './services/crm2.service.js';
import type { Crm2TargetAdapter } from './migration/target-adapter.js';
import { Crm2AuditService, crm2Audit } from './services/audit.js';

export interface AppOptions extends Crm2RoutesOptions {
  service?: Crm2Service;
  adapter?: Crm2TargetAdapter;
  enforceAuth?: boolean;
  authEnabled?: boolean;
  auditService?: Crm2AuditService;
}

/**
 * Builds and configures the Fastify application for CRM-2 Deals, Pipeline and Quotes.
 * Uses inject-ready architecture with prefix /api/v1/crm-deals.
 */
export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  const enforceAuth = opts.enforceAuth ?? opts.authEnabled ?? false;

  if (enforceAuth) {
    app.register(jwtPlugin);
    app.register(crm2AuthPlugin);
  }

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

  const service = opts.service ?? crm2Service;
  const auditService = opts.auditService ?? crm2Audit;

  app.register(crm2Routes, {
    prefix: CRM2_API_PREFIX,
    service,
    ...(opts.adapter ? { adapter: opts.adapter } : {}),
    enforceAuth,
    authEnabled: enforceAuth,
    auditService,
  });

  return app;
}
