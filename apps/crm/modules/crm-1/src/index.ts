import { crm1Resolver } from "./public.js";
import { crm1Routes } from "./interface/routes.js";
import type { FastifyPluginAsync } from "fastify";

export const MODULE_ID = 'crm-1';
export const MODULE_NAME = 'CRM-1 Contacts, Companies and Leads';

export * from './domain/errors.js';
export * from './domain/qa-specs.js';
export * from './domain/dirty-data-pack.js';
export * from './domain/duplicate-policy.js';
export * from './services/crm1.service.js';
export * from './services/crm1-mutation.service.js';
export * from './services/audit.js';
export * from './kit/cleaner.js';
export * from './services/crm1-cleaning.service.js';
export * from './kit/mapping-defaults.js';
export * from './kit/mapping.js';
export * from './migration/rules.js';
export * from './services/crm1-mapping.service.js';
export * from './policies/index.js';
export * from './plugins/auth.js';
export * from './interface/authz.js';
export * from './routes/crm1.routes.js';
export * from './app.js';
export * from './public.js';

export interface ModuleDefinition {
  id: string;
  schema: string;
  routePrefix: string;
  referenceResolvers: typeof crm1Resolver;
  routes: FastifyPluginAsync;
}

export const moduleDefinition: ModuleDefinition = {
  id: "crm1",
  schema: "crm1",
  routePrefix: "/api/v1/crm-contacts",
  referenceResolvers: crm1Resolver,
  routes: crm1Routes
};

export default moduleDefinition;
