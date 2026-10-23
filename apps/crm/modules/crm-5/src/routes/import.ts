import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import {
  ImportRowInputSchema,
  type ImportRowInput,
} from '@clearshift/contracts';
import type { RoleType } from '@cs/identity';
import { Crm5TargetAdapter } from '../migration/target-adapter.js';
import { CRM5_ENDPOINT_ROLES } from '../policies/roles.js';
import { requireRoles, assertTenantIsolation, type AuthenticatedUser } from '../plugins/auth.js';
import { redactSensitiveObject } from '../policies/masking.js';

export interface ImportRouteOptions {
  adapter?: Crm5TargetAdapter;
  authEnabled?: boolean | undefined;
}

function endpointPreHandlers(
  fastify: FastifyInstance,
  allowedRoles: readonly RoleType[],
  authEnabled: boolean = true
) {
  if (!authEnabled) return [];
  return [fastify.authenticate, requireRoles(allowedRoles)];
}

/**
 * Fastify Routes for CRM-5 Migration Ingestion (KIT-08 Target Adapter API)
 * Base prefix: /api/v1/crm-control
 * Strictly enforces SDS role permissions matrix and idempotency guarantees.
 */
export const importRoutes: FastifyPluginAsync<ImportRouteOptions> = async (
  fastify,
  opts
) => {
  const adapter = opts.adapter ?? new Crm5TargetAdapter();
  const authEnabled = opts.authEnabled ?? true;

  // POST /import/row (and POST /import)
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

    // Multi-tenant boundary check
    if (authEnabled && request.user) {
      const payloadTenant = (input.data['tenant_id'] || input.data['tenantId']) as string | undefined;
      assertTenantIsolation(request.user as AuthenticatedUser, payloadTenant, request);
    }

    const alreadyExists = adapter.getReceiptByKey(input.idempotencyKey) !== undefined;

    // 3. Delegate to Crm5TargetAdapter
    const result = await adapter.importRow(
      input.batchId,
      input.sourceRow,
      input.idempotencyKey,
      input,
      { simulate503: simulate503Header }
    );

    if (result.ok) {
      const statusCode = alreadyExists ? 200 : 201;

      return reply.status(statusCode).send(redactSensitiveObject({
        targetId: result.value.targetId,
        version: 1,
        outcome: result.value.receipt.kind,
        receipt: result.value.receipt,
        isExisting: alreadyExists,
      }));
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

  fastify.post('/import/row', {
    preHandler: endpointPreHandlers(fastify, CRM5_ENDPOINT_ROLES.IMPORT_ROW, authEnabled),
  }, handleImportRow);

  fastify.post('/import', {
    preHandler: endpointPreHandlers(fastify, CRM5_ENDPOINT_ROLES.IMPORT_ROW, authEnabled),
  }, handleImportRow);

  // GET /import/receipts - List durable receipts for auditing
  fastify.get('/import/receipts', {
    preHandler: endpointPreHandlers(fastify, CRM5_ENDPOINT_ROLES.IMPORT_RECEIPTS, authEnabled),
  }, async (_request, reply) => {
    const receipts = adapter.getReceipts();
    return reply.status(200).send(redactSensitiveObject({
      items: receipts,
      total: receipts.length,
    }));
  });
};
