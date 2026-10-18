import { crm5Resolver } from "./public.js";

export const moduleDefinition = {
  id: "crm5",
  schema: "crm5",
  routePrefix: "/api/v1/crm-control",
  referenceResolvers: crm5Resolver
};

export default moduleDefinition;
