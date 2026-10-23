import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  UpsertSourceIdentityRequestSchema,
  LookupSourceIdentityQuerySchema,
  ResolveEvidenceRequestSchema,
  MergeGoldenIdRequestSchema,
  StandardErrorCodes,
  HttpStatusCodes,
  createErrorEnvelope,
} from '@clearshift/contracts';
import { extractCorrelationId } from '@cs/core';
import { GoldenIdService } from '../golden-id/golden-id-service.js';
import { isDisplayGid, isUuid } from '../golden-id/generator.js';

export interface GoldenIdRouteOptions {
  service?: GoldenIdService;
}

export async function goldenIdRoutes(
  fastify: FastifyInstance,
  options?: GoldenIdRouteOptions
): Promise<void> {
  const service = options?.service ?? new GoldenIdService();

  // Correlation ID middleware hook
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = extractCorrelationId(request.headers);
    reply.header('x-correlation-id', correlationId);
    (request as any).correlationId = correlationId;
  });

  /**
   * POST /api/v1/hub/id-map
   * Idempotent Source Identity Upsert (PLT-07).
   */
  fastify.post('/api/v1/hub/id-map', async (request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = (request as any).correlationId;
    const parseResult = UpsertSourceIdentityRequestSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(HttpStatusCodes.BAD_REQUEST).send(
        createErrorEnvelope({
          code: StandardErrorCodes.BAD_REQUEST,
          message: 'Invalid source identity upsert payload',
          details: parseResult.error.flatten(),
          correlationId,
        })
      );
    }

    try {
      const actor = (request.headers['x-actor-id'] as string) || 'hub_api';
      const result = await service.upsertSourceIdentity(parseResult.data, {
        actor,
        correlationId,
      });

      const statusCode =
        result.status === 'existing' ? HttpStatusCodes.OK : HttpStatusCodes.CREATED;
      return reply.status(statusCode).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upsert failed';
      return reply.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).send(
        createErrorEnvelope({
          code: StandardErrorCodes.INTERNAL_SERVER_ERROR,
          message,
          correlationId,
        })
      );
    }
  });

  /**
   * GET /api/v1/hub/id-map
   * Explicit Lookup by Source Composite Key (entityType, sourceSystem, sourceId).
   */
  fastify.get('/api/v1/hub/id-map', async (request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = (request as any).correlationId;
    const parseResult = LookupSourceIdentityQuerySchema.safeParse(request.query);

    if (!parseResult.success) {
      return reply.status(HttpStatusCodes.BAD_REQUEST).send(
        createErrorEnvelope({
          code: StandardErrorCodes.BAD_REQUEST,
          message: 'Invalid lookup query parameters. entityType, sourceSystem, and sourceId are required.',
          details: parseResult.error.flatten(),
          correlationId,
        })
      );
    }

    const mapping = await service.lookupSourceIdentity(parseResult.data);
    if (!mapping) {
      return reply.status(HttpStatusCodes.NOT_FOUND).send(
        createErrorEnvelope({
          code: StandardErrorCodes.NOT_FOUND,
          message: `Source identity mapping not found for [${parseResult.data.entityType}:${parseResult.data.sourceSystem}:${parseResult.data.sourceId}].`,
          correlationId,
        })
      );
    }

    return reply.status(HttpStatusCodes.OK).send(mapping);
  });

  /**
   * GET /api/v1/hub/id-map/:goldenRecordId
   * Lookup Golden Record and linked source mappings by UUID primary key.
   * Invariant: Display GIDs are NEVER used as lookup primary keys (AC 5).
   */
  fastify.get(
    '/api/v1/hub/id-map/:goldenRecordId',
    async (request: FastifyRequest<{ Params: { goldenRecordId: string } }>, reply: FastifyReply) => {
      const correlationId = (request as any).correlationId;
      const { goldenRecordId } = request.params;

      if (isDisplayGid(goldenRecordId)) {
        return reply.status(HttpStatusCodes.BAD_REQUEST).send(
          createErrorEnvelope({
            code: StandardErrorCodes.BAD_REQUEST,
            message: `[PLT-07 Invariant Violation] Display GID '${goldenRecordId}' cannot be used as a primary key lookup parameter. Hub primary identity requires a UUID. Use /api/v1/hub/id-map/lookup or query by primary UUID.`,
            correlationId,
          })
        );
      }

      if (!isUuid(goldenRecordId)) {
        return reply.status(HttpStatusCodes.BAD_REQUEST).send(
          createErrorEnvelope({
            code: StandardErrorCodes.BAD_REQUEST,
            message: `Invalid goldenRecordId parameter '${goldenRecordId}'. Must be a valid UUID.`,
            correlationId,
          })
        );
      }

      const detail = await service.lookupByGoldenId(goldenRecordId);
      if (!detail) {
        return reply.status(HttpStatusCodes.NOT_FOUND).send(
          createErrorEnvelope({
            code: StandardErrorCodes.NOT_FOUND,
            message: `Golden Record with UUID '${goldenRecordId}' not found.`,
            correlationId,
          })
        );
      }

      return reply.status(HttpStatusCodes.OK).send(detail);
    }
  );

  /**
   * POST /api/v1/hub/id-map/resolve
   * Resolves existing Golden Records by normalized evidence (taxNumber, email, phone).
   */
  fastify.post('/api/v1/hub/id-map/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = (request as any).correlationId;
    const parseResult = ResolveEvidenceRequestSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(HttpStatusCodes.BAD_REQUEST).send(
        createErrorEnvelope({
          code: StandardErrorCodes.BAD_REQUEST,
          message: 'Invalid resolve evidence request payload',
          details: parseResult.error.flatten(),
          correlationId,
        })
      );
    }

    const matches = await service.resolveEvidence(parseResult.data);
    return reply.status(HttpStatusCodes.OK).send({
      matches: matches.map((m) => ({
        goldenRecordId: m.record.id,
        displayGid: m.record.displayGid,
        entityType: m.record.entityType,
        matchedKey: m.matchedKey,
      })),
      count: matches.length,
    });
  });

  /**
   * POST /api/v1/hub/id-map/merge
   * Human-approved merge path for two Golden Records.
   * Invariant: Destructive merges require human review; zero automatic merge.
   */
  fastify.post('/api/v1/hub/id-map/merge', async (request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = (request as any).correlationId;
    const parseResult = MergeGoldenIdRequestSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(HttpStatusCodes.BAD_REQUEST).send(
        createErrorEnvelope({
          code: StandardErrorCodes.BAD_REQUEST,
          message: 'Invalid merge request payload',
          details: parseResult.error.flatten(),
          correlationId,
        })
      );
    }

    try {
      const mergedDetail = await service.mergeGoldenRecords(parseResult.data, {
        correlationId,
      });

      return reply.status(HttpStatusCodes.OK).send(mergedDetail);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Merge failed';
      const statusCode = message.includes('not found')
        ? HttpStatusCodes.NOT_FOUND
        : HttpStatusCodes.BAD_REQUEST;

      return reply.status(statusCode).send(
        createErrorEnvelope({
          code:
            statusCode === HttpStatusCodes.NOT_FOUND
              ? StandardErrorCodes.NOT_FOUND
              : StandardErrorCodes.BAD_REQUEST,
          message,
          correlationId,
        })
      );
    }
  });

  /**
   * GET /api/v1/hub/id-map/:goldenRecordId/history
   * Retrieves mapping history and merge events for a Golden Record.
   */
  fastify.get(
    '/api/v1/hub/id-map/:goldenRecordId/history',
    async (request: FastifyRequest<{ Params: { goldenRecordId: string } }>, reply: FastifyReply) => {
      const correlationId = (request as any).correlationId;
      const { goldenRecordId } = request.params;

      if (isDisplayGid(goldenRecordId) || !isUuid(goldenRecordId)) {
        return reply.status(HttpStatusCodes.BAD_REQUEST).send(
          createErrorEnvelope({
            code: StandardErrorCodes.BAD_REQUEST,
            message: `Invalid goldenRecordId parameter '${goldenRecordId}'. Must be a valid UUID.`,
            correlationId,
          })
        );
      }

      const history = await service.getMappingHistory(goldenRecordId);
      return reply.status(HttpStatusCodes.OK).send({
        goldenRecordId,
        history,
      });
    }
  );
}
