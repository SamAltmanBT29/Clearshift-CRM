import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CRM3_TICKET_STATUSES,
  CRM3_TICKET_STATUS_TRANSITIONS,
  isTicketStatusTransitionAllowed,
} from '../src/crm-3.js';

const crm3OpenApi = readFileSync(new URL('../openapi/crm-3.yaml', import.meta.url), 'utf8');

describe('CRM-3 Support Tickets ticket status transition contract', () => {
  it('defines a transition entry for every ticket status', () => {
    expect(Object.keys(CRM3_TICKET_STATUS_TRANSITIONS).sort()).toEqual(
      [...CRM3_TICKET_STATUSES].sort()
    );
  });

  it('only lists valid statuses as transition targets', () => {
    for (const targets of Object.values(CRM3_TICKET_STATUS_TRANSITIONS)) {
      for (const target of targets) {
        expect(CRM3_TICKET_STATUSES).toContain(target);
      }
    }
  });

  it('pins the approved V1 transition map', () => {
    expect(CRM3_TICKET_STATUS_TRANSITIONS).toEqual({
      New: ['Open'],
      Open: ['Waiting', 'Solved'],
      Waiting: ['Open', 'Solved'],
      Solved: ['Closed', 'Open'],
      Closed: [],
    });
  });

  it('treats same-status updates as allowed no-ops, including terminal Closed', () => {
    for (const status of CRM3_TICKET_STATUSES) {
      expect(isTicketStatusTransitionAllowed(status, status)).toBe(true);
    }
  });

  it('rejects skipping states and leaving the terminal Closed state', () => {
    expect(isTicketStatusTransitionAllowed('New', 'Solved')).toBe(false);
    expect(isTicketStatusTransitionAllowed('New', 'Closed')).toBe(false);
    expect(isTicketStatusTransitionAllowed('Closed', 'Open')).toBe(false);
    expect(isTicketStatusTransitionAllowed('Waiting', 'Closed')).toBe(false);
  });

  it('documents the transition rule and its error code on PATCH in OpenAPI', () => {
    expect(crm3OpenApi).toContain('INVALID_TICKET_STATUS_TRANSITION');
    expect(crm3OpenApi).toContain('TransitionError');
  });
});
