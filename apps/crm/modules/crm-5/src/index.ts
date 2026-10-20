import { crm5Resolver } from "./public.js";

export const MODULE_ID = 'crm-5';
export const MODULE_NAME = 'CRM-5 Migration Control Center and Reports';

export * from '../db/schema.js';
export * from './domain/errors.js';
export * from './domain/transitions.js';
export * from './domain/relationships.js';
export * from './services/control-center.service.js';
export * from './routes/control-center.routes.js';
export * from './app.js';


export const moduleDefinition = {
  id: "crm5",
  schema: "crm5",
  routePrefix: "/api/v1/crm-control",
  referenceResolvers: crm5Resolver
};

export default moduleDefinition;
