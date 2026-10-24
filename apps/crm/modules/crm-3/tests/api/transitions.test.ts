import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Roles, signAccessToken } from '@cs/identity';
import { CRM3_API_PREFIX, CRM3_TICKET_STATUSES, CRM3TicketReadSchema } from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import { Crm3Service, DefaultSyntheticContactResolver } from '../../src/services/crm3.service.js';
import { Crm3ReferenceResolver } from '../../src/public.js';

// Seed ticket i has status CRM3_TICKET_STATUSES[(i - 1) % 5]: #1 New, #2 Open, #3 Waiting, #4 Solved, #5 Closed.
const seedTicketId = (i: number) => `30000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
const NEW_TICKET = seedTicketId(1);
const OPEN_TICKET = seedTicketId(2);
const WAITING_TICKET = seedTicketId(3);
const SOLVED_TICKET = seedTicketId(4);
const CLOSED_TICKET = seedTicketId(5);
const CONTACT_1 = '90000000-0000-4000-8000-000000000001';
const CONTACT_2 = '90000000-0000-4000-8000-000000000002';
const MISSING_CONTACT = '99999999-9999-4999-8999-999999999999';
const MISSING_TICKET = '00000000-0000-4000-8000-000000000999';

class SlowContactResolver extends DefaultSyntheticContactResolver {
  override async exists(entityType: string, id: string): Promise<boolean> {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return super.exists(entityType, id);
  }
}

describe('CRM-3 ticket status transitions and reference integrity API (#31 / CRM3-06, CRM3-07)', () => {
  let app: FastifyInstance;
  let service: Crm3Service;
  let editorHeaders: { authorization: string };

  beforeEach(async () => {
    service = new Crm3Service({ contactResolver: new DefaultSyntheticContactResolver() });
    app = buildApp({ service, enforceAuth: true });
    await app.ready();
    const editorToken = await signAccessToken('synthetic-editor', [Roles.EDITOR]);
    editorHeaders = { authorization: `Bearer ${editorToken}` };
  });

  const patch = (id: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'PATCH',
      url: `${CRM3_API_PREFIX}/tickets/${id}`,
      headers: editorHeaders,
      payload,
    });

  it('seed data covers every status once in the first five tickets', async () => {
    const statuses = await Promise.all(
      [1, 2, 3, 4, 5].map(async (i) => (await service.getTicketById(seedTicketId(i)))?.status)
    );
    expect(statuses).toEqual([...CRM3_TICKET_STATUSES]);
  });

  describe('legal transitions', () => {
    it.each([
      [NEW_TICKET, 'Open'],
      [OPEN_TICKET, 'Waiting'],
      [OPEN_TICKET, 'Solved'],
      [WAITING_TICKET, 'Open'],
      [WAITING_TICKET, 'Solved'],
      [SOLVED_TICKET, 'Closed'],
      [SOLVED_TICKET, 'Open'],
    ])('PATCH %s to %s returns 200 and the read API agrees', async (id, status) => {
      const before = await service.getTicketById(id);
      const response = await patch(id, { status });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(CRM3TicketReadSchema.safeParse(body).success).toBe(true);
      expect(body.status).toBe(status);
      expect(body.updatedAt >= (before?.updatedAt ?? '')).toBe(true);

      const read = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets/${id}`,
        headers: editorHeaders,
      });
      expect(read.json().status).toBe(status);
    });

    it('walks a full lifecycle New -> Open -> Waiting -> Solved -> Closed', async () => {
      for (const status of ['Open', 'Waiting', 'Solved', 'Closed']) {
        const response = await patch(NEW_TICKET, { status });
        expect(response.statusCode).toBe(200);
      }
      expect((await service.getTicketById(NEW_TICKET))?.status).toBe('Closed');
    });

    it('accepts a same-status PATCH as a no-op, even on terminal Closed', async () => {
      const response = await patch(CLOSED_TICKET, { status: 'Closed' });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('Closed');
    });
  });

  describe('illegal transitions', () => {
    it.each([
      [NEW_TICKET, 'Solved'],
      [NEW_TICKET, 'Closed'],
      [NEW_TICKET, 'Waiting'],
      [WAITING_TICKET, 'Closed'],
      [CLOSED_TICKET, 'Open'],
      [CLOSED_TICKET, 'New'],
      [SOLVED_TICKET, 'Waiting'],
    ])('PATCH %s to %s returns 422 and leaves the ticket unchanged', async (id, status) => {
      const before = await service.getTicketById(id);
      const response = await patch(id, { status, priority: 'Urgent', subject: 'Should not apply' });

      expect(response.statusCode).toBe(422);
      const body = response.json();
      expect(body.code).toBe('INVALID_TICKET_STATUS_TRANSITION');
      expect(body.details[0]).toMatchObject({ field: 'status', code: 'invalid_transition' });
      expect(typeof body.correlation_id).toBe('string');

      // No partial write: the other fields in the same PATCH were not applied either.
      expect(await service.getTicketById(id)).toEqual(before);
    });
  });

  describe('creation is not bound by the transition map', () => {
    it.each([...CRM3_TICKET_STATUSES])('POST may create a ticket directly in %s', async (status) => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload: { subject: `Historical ${status} ticket`, status, contactId: CONTACT_1 },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().status).toBe(status);
    });
  });

  describe('concurrency', () => {
    it('serializes concurrent edits so two conflicting transitions cannot both win', async () => {
      const slowService = new Crm3Service({ contactResolver: new SlowContactResolver() });

      const results = await Promise.allSettled([
        slowService.updateTicket(OPEN_TICKET, { status: 'Solved', contactId: CONTACT_2 }),
        slowService.updateTicket(OPEN_TICKET, { status: 'Waiting', contactId: CONTACT_2 }),
      ]);

      expect(results[0]?.status).toBe('fulfilled');
      expect(results[1]?.status).toBe('rejected');
      if (results[1]?.status === 'rejected') {
        expect(results[1].reason).toMatchObject({ code: 'INVALID_TICKET_STATUS_TRANSITION' });
      }
      expect((await slowService.getTicketById(OPEN_TICKET))?.status).toBe('Solved');
    });

    it('releases the lock after a rejected edit so later edits still run', async () => {
      await expect(service.updateTicket(NEW_TICKET, { status: 'Closed' })).rejects.toMatchObject({
        code: 'INVALID_TICKET_STATUS_TRANSITION',
      });
      await expect(service.updateTicket(NEW_TICKET, { status: 'Open' })).resolves.toMatchObject({
        status: 'Open',
      });
    });
  });

  describe('contact reference integrity', () => {
    it('PATCH to an unknown contact returns 422 and writes nothing', async () => {
      const before = await service.getTicketById(OPEN_TICKET);
      const response = await patch(OPEN_TICKET, { contactId: MISSING_CONTACT, status: 'Solved' });

      expect(response.statusCode).toBe(422);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.details[0].code).toBe('invalid_contact_reference');
      expect(await service.getTicketById(OPEN_TICKET)).toEqual(before);
    });

    it('PATCH to another existing contact succeeds and the projection follows it', async () => {
      const response = await patch(NEW_TICKET, { contactId: CONTACT_2 });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        contactId: CONTACT_2,
        contactName: 'Lars Lindqvist',
      });
    });

    it('POST with an unknown contact returns 422 and creates no ticket', async () => {
      const before = await service.getTickets({ page: 1, pageSize: 100 });
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: editorHeaders,
        payload: { subject: 'Orphan ticket', contactId: MISSING_CONTACT, note: 'should not exist' },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().details[0].code).toBe('invalid_contact_reference');
      expect((await service.getTickets({ page: 1, pageSize: 100 })).total).toBe(before.total);
    });
  });

  describe('note -> ticket integrity', () => {
    it.each([
      ['POST /notes', `${CRM3_API_PREFIX}/notes`, { ticketId: MISSING_TICKET, noteText: 'x' }],
      ['POST /tickets/:id/notes', `${CRM3_API_PREFIX}/tickets/${MISSING_TICKET}/notes`, { noteText: 'x' }],
    ])('%s on a missing ticket returns 404 ticket_not_found', async (_label, url, payload) => {
      const response = await app.inject({ method: 'POST', url, headers: editorHeaders, payload });
      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.code).toBe('NOT_FOUND');
      expect(body.details[0].code).toBe('ticket_not_found');
      expect(typeof body.correlation_id).toBe('string');
    });
  });

  describe('public ReferenceResolver read model', () => {
    it('agrees with the API immediately after a write', async () => {
      const resolver = new Crm3ReferenceResolver(service);
      await patch(NEW_TICKET, { status: 'Open' });

      expect(await resolver.exists('ticket', NEW_TICKET)).toBe(true);
      expect(await resolver.get('ticket', NEW_TICKET)).toEqual({
        id: NEW_TICKET,
        subject: 'Customer support request #1',
        status: 'Open',
        priority: 'Low',
        contactId: CONTACT_1,
      });
    });

    it('reports unknown tickets, notes and entity types as missing', async () => {
      const resolver = new Crm3ReferenceResolver(service);
      expect(await resolver.exists('ticket', MISSING_TICKET)).toBe(false);
      expect(await resolver.get('ticket', MISSING_TICKET)).toBeNull();
      expect(await resolver.exists('note', MISSING_TICKET)).toBe(false);
      expect(await resolver.exists('contact', CONTACT_1)).toBe(false);
    });

    it('finds seeded notes', async () => {
      const resolver = new Crm3ReferenceResolver(service);
      expect(await resolver.exists('note', '40000000-0000-4000-8000-000000000001')).toBe(true);
    });
  });

  describe('error envelopes', () => {
    it('echoes the caller x-correlation-id on route-level validation errors', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets/not-a-uuid`,
        headers: { ...editorHeaders, 'x-correlation-id': 'corr-test-31' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().correlation_id).toBe('corr-test-31');
    });
  });
});
