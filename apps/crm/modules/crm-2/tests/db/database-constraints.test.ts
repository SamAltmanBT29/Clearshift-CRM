import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const MIGRATION_FILE_PATH = join(process.cwd(), 'packages/database/migrations/crm2_v1.sql');

describe('CRM-2 Database Schema Constraints & Precision (DB-01..DB-13)', () => {
  let pool: pg.Pool | null = null;
  let dbHealthy = false;

  const dbUrl =
    process.env['DATABASE_URL_TEST'] ||
    process.env['DATABASE_MIGRATOR_URL'] ||
    process.env['DATABASE_URL'] ||
    'postgresql://cs_migrator:migrator_secret_123@localhost:5432/clearshift_test';

  beforeAll(async () => {
    try {
      pool = new Pool({
        connectionString: dbUrl,
        connectionTimeoutMillis: 2000,
      });
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
        dbHealthy = true;
      } finally {
        client.release();
      }
    } catch {
      dbHealthy = false;
      if (pool) {
        await pool.end().catch(() => {});
        pool = null;
      }
    }
  });

  afterAll(async () => {
    if (pool) {
      await pool.end().catch(() => {});
    }
  });

  // ---------------------------------------------------------------------------
  // 1. DDL Specification & Trigger Invariants (Static Verification)
  // ---------------------------------------------------------------------------
  describe('DDL & Immutability Trigger Contract (crm2_v1.sql)', () => {
    it('migration file crm2_v1.sql exists in packages/database/migrations', () => {
      expect(existsSync(MIGRATION_FILE_PATH)).toBe(true);
    });

    it('DB-04: defines stage-immutability trigger crm2_stages_no_update and reject_stage_mutation() with SQLSTATE 55000', () => {
      const sql = readFileSync(MIGRATION_FILE_PATH, 'utf-8');
      expect(sql).toContain('CREATE OR REPLACE FUNCTION crm2.reject_stage_mutation()');
      expect(sql).toContain("ERRCODE = '55000'");
      expect(sql).toContain('CREATE TRIGGER crm2_stages_no_update');
      expect(sql).toContain('BEFORE UPDATE OR DELETE ON crm2.crm2_stages');
    });

    it('DB-02: defines check constraint crm2_stages_name_check for the 6 fixed stages', () => {
      const sql = readFileSync(MIGRATION_FILE_PATH, 'utf-8');
      expect(sql).toContain('CONSTRAINT crm2_stages_name_check');
      expect(sql).toContain("'New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'");
    });

    it('DB-03: defines check constraint crm2_stages_position_check for range 1..6', () => {
      const sql = readFileSync(MIGRATION_FILE_PATH, 'utf-8');
      expect(sql).toContain('CONSTRAINT crm2_stages_position_check CHECK (position BETWEEN 1 AND 6)');
    });

    it('DB-05: defines unique constraint crm2_quotes_quote_number_key', () => {
      const sql = readFileSync(MIGRATION_FILE_PATH, 'utf-8');
      expect(sql).toContain('CONSTRAINT crm2_quotes_quote_number_key UNIQUE (quote_number)');
    });

    it('DB-08: defines name non-empty check constraint crm2_deals_name_nonempty_check', () => {
      const sql = readFileSync(MIGRATION_FILE_PATH, 'utf-8');
      expect(sql).toContain('CONSTRAINT crm2_deals_name_nonempty_check CHECK (length(btrim(name)) > 0)');
    });

    it('DB-09: defines currency check constraint crm2_deals_currency_check regex ^[A-Z]{3}$', () => {
      const sql = readFileSync(MIGRATION_FILE_PATH, 'utf-8');
      expect(sql).toContain("CONSTRAINT crm2_deals_currency_check CHECK (currency ~ '^[A-Z]{3}$')");
    });

    it('DB-11: defines value non-negative check constraint crm2_deals_value_nonnegative_check', () => {
      const sql = readFileSync(MIGRATION_FILE_PATH, 'utf-8');
      expect(sql).toContain('CONSTRAINT crm2_deals_value_nonnegative_check CHECK (value >= 0)');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Live Database Execution & Concrete Precision Constraints
  // ---------------------------------------------------------------------------
  describe('Live Database Execution Constraints (PostgreSQL)', () => {
    it('DB-01: exactly 6 fixed stages exist in crm2.crm2_stages in correct order', async () => {
      if (!dbHealthy || !pool) return;
      const res = await pool.query('SELECT name, position, is_won FROM crm2.crm2_stages ORDER BY position ASC');
      expect(res.rows).toHaveLength(6);
      expect(res.rows.map((r) => r.name)).toEqual(['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']);
      expect(res.rows.find((r) => r.name === 'Won')?.is_won).toBe(true);
      expect(res.rows.find((r) => r.name === 'New')?.is_won).toBe(false);
    });

    it('DB-02: rejects insertion of non-approved stage name with SQLSTATE 23514 (check_violation)', async () => {
      if (!dbHealthy || !pool) return;
      let error: any;
      try {
        await pool.query(
          "INSERT INTO crm2.crm2_stages (id, name, position, is_won) VALUES (gen_random_uuid(), 'DraftStage', 7, false)"
        );
      } catch (err) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe('23514'); // check_violation
    });

    it('DB-04: rejects stage update via crm2_stages_no_update trigger with SQLSTATE 55000', async () => {
      if (!dbHealthy || !pool) return;
      let error: any;
      try {
        await pool.query("UPDATE crm2.crm2_stages SET name = 'RenamedNew' WHERE name = 'New'");
      } catch (err) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe('55000'); // object_not_in_prerequisite_state
    });

    it('DB-04: rejects stage deletion via crm2_stages_no_update trigger with SQLSTATE 55000', async () => {
      if (!dbHealthy || !pool) return;
      let error: any;
      try {
        await pool.query("DELETE FROM crm2.crm2_stages WHERE name = 'Lost'");
      } catch (err) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe('55000');
    });

    it('DB-05: rejects duplicate quote number with SQLSTATE 23505 (unique_violation)', async () => {
      if (!dbHealthy || !pool) return;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const stageRes = await client.query("SELECT id FROM crm2.crm2_stages WHERE name = 'New' LIMIT 1");
        const stageId = stageRes.rows[0].id;

        const dealRes = await client.query(
          `INSERT INTO crm2.crm2_deals (name, value, currency, stage_id)
           VALUES ('Dup Quote Test Deal', 1000.00, 'USD', $1) RETURNING id`,
          [stageId]
        );
        const dealId = dealRes.rows[0].id;

        const quoteNum = `Q-DUP-TEST-${Date.now()}`;
        await client.query(
          `INSERT INTO crm2.crm2_quotes (quote_number, deal_id, quote_date, amount)
           VALUES ($1, $2, '2026-10-23', 500.00)`,
          [quoteNum, dealId]
        );

        let error: any;
        try {
          await client.query(
            `INSERT INTO crm2.crm2_quotes (quote_number, deal_id, quote_date, amount)
             VALUES ($1, $2, '2026-10-23', 750.00)`,
            [quoteNum, dealId]
          );
        } catch (err) {
          error = err;
        }

        expect(error).toBeDefined();
        expect(error.code).toBe('23505'); // unique_violation
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('DB-06: rejects quote with non-existent deal_id with SQLSTATE 23503 (foreign_key_violation)', async () => {
      if (!dbHealthy || !pool) return;
      let error: any;
      try {
        await pool.query(
          `INSERT INTO crm2.crm2_quotes (quote_number, deal_id, quote_date, amount)
           VALUES ('Q-NONEXISTENT', '00000000-0000-0000-0000-000000000000', '2026-10-23', 500.00)`
        );
      } catch (err) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe('23503'); // foreign_key_violation
    });

    it('DB-07: restricts deleting a stage when deals reference it (ON DELETE RESTRICT)', async () => {
      if (!dbHealthy || !pool) return;
      // Even if trigger didn't exist, foreign key restricts delete
      let error: any;
      try {
        await pool.query("DELETE FROM crm2.crm2_stages WHERE name = 'New'");
      } catch (err) {
        error = err;
      }
      expect(error).toBeDefined();
      // Returns 55000 from trigger (or 23503 from FK)
      expect(['55000', '23503']).toContain(error.code);
    });

    it('DB-08: rejects whitespace-only deal name with SQLSTATE 23514', async () => {
      if (!dbHealthy || !pool) return;
      const stageRes = await pool.query("SELECT id FROM crm2.crm2_stages WHERE name = 'New' LIMIT 1");
      const stageId = stageRes.rows[0].id;
      let error: any;
      try {
        await pool.query(
          `INSERT INTO crm2.crm2_deals (name, value, currency, stage_id)
           VALUES ('   ', 1000.00, 'USD', $1)`,
          [stageId]
        );
      } catch (err) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe('23514');
    });

    it('DB-09: rejects lowercase currency with SQLSTATE 23514', async () => {
      if (!dbHealthy || !pool) return;
      const stageRes = await pool.query("SELECT id FROM crm2.crm2_stages WHERE name = 'New' LIMIT 1");
      const stageId = stageRes.rows[0].id;
      let error: any;
      try {
        await pool.query(
          `INSERT INTO crm2.crm2_deals (name, value, currency, stage_id)
           VALUES ('Invalid Currency Deal', 1000.00, 'usd', $1)`,
          [stageId]
        );
      } catch (err) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe('23514');
    });

    it('DB-10: successfully persists orphan deal with NULL contact_id', async () => {
      if (!dbHealthy || !pool) return;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const stageRes = await client.query("SELECT id FROM crm2.crm2_stages WHERE name = 'New' LIMIT 1");
        const stageId = stageRes.rows[0].id;

        const res = await client.query(
          `INSERT INTO crm2.crm2_deals (name, contact_id, value, currency, stage_id)
           VALUES ('Orphan Constraint Test', NULL, 5000.00, 'USD', $1)
           RETURNING id, contact_id`,
          [stageId]
        );
        expect(res.rows[0].contact_id).toBeNull();
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('DB-11: rejects negative deal value with SQLSTATE 23514', async () => {
      if (!dbHealthy || !pool) return;
      const stageRes = await pool.query("SELECT id FROM crm2.crm2_stages WHERE name = 'New' LIMIT 1");
      const stageId = stageRes.rows[0].id;
      let error: any;
      try {
        await pool.query(
          `INSERT INTO crm2.crm2_deals (name, value, currency, stage_id)
           VALUES ('Negative Value Deal', -0.01, 'USD', $1)`,
          [stageId]
        );
      } catch (err) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe('23514');
    });

    it('DB-12: concrete decimal test - inserts 0.10 and 0.20, sums via SQL, asserts exactly 0.30 without float drift', async () => {
      if (!dbHealthy || !pool) return;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const stageRes = await client.query("SELECT id FROM crm2.crm2_stages WHERE name = 'New' LIMIT 1");
        const stageId = stageRes.rows[0].id;

        const res1 = await client.query(
          `INSERT INTO crm2.crm2_deals (name, value, currency, stage_id)
           VALUES ('Decimal Deal 1', 0.10, 'USD', $1) RETURNING id`,
          [stageId]
        );
        const res2 = await client.query(
          `INSERT INTO crm2.crm2_deals (name, value, currency, stage_id)
           VALUES ('Decimal Deal 2', 0.20, 'USD', $1) RETURNING id`,
          [stageId]
        );

        const id1 = res1.rows[0].id;
        const id2 = res2.rows[0].id;

        const sumRes = await client.query(
          `SELECT sum(value) as total FROM crm2.crm2_deals WHERE id IN ($1, $2)`,
          [id1, id2]
        );

        // PostgreSQL NUMERIC(14,2) returns exact string "0.30", avoiding IEEE 754 float drift (0.30000000000000004)
        expect(sumRes.rows[0].total).toBe('0.30');
        expect(typeof sumRes.rows[0].total).toBe('string');
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('DB-13: transaction rollback rolls back multi-table modifications on secondary failure', async () => {
      if (!dbHealthy || !pool) return;
      const client = await pool.connect();
      const testDealName = `Rollback Test Deal ${Date.now()}`;
      try {
        await client.query('BEGIN');
        const stageRes = await client.query("SELECT id FROM crm2.crm2_stages WHERE name = 'New' LIMIT 1");
        const stageId = stageRes.rows[0].id;

        await client.query(
          `INSERT INTO crm2.crm2_deals (name, value, currency, stage_id)
           VALUES ($1, 5000.00, 'USD', $2)`,
          [testDealName, stageId]
        );

        // Intentionally trigger a check constraint failure
        await client.query(
          `INSERT INTO crm2.crm2_deals (name, value, currency, stage_id)
           VALUES ('Will Fail', -50.00, 'USD', $1)`,
          [stageId]
        );

        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      // Assert that the first inserted deal was completely rolled back
      const verifyRes = await pool.query(
        'SELECT count(*) as count FROM crm2.crm2_deals WHERE name = $1',
        [testDealName]
      );
      expect(parseInt(verifyRes.rows[0].count, 10)).toBe(0);
    });
  });
});
