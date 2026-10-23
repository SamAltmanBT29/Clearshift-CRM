import type { FastifyPluginAsync } from 'fastify';
import {
  DealsQuerySchema,
  CreateDealInputSchema,
  UpdateDealInputSchema,
  QuotesQuerySchema,
  CreateQuoteInputSchema,
  UpdateQuoteInputSchema,
} from '@clearshift/contracts';
import { AppError } from '@cs/kernel';
import { crm2Service, Crm2Service } from '../services/crm2.service.js';

export interface Crm2RoutesOptions {
  service?: Crm2Service;
}

/**
 * Fastify routes plugin for CRM-2 Deals, Pipeline and Quotes
 * Route prefix: /api/v1/crm-deals
 */
export const crm2Routes: FastifyPluginAsync<Crm2RoutesOptions> = async (
  fastify,
  opts
) => {
  const service = opts.service ?? crm2Service;

  // ---------------------------------------------------------------------------
  // 1. GET /stages
  // ---------------------------------------------------------------------------
  fastify.get('/stages', async (_request, reply) => {
    const stages = await service.getStages();
    return reply.status(200).send({ items: stages });
  });

  // ---------------------------------------------------------------------------
  // 2. GET /deals (search/filter by stage, bounded pagination)
  // ---------------------------------------------------------------------------
  fastify.get('/deals', async (request, reply) => {
    const parseResult = DealsQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        code: 'INVALID_QUERY',
        message: 'Invalid query parameters',
        details: parseResult.error.issues,
      });
    }

    const result = await service.getDeals(parseResult.data);
    return reply.status(200).send(result);
  });

  // ---------------------------------------------------------------------------
  // 3. GET /deals/:id
  // ---------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>('/deals/:id', async (request, reply) => {
    const { id } = request.params;
    const deal = await service.getDealById(id);
    if (!deal) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: `Deal with ID '${id}' not found`,
      });
    }

    return reply.status(200).send(deal);
  });

  // ---------------------------------------------------------------------------
  // 4. POST /deals
  // ---------------------------------------------------------------------------
  fastify.post('/deals', async (request, reply) => {
    const parse = CreateDealInputSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid deal input',
        details: parse.error.issues,
      });
    }

    try {
      const created = await service.createDeal(parse.data);
      return reply.status(201).send(created);
    } catch (err: any) {
      if (err instanceof AppError || (err && err.statusCode)) {
        return reply.status(err.statusCode || 400).send({
          code: err.code || 'ERROR',
          message: err.message,
          details: err.details || [],
        });
      }
      throw err;
    }
  });

  // ---------------------------------------------------------------------------
  // 5. PATCH /deals/:id
  // ---------------------------------------------------------------------------
  fastify.patch<{ Params: { id: string } }>('/deals/:id', async (request, reply) => {
    const parse = UpdateDealInputSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid update input',
        details: parse.error.issues,
      });
    }

    try {
      const updated = await service.updateDeal(request.params.id, parse.data);
      return reply.status(200).send(updated);
    } catch (err: any) {
      if (err instanceof AppError || (err && err.statusCode)) {
        return reply.status(err.statusCode || 400).send({
          code: err.code || 'ERROR',
          message: err.message,
          details: err.details || [],
        });
      }
      throw err;
    }
  });

  // ---------------------------------------------------------------------------
  // 6. GET /quotes
  // ---------------------------------------------------------------------------
  fastify.get('/quotes', async (request, reply) => {
    const parse = QuotesQuerySchema.safeParse(request.query);
    if (!parse.success) {
      return reply.status(400).send({
        code: 'INVALID_QUERY',
        message: 'Invalid query parameters',
        details: parse.error.issues,
      });
    }

    const result = await service.getQuotes(parse.data);
    return reply.status(200).send(result);
  });

  // ---------------------------------------------------------------------------
  // 7. GET /quotes/:id
  // ---------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>('/quotes/:id', async (request, reply) => {
    const { id } = request.params;
    const quote = await service.getQuoteById(id);
    if (!quote) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: `Quote with ID '${id}' not found`,
      });
    }

    return reply.status(200).send(quote);
  });

  // ---------------------------------------------------------------------------
  // 8. POST /quotes
  // ---------------------------------------------------------------------------
  fastify.post('/quotes', async (request, reply) => {
    const parse = CreateQuoteInputSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid quote input',
        details: parse.error.issues,
      });
    }

    try {
      const created = await service.createQuote(parse.data);
      return reply.status(201).send(created);
    } catch (err: any) {
      if (err instanceof AppError || (err && err.statusCode)) {
        return reply.status(err.statusCode || 400).send({
          code: err.code || 'ERROR',
          message: err.message,
          details: err.details || [],
        });
      }
      throw err;
    }
  });

  // ---------------------------------------------------------------------------
  // 9. PATCH /quotes/:id
  // ---------------------------------------------------------------------------
  fastify.patch<{ Params: { id: string } }>('/quotes/:id', async (request, reply) => {
    const parse = UpdateQuoteInputSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid quote update',
        details: parse.error.issues,
      });
    }

    try {
      const updated = await service.updateQuote(request.params.id, parse.data);
      return reply.status(200).send(updated);
    } catch (err: any) {
      if (err instanceof AppError || (err && err.statusCode)) {
        return reply.status(err.statusCode || 400).send({
          code: err.code || 'ERROR',
          message: err.message,
          details: err.details || [],
        });
      }
      throw err;
    }
  });

  // ---------------------------------------------------------------------------
  // 10. GET /deals/:id/summary (read-model consistency projection)
  // ---------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>('/deals/:id/summary', async (request, reply) => {
    try {
      const summary = await service.getDealDerivedTotals(request.params.id);
      return reply.status(200).send(summary);
    } catch (err: any) {
      if (err instanceof AppError || (err && err.statusCode)) {
        return reply.status(err.statusCode || 400).send({
          code: err.code || 'ERROR',
          message: err.message,
          details: err.details || [],
        });
      }
      throw err;
    }
  });

  // ---------------------------------------------------------------------------
  // 11. GET /pipeline/summary (pipeline-wide report projection)
  // ---------------------------------------------------------------------------
  fastify.get('/pipeline/summary', async (_request, reply) => {
    const summary = await service.getPipelineSummary();
    return reply.status(200).send(summary);
  });
};
