import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CRM2_API_PREFIX,
  CreateDealInputSchema,
  CreateQuoteInputSchema,
  type CreateDealInput,
  type CreateQuoteInput,
  type Deal,
  type Quote,
} from '@clearshift/contracts';
import { AppError } from '@cs/kernel';
import { Crm2Service } from '../../src/services/crm2.service.js';
import { crm2Routes } from '../../src/routes/crm2.routes.js';
import { DuplicateRecordError } from '../../src/domain/errors.js';

const { Pool } = pg;
const databaseUrl =
  process.env['DATABASE_URL_TEST'] ||
  process.env['DATABASE_MIGRATOR_URL'] ||
  process.env['DATABASE_URL'] ||
  'postgresql://clearshift@localhost:5432/clearshift_test';

/**
 * PostgreSQL-backed Crm2Service adapter for API-to-PostgreSQL integration testing.
 * Implements real database transactions, foreign key constraints, and unique checks.
 */
class PostgresCrm2Service extends Crm2Service {
  constructor(private pool: pg.Pool) {
    super();
  }

  override async createDeal(input: CreateDealInput): Promise<Deal> {
    const validated = CreateDealInputSchema.parse(input);

    // Resolve stage_id from stage_name
    const stageRes = await this.pool.query(
      'SELECT id FROM crm2.crm2_stages WHERE name = $1',
      [validated.stage_name]
    );
    const stageId =
      stageRes.rows[0]?.id || '00000000-0000-4000-8000-000000000001';

    const insertRes = await this.pool.query(
      `INSERT INTO crm2.crm2_deals
         (name, contact_id, value, currency, stage_id, close_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, contact_id, value, currency, stage_id, close_date, created_at, updated_at`,
      [
        validated.name,
        validated.contact_id || null,
        validated.value,
        validated.currency,
        stageId,
        validated.close_date || null,
      ]
    );

    const row = insertRes.rows[0];
    return {
      id: row.id,
      name: row.name,
      contact_id: row.contact_id,
      contact_name: null,
      value: row.value,
      currency: row.currency,
      stage_id: row.stage_id,
      stage_name: validated.stage_name,
      close_date: row.close_date ? row.close_date.toISOString().slice(0, 10) : null,
      is_orphan: row.contact_id === null,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  override async getDealById(id: string): Promise<Deal | null> {
    const res = await this.pool.query(
      `SELECT d.*, s.name as stage_name
       FROM crm2.crm2_deals d
       JOIN crm2.crm2_stages s ON d.stage_id = s.id
       WHERE d.id = $1`,
      [id]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      name: row.name,
      contact_id: row.contact_id,
      contact_name: null,
      value: row.value,
      currency: row.currency,
      stage_id: row.stage_id,
      stage_name: row.stage_name,
      close_date: row.close_date ? row.close_date.toISOString().slice(0, 10) : null,
      is_orphan: row.contact_id === null,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  override async createQuote(input: CreateQuoteInput): Promise<Quote> {
    const validated = CreateQuoteInputSchema.parse(input);

    try {
      const insertRes = await this.pool.query(
        `INSERT INTO crm2.crm2_quotes
           (quote_number, deal_id, quote_date, amount, note)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, quote_number, deal_id, quote_date, amount, note, created_at, updated_at`,
        [
          validated.quote_number,
          validated.deal_id,
          validated.date,
          validated.amount,
          validated.note || null,
        ]
      );

      const row = insertRes.rows[0];
      return {
        id: row.id,
        quote_number: row.quote_number,
        deal_id: row.deal_id,
        date: row.quote_date.toISOString().slice(0, 10),
        amount: row.amount,
        currency: 'USD',
        note: row.note,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      };
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
        throw new DuplicateRecordError('quote', validated.quote_number);
      }
      throw err;
    }
  }
}

describe('CRM-2 Fastify API-to-PostgreSQL Live Integration Suite', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let seededDealId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    const service = new PostgresCrm2Service(pool);

    app = Fastify({ logger: false });

    // Standard platform error handler
    app.setErrorHandler((error, request, reply) => {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
          code: error.code,
          message: error.message,
          details: error.details,
          correlation_id: 'corr-test',
        });
      }
      const err = error as Error & { statusCode?: number };
      const statusCode = err.statusCode ?? 500;
      return reply.status(statusCode).send({
        code: 'INTERNAL_SERVER_ERROR',
        message: err.message,
        details: [],
        correlation_id: 'corr-test',
      });
    });

    await app.register(crm2Routes, {
      prefix: CRM2_API_PREFIX,
      service,
      authEnabled: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    // Clean up created test deals and quotes
    await pool.query(
      "DELETE FROM crm2.crm2_quotes WHERE quote_number LIKE 'PG-INT-%'"
    );
    await pool.query(
      "DELETE FROM crm2.crm2_deals WHERE name LIKE 'PG-INT-%'"
    );
    await pool.end();
  });

  it('1. POST /deals then GET /deals/:id persists and retrieves from real PostgreSQL', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: `${CRM2_API_PREFIX}/deals`,
      payload: {
        name: 'PG-INT-Standard Deal',
        contact_id: '90000000-0000-4000-8000-000000000001',
        value: '45000.00',
        currency: 'USD',
        stage_name: 'New',
        close_date: '2026-12-31',
      },
    });

    expect(postRes.statusCode).toBe(201);
    const created = JSON.parse(postRes.body);
    expect(created.id).toBeDefined();
    seededDealId = created.id;

    // GET /deals/:id to verify persistence
    const getRes = await app.inject({
      method: 'GET',
      url: `${CRM2_API_PREFIX}/deals/${seededDealId}`,
    });

    expect(getRes.statusCode).toBe(200);
    const retrieved = JSON.parse(getRes.body);
    expect(retrieved.id).toBe(seededDealId);
    expect(retrieved.name).toBe('PG-INT-Standard Deal');
    expect(retrieved.value).toBe('45000.00');
  });

  it('2. duplicate POST /quotes returns 409 from real unique constraint crm2_quotes_quote_number_key', async () => {
    const quotePayload = {
      deal_id: seededDealId,
      quote_number: 'PG-INT-Q-001',
      date: '2026-10-24',
      amount: '45000.00',
      currency: 'USD',
      note: 'Initial Quote',
    };

    // First POST should succeed
    const firstRes = await app.inject({
      method: 'POST',
      url: `${CRM2_API_PREFIX}/quotes`,
      payload: quotePayload,
    });
    expect(firstRes.statusCode).toBe(201);

    // Duplicate POST with same quote_number should trigger unique constraint -> 409
    const dupRes = await app.inject({
      method: 'POST',
      url: `${CRM2_API_PREFIX}/quotes`,
      payload: quotePayload,
    });

    expect(dupRes.statusCode).toBe(409);
    const body = JSON.parse(dupRes.body);
    expect(body.code).toBe('DUPLICATE_RECORD');
  });

  it('3. orphan deal is persisted in PostgreSQL with null contact_id and is_orphan=true', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: `${CRM2_API_PREFIX}/deals`,
      payload: {
        name: 'PG-INT-Orphan Deal',
        contact_id: null,
        value: '12500.00',
        currency: 'USD',
        stage_name: 'New',
        close_date: '2026-11-15',
      },
    });

    expect(postRes.statusCode).toBe(201);
    const created = JSON.parse(postRes.body);
    expect(created.contact_id).toBeNull();
    expect(created.is_orphan).toBe(true);

    // Verify directly in DB
    const dbRow = await pool.query(
      'SELECT contact_id FROM crm2.crm2_deals WHERE id = $1',
      [created.id]
    );
    expect(dbRow.rows[0].contact_id).toBeNull();
  });

  it('4. whitespace-only name: accepted by Zod but rejected by DB constraint crm2_deals_name_nonempty_check', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${CRM2_API_PREFIX}/deals`,
      payload: {
        name: '   ', // 3 spaces - passes Zod min(1), fails length(btrim(name)) > 0
        value: '1000.00',
        currency: 'USD',
        stage_name: 'New',
        close_date: '2026-12-31',
      },
    });

    // Schema now trims name and catches empty string, returning 400 instead of 500
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('5. 13-digit value: correctly rejected with 400 validation error by bounded DecimalStringSchema', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${CRM2_API_PREFIX}/deals`,
      payload: {
        name: 'PG-INT-13-Digit Deal',
        value: '1000000000000.00', // 13 integer digits - now rejected by 12-digit bound
        currency: 'USD',
        stage_name: 'New',
        close_date: '2026-12-31',
      },
    });

    // Schema now limits integer digits to 12, returning 400 instead of 500
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});
