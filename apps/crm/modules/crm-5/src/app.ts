import Fastify, { type FastifyInstance } from 'fastify';
import {
  controlCenterRoutes,
  type ControlCenterRouteOptions,
} from './routes/control-center.routes.js';

/**
 * Builds and configures the Fastify application for CRM-5.
 * Uses inject-ready architecture with prefix /api/v1/crm-control.
 */
export function buildApp(opts: ControlCenterRouteOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  app.register(controlCenterRoutes, {
    prefix: '/api/v1/crm-control',
    service: opts.service,
  });

  return app;
}
