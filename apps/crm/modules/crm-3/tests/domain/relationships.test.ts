import { describe, it, expect } from 'vitest';
import { AppError } from '@cs/kernel';
import { CRM3_TICKET_STATUSES, type CRM3TicketStatus } from '@clearshift/contracts';
import {
  CRM3_TICKET_STATUS_TRANSITIONS,
  assertTicketStatusTransition,
  assertValidContactReference,
  assertTicketExists,
  getAllowedNextStatuses,
  isTerminalStatus,
  isTicketStatusTransitionAllowed,
} from '../../src/domain/relationships.js';
import {
  ContactReferenceError,
  InvalidTicketStatusTransitionError,
  TicketNotFoundError,
} from '../../src/domain/errors.js';
import { DefaultSyntheticContactResolver } from '../../src/services/crm3.service.js';

const LEGAL: Array<[CRM3TicketStatus, CRM3TicketStatus]> = [
  ['New', 'Open'],
  ['Open', 'Waiting'],
  ['Open', 'Solved'],
  ['Waiting', 'Open'],
  ['Waiting', 'Solved'],
  ['Solved', 'Closed'],
  ['Solved', 'Open'],
];

const allPairs: Array<[CRM3TicketStatus, CRM3TicketStatus]> = CRM3_TICKET_STATUSES.flatMap(
  (from) => CRM3_TICKET_STATUSES.map((to) => [from, to] as [CRM3TicketStatus, CRM3TicketStatus])
);

const isLegal = (from: CRM3TicketStatus, to: CRM3TicketStatus) =>
  LEGAL.some(([f, t]) => f === from && t === to);

const ILLEGAL = allPairs.filter(([from, to]) => from !== to && !isLegal(from, to));
const SAME = CRM3_TICKET_STATUSES.map((s) => [s, s] as [CRM3TicketStatus, CRM3TicketStatus]);

describe('CRM-3 domain: ticket status transitions (#31 / CRM3-06)', () => {
  it('covers all 25 status pairs as legal, illegal or same-status', () => {
    expect(LEGAL.length + ILLEGAL.length + SAME.length).toBe(25);
    expect(ILLEGAL.length).toBe(13);
  });

  it.each(LEGAL)('allows %s -> %s', (from, to) => {
    expect(isTicketStatusTransitionAllowed(from, to)).toBe(true);
    expect(() => assertTicketStatusTransition(from, to)).not.toThrow();
  });

  it.each(SAME)('treats %s -> %s as an idempotent no-op', (from, to) => {
    expect(() => assertTicketStatusTransition(from, to)).not.toThrow();
  });

  it.each(ILLEGAL)('rejects %s -> %s with 422 INVALID_TICKET_STATUS_TRANSITION', (from, to) => {
    expect(isTicketStatusTransitionAllowed(from, to)).toBe(false);
    try {
      assertTicketStatusTransition(from, to);
      expect.unreachable('transition should have been rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTicketStatusTransitionError);
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(422);
      expect(appErr.code).toBe('INVALID_TICKET_STATUS_TRANSITION');
      expect(appErr.details[0]).toMatchObject({ field: 'status', code: 'invalid_transition' });
    }
  });

  it('names the allowed next statuses in the error detail', () => {
    try {
      assertTicketStatusTransition('New', 'Closed');
      expect.unreachable('transition should have been rejected');
    } catch (err) {
      expect((err as AppError).details[0]?.message).toContain('Open');
    }
    try {
      assertTicketStatusTransition('Closed', 'Open');
      expect.unreachable('transition should have been rejected');
    } catch (err) {
      expect((err as AppError).details[0]?.message).toContain('terminal');
    }
  });

  it('marks only Closed as terminal and exposes allowed next statuses', () => {
    expect(CRM3_TICKET_STATUSES.filter(isTerminalStatus)).toEqual(['Closed']);
    expect(getAllowedNextStatuses('Waiting')).toEqual(CRM3_TICKET_STATUS_TRANSITIONS.Waiting);
    expect(getAllowedNextStatuses('Closed')).toEqual([]);
  });
});

describe('CRM-3 domain: reference integrity (#31 / CRM3-07)', () => {
  const resolver = new DefaultSyntheticContactResolver();

  it('accepts a contact the resolver knows', async () => {
    await expect(
      assertValidContactReference('90000000-0000-4000-8000-000000000001', resolver)
    ).resolves.toBeUndefined();
  });

  it('rejects an unknown contact with 422 invalid_contact_reference', async () => {
    const missing = '99999999-9999-4999-8999-999999999999';
    await expect(assertValidContactReference(missing, resolver)).rejects.toBeInstanceOf(
      ContactReferenceError
    );
    await expect(assertValidContactReference(missing, resolver)).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
      details: [expect.objectContaining({ code: 'invalid_contact_reference' })],
    });
  });

  it('fails safe when the resolver itself errors (no silent accept)', async () => {
    const failing = {
      exists: async () => {
        throw new Error('CRM-1 facade unavailable');
      },
      get: async () => null,
    };
    await expect(
      assertValidContactReference('90000000-0000-4000-8000-000000000001', failing)
    ).rejects.toThrow('CRM-1 facade unavailable');
  });

  it('requires a note to reference an existing ticket', async () => {
    await expect(assertTicketExists('t-1', () => true)).resolves.toBeUndefined();
    await expect(assertTicketExists('t-2', async () => false)).rejects.toBeInstanceOf(
      TicketNotFoundError
    );
  });
});
