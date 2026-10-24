import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ContactsQuerySchema,
  CreateContactInputSchema,
  UpdateContactInputSchema,
  CompaniesQuerySchema,
  CreateCompanyInputSchema,
  UpdateCompanyInputSchema,
  LeadsQuerySchema,
  CreateLeadInputSchema,
  UpdateLeadInputSchema,
  CreateCrm1ImportInputSchema,
  Crm1RejectsQuerySchema,
  Crm1DetectDuplicatesInputSchema,
  Crm1ResolveDuplicateInputSchema,
  Crm1EvaluateContactDuplicateInputSchema,
  Crm1EvaluateCompanyDuplicateInputSchema,
  Crm1ExecuteBatchLoadInputSchema,
} from '@clearshift/contracts';
import { Roles, type RoleType } from '@cs/identity';
import { requireRoles } from '../plugins/auth.js';
import { CRM1_ENDPOINT_ROLES } from '../policies/roles.js';
import { redactSensitiveObject } from '../policies/masking.js';
import { Crm1Service } from '../services/crm1.service.js';
import { Crm1AuditService, crm1Audit } from '../services/audit.js';
import { crm1CleaningService } from '../services/crm1-cleaning.service.js';
import { crm1MappingService } from '../services/crm1-mapping.service.js';
import {
  DomainValidationError,
  AutoMergeForbiddenError,
  DuplicateCandidateNotFoundError,
} from '../domain/errors.js';
import {
  createEndpointAuthPreHandlers,
  assertObjectMutationAllowed,
  assertTenantIsolation,
  type Crm1TokenClaims,
} from '../interface/authz.js';

const UuidSchema = z.string().uuid();

export interface Crm1RouteOptions {
  service?: Crm1Service | undefined;
  auditService?: Crm1AuditService | undefined;
}

function endpointPreHandlers(
  fastify: FastifyInstance,
  allowedRolesOrKey: readonly RoleType[] | keyof typeof CRM1_ENDPOINT_ROLES,
  requireObjectGuard = false
) {
  if (typeof allowedRolesOrKey === 'string') {
    return createEndpointAuthPreHandlers(fastify, {
      endpointKey: allowedRolesOrKey,
      requireObjectGuard,
    });
  }
  return [fastify.authenticate, requireRoles(allowedRolesOrKey)];
}

/**
 * Fastify Routes for CRM-1 Contacts, Companies and Leads
 * Base Prefix: /api/v1/crm-contacts
 * Strictly enforces SDS role permissions matrix and append-only audit trails.
 */
export const crm1Routes: FastifyPluginAsync<Crm1RouteOptions> = async (
  fastify,
  opts
) => {
  const service = opts.service ?? new Crm1Service();
  const auditService = opts.auditService ?? crm1Audit;

  // Health check (public)
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      module: 'crm-1',
      name: 'Contacts, Companies and Leads',
      version: '1.0.0',
    };
  });

  // ---------------------------------------------------------------------------
  // 1. Contacts Endpoints
  // ---------------------------------------------------------------------------

  fastify.get('/contacts', {
    preHandler: endpointPreHandlers(fastify, 'CONTACTS_LIST'),
  }, async (request, reply) => {
    const parsed = ContactsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid query parameters',
          details: parsed.error.issues,
        },
      });
    }

    const result = await service.getContacts(parsed.data);
    return reply.status(200).send(redactSensitiveObject(result));
  });

  fastify.get<{ Params: { id: string } }>('/contacts/:id', {
    preHandler: endpointPreHandlers(fastify, 'CONTACTS_READ'),
  }, async (request, reply) => {
    const { id } = request.params;
    const validUuid = UuidSchema.safeParse(id);
    if (!validUuid.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: `Invalid contact ID format: '${id}' is not a valid UUID`,
        },
      });
    }

    const contact = await service.getContactById(id);
    if (!contact) {
      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Contact with ID '${id}' not found`,
        },
      });
    }

    assertTenantIsolation(
      request.user as Crm1TokenClaims,
      (contact as any).tenantId || (contact as any).tenant_id,
      request
    );

    return reply.status(200).send(redactSensitiveObject(contact));
  });

  fastify.post('/contacts', {
    preHandler: endpointPreHandlers(fastify, 'CONTACTS_CREATE'),
  }, async (request, reply) => {
    assertObjectMutationAllowed(
      request.user as Crm1TokenClaims,
      {
        resourceType: 'contact',
        payload: request.body as Record<string, unknown>,
        isUpdate: false,
      },
      request
    );

    const parsed = CreateContactInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Validation failed for contact creation',
          details: parsed.error.issues,
        },
      });
    }

    if (parsed.data.companyId) {
      const company = await service.getCompanyById(parsed.data.companyId);
      if (company) {
        assertTenantIsolation(
          request.user as Crm1TokenClaims,
          (company as any).tenantId || (company as any).tenant_id,
          request
        );
      }
    }

    try {
      const contact = await service.createContact(parsed.data);

      await auditService.logEvent({
        actor: request.user?.sub ?? 'system',
        action: 'crm1.contact.created',
        entity: 'contact',
        entityId: contact.id,
        diff: {
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          leadStatus: contact.leadStatus,
          companyId: contact.companyId,
        },
        result: 'success',
      });

      return reply.status(201).send(redactSensitiveObject(contact));
    } catch (err) {
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

  fastify.patch<{ Params: { id: string } }>('/contacts/:id', {
    preHandler: endpointPreHandlers(fastify, 'CONTACTS_UPDATE', true),
  }, async (request, reply) => {
    const { id } = request.params;
    const validUuid = UuidSchema.safeParse(id);
    if (!validUuid.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: `Invalid contact ID format: '${id}' is not a valid UUID`,
        },
      });
    }

    const existing = await service.getContactById(id);
    if (!existing) {
      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Contact with ID '${id}' not found`,
        },
      });
    }

    assertObjectMutationAllowed(
      request.user as Crm1TokenClaims,
      {
        resourceType: 'contact',
        resourceId: id,
        resourceOwnerId: (existing as any).ownerId || (existing as any).employeeId || (existing as any).assignedTo || (existing as any).userId || (existing as any).createdBy || undefined,
        resourceTenantId: (existing as any).tenantId || (existing as any).tenant_id || (existing as any).orgId || (existing as any).org_id || undefined,
        payload: request.body as Record<string, unknown>,
        isUpdate: true,
      },
      request
    );

    const parsed = UpdateContactInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Validation failed for contact update',
          details: parsed.error.issues,
        },
      });
    }

    if (parsed.data.companyId) {
      const company = await service.getCompanyById(parsed.data.companyId);
      if (company) {
        assertTenantIsolation(
          request.user as Crm1TokenClaims,
          (company as any).tenantId || (company as any).tenant_id,
          request
        );
      }
    }

    try {
      const contact = await service.updateContact(id, parsed.data);
      if (!contact) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Contact with ID '${id}' not found`,
          },
        });
      }

      await auditService.logEvent({
        actor: request.user?.sub ?? 'system',
        action: 'crm1.contact.updated',
        entity: 'contact',
        entityId: id,
        diff: parsed.data,
        result: 'success',
      });

      return reply.status(200).send(redactSensitiveObject(contact));
    } catch (err) {
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

  // ---------------------------------------------------------------------------
  // 2. Companies Endpoints
  // ---------------------------------------------------------------------------

  fastify.get('/companies', {
    preHandler: endpointPreHandlers(fastify, 'COMPANIES_LIST'),
  }, async (request, reply) => {
    const parsed = CompaniesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid query parameters',
          details: parsed.error.issues,
        },
      });
    }

    const result = await service.getCompanies(parsed.data);
    return reply.status(200).send(redactSensitiveObject(result));
  });

  fastify.get<{ Params: { id: string } }>('/companies/:id', {
    preHandler: endpointPreHandlers(fastify, 'COMPANIES_READ'),
  }, async (request, reply) => {
    const { id } = request.params;
    const validUuid = UuidSchema.safeParse(id);
    if (!validUuid.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: `Invalid company ID format: '${id}' is not a valid UUID`,
        },
      });
    }

    const company = await service.getCompanyById(id);
    if (!company) {
      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Company with ID '${id}' not found`,
        },
      });
    }

    assertTenantIsolation(
      request.user as Crm1TokenClaims,
      (company as any).tenantId || (company as any).tenant_id,
      request
    );

    return reply.status(200).send(redactSensitiveObject(company));
  });

  fastify.post('/companies', {
    preHandler: endpointPreHandlers(fastify, 'COMPANIES_CREATE'),
  }, async (request, reply) => {
    assertObjectMutationAllowed(
      request.user as Crm1TokenClaims,
      {
        resourceType: 'company',
        payload: request.body as Record<string, unknown>,
        isUpdate: false,
      },
      request
    );

    const parsed = CreateCompanyInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Validation failed for company creation',
          details: parsed.error.issues,
        },
      });
    }

    const company = await service.createCompany(parsed.data);

    await auditService.logEvent({
      actor: request.user?.sub ?? 'system',
      action: 'crm1.company.created',
      entity: 'company',
      entityId: company.id,
      diff: {
        name: company.name,
        taxNumber: company.taxNumber,
        email: company.email,
      },
      result: 'success',
    });

    return reply.status(201).send(redactSensitiveObject(company));
  });

  fastify.patch<{ Params: { id: string } }>('/companies/:id', {
    preHandler: endpointPreHandlers(fastify, 'COMPANIES_UPDATE', true),
  }, async (request, reply) => {
    const { id } = request.params;
    const validUuid = UuidSchema.safeParse(id);
    if (!validUuid.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: `Invalid company ID format: '${id}' is not a valid UUID`,
        },
      });
    }

    const existing = await service.getCompanyById(id);
    if (!existing) {
      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Company with ID '${id}' not found`,
        },
      });
    }

    assertObjectMutationAllowed(
      request.user as Crm1TokenClaims,
      {
        resourceType: 'company',
        resourceId: id,
        resourceOwnerId: (existing as any).ownerId || (existing as any).employeeId || (existing as any).assignedTo || (existing as any).userId || (existing as any).createdBy || undefined,
        resourceTenantId: (existing as any).tenantId || (existing as any).tenant_id || (existing as any).orgId || (existing as any).org_id || undefined,
        payload: request.body as Record<string, unknown>,
        isUpdate: true,
      },
      request
    );

    const parsed = UpdateCompanyInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Validation failed for company update',
          details: parsed.error.issues,
        },
      });
    }

    const company = await service.updateCompany(id, parsed.data);
    if (!company) {
      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Company with ID '${id}' not found`,
        },
      });
    }

    await auditService.logEvent({
      actor: request.user?.sub ?? 'system',
      action: 'crm1.company.updated',
      entity: 'company',
      entityId: id,
      diff: parsed.data,
      result: 'success',
    });

    return reply.status(200).send(redactSensitiveObject(company));
  });

  // ---------------------------------------------------------------------------
  // 3. Leads Endpoints
  // ---------------------------------------------------------------------------

  fastify.get('/leads', {
    preHandler: endpointPreHandlers(fastify, 'LEADS_LIST'),
  }, async (request, reply) => {
    const parsed = LeadsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid query parameters',
          details: parsed.error.issues,
        },
      });
    }

    const result = await service.getLeads(parsed.data);
    return reply.status(200).send(redactSensitiveObject(result));
  });

  fastify.get<{ Params: { id: string } }>('/leads/:id', {
    preHandler: endpointPreHandlers(fastify, 'LEADS_READ'),
  }, async (request, reply) => {
    const { id } = request.params;
    const validUuid = UuidSchema.safeParse(id);
    if (!validUuid.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: `Invalid lead ID format: '${id}' is not a valid UUID`,
        },
      });
    }

    const lead = await service.getLeadById(id);
    if (!lead) {
      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Lead with ID '${id}' not found`,
        },
      });
    }

    assertTenantIsolation(
      request.user as Crm1TokenClaims,
      (lead as any).tenantId || (lead as any).tenant_id,
      request
    );

    return reply.status(200).send(redactSensitiveObject(lead));
  });

  fastify.post('/leads', {
    preHandler: endpointPreHandlers(fastify, 'LEADS_CREATE'),
  }, async (request, reply) => {
    assertObjectMutationAllowed(
      request.user as Crm1TokenClaims,
      {
        resourceType: 'lead',
        payload: request.body as Record<string, unknown>,
        isUpdate: false,
      },
      request
    );

    const parsed = CreateLeadInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Validation failed for lead creation',
          details: parsed.error.issues,
        },
      });
    }

    if (parsed.data.contactId) {
      const contact = await service.getContactById(parsed.data.contactId);
      if (contact) {
        assertTenantIsolation(
          request.user as Crm1TokenClaims,
          (contact as any).tenantId || (contact as any).tenant_id,
          request
        );
      }
    }

    try {
      const lead = await service.createLead(parsed.data);

      await auditService.logEvent({
        actor: request.user?.sub ?? 'system',
        action: 'crm1.lead.created',
        entity: 'lead',
        entityId: lead.id,
        diff: {
          status: lead.status,
          contactId: lead.contactId,
        },
        result: 'success',
      });

      return reply.status(201).send(redactSensitiveObject(lead));
    } catch (err) {
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

  fastify.patch<{ Params: { id: string } }>('/leads/:id', {
    preHandler: endpointPreHandlers(fastify, 'LEADS_UPDATE', true),
  }, async (request, reply) => {
    const { id } = request.params;
    const validUuid = UuidSchema.safeParse(id);
    if (!validUuid.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: `Invalid lead ID format: '${id}' is not a valid UUID`,
        },
      });
    }

    const existing = await service.getLeadById(id);
    if (!existing) {
      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Lead with ID '${id}' not found`,
        },
      });
    }

    assertObjectMutationAllowed(
      request.user as Crm1TokenClaims,
      {
        resourceType: 'lead',
        resourceId: id,
        resourceOwnerId: (existing as any).ownerId || (existing as any).employeeId || (existing as any).assignedTo || (existing as any).userId || (existing as any).createdBy || undefined,
        resourceTenantId: (existing as any).tenantId || (existing as any).tenant_id || (existing as any).orgId || (existing as any).org_id || undefined,
        payload: request.body as Record<string, unknown>,
        isUpdate: true,
      },
      request
    );

    const parsed = UpdateLeadInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Validation failed for lead update',
          details: parsed.error.issues,
        },
      });
    }

    try {
      const lead = await service.updateLead(id, parsed.data);
      if (!lead) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Lead with ID '${id}' not found`,
          },
        });
      }

      await auditService.logEvent({
        actor: request.user?.sub ?? 'system',
        action: 'crm1.lead.updated',
        entity: 'lead',
        entityId: id,
        diff: parsed.data,
        result: 'success',
      });

      return reply.status(200).send(redactSensitiveObject(lead));
    } catch (err) {
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

  // ---------------------------------------------------------------------------
  // 4. Imports & Rejects Endpoints
  // ---------------------------------------------------------------------------

  fastify.post('/imports', {
    preHandler: endpointPreHandlers(fastify, 'IMPORTS_START'),
  }, async (request, reply) => {
    assertObjectMutationAllowed(
      request.user as Crm1TokenClaims,
      {
        resourceType: 'import_batch',
        payload: request.body as Record<string, unknown>,
        isUpdate: false,
      },
      request
    );

    const parsed = CreateCrm1ImportInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Validation failed for import run creation',
          details: parsed.error.issues,
        },
      });
    }

    const run = await service.startImportRun(parsed.data);

    await auditService.logEvent({
      actor: request.user?.sub ?? 'system',
      action: 'crm1.import.started',
      entity: 'import_batch',
      batchId: parsed.data.batchId,
      metadata: {
        sourceSystem: parsed.data.sourceSystem,
        filename: parsed.data.filename,
      },
      result: 'success',
    });

    return reply.status(201).send(redactSensitiveObject(run));
  });

  fastify.get<{ Params: { batch: string } }>('/imports/:batch', {
    preHandler: endpointPreHandlers(fastify, 'IMPORTS_STATUS'),
  }, async (request, reply) => {
    const { batch } = request.params;
    if (!batch || batch.trim().length === 0) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Batch identifier is required',
        },
      });
    }

    const run = await service.getImportRun(batch);
    if (!run) {
      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Import run with batch ID '${batch}' not found`,
        },
      });
    }

    return reply.status(200).send(redactSensitiveObject(run));
  });

  fastify.get<{ Params: { batch: string } }>('/imports/:batch/rejects', {
    preHandler: endpointPreHandlers(fastify, 'IMPORTS_REJECTS'),
  }, async (request, reply) => {
    const { batch } = request.params;
    if (!batch || batch.trim().length === 0) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Batch identifier is required',
        },
      });
    }

    const queryData = {
      ...(request.query as object),
      batchId: batch,
    };

    const parsed = Crm1RejectsQuerySchema.safeParse(queryData);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid query parameters for rejects',
          details: parsed.error.issues,
        },
      });
    }

    const result = await service.getRejects(parsed.data);
    return reply.status(200).send(redactSensitiveObject(result));
  });

  // ---------------------------------------------------------------------------
  // 5. Cleaning Rules & Field Audit Endpoints
  // ---------------------------------------------------------------------------

  fastify.post('/cleaning/clean', {
    preHandler: endpointPreHandlers(fastify, 'IMPORTS_START'),
  }, async (request, reply) => {
    const CleanRequestSchema = z.object({
      rows: z.array(z.record(z.string())),
      options: z.object({
        dateFormat: z.enum(['YYYY-MM-DD', 'DD-MM-YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY']).optional(),
        phoneCountry: z.string().optional(),
        disabledRules: z.array(z.string()).optional(),
        requiredFields: z.array(z.string()).optional(),
        entity: z.enum(['contact', 'company', 'lead', 'auto']).optional(),
      }).optional(),
      batchId: z.string().optional(),
    });

    const parsed = CleanRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid cleaning request payload',
          details: parsed.error.issues,
        },
      });
    }

    const { rows, options, batchId } = parsed.data;
    const result = crm1CleaningService.processBatchCleaning(rows, batchId, options);
    return reply.status(200).send(result);
  });

  // ---------------------------------------------------------------------------
  // 6. Mapping Templates & Dry-Run Validation Endpoints (#121, [CRM1-28])
  // ---------------------------------------------------------------------------

  fastify.get('/mappings/templates', {
    preHandler: endpointPreHandlers(fastify, [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.MIGRATION_RUNNER, Roles.ADMIN]),
  }, async (request, reply) => {
    const QuerySchema = z.object({
      entity: z.enum(['crm1_contacts', 'crm1_companies', 'crm1_leads']).optional(),
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

    const templates = crm1MappingService.listTemplates(parsed.data.entity);
    const enums = crm1MappingService.getEnumDictionaries();
    return reply.status(200).send({
      templates: templates.map((t) => ({
        ...t,
        checksum: crm1MappingService.getTemplate(t.id, t.version).checksum,
      })),
      enums,
    });
  });

  fastify.get('/mappings/templates/:id', {
    preHandler: endpointPreHandlers(fastify, [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.MIGRATION_RUNNER, Roles.ADMIN]),
  }, async (request, reply) => {
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
      const result = crm1MappingService.getTemplate(pParsed.data.id, qParsed.data.version);
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
  });

  fastify.post('/mappings/validate', {
    preHandler: endpointPreHandlers(fastify, 'IMPORTS_START'),
  }, async (request, reply) => {
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
      const result = crm1MappingService.validateDryRun(
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
  });

  fastify.post('/mappings/map', {
    preHandler: endpointPreHandlers(fastify, 'IMPORTS_START'),
  }, async (request, reply) => {
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
      const result = crm1MappingService.processBatchMapping(
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
  });

  // ---------------------------------------------------------------------------
  // 6. Exact Duplicates & Human Review Endpoints (CRM1-12)
  // ---------------------------------------------------------------------------

  fastify.post('/duplicates/detect', {
    preHandler: endpointPreHandlers(fastify, 'DUPLICATES_DETECT'),
  }, async (request, reply) => {
    const correlationId = (request.headers['x-correlation-id'] as string) || 'corr-' + Date.now();
    const parsed = Crm1DetectDuplicatesInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'BAD_REQUEST',
        message: 'Invalid duplicate detection request',
        details: parsed.error.issues,
        correlation_id: correlationId,
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid duplicate detection request',
          details: parsed.error.issues,
        },
      });
    }

    try {
      const result = service.detectDuplicates(parsed.data);
      await auditService.logEvent({
        actor: (request as any).user?.sub || 'system',
        action: 'DUPLICATES_DETECTED',
        entity: 'crm1_duplicates',
        metadata: {
          batchId: parsed.data.batchId,
          keyType: parsed.data.keyType,
          duplicateGroupCount: result.summary.duplicateGroupCount,
          duplicateRecordCount: result.summary.duplicateRecordCount,
        },
      });
      return reply.status(200).send({
        ...result,
        correlation_id: correlationId,
      });
    } catch (err: any) {
      if (err instanceof AutoMergeForbiddenError || err.code === 'AUTO_MERGE_FORBIDDEN') {
        return reply.status(422).send({
          code: 'AUTO_MERGE_FORBIDDEN',
          message: err.message,
          correlation_id: correlationId,
          error: {
            code: 'AUTO_MERGE_FORBIDDEN',
            message: err.message,
          },
        });
      }
      throw err;
    }
  });

  fastify.get('/duplicates/held', {
    preHandler: endpointPreHandlers(fastify, 'DUPLICATES_HELD'),
  }, async (request, reply) => {
    const query = request.query as {
      batchId?: string;
      keyType?: string;
      entity?: string;
    };
    const items = service.getHeldDuplicates(query);
    return reply.status(200).send({
      items,
      total: items.length,
    });
  });

  fastify.post('/duplicates/resolve', {
    preHandler: endpointPreHandlers(fastify, 'DUPLICATES_RESOLVE'),
  }, async (request, reply) => {
    const correlationId = (request.headers['x-correlation-id'] as string) || 'corr-' + Date.now();
    const parsed = Crm1ResolveDuplicateInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'BAD_REQUEST',
        message: 'Invalid duplicate resolution input',
        details: parsed.error.issues,
        correlation_id: correlationId,
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid duplicate resolution input',
          details: parsed.error.issues,
        },
      });
    }

    try {
      const auditEntry = service.resolveDuplicate(parsed.data);
      await auditService.logEvent({
        actor: parsed.data.actorId,
        action: `DUPLICATE_${parsed.data.decision}`,
        entity: `crm1_${auditEntry.entity || 'contact'}`,
        entityId: parsed.data.keptId,
        metadata: {
          candidateId: parsed.data.candidateId,
          decision: parsed.data.decision,
          keptId: parsed.data.keptId,
          mergedId: parsed.data.mergedId,
          reason: parsed.data.reason,
          keyType: auditEntry.keyType,
          normalizedKey: auditEntry.normalizedKey,
        },
      });
      return reply.status(200).send({
        ...auditEntry,
        correlation_id: correlationId,
      });
    } catch (err: any) {
      if (err instanceof DuplicateCandidateNotFoundError || err.code === 'NOT_FOUND') {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: err.message,
          correlation_id: correlationId,
          error: {
            code: 'NOT_FOUND',
            message: err.message,
          },
        });
      }
      if (err instanceof DomainValidationError || err.code === 'BAD_REQUEST') {
        return reply.status(400).send({
          code: 'BAD_REQUEST',
          message: err.message,
          correlation_id: correlationId,
          error: {
            code: 'BAD_REQUEST',
            message: err.message,
          },
        });
      }
      throw err;
    }
  });

  fastify.get('/duplicates/audit', {
    preHandler: endpointPreHandlers(fastify, 'DUPLICATES_AUDIT'),
  }, async (request, reply) => {
    const query = request.query as {
      candidateId?: string;
      actorId?: string;
      entity?: string;
      page?: string | number;
      pageSize?: string | number;
    };
    const page = query.page ? Number(query.page) : 1;
    const pageSize = query.pageSize ? Number(query.pageSize) : 20;
    const result = service.getDuplicateAuditLogs({
      candidateId: query.candidateId,
      actorId: query.actorId,
      entity: query.entity,
      page,
      pageSize,
    });
    return reply.status(200).send(result);
  });

  fastify.post('/duplicates/evaluate/contact', {
    preHandler: endpointPreHandlers(fastify, 'DUPLICATES_DETECT'),
  }, async (request, reply) => {
    const correlationId = (request.headers['x-correlation-id'] as string) || 'corr-' + Date.now();
    const parsed = Crm1EvaluateContactDuplicateInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'BAD_REQUEST',
        message: 'Invalid contact duplicate evaluation request',
        details: parsed.error.issues,
        correlation_id: correlationId,
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid contact duplicate evaluation request',
          details: parsed.error.issues,
        },
      });
    }
    const result = await service.evaluateContactDuplicate(parsed.data);
    return reply.status(200).send({
      ...result,
      correlation_id: correlationId,
    });
  });

  fastify.post('/duplicates/evaluate/company', {
    preHandler: endpointPreHandlers(fastify, 'DUPLICATES_DETECT'),
  }, async (request, reply) => {
    const correlationId = (request.headers['x-correlation-id'] as string) || 'corr-' + Date.now();
    const parsed = Crm1EvaluateCompanyDuplicateInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'BAD_REQUEST',
        message: 'Invalid company duplicate evaluation request',
        details: parsed.error.issues,
        correlation_id: correlationId,
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid company duplicate evaluation request',
          details: parsed.error.issues,
        },
      });
    }
    const result = await service.evaluateCompanyDuplicate(parsed.data);
    return reply.status(200).send({
      ...result,
      correlation_id: correlationId,
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Chunked Batch Loading & Idempotent Retry Endpoints (CRM1-13)
  // ---------------------------------------------------------------------------

  const handleExecuteBatchLoad = async (request: any, reply: any) => {
    const correlationId = (request.headers['x-correlation-id'] as string) || 'corr-' + Date.now();
    const body = (request.body ?? {}) as Record<string, unknown>;
    const parsed = Crm1ExecuteBatchLoadInputSchema.safeParse(body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'BAD_REQUEST',
        message: 'Invalid batch load input',
        details: parsed.error.issues,
        correlation_id: correlationId,
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid batch load input',
          details: parsed.error.issues,
        },
      });
    }

    try {
      const report = await service.executeBatchLoad(parsed.data);

      await auditService.logEvent({
        actor: request.user?.sub ?? 'system',
        action: 'crm1.batch.executed',
        entity: 'batch_load',
        batchId: parsed.data.batchId,
        metadata: {
          status: report.status,
          totalRecords: report.totalRecords,
          committedRecords: report.committedRecords,
          failedRecords: report.failedRecords,
          failureRate: report.failureRate,
        },
        result: report.status === 'STOPPED_EXCESSIVE_FAILURES' ? 'halted' : report.status === 'FAILED' ? 'failure' : 'success',
      });

      return reply.status(200).send({
        ...report,
        correlation_id: correlationId,
      });
    } catch (err: any) {
      if (err?.code === 'STOPPED_EXCESSIVE_FAILURES' || err?.statusCode === 422) {
        return reply.status(422).send({
          code: 'STOPPED_EXCESSIVE_FAILURES',
          message: err.message || 'Batch execution stopped immediately: row failures exceeded the 10% threshold.',
          correlation_id: correlationId,
          error: {
            code: 'STOPPED_EXCESSIVE_FAILURES',
            message: err.message || 'Batch execution stopped immediately: row failures exceeded the 10% threshold.',
            details: err.details,
          },
        });
      }
      throw err;
    }
  };

  fastify.post('/batches/execute-load', {
    preHandler: endpointPreHandlers(fastify, 'BATCH_EXECUTE_LOAD'),
  }, handleExecuteBatchLoad);

  fastify.get<{ Params: { batchId: string } }>('/batches/:batchId/report', {
    preHandler: endpointPreHandlers(fastify, 'BATCH_REPORT_READ'),
  }, async (request, reply) => {
    const correlationId = (request.headers['x-correlation-id'] as string) || 'corr-' + Date.now();
    const { batchId } = request.params;
    const report = service.getBatchReport(batchId);
    if (!report) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: `Batch report for batch '${batchId}' not found`,
        correlation_id: correlationId,
        error: {
          code: 'NOT_FOUND',
          message: `Batch report for batch '${batchId}' not found`,
        },
      });
    }
    return reply.status(200).send({
      ...report,
      correlation_id: correlationId,
    });
  });

  fastify.post('/import/batch', {
    preHandler: endpointPreHandlers(fastify, 'BATCH_EXECUTE_LOAD'),
  }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (Array.isArray(body['records'])) {
      return handleExecuteBatchLoad(request, reply);
    }
    const batchId = (body['batchId'] ?? body['batch_id'] ?? `batch-crm1-${Date.now()}`) as string;
    const rawRows = body['rows'] ?? body['records'];
    if (!Array.isArray(rawRows)) {
      return reply.status(400).send({
        code: 'BAD_REQUEST',
        message: 'Missing or invalid rows array in batch import payload',
        correlation_id: (request.headers['x-correlation-id'] as string) || 'corr-' + Date.now(),
        error: {
          code: 'BAD_REQUEST',
          message: 'Missing or invalid rows array in batch import payload',
        },
      });
    }

    const records = rawRows.map((r, idx) => ({
      sourceRow: (r as any).sourceRow ?? (r as any).source_row ?? idx + 1,
      idempotencyKey: (r as any).idempotencyKey ?? (r as any).idempotency_key ?? `${batchId}-row-${idx + 1}`,
      data: (r as any).data ?? r,
    }));

    const executeInput = {
      batchId,
      module: 'crm-1' as const,
      step: 'load' as const,
      chunkSize: Number(body['chunkSize'] ?? body['chunk_size'] ?? 500),
      records,
    };
    (request as any).body = executeInput;
    return handleExecuteBatchLoad(request, reply);
  });
};
