import { crm2Resolver } from "./public.js";

export const moduleDefinition = {
  id: "crm2",
  schema: "crm2",
  routePrefix: "/api/v1/crm-deals",
  referenceResolvers: crm2Resolver
};

export default moduleDefinition;
