import {
  CRM3_TICKET_STATUS_TRANSITIONS,
  isTicketStatusTransitionAllowed,
  type CRM3TicketStatus,
} from '@clearshift/contracts';
import type { ReferenceResolver } from '@cs/kernel';
import {
  ContactReferenceError,
  InvalidTicketStatusTransitionError,
  TicketNotFoundError,
} from './errors.js';

export { CRM3_TICKET_STATUS_TRANSITIONS, isTicketStatusTransitionAllowed };

/**
 * Asserts a ticket status edit is allowed, throwing InvalidTicketStatusTransitionError (422)
 * before any write. Applies to user edits only; migration creates may use any valid status.
 */
export function assertTicketStatusTransition(
  current: CRM3TicketStatus,
  next: CRM3TicketStatus
): void {
  if (!isTicketStatusTransitionAllowed(current, next)) {
    throw new InvalidTicketStatusTransitionError(
      current,
      next,
      CRM3_TICKET_STATUS_TRANSITIONS[current]
    );
  }
}

/**
 * Gets the list of valid next statuses from the current status.
 */
export function getAllowedNextStatuses(status: CRM3TicketStatus): readonly CRM3TicketStatus[] {
  return CRM3_TICKET_STATUS_TRANSITIONS[status] ?? [];
}

/**
 * Checks if a ticket status is terminal (cannot transition further).
 */
export function isTerminalStatus(status: CRM3TicketStatus): boolean {
  return CRM3_TICKET_STATUS_TRANSITIONS[status].length === 0;
}

/**
 * Validates that a CRM-1 contact exists through the ReferenceResolver port (decision C7).
 * CRM-3 never reads CRM-1 tables directly. Throws ContactReferenceError (422) if missing.
 * Shared by ticket create, ticket update and the migration import path.
 */
export async function assertValidContactReference(
  contactId: string,
  resolver: ReferenceResolver
): Promise<void> {
  const exists = await resolver.exists('contact', contactId);
  if (!exists) {
    throw new ContactReferenceError(contactId);
  }
}

/**
 * Validates that a note's parent ticket exists in this module before the note is written.
 * Throws TicketNotFoundError (404) if missing.
 */
export async function assertTicketExists(
  ticketId: string,
  ticketExistsFn: (id: string) => Promise<boolean> | boolean
): Promise<void> {
  const exists = await ticketExistsFn(ticketId);
  if (!exists) {
    throw new TicketNotFoundError(ticketId);
  }
}
