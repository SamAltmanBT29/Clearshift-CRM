import { randomUUID } from 'node:crypto';
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
} from '@clearshift/contracts';
import {
  CompanyNotFoundError,
  InvalidLeadStatusError,
  DomainValidationError,
} from '../domain/errors.js';

const VALID_LEAD_STATUSES = ['New', 'Working', 'Qualified', 'Closed'] as const;

/**
 * CRM-1 Contacts, Companies and Leads Service
 * Provides server-side filtered, bounded, and deterministically sorted read models
 * and domain validation operations for Contacts, Companies, Leads, and Import Rejects.
 */
export class Crm1Service {
  private contacts: Contact[] = [];
  private companies: Company[] = [];
  private leads: Lead[] = [];
  private importRuns: Map<string, Crm1ImportRun> = new Map();
  private rejects: Crm1Reject[] = [];

  constructor() {
    this.seedSyntheticData();
  }

  // ---------------------------------------------------------------------------
  // 1. Contacts
  // ---------------------------------------------------------------------------

  public getContacts(query: ContactsQuery): PaginatedContactsResponse {
    let filtered = [...this.contacts];

    if (query.search) {
      const term = query.search.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.firstName.toLowerCase().includes(term) ||
          c.lastName.toLowerCase().includes(term) ||
          c.email.toLowerCase().includes(term)
      );
    }

    if (query.email) {
      const term = query.email.toLowerCase();
      filtered = filtered.filter((c) => c.email.toLowerCase() === term);
    }

    if (query.leadStatus) {
      filtered = filtered.filter((c) => c.leadStatus === query.leadStatus);
    }

    if (query.companyId) {
      filtered = filtered.filter((c) => c.companyId === query.companyId);
    }

    // Stable, deterministic sort: createdAt desc, then id asc
    filtered.sort((a, b) => {
      const diff = b.createdAt.getTime() - a.createdAt.getTime();
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });

    const total = filtered.length;
    const page = query.page;
    const pageSize = query.pageSize;
    const totalPages = Math.ceil(total / pageSize) || (total === 0 ? 0 : 1);
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      limit: pageSize,
      totalPages,
    };
  }

  public getContactById(id: string): Contact | null {
    return this.contacts.find((c) => c.id === id) ?? null;
  }

  public createContact(input: CreateContactInput): Contact {
    if (input.companyId) {
      const companyExists = this.companies.some((c) => c.id === input.companyId);
      if (!companyExists) {
        throw new CompanyNotFoundError(input.companyId);
      }
    }

    if (input.leadStatus && !VALID_LEAD_STATUSES.includes(input.leadStatus as typeof VALID_LEAD_STATUSES[number])) {
      throw new InvalidLeadStatusError(input.leadStatus);
    }

    const now = new Date();
    const id = randomUUID();
    const contact: Contact = {
      id,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email.toLowerCase(),
      phone: input.phone ?? null,
      addressLine: input.addressLine ?? null,
      city: input.city ?? null,
      country: input.country ?? null,
      companyId: input.companyId ?? null,
      leadStatus: input.leadStatus ?? 'New',
      goldenId: input.goldenId ?? `gid-${id.substring(0, 8)}`,
      sourceSystem: input.sourceSystem ?? 'clearshift_api',
      sourceId: input.sourceId ?? id,
      createdAt: now,
      updatedAt: now,
    };

    this.contacts.unshift(contact);
    return contact;
  }

  public updateContact(id: string, input: UpdateContactInput): Contact | null {
    const existing = this.getContactById(id);
    if (!existing) {
      return null;
    }

    if (input.companyId !== undefined && input.companyId !== null) {
      const companyExists = this.companies.some((c) => c.id === input.companyId);
      if (!companyExists) {
        throw new CompanyNotFoundError(input.companyId);
      }
    }

    if (input.leadStatus && !VALID_LEAD_STATUSES.includes(input.leadStatus as typeof VALID_LEAD_STATUSES[number])) {
      throw new InvalidLeadStatusError(input.leadStatus);
    }

    const updated: Contact = {
      ...existing,
      firstName: input.firstName ?? existing.firstName,
      lastName: input.lastName ?? existing.lastName,
      email: input.email ? input.email.toLowerCase() : existing.email,
      phone: input.phone !== undefined ? input.phone : existing.phone,
      addressLine: input.addressLine !== undefined ? input.addressLine : existing.addressLine,
      city: input.city !== undefined ? input.city : existing.city,
      country: input.country !== undefined ? input.country : existing.country,
      companyId: input.companyId !== undefined ? input.companyId : existing.companyId,
      leadStatus: input.leadStatus ?? existing.leadStatus,
      updatedAt: new Date(),
    };

    const idx = this.contacts.findIndex((c) => c.id === id);
    this.contacts[idx] = updated;
    return updated;
  }

  // ---------------------------------------------------------------------------
  // 2. Companies
  // ---------------------------------------------------------------------------

  public getCompanies(query: CompaniesQuery): PaginatedCompaniesResponse {
    let filtered = [...this.companies];

    if (query.search) {
      const term = query.search.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.taxNumber.toLowerCase().includes(term)
      );
    }

    if (query.taxNumber) {
      const term = query.taxNumber.toLowerCase();
      filtered = filtered.filter((c) => c.taxNumber.toLowerCase() === term);
    }

    // Stable deterministic sort: createdAt desc, id asc
    filtered.sort((a, b) => {
      const diff = b.createdAt.getTime() - a.createdAt.getTime();
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });

    const total = filtered.length;
    const page = query.page;
    const pageSize = query.pageSize;
    const totalPages = Math.ceil(total / pageSize) || (total === 0 ? 0 : 1);
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      limit: pageSize,
      totalPages,
    };
  }

  public getCompanyById(id: string): Company | null {
    return this.companies.find((c) => c.id === id) ?? null;
  }

  public createCompany(input: CreateCompanyInput): Company {
    const now = new Date();
    const id = randomUUID();
    const company: Company = {
      id,
      name: input.name,
      taxNumber: input.taxNumber,
      email: input.email ?? null,
      phone: input.phone ?? null,
      addressLine: input.addressLine ?? null,
      city: input.city ?? null,
      country: input.country ?? null,
      sourceSystem: input.sourceSystem ?? 'clearshift_api',
      sourceId: input.sourceId ?? id,
      createdAt: now,
      updatedAt: now,
    };

    this.companies.unshift(company);
    return company;
  }

  public updateCompany(id: string, input: UpdateCompanyInput): Company | null {
    const existing = this.getCompanyById(id);
    if (!existing) {
      return null;
    }

    const updated: Company = {
      ...existing,
      name: input.name ?? existing.name,
      taxNumber: input.taxNumber ?? existing.taxNumber,
      email: input.email !== undefined ? input.email : existing.email,
      phone: input.phone !== undefined ? input.phone : existing.phone,
      addressLine: input.addressLine !== undefined ? input.addressLine : existing.addressLine,
      city: input.city !== undefined ? input.city : existing.city,
      country: input.country !== undefined ? input.country : existing.country,
      updatedAt: new Date(),
    };

    const idx = this.companies.findIndex((c) => c.id === id);
    this.companies[idx] = updated;
    return updated;
  }

  // ---------------------------------------------------------------------------
  // 3. Leads
  // ---------------------------------------------------------------------------

  public getLeads(query: LeadsQuery): PaginatedLeadsResponse {
    let filtered = [...this.leads];

    if (query.search) {
      const term = query.search.toLowerCase();
      filtered = filtered.filter(
        (l) =>
          l.name.toLowerCase().includes(term) ||
          l.email.toLowerCase().includes(term)
      );
    }

    if (query.status) {
      filtered = filtered.filter((l) => l.status === query.status);
    }

    if (query.contactId) {
      filtered = filtered.filter((l) => l.contactId === query.contactId);
    }

    // Stable deterministic sort: createdAt desc, id asc
    filtered.sort((a, b) => {
      const diff = b.createdAt.getTime() - a.createdAt.getTime();
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });

    const total = filtered.length;
    const page = query.page;
    const pageSize = query.pageSize;
    const totalPages = Math.ceil(total / pageSize) || (total === 0 ? 0 : 1);
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      limit: pageSize,
      totalPages,
    };
  }

  public getLeadById(id: string): Lead | null {
    return this.leads.find((l) => l.id === id) ?? null;
  }

  public createLead(input: CreateLeadInput): Lead {
    if (input.status && !VALID_LEAD_STATUSES.includes(input.status as typeof VALID_LEAD_STATUSES[number])) {
      throw new InvalidLeadStatusError(input.status);
    }

    if (input.contactId) {
      const contactExists = this.contacts.some((c) => c.id === input.contactId);
      if (!contactExists) {
        throw new DomainValidationError(`Referenced contact with ID '${input.contactId}' does not exist.`);
      }
    }

    const now = new Date();
    const id = randomUUID();
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

    this.leads.unshift(lead);
    return lead;
  }

  public updateLead(id: string, input: UpdateLeadInput): Lead | null {
    const existing = this.getLeadById(id);
    if (!existing) {
      return null;
    }

    if (input.status && !VALID_LEAD_STATUSES.includes(input.status as typeof VALID_LEAD_STATUSES[number])) {
      throw new InvalidLeadStatusError(input.status);
    }

    if (input.contactId !== undefined && input.contactId !== null) {
      const contactExists = this.contacts.some((c) => c.id === input.contactId);
      if (!contactExists) {
        throw new DomainValidationError(`Referenced contact with ID '${input.contactId}' does not exist.`);
      }
    }

    const updated: Lead = {
      ...existing,
      name: input.name ?? existing.name,
      email: input.email ? input.email.toLowerCase() : existing.email,
      status: input.status ?? existing.status,
      contactId: input.contactId !== undefined ? input.contactId : existing.contactId,
      updatedAt: new Date(),
    };

    const idx = this.leads.findIndex((l) => l.id === id);
    this.leads[idx] = updated;
    return updated;
  }

  // ---------------------------------------------------------------------------
  // 4. Imports & Rejects
  // ---------------------------------------------------------------------------

  public getImportRun(batchId: string): Crm1ImportRun | null {
    return this.importRuns.get(batchId) ?? null;
  }

  public startImportRun(input: CreateCrm1ImportInput): Crm1ImportRun {
    const now = new Date();
    const run: Crm1ImportRun = {
      id: randomUUID(),
      batchId: input.batchId,
      module: 'crm-1',
      status: 'running',
      recordsIn: 0,
      recordsOut: 0,
      recordsRejected: 0,
      startedAt: now,
      metadata: {
        sourceSystem: input.sourceSystem,
        filename: input.filename ?? null,
        mapping: input.mapping ?? null,
        ...(input.metadata ?? {}),
      },
      createdAt: now,
      updatedAt: now,
    };

    this.importRuns.set(input.batchId, run);
    return run;
  }

  public getRejects(query: Crm1RejectsQuery): PaginatedCrm1RejectsResponse {
    let filtered = [...this.rejects];

    if (query.batchId) {
      filtered = filtered.filter((r) => r.batchId === query.batchId);
    }

    if (query.errorCode) {
      filtered = filtered.filter((r) => r.errorCode === query.errorCode);
    }

    // Stable deterministic sort: rowIndex asc, id asc
    filtered.sort((a, b) => {
      const diff = a.rowIndex - b.rowIndex;
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });

    const total = filtered.length;
    const page = query.page;
    const pageSize = query.pageSize;
    const totalPages = Math.ceil(total / pageSize) || (total === 0 ? 0 : 1);
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

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
  // Synthetic Data Seeding (Deterministic Fixtures)
  // ---------------------------------------------------------------------------

  private seedSyntheticData(): void {
    // 1. Companies (Flat)
    const acmeId = '11111111-1111-4111-8111-111111111111';
    const globexId = '22222222-2222-4222-8222-222222222222';
    const initechId = '33333333-3333-4333-8333-333333333333';
    const umbrellaId = '44444444-4444-4444-8444-444444444444';

    const baseTime = new Date('2026-10-01T10:00:00.000Z');

    this.companies = [
      {
        id: acmeId,
        name: 'Acme Corporation',
        taxNumber: 'US-ACME-001',
        email: 'info@acme.synthetic',
        phone: '+1-555-0101',
        addressLine: '100 Industrial Parkway',
        city: 'Metropolis',
        country: 'US',
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
        addressLine: '200 Innovation Way',
        city: 'Cypress Creek',
        country: 'US',
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
        addressLine: '4120 Freemont Blvd',
        city: 'Austin',
        country: 'US',
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
        addressLine: '742 Evergreen Terr',
        city: 'Raccoon City',
        country: 'US',
        sourceSystem: 'crm_seed',
        sourceId: 'src-comp-04',
        createdAt: new Date(baseTime.getTime() + 4000),
        updatedAt: new Date(baseTime.getTime() + 4000),
      },
    ];

    // 2. Contacts (Seeding 32 synthetic contacts to verify bounded paging default 25)
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

    this.contacts = names.map(([first, last], index) => {
      const contactTime = new Date(baseTime.getTime() + (index + 1) * 60000);
      const hexIndex = (index + 1).toString().padStart(2, '0');
      const compId = companyIds[index % companyIds.length] ?? null;
      const leadStat = statuses[index % statuses.length]!;

      return {
        id: `00000000-0000-4000-8000-${hexIndex}0000000000`,
        firstName: first!,
        lastName: last!,
        email: `${first!.toLowerCase()}.${last!.toLowerCase()}@clearshift.synthetic`,
        phone: `+1-555-${(1000 + index).toString()}`,
        addressLine: `${100 + index} Synthetic Avenue`,
        city: 'Metro City',
        country: 'US',
        companyId: compId,
        leadStatus: leadStat,
        goldenId: `gid-cnt-${hexIndex}`,
        sourceSystem: 'crm_seed',
        sourceId: `src-cnt-${hexIndex}`,
        createdAt: contactTime,
        updatedAt: contactTime,
      };
    });

    // 3. Leads
    this.leads = [
      {
        id: '90000000-0000-4000-8000-000000000001',
        name: 'Enterprise Cloud Migration Lead',
        email: 'alice.anderson@clearshift.synthetic',
        status: 'Working',
        contactId: this.contacts[0]!.id,
        sourceSystem: 'web_form',
        sourceId: 'lead-01',
        createdAt: new Date(baseTime.getTime() + 10000),
        updatedAt: new Date(baseTime.getTime() + 10000),
      },
      {
        id: '90000000-0000-4000-8000-000000000002',
        name: 'ERP Data Hub Inquiry',
        email: 'bob.baker@clearshift.synthetic',
        status: 'Qualified',
        contactId: this.contacts[1]!.id,
        sourceSystem: 'web_form',
        sourceId: 'lead-02',
        createdAt: new Date(baseTime.getTime() + 20000),
        updatedAt: new Date(baseTime.getTime() + 20000),
      },
      {
        id: '90000000-0000-4000-8000-000000000003',
        name: 'Inbound Contact Us Inquiry',
        email: 'prospect.unlinked@external.synthetic',
        status: 'New',
        contactId: null,
        sourceSystem: 'inbound_email',
        sourceId: 'lead-03',
        createdAt: new Date(baseTime.getTime() + 30000),
        updatedAt: new Date(baseTime.getTime() + 30000),
      },
      {
        id: '90000000-0000-4000-8000-000000000004',
        name: 'Legacy Deal Closeout',
        email: 'diana.davis@clearshift.synthetic',
        status: 'Closed',
        contactId: this.contacts[3]!.id,
        sourceSystem: 'migration',
        sourceId: 'lead-04',
        createdAt: new Date(baseTime.getTime() + 40000),
        updatedAt: new Date(baseTime.getTime() + 40000),
      },
    ];

    // 4. Import Runs
    const run1: Crm1ImportRun = {
      id: '80000000-0000-4000-8000-000000000001',
      batchId: 'batch-contacts-01',
      module: 'crm-1',
      status: 'completed',
      recordsIn: 100,
      recordsOut: 98,
      recordsRejected: 2,
      startedAt: new Date(baseTime.getTime() + 5000),
      completedAt: new Date(baseTime.getTime() + 60000),
      metadata: {
        sourceSystem: 'legacy_csv',
        filename: 'contacts_dump_2026.csv',
      },
      createdAt: new Date(baseTime.getTime() + 5000),
      updatedAt: new Date(baseTime.getTime() + 60000),
    };

    const run2: Crm1ImportRun = {
      id: '80000000-0000-4000-8000-000000000002',
      batchId: 'batch-companies-01',
      module: 'crm-1',
      status: 'running',
      recordsIn: 50,
      recordsOut: 45,
      recordsRejected: 0,
      startedAt: new Date(baseTime.getTime() + 70000),
      completedAt: null,
      metadata: {
        sourceSystem: 'legacy_erp',
        filename: 'companies_v1.xlsx',
      },
      createdAt: new Date(baseTime.getTime() + 70000),
      updatedAt: new Date(baseTime.getTime() + 70000),
    };

    this.importRuns.set(run1.batchId, run1);
    this.importRuns.set(run2.batchId, run2);

    // 5. Rejects for batch-contacts-01
    this.rejects = [
      {
        id: '70000000-0000-4000-8000-000000000001',
        batchId: 'batch-contacts-01',
        module: 'crm-1',
        rowIndex: 42,
        errorCode: 'INVALID_EMAIL_FORMAT',
        errorMessage: 'Email address "invalid-email-address@" is malformed',
        rawPayloadHash: 'hash-row-42-reject',
        createdAt: new Date(baseTime.getTime() + 15000),
      },
      {
        id: '70000000-0000-4000-8000-000000000002',
        batchId: 'batch-contacts-01',
        module: 'crm-1',
        rowIndex: 78,
        errorCode: 'MISSING_REQUIRED_NAME',
        errorMessage: 'Last name is missing and required',
        rawPayloadHash: 'hash-row-78-reject',
        createdAt: new Date(baseTime.getTime() + 16000),
      },
    ];
  }
}
