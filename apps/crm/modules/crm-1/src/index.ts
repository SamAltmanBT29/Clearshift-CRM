import { crm1Resolver } from "./public.js";
import { crm1Routes } from "./interface/routes.js";
import type { FastifyPluginAsync } from "fastify";

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
