import type { FastifyPluginAsync, FastifyRequest, FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CRM3TicketListQuerySchema,
  CRM3NoteListQuerySchema,
  CRM3TicketCreateSchema,
  CRM3TicketPatchSchema,
  CRM3NoteCreateSchema,
} from '@clearshift/contracts';
import { AppError } from '@cs/kernel';
import { crm3Service, Crm3Service } from '../services/crm3.service.js';
import { requireRoles, resolveNoteAuthor } from '../plugins/auth.js';
import { CRM3_ENDPOINT_ROLES } from '../policies/roles.js';

export interface Crm3RoutesOptions {
  service?: Crm3Service;
  enforceAuth?: boolean;
}

const UuidParamSchema = z.object({
  id: z.string().uuid('Ticket ID must be a valid UUID'),
});

/**
 * Correlation id for error envelopes: the caller's x-correlation-id header, else one derived
 * from the Fastify request id.
 */
function correlationIdOf(request: FastifyRequest): string {
  const header = request.headers['x-correlation-id'];
  return typeof header === 'string' && header.length > 0 ? header : `corr-${request.id}`;
}

function getPreHandlers(
  fastify: FastifyInstance,
  roles: readonly string[],
  enforceAuth = true
) {
  if (!enforceAuth) {
    return [];
  }
  // Fail closed: never expose routes unauthenticated because the Hub JWT plugin is missing.
  if (!fastify.authenticate) {
    throw new Error(
      'CRM-3 routes require the @cs/identity jwtPlugin to be registered (or enforceAuth: false for tests)'
    );
  }
  return [fastify.authenticate, requireRoles(roles)];
}

/**
 * Fastify routes plugin for CRM-3 Support Tickets & Notes API
 * Route prefix: /api/v1/crm-tickets
 */
export const crm3Routes: FastifyPluginAsync<Crm3RoutesOptions> = async (
  fastify,
  opts
) => {
  const service = opts.service ?? crm3Service;
  const enforceAuth = opts.enforceAuth ?? true;

  // ---------------------------------------------------------------------------
  // 1. GET /tickets
  // ---------------------------------------------------------------------------
  fastify.get(
    '/tickets',
    {
      preHandler: getPreHandlers(fastify, CRM3_ENDPOINT_ROLES.TICKETS_LIST, enforceAuth),
    },
    async (request, reply) => {
      const parseResult = CRM3TicketListQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          correlation_id: correlationIdOf(request),
          code: 'INVALID_QUERY',
          message: 'Invalid query parameters',
          details: parseResult.error.issues,
        });
      }

      const result = await service.getTickets(parseResult.data);
      return reply.status(200).send(result);
    }
  );

  // ---------------------------------------------------------------------------
  // 2. GET /tickets/:id
  // ---------------------------------------------------------------------------
  fastify.get(
    '/tickets/:id',
    {
      preHandler: getPreHandlers(fastify, CRM3_ENDPOINT_ROLES.TICKETS_READ, enforceAuth),
    },
    async (request, reply) => {
      const paramResult = UuidParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          correlation_id: correlationIdOf(request),
          code: 'VALIDATION_ERROR',
          message: 'Invalid ticket UUID',
          details: paramResult.error.issues,
        });
      }

      const ticket = await service.getTicketById(paramResult.data.id);
      if (!ticket) {
        return reply.status(404).send({
          correlation_id: correlationIdOf(request),
          code: 'NOT_FOUND',
          message: `Ticket with ID '${paramResult.data.id}' not found`,
          details: [
            {
              field: 'id',
              message: `Ticket with ID '${paramResult.data.id}' not found`,
              code: 'ticket_not_found',
            },
          ],
        });
      }

      return reply.status(200).send(ticket);
    }
  );

  // ---------------------------------------------------------------------------
  // 3. POST /tickets
  // ---------------------------------------------------------------------------
  fastify.post(
    '/tickets',
    {
      preHandler: getPreHandlers(fastify, CRM3_ENDPOINT_ROLES.TICKETS_CREATE, enforceAuth),
    },
    async (request: FastifyRequest, reply) => {
      const parse = CRM3TicketCreateSchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(400).send({
          correlation_id: correlationIdOf(request),
          code: 'VALIDATION_ERROR',
          message: 'Invalid ticket input',
          details: parse.error.issues,
        });
      }

      try {
        const authorId = request.user?.sub || 'system';
        const created = await service.createTicket(parse.data, authorId);
        return reply.status(201).send(created);
      } catch (err: any) {
        if (err instanceof AppError || (err && err.statusCode)) {
          return reply.status(err.statusCode || 400).send({
            correlation_id: correlationIdOf(request),
            code: err.code || 'VALIDATION_ERROR',
            message: err.message,
            details: err.details || [],
          });
        }
        throw err;
      }
    }
  );

  // ---------------------------------------------------------------------------
  // 4. PATCH /tickets/:id
  // ---------------------------------------------------------------------------
  fastify.patch(
    '/tickets/:id',
    {
      preHandler: getPreHandlers(fastify, CRM3_ENDPOINT_ROLES.TICKETS_UPDATE, enforceAuth),
    },
    async (request, reply) => {
      const paramResult = UuidParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          correlation_id: correlationIdOf(request),
          code: 'VALIDATION_ERROR',
          message: 'Invalid ticket UUID',
          details: paramResult.error.issues,
        });
      }

      const parse = CRM3TicketPatchSchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(400).send({
          correlation_id: correlationIdOf(request),
          code: 'VALIDATION_ERROR',
          message: 'Invalid ticket update input',
          details: parse.error.issues,
        });
      }

      try {
        const updated = await service.updateTicket(paramResult.data.id, parse.data);
        return reply.status(200).send(updated);
      } catch (err: any) {
        if (err instanceof AppError || (err && err.statusCode)) {
          return reply.status(err.statusCode || 400).send({
            correlation_id: correlationIdOf(request),
            code: err.code || 'VALIDATION_ERROR',
            message: err.message,
            details: err.details || [],
          });
        }
        throw err;
      }
    }
  );

  // ---------------------------------------------------------------------------
  // 5. GET /tickets/:id/notes
  // ---------------------------------------------------------------------------
  fastify.get(
    '/tickets/:id/notes',
    {
      preHandler: getPreHandlers(fastify, CRM3_ENDPOINT_ROLES.NOTES_LIST, enforceAuth),
    },
    async (request, reply) => {
      const paramResult = UuidParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          correlation_id: correlationIdOf(request),
          code: 'VALIDATION_ERROR',
          message: 'Invalid ticket UUID',
          details: paramResult.error.issues,
        });
      }

      const queryResult = CRM3NoteListQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          correlation_id: correlationIdOf(request),
          code: 'INVALID_QUERY',
          message: 'Invalid query parameters',
          details: queryResult.error.issues,
        });
      }

      try {
        const result = await service.getTicketNotes(paramResult.data.id, queryResult.data);
        return reply.status(200).send(result);
      } catch (err: any) {
        if (err instanceof AppError || (err && err.statusCode)) {
          return reply.status(err.statusCode || 400).send({
            correlation_id: correlationIdOf(request),
            code: err.code || 'VALIDATION_ERROR',
            message: err.message,
            details: err.details || [],
          });
        }
        throw err;
      }
    }
  );

  // ---------------------------------------------------------------------------
  // 6. POST /notes
  // ---------------------------------------------------------------------------
  fastify.post(
    '/notes',
    {
      preHandler: getPreHandlers(fastify, CRM3_ENDPOINT_ROLES.NOTES_CREATE, enforceAuth),
    },
    async (request: FastifyRequest, reply) => {
      const parse = CRM3NoteCreateSchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(400).send({
          correlation_id: correlationIdOf(request),
          code: 'VALIDATION_ERROR',
          message: 'Invalid note input',
          details: parse.error.issues,
        });
      }

      try {
        const authorId = resolveNoteAuthor(request, parse.data.authorId);
        const created = await service.addNote(
          parse.data.ticketId,
          parse.data.noteText,
          authorId
        );
        return reply.status(201).send(created);
      } catch (err: any) {
        if (err instanceof AppError || (err && err.statusCode)) {
          return reply.status(err.statusCode || 400).send({
            correlation_id: correlationIdOf(request),
            code: err.code || 'VALIDATION_ERROR',
            message: err.message,
            details: err.details || [],
          });
        }
        throw err;
      }
    }
  );

  // ---------------------------------------------------------------------------
  // 7. POST /tickets/:id/notes (REST alias)
  // ---------------------------------------------------------------------------
  fastify.post(
    '/tickets/:id/notes',
    {
      preHandler: getPreHandlers(fastify, CRM3_ENDPOINT_ROLES.NOTES_CREATE, enforceAuth),
    },
    async (request: FastifyRequest, reply) => {
      const paramResult = UuidParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          correlation_id: correlationIdOf(request),
          code: 'VALIDATION_ERROR',
          message: 'Invalid ticket UUID',
          details: paramResult.error.issues,
        });
      }

      const NoteBodySchema = z
        .object({
          noteText: z.string().trim().min(1, 'Note text must not be empty'),
          authorId: z.string().trim().min(1).optional(),
        })
        .strict();

      const parse = NoteBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(400).send({
          correlation_id: correlationIdOf(request),
          code: 'VALIDATION_ERROR',
          message: 'Invalid note input',
          details: parse.error.issues,
        });
      }

      try {
        const authorId = resolveNoteAuthor(request, parse.data.authorId);
        const created = await service.addNote(
          paramResult.data.id,
          parse.data.noteText,
          authorId
        );
        return reply.status(201).send(created);
      } catch (err: any) {
        if (err instanceof AppError || (err && err.statusCode)) {
          return reply.status(err.statusCode || 400).send({
            correlation_id: correlationIdOf(request),
            code: err.code || 'VALIDATION_ERROR',
            message: err.message,
            details: err.details || [],
          });
        }
        throw err;
      }
    }
  );
};
