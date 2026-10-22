import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CRM1ImportCreateSchema } from "@clearshift/contracts/crm-1";
import { AppError } from "@cs/kernel";
import {
  crm1Companies,
  crm1Contacts,
  crm1ImportBatches,
  crm1ImportReceipts,
  crm1Leads
} from "../../db/schema.js";
import { Crm1MutationService } from "../../src/services/crm1-mutation.service.js";

const databaseUrl = process.env["DATABASE_URL_TEST"];
const serviceSuite = databaseUrl ? describe : describe.skip;

serviceSuite("CRM-1 mutation service", () => {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  const service = new Crm1MutationService(db);
  const fixture = crypto.randomUUID();
  const companyIds: string[] = [];
  const contactIds: string[] = [];
  const leadIds: string[] = [];
  const batchIds: string[] = [];

  beforeAll(async () => {
    const { rows } = await pool.query<{ contacts: string | null; keyColumn: string | null }>(
      `SELECT to_regclass('crm1.crm1_contacts') AS contacts,
        (SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'crm1' AND table_name = 'crm1_import_batches'
           AND column_name = 'idempotency_key') AS "keyColumn"`
    );
    if (!rows[0]?.contacts || !rows[0]?.keyColumn) {
      throw new Error("CRM-1 migrations are not applied to DATABASE_URL_TEST");
    }
  });

  afterAll(async () => {
    if (batchIds.length) {
      await db.delete(crm1ImportBatches).where(inArray(crm1ImportBatches.id, batchIds));
    }
    if (leadIds.length) {
      await db.delete(crm1Leads).where(inArray(crm1Leads.id, leadIds));
    }
    if (contactIds.length) {
      await db.delete(crm1Contacts).where(inArray(crm1Contacts.id, contactIds));
    }
    if (companyIds.length) {
      await db.delete(crm1Companies).where(inArray(crm1Companies.id, companyIds));
    }
    await pool.end();
  });

  it("enforces references, valid state transitions, and rollback in service transactions", async () => {
    const company = await service.createCompany({ name: `Service ${fixture}` });
    companyIds.push(company.id);

    const contact = await service.createContact({
      firstName: "Service",
      lastName: fixture,
      companyId: company.id,
      leadStatus: "New"
    });
    contactIds.push(contact.id);
    expect(contact.goldenId).toBeTruthy();

    await expect(service.updateContact(contact.id, {
      companyId: crypto.randomUUID()
    })).rejects.toMatchObject({
      code: "REFERENCE_NOT_FOUND",
      statusCode: 422
    });
    await expect(service.createContact({
      firstName: "Invalid",
      lastName: fixture,
      leadStatus: "Prospect"
    } as never)).rejects.toMatchObject({
      code: "INVALID_LEAD_STATUS",
      statusCode: 422
    });

    const unchanged = await db.select().from(crm1Contacts)
      .where(inArray(crm1Contacts.id, [contact.id]));
    expect(unchanged[0]?.companyId).toBe(company.id);

    const lead = await service.createLead({ contactId: contact.id, status: "New" });
    leadIds.push(lead.id);
    const updatedLead = await service.updateLead(lead.id, { status: "Qualified" });
    expect(updatedLead.status).toBe("Qualified");
    await expect(service.createLead({
      contactId: crypto.randomUUID(),
      status: "New"
    })).rejects.toMatchObject({
      code: "REFERENCE_NOT_FOUND",
      statusCode: 422
    });
    await expect(service.updateLead(lead.id, { status: "Prospect" } as never))
      .rejects.toMatchObject({
        code: "INVALID_LEAD_STATUS",
        statusCode: 422
      });
    await expect(service.updateCompany(crypto.randomUUID(), { name: "Missing" }))
      .rejects.toBeInstanceOf(AppError);
  });

  it("returns the original batch and receipt for a repeated idempotency key", async () => {
    const request = CRM1ImportCreateSchema.parse({
      batchId: crypto.randomUUID(),
      sourceSystem: `service-${fixture}`,
      rows: [{
        entity: "contact",
        sourceRow: 1,
        data: {
          firstName: "Imported",
          lastName: fixture,
          sourceId: `${fixture}-source`
        }
      }]
    });
    const original = await service.createImport(request, `${fixture}-key`);
    batchIds.push(original.id);
    contactIds.push(original.receipts[0]!.targetId);

    const replay = await service.createImport(request, `${fixture}-key`);
    expect(replay.id).toBe(original.id);
    expect(replay.receipts).toEqual(original.receipts);

    await expect(service.createImport({
      ...request,
      rows: [{
        entity: "contact",
        sourceRow: 1,
        data: {
          firstName: "Different",
          lastName: fixture,
          sourceId: `${fixture}-source`
        }
      }]
    }, `${fixture}-key`)).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      statusCode: 409
    });

    const targets = await db.select().from(crm1Contacts)
      .where(inArray(crm1Contacts.sourceId, [`${fixture}-source`]));
    const receipts = await db.select().from(crm1ImportReceipts)
      .where(inArray(crm1ImportReceipts.batchId, [original.id]));
    expect(targets).toHaveLength(1);
    expect(receipts).toHaveLength(1);
  });
});
