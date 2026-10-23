import Fastify, { type FastifyInstance } from 'fastify';
import { AppError } from '@cs/kernel';
import { jwtPlugin } from '@cs/identity';
import { crm5AuthPlugin } from './plugins/auth.js';
import {
  controlCenterRoutes,
  type ControlCenterRouteOptions,
} from './routes/control-center.routes.js';
import {
  importRoutes,
  type ImportRouteOptions,
} from './routes/import.js';
import { Crm5TargetAdapter } from './migration/target-adapter.js';
import { Crm5AuditService, crm5Audit } from './services/audit.js';

export interface AppOptions extends ControlCenterRouteOptions, ImportRouteOptions {
  auditService?: Crm5AuditService | undefined;
  authEnabled?: boolean | undefined;
}

/**
 * Builds and configures the Fastify application for CRM-5.
 * Uses inject-ready architecture with prefix /api/v1/crm-control.
 */
export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  const authEnabled = opts.authEnabled ?? true;

  if (authEnabled) {
    app.register(jwtPlugin);
    app.register(crm5AuthPlugin);
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

  const adapter = opts.adapter ?? new Crm5TargetAdapter(opts.service);
  const service = opts.service ?? adapter.getService();
  const auditService = opts.auditService ?? crm5Audit;

  app.register(controlCenterRoutes, {
    prefix: '/api/v1/crm-control',
    service,
    auditService,
    authEnabled,
  });

  app.register(importRoutes, {
    prefix: '/api/v1/crm-control',
    adapter,
    authEnabled,
  });

  return app;
}
