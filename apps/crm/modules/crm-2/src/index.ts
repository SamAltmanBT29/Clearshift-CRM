import { crm2Resolver } from "./public.js";
import { crm2Routes } from "./routes/crm2.routes.js";
import type { FastifyPluginAsync } from "fastify";

export const MODULE_ID = "crm-2";
export const MODULE_NAME = "CRM-2 Deals, Pipeline and Quotes";

export * from "./public.js";
export * from "./domain/relationships.js";
export * from "./domain/errors.js";
export * from "./domain/duplicate-policy.js";
export * from "./domain/qa-specs.js";
export * from "./domain/dirty-data-pack-generator.js";
export * from "./domain/batch-loader.js";
export * from "./migration/target-adapter.js";
export * from "./services/crm2.service.js";
export * from "./services/audit.js";
export * from "./policies/roles.js";
export * from "./policies/masking.js";
export * from "./policies/index.js";
export * from "./plugins/auth.js";
export * from "./interface/authz.js";
export * from "./migration/target-adapter.js";
export * from "./migration/rules.js";
export * from "./app.js";

export interface ModuleDefinition {
  id: string;
  schema: string;
  routePrefix: string;
  referenceResolvers: typeof crm2Resolver;
  routes: FastifyPluginAsync;
}

export const moduleDefinition: ModuleDefinition = {
  id: "crm2",
  schema: "crm2",
  routePrefix: "/api/v1/crm-deals",
  referenceResolvers: crm2Resolver,
  routes: crm2Routes,
};

export default moduleDefinition;
