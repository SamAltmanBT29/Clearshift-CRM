import type { FastifyPluginAsync } from 'fastify';
import {
  ImportRowInputSchema,
  type ImportRowInput,
} from '@clearshift/contracts';
import { Crm1TargetAdapter } from '../migration/target-adapter.js';

export interface ImportRouteOptions {
  adapter?: Crm1TargetAdapter | undefined;
}

/**
 * Fastify Routes for CRM-1 Migration Ingestion (KIT-08 Target Adapter API)
 * Mounted under base prefix: /api/v1/crm-contacts
 */
export const importRoutes: FastifyPluginAsync<ImportRouteOptions> = async (
  fastify,
  opts
) => {
  const adapter = opts.adapter ?? new Crm1TargetAdapter();

  // POST /import/row and POST /import
  const handleImportRow = async (request: any, reply: any) => {
    // 1. Resolve idempotencyKey from header or body
    const headerKey = request.headers['idempotency-key'] as string | undefined;
    const headerCorrelation = request.headers['x-correlation-id'] as string | undefined;
    const simulate503Header = request.headers['x-simulate-503'] === 'true';

    const rawBody = (request.body && typeof request.body === 'object') ? request.body : {};
    const idempotencyKey = headerKey ?? rawBody.idempotencyKey;
    const correlationId = headerCorrelation ?? rawBody.correlationId;

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Missing required Idempotency-Key header or field',
        },
      });
    }

    // 2. Validate payload schema
    const payloadToValidate = {
      ...rawBody,
      idempotencyKey,
      ...(correlationId ? { correlationId } : {}),
    };

    const parsed = ImportRowInputSchema.safeParse(payloadToValidate);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid import row payload',
          details: parsed.error.issues,
        },
      });
    }

    const input: ImportRowInput = parsed.data;
    const alreadyExists = adapter.getReceiptByKey(input.idempotencyKey) !== undefined;

    // 3. Delegate to Crm1TargetAdapter
    const result = await adapter.importRow(
      input.batchId,
      input.sourceRow,
      input.idempotencyKey,
      input,
      { simulate503: simulate503Header }
    );

    if (result.ok) {
      const statusCode = alreadyExists ? 200 : 201;

      return reply.status(statusCode).send({
        targetId: result.value.targetId,
        version: 1,
        outcome: result.value.receipt.kind,
        receipt: result.value.receipt,
        isExisting: alreadyExists,
      });
    }

    // 4. Map adapter errors to HTTP status codes
    const error = result.error;
    if (error.reasonCode === 'IDEMPOTENCY_CONFLICT') {
      return reply.status(409).send({
        error: {
          code: 'IDEMPOTENCY_CONFLICT',
          message: error.message,
        },
      });
    }

    if (error.reasonCode === 'SERVICE_UNAVAILABLE') {
      return reply.status(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: error.message,
          retryable: true,
        },
      });
    }

    // Business domain validation rejection
    return reply.status(422).send({
      error: {
        code: error.reasonCode,
        message: error.message,
        details: error.field ? [{ field: error.field }] : undefined,
      },
    });
  };

  fastify.post('/import/row', handleImportRow);
  fastify.post('/import', handleImportRow);

  // GET /import/receipts - List durable receipts for auditing
  fastify.get('/import/receipts', async (_request, reply) => {
    const receipts = adapter.getReceipts();
    return reply.status(200).send({
      items: receipts,
      total: receipts.length,
    });
  });

  // GET /import/receipts/:idempotencyKey - Retrieve durable receipt by key
  fastify.get<{ Params: { idempotencyKey: string } }>(
    '/import/receipts/:idempotencyKey',
    async (request, reply) => {
      const { idempotencyKey } = request.params;
      const receipt = adapter.getReceiptByKey(idempotencyKey);
      if (!receipt) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Receipt with idempotency key '${idempotencyKey}' not found`,
          },
        });
      }
      return reply.status(200).send(receipt);
    }
  );
};
