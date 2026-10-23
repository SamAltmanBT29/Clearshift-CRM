import { crm3Resolver } from "./public.js";
import { crm3Routes } from "./routes/crm3.routes.js";
import { crm3Service, Crm3Service } from "./services/crm3.service.js";
import { buildApp } from "./app.js";

export const moduleDefinition = {
  id: "crm3",
  schema: "crm3",
  routePrefix: "/api/v1/crm-tickets",
  referenceResolvers: crm3Resolver
};

export {
  crm3Routes,
  crm3Service,
  Crm3Service,
  buildApp,
  crm3Resolver
};

export default moduleDefinition;
