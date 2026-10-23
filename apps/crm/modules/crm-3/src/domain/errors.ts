import { AppError, type ErrorDetail } from '@cs/kernel';

export class TicketNotFoundError extends AppError {
  constructor(id: string) {
    super('NOT_FOUND', `Ticket with ID '${id}' not found`, 404, [
      { field: 'id', message: `Ticket '${id}' not found`, code: 'ticket_not_found' },
    ]);
    this.name = 'TicketNotFoundError';
  }
}

export class NoteNotFoundError extends AppError {
  constructor(id: string) {
    super('NOT_FOUND', `Note with ID '${id}' not found`, 404, [
      { field: 'id', message: `Note '${id}' not found`, code: 'note_not_found' },
    ]);
    this.name = 'NoteNotFoundError';
  }
}

export class ContactReferenceError extends AppError {
  constructor(contactId: string) {
    super(
      'VALIDATION_ERROR',
      `Referenced CRM-1 Contact '${contactId}' does not exist`,
      422,
      [
        {
          field: 'contactId',
          message: `Contact with ID '${contactId}' was not found in CRM-1 directory`,
          code: 'invalid_contact_reference',
        },
      ]
    );
    this.name = 'ContactReferenceError';
  }
}

export class InvalidTicketStatusTransitionError extends AppError {
  constructor(from: string, to: string, allowed: readonly string[]) {
    const allowedText = allowed.length > 0 ? allowed.join(', ') : 'none (terminal status)';
    super(
      'INVALID_TICKET_STATUS_TRANSITION',
      `Ticket status cannot transition from ${from} to ${to}`,
      422,
      [
        {
          field: 'status',
          message: `Allowed next statuses from ${from}: ${allowedText}`,
          code: 'invalid_transition',
        },
      ]
    );
    this.name = 'InvalidTicketStatusTransitionError';
  }
}

export class DomainValidationError extends AppError {
  constructor(message: string, details: ErrorDetail[] = [], statusCode = 400) {
    super('VALIDATION_ERROR', message, statusCode, details);
    this.name = 'DomainValidationError';
  }
}
