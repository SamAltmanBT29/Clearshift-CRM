import { crm1Resolver } from "./public.js";

export interface ModuleDefinition {
  id: string;
  schema: string;
  routePrefix: string;
  referenceResolvers: typeof crm1Resolver;
}

export const moduleDefinition: ModuleDefinition = {
  id: "crm1",
  schema: "crm1",
  routePrefix: "/api/v1/crm-contacts",
  referenceResolvers: crm1Resolver
};

export default moduleDefinition;
