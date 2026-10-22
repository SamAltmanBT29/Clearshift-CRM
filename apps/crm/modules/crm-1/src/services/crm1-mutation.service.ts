import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  type CRM1CompanyCreate,
  type CRM1CompanyPatch,
  type CRM1ContactCreate,
  type CRM1ContactPatch,
  type CRM1ImportCreate,
  type CRM1ImportRow,
  type CRM1LeadCreate,
  type CRM1LeadPatch
} from "@clearshift/contracts/crm-1";
import { AppError } from "@cs/kernel";
import {
  crm1Companies,
  crm1Contacts,
  crm1ImportBatches,
  crm1ImportReceipts,
  crm1ImportRejects,
  crm1Leads
} from "../../db/schema.js";

type Transaction = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];

type PostgresError = {
  code?: string;
  constraint?: string;
  cause?: unknown;
};

const leadStatuses = new Set(["New", "Working", "Qualified", "Closed"]);

function validateLeadStatus(status: string | null | undefined, field = "status"): void {
  if (status !== undefined && status !== null && !leadStatuses.has(status)) {
    throw new AppError("INVALID_LEAD_STATUS", "Lead status must be New, Working, Qualified, or Closed", 422, [
      { field, message: "Choose a supported lead status", code: "invalid_enum" }
    ]);
  }
}

async function assertCompanyExists(
  tx: Transaction,
  companyId: string | null | undefined
): Promise<void> {
  if (companyId == null) {
    return;
  }
  const [company] = await tx.select({ id: crm1Companies.id }).from(crm1Companies)
    .where(eq(crm1Companies.id, companyId)).limit(1);
  if (!company) {
    throw new AppError("REFERENCE_NOT_FOUND", "The selected company does not exist", 422, [
      { field: "companyId", message: "Choose an existing company", code: "invalid_reference" }
    ]);
  }
}

async function assertContactExists(
  tx: Transaction,
  contactId: string | null | undefined
): Promise<void> {
  if (contactId == null) {
    return;
  }
  const [contact] = await tx.select({ id: crm1Contacts.id }).from(crm1Contacts)
    .where(eq(crm1Contacts.id, contactId)).limit(1);
  if (!contact) {
    throw new AppError("REFERENCE_NOT_FOUND", "The selected contact does not exist", 422, [
      { field: "contactId", message: "Choose an existing contact", code: "invalid_reference" }
    ]);
  }
}

function postgresError(error: unknown): PostgresError | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const candidate = error as PostgresError;
  if (candidate.code) {
    return candidate;
  }
  return candidate.cause ? postgresError(candidate.cause) : undefined;
}

function databaseAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  const pgError = postgresError(error);
  if (pgError?.code === "23505") {
    return new AppError("DUPLICATE_RECORD", "A CRM-1 record with this identifier already exists", 409);
  }
  if (pgError?.code === "23503") {
    return new AppError("REFERENCE_NOT_FOUND", "A referenced CRM-1 record does not exist", 422, [
      { field: "reference", message: "Choose an existing CRM-1 record", code: "invalid_reference" }
    ]);
  }
  if (pgError?.code === "23514" || pgError?.code === "23502") {
    return new AppError("INVALID_DOMAIN_VALUE", "The requested CRM-1 value is not valid", 422, [
      { field: "value", message: "The value violates a CRM-1 data rule", code: "invalid_value" }
    ]);
  }
  return new AppError("INTERNAL_SERVER_ERROR", "An unexpected error occurred", 500);
}

function isRowRejection(error: unknown): boolean {
  if (error instanceof AppError && error.code === "REFERENCE_NOT_FOUND") {
    return true;
  }
  const code = postgresError(error)?.code;
  return code === "23503" || code === "23514" || code === "23502" || code === "23505";
}

function rowRejectionCode(error: unknown): string {
  if (error instanceof AppError && error.code === "REFERENCE_NOT_FOUND") {
    return "INVALID_REFERENCE";
  }
  switch (postgresError(error)?.code) {
    case "23503":
      return "INVALID_REFERENCE";
    case "23505":
      return "DUPLICATE_IDENTITY";
    case "23514":
      return "INVALID_DOMAIN_VALUE";
    case "23502":
      return "REQUIRED_VALUE_MISSING";
    default:
      return "INVALID_ROW";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): any {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined)
  );
}

function requestDigest(input: CRM1ImportCreate): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(input))).digest("hex");
}

function receiptKey(idempotencyKey: string, row: CRM1ImportRow): string {
  return createHash("sha256")
    .update(`${idempotencyKey}:${row.sourceRow}:${row.entity}:1`)
    .digest("hex");
}

async function findOrCreateImportTarget(
  tx: Transaction,
  row: CRM1ImportRow,
  sourceSystem: string
): Promise<string> {
  switch (row.entity) {
    case "contact": {
      await assertCompanyExists(tx, row.data.companyId);
      const [inserted] = await tx.insert(crm1Contacts).values(omitUndefined({
        ...row.data,
        goldenId: randomUUID(),
        sourceSystem,
        sourceId: row.data.sourceId
      })).onConflictDoNothing({
        target: [crm1Contacts.sourceSystem, crm1Contacts.sourceId]
      }).returning({ id: crm1Contacts.id });
      if (inserted) {
        return inserted.id;
      }
      const [existing] = await tx.select({ id: crm1Contacts.id }).from(crm1Contacts).where(
        and(eq(crm1Contacts.sourceSystem, sourceSystem), eq(crm1Contacts.sourceId, row.data.sourceId))
      ).limit(1);
      if (existing) {
        return existing.id;
      }
      break;
    }
    case "company": {
      const [inserted] = await tx.insert(crm1Companies).values(omitUndefined({
        ...row.data,
        sourceSystem,
        sourceId: row.data.sourceId
      })).onConflictDoNothing({
        target: [crm1Companies.sourceSystem, crm1Companies.sourceId]
      }).returning({ id: crm1Companies.id });
      if (inserted) {
        return inserted.id;
      }
      const [existing] = await tx.select({ id: crm1Companies.id }).from(crm1Companies).where(
        and(eq(crm1Companies.sourceSystem, sourceSystem), eq(crm1Companies.sourceId, row.data.sourceId))
      ).limit(1);
      if (existing) {
        return existing.id;
      }
      break;
    }
    case "lead": {
      await assertContactExists(tx, row.data.contactId);
      const [inserted] = await tx.insert(crm1Leads).values(omitUndefined({
        ...row.data,
        sourceSystem,
        sourceId: row.data.sourceId
      })).onConflictDoNothing({
        target: [crm1Leads.sourceSystem, crm1Leads.sourceId]
      }).returning({ id: crm1Leads.id });
      if (inserted) {
        return inserted.id;
      }
      const [existing] = await tx.select({ id: crm1Leads.id }).from(crm1Leads).where(
        and(eq(crm1Leads.sourceSystem, sourceSystem), eq(crm1Leads.sourceId, row.data.sourceId))
      ).limit(1);
      if (existing) {
        return existing.id;
      }
      break;
    }
  }
  throw new AppError("INTERNAL_SERVER_ERROR", "Unable to resolve CRM-1 import target", 500);
}

export class Crm1MutationService {
  constructor(private readonly db: NodePgDatabase) {}

  async createContact(input: CRM1ContactCreate) {
    validateLeadStatus(input.leadStatus, "leadStatus");
    try {
      return await this.db.transaction(async (tx) => {
        await assertCompanyExists(tx, input.companyId);
        const [row] = await tx.insert(crm1Contacts).values(omitUndefined({
          ...input,
          goldenId: randomUUID()
        })).returning();
        if (!row) {
          throw new AppError("INTERNAL_SERVER_ERROR", "Contact creation returned no record", 500);
        }
        return row;
      });
    } catch (error) {
      throw databaseAppError(error);
    }
  }

  async updateContact(id: string, input: CRM1ContactPatch) {
    validateLeadStatus(input.leadStatus, "leadStatus");
    try {
      return await this.db.transaction(async (tx) => {
        await assertCompanyExists(tx, input.companyId);
        const [row] = await tx.update(crm1Contacts)
          .set(omitUndefined({ ...input, updatedAt: new Date() }))
          .where(eq(crm1Contacts.id, id))
          .returning();
        if (!row) {
          throw new AppError("NOT_FOUND", "Contact not found", 404);
        }
        return row;
      });
    } catch (error) {
      throw databaseAppError(error);
    }
  }

  async createCompany(input: CRM1CompanyCreate) {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx.insert(crm1Companies).values(omitUndefined(input)).returning();
        if (!row) {
          throw new AppError("INTERNAL_SERVER_ERROR", "Company creation returned no record", 500);
        }
        return row;
      });
    } catch (error) {
      throw databaseAppError(error);
    }
  }

  async updateCompany(id: string, input: CRM1CompanyPatch) {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx.update(crm1Companies)
          .set(omitUndefined({ ...input, updatedAt: new Date() }))
          .where(eq(crm1Companies.id, id))
          .returning();
        if (!row) {
          throw new AppError("NOT_FOUND", "Company not found", 404);
        }
        return row;
      });
    } catch (error) {
      throw databaseAppError(error);
    }
  }

  async createLead(input: CRM1LeadCreate) {
    validateLeadStatus(input.status);
    try {
      return await this.db.transaction(async (tx) => {
        await assertContactExists(tx, input.contactId);
        const [row] = await tx.insert(crm1Leads).values(omitUndefined(input)).returning();
        if (!row) {
          throw new AppError("INTERNAL_SERVER_ERROR", "Lead creation returned no record", 500);
        }
        return row;
      });
    } catch (error) {
      throw databaseAppError(error);
    }
  }

  async updateLead(id: string, input: CRM1LeadPatch) {
    validateLeadStatus(input.status);
    try {
      return await this.db.transaction(async (tx) => {
        await assertContactExists(tx, input.contactId);
        const [row] = await tx.update(crm1Leads)
          .set(omitUndefined({ ...input, updatedAt: new Date() }))
          .where(eq(crm1Leads.id, id))
          .returning();
        if (!row) {
          throw new AppError("NOT_FOUND", "Lead not found", 404);
        }
        return row;
      });
    } catch (error) {
      throw databaseAppError(error);
    }
  }

  async createImport(input: CRM1ImportCreate, idempotencyKey: string) {
    const digest = requestDigest(input);
    try {
      const batchId = await this.db.transaction(async (tx) => {
        const [insertedBatch] = await tx.insert(crm1ImportBatches).values({
          id: input.batchId,
          sourceSystem: input.sourceSystem,
          status: "processing",
          idempotencyKey,
          requestHash: digest
        }).onConflictDoNothing({
          target: crm1ImportBatches.idempotencyKey
        }).returning();

        if (!insertedBatch) {
          const [existingBatch] = await tx.select().from(crm1ImportBatches)
            .where(eq(crm1ImportBatches.idempotencyKey, idempotencyKey))
            .limit(1);
          if (!existingBatch) {
            throw new AppError("CONFLICT", "The requested import batch identifier already exists", 409);
          }
          if (existingBatch.requestHash !== digest) {
            throw new AppError("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used for a different import request", 409);
          }
          return existingBatch.id;
        }

        let loadedCount = 0;
        let rejectedCount = 0;
        for (const row of input.rows) {
          try {
            await tx.transaction(async (rowTx) => {
              const targetId = await findOrCreateImportTarget(rowTx, row, input.sourceSystem);
              await rowTx.insert(crm1ImportReceipts).values({
                batchId: insertedBatch.id,
                sourceRow: row.sourceRow,
                entity: row.entity,
                sourceSystem: input.sourceSystem,
                sourceId: row.data.sourceId,
                targetId,
                idempotencyKey: receiptKey(idempotencyKey, row)
              });
            });
            loadedCount += 1;
          } catch (error) {
            if (!isRowRejection(error)) {
              throw error;
            }
            await tx.insert(crm1ImportRejects).values({
              batchId: insertedBatch.id,
              sourceRow: row.sourceRow,
              entity: row.entity,
              reasonCode: rowRejectionCode(error),
              message: "The row conflicts with an existing identity or CRM-1 data constraint"
            });
            rejectedCount += 1;
          }
        }

        await tx.update(crm1ImportBatches).set({
          status: "completed",
          loadedCount,
          rejectedCount,
          updatedAt: new Date(),
          completedAt: new Date()
        }).where(eq(crm1ImportBatches.id, insertedBatch.id));
        return insertedBatch.id;
      });
      return this.getImportResult(batchId);
    } catch (error) {
      throw databaseAppError(error);
    }
  }

  private async getImportResult(batchId: string) {
    const [batch] = await this.db.select().from(crm1ImportBatches)
      .where(eq(crm1ImportBatches.id, batchId))
      .limit(1);
    if (!batch) {
      throw new AppError("INTERNAL_SERVER_ERROR", "Import result was not persisted", 500);
    }
    const receipts = await this.db.select({
      sourceRow: crm1ImportReceipts.sourceRow,
      entity: crm1ImportReceipts.entity,
      targetId: crm1ImportReceipts.targetId,
      createdAt: crm1ImportReceipts.createdAt
    }).from(crm1ImportReceipts)
      .where(eq(crm1ImportReceipts.batchId, batchId))
      .orderBy(asc(crm1ImportReceipts.sourceRow), asc(crm1ImportReceipts.entity));
    return { ...batch, receipts };
  }
}
