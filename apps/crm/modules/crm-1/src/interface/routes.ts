import { createHash, randomUUID } from "node:crypto";
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
  CRM1ImportRejectSchema,
  CRM1LeadCreateSchema,
  CRM1LeadPatchSchema,
  CRM1LeadSchema,
  CRM1ListQuerySchema,
  CRM1ListResponseSchema,
  CRM1ImportRow,
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
import { Capabilities, requireCapability } from "@cs/rbac";
import { and, asc, count, eq, exists, ilike, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";

const IdParamsSchema = z.object({ id: z.string().uuid() });
const BatchParamsSchema = z.object({ batch: z.string().uuid() });

type DatabaseError = {
  code: string;
  constraint?: string;
};

function databaseError(error: unknown): DatabaseError | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  if ("code" in error && typeof error.code === "string") {
    return {
      code: error.code,
      ...("constraint" in error && typeof error.constraint === "string"
        ? { constraint: error.constraint }
        : {})
    };
  }
  return "cause" in error ? databaseError(error.cause) : undefined;
}

function throwDatabaseError(error: unknown): never {
  const postgresError = databaseError(error);
  if (postgresError?.code === "23505") {
    throw new AppError("CONFLICT", "A CRM-1 record with this identifier already exists", 409);
  }
  if (postgresError?.code === "23503") {
    throw new AppError("REFERENCE_NOT_FOUND", "A referenced CRM-1 record does not exist", 404);
  }
  if (postgresError?.code === "23514") {
    throw new AppError("CONFLICT", "The requested CRM-1 state change is not permitted", 409);
  }
  throw error;
}

function parseRequest<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Request validation failed",
      400,
      result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
        code: issue.code
      }))
    );
  }
  return result.data;
}

type WithoutUndefined<T> = {
  [K in keyof T]: Exclude<T[K], undefined>;
};

function omitUndefined<T extends Record<string, unknown>>(value: T): WithoutUndefined<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined)
  ) as WithoutUndefined<T>;
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

function modulePreHandlers(
  fastify: FastifyInstance,
  capability: typeof Capabilities.MODULE_READ | typeof Capabilities.MODULE_WRITE
) {
  return [fastify.authenticate, requireCapability(capability)];
}

function digestIdempotencyKey(batchId: string, row: CRM1ImportRow): string {
  return createHash("sha256")
    .update(`${batchId}:${row.sourceRow}:${row.entity}:1`)
    .digest("hex");
}

async function createOrFindImportTarget(
  tx: Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0],
  row: CRM1ImportRow,
  sourceSystem: string
): Promise<string> {
  const sourceId = row.data.sourceId;
  if (!sourceId) {
    throw new AppError("VALIDATION_ERROR", "Imports require a sourceId for idempotency", 400);
  }

  switch (row.entity) {
    case "contact": {
      const [inserted] = await tx
        .insert(crm1Contacts)
        .values(omitUndefined({
          ...row.data,
          goldenId: row.data.goldenId ?? randomUUID(),
          sourceSystem,
          sourceId
        }))
        .onConflictDoNothing({ target: [crm1Contacts.sourceSystem, crm1Contacts.sourceId] })
        .returning({ id: crm1Contacts.id });
      if (inserted) {
        return inserted.id;
      }
      const [existing] = await tx
        .select({ id: crm1Contacts.id })
        .from(crm1Contacts)
        .where(and(eq(crm1Contacts.sourceSystem, sourceSystem), eq(crm1Contacts.sourceId, sourceId)))
        .limit(1);
      if (existing) {
        return existing.id;
      }
      break;
    }
    case "company": {
      const [inserted] = await tx
        .insert(crm1Companies)
        .values(omitUndefined({ ...row.data, sourceSystem, sourceId }))
        .onConflictDoNothing({ target: [crm1Companies.sourceSystem, crm1Companies.sourceId] })
        .returning({ id: crm1Companies.id });
      if (inserted) {
        return inserted.id;
      }
      const [existing] = await tx
        .select({ id: crm1Companies.id })
        .from(crm1Companies)
        .where(and(eq(crm1Companies.sourceSystem, sourceSystem), eq(crm1Companies.sourceId, sourceId)))
        .limit(1);
      if (existing) {
        return existing.id;
      }
      break;
    }
    case "lead": {
      const [inserted] = await tx
        .insert(crm1Leads)
        .values(omitUndefined({ ...row.data, sourceSystem, sourceId }))
        .onConflictDoNothing({ target: [crm1Leads.sourceSystem, crm1Leads.sourceId] })
        .returning({ id: crm1Leads.id });
      if (inserted) {
        return inserted.id;
      }
      const [existing] = await tx
        .select({ id: crm1Leads.id })
        .from(crm1Leads)
        .where(and(eq(crm1Leads.sourceSystem, sourceSystem), eq(crm1Leads.sourceId, sourceId)))
        .limit(1);
      if (existing) {
        return existing.id;
      }
      break;
    }
  }

  throw new AppError("INTERNAL_SERVER_ERROR", "Unable to resolve CRM-1 import target", 500);
}

function isRowRejection(error: unknown): boolean {
  const postgresError = databaseError(error);
  return postgresError?.code === "23503" ||
    postgresError?.code === "23514" ||
    (postgresError?.code === "23505" &&
      postgresError.constraint === "crm1_contacts_golden_id_key");
}

export function createCrm1Routes(db: NodePgDatabase = getDatabase()): FastifyPluginAsync {
  return async (fastify) => {
    fastify.get("/contacts", { preHandler: modulePreHandlers(fastify, Capabilities.MODULE_READ) }, async (request) => {
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
      preHandler: modulePreHandlers(fastify, Capabilities.MODULE_WRITE)
    }, async (request, reply) => {
      const body = parseRequest(CRM1ContactCreateSchema, request.body);
      try {
        const [row] = await db.insert(crm1Contacts).values(omitUndefined({
          ...body,
          goldenId: body.goldenId ?? randomUUID()
        })).returning();
        if (!row) {
          throw new AppError("INTERNAL_SERVER_ERROR", "Contact creation returned no record", 500);
        }
        reply.code(201);
        return serializeContact(row);
      } catch (error) {
        throwDatabaseError(error);
      }
    });

    fastify.patch("/contacts/:id", {
      preHandler: modulePreHandlers(fastify, Capabilities.MODULE_WRITE)
    }, async (request) => {
      const { id } = parseRequest(IdParamsSchema, request.params);
      const body = parseRequest(CRM1ContactPatchSchema, request.body);
      try {
        const [row] = await db.update(crm1Contacts)
          .set(omitUndefined({
            ...body,
            consentUpdatedAt: body.consentUpdatedAt === undefined
              ? undefined
              : body.consentUpdatedAt === null
                ? null
                : new Date(body.consentUpdatedAt),
            unsubscribedUpdatedAt: body.unsubscribedUpdatedAt === undefined
              ? undefined
              : body.unsubscribedUpdatedAt === null
                ? null
                : new Date(body.unsubscribedUpdatedAt),
            updatedAt: new Date()
          }))
          .where(eq(crm1Contacts.id, id))
          .returning();
        if (!row) {
          throw new AppError("NOT_FOUND", "Contact not found", 404);
        }
        return serializeContact(row);
      } catch (error) {
        throwDatabaseError(error);
      }
    });

    fastify.get("/companies", {
      preHandler: modulePreHandlers(fastify, Capabilities.MODULE_READ)
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
      preHandler: modulePreHandlers(fastify, Capabilities.MODULE_WRITE)
    }, async (request, reply) => {
      const body = parseRequest(CRM1CompanyCreateSchema, request.body);
      try {
        const [row] = await db.insert(crm1Companies).values(omitUndefined(body)).returning();
        if (!row) {
          throw new AppError("INTERNAL_SERVER_ERROR", "Company creation returned no record", 500);
        }
        reply.code(201);
        return serializeCompany(row);
      } catch (error) {
        throwDatabaseError(error);
      }
    });

    fastify.patch("/companies/:id", {
      preHandler: modulePreHandlers(fastify, Capabilities.MODULE_WRITE)
    }, async (request) => {
      const { id } = parseRequest(IdParamsSchema, request.params);
      const body = parseRequest(CRM1CompanyPatchSchema, request.body);
      try {
        const [row] = await db.update(crm1Companies)
          .set(omitUndefined({ ...body, updatedAt: new Date() }))
          .where(eq(crm1Companies.id, id))
          .returning();
        if (!row) {
          throw new AppError("NOT_FOUND", "Company not found", 404);
        }
        return serializeCompany(row);
      } catch (error) {
        throwDatabaseError(error);
      }
    });

    fastify.get("/leads", {
      preHandler: modulePreHandlers(fastify, Capabilities.MODULE_READ)
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
      preHandler: modulePreHandlers(fastify, Capabilities.MODULE_WRITE)
    }, async (request, reply) => {
      const body = parseRequest(CRM1LeadCreateSchema, request.body);
      try {
        const [row] = await db.insert(crm1Leads).values(omitUndefined(body)).returning();
        if (!row) {
          throw new AppError("INTERNAL_SERVER_ERROR", "Lead creation returned no record", 500);
        }
        reply.code(201);
        return serializeLead(row);
      } catch (error) {
        throwDatabaseError(error);
      }
    });

    fastify.patch("/leads/:id", {
      preHandler: modulePreHandlers(fastify, Capabilities.MODULE_WRITE)
    }, async (request) => {
      const { id } = parseRequest(IdParamsSchema, request.params);
      const body = parseRequest(CRM1LeadPatchSchema, request.body);
      try {
        const [row] = await db.update(crm1Leads)
          .set(omitUndefined({ ...body, updatedAt: new Date() }))
          .where(eq(crm1Leads.id, id))
          .returning();
        if (!row) {
          throw new AppError("NOT_FOUND", "Lead not found", 404);
        }
        return serializeLead(row);
      } catch (error) {
        throwDatabaseError(error);
      }
    });

    fastify.post("/imports", {
      preHandler: modulePreHandlers(fastify, Capabilities.MODULE_WRITE)
    }, async (request, reply) => {
      const body = parseRequest(CRM1ImportCreateSchema, request.body);
      const [batch] = await db.insert(crm1ImportBatches).values({
        sourceSystem: body.sourceSystem,
        status: "processing"
      }).returning();
      if (!batch) {
        throw new AppError("INTERNAL_SERVER_ERROR", "Import batch creation returned no record", 500);
      }

      let loadedCount = 0;
      let rejectedCount = 0;
      try {
        for (const row of body.rows) {
          try {
            await db.transaction(async (tx) => {
              const targetId = await createOrFindImportTarget(tx, row, body.sourceSystem);
              await tx.insert(crm1ImportReceipts).values({
                batchId: batch.id,
                sourceRow: row.sourceRow,
                entity: row.entity,
                sourceSystem: body.sourceSystem,
                sourceId: row.data.sourceId ?? "",
                targetId,
                idempotencyKey: digestIdempotencyKey(batch.id, row)
              });
            });
            loadedCount++;
          } catch (error) {
            if (!isRowRejection(error)) {
              throw error;
            }
            await db.insert(crm1ImportRejects).values({
              batchId: batch.id,
              sourceRow: row.sourceRow,
              entity: row.entity,
              reasonCode: databaseError(error)?.constraint ?? "REFERENCE_NOT_FOUND",
              message: "The row conflicts with an existing identity or CRM-1 data constraint"
            });
            rejectedCount++;
          }
        }
      } catch (error) {
        await db.update(crm1ImportBatches)
          .set({
            status: "failed",
            loadedCount,
            rejectedCount,
            updatedAt: new Date()
          })
          .where(eq(crm1ImportBatches.id, batch.id));
        throw error;
      }

      const [completed] = await db.update(crm1ImportBatches)
        .set({
          status: "completed",
          loadedCount,
          rejectedCount,
          updatedAt: new Date(),
          completedAt: new Date()
        })
        .where(eq(crm1ImportBatches.id, batch.id))
        .returning();
      if (!completed) {
        throw new AppError("INTERNAL_SERVER_ERROR", "Import batch completion returned no record", 500);
      }
      reply.code(201);
      return serializeBatch(completed);
    });

    fastify.get("/imports/:batch", {
      preHandler: modulePreHandlers(fastify, Capabilities.MODULE_READ)
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
      preHandler: modulePreHandlers(fastify, Capabilities.MODULE_READ)
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
