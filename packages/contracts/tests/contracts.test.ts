import {
  CRM_CONTRACT_VERSION,
  LeadStatusSchema,
  ContactSchema,
  CompanySchema,
  LeadSchema,
  ContactsQuerySchema,
} from '../src/index.js';

describe('Contracts Smoke Test', () => {
  it('exports correct contract version', () => {
    expect(CRM_CONTRACT_VERSION).toBe('1.0.0');
  });

  it('exports CRM-1 Zod schemas and validates domain models', () => {
    expect(LeadStatusSchema.safeParse('New').success).toBe(true);
    expect(LeadStatusSchema.safeParse('InvalidStatus').success).toBe(false);

    const validContact = {
      id: '00000000-0000-4000-8000-000000000001',
      firstName: 'Alice',
      lastName: 'Anderson',
      email: 'alice@clearshift.synthetic',
      leadStatus: 'Working',
      goldenId: 'gid-001',
      sourceSystem: 'crm_seed',
      sourceId: 'src-001',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(ContactSchema.safeParse(validContact).success).toBe(true);

    const validCompany = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Acme Corp',
      taxNumber: 'US-ACME-001',
      sourceSystem: 'crm_seed',
      sourceId: 'src-comp-01',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(CompanySchema.safeParse(validCompany).success).toBe(true);

    const validLead = {
      id: '90000000-0000-4000-8000-000000000001',
      name: 'Cloud Lead',
      email: 'lead@clearshift.synthetic',
      status: 'Qualified',
      sourceSystem: 'web',
      sourceId: 'lead-01',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(LeadSchema.safeParse(validLead).success).toBe(true);

    // Default pagination for contacts query should be 25
    const parsedQuery = ContactsQuerySchema.safeParse({});
    expect(parsedQuery.success).toBe(true);
    if (parsedQuery.success) {
      expect(parsedQuery.data.pageSize).toBe(25);
    }
  });
});
