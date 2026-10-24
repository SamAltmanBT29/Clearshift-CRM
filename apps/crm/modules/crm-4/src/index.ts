import { crm4Resolver } from './public.js';
import { crm4Routes } from './routes/crm4.routes.js';
import type { FastifyPluginAsync } from 'fastify';

export const MODULE_ID = 'crm-4';
export const MODULE_NAME = 'CRM-4 Marketing Lists and Campaign History';

export * from './services/crm4.service.js';
export * from './services/audit.js';
export * from './policies/index.js';
export * from './plugins/auth.js';
export * from './interface/authz.js';
export * from './routes/crm4.routes.js';
export * from './app.js';
export * from './public.js';
export * from './domain/relationships.js';
export * from './domain/qa-specs.js';
export * from './kit/profiler.js';
export * from './kit/cleaner.js';
export * from './kit/mapping.js';
export * from './services/crm4-mapping.service.js';
export * from './migration/target-adapter.js';
export * from '../db/schema.js';

export interface ModuleDefinition {
  id: string;
  schema: string;
  routePrefix: string;
  referenceResolvers: typeof crm4Resolver;
  routes: FastifyPluginAsync;
}

export const moduleDefinition: ModuleDefinition = {
  id: 'crm4',
  schema: 'crm4',
  routePrefix: '/api/v1/crm-marketing',
  referenceResolvers: crm4Resolver,
  routes: crm4Routes,
};

export default moduleDefinition;
