import type { FastifyPluginAsync, FastifyRequest, FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  CRM4ListCreateSchema,
  CRM4ListPatchSchema,
  CRM4ListQuerySchema,
  CRM4CampaignCreateSchema,
  CRM4CampaignPatchSchema,
  CRM4CampaignQuerySchema,
  CRM4MemberCreateSchema,
  CRM4MemberQuerySchema,
  CRM4ConsentSetSchema,
} from '@clearshift/contracts';
import { AppError } from '@cs/kernel';
import { z } from 'zod';
import type { RoleType } from '@cs/identity';
import { Crm4Service, crm4Service } from '../services/crm4.service.js';
import { Crm4AuditService, crm4Audit } from '../services/audit.js';
import { crm4MappingService } from '../services/crm4-mapping.service.js';
import { CRM4_ENDPOINT_ROLES } from '../policies/roles.js';
import { requireRoles } from '../plugins/auth.js';
import { assertNoImmutableFieldMutation } from '../interface/authz.js';

export interface Crm4RouteOptions {
  service?: Crm4Service | undefined;
  auditService?: Crm4AuditService | undefined;
  authEnabled?: boolean | undefined;
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

export const crm4Routes: FastifyPluginAsync<Crm4RouteOptions> = async (
  fastify,
  opts
) => {
  const service = opts.service ?? crm4Service;
  const auditService = opts.auditService ?? crm4Audit;
  const authEnabled = opts.authEnabled ?? true;

  // =========================================================================
  // 1. Marketing Lists
  // =========================================================================

  // GET /lists
  fastify.get(
    '/lists',
    {
      preHandler: endpointPreHandlers(fastify, CRM4_ENDPOINT_ROLES.LISTS_LIST, authEnabled),
    },
    async (request, reply) => {
      const parsed = CRM4ListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 'Invalid query parameters', 400, parsed.error.issues);
      }
      const result = await service.getLists(parsed.data);
      return reply.send(result);
    }
  );

  // POST /lists
  fastify.post(
    '/lists',
    {
      preHandler: endpointPreHandlers(fastify, CRM4_ENDPOINT_ROLES.LISTS_CREATE, authEnabled),
    },
    async (request, reply) => {
      const parsed = CRM4ListCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 'Invalid list creation body', 400, parsed.error.issues);
      }
      const list = await service.createList(parsed.data);

      const actor = (request.user as any)?.sub || (request.user as any)?.userId || 'system';
      await auditService.logEvent({
        actor,
        action: 'crm4.list.created',
        entity: 'marketing_list',
        entityId: list.id,
        diff: { name: list.name, description: list.description },
      });

      return reply.status(201).send(list);
    }
  );

  // GET /lists/:id
  fastify.get(
    '/lists/:id',
    {
      preHandler: endpointPreHandlers(fastify, CRM4_ENDPOINT_ROLES.LISTS_READ, authEnabled),
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const list = await service.getListById(id);
      return reply.send(list);
    }
  );

  // PATCH /lists/:id
  fastify.patch(
    '/lists/:id',
    {
      preHandler: endpointPreHandlers(fastify, CRM4_ENDPOINT_ROLES.LISTS_UPDATE, authEnabled),
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (request.user) {
        assertNoImmutableFieldMutation(request.user as any, request.body as any, true);
      }
      const parsed = CRM4ListPatchSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 'Invalid list update body', 400, parsed.error.issues);
      }
      const updated = await service.patchList(id, parsed.data);

      const actor = (request.user as any)?.sub || (request.user as any)?.userId || 'system';
      await auditService.logEvent({
        actor,
        action: 'crm4.list.updated',
        entity: 'marketing_list',
        entityId: updated.id,
        diff: parsed.data,
      });

      return reply.send(updated);
    }
  );

  // =========================================================================
  // 2. Campaigns
  // =========================================================================

  // GET /campaigns
  fastify.get(
    '/campaigns',
    {
      preHandler: endpointPreHandlers(fastify, CRM4_ENDPOINT_ROLES.CAMPAIGNS_LIST, authEnabled),
    },
    async (request, reply) => {
      const parsed = CRM4CampaignQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 'Invalid query parameters', 400, parsed.error.issues);
      }
      const result = await service.getCampaigns(parsed.data);
      return reply.send(result);
    }
  );

  // POST /campaigns
  fastify.post(
    '/campaigns',
    {
      preHandler: endpointPreHandlers(fastify, CRM4_ENDPOINT_ROLES.CAMPAIGNS_CREATE, authEnabled),
    },
    async (request, reply) => {
      const parsed = CRM4CampaignCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 'Invalid campaign creation body', 400, parsed.error.issues);
      }
      const campaign = await service.createCampaign(parsed.data);

      const actor = (request.user as any)?.sub || (request.user as any)?.userId || 'system';
      await auditService.logEvent({
        actor,
        action: 'crm4.campaign.created',
        entity: 'campaign',
        entityId: campaign.id,
        diff: { name: campaign.name, campaignDate: campaign.campaignDate, listId: campaign.listId },
      });

      return reply.status(201).send(campaign);
    }
  );

  // GET /campaigns/:id
  fastify.get(
    '/campaigns/:id',
    {
      preHandler: endpointPreHandlers(fastify, CRM4_ENDPOINT_ROLES.CAMPAIGNS_READ, authEnabled),
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const campaign = await service.getCampaignById(id);
      return reply.send(campaign);
    }
  );

  // PATCH /campaigns/:id
  fastify.patch(
    '/campaigns/:id',
    {
      preHandler: endpointPreHandlers(fastify, CRM4_ENDPOINT_ROLES.CAMPAIGNS_UPDATE, authEnabled),
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (request.user) {
        assertNoImmutableFieldMutation(request.user as any, request.body as any, true);
      }
      const body = request.body as Record<string, unknown> | undefined;
      if (body && ('listId' in body || 'list_id' in body)) {
        throw new AppError('FORBIDDEN', "modification of immutable field 'listId' is strictly prohibited", 403);
      }
      const parsed = CRM4CampaignPatchSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 'Invalid campaign update body', 400, parsed.error.issues);
      }
      const updated = await service.patchCampaign(id, parsed.data);

      const actor = (request.user as any)?.sub || (request.user as any)?.userId || 'system';
      await auditService.logEvent({
        actor,
        action: 'crm4.campaign.updated',
        entity: 'campaign',
        entityId: updated.id,
        diff: parsed.data,
      });

      return reply.send(updated);
    }
  );

  // GET /campaigns/:id/export (CSV export)
  fastify.get(
    '/campaigns/:id/export',
    {
      preHandler: endpointPreHandlers(fastify, CRM4_ENDPOINT_ROLES.CAMPAIGNS_READ, authEnabled),
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const csv = await service.exportCampaignMembersCsv(id);

      const actor = (request.user as any)?.sub || (request.user as any)?.userId || 'system';
      await auditService.logEvent({
        actor,
        action: 'crm4.campaign.exported',
        entity: 'campaign',
        entityId: id,
        result: 'success',
      });

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="campaign-${id}-members.csv"`);
      return reply.send(csv);
    }
  );

  // =========================================================================
  // 3. Campaign Members
  // =========================================================================

  // GET /campaigns/:id/members
  fastify.get(
    '/campaigns/:id/members',
    {
      preHandler: endpointPreHandlers(fastify, CRM4_ENDPOINT_ROLES.MEMBERS_LIST, authEnabled),
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = CRM4MemberQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 'Invalid member query parameters', 400, parsed.error.issues);
      }
      const result = await service.getCampaignMembers(id, parsed.data);
      return reply.send(result);
    }
  );

  // POST /campaigns/:id/members
  fastify.post(
    '/campaigns/:id/members',
    {
      preHandler: endpointPreHandlers(fastify, CRM4_ENDPOINT_ROLES.MEMBERS_CREATE, authEnabled),
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = { ...(request.body as Record<string, unknown>), campaignId: id };
      const parsed = CRM4MemberCreateSchema.safeParse(body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 'Invalid member creation body', 400, parsed.error.issues);
      }
      const member = await service.addCampaignMember(parsed.data);

      const actor = (request.user as any)?.sub || (request.user as any)?.userId || 'system';
      await auditService.logEvent({
        actor,
        action: 'crm4.member.added',
        entity: 'campaign_member',
        entityId: member.id,
        diff: { campaignId: id, contactId: member.contactId, status: member.status },
      });

      return reply.status(201).send(member);
    }
  );

  // =========================================================================
  // 4. Consents & BR-CRM4-01
  // =========================================================================

  // POST /consents
  fastify.post(
    '/consents',
    {
      preHandler: endpointPreHandlers(fastify, CRM4_ENDPOINT_ROLES.CONSENTS_SET, authEnabled),
    },
    async (request, reply) => {
      const parsed = CRM4ConsentSetSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 'Invalid consent payload', 400, parsed.error.issues);
      }
      const consent = await service.setConsent(parsed.data);

      const actor = (request.user as any)?.sub || (request.user as any)?.userId || 'system';
      await auditService.logEvent({
        actor,
        action: 'crm4.consent.updated',
        entity: 'consent',
        entityId: consent.id,
        diff: { contactId: consent.contactId, status: consent.status, source: consent.source },
      });

      return reply.status(200).send(consent);
    }
  );

  // GET /consents/:contact
  fastify.get(
    '/consents/:contact',
    {
      preHandler: endpointPreHandlers(fastify, CRM4_ENDPOINT_ROLES.CONSENTS_READ, authEnabled),
    },
    async (request, reply) => {
      const { contact } = request.params as { contact: string };
      const consent = await service.getConsent(contact);
      return reply.send(consent);
    }
  );

  // =========================================================================
  // 5. Mapping Templates & Dry-Run Validation Endpoints (#181, [CRM4-28])
  // =========================================================================

  fastify.get(
    '/mappings/templates',
    {
      preHandler: endpointPreHandlers(fastify, CRM4_ENDPOINT_ROLES.MAPPINGS_READ, authEnabled),
    },
    async (request, reply) => {
      const QuerySchema = z.object({
        entity: z.enum(['crm4_lists', 'crm4_campaigns', 'crm4_members', 'crm4_consents']).optional(),
      });
      const parsed = QuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: 'Invalid entity filter for templates',
            details: parsed.error.issues,
          },
        });
      }

      const templates = crm4MappingService.listTemplates(parsed.data.entity);
      const enums = crm4MappingService.getEnumDictionaries();
      return reply.status(200).send({
        templates: templates.map((t) => ({
          ...t,
          checksum: crm4MappingService.getTemplate(t.id, t.version).checksum,
        })),
        enums,
      });
    }
  );

  fastify.get(
    '/mappings/templates/:id',
    {
      preHandler: endpointPreHandlers(fastify, CRM4_ENDPOINT_ROLES.MAPPINGS_READ, authEnabled),
    },
    async (request, reply) => {
      const ParamsSchema = z.object({ id: z.string().min(1) });
      const QuerySchema = z.object({ version: z.coerce.number().optional() });

      const pParsed = ParamsSchema.safeParse(request.params);
      const qParsed = QuerySchema.safeParse(request.query);
      if (!pParsed.success || !qParsed.success) {
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: 'Invalid template lookup parameters',
            details: [
              ...(!pParsed.success ? pParsed.error.issues : []),
              ...(!qParsed.success ? qParsed.error.issues : []),
            ],
          },
        });
      }

      try {
        const result = crm4MappingService.getTemplate(pParsed.data.id, qParsed.data.version);
        return reply.status(200).send(result);
      } catch (err: any) {
        if (err.code === 'TEMPLATE_NOT_FOUND') {
          return reply.status(404).send({
            error: {
              code: 'NOT_FOUND',
              message: err.message,
            },
          });
        }
        throw err;
      }
    }
  );

  fastify.post(
    '/mappings/validate',
    {
      preHandler: endpointPreHandlers(fastify, CRM4_ENDPOINT_ROLES.MAPPINGS_EXECUTE, authEnabled),
    },
    async (request, reply) => {
      const ValidateRequestSchema = z.object({
        templateId: z.string().min(1),
        sourceColumns: z.array(z.string().min(1)),
        version: z.number().optional(),
      });

      const parsed = ValidateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: 'Invalid mapping validation payload',
            details: parsed.error.issues,
          },
        });
      }

      try {
        const result = crm4MappingService.validateDryRun(
          parsed.data.templateId,
          parsed.data.sourceColumns,
          parsed.data.version
        );
        return reply.status(200).send(result);
      } catch (err: any) {
        if (err.code === 'TEMPLATE_NOT_FOUND') {
          return reply.status(404).send({
            error: {
              code: 'NOT_FOUND',
              message: err.message,
            },
          });
        }
        if (err.code === 'MAPPING_INCOMPLETE') {
          return reply.status(400).send({
            error: {
              code: 'MAPPING_INCOMPLETE',
              message: err.message,
              details: err.details,
            },
          });
        }
        throw err;
      }
    }
  );

  fastify.post(
    '/mappings/map',
    {
      preHandler: endpointPreHandlers(fastify, CRM4_ENDPOINT_ROLES.MAPPINGS_EXECUTE, authEnabled),
    },
    async (request, reply) => {
      const MapRequestSchema = z.object({
        templateId: z.string().min(1),
        rows: z.array(z.record(z.unknown())),
        version: z.number().optional(),
        sourceColumns: z.array(z.string()).optional(),
      });

      const parsed = MapRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: 'Invalid row mapping payload',
            details: parsed.error.issues,
          },
        });
      }

      try {
        const result = crm4MappingService.processBatchMapping(
          parsed.data.templateId,
          parsed.data.rows,
          {
            version: parsed.data.version,
            sourceColumns: parsed.data.sourceColumns,
          }
        );
        return reply.status(200).send(result);
      } catch (err: any) {
        if (err.code === 'TEMPLATE_NOT_FOUND') {
          return reply.status(404).send({
            error: {
              code: 'NOT_FOUND',
              message: err.message,
            },
          });
        }
        if (err.code === 'MAPPING_INCOMPLETE') {
          return reply.status(400).send({
            error: {
              code: 'MAPPING_INCOMPLETE',
              message: err.message,
              details: err.details,
            },
          });
        }
        throw err;
      }
    }
  );
};
