import Fastify from "fastify";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CRM1_API_PREFIX } from "@clearshift/contracts/crm-1";
import { Roles, jwtPlugin, signAccessToken } from "@cs/identity";
import { createCrm1Routes } from "../../src/interface/routes.js";
import {
  crm1Companies,
  crm1Contacts,
  crm1ImportBatches,
  crm1Leads
} from "../../db/schema.js";

const databaseUrl = process.env["DATABASE_URL_TEST"];
const apiSuite = databaseUrl ? describe : describe.skip;

apiSuite("CRM-1 REST API", () => {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  const app = Fastify({ logger: false });
  const fixture = crypto.randomUUID();
  const contactIds: string[] = [];
  const companyIds: string[] = [];
  const leadIds: string[] = [];
  const batchIds: string[] = [];
  let authorization: string;

  beforeAll(async () => {
    const { rows } = await pool.query<{ contacts: string | null }>(
      "SELECT to_regclass('crm1.crm1_contacts') AS contacts"
    );
    if (!rows[0]?.contacts) {
      throw new Error("CRM-1 migration is not applied to DATABASE_URL_TEST");
    }

    const contacts = Array.from({ length: 30 }, (_, index) => ({
      firstName: "PageSearch",
      lastName: `Contact${index}`,
      email: `crm1-${fixture}-${index}@example.test`,
      goldenId: `${fixture}-page-${index}`
    }));
    const inserted = await db.insert(crm1Contacts).values(contacts).returning({
      id: crm1Contacts.id
    });
    contactIds.push(...inserted.map((contact) => contact.id));

    await app.register(jwtPlugin);
    await app.register(createCrm1Routes(db), { prefix: CRM1_API_PREFIX });
    await app.ready();
    authorization = `Bearer ${await signAccessToken(`${fixture}-admin`, [Roles.ADMIN])}`;
  });

  afterAll(async () => {
    if (batchIds.length > 0) {
      await db.delete(crm1ImportBatches)
        .where(inArray(crm1ImportBatches.id, batchIds));
    }
    if (leadIds.length > 0) {
      await db.delete(crm1Leads).where(inArray(crm1Leads.id, leadIds));
    }
    if (contactIds.length > 0) {
      await db.delete(crm1Contacts).where(inArray(crm1Contacts.id, contactIds));
    }
    if (companyIds.length > 0) {
      await db.delete(crm1Companies).where(inArray(crm1Companies.id, companyIds));
    }
    await app.close();
    await pool.end();
  });

  it("searches persisted names and email in PostgreSQL and defaults to server page size 25", async () => {
    const nameSearch = await app.inject({
      method: "GET",
      url: `${CRM1_API_PREFIX}/contacts?search=PageSearch`,
      headers: { authorization }
    });
    expect(nameSearch.statusCode).toBe(200);
    expect(nameSearch.json()).toMatchObject({
      page: 1,
      pageSize: 25,
      total: 30,
      items: expect.any(Array)
    });
    expect(nameSearch.json().items).toHaveLength(25);

    const emailSearch = await app.inject({
      method: "GET",
      url: `${CRM1_API_PREFIX}/contacts?search=crm1-${fixture}-27%40example.test`,
      headers: { authorization }
    });
    expect(emailSearch.statusCode).toBe(200);
    expect(emailSearch.json()).toMatchObject({ page: 1, pageSize: 25, total: 1 });
    expect(emailSearch.json().items[0].email).toBe(`crm1-${fixture}-27@example.test`);
  });

  it("applies requested pagination on the database query", async () => {
    const response = await app.inject({
      method: "GET",
      url: `${CRM1_API_PREFIX}/contacts?search=PageSearch&page=2&pageSize=2`,
      headers: { authorization }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ page: 2, pageSize: 2, total: 30 });
    expect(response.json().items).toHaveLength(2);
  });

  it("supports company/contact/lead mutations and persisted import receipts/rejects", async () => {
    const companyResponse = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/companies`,
      headers: { authorization },
      payload: { name: `Company ${fixture}` }
    });
    expect(companyResponse.statusCode).toBe(201);
    const company = companyResponse.json();
    companyIds.push(company.id);

    const contactResponse = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/contacts`,
      headers: { authorization },
      payload: {
        firstName: "Mutation",
        lastName: fixture,
        email: `${fixture}@example.test`,
        companyId: company.id
      }
    });
    expect(contactResponse.statusCode).toBe(201);
    const contact = contactResponse.json();
    contactIds.push(contact.id);
    expect(contact.goldenId).toBeTruthy();

    const patchContact = await app.inject({
      method: "PATCH",
      url: `${CRM1_API_PREFIX}/contacts/${contact.id}`,
      headers: { authorization },
      payload: { phone: "+1-555-0100" }
    });
    expect(patchContact.statusCode).toBe(200);
    expect(patchContact.json().phone).toBe("+1-555-0100");

    const leadResponse = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/leads`,
      headers: { authorization },
      payload: { contactId: contact.id, status: "New" }
    });
    expect(leadResponse.statusCode).toBe(201);
    const lead = leadResponse.json();
    leadIds.push(lead.id);
    const patchLeadWorking = await app.inject({
      method: "PATCH",
      url: `${CRM1_API_PREFIX}/leads/${lead.id}`,
      headers: { authorization },
      payload: { status: "Working" }
    });
    expect(patchLeadWorking.statusCode).toBe(200);
    expect(patchLeadWorking.json().status).toBe("Working");

    const patchLeadQualified = await app.inject({
      method: "PATCH",
      url: `${CRM1_API_PREFIX}/leads/${lead.id}`,
      headers: { authorization },
      payload: { status: "Qualified" }
    });
    expect(patchLeadQualified.statusCode).toBe(200);
    expect(patchLeadQualified.json().status).toBe("Qualified");

    const importResponse = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/imports`,
      headers: { authorization, "Idempotency-Key": `${fixture}-import-1` },
      payload: {
        batchId: crypto.randomUUID(),
        sourceSystem: `import-${fixture}`,
        rows: [{
          entity: "contact",
          sourceRow: 1,
          data: {
            firstName: "Imported",
            lastName: fixture,
            sourceId: `${fixture}-source-contact`
          }
        }]
      }
    });
    expect(importResponse.statusCode).toBe(201);
    const batch = importResponse.json();
    batchIds.push(batch.id);
    expect(batch).toMatchObject({ status: "completed", loadedCount: 1, rejectedCount: 0 });

    const batchDetailResponse = await app.inject({
      method: "GET",
      url: `${CRM1_API_PREFIX}/imports/${batch.id}`,
      headers: { authorization }
    });
    expect(batchDetailResponse.statusCode).toBe(200);
    const importedTarget = batchDetailResponse.json().receipts[0].targetId as string;
    contactIds.push(importedTarget);

    const repeatedImportResponse = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/imports`,
      headers: { authorization, "Idempotency-Key": `${fixture}-import-2` },
      payload: {
        batchId: crypto.randomUUID(),
        sourceSystem: `import-${fixture}`,
        rows: [{
          entity: "contact",
          sourceRow: 1,
          data: {
            firstName: "Changed should not overwrite",
            lastName: fixture,
            sourceId: `${fixture}-source-contact`
          }
        }]
      }
    });
    expect(repeatedImportResponse.statusCode).toBe(201);
    const repeatedBatch = repeatedImportResponse.json();
    batchIds.push(repeatedBatch.id);
    const repeatedDetailResponse = await app.inject({
      method: "GET",
      url: `${CRM1_API_PREFIX}/imports/${repeatedBatch.id}`,
      headers: { authorization }
    });
    expect(repeatedDetailResponse.json().receipts[0].targetId).toBe(importedTarget);

    const rejectBatchResponse = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/imports`,
      headers: { authorization, "Idempotency-Key": `${fixture}-import-reject` },
      payload: {
        batchId: crypto.randomUUID(),
        sourceSystem: `import-${fixture}`,
        rows: [{
          entity: "contact",
          sourceRow: 1,
          data: {
            firstName: "Rejected",
            lastName: fixture,
            companyId: crypto.randomUUID(),
            sourceId: `${fixture}-rejected-contact`
          }
        }]
      }
    });
    expect(rejectBatchResponse.statusCode).toBe(201);
    const rejectBatch = rejectBatchResponse.json();
    batchIds.push(rejectBatch.id);
    expect(rejectBatch).toMatchObject({ loadedCount: 0, rejectedCount: 1 });

    const rejectsResponse = await app.inject({
      method: "GET",
      url: `${CRM1_API_PREFIX}/imports/${rejectBatch.id}/rejects`,
      headers: { authorization }
    });
    expect(rejectsResponse.statusCode).toBe(200);
    expect(rejectsResponse.json().items[0].reasonCode).toBe("INVALID_REFERENCE");

    const companyPatchResponse = await app.inject({
      method: "PATCH",
      url: `${CRM1_API_PREFIX}/companies/${company.id}`,
      headers: { authorization },
      payload: { address: "Synthetic address" }
    });
    expect(companyPatchResponse.statusCode).toBe(200);
    expect(companyPatchResponse.json().address).toBe("Synthetic address");
  });

  it("provides read-by-ID endpoints and health check", async () => {
    const health = await app.inject({
      method: "GET",
      url: `${CRM1_API_PREFIX}/health`
    });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", module: "crm-1" });

    const contactRead = await app.inject({
      method: "GET",
      url: `${CRM1_API_PREFIX}/contacts/${contactIds[0]}`,
      headers: { authorization }
    });
    expect(contactRead.statusCode).toBe(200);
    expect(contactRead.json().id).toBe(contactIds[0]);

    const notFoundContact = await app.inject({
      method: "GET",
      url: `${CRM1_API_PREFIX}/contacts/${crypto.randomUUID()}`,
      headers: { authorization }
    });
    expect(notFoundContact.statusCode).toBe(404);
  });
});
