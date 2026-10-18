import { crm3Resolver } from "./public.js";

export const moduleDefinition = {
  id: "crm3",
  schema: "crm3",
  routePrefix: "/api/v1/crm-tickets",
  referenceResolvers: crm3Resolver
};

export default moduleDefinition;
