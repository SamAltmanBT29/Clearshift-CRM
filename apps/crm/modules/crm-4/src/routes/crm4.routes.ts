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
import type { RoleType } from '@cs/identity';
import { Crm4Service, crm4Service, type IdempotencyContext } from '../services/crm4.service.js';
import { Crm4AuditService, crm4Audit } from '../services/audit.js';
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

function extractIdempotencyContext(request: FastifyRequest): IdempotencyContext | undefined {
  const key =
    (request.headers['idempotency-key'] as string) ||
    (request.headers['x-idempotency-key'] as string) ||
    (typeof request.body === 'object' && request.body !== null && 'idempotencyKey' in request.body
      ? (request.body as any).idempotencyKey
      : undefined);

  if (!key) return undefined;

  const batchId =
    (request.headers['x-batch-id'] as string) ||
    (typeof request.body === 'object' && request.body !== null && 'batchId' in request.body
      ? (request.body as any).batchId
      : undefined);

  const rawRow =
    (request.headers['x-source-row'] as string) ||
    (typeof request.body === 'object' && request.body !== null && 'sourceRow' in request.body
      ? (request.body as any).sourceRow
      : undefined);
  const sourceRow = rawRow !== undefined ? Number(rawRow) : undefined;

  return { key, batchId, sourceRow };
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
      const idempotency = extractIdempotencyContext(request);
      if (idempotency?.key) {
        const existingReceipt = service.getReceipt(idempotency.key);
        if (existingReceipt) {
          reply.header('x-idempotent-replay', 'true');
          return reply.status(201).send(existingReceipt.result);
        }
      }

      const parsed = CRM4ListCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 'Invalid list creation body', 400, parsed.error.issues);
      }
      const list = await service.createList(parsed.data, idempotency);

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
      const idempotency = extractIdempotencyContext(request);
      if (idempotency?.key) {
        const existingReceipt = service.getReceipt(idempotency.key);
        if (existingReceipt) {
          reply.header('x-idempotent-replay', 'true');
          return reply.status(201).send(existingReceipt.result);
        }
      }

      const parsed = CRM4CampaignCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 'Invalid campaign creation body', 400, parsed.error.issues);
      }
      const campaign = await service.createCampaign(parsed.data, idempotency);

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
      const idempotency = extractIdempotencyContext(request);
      if (idempotency?.key) {
        const existingReceipt = service.getReceipt(idempotency.key);
        if (existingReceipt) {
          reply.header('x-idempotent-replay', 'true');
          return reply.status(201).send(existingReceipt.result);
        }
      }

      const body = { ...(request.body as Record<string, unknown>), campaignId: id };
      const parsed = CRM4MemberCreateSchema.safeParse(body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 'Invalid member creation body', 400, parsed.error.issues);
      }
      const member = await service.addCampaignMember(parsed.data, idempotency);

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
      const idempotency = extractIdempotencyContext(request);
      if (idempotency?.key) {
        const existingReceipt = service.getReceipt(idempotency.key);
        if (existingReceipt) {
          reply.header('x-idempotent-replay', 'true');
          return reply.status(200).send(existingReceipt.result);
        }
      }

      const parsed = CRM4ConsentSetSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 'Invalid consent payload', 400, parsed.error.issues);
      }
      const consent = await service.setConsent(parsed.data, idempotency);

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
};
