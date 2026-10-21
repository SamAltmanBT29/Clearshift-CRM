import Fastify, { type FastifyInstance } from 'fastify';
import { crm1Routes, type Crm1RouteOptions } from './routes/crm1.routes.js';
import { Crm1Service } from './services/crm1.service.js';

export interface AppOptions extends Crm1RouteOptions {}

/**
 * Builds and configures the Fastify application for CRM-1.
 * Uses inject-ready architecture with prefix /api/v1/crm-contacts.
 */
export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  const service = opts.service ?? new Crm1Service();

  app.register(crm1Routes, {
    prefix: '/api/v1/crm-contacts',
    service,
  });

  return app;
}
