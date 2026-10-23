import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env["DATABASE_URL_TEST"] || process.env["DATABASE_URL"];
const databaseSuite = databaseUrl ? describe : describe.skip;

databaseSuite("CRM-3 PostgreSQL schema and invariants", () => {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: databaseUrl });
  const fixture = `crm3-test-${crypto.randomUUID().slice(0, 8)}`;
  const ticketId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const noteId = crypto.randomUUID();
  const batchId = crypto.randomUUID();

  beforeAll(async () => {
    const { rows } = await pool.query<{ tickets: string | null }>(
      "SELECT to_regclass('crm3.crm3_tickets') AS tickets"
    );
    if (!rows[0]?.tickets) {
      throw new Error("CRM-3 migration is not applied to test database");
    }

    // Seed a valid ticket
    await pool.query(
      `INSERT INTO crm3.crm3_tickets
        (id, subject, status, priority, contact_id, order_ref, source_system, source_id)
       VALUES ($1, 'Synthetic test ticket', 'New', 'Normal', $2, 'ORD-9876', $3, $4)`,
      [ticketId, contactId, fixture, `${fixture}-ticket-01`]
    );

    // Seed a valid note
    await pool.query(
      `INSERT INTO crm3.crm3_notes (id, ticket_id, author_id, note_text)
       VALUES ($1, $2, 'agent-101', 'Initial synthetic note')`,
      [noteId, ticketId]
    );

    // Seed a valid import batch
    await pool.query(
      `INSERT INTO crm3.crm3_import_batches (id, source_system, idempotency_key, request_hash)
       VALUES ($1, $2, $3, 'hash-synthetic-123')`,
      [batchId, fixture, `${fixture}-batch-01`]
    );
  });

  afterAll(async () => {
    await pool.query("DELETE FROM crm3.crm3_import_batches WHERE id = $1", [batchId]);
    await pool.query("DELETE FROM crm3.crm3_tickets WHERE id = $1", [ticketId]);
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

  it("verifies ticket status and priority restricted to exact SDS enumerations", async () => {
    // Valid statuses: New, Open, Waiting, Solved, Closed
    for (const validStatus of ["New", "Open", "Waiting", "Solved", "Closed"]) {
      const tempId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO crm3.crm3_tickets (id, subject, status, contact_id)
         VALUES ($1, 'Status check', $2, $3)`,
        [tempId, validStatus, contactId]
      );
      await pool.query("DELETE FROM crm3.crm3_tickets WHERE id = $1", [tempId]);
    }

    // Invalid status should be rejected by check constraint
    await expectCheckFailure(
      "crm3_tickets_status_check",
      `INSERT INTO crm3.crm3_tickets (subject, status, contact_id)
       VALUES ('Invalid status', 'InProgress', $1)`,
      [contactId]
    );

    // Valid priorities: Low, Normal, High, Urgent
    for (const validPriority of ["Low", "Normal", "High", "Urgent"]) {
      const tempId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO crm3.crm3_tickets (id, subject, priority, contact_id)
         VALUES ($1, 'Priority check', $2, $3)`,
        [tempId, validPriority, contactId]
      );
      await pool.query("DELETE FROM crm3.crm3_tickets WHERE id = $1", [tempId]);
    }

    // Invalid priority should be rejected by check constraint
    await expectCheckFailure(
      "crm3_tickets_priority_check",
      `INSERT INTO crm3.crm3_tickets (subject, priority, contact_id)
       VALUES ('Invalid priority', 'Critical', $1)`,
      [contactId]
    );
  });

  it("rejects non-empty string violations on tickets and notes", async () => {
    // Empty subject
    await expectCheckFailure(
      "crm3_tickets_subject_nonempty_check",
      `INSERT INTO crm3.crm3_tickets (subject, contact_id) VALUES ('   ', $1)`,
      [contactId]
    );

    // Empty note author
    await expectCheckFailure(
      "crm3_notes_author_id_nonempty_check",
      `INSERT INTO crm3.crm3_notes (ticket_id, author_id, note_text) VALUES ($1, '  ', 'text')`,
      [ticketId]
    );

    // Empty note text
    await expectCheckFailure(
      "crm3_notes_note_text_nonempty_check",
      `INSERT INTO crm3.crm3_notes (ticket_id, author_id, note_text) VALUES ($1, 'author', '')`,
      [ticketId]
    );
  });

  it("enforces unique constraint on source pair and import idempotency keys", async () => {
    // Duplicate (source_system, source_id)
    await expect(
      pool.query(
        `INSERT INTO crm3.crm3_tickets (subject, contact_id, source_system, source_id)
         VALUES ('Duplicate source', $1, $2, $3)`,
        [contactId, fixture, `${fixture}-ticket-01`]
      )
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "crm3_tickets_source_key"
    });

    // Duplicate batch idempotency key
    await expect(
      pool.query(
        `INSERT INTO crm3.crm3_import_batches (source_system, idempotency_key, request_hash)
         VALUES ($1, $2, 'hash-other')`,
        [fixture, `${fixture}-batch-01`]
      )
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "crm3_import_batches_idempotency_key"
    });
  });

  it("enforces foreign key cascading deletion between tickets and notes", async () => {
    const cascadeTicketId = crypto.randomUUID();
    const cascadeNoteId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO crm3.crm3_tickets (id, subject, contact_id)
       VALUES ($1, 'Cascade test ticket', $2)`,
      [cascadeTicketId, contactId]
    );

    await pool.query(
      `INSERT INTO crm3.crm3_notes (id, ticket_id, author_id, note_text)
       VALUES ($1, $2, 'author-cascade', 'Cascade note')`,
      [cascadeNoteId, cascadeTicketId]
    );

    // Deleting ticket should cascade-delete note
    await pool.query("DELETE FROM crm3.crm3_tickets WHERE id = $1", [cascadeTicketId]);

    const { rows } = await pool.query("SELECT id FROM crm3.crm3_notes WHERE id = $1", [
      cascadeNoteId
    ]);
    expect(rows).toHaveLength(0);
  });

  it("enforces import receipts invariants and prevents duplicate source rows", async () => {
    const receiptId = crypto.randomUUID();
    const receiptKey = `${fixture}-receipt-01`;

    await pool.query(
      `INSERT INTO crm3.crm3_import_receipts
        (id, batch_id, source_row, entity, source_system, source_id, target_id, idempotency_key)
       VALUES ($1, $2, 1, 'ticket', $3, 'src-1', $4, $5)`,
      [receiptId, batchId, fixture, ticketId, receiptKey]
    );

    // Duplicate idempotency_key
    await expect(
      pool.query(
        `INSERT INTO crm3.crm3_import_receipts
          (batch_id, source_row, entity, source_system, source_id, target_id, idempotency_key)
         VALUES ($1, 2, 'ticket', $2, 'src-2', $3, $4)`,
        [batchId, fixture, ticketId, receiptKey]
      )
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "crm3_import_receipts_idempotency_key"
    });

    // Duplicate (batch_id, source_row, entity)
    await expect(
      pool.query(
        `INSERT INTO crm3.crm3_import_receipts
          (batch_id, source_row, entity, source_system, source_id, target_id, idempotency_key)
         VALUES ($1, 1, 'ticket', $2, 'src-other', $3, 'diff-key')`,
        [batchId, fixture, ticketId]
      )
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "crm3_import_receipts_batch_row_entity_key"
    });

    // Invalid entity
    await expectCheckFailure(
      "crm3_import_receipts_entity_check",
      `INSERT INTO crm3.crm3_import_receipts
        (batch_id, source_row, entity, source_system, source_id, target_id, idempotency_key)
       VALUES ($1, 5, 'company', $2, 'src-comp', $3, 'another-key')`,
      [batchId, fixture, ticketId]
    );

    // Clean up receipt
    await pool.query("DELETE FROM crm3.crm3_import_receipts WHERE id = $1", [receiptId]);
  });
});
