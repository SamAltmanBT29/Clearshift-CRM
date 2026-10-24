import type { CRM3Ticket, CRM3Note, CRM3TicketCreate } from '@clearshift/contracts';

/**
 * Deterministic synthetic test factories for CRM-3 (no Math.random, no Date.now).
 * The same sequence number always yields the same record. Ids live in the 7xxxxxxx range so they
 * never collide with the service seed (3xxxxxxx tickets, 4xxxxxxx notes).
 */

export const FACTORY_CONTACT_ID = '90000000-0000-4000-8000-000000000001';
export const FACTORY_OTHER_CONTACT_ID = '90000000-0000-4000-8000-000000000002';
export const FACTORY_BASE_TIME = Date.parse('2026-09-01T08:00:00.000Z');

const hex12 = (n: number) => n.toString(16).padStart(12, '0');

export const factoryTicketId = (seq: number) => `70000000-0000-4000-8000-${hex12(seq)}`;
export const factoryNoteId = (seq: number) => `71000000-0000-4000-8000-${hex12(seq)}`;
export const factoryTime = (minutes: number) => new Date(FACTORY_BASE_TIME + minutes * 60_000).toISOString();

export function makeTicket(seq: number, overrides: Partial<CRM3Ticket> = {}): CRM3Ticket {
  const createdAt = factoryTime(seq);
  return {
    id: factoryTicketId(seq),
    subject: `Factory ticket ${seq}`,
    status: 'New',
    priority: 'Normal',
    contactId: FACTORY_CONTACT_ID,
    orderRef: null,
    sourceSystem: 'factory',
    sourceId: `factory-ticket-${seq}`,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

export function makeNote(seq: number, ticketId: string, overrides: Partial<CRM3Note> = {}): CRM3Note {
  return {
    id: factoryNoteId(seq),
    ticketId,
    authorId: 'factory-agent',
    noteText: `Factory note ${seq}`,
    createdAt: factoryTime(1000 + seq),
    ...overrides,
  };
}

export function makeTicketCreateInput(seq: number, overrides: Partial<CRM3TicketCreate> = {}): CRM3TicketCreate {
  return {
    subject: `Factory create ${seq}`,
    status: 'New',
    priority: 'Normal',
    contactId: FACTORY_CONTACT_ID,
    ...overrides,
  };
}

export type InvalidTicketKind =
  | 'empty_subject'
  | 'bad_status'
  | 'bad_priority'
  | 'malformed_contact'
  | 'duplicate_source_key'
  | 'half_source_key'
  | 'unknown_field';

/**
 * Create inputs that break exactly one rule. `duplicate_source_key` reuses the source key of seed
 * ticket #1 (crm-3-seed / seed-ticket-1), so it is only invalid against a seeded service.
 */
export function makeInvalidTicket(kind: InvalidTicketKind): Record<string, unknown> {
  const base = makeTicketCreateInput(900);
  switch (kind) {
    case 'empty_subject':
      return { ...base, subject: '   ' };
    case 'bad_status':
      return { ...base, status: 'Pending' };
    case 'bad_priority':
      return { ...base, priority: 'Critical' };
    case 'malformed_contact':
      return { ...base, contactId: 'cnt-not-a-uuid' };
    case 'duplicate_source_key':
      return { ...base, sourceSystem: 'crm-3-seed', sourceId: 'seed-ticket-1' };
    case 'half_source_key':
      return { ...base, sourceSystem: 'legacy-csv' };
    case 'unknown_field':
      return { ...base, id: factoryTicketId(1) };
  }
}
