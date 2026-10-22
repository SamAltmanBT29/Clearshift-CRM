import Fastify, { type FastifyInstance } from 'fastify';
import {
  controlCenterRoutes,
  type ControlCenterRouteOptions,
} from './routes/control-center.routes.js';
import {
  importRoutes,
  type ImportRouteOptions,
} from './routes/import.js';
import { Crm5TargetAdapter } from './migration/target-adapter.js';

export interface AppOptions extends ControlCenterRouteOptions, ImportRouteOptions {}

/**
 * Builds and configures the Fastify application for CRM-5.
 * Uses inject-ready architecture with prefix /api/v1/crm-control.
 */
export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  const adapter = opts.adapter ?? new Crm5TargetAdapter(opts.service);
  const service = opts.service ?? adapter.getService();

  app.register(controlCenterRoutes, {
    prefix: '/api/v1/crm-control',
    service,
  });

  app.register(importRoutes, {
    prefix: '/api/v1/crm-control',
    adapter,
  });

  return app;
}
