import type { FastifyPluginAsync, FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  DealsQuerySchema,
  CreateDealInputSchema,
  UpdateDealInputSchema,
  QuotesQuerySchema,
  CreateQuoteInputSchema,
  UpdateQuoteInputSchema,
  Crm2ImportRowSchema,
  type Crm2ImportRow,
  Crm2ExecuteBatchLoadInputSchema,
  Crm2DetectDuplicatesInputSchema,
  Crm2ResolveDuplicateInputSchema,
  Crm2EvaluateDealDuplicateInputSchema,
  Crm2EvaluateQuoteDuplicateInputSchema,
} from '@clearshift/contracts';
import { AppError } from '@cs/kernel';
import type { RoleType } from '@cs/identity';
import { crm2Service, Crm2Service } from '../services/crm2.service.js';
import { CRM2_ENDPOINT_ROLES } from '../policies/roles.js';
import { requireRoles } from '../plugins/auth.js';
import {
  DomainValidationError,
  IdempotencyKeyReusedError,
  IdempotencyConflictError,
  DuplicateRecordError,
  ReferenceNotFoundError,
  AutoMergeForbiddenError,
  DuplicateCandidateNotFoundError,
} from '../domain/errors.js';
import { Crm2TargetAdapter } from '../migration/target-adapter.js';

export interface Crm2RoutesOptions {
  service?: Crm2Service | undefined;
  adapter?: Crm2TargetAdapter | undefined;
  authEnabled?: boolean | undefined;
  enforceAuth?: boolean | undefined;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

function getCorrelationId(request: FastifyRequest): string {
  return (
    (request.headers['x-correlation-id'] as string) ||
    (request.headers['correlation-id'] as string) ||
    `corr-${Date.now()}-${randomUUID().slice(0, 8)}`
  );
}

function endpointPreHandlers(
  fastify: FastifyInstance,
  allowedRoles: readonly RoleType[],
  authEnabled: boolean = true
) {
  if (!authEnabled || !fastify.authenticate) return [];
  return [fastify.authenticate, requireRoles(allowedRoles)];
}

/**
 * Fastify routes plugin for CRM-2 Deals, Pipeline and Quotes
 * Route prefix: /api/v1/crm-deals
 * Strictly enforces SDS V1 mutations, idempotency, role-based auth, and error contracts.
 */
export const crm2Routes: FastifyPluginAsync<Crm2RoutesOptions> = async (
  fastify,
  opts
) => {
  const service = opts.service ?? crm2Service;
  const adapter = opts.adapter ?? new Crm2TargetAdapter(service);
  const authEnabled = opts.enforceAuth ?? opts.authEnabled ?? true;

  // Safe global error handler for CRM-2: never leak SQL, secrets, or stack traces
  fastify.setErrorHandler((error, request, reply) => {
    const correlation_id = getCorrelationId(request);

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        details: error.details,
        correlation_id,
      });
    }

    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode && err.statusCode >= 400 && err.statusCode < 500
      ? err.statusCode
      : 500;

    if (statusCode === 500) {
      return reply.status(500).send({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
        details: [],
        correlation_id,
      });
    }

    return reply.status(statusCode).send({
      code: 'BAD_REQUEST',
      message: err.message || 'Request could not be processed',
      details: [],
      correlation_id,
    });
  });

  // ---------------------------------------------------------------------------
  // 0. GET /health (Public probe)
  // ---------------------------------------------------------------------------
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      module: 'crm-2',
      name: 'CRM-2 Deals, Pipeline and Quotes',
      version: '1.0.0',
    };
  });

  // ---------------------------------------------------------------------------
  // 1. GET /stages
  // ---------------------------------------------------------------------------
  fastify.get('/stages', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.STAGES_LIST, authEnabled),
  }, async (_request, reply) => {
    const stages = await service.getStages();
    return reply.status(200).send({ items: stages });
  });

  // ---------------------------------------------------------------------------
  // 2. GET /deals (search/filter by stage, bounded pagination)
  // ---------------------------------------------------------------------------
  fastify.get('/deals', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.DEALS_LIST, authEnabled),
  }, async (request, reply) => {
    const parseResult = DealsQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        code: 'INVALID_QUERY',
        message: 'Invalid query parameters',
        details: parseResult.error.issues,
        correlation_id: getCorrelationId(request),
      });
    }

    const result = await service.getDeals(parseResult.data);
    return reply.status(200).send(result);
  });

  // ---------------------------------------------------------------------------
  // 3. GET /deals/:id
  // ---------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>('/deals/:id', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.DEALS_READ, authEnabled),
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidUuid(id)) {
      return reply.status(400).send({
        code: 'BAD_REQUEST',
        message: `Invalid deal ID format: '${id}' is not a valid UUID`,
        details: [],
        correlation_id: getCorrelationId(request),
      });
    }

    const deal = await service.getDealById(id);
    if (!deal) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: `Deal with ID '${id}' not found`,
        details: [],
        correlation_id: getCorrelationId(request),
      });
    }

    return reply.status(200).send(deal);
  });

  // ---------------------------------------------------------------------------
  // 4. POST /deals
  // ---------------------------------------------------------------------------
  fastify.post('/deals', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.DEALS_CREATE, authEnabled),
  }, async (request, reply) => {
    const parse = CreateDealInputSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid deal input',
        details: parse.error.issues,
        correlation_id: getCorrelationId(request),
      });
    }

    try {
      const created = await service.createDeal(parse.data);
      return reply.status(201).send(created);
    } catch (err: any) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({
          code: err.code,
          message: err.message,
          details: err.details,
          correlation_id: getCorrelationId(request),
        });
      }
      throw err;
    }
  });

  // ---------------------------------------------------------------------------
  // 5. PATCH /deals/:id
  // ---------------------------------------------------------------------------
  fastify.patch<{ Params: { id: string } }>('/deals/:id', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.DEALS_UPDATE, authEnabled),
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidUuid(id)) {
      return reply.status(400).send({
        code: 'BAD_REQUEST',
        message: `Invalid deal ID format: '${id}' is not a valid UUID`,
        details: [],
        correlation_id: getCorrelationId(request),
      });
    }

    const parse = UpdateDealInputSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid update input',
        details: parse.error.issues,
        correlation_id: getCorrelationId(request),
      });
    }

    try {
      const updated = await service.updateDeal(id, parse.data);
      return reply.status(200).send(updated);
    } catch (err: any) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({
          code: err.code,
          message: err.message,
          details: err.details,
          correlation_id: getCorrelationId(request),
        });
      }
      throw err;
    }
  });

  // ---------------------------------------------------------------------------
  // 6. GET /quotes
  // ---------------------------------------------------------------------------
  fastify.get('/quotes', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.QUOTES_LIST, authEnabled),
  }, async (request, reply) => {
    const parse = QuotesQuerySchema.safeParse(request.query);
    if (!parse.success) {
      return reply.status(400).send({
        code: 'INVALID_QUERY',
        message: 'Invalid query parameters',
        details: parse.error.issues,
        correlation_id: getCorrelationId(request),
      });
    }

    const result = await service.getQuotes(parse.data);
    return reply.status(200).send(result);
  });

  // ---------------------------------------------------------------------------
  // 7. GET /quotes/:id
  // ---------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>('/quotes/:id', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.QUOTES_READ, authEnabled),
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidUuid(id)) {
      return reply.status(400).send({
        code: 'BAD_REQUEST',
        message: `Invalid quote ID format: '${id}' is not a valid UUID`,
        details: [],
        correlation_id: getCorrelationId(request),
      });
    }

    const quote = await service.getQuoteById(id);
    if (!quote) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: `Quote with ID '${id}' not found`,
        details: [],
        correlation_id: getCorrelationId(request),
      });
    }

    return reply.status(200).send(quote);
  });

  // ---------------------------------------------------------------------------
  // 8. POST /quotes
  // ---------------------------------------------------------------------------
  fastify.post('/quotes', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.QUOTES_CREATE, authEnabled),
  }, async (request, reply) => {
    const parse = CreateQuoteInputSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid quote input',
        details: parse.error.issues,
        correlation_id: getCorrelationId(request),
      });
    }

    try {
      const created = await service.createQuote(parse.data);
      return reply.status(201).send(created);
    } catch (err: any) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({
          code: err.code,
          message: err.message,
          details: err.details,
          correlation_id: getCorrelationId(request),
        });
      }
      throw err;
    }
  });

  // ---------------------------------------------------------------------------
  // 9. PATCH /quotes/:id
  // ---------------------------------------------------------------------------
  fastify.patch<{ Params: { id: string } }>('/quotes/:id', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.QUOTES_UPDATE, authEnabled),
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidUuid(id)) {
      return reply.status(400).send({
        code: 'BAD_REQUEST',
        message: `Invalid quote ID format: '${id}' is not a valid UUID`,
        details: [],
        correlation_id: getCorrelationId(request),
      });
    }

    const parse = UpdateQuoteInputSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid quote update',
        details: parse.error.issues,
        correlation_id: getCorrelationId(request),
      });
    }

    try {
      const updated = await service.updateQuote(id, parse.data);
      return reply.status(200).send(updated);
    } catch (err: any) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({
          code: err.code,
          message: err.message,
          details: err.details,
          correlation_id: getCorrelationId(request),
        });
      }
      throw err;
    }
  });

  // ---------------------------------------------------------------------------
  // 10. POST /import, POST /import/row and POST /import/batch (Migration Kit Target Adapter)
  // ---------------------------------------------------------------------------
  const handleImport = async (request: FastifyRequest, reply: any) => {
    const headerKey = (request.headers['idempotency-key'] || request.headers['idempotency_key']) as string | undefined;
    const body = (request.body && typeof request.body === 'object') ? (request.body as Record<string, unknown>) : {};
    const idempotencyKey = headerKey ?? (body['idempotencyKey'] as string | undefined) ?? (body['idempotency_key'] as string | undefined);
    const simulate503 = request.headers['x-simulate-503'] === 'true';

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      return reply.status(400).send({
        code: 'BAD_REQUEST',
        message: 'Missing required Idempotency-Key header or field',
        details: [{ field: 'idempotencyKey', message: 'Idempotency key is required' }],
        correlation_id: getCorrelationId(request),
        error: {
          code: 'BAD_REQUEST',
          message: 'Missing required Idempotency-Key header or field',
          details: [{ field: 'idempotencyKey', message: 'Idempotency key is required' }],
        },
      });
    }

    const payloadToValidate = {
      ...body,
      batchId: body['batchId'] ?? body['batch_id'],
      sourceRow: body['sourceRow'] ?? body['source_row'],
      sourceSystem: body['sourceSystem'] ?? body['source_system'] ?? 'kit_import',
      idempotencyKey,
    };

    const parsed = Crm2ImportRowSchema.safeParse(payloadToValidate);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid import row payload',
        details: parsed.error.issues,
        correlation_id: getCorrelationId(request),
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid import row payload',
          details: parsed.error.issues,
        },
      });
    }

    const alreadyExists =
      adapter.getReceiptByKey(idempotencyKey) !== undefined ||
      service.getReceiptByKey(idempotencyKey) !== undefined;

    const result = await adapter.importRow(
      parsed.data.batchId,
      parsed.data.sourceRow,
      idempotencyKey,
      parsed.data,
      { simulate503 }
    );

    if (result.ok) {
      const statusCode = alreadyExists ? 200 : 201;

      return reply.status(statusCode).send({
        targetId: result.value.targetId,
        version: 1,
        outcome: result.value.receipt.kind,
        receipt: result.value.receipt,
        isExisting: alreadyExists,
        correlation_id: getCorrelationId(request),
      });
    }

    const err = result.error;
    if (err.reasonCode === 'IDEMPOTENCY_CONFLICT') {
      return reply.status(409).send({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: err.message,
        details: [{ field: 'idempotencyKey', message: err.message, code: 'idempotency_conflict' }],
        correlation_id: getCorrelationId(request),
        error: {
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: err.message,
          details: [{ field: 'idempotencyKey', message: err.message, code: 'idempotency_conflict' }],
        },
      });
    }

    if (err.reasonCode === 'SERVICE_UNAVAILABLE') {
      return reply.status(503).send({
        code: 'SERVICE_UNAVAILABLE',
        message: err.message,
        details: [],
        retryable: true,
        correlation_id: getCorrelationId(request),
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: err.message,
          details: [],
          retryable: true,
        },
      });
    }

    return reply.status(422).send({
      code: err.reasonCode,
      message: err.message,
      details: err.field ? [{ field: err.field, message: err.message }] : [],
      correlation_id: getCorrelationId(request),
      error: {
        code: err.reasonCode,
        message: err.message,
        details: err.field ? [{ field: err.field, message: err.message }] : [],
      },
    });
  };

  fastify.post('/import', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.IMPORT_WRITE, authEnabled),
  }, handleImport);

  fastify.post('/import/row', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.IMPORT_WRITE, authEnabled),
  }, handleImport);

  // ---------------------------------------------------------------------------
  // 11b. POST /batches/execute-load and POST /import/batch (CRM2-13 Batch Loading)
  // ---------------------------------------------------------------------------
  const handleExecuteBatchLoad = async (request: FastifyRequest, reply: any) => {
    const correlation_id = getCorrelationId(request);
    const body = (request.body && typeof request.body === 'object') ? (request.body as Record<string, unknown>) : {};

    const parsed = Crm2ExecuteBatchLoadInputSchema.safeParse(body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid batch load input',
        details: parsed.error.issues,
        correlation_id,
      });
    }

    try {
      const report = await service.executeBatchLoad(parsed.data);
      return reply.status(200).send({
        ...report,
        correlation_id,
      });
    } catch (err: any) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({
          code: err.code,
          message: err.message,
          details: err.details,
          correlation_id,
        });
      }
      throw err;
    }
  };

  // POST /import/batch (KIT-08 batch loading interface & CRM2-13 alias)
  fastify.post('/import/batch', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.IMPORT_WRITE, authEnabled),
  }, async (request: FastifyRequest, reply: any) => {
    const body = (request.body && typeof request.body === 'object') ? (request.body as Record<string, unknown>) : {};

    // Support CRM2-13 records batch load payload via alias
    if (body['records'] && Array.isArray(body['records'])) {
      return handleExecuteBatchLoad(request, reply);
    }

    const batchId = (body['batchId'] ?? body['batch_id'] ?? randomUUID()) as string;
    const rows = body['rows'];

    if (!Array.isArray(rows)) {
      return reply.status(400).send({
        code: 'BAD_REQUEST',
        message: 'Missing or invalid rows array in batch import payload',
        details: [{ field: 'rows', message: 'rows array is required' }],
        correlation_id: getCorrelationId(request),
        error: {
          code: 'BAD_REQUEST',
          message: 'Missing or invalid rows array in batch import payload',
          details: [{ field: 'rows', message: 'rows array is required' }],
        },
      });
    }

    const result = await adapter.loadBatch(batchId, rows, {
      simulate503: request.headers['x-simulate-503'] === 'true',
    });

    if (!result.ok) {
      return reply.status(400).send({
        code: result.error.reasonCode,
        message: result.error.message,
        correlation_id: getCorrelationId(request),
        error: {
          code: result.error.reasonCode,
          message: result.error.message,
        },
      });
    }

    return reply.status(200).send({
      batchId,
      loadedCount: result.value.loaded.length,
      rejectedCount: result.value.errors.length,
      loaded: result.value.loaded,
      errors: result.value.errors,
      correlation_id: getCorrelationId(request),
    });
  });

  // ---------------------------------------------------------------------------
  // 11. GET /import/receipts & GET /import/receipts/:idempotencyKey
  // ---------------------------------------------------------------------------
  fastify.get('/import/receipts', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.IMPORT_RECEIPTS, authEnabled),
  }, async (request, reply) => {
    const receipts = adapter.getReceipts().length > 0 ? adapter.getReceipts() : service.getReceipts();
    return reply.status(200).send({
      items: receipts,
      total: receipts.length,
      correlation_id: getCorrelationId(request),
    });
  });

  fastify.get<{ Params: { idempotencyKey: string } }>('/import/receipts/:idempotencyKey', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.IMPORT_RECEIPTS, authEnabled),
  }, async (request, reply) => {
    const { idempotencyKey } = request.params;
    const receipt = adapter.getReceiptByKey(idempotencyKey) || service.getReceiptByKey(idempotencyKey);
    if (!receipt) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: `Receipt with idempotency key '${idempotencyKey}' not found`,
        details: [],
        correlation_id: getCorrelationId(request),
        error: {
          code: 'NOT_FOUND',
          message: `Receipt with idempotency key '${idempotencyKey}' not found`,
          details: [],
        },
      });
    }
    return reply.status(200).send({
      ...receipt,
      correlation_id: getCorrelationId(request),
    });
  });

  fastify.post('/batches/execute-load', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.IMPORT_WRITE, authEnabled),
  }, handleExecuteBatchLoad);

  fastify.get<{ Params: { batchId: string } }>('/batches/:batchId/report', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.IMPORT_RECEIPTS, authEnabled),
  }, async (request, reply) => {
    const report = service.getBatchReport(request.params.batchId);
    if (!report) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: `Batch report for batch '${request.params.batchId}' not found`,
        details: [],
        correlation_id: getCorrelationId(request),
      });
    }

    return reply.status(200).send({
      ...report,
      correlation_id: getCorrelationId(request),
    });
  });

  // ---------------------------------------------------------------------------
  // 12. Projections & Reports
  // ---------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>('/deals/:id/summary', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.DEALS_READ, authEnabled),
  }, async (request, reply) => {
    try {
      const summary = await service.getDealDerivedTotals(request.params.id);
      return reply.status(200).send(summary);
    } catch (err: any) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({
          code: err.code,
          message: err.message,
          details: err.details,
          correlation_id: getCorrelationId(request),
        });
      }
      throw err;
    }
  });

  fastify.get('/pipeline/summary', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.DEALS_LIST, authEnabled),
  }, async (_request, reply) => {
    const summary = await service.getPipelineSummary();
    return reply.status(200).send(summary);
  });

  // ---------------------------------------------------------------------------
  // 13. Exact Duplicate Key Policy & Human Review Endpoints (CRM2-12 / KIT-10)
  // ---------------------------------------------------------------------------

  // 13.1 POST /duplicates/detect - Detect exact duplicate candidates
  fastify.post('/duplicates/detect', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.DUPLICATES_DETECT, authEnabled),
  }, async (request, reply) => {
    const parsed = Crm2DetectDuplicatesInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid duplicate detection payload',
        details: parsed.error.issues,
        correlation_id: getCorrelationId(request),
      });
    }

    try {
      const result = service.detectDuplicates(parsed.data);
      return reply.status(200).send({
        ...result,
        correlation_id: getCorrelationId(request),
      });
    } catch (err: unknown) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({
          code: err.code,
          message: err.message,
          details: err.details,
          correlation_id: getCorrelationId(request),
        });
      }
      throw err;
    }
  });

  // 13.2 GET /duplicates/held - List duplicate candidates held for human review
  fastify.get<{
    Querystring: { batchId?: string; keyType?: string; entity?: string };
  }>('/duplicates/held', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.DUPLICATES_HELD, authEnabled),
  }, async (request, reply) => {
    const items = service.getHeldDuplicates(request.query);
    return reply.status(200).send({
      items,
      total: items.length,
      correlation_id: getCorrelationId(request),
    });
  });

  // 13.3 POST /duplicates/resolve - Record human merge decision with audit trail
  fastify.post('/duplicates/resolve', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.DUPLICATES_RESOLVE, authEnabled),
  }, async (request, reply) => {
    const parsed = Crm2ResolveDuplicateInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid duplicate resolution payload',
        details: parsed.error.issues,
        correlation_id: getCorrelationId(request),
      });
    }

    try {
      const audit = service.resolveDuplicate(parsed.data);
      return reply.status(200).send({
        status: 'resolved',
        audit,
        correlation_id: getCorrelationId(request),
      });
    } catch (err: unknown) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({
          code: err.code,
          message: err.message,
          details: err.details,
          correlation_id: getCorrelationId(request),
        });
      }
      throw err;
    }
  });

  // 13.4 GET /duplicates/audit - Query duplicate resolution audit logs
  fastify.get<{
    Querystring: {
      candidateId?: string;
      actorId?: string;
      entity?: string;
      page?: number;
      pageSize?: number;
    };
  }>('/duplicates/audit', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.DUPLICATES_AUDIT, authEnabled),
  }, async (request, reply) => {
    const logs = service.getDuplicateAuditLogs(request.query);
    return reply.status(200).send({
      ...logs,
      correlation_id: getCorrelationId(request),
    });
  });

  // 13.5 POST /deals/evaluate-duplicate - Evaluate single deal candidate against pool
  fastify.post('/deals/evaluate-duplicate', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.DEALS_EVALUATE, authEnabled),
  }, async (request, reply) => {
    const parsed = Crm2EvaluateDealDuplicateInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid deal candidate payload',
        details: parsed.error.issues,
        correlation_id: getCorrelationId(request),
      });
    }

    const evaluation = service.evaluateDealDuplicate({
      id: parsed.data.id,
      name: parsed.data.name,
      stageId: parsed.data.stageId,
      contactId: parsed.data.contactId,
      value: parsed.data.value,
      currency: parsed.data.currency,
    });

    return reply.status(200).send({
      ...evaluation,
      correlation_id: getCorrelationId(request),
    });
  });

  // 13.6 POST /quotes/evaluate-duplicate - Evaluate single quote candidate against pool
  fastify.post('/quotes/evaluate-duplicate', {
    preHandler: endpointPreHandlers(fastify, CRM2_ENDPOINT_ROLES.QUOTES_EVALUATE, authEnabled),
  }, async (request, reply) => {
    const parsed = Crm2EvaluateQuoteDuplicateInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid quote candidate payload',
        details: parsed.error.issues,
        correlation_id: getCorrelationId(request),
      });
    }

    const evaluation = service.evaluateQuoteDuplicate({
      id: parsed.data.id,
      quoteNumber: parsed.data.quoteNumber,
      dealId: parsed.data.dealId,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
    });

    return reply.status(200).send({
      ...evaluation,
      correlation_id: getCorrelationId(request),
    });
  });
};
