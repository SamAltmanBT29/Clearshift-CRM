import { randomUUID } from "node:crypto";
import "@cs/identity";
import type { FastifyPluginAsync, FastifyInstance } from "fastify";
import {
  CRM1_API_PREFIX,
  CRM1CompanyCreateSchema,
  CRM1CompanyPatchSchema,
  CRM1CompanySchema,
  CRM1ContactCreateSchema,
  CRM1ContactPatchSchema,
  CRM1ContactSchema,
  CRM1ImportBatchDetailSchema,
  CRM1ImportBatchSchema,
  CRM1ImportCreateSchema,
  CRM1_IDEMPOTENCY_HEADER,
  CRM1ImportRejectSchema,
  CRM1LeadCreateSchema,
  CRM1LeadPatchSchema,
  CRM1LeadSchema,
  CRM1ListQuerySchema,
  CRM1ListResponseSchema,
  CRM1ImportRowSchema
} from "@clearshift/contracts/crm-1";
import { AppError } from "@cs/kernel";
import { getDatabase } from "@cs/db";
import {
  crm1Companies,
  crm1Contacts,
  crm1ImportBatches,
  crm1ImportReceipts,
  crm1ImportRejects,
  crm1Leads
} from "../../db/schema.js";
import * as rbac from "@cs/rbac";
import { and, asc, count, eq, exists, ilike, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { Crm1MutationService } from "../services/crm1-mutation.service.js";

const { Capabilities, requireCapability } = rbac.default ?? rbac;

const IdParamsSchema = z.object({ id: z.string().uuid() });
const BatchParamsSchema = z.object({ batch: z.string().uuid() });

function parseRequest<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  statusCode = 400
): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Request validation failed",
      statusCode,
      result.error.issues.map((issue) => ({
        field: issue.path.join(".") ||
          (issue.code === "unrecognized_keys" ? issue.keys.join(", ") : "request"),
        message: issue.message,
        code: issue.code
      }))
    );
  }
  return result.data;
}

function isAppError(error: unknown): error is AppError {
  return error instanceof Error &&
    error.name === "AppError" &&
    "code" in error &&
    typeof error.code === "string" &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    "details" in error &&
    Array.isArray(error.details) &&
    "toEnvelope" in error &&
    typeof error.toEnvelope === "function";
}

function clientErrorStatus(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    Number.isInteger(error.statusCode) &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return error.statusCode;
  }
  return undefined;
}

function dateString(value: Date): string {
  return value.toISOString();
}

function serializeContact(row: typeof crm1Contacts.$inferSelect) {
  return CRM1ContactSchema.parse({
    ...row,
    createdAt: dateString(row.createdAt),
    updatedAt: dateString(row.updatedAt),
    consentUpdatedAt: row.consentUpdatedAt ? dateString(row.consentUpdatedAt) : null,
    unsubscribedUpdatedAt: row.unsubscribedUpdatedAt
      ? dateString(row.unsubscribedUpdatedAt)
      : null
  });
}

function serializeCompany(row: typeof crm1Companies.$inferSelect) {
  return CRM1CompanySchema.parse({
    ...row,
    createdAt: dateString(row.createdAt),
    updatedAt: dateString(row.updatedAt)
  });
}

function serializeLead(row: typeof crm1Leads.$inferSelect) {
  return CRM1LeadSchema.parse({
    ...row,
    createdAt: dateString(row.createdAt),
    updatedAt: dateString(row.updatedAt)
  });
}

function serializeBatch(row: typeof crm1ImportBatches.$inferSelect) {
  return CRM1ImportBatchSchema.parse({
    ...row,
    createdAt: dateString(row.createdAt),
    updatedAt: dateString(row.updatedAt),
    completedAt: row.completedAt ? dateString(row.completedAt) : null
  });
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function contactSearch(search: string | undefined) {
  if (!search) {
    return undefined;
  }
  const pattern = `%${escapeLike(search)}%`;
  return or(
    ilike(crm1Contacts.firstName, pattern),
    ilike(crm1Contacts.lastName, pattern),
    ilike(crm1Contacts.email, pattern),
    sql`concat_ws(' ', ${crm1Contacts.firstName}, ${crm1Contacts.lastName}) ILIKE ${pattern}`
  );
}

function companySearch(search: string | undefined) {
  if (!search) {
    return undefined;
  }
  const pattern = `%${escapeLike(search)}%`;
  return or(
    ilike(crm1Companies.name, pattern),
    ilike(crm1Companies.email, pattern),
    ilike(crm1Companies.taxNumber, pattern)
  );
}

import { requireRoles } from "../plugins/auth.js";
import { CRM1_ENDPOINT_ROLES } from "../policies/roles.js";
import { redactSensitiveObject } from "../policies/masking.js";
import { crm1Audit } from "../services/audit.js";
import type { RoleType } from "@cs/identity";
import {
  createEndpointAuthPreHandlers,
  assertObjectMutationAllowed,
  assertTenantIsolation,
  type Crm1TokenClaims
} from "./authz.js";

function modulePreHandlers(
  fastify: FastifyInstance,
  capability: typeof Capabilities.MODULE_READ | typeof Capabilities.MODULE_WRITE
) {
  return [fastify.authenticate, requireCapability(capability)];
}

function endpointPreHandlers(
  fastify: FastifyInstance,
  allowedRolesOrKey: readonly RoleType[] | keyof typeof CRM1_ENDPOINT_ROLES,
  requireObjectGuard = false
) {
  if (typeof allowedRolesOrKey === "string") {
    return createEndpointAuthPreHandlers(fastify, {
      endpointKey: allowedRolesOrKey,
      requireObjectGuard,
    });
  }
  return [fastify.authenticate, requireRoles(allowedRolesOrKey)];
}

export function createCrm1Routes(db: NodePgDatabase = getDatabase()): FastifyPluginAsync {
  return async (fastify) => {
    const mutations = new Crm1MutationService(db);

    fastify.setErrorHandler((error, request, reply) => {
      const correlationHeader = request.headers["x-correlation-id"];
      const correlationId = typeof correlationHeader === "string" && correlationHeader.length <= 128
        ? correlationHeader
        : randomUUID();
      if (isAppError(error) && error.statusCode >= 400 && error.statusCode < 500) {
        reply.status(error.statusCode).send(error.toEnvelope(correlationId));
        return;
      }
      const statusCode = clientErrorStatus(error);
      if (statusCode !== undefined) {
        reply.status(statusCode).send(
          new AppError("BAD_REQUEST", "Request could not be processed", statusCode)
            .toEnvelope(correlationId)
        );
        return;
      }
      request.log.error({ correlationId }, "Unexpected CRM-1 request failure");
      reply.status(500).send(
        new AppError("INTERNAL_SERVER_ERROR", "An unexpected error occurred", 500)
          .toEnvelope(correlationId)
      );
    });

    fastify.get("/health", async () => {
      return {
        status: "ok",
        module: "crm-1",
        name: "Contacts, Companies and Leads",
        version: "1.0.0"
      };
    });

    fastify.get("/contacts/:id", {
      preHandler: endpointPreHandlers(fastify, "CONTACTS_READ")
    }, async (request) => {
      const { id } = parseRequest(IdParamsSchema, request.params);
      const [row] = await db.select().from(crm1Contacts).where(eq(crm1Contacts.id, id)).limit(1);
      if (!row) {
        throw new AppError("NOT_FOUND", `Contact with ID '${id}' not found`, 404);
      }
      assertTenantIsolation(
        request.user as Crm1TokenClaims,
        (row as any).tenantId || (row as any).tenant_id,
        request
      );
      return serializeContact(row);
    });

    fastify.get("/contacts", { preHandler: endpointPreHandlers(fastify, "CONTACTS_LIST") }, async (request) => {
      const query = parseRequest(CRM1ListQuerySchema, request.query);
      const where = contactSearch(query.search);
      const [items, totals] = await Promise.all([
        db.select().from(crm1Contacts).where(where)
          .orderBy(asc(crm1Contacts.lastName), asc(crm1Contacts.firstName))
          .limit(query.pageSize).offset((query.page - 1) * query.pageSize),
        db.select({ total: count() }).from(crm1Contacts).where(where)
      ]);
      return CRM1ListResponseSchema(CRM1ContactSchema).parse({
        items: items.map(serializeContact),
        page: query.page,
        pageSize: query.pageSize,
        total: totals[0]?.total ?? 0
      });
    });

    fastify.post("/contacts", {
      preHandler: endpointPreHandlers(fastify, "CONTACTS_CREATE")
    }, async (request, reply) => {
      assertObjectMutationAllowed(
        request.user as Crm1TokenClaims,
        {
          resourceType: "contact",
          payload: request.body as Record<string, unknown>,
          isUpdate: false,
        },
        request
      );
      const body = parseRequest(CRM1ContactCreateSchema, request.body, 422);
      if (body.companyId) {
        const [comp] = await db.select().from(crm1Companies).where(eq(crm1Companies.id, body.companyId)).limit(1);
        if (comp) {
          assertTenantIsolation(
            request.user as Crm1TokenClaims,
            (comp as any).tenantId || (comp as any).tenant_id,
            request
          );
        }
      }
      const row = await mutations.createContact(body);
      reply.code(201);
      return serializeContact(row);
    });

    fastify.patch("/contacts/:id", {
      preHandler: endpointPreHandlers(fastify, "CONTACTS_UPDATE", true)
    }, async (request) => {
      const { id } = parseRequest(IdParamsSchema, request.params);
      const [existing] = await db.select().from(crm1Contacts).where(eq(crm1Contacts.id, id)).limit(1);
      if (!existing) {
        throw new AppError("NOT_FOUND", `Contact with ID '${id}' not found`, 404);
      }
      assertObjectMutationAllowed(
        request.user as Crm1TokenClaims,
        {
          resourceType: "contact",
          resourceId: id,
          resourceOwnerId: (existing as any).ownerId || (existing as any).employeeId || (existing as any).assignedTo || (existing as any).userId || (existing as any).createdBy || undefined,
          resourceTenantId: (existing as any).tenantId || (existing as any).tenant_id || (existing as any).orgId || (existing as any).org_id || undefined,
          payload: request.body as Record<string, unknown>,
          isUpdate: true,
        },
        request
      );
      const body = parseRequest(CRM1ContactPatchSchema, request.body, 422);
      if (body.companyId) {
        const [comp] = await db.select().from(crm1Companies).where(eq(crm1Companies.id, body.companyId)).limit(1);
        if (comp) {
          assertTenantIsolation(
            request.user as Crm1TokenClaims,
            (comp as any).tenantId || (comp as any).tenant_id,
            request
          );
        }
      }
      return serializeContact(await mutations.updateContact(id, body));
    });

    fastify.get("/companies/:id", {
      preHandler: endpointPreHandlers(fastify, "COMPANIES_READ")
    }, async (request) => {
      const { id } = parseRequest(IdParamsSchema, request.params);
      const [row] = await db.select().from(crm1Companies).where(eq(crm1Companies.id, id)).limit(1);
      if (!row) {
        throw new AppError("NOT_FOUND", `Company with ID '${id}' not found`, 404);
      }
      assertTenantIsolation(
        request.user as Crm1TokenClaims,
        (row as any).tenantId || (row as any).tenant_id,
        request
      );
      return serializeCompany(row);
    });

    fastify.get("/companies", {
      preHandler: endpointPreHandlers(fastify, "COMPANIES_LIST")
    }, async (request) => {
      const query = parseRequest(CRM1ListQuerySchema, request.query);
      const where = companySearch(query.search);
      const [items, totals] = await Promise.all([
        db.select().from(crm1Companies).where(where)
          .orderBy(asc(crm1Companies.name))
          .limit(query.pageSize).offset((query.page - 1) * query.pageSize),
        db.select({ total: count() }).from(crm1Companies).where(where)
      ]);
      return CRM1ListResponseSchema(CRM1CompanySchema).parse({
        items: items.map(serializeCompany),
        page: query.page,
        pageSize: query.pageSize,
        total: totals[0]?.total ?? 0
      });
    });

    fastify.post("/companies", {
      preHandler: endpointPreHandlers(fastify, "COMPANIES_CREATE")
    }, async (request, reply) => {
      assertObjectMutationAllowed(
        request.user as Crm1TokenClaims,
        {
          resourceType: "company",
          payload: request.body as Record<string, unknown>,
          isUpdate: false,
        },
        request
      );
      const body = parseRequest(CRM1CompanyCreateSchema, request.body, 422);
      const row = await mutations.createCompany(body);
      reply.code(201);
      return serializeCompany(row);
    });

    fastify.patch("/companies/:id", {
      preHandler: endpointPreHandlers(fastify, "COMPANIES_UPDATE", true)
    }, async (request) => {
      const { id } = parseRequest(IdParamsSchema, request.params);
      const [existing] = await db.select().from(crm1Companies).where(eq(crm1Companies.id, id)).limit(1);
      if (!existing) {
        throw new AppError("NOT_FOUND", `Company with ID '${id}' not found`, 404);
      }
      assertObjectMutationAllowed(
        request.user as Crm1TokenClaims,
        {
          resourceType: "company",
          resourceId: id,
          resourceOwnerId: (existing as any).ownerId || (existing as any).employeeId || (existing as any).assignedTo || (existing as any).userId || (existing as any).createdBy || undefined,
          resourceTenantId: (existing as any).tenantId || (existing as any).tenant_id || (existing as any).orgId || (existing as any).org_id || undefined,
          payload: request.body as Record<string, unknown>,
          isUpdate: true,
        },
        request
      );
      const body = parseRequest(CRM1CompanyPatchSchema, request.body, 422);
      return serializeCompany(await mutations.updateCompany(id, body));
    });

    fastify.get("/leads/:id", {
      preHandler: endpointPreHandlers(fastify, "LEADS_READ")
    }, async (request) => {
      const { id } = parseRequest(IdParamsSchema, request.params);
      const [row] = await db.select().from(crm1Leads).where(eq(crm1Leads.id, id)).limit(1);
      if (!row) {
        throw new AppError("NOT_FOUND", `Lead with ID '${id}' not found`, 404);
      }
      assertTenantIsolation(
        request.user as Crm1TokenClaims,
        (row as any).tenantId || (row as any).tenant_id,
        request
      );
      return serializeLead(row);
    });

    fastify.get("/leads", {
      preHandler: endpointPreHandlers(fastify, "LEADS_LIST")
    }, async (request) => {
      const query = parseRequest(CRM1ListQuerySchema, request.query);
      const pattern = query.search ? `%${escapeLike(query.search)}%` : undefined;
      const matchingContact = pattern
        ? db.select({ id: crm1Contacts.id }).from(crm1Contacts)
          .where(and(
            eq(crm1Contacts.id, crm1Leads.contactId),
            or(
              ilike(crm1Contacts.firstName, pattern),
              ilike(crm1Contacts.lastName, pattern),
              ilike(crm1Contacts.email, pattern),
              sql`concat_ws(' ', ${crm1Contacts.firstName}, ${crm1Contacts.lastName}) ILIKE ${pattern}`
            )
          ))
        : undefined;
      const where = matchingContact ? exists(matchingContact) : undefined;
      const [items, totals] = await Promise.all([
        db.select({
          id: crm1Leads.id,
          contactId: crm1Leads.contactId,
          status: crm1Leads.status,
          sourceSystem: crm1Leads.sourceSystem,
          sourceId: crm1Leads.sourceId,
          createdAt: crm1Leads.createdAt,
          updatedAt: crm1Leads.updatedAt
        }).from(crm1Leads).where(where)
          .orderBy(asc(crm1Leads.createdAt))
          .limit(query.pageSize).offset((query.page - 1) * query.pageSize),
        db.select({ total: count() }).from(crm1Leads).where(where)
      ]);
      return CRM1ListResponseSchema(CRM1LeadSchema).parse({
        items: items.map(serializeLead),
        page: query.page,
        pageSize: query.pageSize,
        total: totals[0]?.total ?? 0
      });
    });

    fastify.post("/leads", {
      preHandler: endpointPreHandlers(fastify, "LEADS_CREATE")
    }, async (request, reply) => {
      assertObjectMutationAllowed(
        request.user as Crm1TokenClaims,
        {
          resourceType: "lead",
          payload: request.body as Record<string, unknown>,
          isUpdate: false,
        },
        request
      );
      const body = parseRequest(CRM1LeadCreateSchema, request.body, 422);
      if (body.contactId) {
        const [cnt] = await db.select().from(crm1Contacts).where(eq(crm1Contacts.id, body.contactId)).limit(1);
        if (cnt) {
          assertTenantIsolation(
            request.user as Crm1TokenClaims,
            (cnt as any).tenantId || (cnt as any).tenant_id,
            request
          );
        }
      }
      const row = await mutations.createLead(body);
      reply.code(201);
      return serializeLead(row);
    });

    fastify.patch("/leads/:id", {
      preHandler: endpointPreHandlers(fastify, "LEADS_UPDATE", true)
    }, async (request) => {
      const { id } = parseRequest(IdParamsSchema, request.params);
      const [existing] = await db.select().from(crm1Leads).where(eq(crm1Leads.id, id)).limit(1);
      if (!existing) {
        throw new AppError("NOT_FOUND", `Lead with ID '${id}' not found`, 404);
      }
      assertObjectMutationAllowed(
        request.user as Crm1TokenClaims,
        {
          resourceType: "lead",
          resourceId: id,
          resourceOwnerId: (existing as any).ownerId || (existing as any).employeeId || (existing as any).assignedTo || (existing as any).userId || (existing as any).createdBy || undefined,
          resourceTenantId: (existing as any).tenantId || (existing as any).tenant_id || (existing as any).orgId || (existing as any).org_id || undefined,
          payload: request.body as Record<string, unknown>,
          isUpdate: true,
        },
        request
      );
      const body = parseRequest(CRM1LeadPatchSchema, request.body, 422);
      return serializeLead(await mutations.updateLead(id, body));
    });

    fastify.post("/imports", {
      preHandler: endpointPreHandlers(fastify, "IMPORTS_START")
    }, async (request, reply) => {
      assertObjectMutationAllowed(
        request.user as Crm1TokenClaims,
        {
          resourceType: "import_batch",
          payload: request.body as Record<string, unknown>,
          isUpdate: false,
        },
        request
      );
      const body = parseRequest(CRM1ImportCreateSchema, request.body, 422);
      const key = parseRequest(
        z.string().trim().min(1).max(256),
        request.headers[CRM1_IDEMPOTENCY_HEADER.toLowerCase()],
        400
      );
      const result = await mutations.createImport(body, key);
      reply.code(201);
      return CRM1ImportBatchDetailSchema.parse({
        ...serializeBatch(result),
        receipts: result.receipts.map((receipt) => ({
          sourceRow: receipt.sourceRow,
          entity: receipt.entity,
          targetId: receipt.targetId,
          createdAt: dateString(receipt.createdAt)
        }))
      });
    });

    fastify.get("/imports/:batch", {
      preHandler: endpointPreHandlers(fastify, "IMPORTS_STATUS")
    }, async (request) => {
      const { batch: batchId } = parseRequest(BatchParamsSchema, request.params);
      const [batch] = await db.select().from(crm1ImportBatches)
        .where(eq(crm1ImportBatches.id, batchId)).limit(1);
      if (!batch) {
        throw new AppError("NOT_FOUND", "Import batch not found", 404);
      }
      const receipts = await db.select({
        sourceRow: crm1ImportReceipts.sourceRow,
        entity: crm1ImportReceipts.entity,
        targetId: crm1ImportReceipts.targetId,
        createdAt: crm1ImportReceipts.createdAt
      }).from(crm1ImportReceipts)
        .where(eq(crm1ImportReceipts.batchId, batchId))
        .orderBy(asc(crm1ImportReceipts.sourceRow));
      return CRM1ImportBatchDetailSchema.parse({
        ...serializeBatch(batch),
        receipts: receipts.map((receipt) => ({
          ...receipt,
          createdAt: dateString(receipt.createdAt)
        }))
      });
    });

    fastify.get("/imports/:batch/rejects", {
      preHandler: endpointPreHandlers(fastify, "IMPORTS_REJECTS")
    }, async (request) => {
      const { batch: batchId } = parseRequest(BatchParamsSchema, request.params);
      const query = parseRequest(CRM1ListQuerySchema, request.query);
      const [batch] = await db.select({ id: crm1ImportBatches.id })
        .from(crm1ImportBatches)
        .where(eq(crm1ImportBatches.id, batchId))
        .limit(1);
      if (!batch) {
        throw new AppError("NOT_FOUND", "Import batch not found", 404);
      }
      const [items, totals] = await Promise.all([
        db.select().from(crm1ImportRejects)
          .where(eq(crm1ImportRejects.batchId, batchId))
          .orderBy(asc(crm1ImportRejects.sourceRow))
          .limit(query.pageSize).offset((query.page - 1) * query.pageSize),
        db.select({ total: count() }).from(crm1ImportRejects)
          .where(eq(crm1ImportRejects.batchId, batchId))
      ]);
      return CRM1ListResponseSchema(CRM1ImportRejectSchema).parse({
        items: items.map((item) => ({
          ...item,
          createdAt: dateString(item.createdAt)
        })),
        page: query.page,
        pageSize: query.pageSize,
        total: totals[0]?.total ?? 0
      });
    });
  };
}

export const crm1Routes = createCrm1Routes();
export { CRM1_API_PREFIX, CRM1ImportRowSchema };
