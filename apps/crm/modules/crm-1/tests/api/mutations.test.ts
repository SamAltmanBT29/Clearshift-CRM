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
  crm1ImportReceipts,
  crm1Leads
} from "../../db/schema.js";

const databaseUrl = process.env["DATABASE_URL_TEST"];
const apiSuite = databaseUrl ? describe : describe.skip;

apiSuite("CRM-1 mutation API", () => {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  const app = Fastify({ logger: false });
  const fixture = crypto.randomUUID();
  const companyIds: string[] = [];
  const contactIds: string[] = [];
  const leadIds: string[] = [];
  const batchIds: string[] = [];
  let editorAuthorization: string;
  let viewerAuthorization: string;
  let adminAuthorization: string;

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

    await app.register(jwtPlugin);
    await app.register(createCrm1Routes(db), { prefix: CRM1_API_PREFIX });
    await app.ready();
    adminAuthorization = `Bearer ${await signAccessToken(`${fixture}-admin`, [Roles.ADMIN])}`;
    editorAuthorization = `Bearer ${await signAccessToken(`${fixture}-editor`, [Roles.EDITOR])}`;
    viewerAuthorization = `Bearer ${await signAccessToken(`${fixture}-viewer`, [Roles.VIEWER])}`;
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
    await app.close();
    await pool.end();
  });

  const headers = () => ({ authorization: editorAuthorization });
  const adminHeaders = () => ({ authorization: adminAuthorization });

  it("requires write authorization and validates create/edit bodies at the API boundary", async () => {
    const unauthenticated = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/companies`,
      payload: { name: "Synthetic company" }
    });
    expect(unauthenticated.statusCode).toBe(401);

    const viewerWrite = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/companies`,
      headers: { authorization: viewerAuthorization },
      payload: { name: "Synthetic company" }
    });
    expect(viewerWrite.statusCode).toBe(403);

    const invalidCompany = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/companies`,
      headers: headers(),
      payload: { name: "   " }
    });
    expect(invalidCompany.statusCode).toBe(422);
    expect(invalidCompany.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: expect.any(Array),
      correlation_id: expect.any(String)
    });

    const malformedJson = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/companies`,
      headers: { ...headers(), "content-type": "application/json" },
      payload: "{"
    });
    expect(malformedJson.statusCode).toBe(400);
    expect(malformedJson.json()).toMatchObject({
      code: "BAD_REQUEST",
      message: "Request could not be processed",
      details: [],
      correlation_id: expect.any(String)
    });

    const createdCompany = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/companies`,
      headers: headers(),
      payload: { name: `Mutation ${fixture}`, email: "company@example.test" }
    });
    expect(createdCompany.statusCode).toBe(201);
    const company = createdCompany.json();
    companyIds.push(company.id);

    const patchedCompany = await app.inject({
      method: "PATCH",
      url: `${CRM1_API_PREFIX}/companies/${company.id}`,
      headers: headers(),
      payload: { address: "Synthetic address" }
    });
    expect(patchedCompany.statusCode).toBe(200);
    expect(patchedCompany.json().address).toBe("Synthetic address");

    const createdContact = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/contacts`,
      headers: headers(),
      payload: {
        firstName: "Synthetic",
        lastName: fixture,
        email: `${fixture}@example.test`,
        companyId: company.id,
        leadStatus: "New"
      }
    });
    expect(createdContact.statusCode).toBe(201);
    const contact = createdContact.json();
    contactIds.push(contact.id);
    expect(contact.goldenId).toBeTruthy();
    expect(contact.sourceSystem).toBeNull();

    const patchedContact = await app.inject({
      method: "PATCH",
      url: `${CRM1_API_PREFIX}/contacts/${contact.id}`,
      headers: headers(),
      payload: { leadStatus: "Qualified" }
    });
    expect(patchedContact.statusCode).toBe(200);
    expect(patchedContact.json().leadStatus).toBe("Qualified");

    const protectedMutation = await app.inject({
      method: "PATCH",
      url: `${CRM1_API_PREFIX}/contacts/${contact.id}`,
      headers: headers(),
      payload: {
        goldenId: "browser-value",
        sourceSystem: "browser-value",
        sourceId: "browser-value",
        consentStatus: "granted",
        consentUpdatedAt: new Date().toISOString(),
        unsubscribed: false,
        unsubscribedUpdatedAt: new Date().toISOString()
      }
    });
    expect(protectedMutation.statusCode).toBe(422);
    const unchangedContact = await db.select().from(crm1Contacts)
      .where(inArray(crm1Contacts.id, [contact.id]));
    expect(unchangedContact[0]?.goldenId).toBe(contact.goldenId);
    expect(unchangedContact[0]?.consentStatus).toBe("unknown");

    const badCompanyLink = await app.inject({
      method: "PATCH",
      url: `${CRM1_API_PREFIX}/contacts/${contact.id}`,
      headers: headers(),
      payload: { companyId: crypto.randomUUID() }
    });
    expect(badCompanyLink.statusCode).toBe(422);
    expect(badCompanyLink.json().code).toBe("REFERENCE_NOT_FOUND");
    expect(badCompanyLink.json().details).toContainEqual(
      expect.objectContaining({ field: "companyId", code: "invalid_reference" })
    );

    const invalidStatus = await app.inject({
      method: "PATCH",
      url: `${CRM1_API_PREFIX}/contacts/${contact.id}`,
      headers: headers(),
      payload: { leadStatus: "Prospect" }
    });
    expect(invalidStatus.statusCode).toBe(422);
    expect(invalidStatus.json().code).toBe("VALIDATION_ERROR");
    expect(invalidStatus.json().details).toContainEqual(
      expect.objectContaining({ field: "leadStatus" })
    );

    const createdLead = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/leads`,
      headers: headers(),
      payload: { contactId: contact.id, status: "New" }
    });
    expect(createdLead.statusCode).toBe(201);
    const lead = createdLead.json();
    leadIds.push(lead.id);

    const patchedLead = await app.inject({
      method: "PATCH",
      url: `${CRM1_API_PREFIX}/leads/${lead.id}`,
      headers: headers(),
      payload: { status: "Working" }
    });
    expect(patchedLead.statusCode).toBe(200);
    expect(patchedLead.json().status).toBe("Working");

    const invalidLead = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/leads`,
      headers: headers(),
      payload: { contactId: crypto.randomUUID(), status: "New" }
    });
    expect(invalidLead.statusCode).toBe(422);
    expect(invalidLead.json().code).toBe("REFERENCE_NOT_FOUND");
  });

  it("returns correlation IDs without exposing unexpected database errors", async () => {
    const failedPool = new Pool({ connectionString: databaseUrl });
    await failedPool.end();
    const failedApp = Fastify({ logger: false });
    await failedApp.register(jwtPlugin);
    await failedApp.register(createCrm1Routes(drizzle(failedPool)), {
      prefix: CRM1_API_PREFIX
    });
    await failedApp.ready();

    try {
      const authorization = `Bearer ${await signAccessToken(`${fixture}-failure`, [Roles.EDITOR])}`;
      const response = await failedApp.inject({
        method: "GET",
        url: `${CRM1_API_PREFIX}/contacts`,
        headers: { authorization }
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred",
        details: [],
        correlation_id: expect.any(String)
      });
      expect(response.body).not.toContain("Cannot use a pool after calling end");
    } finally {
      await failedApp.close();
    }
  });

  it("replays the original import result for a stable key and never overwrites imported matches", async () => {
    const body = {
      batchId: crypto.randomUUID(),
      sourceSystem: `fixture-${fixture}`,
      rows: [{
        entity: "contact",
        sourceRow: 1,
        data: {
          firstName: "Imported",
          lastName: fixture,
          sourceId: `${fixture}-source-contact`
        }
      }]
    };
    const idempotencyKey = `${fixture}-import-key`;
    const first = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/imports`,
      headers: { ...adminHeaders(), "Idempotency-Key": idempotencyKey },
      payload: body
    });
    expect(first.statusCode).toBe(201);
    const original = first.json();
    batchIds.push(original.id);
    const targetId = original.receipts[0].targetId as string;
    contactIds.push(targetId);

    const replay = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/imports`,
      headers: { ...adminHeaders(), "Idempotency-Key": idempotencyKey },
      payload: body
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(original);

    const targetRows = await db.select().from(crm1Contacts)
      .where(inArray(crm1Contacts.id, [targetId]));
    await db.update(crm1Contacts).set({
      consentStatus: "granted",
      consentUpdatedAt: new Date("2026-10-22T00:00:00.000Z"),
      unsubscribed: true,
      unsubscribedUpdatedAt: new Date("2026-10-22T00:00:00.000Z")
    }).where(inArray(crm1Contacts.id, [targetId]));

    const laterBatch = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/imports`,
      headers: { ...adminHeaders(), "Idempotency-Key": `${fixture}-second-import-key` },
      payload: {
        batchId: crypto.randomUUID(),
        sourceSystem: body.sourceSystem,
        rows: [{
          entity: "contact",
          sourceRow: 2,
          data: {
            firstName: "Stale overwrite attempt",
            lastName: fixture,
            sourceId: `${fixture}-source-contact`
          }
        }]
      }
    });
    expect(laterBatch.statusCode).toBe(201);
    batchIds.push(laterBatch.json().id);
    const stored = await db.select().from(crm1Contacts)
      .where(inArray(crm1Contacts.id, [targetId]));
    expect(stored[0]?.firstName).toBe(targetRows[0]?.firstName);
    expect(stored[0]?.consentStatus).toBe("granted");
    expect(stored[0]?.unsubscribed).toBe(true);

    const mismatchedReplay = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/imports`,
      headers: { ...adminHeaders(), "Idempotency-Key": idempotencyKey },
      payload: {
        ...body,
        rows: [{
          entity: "contact",
          sourceRow: 1,
          data: {
            firstName: "Different payload",
            lastName: fixture,
            sourceId: `${fixture}-source-contact`
          }
        }]
      }
    });
    expect(mismatchedReplay.statusCode).toBe(409);
    expect(mismatchedReplay.json().code).toBe("IDEMPOTENCY_KEY_REUSED");

    const missingKey = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/imports`,
      headers: adminHeaders(),
      payload: body
    });
    expect(missingKey.statusCode).toBe(400);

    const missingBatchId = await app.inject({
      method: "POST",
      url: `${CRM1_API_PREFIX}/imports`,
      headers: { ...adminHeaders(), "Idempotency-Key": `${fixture}-missing-batch` },
      payload: {
        sourceSystem: body.sourceSystem,
        rows: body.rows
      }
    });
    expect(missingBatchId.statusCode).toBe(422);
    expect(missingBatchId.json().code).toBe("VALIDATION_ERROR");

    const duplicateTargetCount = await db.select().from(crm1Contacts)
      .where(inArray(crm1Contacts.sourceId, [`${fixture}-source-contact`]));
    expect(duplicateTargetCount).toHaveLength(1);

    const receiptCount = await db.select().from(crm1ImportReceipts)
      .where(inArray(crm1ImportReceipts.targetId, [targetId]));
    expect(receiptCount).toHaveLength(2);
  });
});
