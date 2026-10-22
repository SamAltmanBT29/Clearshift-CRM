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
} from '@clearshift/contracts';
import type { RoleType } from '@cs/identity';
import { requireRoles } from '../plugins/auth.js';
import { CRM1_ENDPOINT_ROLES } from '../policies/roles.js';
import { redactSensitiveObject } from '../policies/masking.js';
import { Crm1Service } from '../services/crm1.service.js';
import { Crm1AuditService, crm1Audit } from '../services/audit.js';
import { DomainValidationError } from '../domain/errors.js';

const UuidSchema = z.string().uuid();

export interface Crm1RouteOptions {
  service?: Crm1Service | undefined;
  auditService?: Crm1AuditService | undefined;
}

function endpointPreHandlers(
  fastify: FastifyInstance,
  allowedRoles: readonly RoleType[]
) {
  return [fastify.authenticate, requireRoles(allowedRoles)];
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
    preHandler: endpointPreHandlers(fastify, CRM1_ENDPOINT_ROLES.CONTACTS_LIST),
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
    preHandler: endpointPreHandlers(fastify, CRM1_ENDPOINT_ROLES.CONTACTS_READ),
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

    return reply.status(200).send(redactSensitiveObject(contact));
  });

  fastify.post('/contacts', {
    preHandler: endpointPreHandlers(fastify, CRM1_ENDPOINT_ROLES.CONTACTS_CREATE),
  }, async (request, reply) => {
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
    preHandler: endpointPreHandlers(fastify, CRM1_ENDPOINT_ROLES.CONTACTS_UPDATE),
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
    preHandler: endpointPreHandlers(fastify, CRM1_ENDPOINT_ROLES.COMPANIES_LIST),
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
    preHandler: endpointPreHandlers(fastify, CRM1_ENDPOINT_ROLES.COMPANIES_READ),
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

    return reply.status(200).send(redactSensitiveObject(company));
  });

  fastify.post('/companies', {
    preHandler: endpointPreHandlers(fastify, CRM1_ENDPOINT_ROLES.COMPANIES_CREATE),
  }, async (request, reply) => {
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
    preHandler: endpointPreHandlers(fastify, CRM1_ENDPOINT_ROLES.COMPANIES_UPDATE),
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
    preHandler: endpointPreHandlers(fastify, CRM1_ENDPOINT_ROLES.LEADS_LIST),
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
    preHandler: endpointPreHandlers(fastify, CRM1_ENDPOINT_ROLES.LEADS_READ),
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

    return reply.status(200).send(redactSensitiveObject(lead));
  });

  fastify.post('/leads', {
    preHandler: endpointPreHandlers(fastify, CRM1_ENDPOINT_ROLES.LEADS_CREATE),
  }, async (request, reply) => {
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
    preHandler: endpointPreHandlers(fastify, CRM1_ENDPOINT_ROLES.LEADS_UPDATE),
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
    preHandler: endpointPreHandlers(fastify, CRM1_ENDPOINT_ROLES.IMPORTS_START),
  }, async (request, reply) => {
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
    preHandler: endpointPreHandlers(fastify, CRM1_ENDPOINT_ROLES.IMPORTS_STATUS),
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
    preHandler: endpointPreHandlers(fastify, CRM1_ENDPOINT_ROLES.IMPORTS_REJECTS),
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
};
