import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env["DATABASE_URL_TEST"];
const databaseSuite = databaseUrl ? describe : describe.skip;

databaseSuite("CRM-1 PostgreSQL schema", () => {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: databaseUrl });
  const fixture = crypto.randomUUID();
  const companyId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const batchId = crypto.randomUUID();

  beforeAll(async () => {
    const { rows } = await pool.query<{ contacts: string | null }>(
      "SELECT to_regclass('crm1.crm1_contacts') AS contacts"
    );
    if (!rows[0]?.contacts) {
      throw new Error("CRM-1 migration is not applied to DATABASE_URL_TEST");
    }
    await pool.query(
      `INSERT INTO crm1.crm1_companies (id, name, source_system, source_id)
       VALUES ($1, 'Synthetic company', $2, $3)`,
      [companyId, fixture, `${fixture}-company`]
    );
    await pool.query(
      `INSERT INTO crm1.crm1_contacts (id, first_name, last_name, company_id, golden_id)
       VALUES ($1, 'Synthetic', 'Contact', $2, $3)`,
      [contactId, companyId, `${fixture}-golden`]
    );
    await pool.query(
      `INSERT INTO crm1.crm1_import_batches (id, source_system)
       VALUES ($1, $2)`,
      [batchId, fixture]
    );
  });

  afterAll(async () => {
    await pool.query("DELETE FROM crm1.crm1_import_batches WHERE id = $1", [batchId]);
    await pool.query("DELETE FROM crm1.crm1_contacts WHERE id = $1", [contactId]);
    await pool.query("DELETE FROM crm1.crm1_companies WHERE id = $1", [companyId]);
    await pool.end();
  });

  async function expectCheckFailure(
    constraint: string,
    query: string,
    values: unknown[] = []
  ): Promise<void> {
    await expect(pool.query(query, values)).rejects.toMatchObject({
      code: "23514",
      constraint
    });
  }

  it("rejects duplicate CRM identities and import idempotency keys", async () => {
    await expect(pool.query(
      `INSERT INTO crm1.crm1_companies (name, source_system, source_id)
       VALUES ('Duplicate', $1, $2)`,
      [fixture, `${fixture}-company`]
    )).rejects.toMatchObject({ code: "23505", constraint: "crm1_companies_source_key" });

    await expect(pool.query(
      `INSERT INTO crm1.crm1_contacts (first_name, last_name, golden_id)
       VALUES ('Duplicate', 'Golden ID', $1)`,
      [`${fixture}-golden`]
    )).rejects.toMatchObject({ code: "23505", constraint: "crm1_contacts_golden_id_key" });

    const sourceContactId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO crm1.crm1_contacts
        (id, first_name, last_name, golden_id, source_system, source_id)
       VALUES ($1, 'Synthetic', 'Source', $2, $3, $4)`,
      [sourceContactId, `${fixture}-source-golden`, fixture, `${fixture}-contact-source`]
    );
    await expect(pool.query(
      `INSERT INTO crm1.crm1_contacts (first_name, last_name, golden_id, source_system, source_id)
       VALUES ('Duplicate', 'Source', $1, $2, $3)`,
      [`${fixture}-other-golden`, fixture, `${fixture}-contact-source`]
    )).rejects.toMatchObject({ code: "23505", constraint: "crm1_contacts_source_key" });
    await pool.query("DELETE FROM crm1.crm1_contacts WHERE id = $1", [sourceContactId]);

    const sourceLeadId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO crm1.crm1_leads (id, contact_id, status, source_system, source_id)
       VALUES ($1, $2, 'New', $3, $4)`,
      [sourceLeadId, contactId, fixture, `${fixture}-lead-source`]
    );
    await expect(pool.query(
      `INSERT INTO crm1.crm1_leads (contact_id, status, source_system, source_id)
       VALUES ($1, 'New', $2, $3)`,
      [contactId, fixture, `${fixture}-lead-source`]
    )).rejects.toMatchObject({ code: "23505", constraint: "crm1_leads_source_key" });
    await pool.query("DELETE FROM crm1.crm1_leads WHERE id = $1", [sourceLeadId]);

    const receiptSql = `INSERT INTO crm1.crm1_import_receipts
      (batch_id, source_row, entity, source_system, source_id, target_id, idempotency_key)
      VALUES ($1, 1, 'contact', $2, $3, $4, $5)`;
    const receiptValues = [
      batchId,
      fixture,
      `${fixture}-receipt`,
      contactId,
      `${fixture}-idempotency`
    ];
    await pool.query(receiptSql, receiptValues);
    await expect(pool.query(receiptSql, receiptValues)).rejects.toMatchObject({
      code: "23505",
      constraint: "crm1_import_receipts_idempotency_key"
    });
    await expect(pool.query(receiptSql, [
      batchId,
      fixture,
      `${fixture}-receipt-2`,
      contactId,
      `${fixture}-idempotency-2`
    ])).rejects.toMatchObject({
      code: "23505",
      constraint: "crm1_import_receipts_batch_row_entity_key"
    });
  });

  it("stores a unique batch idempotency key paired with its request hash", async () => {
    const key = `${fixture}-batch-key`;
    const digest = `${fixture}-request-hash`;
    await pool.query(
      `UPDATE crm1.crm1_import_batches
       SET idempotency_key = $2, request_hash = $3
       WHERE id = $1`,
      [batchId, key, digest]
    );
    await expect(pool.query(
      `INSERT INTO crm1.crm1_import_batches
        (source_system, idempotency_key, request_hash)
       VALUES ($1, $2, $3)`,
      [fixture, key, digest]
    )).rejects.toMatchObject({
      code: "23505",
      constraint: "crm1_import_batches_idempotency_key"
    });
    await expect(pool.query(
      `INSERT INTO crm1.crm1_import_batches (source_system, idempotency_key)
       VALUES ($1, $2)`,
      [fixture, `${fixture}-unpaired-key`]
    )).rejects.toMatchObject({
      code: "23514",
      constraint: "crm1_import_batches_idempotency_pair_check"
    });
  });

  it("enforces every CRM-1 check constraint in PostgreSQL", async () => {
    await expectCheckFailure(
      "crm1_companies_name_nonempty_check",
      "INSERT INTO crm1.crm1_companies (name) VALUES ('  ')"
    );
    await expectCheckFailure(
      "crm1_companies_source_pair_check",
      "INSERT INTO crm1.crm1_companies (name, source_system) VALUES ('Invalid', 'fixture')"
    );
    await expectCheckFailure(
      "crm1_contacts_first_name_nonempty_check",
      "INSERT INTO crm1.crm1_contacts (first_name, last_name, golden_id) VALUES (' ', 'Valid', $1)",
      [`${fixture}-bad-first`]
    );
    await expectCheckFailure(
      "crm1_contacts_last_name_nonempty_check",
      "INSERT INTO crm1.crm1_contacts (first_name, last_name, golden_id) VALUES ('Valid', ' ', $1)",
      [`${fixture}-bad-last`]
    );
    await expectCheckFailure(
      "crm1_contacts_golden_id_nonempty_check",
      "INSERT INTO crm1.crm1_contacts (first_name, last_name, golden_id) VALUES ('Valid', 'Contact', ' ')"
    );
    await expectCheckFailure(
      "crm1_contacts_lead_status_check",
      "INSERT INTO crm1.crm1_contacts (first_name, last_name, golden_id, lead_status) VALUES ('Valid', 'Contact', $1, 'Prospect')",
      [`${fixture}-bad-contact-status`]
    );
    await expectCheckFailure(
      "crm1_contacts_consent_status_check",
      "INSERT INTO crm1.crm1_contacts (first_name, last_name, golden_id, consent_status) VALUES ('Valid', 'Contact', $1, 'maybe')",
      [`${fixture}-bad-consent`]
    );
    await expectCheckFailure(
      "crm1_contacts_consent_timestamp_check",
      "INSERT INTO crm1.crm1_contacts (first_name, last_name, golden_id, consent_status) VALUES ('Valid', 'Contact', $1, 'granted')",
      [`${fixture}-missing-consent-timestamp`]
    );
    await expectCheckFailure(
      "crm1_contacts_unsubscribed_timestamp_check",
      "INSERT INTO crm1.crm1_contacts (first_name, last_name, golden_id, unsubscribed) VALUES ('Valid', 'Contact', $1, true)",
      [`${fixture}-missing-unsubscribed-timestamp`]
    );
    await expectCheckFailure(
      "crm1_contacts_source_pair_check",
      "INSERT INTO crm1.crm1_contacts (first_name, last_name, golden_id, source_id) VALUES ('Valid', 'Contact', $1, 'only-id')",
      [`${fixture}-bad-contact-source`]
    );
    await expectCheckFailure(
      "crm1_leads_status_check",
      "INSERT INTO crm1.crm1_leads (contact_id, status) VALUES ($1, 'Prospect')",
      [contactId]
    );
    await expectCheckFailure(
      "crm1_leads_source_pair_check",
      "INSERT INTO crm1.crm1_leads (contact_id, status, source_system) VALUES ($1, 'New', 'fixture')",
      [contactId]
    );
    await expectCheckFailure(
      "crm1_import_batches_source_system_nonempty_check",
      "INSERT INTO crm1.crm1_import_batches (source_system) VALUES (' ')"
    );
    await expectCheckFailure(
      "crm1_import_batches_status_check",
      "INSERT INTO crm1.crm1_import_batches (source_system, status) VALUES ('fixture', 'unknown')"
    );
    await expectCheckFailure(
      "crm1_import_batches_loaded_count_check",
      "INSERT INTO crm1.crm1_import_batches (source_system, loaded_count) VALUES ('fixture', -1)"
    );
    await expectCheckFailure(
      "crm1_import_batches_rejected_count_check",
      "INSERT INTO crm1.crm1_import_batches (source_system, rejected_count) VALUES ('fixture', -1)"
    );

    const invalidReceipt = async (
      constraint: string,
      columns: string,
      values: unknown[]
    ) => expectCheckFailure(
      constraint,
      `INSERT INTO crm1.crm1_import_receipts (batch_id, ${columns}) VALUES ($1, ${values.map((_, i) => `$${i + 2}`).join(", ")})`,
      [batchId, ...values]
    );
    await invalidReceipt("crm1_import_receipts_source_row_check",
      "source_row, entity, source_system, source_id, target_id, idempotency_key",
      [0, "contact", fixture, "id", contactId, `${fixture}-bad-row`]);
    await invalidReceipt("crm1_import_receipts_entity_check",
      "source_row, entity, source_system, source_id, target_id, idempotency_key",
      [2, "account", fixture, "id", contactId, `${fixture}-bad-entity`]);
    await invalidReceipt("crm1_import_receipts_source_system_nonempty_check",
      "source_row, entity, source_system, source_id, target_id, idempotency_key",
      [3, "contact", " ", "id", contactId, `${fixture}-bad-system`]);
    await invalidReceipt("crm1_import_receipts_source_id_nonempty_check",
      "source_row, entity, source_system, source_id, target_id, idempotency_key",
      [4, "contact", fixture, " ", contactId, `${fixture}-bad-source-id`]);
    await invalidReceipt("crm1_import_receipts_idempotency_key_nonempty_check",
      "source_row, entity, source_system, source_id, target_id, idempotency_key",
      [5, "contact", fixture, "id", contactId, " "]);

    const invalidReject = (constraint: string, sourceRow: number, entity: string, reason: string, message: string) =>
      expectCheckFailure(
        constraint,
        `INSERT INTO crm1.crm1_import_rejects (batch_id, source_row, entity, reason_code, message)
         VALUES ($1, $2, $3, $4, $5)`,
        [batchId, sourceRow, entity, reason, message]
      );
    await invalidReject("crm1_import_rejects_source_row_check", 0, "contact", "INVALID", "Invalid row");
    await invalidReject("crm1_import_rejects_entity_check", 1, "account", "INVALID", "Invalid row");
    await invalidReject("crm1_import_rejects_reason_code_nonempty_check", 2, "contact", " ", "Invalid row");
    await invalidReject("crm1_import_rejects_message_nonempty_check", 3, "contact", "INVALID", " ");
  });

  it("rejects stale consent and unsubscribe changes at the database boundary", async () => {
    const preferenceContactId = crypto.randomUUID();
    const newer = new Date("2025-01-02T00:00:00.000Z");
    await pool.query(
      `INSERT INTO crm1.crm1_contacts
        (id, first_name, last_name, golden_id, consent_status, consent_updated_at,
         unsubscribed, unsubscribed_updated_at)
       VALUES ($1, 'Synthetic', 'Preference', $2, 'granted', $3, true, $3)`,
      [preferenceContactId, `${fixture}-preference`, newer]
    );
    await expect(pool.query(
      `UPDATE crm1.crm1_contacts
       SET consent_status = 'withdrawn', consent_updated_at = $2
       WHERE id = $1`,
      [preferenceContactId, new Date("2025-01-01T00:00:00.000Z")]
    )).rejects.toMatchObject({
      code: "23514",
      constraint: "crm1_contacts_consent_freshness_check"
    });
    await expect(pool.query(
      `UPDATE crm1.crm1_contacts
       SET unsubscribed = false, unsubscribed_updated_at = $2
       WHERE id = $1`,
      [preferenceContactId, new Date("2025-01-01T00:00:00.000Z")]
    )).rejects.toMatchObject({
      code: "23514",
      constraint: "crm1_contacts_unsubscribe_freshness_check"
    });
    await pool.query("DELETE FROM crm1.crm1_contacts WHERE id = $1", [preferenceContactId]);
  });
});
