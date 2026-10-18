import { crm4Resolver } from "./public.js";

export const moduleDefinition = {
  id: "crm4",
  schema: "crm4",
  routePrefix: "/api/v1/crm-marketing",
  referenceResolvers: crm4Resolver
};

export default moduleDefinition;
