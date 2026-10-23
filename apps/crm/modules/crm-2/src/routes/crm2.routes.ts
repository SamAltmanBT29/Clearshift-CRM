import type { FastifyPluginAsync } from 'fastify';
import {
  DealsQuerySchema,
  CreateDealInputSchema,
  UpdateDealInputSchema,
  QuotesQuerySchema,
  CreateQuoteInputSchema,
  UpdateQuoteInputSchema,
  CRM2_STAGES,
  type Deal,
  type Stage,
  type Quote,
} from '@clearshift/contracts';

/**
 * Fastify routes plugin for CRM-2 Deals, Pipeline and Quotes
 * Route prefix: /api/v1/crm-deals
 */
export const crm2Routes: FastifyPluginAsync = async (fastify) => {
  // GET /stages
  fastify.get('/stages', async (_request, reply) => {
    const stages: Stage[] = CRM2_STAGES.map((name, idx) => ({
      id: `10000000-0000-4000-8000-00000000000${idx + 1}`,
      name,
      order: idx + 1,
      is_closed_won: name === 'Won',
      is_closed_lost: name === 'Lost',
      created_at: new Date('2026-10-01T00:00:00Z').toISOString(),
      updated_at: new Date('2026-10-01T00:00:00Z').toISOString(),
    }));
    return reply.status(200).send({ items: stages });
  });

  // GET /deals (search/filter by stage, bounded pagination)
  fastify.get('/deals', async (request, reply) => {
    const parseResult = DealsQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        code: 'INVALID_QUERY',
        message: 'Invalid query parameters',
        details: parseResult.error.flatten(),
      });
    }

    const { page, pageSize } = parseResult.data;
    const items: Deal[] = [
      {
        id: '20000000-0000-4000-8000-000000000001',
        name: 'Acme Cloud Modernization',
        contact_id: '90000000-0000-4000-8000-000000000001',
        contact_name: 'Sarah Connor',
        value: '75000.00',
        currency: 'USD',
        stage_id: '10000000-0000-4000-8000-000000000003',
        stage_name: 'Proposal',
        close_date: '2026-11-30',
        is_orphan: false,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      },
      {
        id: '20000000-0000-4000-8000-000000000002',
        name: 'Inbound Enterprise Lead [Orphan Deal]',
        contact_id: null, // Null contact creates orphan deal
        contact_name: null,
        value: '125000.00',
        currency: 'USD',
        stage_id: '10000000-0000-4000-8000-000000000001',
        stage_name: 'New',
        close_date: '2026-12-15',
        is_orphan: true,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      },
    ];

    return reply.status(200).send({
      items,
      pagination: {
        page,
        pageSize,
        totalCount: items.length,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
  });

  // GET /deals/:id
  fastify.get<{ Params: { id: string } }>('/deals/:id', async (request, reply) => {
    return reply.status(200).send({
      id: request.params.id,
      name: 'Acme Cloud Modernization',
      contact_id: null,
      value: '75000.00',
      currency: 'USD',
      stage_id: '10000000-0000-4000-8000-000000000003',
      stage_name: 'Proposal',
      close_date: '2026-11-30',
      is_orphan: true,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    });
  });

  // POST /deals
  fastify.post('/deals', async (request, reply) => {
    const parse = CreateDealInputSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid deal input',
        details: parse.error.flatten(),
      });
    }

    const created: Deal = {
      id: '20000000-0000-4000-8000-000000000099',
      name: parse.data.name,
      contact_id: parse.data.contact_id ?? null,
      contact_name: null,
      value: parse.data.value,
      currency: parse.data.currency,
      stage_id: '10000000-0000-4000-8000-000000000001',
      stage_name: parse.data.stage_name,
      close_date: parse.data.close_date,
      is_orphan: parse.data.contact_id === null || parse.data.contact_id === undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return reply.status(201).send(created);
  });

  // PATCH /deals/:id
  fastify.patch<{ Params: { id: string } }>('/deals/:id', async (request, reply) => {
    const parse = UpdateDealInputSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid update input',
        details: parse.error.flatten(),
      });
    }
    return reply.status(200).send({
      id: request.params.id,
      name: parse.data.name || 'Updated Deal',
      contact_id: parse.data.contact_id ?? null,
      value: parse.data.value || '10000.00',
      currency: parse.data.currency || 'USD',
      stage_id: '10000000-0000-4000-8000-000000000001',
      stage_name: parse.data.stage_name || 'New',
      close_date: parse.data.close_date || '2026-12-31',
      is_orphan: parse.data.contact_id === null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });

  // GET /quotes
  fastify.get('/quotes', async (request, reply) => {
    const parse = QuotesQuerySchema.safeParse(request.query);
    if (!parse.success) {
      return reply.status(400).send({ code: 'INVALID_QUERY', message: 'Invalid query parameters' });
    }
    const quotes: Quote[] = [
      {
        id: '30000000-0000-4000-8000-000000000001',
        deal_id: '20000000-0000-4000-8000-000000000001',
        quote_number: 'Q-2026-001',
        date: '2026-10-15',
        amount: '75000.00',
        currency: 'USD',
        note: 'Tier-1 Package',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
    return reply.status(200).send({
      items: quotes,
      pagination: {
        page: parse.data.page,
        pageSize: parse.data.pageSize,
        totalCount: quotes.length,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
  });

  // POST /quotes
  fastify.post('/quotes', async (request, reply) => {
    const parse = CreateQuoteInputSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Invalid quote input' });
    }
    const created: Quote = {
      id: '30000000-0000-4000-8000-000000000099',
      deal_id: parse.data.deal_id,
      quote_number: parse.data.quote_number,
      date: parse.data.date,
      amount: parse.data.amount,
      currency: parse.data.currency,
      note: parse.data.note ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return reply.status(201).send(created);
  });

  // PATCH /quotes/:id
  fastify.patch<{ Params: { id: string } }>('/quotes/:id', async (request, reply) => {
    const parse = UpdateQuoteInputSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Invalid quote update' });
    }
    return reply.status(200).send({
      id: request.params.id,
      deal_id: '20000000-0000-4000-8000-000000000001',
      quote_number: parse.data.quote_number || 'Q-2026-001',
      date: parse.data.date || '2026-11-01',
      amount: parse.data.amount || '50000.00',
      currency: parse.data.currency || 'USD',
      note: parse.data.note ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });
};
