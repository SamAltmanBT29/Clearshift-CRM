import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import {
  RunsQuerySchema,
  ScoresQuerySchema,
  RejectsQuerySchema,
  CreateRunInputSchema,
  CreateScoreInputSchema,
  CreateReconciliationInputSchema,
  CreateRejectInputSchema,
  DetectDuplicatesInputSchema,
  ResolveDuplicateInputSchema,
  ExecuteBatchLoadInputSchema,
  UpdateRunInputSchema,
} from '@clearshift/contracts';
import type { RoleType } from '@cs/identity';
import { ControlCenterService } from '../services/control-center.service.js';
import { Crm5AuditService, crm5Audit } from '../services/audit.js';
import { CRM5_ENDPOINT_ROLES } from '../policies/roles.js';
import { redactSensitiveObject } from '../policies/masking.js';
import { requireRoles, assertTenantIsolation, assertRecordOwnership, type AuthenticatedUser } from '../plugins/auth.js';
import {
  DomainValidationError,
  DomainConflictError,
  AutoMergeForbiddenError,
  DuplicateCandidateNotFoundError,
} from '../domain/errors.js';

export interface ControlCenterRouteOptions {
  service?: ControlCenterService | undefined;
  auditService?: Crm5AuditService | undefined;
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
 * Fastify Routes for CRM-5 Migration Control Center & Reports
 * Base Prefix: /api/v1/crm-control
 * Strictly enforces SDS role permissions matrix and append-only audit trails.
 */
export const controlCenterRoutes: FastifyPluginAsync<ControlCenterRouteOptions> = async (
  fastify,
  opts
) => {
  const service = opts.service ?? new ControlCenterService();
  const auditService = opts.auditService ?? crm5Audit;
  const authEnabled = opts.authEnabled ?? true;

  // Health check (public probe)
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      module: 'crm-5',
      name: 'Migration Control Center and Reports',
      version: '1.0.0',
    };
  });

  // 1. GET /runs
  fastify.get('/runs', {
    preHandler: endpointPreHandlers(fastify, CRM5_ENDPOINT_ROLES.RUNS_LIST, authEnabled),
  }, async (request, reply) => {
    const parsed = RunsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid query parameters',
          details: parsed.error.issues,
        },
      });
    }

    const result = service.getRuns(parsed.data);
    return reply.status(200).send(redactSensitiveObject(result));
  });

  // 1a. GET /runs/:id - Get specific migration run projection
  fastify.get<{ Params: { id: string } }>('/runs/:id', {
    preHandler: endpointPreHandlers(fastify, CRM5_ENDPOINT_ROLES.RUNS_READ, authEnabled),
  }, async (request, reply) => {
    const { id } = request.params;
    if (!id || id.trim().length === 0) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Run ID is required',
        },
      });
    }

    const run = service.getRunById(id);
    if (!run) {
      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Migration run with ID '${id}' could not be located`,
        },
      });
    }

    return reply.status(200).send(redactSensitiveObject(run));
  });

  // 1b. PATCH /runs/:id - Update allowlisted fields on migration run projection
  fastify.patch<{ Params: { id: string } }>('/runs/:id', {
    preHandler: endpointPreHandlers(fastify, CRM5_ENDPOINT_ROLES.RUNS_UPDATE, authEnabled),
  }, async (request, reply) => {
    const { id } = request.params;
    const actor = (request.user as any)?.sub || 'system';

    const parsed = UpdateRunInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Validation failed for update run payload',
          details: parsed.error.issues,
        },
      });
    }

    try {
      const updated = service.updateRun(id, parsed.data);

      await auditService.logEvent({
        actor,
        action: 'crm5.run.updated',
        entity: 'run_projection',
        entityId: id,
        batchId: updated.batchId,
        result: 'success',
        diff: {
          updatedFields: Object.keys(parsed.data),
          status: updated.status,
        },
      });

      return reply.status(200).send(redactSensitiveObject(updated));
    } catch (err: unknown) {
      if (err instanceof DomainConflictError) {
        return reply.status(409).send({
          error: {
            code: 'CONCURRENT_MODIFICATION',
            message: err.message,
            details: err.details,
          },
        });
      }
      if (err instanceof DomainValidationError) {
        if (err.message.includes('not found')) {
          return reply.status(404).send({
            error: {
              code: 'NOT_FOUND',
              message: err.message,
            },
          });
        }
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: err.message,
            details: err.details,
          },
        });
      }
      throw err;
    }
  });

  // 2. GET /scores
  fastify.get('/scores', {
    preHandler: endpointPreHandlers(fastify, CRM5_ENDPOINT_ROLES.SCORES_LIST, authEnabled),
  }, async (request, reply) => {
    const parsed = ScoresQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid query parameters',
          details: parsed.error.issues,
        },
      });
    }

    const result = service.getScores(parsed.data);
    return reply.status(200).send(redactSensitiveObject(result));
  });

  // 3. GET /rejects
  fastify.get('/rejects', {
    preHandler: endpointPreHandlers(fastify, CRM5_ENDPOINT_ROLES.REJECTS_LIST, authEnabled),
  }, async (request, reply) => {
    const parsed = RejectsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid query parameters',
          details: parsed.error.issues,
        },
      });
    }

    const result = service.getRejects(parsed.data);
    return reply.status(200).send(redactSensitiveObject(result));
  });

  // 4. GET /reconciliation/:batch
  fastify.get<{ Params: { batch: string } }>('/reconciliation/:batch', {
    preHandler: endpointPreHandlers(fastify, CRM5_ENDPOINT_ROLES.RECONCILIATION_READ, authEnabled),
  }, async (request, reply) => {
    const batchId = request.params.batch;
    if (!batchId || batchId.trim().length === 0) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Batch identifier is required',
        },
      });
    }

    const report = service.getReconciliation(batchId);
    if (!report) {
      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Reconciliation report not found for batch '${batchId}'`,
        },
      });
    }

    return reply.status(200).send(redactSensitiveObject(report));
  });

  // 5. GET /batches/:batch - Aggregated batch summary & read-model consistency
  fastify.get<{ Params: { batch: string } }>('/batches/:batch', {
    preHandler: endpointPreHandlers(fastify, CRM5_ENDPOINT_ROLES.BATCH_SUMMARY, authEnabled),
  }, async (request, reply) => {
    const batchId = request.params.batch;
    if (!batchId || batchId.trim().length === 0) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Batch identifier is required',
        },
      });
    }

    const summary = service.getBatchSummary(batchId);
    if (!summary) {
      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Batch summary not found for batch '${batchId}'`,
        },
      });
    }

    return reply.status(200).send(redactSensitiveObject(summary));
  });

  // ---------------------------------------------------------------------------
  // Mutation API Endpoints (POST /runs, /scores, /reconciliation, /rejects)
  // ---------------------------------------------------------------------------

  // 6. POST /runs - Ingest/update run projection
  fastify.post('/runs', {
    preHandler: endpointPreHandlers(fastify, CRM5_ENDPOINT_ROLES.RUNS_CREATE, authEnabled),
  }, async (request, reply) => {
    const parsed = CreateRunInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid run payload',
          details: parsed.error.issues,
        },
      });
    }

    if (authEnabled && request.user) {
      const payloadTenant = (parsed.data.metadata?.['tenant_id'] || parsed.data.metadata?.['tenantId']) as string | undefined;
      assertTenantIsolation(request.user as AuthenticatedUser, payloadTenant, request);
    }

    try {
      const result = service.recordRun(parsed.data);
      const statusCode = result.isDuplicate ? 200 : 201;

      await auditService.logEvent({
        actor: (request.user as any)?.sub || 'system',
        action: 'crm5.run.recorded',
        entity: 'run_projection',
        entityId: result.run.id,
        batchId: result.run.batchId,
        result: 'success',
        diff: result.run as unknown as Record<string, unknown>,
      });

      return reply.status(statusCode).send(redactSensitiveObject(result.run));
    } catch (err: unknown) {
      if (err instanceof DomainValidationError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      if (err instanceof DomainConflictError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      throw err;
    }
  });

  // 7. POST /scores - Ingest quality score
  fastify.post('/scores', {
    preHandler: endpointPreHandlers(fastify, CRM5_ENDPOINT_ROLES.SCORES_CREATE, authEnabled),
  }, async (request, reply) => {
    const parsed = CreateScoreInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid quality score payload',
          details: parsed.error.issues,
        },
      });
    }

    try {
      const result = service.recordScore(parsed.data);
      const statusCode = result.isDuplicate ? 200 : 201;

      await auditService.logEvent({
        actor: (request.user as any)?.sub || 'system',
        action: 'crm5.score.recorded',
        entity: 'quality_score',
        entityId: result.score.id,
        batchId: result.score.batchId,
        result: 'success',
        diff: result.score as unknown as Record<string, unknown>,
      });

      return reply.status(statusCode).send(redactSensitiveObject(result.score));
    } catch (err: unknown) {
      if (err instanceof DomainValidationError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      if (err instanceof DomainConflictError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      throw err;
    }
  });

  // 8. POST /reconciliation - Ingest/audit reconciliation report
  fastify.post('/reconciliation', {
    preHandler: endpointPreHandlers(fastify, CRM5_ENDPOINT_ROLES.RECONCILIATION_CREATE, authEnabled),
  }, async (request, reply) => {
    const parsed = CreateReconciliationInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid reconciliation payload',
          details: parsed.error.issues,
        },
      });
    }

    try {
      const result = service.recordReconciliation(parsed.data);
      const statusCode = result.isDuplicate ? 200 : 201;

      await auditService.logEvent({
        actor: (request.user as any)?.sub || 'system',
        action: 'crm5.reconciliation.recorded',
        entity: 'reconciliation_report',
        entityId: result.report.id,
        batchId: result.report.batchId,
        result: 'success',
        diff: result.report as unknown as Record<string, unknown>,
      });

      return reply.status(statusCode).send(redactSensitiveObject(result.report));
    } catch (err: unknown) {
      if (err instanceof DomainValidationError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      if (err instanceof DomainConflictError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      throw err;
    }
  });

  // 9. POST /rejects - Ingest rejection audit record
  fastify.post('/rejects', {
    preHandler: endpointPreHandlers(fastify, CRM5_ENDPOINT_ROLES.REJECTS_CREATE, authEnabled),
  }, async (request, reply) => {
    const parsed = CreateRejectInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid rejection payload',
          details: parsed.error.issues,
        },
      });
    }

    try {
      const result = service.recordReject(parsed.data);
      const statusCode = result.isDuplicate ? 200 : 201;

      await auditService.logEvent({
        actor: (request.user as any)?.sub || 'system',
        action: 'crm5.reject.recorded',
        entity: 'reject_projection',
        entityId: result.reject.id,
        batchId: result.reject.batchId,
        result: 'success',
        diff: result.reject as unknown as Record<string, unknown>,
      });

      return reply.status(statusCode).send(redactSensitiveObject(result.reject));
    } catch (err: unknown) {
      if (err instanceof DomainValidationError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      if (err instanceof DomainConflictError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      throw err;
    }
  });

  // 10. POST /duplicates/detect - Detect exact duplicate candidates
  fastify.post('/duplicates/detect', {
    preHandler: endpointPreHandlers(fastify, CRM5_ENDPOINT_ROLES.DUPLICATES_DETECT, authEnabled),
  }, async (request, reply) => {
    const parsed = DetectDuplicatesInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid duplicate detection payload',
          details: parsed.error.issues,
        },
      });
    }

    try {
      const result = service.detectDuplicates(parsed.data);
      return reply.status(200).send(redactSensitiveObject(result));
    } catch (err: unknown) {
      if (err instanceof AutoMergeForbiddenError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      throw err;
    }
  });

  // 11. GET /duplicates/held - List duplicate candidates held for human review
  fastify.get<{ Querystring: { batchId?: string; keyType?: string } }>(
    '/duplicates/held',
    {
      preHandler: endpointPreHandlers(fastify, CRM5_ENDPOINT_ROLES.DUPLICATES_HELD, authEnabled),
    },
    async (request, reply) => {
      const items = service.getHeldDuplicates(request.query);
      return reply.status(200).send(redactSensitiveObject({
        items,
        total: items.length,
      }));
    }
  );

  // 12. POST /duplicates/resolve - Record human merge decision with audit trail
  fastify.post('/duplicates/resolve', {
    preHandler: endpointPreHandlers(fastify, CRM5_ENDPOINT_ROLES.DUPLICATES_RESOLVE, authEnabled),
  }, async (request, reply) => {
    const parsed = ResolveDuplicateInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid duplicate resolution payload',
          details: parsed.error.issues,
        },
      });
    }

    if (authEnabled && request.user) {
      assertTenantIsolation(request.user as AuthenticatedUser, undefined, request);
      assertRecordOwnership(request.user as AuthenticatedUser, parsed.data.actorId);
    }

    try {
      const audit = service.resolveDuplicate(parsed.data);

      await auditService.logEvent({
        actor: (request.user as any)?.sub || parsed.data.actorId || 'system',
        action: 'crm5.duplicate.resolved',
        entity: 'duplicate_candidate',
        entityId: parsed.data.candidateId,
        batchId: (audit.metadata?.['batchId'] as string) || undefined,
        result: 'success',
        diff: {
          decision: parsed.data.decision,
          keptId: parsed.data.keptId,
          mergedId: parsed.data.mergedId,
          reason: parsed.data.reason,
        },
      });

      return reply.status(200).send(redactSensitiveObject({
        status: 'resolved',
        audit,
      }));
    } catch (err: unknown) {
      if (err instanceof DuplicateCandidateNotFoundError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
          },
        });
      }
      if (err instanceof DomainValidationError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      throw err;
    }
  });

  // 13. GET /duplicates/audit - Query duplicate resolution audit logs
  fastify.get<{
    Querystring: {
      candidateId?: string;
      actorId?: string;
      page?: number;
      pageSize?: number;
    };
  }>('/duplicates/audit', {
    preHandler: endpointPreHandlers(fastify, CRM5_ENDPOINT_ROLES.DUPLICATES_AUDIT, authEnabled),
  }, async (request, reply) => {
    const logs = service.getDuplicateAuditLogs(request.query);
    return reply.status(200).send(redactSensitiveObject(logs));
  });

  // 14. POST /batches/execute-load - Execute chunked batch load with bounded retries & stop threshold
  fastify.post('/batches/execute-load', {
    preHandler: endpointPreHandlers(fastify, CRM5_ENDPOINT_ROLES.BATCH_EXECUTE_LOAD, authEnabled),
  }, async (request, reply) => {
    const parsed = ExecuteBatchLoadInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid batch load execution payload',
          details: parsed.error.issues,
        },
      });
    }

    if (authEnabled && request.user) {
      assertTenantIsolation(request.user as AuthenticatedUser, undefined, request);
    }

    try {
      const report = await service.executeBatchLoad(parsed.data);

      await auditService.logEvent({
        actor: (request.user as any)?.sub || 'system',
        action: 'crm5.batch.load_executed',
        entity: 'batch_load',
        batchId: parsed.data.batchId,
        result: report.status === 'COMPLETED' ? 'success' : 'halted',
        diff: {
          totalRecords: report.totalRecords,
          committedRecords: report.committedRecords,
          failedRecords: report.failedRecords,
          status: report.status,
        },
      });

      return reply.status(200).send(redactSensitiveObject(report));
    } catch (err: unknown) {
      if (err instanceof DomainValidationError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
      }
      throw err;
    }
  });
};
