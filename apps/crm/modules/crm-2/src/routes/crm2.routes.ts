import type { FastifyPluginAsync } from 'fastify';
import {
  DealsQuerySchema,
  CreateDealInputSchema,
  UpdateDealInputSchema,
  QuotesQuerySchema,
  CreateQuoteInputSchema,
  UpdateQuoteInputSchema,
} from '@clearshift/contracts';
import { crm2Store } from '../store/crm2.store.js';

/**
 * Fastify routes plugin for CRM-2 Deals, Pipeline and Quotes
 * Route prefix: /api/v1/crm-deals
 */
export const crm2Routes: FastifyPluginAsync = async (fastify) => {
  // GET /stages
  fastify.get('/stages', async (_request, reply) => {
    const stages = crm2Store.getStages();
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

    const { items, totalCount, totalPages } = crm2Store.getDeals(parseResult.data);
    const { page, pageSize } = parseResult.data;

    return reply.status(200).send({
      items,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  });

  // GET /deals/:id
  fastify.get<{ Params: { id: string } }>('/deals/:id', async (request, reply) => {
    const deal = crm2Store.getDealById(request.params.id);
    if (!deal) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: `Deal with ID '${request.params.id}' was not found.`,
      });
    }
    return reply.status(200).send(deal);
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

    try {
      const created = crm2Store.createDeal(parse.data);
      return reply.status(201).send(created);
    } catch (err: any) {
      return reply.status(400).send({
        code: 'DOMAIN_INVARIANT_VIOLATION',
        message: err.message || 'Failed to create deal',
      });
    }
  });

  // PATCH /deals/:id
  fastify.patch<{ Params: { id: string } }>('/deals/:id', async (request, reply) => {
    const existing = crm2Store.getDealById(request.params.id);
    if (!existing) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: `Deal with ID '${request.params.id}' was not found.`,
      });
    }

    const parse = UpdateDealInputSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid update input',
        details: parse.error.flatten(),
      });
    }

    try {
      const updated = crm2Store.updateDeal(request.params.id, parse.data);
      return reply.status(200).send(updated);
    } catch (err: any) {
      return reply.status(400).send({
        code: 'DOMAIN_INVARIANT_VIOLATION',
        message: err.message || 'Failed to update deal',
      });
    }
  });

  // GET /quotes
  fastify.get('/quotes', async (request, reply) => {
    const parse = QuotesQuerySchema.safeParse(request.query);
    if (!parse.success) {
      return reply.status(400).send({
        code: 'INVALID_QUERY',
        message: 'Invalid query parameters',
        details: parse.error.flatten(),
      });
    }

    const { items, totalCount, totalPages } = crm2Store.getQuotes(parse.data);
    const { page, pageSize } = parse.data;

    return reply.status(200).send({
      items,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  });

  // GET /quotes/:id
  fastify.get<{ Params: { id: string } }>('/quotes/:id', async (request, reply) => {
    const quote = crm2Store.getQuoteById(request.params.id);
    if (!quote) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: `Quote with ID '${request.params.id}' was not found.`,
      });
    }
    return reply.status(200).send(quote);
  });

  // POST /quotes
  fastify.post('/quotes', async (request, reply) => {
    const parse = CreateQuoteInputSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid quote input',
        details: parse.error.flatten(),
      });
    }

    try {
      const created = crm2Store.createQuote(parse.data);
      return reply.status(201).send(created);
    } catch (err: any) {
      return reply.status(400).send({
        code: 'DOMAIN_INVARIANT_VIOLATION',
        message: err.message || 'Failed to create quote',
      });
    }
  });

  // PATCH /quotes/:id
  fastify.patch<{ Params: { id: string } }>('/quotes/:id', async (request, reply) => {
    const existing = crm2Store.getQuoteById(request.params.id);
    if (!existing) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: `Quote with ID '${request.params.id}' was not found.`,
      });
    }

    const parse = UpdateQuoteInputSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid quote update',
        details: parse.error.flatten(),
      });
    }

    try {
      const updated = crm2Store.updateQuote(request.params.id, parse.data);
      return reply.status(200).send(updated);
    } catch (err: any) {
      return reply.status(400).send({
        code: 'DOMAIN_INVARIANT_VIOLATION',
        message: err.message || 'Failed to update quote',
      });
    }
  });
};
