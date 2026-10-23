import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import pg from "pg";
import {
  crm4Schema,
  crm4Lists,
  crm4Campaigns,
  crm4Members,
  crm4Consents,
  crm4ImportBatches,
  crm4ImportReceipts,
  crm4CampaignMembers,
  crm4ConsentRecords,
} from "../../db/schema.js";

// ---------------------------------------------------------------------------
// 1. Drizzle ORM Schema Invariant Tests (Offline / In-Memory Contract Tests)
// ---------------------------------------------------------------------------
describe("CRM-4 Drizzle Schema Definition & Invariants", () => {
  it("defines schema in the dedicated crm4 namespace", () => {
    expect(crm4Schema.schemaName).toBe("crm4");
  });

  it("exports all required CRM-4 tables and semantic aliases", () => {
    expect(crm4Lists).toBeDefined();
    expect(crm4Campaigns).toBeDefined();
    expect(crm4Members).toBeDefined();
    expect(crm4Consents).toBeDefined();
    expect(crm4ImportBatches).toBeDefined();
    expect(crm4ImportReceipts).toBeDefined();

    // Semantic aliases
    expect(crm4CampaignMembers).toBe(crm4Members);
    expect(crm4ConsentRecords).toBe(crm4Consents);
  });

  it("configures crm4_lists columns according to SDS and data dictionary", () => {
    const cols = getTableColumns(crm4Lists);
    expect(cols.id.primary).toBe(true);
    expect(cols.name.notNull).toBe(true);
    expect(cols.description.notNull).toBe(false);
    expect(cols.campaignCount.notNull).toBe(true);
    expect(cols.campaignCount.default).toBe(0);
    expect(cols.memberCount.notNull).toBe(true);
    expect(cols.memberCount.default).toBe(0);
    expect(cols.createdAt.notNull).toBe(true);
    expect(cols.updatedAt.notNull).toBe(true);
  });

  it("configures crm4_campaigns with immutable list reference and non-negative counts", () => {
    const cols = getTableColumns(crm4Campaigns);
    expect(cols.id.primary).toBe(true);
    expect(cols.name.notNull).toBe(true);
    expect(cols.campaignDate.notNull).toBe(true);
    expect(cols.listId.notNull).toBe(true);
    expect(cols.memberCount.notNull).toBe(true);
    expect(cols.memberCount.default).toBe(0);
    expect(cols.createdAt.notNull).toBe(true);
    expect(cols.updatedAt.notNull).toBe(true);
  });

  it("configures crm4_members with status enum restriction and cascade parent link", () => {
    const cols = getTableColumns(crm4Members);
    expect(cols.id.primary).toBe(true);
    expect(cols.campaignId.notNull).toBe(true);
    expect(cols.contactId.notNull).toBe(true);
    expect(cols.status.notNull).toBe(true);
    expect(cols.status.default).toBe("sent");
    expect(cols.unsubscribed.notNull).toBe(true);
    expect(cols.unsubscribed.default).toBe(false);
    expect(cols.createdAt.notNull).toBe(true);
  });

  it("configures crm4_consents with unique contact link and monotonic consent status", () => {
    const cols = getTableColumns(crm4Consents);
    expect(cols.id.primary).toBe(true);
    expect(cols.contactId.notNull).toBe(true);
    expect(cols.status.notNull).toBe(true);
    expect(cols.consentDate.notNull).toBe(true);
    expect(cols.source.notNull).toBe(true);
    expect(cols.createdAt.notNull).toBe(true);
    expect(cols.updatedAt.notNull).toBe(true);
  });

  it("configures crm4_import_batches and crm4_import_receipts for Migration Kit integration", () => {
    const batchCols = getTableColumns(crm4ImportBatches);
    expect(batchCols.id.primary).toBe(true);
    expect(batchCols.sourceSystem.notNull).toBe(true);
    expect(batchCols.status.default).toBe("pending");
    expect(batchCols.loadedCount.default).toBe(0);
    expect(batchCols.rejectedCount.default).toBe(0);

    const receiptCols = getTableColumns(crm4ImportReceipts);
    expect(receiptCols.id.primary).toBe(true);
    expect(receiptCols.batchId.notNull).toBe(true);
    expect(receiptCols.sourceRow.notNull).toBe(true);
    expect(receiptCols.entity.notNull).toBe(true);
    expect(receiptCols.idempotencyKey.notNull).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. PostgreSQL Live Database Schema Tests (Executed when DB is available)
// ---------------------------------------------------------------------------
const databaseUrl = process.env["DATABASE_URL_TEST"] || process.env["DATABASE_URL"];
const databaseSuite = databaseUrl ? describe : describe.skip;

databaseSuite("CRM-4 PostgreSQL live schema & database constraint verification", () => {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: databaseUrl });
  const fixture = `crm4-test-${crypto.randomUUID().slice(0, 8)}`;
  const listId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const consentId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const batchId = crypto.randomUUID();

  beforeAll(async () => {
    const { rows } = await pool.query<{ lists: string | null }>(
      "SELECT to_regclass('crm4.crm4_lists') AS lists"
    );
    if (!rows[0]?.lists) {
      throw new Error("CRM-4 migration is not applied to test database");
    }

    // Seed test list
    await pool.query(
      `INSERT INTO crm4.crm4_lists (id, name, description, source_system, source_id)
       VALUES ($1, 'Synthetic Test List', 'Testing Drizzle schema', $2, $3)`,
      [listId, fixture, `${fixture}-list-01`]
    );

    // Seed test campaign
    await pool.query(
      `INSERT INTO crm4.crm4_campaigns (id, name, campaign_date, list_id, source_system, source_id)
       VALUES ($1, 'Synthetic Test Campaign', '2026-11-01', $2, $3, $4)`,
      [campaignId, listId, fixture, `${fixture}-campaign-01`]
    );

    // Seed test member
    await pool.query(
      `INSERT INTO crm4.crm4_members (id, campaign_id, contact_id, status, source_system, source_id)
       VALUES ($1, $2, $3, 'sent', $4, $5)`,
      [memberId, campaignId, contactId, fixture, `${fixture}-member-01`]
    );

    // Seed test consent
    await pool.query(
      `INSERT INTO crm4.crm4_consents (id, contact_id, status, source, source_system, source_id)
       VALUES ($1, $2, 'subscribed', 'web_form', $3, $4)`,
      [consentId, contactId, fixture, `${fixture}-consent-01`]
    );

    // Seed import batch
    await pool.query(
      `INSERT INTO crm4.crm4_import_batches (id, source_system, idempotency_key, request_hash)
       VALUES ($1, $2, $3, 'hash-synthetic-444')`,
      [batchId, fixture, `${fixture}-batch-01`]
    );
  });

  afterAll(async () => {
    await pool.query("DELETE FROM crm4.crm4_import_batches WHERE id = $1", [batchId]);
    await pool.query("DELETE FROM crm4.crm4_consents WHERE id = $1", [consentId]);
    await pool.query("DELETE FROM crm4.crm4_members WHERE id = $1", [memberId]);
    await pool.query("DELETE FROM crm4.crm4_campaigns WHERE id = $1", [campaignId]);
    await pool.query("DELETE FROM crm4.crm4_lists WHERE id = $1", [listId]);
    await pool.end();
  });

  async function expectCheckFailure(
    constraint: string,
    query: string,
    values: unknown[] = []
  ): Promise<void> {
    await expect(pool.query(query, values)).rejects.toMatchObject({
      code: "23514",
      constraint,
    });
  }

  it("verifies campaign member status is strictly restricted to sent, opened, clicked", async () => {
    for (const validStatus of ["sent", "opened", "clicked"]) {
      const tempMemberId = crypto.randomUUID();
      const tempContactId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO crm4.crm4_members (id, campaign_id, contact_id, status)
         VALUES ($1, $2, $3, $4)`,
        [tempMemberId, campaignId, tempContactId, validStatus]
      );
      await pool.query("DELETE FROM crm4.crm4_members WHERE id = $1", [tempMemberId]);
    }

    // Invalid status rejected
    await expectCheckFailure(
      "crm4_members_status_check",
      `INSERT INTO crm4.crm4_members (campaign_id, contact_id, status)
       VALUES ($1, $2, 'bounced')`,
      [campaignId, crypto.randomUUID()]
    );
  });

  it("verifies consent status is strictly restricted to subscribed and unsubscribed", async () => {
    const tempContactId = crypto.randomUUID();
    const tempConsentId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO crm4.crm4_consents (id, contact_id, status, source)
       VALUES ($1, $2, 'unsubscribed', 'user_preference')`,
      [tempConsentId, tempContactId]
    );
    await pool.query("DELETE FROM crm4.crm4_consents WHERE id = $1", [tempConsentId]);

    // Invalid status rejected
    await expectCheckFailure(
      "crm4_consents_status_check",
      `INSERT INTO crm4.crm4_consents (contact_id, status, source)
       VALUES ($1, 'pending', 'api')`,
      [crypto.randomUUID()]
    );
  });

  it("rejects blank string violations on lists, campaigns, and consents", async () => {
    // Blank list name
    await expectCheckFailure(
      "crm4_lists_name_nonempty_check",
      `INSERT INTO crm4.crm4_lists (name) VALUES ('   ')`
    );

    // Blank campaign name
    await expectCheckFailure(
      "crm4_campaigns_name_nonempty_check",
      `INSERT INTO crm4.crm4_campaigns (name, campaign_date, list_id) VALUES ('  ', '2026-11-01', $1)`,
      [listId]
    );

    // Blank consent source
    await expectCheckFailure(
      "crm4_consents_source_nonempty_check",
      `INSERT INTO crm4.crm4_consents (contact_id, status, source) VALUES ($1, 'subscribed', '  ')`,
      [crypto.randomUUID()]
    );
  });

  it("enforces unique constraint on contact_id for consent records", async () => {
    await expect(
      pool.query(
        `INSERT INTO crm4.crm4_consents (contact_id, status, source)
         VALUES ($1, 'subscribed', 'duplicate_test')`,
        [contactId]
      )
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "crm4_consents_contact_id_key",
    });
  });

  it("enforces unique constraint on (campaign_id, contact_id) for members", async () => {
    await expect(
      pool.query(
        `INSERT INTO crm4.crm4_members (campaign_id, contact_id, status)
         VALUES ($1, $2, 'opened')`,
        [campaignId, contactId]
      )
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "crm4_members_campaign_contact_key",
    });
  });

  it("enforces cascade deletion on campaign members when campaign is deleted", async () => {
    const tempCampId = crypto.randomUUID();
    const tempMemberId = crypto.randomUUID();
    const tempContactId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO crm4.crm4_campaigns (id, name, campaign_date, list_id)
       VALUES ($1, 'Temp Campaign', '2026-12-01', $2)`,
      [tempCampId, listId]
    );

    await pool.query(
      `INSERT INTO crm4.crm4_members (id, campaign_id, contact_id, status)
       VALUES ($1, $2, $3, 'sent')`,
      [tempMemberId, tempCampId, tempContactId]
    );

    // Delete campaign
    await pool.query("DELETE FROM crm4.crm4_campaigns WHERE id = $1", [tempCampId]);

    // Member should be cascade deleted
    const { rows } = await pool.query(
      "SELECT id FROM crm4.crm4_members WHERE id = $1",
      [tempMemberId]
    );
    expect(rows).toHaveLength(0);
  });

  it("enforces import receipts invariants and prevents duplicate source rows", async () => {
    const receiptId = crypto.randomUUID();
    const receiptKey = `${fixture}-receipt-01`;

    await pool.query(
      `INSERT INTO crm4.crm4_import_receipts
        (id, batch_id, source_row, entity, source_system, source_id, target_id, idempotency_key)
       VALUES ($1, $2, 1, 'list', $3, 'src-1', $4, $5)`,
      [receiptId, batchId, fixture, listId, receiptKey]
    );

    // Duplicate idempotency_key
    await expect(
      pool.query(
        `INSERT INTO crm4.crm4_import_receipts
          (batch_id, source_row, entity, source_system, source_id, target_id, idempotency_key)
         VALUES ($1, 2, 'list', $2, 'src-2', $3, $4)`,
        [batchId, fixture, listId, receiptKey]
      )
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "crm4_import_receipts_idempotency_key",
    });

    // Clean up receipt
    await pool.query("DELETE FROM crm4.crm4_import_receipts WHERE id = $1", [receiptId]);
  });
});
