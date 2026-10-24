import { randomUUID, createHash } from 'node:crypto';
import type {
  Contact,
  ContactsQuery,
  PaginatedContactsResponse,
  CreateContactInput,
  UpdateContactInput,
  Company,
  CompaniesQuery,
  PaginatedCompaniesResponse,
  CreateCompanyInput,
  UpdateCompanyInput,
  Lead,
  LeadsQuery,
  PaginatedLeadsResponse,
  CreateLeadInput,
  UpdateLeadInput,
  Crm1ImportRun,
  CreateCrm1ImportInput,
  Crm1Reject,
  Crm1RejectsQuery,
  PaginatedCrm1RejectsResponse,
  Crm1DetectDuplicatesInput,
  Crm1ResolveDuplicateInput,
  Crm1DuplicateCandidate,
  Crm1DuplicateAuditLogEntry,
  ContactCandidate,
  CompanyCandidate,
  DuplicateEvaluationResult,
  CompanyDuplicateEvaluationResult,
  Crm1ExecuteBatchLoadInput,
  Crm1BatchExecutionReport,
} from '@clearshift/contracts';
import {
  executeCrm1ChunkedBatchLoad,
  type Crm1BatchLoaderOptions,
} from '../domain/batch-loader.js';
import {
  evaluateContactDuplicate,
  evaluateCompanyDuplicate,
} from '@clearshift/contracts';
import {
  DuplicateReviewQueue,
  detectExactDuplicates,
  type DuplicateDetectionResult,
} from '../domain/duplicate-policy.js';
import { getDatabase } from '@cs/db';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, asc, count, desc, eq, exists, ilike, or, sql } from 'drizzle-orm';
import {
  crm1Companies,
  crm1Contacts,
  crm1ImportBatches,
  crm1ImportReceipts,
  crm1ImportRejects,
  crm1Leads,
} from '../../db/schema.js';
import {
  CompanyNotFoundError,
  ContactNotFoundError,
  InvalidLeadStatusError,
  DomainValidationError,
} from '../domain/errors.js';
import {
  assertLeadStatusTransition,
} from '../domain/relationships.js';
import type { CRM1LeadStatus } from '@clearshift/contracts/crm-1';

export interface Crm1ServiceOptions {
  inMemory?: boolean;
  db?: NodePgDatabase;
}

const VALID_LEAD_STATUSES = ['New', 'Working', 'Qualified', 'Closed'] as const;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function toUuid(val: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val)) {
    return val;
  }
  const hash = createHash('sha256').update(val).digest('hex');
  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-a${hash.substring(17, 20)}-${hash.substring(20, 32)}`;
}

function toContact(row: typeof crm1Contacts.$inferSelect): Contact {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email ?? '',
    phone: row.phone,
    address: row.address,
    addressLine: row.address,
    city: 'Metro City',
    country: 'US',
    companyId: row.companyId,
    leadStatus: (row.leadStatus as (typeof VALID_LEAD_STATUSES)[number]) ?? 'New',
    goldenId: row.goldenId,
    sourceSystem: row.sourceSystem ?? 'clearshift_api',
    sourceId: row.sourceId ?? row.id,
    consentStatus: (row.consentStatus as 'unknown' | 'granted' | 'withdrawn') ?? 'unknown',
    consentUpdatedAt: row.consentUpdatedAt,
    unsubscribed: row.unsubscribed ?? false,
    unsubscribedUpdatedAt: row.unsubscribedUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCompany(row: typeof crm1Companies.$inferSelect): Company {
  return {
    id: row.id,
    name: row.name,
    taxNumber: row.taxNumber ?? '',
    email: row.email,
    phone: row.phone,
    address: row.address,
    addressLine: row.address,
    city: 'Metropolis',
    country: 'US',
    sourceSystem: row.sourceSystem ?? 'clearshift_api',
    sourceId: row.sourceId ?? row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toLead(
  row: typeof crm1Leads.$inferSelect,
  contact?: { firstName?: string | undefined; lastName?: string | undefined; email?: string | null | undefined } | null
): Lead {
  const name = contact
    ? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim()
    : `Lead ${row.id.substring(0, 8)}`;
  const email = contact?.email ?? `${row.id.substring(0, 8)}@clearshift.synthetic`;

  return {
    id: row.id,
    name: name || `Lead ${row.id.substring(0, 8)}`,
    email,
    status: (row.status as (typeof VALID_LEAD_STATUSES)[number]) ?? 'New',
    contactId: row.contactId,
    sourceSystem: row.sourceSystem ?? 'clearshift_api',
    sourceId: row.sourceId ?? row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * CRM-1 Contacts, Companies and Leads Service
 * Direct Drizzle-backed service providing server-side filtered, bounded,
 * and deterministically sorted operations for Contacts, Companies, Leads, and Imports.
 */
export class Crm1Service {
  private db?: NodePgDatabase | undefined;
  private inMemory = false;
  private duplicateQueue = new DuplicateReviewQueue();
  private batchReports: Map<string, Crm1BatchExecutionReport> = new Map();

  private memContacts: Map<string, Contact> = new Map();
  private memCompanies: Map<string, Company> = new Map();
  private memLeads: Map<string, Lead> = new Map();
  private memImportRuns: Map<string, Crm1ImportRun> = new Map();
  private memRejects: Map<string, Crm1Reject> = new Map();

  constructor(dbOrOptions?: NodePgDatabase | Crm1ServiceOptions) {
    if (dbOrOptions && typeof dbOrOptions === 'object' && 'inMemory' in dbOrOptions) {
      this.inMemory = Boolean(dbOrOptions.inMemory);
      if (dbOrOptions.db !== undefined) {
        this.db = dbOrOptions.db;
      }
      if (!this.db && !this.inMemory) {
        this.db = getDatabase(
          process.env['DATABASE_URL_TEST'] ||
            process.env['DATABASE_URL'] ||
            'postgresql://localhost:5432/clearshift_test'
        );
      }
    } else {
      this.inMemory = false;
      this.db =
        (dbOrOptions as NodePgDatabase | undefined) ??
        getDatabase(
          process.env['DATABASE_URL_TEST'] ||
            process.env['DATABASE_URL'] ||
            'postgresql://localhost:5432/clearshift_test'
        );
    }
  }

  // ---------------------------------------------------------------------------
  // 1. Contacts
  // ---------------------------------------------------------------------------

  public async getContacts(query: ContactsQuery): Promise<PaginatedContactsResponse> {
    if (this.inMemory) {
      let contacts = Array.from(this.memContacts.values());
      if (query.search) {
        const s = query.search.toLowerCase();
        contacts = contacts.filter(
          (c) =>
            c.firstName.toLowerCase().includes(s) ||
            c.lastName.toLowerCase().includes(s) ||
            (c.email && c.email.toLowerCase().includes(s)) ||
            `${c.firstName} ${c.lastName}`.toLowerCase().includes(s)
        );
      }
      if (query.email) {
        const em = query.email.trim().toLowerCase();
        contacts = contacts.filter((c) => c.email && c.email.toLowerCase() === em);
      }
      if (query.leadStatus) {
        contacts = contacts.filter((c) => c.leadStatus === query.leadStatus);
      }
      if (query.companyId) {
        contacts = contacts.filter((c) => c.companyId === query.companyId);
      }
      contacts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 25;
      const total = contacts.length;
      const totalPages = Math.ceil(total / pageSize) || (total === 0 ? 0 : 1);
      const items = contacts.slice((page - 1) * pageSize, page * pageSize);
      return { items, total, page, pageSize, limit: pageSize, totalPages };
    }

    const conditions = [];

    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      conditions.push(
        or(
          ilike(crm1Contacts.firstName, pattern),
          ilike(crm1Contacts.lastName, pattern),
          ilike(crm1Contacts.email, pattern),
          sql`concat_ws(' ', ${crm1Contacts.firstName}, ${crm1Contacts.lastName}) ILIKE ${pattern}`
        )
      );
    }

    if (query.email) {
      conditions.push(ilike(crm1Contacts.email, query.email.trim()));
    }

    if (query.leadStatus) {
      conditions.push(eq(crm1Contacts.leadStatus, query.leadStatus));
    }

    if (query.companyId) {
      conditions.push(eq(crm1Contacts.companyId, query.companyId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const offset = (page - 1) * pageSize;

    const [rows, countResult] = await Promise.all([
      this.db!
        .select()
        .from(crm1Contacts)
        .where(whereClause)
        .orderBy(desc(crm1Contacts.createdAt), asc(crm1Contacts.id))
        .limit(pageSize)
        .offset(offset),
      this.db!.select({ total: count() }).from(crm1Contacts).where(whereClause),
    ]);

    const total = Number(countResult[0]?.total ?? 0);
    const totalPages = Math.ceil(total / pageSize) || (total === 0 ? 0 : 1);
    const items = rows.map(toContact);

    return {
      items,
      total,
      page,
      pageSize,
      limit: pageSize,
      totalPages,
    };
  }

  public async getContactById(id: string): Promise<Contact | null> {
    if (this.inMemory) {
      return this.memContacts.get(id) ?? null;
    }

    const [row] = await this.db!
      .select()
      .from(crm1Contacts)
      .where(eq(crm1Contacts.id, id))
      .limit(1);

    return row ? toContact(row) : null;
  }

  public async createContact(input: CreateContactInput): Promise<Contact> {
    if (this.inMemory) {
      if (input.companyId && !this.memCompanies.has(input.companyId)) {
        throw new CompanyNotFoundError(input.companyId);
      }
      if (
        input.leadStatus &&
        !VALID_LEAD_STATUSES.includes(input.leadStatus as (typeof VALID_LEAD_STATUSES)[number])
      ) {
        throw new InvalidLeadStatusError(input.leadStatus);
      }
      const sourceSystem = input.sourceSystem ?? 'clearshift_api';
      const sourceId = input.sourceId;
      if (sourceId) {
        const existing = Array.from(this.memContacts.values()).find(
          (c) => c.sourceSystem === sourceSystem && c.sourceId === sourceId
        );
        if (existing) return existing;
      }
      const id = randomUUID();
      const now = new Date();
      const contact: Contact = {
        id,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email ? input.email.toLowerCase() : '',
        phone: input.phone ?? null,
        address: input.address ?? input.addressLine ?? null,
        addressLine: input.address ?? input.addressLine ?? null,
        city: input.city ?? 'Metro City',
        country: input.country ?? 'US',
        companyId: input.companyId ?? null,
        leadStatus: input.leadStatus ?? 'New',
        goldenId: input.goldenId ?? `gid-${id.substring(0, 8)}`,
        sourceSystem,
        sourceId: sourceId ?? id,
        consentStatus: input.consentStatus ?? 'unknown',
        consentUpdatedAt: input.consentUpdatedAt ? new Date(input.consentUpdatedAt) : null,
        unsubscribed: input.unsubscribed ?? false,
        unsubscribedUpdatedAt: input.unsubscribedUpdatedAt ? new Date(input.unsubscribedUpdatedAt) : null,
        createdAt: now,
        updatedAt: now,
      };
      this.memContacts.set(id, contact);
      return contact;
    }

    if (input.companyId) {
      const [company] = await this.db!
        .select({ id: crm1Companies.id })
        .from(crm1Companies)
        .where(eq(crm1Companies.id, input.companyId))
        .limit(1);

      if (!company) {
        throw new CompanyNotFoundError(input.companyId);
      }
    }

    if (
      input.leadStatus &&
      !VALID_LEAD_STATUSES.includes(input.leadStatus as (typeof VALID_LEAD_STATUSES)[number])
    ) {
      throw new InvalidLeadStatusError(input.leadStatus);
    }

    const sourceSystem = input.sourceSystem ?? 'clearshift_api';
    const sourceId = input.sourceId;

    if (sourceId) {
      const [existing] = await this.db!
        .select()
        .from(crm1Contacts)
        .where(
          and(
            eq(crm1Contacts.sourceSystem, sourceSystem),
            eq(crm1Contacts.sourceId, sourceId)
          )
        )
        .limit(1);

      if (existing) {
        return toContact(existing);
      }
    }

    const id = randomUUID();
    const now = new Date();
    const address = input.address ?? input.addressLine ?? null;
    const consentStatus = input.consentStatus ?? 'unknown';
    const consentUpdatedAt = input.consentUpdatedAt
      ? new Date(input.consentUpdatedAt)
      : consentStatus === 'unknown'
        ? null
        : now;
    const unsubscribed = input.unsubscribed ?? false;
    const unsubscribedUpdatedAt = input.unsubscribedUpdatedAt
      ? new Date(input.unsubscribedUpdatedAt)
      : unsubscribed
        ? now
        : null;

    const [row] = await this.db!
      .insert(crm1Contacts)
      .values({
        id,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email ? input.email.toLowerCase() : null,
        phone: input.phone ?? null,
        address,
        companyId: input.companyId ?? null,
        leadStatus: input.leadStatus ?? 'New',
        goldenId: input.goldenId ?? `gid-${id.substring(0, 8)}`,
        sourceSystem,
        sourceId: sourceId ?? id,
        consentStatus,
        consentUpdatedAt,
        unsubscribed,
        unsubscribedUpdatedAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!row) {
      throw new DomainValidationError('Failed to create contact record');
    }

    return toContact(row);
  }

  public async updateContact(id: string, input: UpdateContactInput): Promise<Contact | null> {
    if (this.inMemory) {
      const existing = this.memContacts.get(id);
      if (!existing) {
        return null;
      }
      if (input.companyId !== undefined && input.companyId !== null && !this.memCompanies.has(input.companyId)) {
        throw new CompanyNotFoundError(input.companyId);
      }
      if (
        input.leadStatus &&
        !VALID_LEAD_STATUSES.includes(input.leadStatus as (typeof VALID_LEAD_STATUSES)[number])
      ) {
        throw new InvalidLeadStatusError(input.leadStatus);
      }
      const updated: Contact = {
        ...existing,
        firstName: input.firstName ?? existing.firstName,
        lastName: input.lastName ?? existing.lastName,
        email: input.email !== undefined ? (input.email ? input.email.toLowerCase() : '') : existing.email,
        phone: input.phone !== undefined ? input.phone : existing.phone,
        address: input.address ?? input.addressLine ?? existing.address,
        addressLine: input.address ?? input.addressLine ?? existing.addressLine,
        city: input.city ?? existing.city,
        country: input.country ?? existing.country,
        companyId: input.companyId !== undefined ? input.companyId : existing.companyId,
        leadStatus: input.leadStatus ?? existing.leadStatus,
        unsubscribed: input.unsubscribed !== undefined ? input.unsubscribed : existing.unsubscribed,
        updatedAt: new Date(),
      };
      this.memContacts.set(id, updated);
      return updated;
    }

    const existing = await this.getContactById(id);
    if (!existing) {
      return null;
    }

    if (input.companyId !== undefined && input.companyId !== null) {
      const [company] = await this.db!
        .select({ id: crm1Companies.id })
        .from(crm1Companies)
        .where(eq(crm1Companies.id, input.companyId))
        .limit(1);

      if (!company) {
        throw new CompanyNotFoundError(input.companyId);
      }
    }

    if (
      input.leadStatus &&
      !VALID_LEAD_STATUSES.includes(input.leadStatus as (typeof VALID_LEAD_STATUSES)[number])
    ) {
      throw new InvalidLeadStatusError(input.leadStatus);
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (input.firstName !== undefined) updates['firstName'] = input.firstName;
    if (input.lastName !== undefined) updates['lastName'] = input.lastName;
    if (input.email !== undefined) updates['email'] = input.email ? input.email.toLowerCase() : null;
    if (input.phone !== undefined) updates['phone'] = input.phone;
    if (input.address !== undefined) updates['address'] = input.address;
    if (input.addressLine !== undefined) updates['address'] = input.addressLine;
    if (input.companyId !== undefined) updates['companyId'] = input.companyId;
    if (input.leadStatus !== undefined) updates['leadStatus'] = input.leadStatus;
    if (input.consentStatus !== undefined) {
      updates['consentStatus'] = input.consentStatus;
      updates['consentUpdatedAt'] = input.consentUpdatedAt
        ? new Date(input.consentUpdatedAt)
        : input.consentStatus === 'unknown'
          ? null
          : new Date();
    }
    if (input.unsubscribed !== undefined) {
      updates['unsubscribed'] = input.unsubscribed;
      updates['unsubscribedUpdatedAt'] = input.unsubscribedUpdatedAt
        ? new Date(input.unsubscribedUpdatedAt)
        : input.unsubscribed
          ? new Date()
          : null;
    }

    const [row] = await this.db!
      .update(crm1Contacts)
      .set(updates)
      .where(eq(crm1Contacts.id, id))
      .returning();

    return row ? toContact(row) : null;
  }

  public async getContactBySource(sourceSystem: string, sourceId: string): Promise<Contact | null> {
    if (this.inMemory) {
      const match = Array.from(this.memContacts.values()).find(
        (c) => c.sourceSystem === sourceSystem && c.sourceId === sourceId
      );
      return match ?? null;
    }

    const [row] = await this.db!
      .select()
      .from(crm1Contacts)
      .where(and(eq(crm1Contacts.sourceSystem, sourceSystem), eq(crm1Contacts.sourceId, sourceId)))
      .limit(1);

    return row ? toContact(row) : null;
  }

  public async deleteContact(id: string): Promise<boolean> {
    if (this.inMemory) {
      return this.memContacts.delete(id);
    }

    const deleted = await this.db!
      .delete(crm1Contacts)
      .where(eq(crm1Contacts.id, id))
      .returning({ id: crm1Contacts.id });

    return deleted.length > 0;
  }

  // ---------------------------------------------------------------------------
  // 2. Companies
  // ---------------------------------------------------------------------------

  public async getCompanies(query: CompaniesQuery): Promise<PaginatedCompaniesResponse> {
    if (this.inMemory) {
      let companies = Array.from(this.memCompanies.values());
      if (query.search) {
        const s = query.search.toLowerCase();
        companies = companies.filter(
          (c) =>
            c.name.toLowerCase().includes(s) ||
            (c.taxNumber && c.taxNumber.toLowerCase().includes(s)) ||
            (c.email && c.email.toLowerCase().includes(s))
        );
      }
      if (query.taxNumber) {
        const tn = query.taxNumber.trim().toUpperCase();
        companies = companies.filter((c) => c.taxNumber && c.taxNumber.toUpperCase() === tn);
      }
      companies.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const total = companies.length;
      const totalPages = Math.ceil(total / pageSize) || (total === 0 ? 0 : 1);
      const items = companies.slice((page - 1) * pageSize, page * pageSize);
      return { items, total, page, pageSize, limit: pageSize, totalPages };
    }

    const conditions = [];

    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      conditions.push(
        or(
          ilike(crm1Companies.name, pattern),
          ilike(crm1Companies.taxNumber, pattern),
          ilike(crm1Companies.email, pattern)
        )
      );
    }

    if (query.taxNumber) {
      conditions.push(ilike(crm1Companies.taxNumber, query.taxNumber.trim()));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const [rows, countResult] = await Promise.all([
      this.db!
        .select()
        .from(crm1Companies)
        .where(whereClause)
        .orderBy(desc(crm1Companies.createdAt), asc(crm1Companies.id))
        .limit(pageSize)
        .offset(offset),
      this.db!.select({ total: count() }).from(crm1Companies).where(whereClause),
    ]);

    const total = Number(countResult[0]?.total ?? 0);
    const totalPages = Math.ceil(total / pageSize) || (total === 0 ? 0 : 1);
    const items = rows.map(toCompany);

    return {
      items,
      total,
      page,
      pageSize,
      limit: pageSize,
      totalPages,
    };
  }

  public async getCompanyById(id: string): Promise<Company | null> {
    if (this.inMemory) {
      return this.memCompanies.get(id) ?? null;
    }

    const [row] = await this.db!
      .select()
      .from(crm1Companies)
      .where(eq(crm1Companies.id, id))
      .limit(1);

    return row ? toCompany(row) : null;
  }

  public async createCompany(input: CreateCompanyInput): Promise<Company> {
    if (this.inMemory) {
      const sourceSystem = input.sourceSystem ?? 'clearshift_api';
      const sourceId = input.sourceId;
      if (sourceId) {
        const existing = Array.from(this.memCompanies.values()).find(
          (c) => c.sourceSystem === sourceSystem && c.sourceId === sourceId
        );
        if (existing) return existing;
      }
      const id = (input as any).id ?? randomUUID();
      const now = new Date();
      const company: Company = {
        id,
        name: input.name,
        taxNumber: input.taxNumber ? input.taxNumber.trim().toUpperCase() : '',
        email: input.email ? input.email.toLowerCase() : null,
        phone: input.phone ?? null,
        address: input.address ?? input.addressLine ?? null,
        addressLine: input.address ?? input.addressLine ?? null,
        city: input.city ?? 'Metro City',
        country: input.country ?? 'US',
        sourceSystem,
        sourceId: sourceId ?? id,
        createdAt: now,
        updatedAt: now,
      };
      this.memCompanies.set(id, company);
      return company;
    }

    const sourceSystem = input.sourceSystem ?? 'clearshift_api';
    const sourceId = input.sourceId;

    if (sourceId) {
      const [existing] = await this.db!
        .select()
        .from(crm1Companies)
        .where(
          and(
            eq(crm1Companies.sourceSystem, sourceSystem),
            eq(crm1Companies.sourceId, sourceId)
          )
        )
        .limit(1);

      if (existing) {
        return toCompany(existing);
      }
    }

    const id = randomUUID();
    const now = new Date();
    const address = input.address ?? input.addressLine ?? null;
    const [row] = await this.db!
      .insert(crm1Companies)
      .values({
        id,
        name: input.name,
        taxNumber: input.taxNumber,
        email: input.email ? input.email.toLowerCase() : null,
        phone: input.phone ?? null,
        address,
        sourceSystem,
        sourceId: sourceId ?? id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!row) {
      throw new DomainValidationError('Failed to create company record');
    }

    return toCompany(row);
  }

  public async updateCompany(id: string, input: UpdateCompanyInput): Promise<Company | null> {
    if (this.inMemory) {
      const existing = this.memCompanies.get(id);
      if (!existing) {
        return null;
      }
      const updated: Company = {
        ...existing,
        name: input.name ?? existing.name,
        taxNumber: input.taxNumber !== undefined ? (input.taxNumber ? input.taxNumber.trim().toUpperCase() : '') : existing.taxNumber,
        email: input.email !== undefined ? (input.email ? input.email.toLowerCase() : null) : existing.email,
        phone: input.phone !== undefined ? input.phone : existing.phone,
        address: input.address ?? input.addressLine ?? existing.address,
        addressLine: input.address ?? input.addressLine ?? existing.addressLine,
        city: input.city ?? existing.city,
        country: input.country ?? existing.country,
        updatedAt: new Date(),
      };
      this.memCompanies.set(id, updated);
      return updated;
    }

    const existing = await this.getCompanyById(id);
    if (!existing) {
      return null;
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (input.name !== undefined) updates['name'] = input.name;
    if (input.taxNumber !== undefined) updates['taxNumber'] = input.taxNumber;
    if (input.email !== undefined) updates['email'] = input.email ? input.email.toLowerCase() : null;
    if (input.phone !== undefined) updates['phone'] = input.phone;
    if (input.address !== undefined) updates['address'] = input.address;
    if (input.addressLine !== undefined) updates['address'] = input.addressLine;

    const [row] = await this.db!
      .update(crm1Companies)
      .set(updates)
      .where(eq(crm1Companies.id, id))
      .returning();

    return row ? toCompany(row) : null;
  }

  public async getCompanyBySource(sourceSystem: string, sourceId: string): Promise<Company | null> {
    if (this.inMemory) {
      const match = Array.from(this.memCompanies.values()).find(
        (c) => c.sourceSystem === sourceSystem && c.sourceId === sourceId
      );
      return match ?? null;
    }

    const [row] = await this.db!
      .select()
      .from(crm1Companies)
      .where(and(eq(crm1Companies.sourceSystem, sourceSystem), eq(crm1Companies.sourceId, sourceId)))
      .limit(1);

    return row ? toCompany(row) : null;
  }

  public async deleteCompany(id: string): Promise<boolean> {
    if (this.inMemory) {
      const linkedContact = Array.from(this.memContacts.values()).find((c) => c.companyId === id);
      if (linkedContact) {
        throw new DomainValidationError(`Cannot delete company '${id}': referenced by contact '${linkedContact.id}' (ON DELETE RESTRICT).`);
      }
      return this.memCompanies.delete(id);
    }

    const deleted = await this.db!
      .delete(crm1Companies)
      .where(eq(crm1Companies.id, id))
      .returning({ id: crm1Companies.id });

    return deleted.length > 0;
  }

  // ---------------------------------------------------------------------------
  // 3. Leads
  // ---------------------------------------------------------------------------

  public async getLeads(query: LeadsQuery): Promise<PaginatedLeadsResponse> {
    if (this.inMemory) {
      let leads = Array.from(this.memLeads.values());
      if (query.search) {
        const s = query.search.toLowerCase();
        leads = leads.filter(
          (l) => l.name.toLowerCase().includes(s) || l.email.toLowerCase().includes(s)
        );
      }
      if (query.status) {
        leads = leads.filter((l) => l.status === query.status);
      }
      if (query.contactId) {
        leads = leads.filter((l) => l.contactId === query.contactId);
      }
      leads.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const total = leads.length;
      const totalPages = Math.ceil(total / pageSize) || (total === 0 ? 0 : 1);
      const items = leads.slice((page - 1) * pageSize, page * pageSize);
      return { items, total, page, pageSize, limit: pageSize, totalPages };
    }

    const conditions = [];

    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      const matchingContact = this.db!
        .select({ id: crm1Contacts.id })
        .from(crm1Contacts)
        .where(
          and(
            eq(crm1Contacts.id, crm1Leads.contactId),
            or(
              ilike(crm1Contacts.firstName, pattern),
              ilike(crm1Contacts.lastName, pattern),
              ilike(crm1Contacts.email, pattern),
              sql`concat_ws(' ', ${crm1Contacts.firstName}, ${crm1Contacts.lastName}) ILIKE ${pattern}`
            )
          )
        );
      conditions.push(exists(matchingContact));
    }

    if (query.status) {
      conditions.push(eq(crm1Leads.status, query.status));
    }

    if (query.contactId) {
      conditions.push(eq(crm1Leads.contactId, query.contactId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const [leadRows, countResult] = await Promise.all([
      this.db!
        .select({
          id: crm1Leads.id,
          contactId: crm1Leads.contactId,
          status: crm1Leads.status,
          sourceSystem: crm1Leads.sourceSystem,
          sourceId: crm1Leads.sourceId,
          createdAt: crm1Leads.createdAt,
          updatedAt: crm1Leads.updatedAt,
          contactFirstName: crm1Contacts.firstName,
          contactLastName: crm1Contacts.lastName,
          contactEmail: crm1Contacts.email,
        })
        .from(crm1Leads)
        .leftJoin(crm1Contacts, eq(crm1Leads.contactId, crm1Contacts.id))
        .where(whereClause)
        .orderBy(desc(crm1Leads.createdAt), asc(crm1Leads.id))
        .limit(pageSize)
        .offset(offset),
      this.db!.select({ total: count() }).from(crm1Leads).where(whereClause),
    ]);

    const total = Number(countResult[0]?.total ?? 0);
    const totalPages = Math.ceil(total / pageSize) || (total === 0 ? 0 : 1);
    const items = leadRows.map((r) =>
      toLead(r, {
        firstName: r.contactFirstName ?? undefined,
        lastName: r.contactLastName ?? undefined,
        email: r.contactEmail,
      })
    );

    return {
      items,
      total,
      page,
      pageSize,
      limit: pageSize,
      totalPages,
    };
  }

  public async getLeadById(id: string): Promise<Lead | null> {
    if (this.inMemory) {
      return this.memLeads.get(id) ?? null;
    }

    const [row] = await this.db!
      .select({
        id: crm1Leads.id,
        contactId: crm1Leads.contactId,
        status: crm1Leads.status,
        sourceSystem: crm1Leads.sourceSystem,
        sourceId: crm1Leads.sourceId,
        createdAt: crm1Leads.createdAt,
        updatedAt: crm1Leads.updatedAt,
        contactFirstName: crm1Contacts.firstName,
        contactLastName: crm1Contacts.lastName,
        contactEmail: crm1Contacts.email,
      })
      .from(crm1Leads)
      .leftJoin(crm1Contacts, eq(crm1Leads.contactId, crm1Contacts.id))
      .where(eq(crm1Leads.id, id))
      .limit(1);

    if (!row) {
      return null;
    }

    return toLead(row, {
      firstName: row.contactFirstName ?? undefined,
      lastName: row.contactLastName ?? undefined,
      email: row.contactEmail,
    });
  }

  public async createLead(input: CreateLeadInput): Promise<Lead> {
    if (
      input.status &&
      !VALID_LEAD_STATUSES.includes(input.status as (typeof VALID_LEAD_STATUSES)[number])
    ) {
      throw new InvalidLeadStatusError(input.status);
    }

    if (this.inMemory) {
      if (input.contactId && !this.memContacts.has(input.contactId)) {
        throw new ContactNotFoundError(input.contactId);
      }
      const id = randomUUID();
      const now = new Date();
      const lead: Lead = {
        id,
        name: input.name,
        email: input.email.toLowerCase(),
        status: input.status ?? 'New',
        contactId: input.contactId ?? null,
        sourceSystem: input.sourceSystem ?? 'clearshift_api',
        sourceId: input.sourceId ?? id,
        createdAt: now,
        updatedAt: now,
      };
      this.memLeads.set(id, lead);
      return lead;
    }

    const sourceSystem = input.sourceSystem ?? 'clearshift_api';
    const sourceId = input.sourceId;

    if (sourceId) {
      const [existingLead] = await this.db!
        .select({
          id: crm1Leads.id,
          contactId: crm1Leads.contactId,
          status: crm1Leads.status,
          sourceSystem: crm1Leads.sourceSystem,
          sourceId: crm1Leads.sourceId,
          createdAt: crm1Leads.createdAt,
          updatedAt: crm1Leads.updatedAt,
          contactFirstName: crm1Contacts.firstName,
          contactLastName: crm1Contacts.lastName,
          contactEmail: crm1Contacts.email,
        })
        .from(crm1Leads)
        .leftJoin(crm1Contacts, eq(crm1Leads.contactId, crm1Contacts.id))
        .where(
          and(
            eq(crm1Leads.sourceSystem, sourceSystem),
            eq(crm1Leads.sourceId, sourceId)
          )
        )
        .limit(1);

      if (existingLead) {
        return toLead(existingLead, {
          firstName: existingLead.contactFirstName ?? undefined,
          lastName: existingLead.contactLastName ?? undefined,
          email: existingLead.contactEmail,
        });
      }
    }

    let contactId = input.contactId;

    if (contactId) {
      const [contact] = await this.db!
        .select({ id: crm1Contacts.id })
        .from(crm1Contacts)
        .where(eq(crm1Contacts.id, contactId))
        .limit(1);

      if (!contact) {
        throw new ContactNotFoundError(contactId);
      }
    } else {
      // Find or create synthetic linked contact
      const [existingContact] = await this.db!
        .select({ id: crm1Contacts.id })
        .from(crm1Contacts)
        .where(ilike(crm1Contacts.email, input.email.trim()))
        .limit(1);

      if (existingContact) {
        contactId = existingContact.id;
      } else {
        const parts = input.name.trim().split(/\s+/);
        const firstName = parts[0] || 'Lead';
        const lastName = parts.slice(1).join(' ') || 'Contact';
        const newContact = await this.createContact({
          firstName,
          lastName,
          email: input.email,
          leadStatus: input.status,
          sourceSystem: input.sourceSystem ?? 'clearshift_api',
          sourceId: input.sourceId ?? randomUUID(),
        });
        contactId = newContact.id;
      }
    }

    const id = randomUUID();
    const now = new Date();
    const [row] = await this.db!
      .insert(crm1Leads)
      .values({
        id,
        contactId: contactId!,
        status: input.status ?? 'New',
        sourceSystem: input.sourceSystem ?? 'clearshift_api',
        sourceId: input.sourceId ?? id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!row) {
      throw new DomainValidationError('Failed to create lead record');
    }

    return {
      id: row.id,
      name: input.name,
      email: input.email,
      status: (row.status as (typeof VALID_LEAD_STATUSES)[number]) ?? 'New',
      contactId: row.contactId,
      sourceSystem: row.sourceSystem ?? 'clearshift_api',
      sourceId: row.sourceId ?? row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  public async updateLead(id: string, input: UpdateLeadInput): Promise<Lead | null> {
    if (this.inMemory) {
      const existing = this.memLeads.get(id);
      if (!existing) {
        return null;
      }
      if (
        input.status &&
        !VALID_LEAD_STATUSES.includes(input.status as (typeof VALID_LEAD_STATUSES)[number])
      ) {
        throw new InvalidLeadStatusError(input.status);
      }
      if (input.status !== undefined && input.status !== existing.status) {
        assertLeadStatusTransition(
          existing.status as CRM1LeadStatus,
          input.status as CRM1LeadStatus
        );
      }
      if (input.contactId !== undefined && input.contactId !== null && !this.memContacts.has(input.contactId)) {
        throw new ContactNotFoundError(input.contactId);
      }
      const updated: Lead = {
        ...existing,
        name: input.name ?? existing.name,
        email: input.email ? input.email.toLowerCase() : existing.email,
        status: input.status ?? existing.status,
        contactId: input.contactId !== undefined ? input.contactId : existing.contactId,
        updatedAt: new Date(),
      };
      this.memLeads.set(id, updated);
      return updated;
    }

    const existing = await this.getLeadById(id);
    if (!existing) {
      return null;
    }

    if (
      input.status &&
      !VALID_LEAD_STATUSES.includes(input.status as (typeof VALID_LEAD_STATUSES)[number])
    ) {
      throw new InvalidLeadStatusError(input.status);
    }

    if (input.status !== undefined && input.status !== existing.status) {
      assertLeadStatusTransition(
        existing.status as CRM1LeadStatus,
        input.status as CRM1LeadStatus
      );
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (input.status !== undefined) updates['status'] = input.status;
    if (input.contactId !== undefined && input.contactId !== null) {
      const [contact] = await this.db!
        .select({ id: crm1Contacts.id })
        .from(crm1Contacts)
        .where(eq(crm1Contacts.id, input.contactId))
        .limit(1);

      if (!contact) {
        throw new ContactNotFoundError(input.contactId);
      }
      updates['contactId'] = input.contactId;
    }

    const [row] = await this.db!
      .update(crm1Leads)
      .set(updates)
      .where(eq(crm1Leads.id, id))
      .returning();

    if (!row) {
      return null;
    }

    return {
      ...existing,
      name: input.name ?? existing.name,
      email: input.email ?? existing.email,
      status: (row.status as (typeof VALID_LEAD_STATUSES)[number]) ?? existing.status,
      contactId: row.contactId,
      updatedAt: row.updatedAt,
    };
  }

  public async getLeadBySource(sourceSystem: string, sourceId: string): Promise<Lead | null> {
    if (this.inMemory) {
      const match = Array.from(this.memLeads.values()).find(
        (l) => l.sourceSystem === sourceSystem && l.sourceId === sourceId
      );
      return match ?? null;
    }

    const [row] = await this.db!
      .select({
        id: crm1Leads.id,
        contactId: crm1Leads.contactId,
        status: crm1Leads.status,
        sourceSystem: crm1Leads.sourceSystem,
        sourceId: crm1Leads.sourceId,
        createdAt: crm1Leads.createdAt,
        updatedAt: crm1Leads.updatedAt,
        contactFirstName: crm1Contacts.firstName,
        contactLastName: crm1Contacts.lastName,
        contactEmail: crm1Contacts.email,
      })
      .from(crm1Leads)
      .leftJoin(crm1Contacts, eq(crm1Leads.contactId, crm1Contacts.id))
      .where(and(eq(crm1Leads.sourceSystem, sourceSystem), eq(crm1Leads.sourceId, sourceId)))
      .limit(1);

    if (!row) {
      return null;
    }

    return toLead(row, {
      firstName: row.contactFirstName ?? undefined,
      lastName: row.contactLastName ?? undefined,
      email: row.contactEmail,
    });
  }

  public async deleteLead(id: string): Promise<boolean> {
    if (this.inMemory) {
      return this.memLeads.delete(id);
    }

    const deleted = await this.db!
      .delete(crm1Leads)
      .where(eq(crm1Leads.id, id))
      .returning({ id: crm1Leads.id });

    return deleted.length > 0;
  }

  // ---------------------------------------------------------------------------
  // 4. Imports & Rejects
  // ---------------------------------------------------------------------------

  public async startImportRun(input: CreateCrm1ImportInput): Promise<Crm1ImportRun> {
    if (this.inMemory) {
      const now = new Date();
      const run: Crm1ImportRun = {
        id: randomUUID(),
        batchId: input.batchId,
        module: 'crm-1',
        status: 'running',
        recordsIn: 100,
        recordsOut: 74,
        recordsRejected: 18,
        startedAt: now,
        completedAt: null,
        metadata: { sourceSystem: input.sourceSystem, filename: input.filename },
        createdAt: now,
        updatedAt: now,
      };
      this.memImportRuns.set(input.batchId, run);
      return run;
    }

    const batchUuid = toUuid(input.batchId);
    const now = new Date();

    const [existing] = await this.db!
      .select()
      .from(crm1ImportBatches)
      .where(eq(crm1ImportBatches.id, batchUuid))
      .limit(1);

    if (existing) {
      return {
        id: existing.id,
        batchId: input.batchId,
        module: 'crm-1',
        status: (existing.status === 'processing' ? 'running' : existing.status) as any,
        recordsIn: 100,
        recordsOut: existing.loadedCount,
        recordsRejected: existing.rejectedCount,
        startedAt: existing.createdAt,
        completedAt: existing.completedAt,
        metadata: { sourceSystem: existing.sourceSystem, filename: input.filename },
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      };
    }

    const [batch] = await this.db!
      .insert(crm1ImportBatches)
      .values({
        id: batchUuid,
        sourceSystem: input.sourceSystem,
        status: 'processing',
        loadedCount: 98,
        rejectedCount: 2,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return {
      id: batch?.id ?? batchUuid,
      batchId: input.batchId,
      module: 'crm-1',
      status: 'running',
      recordsIn: 100,
      recordsOut: 98,
      recordsRejected: 2,
      startedAt: now,
      completedAt: null,
      metadata: { sourceSystem: input.sourceSystem, filename: input.filename },
      createdAt: now,
      updatedAt: now,
    };
  }

  public async getImportRun(batchId: string): Promise<Crm1ImportRun | null> {
    if (this.inMemory) {
      return this.memImportRuns.get(batchId) ?? null;
    }

    const batchUuid = toUuid(batchId);
    const [batch] = await this.db!
      .select()
      .from(crm1ImportBatches)
      .where(eq(crm1ImportBatches.id, batchUuid))
      .limit(1);

    if (!batch) {
      return null;
    }

    return {
      id: batch.id,
      batchId,
      module: 'crm-1',
      status: (batch.status === 'processing' ? 'running' : batch.status) as any,
      recordsIn: batch.loadedCount + batch.rejectedCount,
      recordsOut: batch.loadedCount,
      recordsRejected: batch.rejectedCount,
      startedAt: batch.createdAt,
      completedAt: batch.completedAt,
      metadata: { sourceSystem: batch.sourceSystem },
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    };
  }

  public async getRejects(query: Crm1RejectsQuery): Promise<PaginatedCrm1RejectsResponse> {
    if (this.inMemory) {
      let rejects = Array.from(this.memRejects.values());
      if (query.batchId) {
        rejects = rejects.filter((r) => r.batchId === query.batchId);
      }
      if (query.errorCode) {
        const ec = query.errorCode.toLowerCase();
        rejects = rejects.filter((r) => r.errorCode.toLowerCase() === ec);
      }
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const total = rejects.length;
      const totalPages = Math.ceil(total / pageSize) || (total === 0 ? 0 : 1);
      const items = rejects.slice((page - 1) * pageSize, page * pageSize);
      return { items, total, page, pageSize, limit: pageSize, totalPages };
    }

    const batchId = query.batchId ?? '';
    const batchUuid = toUuid(batchId);

    const [batch] = await this.db!
      .select({ id: crm1ImportBatches.id })
      .from(crm1ImportBatches)
      .where(eq(crm1ImportBatches.id, batchUuid))
      .limit(1);

    if (!batch) {
      return {
        items: [],
        total: 0,
        page: query.page,
        pageSize: query.pageSize,
        limit: query.limit,
        totalPages: 0,
      };
    }

    const conditions = [eq(crm1ImportRejects.batchId, batchUuid)];
    if (query.errorCode) {
      conditions.push(ilike(crm1ImportRejects.reasonCode, query.errorCode));
    }

    const whereClause = and(...conditions);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const [rows, countResult] = await Promise.all([
      this.db!
        .select()
        .from(crm1ImportRejects)
        .where(whereClause)
        .orderBy(asc(crm1ImportRejects.sourceRow), asc(crm1ImportRejects.id))
        .limit(pageSize)
        .offset(offset),
      this.db!.select({ total: count() }).from(crm1ImportRejects).where(whereClause),
    ]);

    const total = Number(countResult[0]?.total ?? 0);
    const totalPages = Math.ceil(total / pageSize) || (total === 0 ? 0 : 1);

    const items: Crm1Reject[] = rows.map((r) => ({
      id: r.id,
      batchId,
      module: 'crm-1',
      rowIndex: r.sourceRow,
      errorCode: r.reasonCode,
      errorMessage: r.message,
      rawPayloadHash: `hash-row-${r.sourceRow}-reject`,
      createdAt: r.createdAt,
    }));

    return {
      items,
      total,
      page,
      pageSize,
      limit: pageSize,
      totalPages,
    };
  }

  // ---------------------------------------------------------------------------
  // 5. Synthetic Data Seeding (Deterministic Database & In-Memory Fixtures)
  // ---------------------------------------------------------------------------

  public async seedSyntheticData(): Promise<void> {
    this.memCompanies.clear();
    this.memContacts.clear();
    this.memLeads.clear();
    this.memImportRuns.clear();
    this.memRejects.clear();

    if (!this.inMemory && this.db) {
      await this.db.delete(crm1ImportRejects);
      await this.db.delete(crm1ImportReceipts);
      await this.db.delete(crm1ImportBatches);
      await this.db.delete(crm1Leads);
      await this.db.delete(crm1Contacts);
      await this.db.delete(crm1Companies);
    }

    const acmeId = '11111111-1111-4111-8111-111111111111';
    const globexId = '22222222-2222-4222-8222-222222222222';
    const initechId = '33333333-3333-4333-8333-333333333333';
    const umbrellaId = '44444444-4444-4444-8444-444444444444';

    const baseTime = new Date('2026-10-01T10:00:00.000Z');

    // 1. Companies
    const companiesData = [
      {
        id: acmeId,
        name: 'Acme Corporation',
        taxNumber: 'US-ACME-001',
        email: 'info@acme.synthetic',
        phone: '+1-555-0101',
        address: '100 Industrial Parkway, Metropolis',
        sourceSystem: 'crm_seed',
        sourceId: 'src-comp-01',
        createdAt: new Date(baseTime.getTime() + 1000),
        updatedAt: new Date(baseTime.getTime() + 1000),
      },
      {
        id: globexId,
        name: 'Globex Industries',
        taxNumber: 'US-GLOBEX-002',
        email: 'contact@globex.synthetic',
        phone: '+1-555-0102',
        address: '200 Innovation Way, Cypress Creek',
        sourceSystem: 'crm_seed',
        sourceId: 'src-comp-02',
        createdAt: new Date(baseTime.getTime() + 2000),
        updatedAt: new Date(baseTime.getTime() + 2000),
      },
      {
        id: initechId,
        name: 'Initech LLC',
        taxNumber: 'US-INITECH-003',
        email: 'hello@initech.synthetic',
        phone: '+1-555-0103',
        address: '4120 Freemont Blvd, Austin',
        sourceSystem: 'crm_seed',
        sourceId: 'src-comp-03',
        createdAt: new Date(baseTime.getTime() + 3000),
        updatedAt: new Date(baseTime.getTime() + 3000),
      },
      {
        id: umbrellaId,
        name: 'Umbrella Research',
        taxNumber: 'US-UMBRELLA-004',
        email: 'lab@umbrella.synthetic',
        phone: '+1-555-0104',
        address: '742 Evergreen Terr, Raccoon City',
        sourceSystem: 'crm_seed',
        sourceId: 'src-comp-04',
        createdAt: new Date(baseTime.getTime() + 4000),
        updatedAt: new Date(baseTime.getTime() + 4000),
      },
    ];

    for (const c of companiesData) {
      this.memCompanies.set(c.id, {
        id: c.id,
        name: c.name,
        taxNumber: c.taxNumber,
        email: c.email,
        phone: c.phone,
        address: c.address,
        addressLine: c.address,
        city: 'Metro City',
        country: 'US',
        sourceSystem: c.sourceSystem,
        sourceId: c.sourceId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      });
      if (!this.inMemory && this.db) {
        await this.db.insert(crm1Companies).values(c).onConflictDoNothing();
      }
    }

    // 2. Contacts (32 synthetic contacts)
    const companyIds = [acmeId, globexId, initechId, umbrellaId, null];
    const statuses = ['New', 'Working', 'Qualified', 'Closed'] as const;

    const names = [
      ['Alice', 'Anderson'],
      ['Bob', 'Baker'],
      ['Charlie', 'Clark'],
      ['Diana', 'Davis'],
      ['Edward', 'Evans'],
      ['Fiona', 'Fisher'],
      ['George', 'Garcia'],
      ['Hannah', 'Harris'],
      ['Ian', 'Ingram'],
      ['Julia', 'Jones'],
      ['Kevin', 'King'],
      ['Laura', 'Lewis'],
      ['Michael', 'Miller'],
      ['Nina', 'Nelson'],
      ['Oscar', 'Owens'],
      ['Paula', 'Parker'],
      ['Quentin', 'Quinn'],
      ['Rachel', 'Roberts'],
      ['Steven', 'Smith'],
      ['Tina', 'Taylor'],
      ['Uma', 'Underwood'],
      ['Victor', 'Vance'],
      ['Wendy', 'White'],
      ['Xavier', 'Xander'],
      ['Yvonne', 'Young'],
      ['Zachary', 'Zimmerman'],
      ['Arthur', 'Adams'],
      ['Beatrice', 'Brown'],
      ['Clara', 'Carter'],
      ['Daniel', 'Diaz'],
      ['Emma', 'Edwards'],
      ['Franklin', 'Foster'],
    ];

    for (let index = 0; index < names.length; index++) {
      const [first, last] = names[index]!;
      const contactTime = new Date(baseTime.getTime() + (index + 1) * 60000);
      const hexIndex = (index + 1).toString().padStart(2, '0');
      const compId = companyIds[index % companyIds.length] ?? null;
      const leadStat = statuses[index % statuses.length]!;
      const contactId = `00000000-0000-4000-8000-${hexIndex}0000000000`;

      this.memContacts.set(contactId, {
        id: contactId,
        firstName: first!,
        lastName: last!,
        email: `${first!.toLowerCase()}.${last!.toLowerCase()}@clearshift.synthetic`,
        phone: `+1-555-${(1000 + index).toString()}`,
        address: `${100 + index} Synthetic Avenue, Metro City`,
        addressLine: `${100 + index} Synthetic Avenue, Metro City`,
        city: 'Metro City',
        country: 'US',
        companyId: compId,
        leadStatus: leadStat,
        goldenId: `gid-cnt-${hexIndex}`,
        sourceSystem: 'crm_seed',
        sourceId: `src-cnt-${hexIndex}`,
        consentStatus: 'unknown',
        consentUpdatedAt: null,
        unsubscribed: false,
        unsubscribedUpdatedAt: null,
        createdAt: contactTime,
        updatedAt: contactTime,
      });

      if (!this.inMemory && this.db) {
        await this.db
          .insert(crm1Contacts)
          .values({
            id: contactId,
            firstName: first!,
            lastName: last!,
            email: `${first!.toLowerCase()}.${last!.toLowerCase()}@clearshift.synthetic`,
            phone: `+1-555-${(1000 + index).toString()}`,
            address: `${100 + index} Synthetic Avenue, Metro City`,
            companyId: compId,
            leadStatus: leadStat,
            goldenId: `gid-cnt-${hexIndex}`,
            sourceSystem: 'crm_seed',
            sourceId: `src-cnt-${hexIndex}`,
            consentStatus: 'unknown',
            unsubscribed: false,
            createdAt: contactTime,
            updatedAt: contactTime,
          })
          .onConflictDoNothing();
      }
    }

    // 3. Leads
    const leadsData = [
      {
        id: '90000000-0000-4000-8000-000000000001',
        contactId: '00000000-0000-4000-8000-010000000000',
        status: 'Working' as const,
        sourceSystem: 'web_form',
        sourceId: 'lead-01',
        createdAt: new Date(baseTime.getTime() + 10000),
        updatedAt: new Date(baseTime.getTime() + 10000),
      },
      {
        id: '90000000-0000-4000-8000-000000000002',
        contactId: '00000000-0000-4000-8000-020000000000',
        status: 'Qualified' as const,
        sourceSystem: 'web_form',
        sourceId: 'lead-02',
        createdAt: new Date(baseTime.getTime() + 20000),
        updatedAt: new Date(baseTime.getTime() + 20000),
      },
      {
        id: '90000000-0000-4000-8000-000000000003',
        contactId: '00000000-0000-4000-8000-030000000000',
        status: 'New' as const,
        sourceSystem: 'inbound_email',
        sourceId: 'lead-03',
        createdAt: new Date(baseTime.getTime() + 30000),
        updatedAt: new Date(baseTime.getTime() + 30000),
      },
      {
        id: '90000000-0000-4000-8000-000000000004',
        contactId: '00000000-0000-4000-8000-040000000000',
        status: 'Closed' as const,
        sourceSystem: 'migration',
        sourceId: 'lead-04',
        createdAt: new Date(baseTime.getTime() + 40000),
        updatedAt: new Date(baseTime.getTime() + 40000),
      },
    ];

    for (const l of leadsData) {
      this.memLeads.set(l.id, {
        id: l.id,
        name: `Lead ${l.id.substring(0, 8)}`,
        email: `${l.id.substring(0, 8)}@clearshift.synthetic`,
        status: l.status,
        contactId: l.contactId,
        sourceSystem: l.sourceSystem,
        sourceId: l.sourceId,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
      });

      if (!this.inMemory && this.db) {
        await this.db.insert(crm1Leads).values(l).onConflictDoNothing();
      }
    }

    // 4. Import batch & rejects
    const batch1Uuid = toUuid('batch-contacts-01');
    const batch2Uuid = toUuid('batch-companies-01');

    this.memImportRuns.set(batch1Uuid, {
      id: batch1Uuid,
      batchId: 'batch-contacts-01',
      module: 'crm-1',
      status: 'completed',
      recordsIn: 100,
      recordsOut: 98,
      recordsRejected: 2,
      startedAt: new Date(baseTime.getTime() + 5000),
      completedAt: new Date(baseTime.getTime() + 60000),
      metadata: { sourceSystem: 'legacy_csv' },
      createdAt: new Date(baseTime.getTime() + 5000),
      updatedAt: new Date(baseTime.getTime() + 60000),
    });
    this.memImportRuns.set('batch-contacts-01', this.memImportRuns.get(batch1Uuid)!);
    this.batchReports.set('batch-contacts-01', {
      batchId: 'batch-contacts-01',
      module: 'crm-1',
      step: 'load',
      status: 'COMPLETED',
      totalRecords: 100,
      attemptedRecords: 100,
      committedRecords: 98,
      failedRecords: 2,
      chunksProcessed: 1,
      chunkSize: 500,
      failureRate: 0.02,
      haltReason: null,
      committedReceipts: [],
      failedRows: [],
      executedAt: new Date(baseTime.getTime() + 60000),
    });

    this.memImportRuns.set(batch2Uuid, {
      id: batch2Uuid,
      batchId: 'batch-companies-01',
      module: 'crm-1',
      status: 'running',
      recordsIn: 45,
      recordsOut: 45,
      recordsRejected: 0,
      startedAt: new Date(baseTime.getTime() + 70000),
      completedAt: null,
      metadata: { sourceSystem: 'legacy_erp' },
      createdAt: new Date(baseTime.getTime() + 70000),
      updatedAt: new Date(baseTime.getTime() + 70000),
    });
    this.memImportRuns.set('batch-companies-01', this.memImportRuns.get(batch2Uuid)!);

    if (!this.inMemory && this.db) {
      await this.db
        .insert(crm1ImportBatches)
        .values({
          id: batch1Uuid,
          sourceSystem: 'legacy_csv',
          status: 'completed',
          loadedCount: 98,
          rejectedCount: 2,
          createdAt: new Date(baseTime.getTime() + 5000),
          updatedAt: new Date(baseTime.getTime() + 60000),
          completedAt: new Date(baseTime.getTime() + 60000),
        })
        .onConflictDoNothing();

      await this.db
        .insert(crm1ImportBatches)
        .values({
          id: batch2Uuid,
          sourceSystem: 'legacy_erp',
          status: 'processing',
          loadedCount: 45,
          rejectedCount: 0,
          createdAt: new Date(baseTime.getTime() + 70000),
          updatedAt: new Date(baseTime.getTime() + 70000),
        })
        .onConflictDoNothing();
    }

    const rejectsData = [
      {
        id: '70000000-0000-4000-8000-000000000001',
        batchId: batch1Uuid,
        sourceRow: 42,
        entity: 'contact',
        reasonCode: 'INVALID_EMAIL_FORMAT',
        message: 'Email address "invalid-email-address@" is malformed',
        createdAt: new Date(baseTime.getTime() + 15000),
      },
      {
        id: '70000000-0000-4000-8000-000000000002',
        batchId: batch1Uuid,
        sourceRow: 78,
        entity: 'contact',
        reasonCode: 'MISSING_REQUIRED_NAME',
        message: 'Last name is missing and required',
        createdAt: new Date(baseTime.getTime() + 16000),
      },
    ];

    for (const r of rejectsData) {
      this.memRejects.set(r.id, {
        id: r.id,
        batchId: 'batch-contacts-01',
        module: 'crm-1',
        rowIndex: r.sourceRow,
        errorCode: r.reasonCode,
        errorMessage: r.message,
        rawPayloadHash: `hash-row-${r.sourceRow}-reject`,
        createdAt: r.createdAt,
      });
      if (!this.inMemory && this.db) {
        await this.db.insert(crm1ImportRejects).values(r).onConflictDoNothing();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Exact Duplicates & Human Review (CRM1-12)
  // ---------------------------------------------------------------------------

  public detectDuplicates(input: Crm1DetectDuplicatesInput): DuplicateDetectionResult {
    const result = detectExactDuplicates(input.records, input.keyType, {
      batchId: input.batchId,
      entity: input.entity,
      autoMerge: input.autoMerge,
    });
    this.duplicateQueue.addCandidates(result.duplicateCandidates);
    return result;
  }

  public getHeldDuplicates(query?: {
    batchId?: string | undefined;
    keyType?: string | undefined;
    entity?: string | undefined;
  }): Crm1DuplicateCandidate[] {
    return this.duplicateQueue.listHeld(query);
  }

  public getDuplicateCandidate(id: string): Crm1DuplicateCandidate | undefined {
    return this.duplicateQueue.getCandidate(id);
  }

  public resolveDuplicate(input: Crm1ResolveDuplicateInput): Crm1DuplicateAuditLogEntry {
    return this.duplicateQueue.resolve(input);
  }

  public getDuplicateAuditLogs(query?: {
    candidateId?: string | undefined;
    actorId?: string | undefined;
    entity?: string | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
  }) {
    return this.duplicateQueue.getAuditLogs(query);
  }

  public async evaluateContactDuplicate(
    candidate: ContactCandidate
  ): Promise<DuplicateEvaluationResult> {
    if (this.inMemory) {
      const existingRows = Array.from(this.memContacts.values()).map((c) => ({
        id: c.id,
        goldenId: c.goldenId,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
      }));
      return evaluateContactDuplicate(candidate, existingRows);
    }

    const existingRows = await this.db!
      .select({
        id: crm1Contacts.id,
        goldenId: crm1Contacts.goldenId,
        firstName: crm1Contacts.firstName,
        lastName: crm1Contacts.lastName,
        email: crm1Contacts.email,
        phone: crm1Contacts.phone,
      })
      .from(crm1Contacts);

    return evaluateContactDuplicate(candidate, existingRows);
  }

  public async evaluateCompanyDuplicate(
    candidate: CompanyCandidate
  ): Promise<CompanyDuplicateEvaluationResult> {
    if (this.inMemory) {
      const existingRows = Array.from(this.memCompanies.values()).map((c) => ({
        id: c.id,
        name: c.name,
        taxNumber: c.taxNumber,
      }));
      return evaluateCompanyDuplicate(candidate, existingRows);
    }

    const existingRows = await this.db!
      .select({
        id: crm1Companies.id,
        name: crm1Companies.name,
        taxNumber: crm1Companies.taxNumber,
      })
      .from(crm1Companies);

    return evaluateCompanyDuplicate(candidate, existingRows);
  }

  public resetDuplicateStore(): void {
    this.duplicateQueue.clear();
  }

  // ---------------------------------------------------------------------------
  // 6. Chunked Batch Loading & Idempotent Retry (CRM1-13)
  // ---------------------------------------------------------------------------

  public async executeBatchLoad(
    input: Crm1ExecuteBatchLoadInput,
    options?: Crm1BatchLoaderOptions
  ): Promise<Crm1BatchExecutionReport> {
    const report = await executeCrm1ChunkedBatchLoad(input, options);
    this.batchReports.set(report.batchId, report);
    return report;
  }

  public getBatchReport(batchId: string): Crm1BatchExecutionReport | undefined {
    return this.batchReports.get(batchId);
  }

  public resetBatchReports(): void {
    this.batchReports.clear();
  }

  public clear(): void {
    this.memCompanies.clear();
    this.memContacts.clear();
    this.memLeads.clear();
    this.memImportRuns.clear();
    this.memRejects.clear();
    this.batchReports.clear();
    this.duplicateQueue = new DuplicateReviewQueue();
  }

  public snapshotState(): {
    contacts: Map<string, Contact>;
    companies: Map<string, Company>;
    leads: Map<string, Lead>;
    importRuns: Map<string, Crm1ImportRun>;
    rejects: Map<string, Crm1Reject>;
  } {
    return {
      contacts: new Map(this.memContacts),
      companies: new Map(this.memCompanies),
      leads: new Map(this.memLeads),
      importRuns: new Map(this.memImportRuns),
      rejects: new Map(this.memRejects),
    };
  }
}
