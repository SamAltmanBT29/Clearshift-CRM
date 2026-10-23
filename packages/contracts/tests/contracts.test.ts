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

  it('exports CRM-3 Zod schemas and validates domain models and constraints', async () => {
    const {
      CRM3TicketStatusSchema,
      CRM3TicketPrioritySchema,
      CRM3TicketCreateSchema,
      CRM3TicketPatchSchema,
      CRM3NoteCreateSchema,
      CRM3TicketListQuerySchema,
    } = await import('../src/crm-3.js');

    // Status enum tests
    expect(CRM3TicketStatusSchema.safeParse('New').success).toBe(true);
    expect(CRM3TicketStatusSchema.safeParse('Open').success).toBe(true);
    expect(CRM3TicketStatusSchema.safeParse('Waiting').success).toBe(true);
    expect(CRM3TicketStatusSchema.safeParse('Solved').success).toBe(true);
    expect(CRM3TicketStatusSchema.safeParse('Closed').success).toBe(true);
    expect(CRM3TicketStatusSchema.safeParse('Pending').success).toBe(false);

    // Priority enum tests
    expect(CRM3TicketPrioritySchema.safeParse('Low').success).toBe(true);
    expect(CRM3TicketPrioritySchema.safeParse('Normal').success).toBe(true);
    expect(CRM3TicketPrioritySchema.safeParse('High').success).toBe(true);
    expect(CRM3TicketPrioritySchema.safeParse('Urgent').success).toBe(true);
    expect(CRM3TicketPrioritySchema.safeParse('Critical').success).toBe(false);

    // Ticket create validation
    const validTicketCreate = {
      subject: 'Login error on mobile app',
      contactId: '00000000-0000-4000-8000-000000000001',
      orderRef: 'ORD-12345',
    };
    const parsedTicket = CRM3TicketCreateSchema.safeParse(validTicketCreate);
    expect(parsedTicket.success).toBe(true);
    if (parsedTicket.success) {
      expect(parsedTicket.data.status).toBe('New');
      expect(parsedTicket.data.priority).toBe('Normal');
    }

    // Invalid ticket create (empty subject, invalid contactId)
    expect(CRM3TicketCreateSchema.safeParse({ subject: '', contactId: 'invalid-uuid' }).success).toBe(false);

    // Ticket patch validation (must have at least one field)
    expect(CRM3TicketPatchSchema.safeParse({}).success).toBe(false);
    expect(CRM3TicketPatchSchema.safeParse({ status: 'Solved' }).success).toBe(true);

    // Note create validation
    expect(
      CRM3NoteCreateSchema.safeParse({
        ticketId: '00000000-0000-4000-8000-000000000001',
        noteText: 'Investigated log files',
      }).success
    ).toBe(true);
    expect(
      CRM3NoteCreateSchema.safeParse({
        ticketId: '00000000-0000-4000-8000-000000000001',
        noteText: '   ',
      }).success
    ).toBe(false);

    // Pagination query defaults
    const parsedTicketQuery = CRM3TicketListQuerySchema.safeParse({});
    expect(parsedTicketQuery.success).toBe(true);
    if (parsedTicketQuery.success) {
      expect(parsedTicketQuery.data.page).toBe(1);
      expect(parsedTicketQuery.data.pageSize).toBe(25);
    }
  });
});
