import { AppError } from '@cs/kernel';

/**
 * CRM-2 Domain Errors
 * Maps CRM-2 domain rule violations to HTTP status codes and standard error envelopes.
 */

export class DomainValidationError extends AppError {
  constructor(
    message: string,
    details: Array<{ field?: string; message: string; code?: string }> = [],
    statusCode: number = 422
  ) {
    super('VALIDATION_ERROR', message, statusCode, details);
    this.name = 'DomainValidationError';
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(
    message: string = 'Idempotency conflict on requested entity',
    details: Array<{ field?: string; message: string; code?: string }> = []
  ) {
    super('IDEMPOTENCY_CONFLICT', message, 409, details);
    this.name = 'IdempotencyConflictError';
  }
}

export class IdempotencyKeyReusedError extends AppError {
  constructor(
    message: string = 'Idempotency-Key was already used for a different request payload',
    details: Array<{ field?: string; message: string; code?: string }> = []
  ) {
    super('IDEMPOTENCY_KEY_REUSED', message, 409, details);
    this.name = 'IdempotencyKeyReusedError';
  }
}

export class ProtectedFieldMutationError extends AppError {
  constructor(fieldName: string) {
    super(
      'PROTECTED_FIELD_MUTATION',
      `Field '${fieldName}' is protected/system-maintained and cannot be updated from user edit`,
      422,
      [{ field: fieldName, message: 'Protected field cannot be altered by client', code: 'protected_field' }]
    );
    this.name = 'ProtectedFieldMutationError';
  }
}

export class DomainNotFoundError extends AppError {
  constructor(message: string, details: Array<{ field?: string; message: string; code?: string }> = []) {
    super('NOT_FOUND', message, 404, details);
    this.name = 'DomainNotFoundError';
  }
}

export class DealNotFoundError extends DomainNotFoundError {
  constructor(dealId: string) {
    super(`Deal with ID '${dealId}' not found`, [
      { field: 'id', message: `Deal '${dealId}' does not exist`, code: 'deal_not_found' },
    ]);
    this.name = 'DealNotFoundError';
  }
}

export class QuoteNotFoundError extends DomainNotFoundError {
  constructor(quoteId: string) {
    super(`Quote with ID '${quoteId}' not found`, [
      { field: 'id', message: `Quote '${quoteId}' does not exist`, code: 'quote_not_found' },
    ]);
    this.name = 'QuoteNotFoundError';
  }
}

export class InvalidStageTransitionError extends AppError {
  constructor(
    current: string,
    next: string,
    details: Array<{ field?: string; message: string; code?: string }> = [
      { field: 'stage_name', message: 'Move the deal to an allowed pipeline stage', code: 'invalid_transition' },
    ]
  ) {
    super('INVALID_DEAL_STAGE_TRANSITION', `Deal stage cannot transition from ${current} to ${next}`, 422, details);
    this.name = 'InvalidStageTransitionError';
  }
}

export class ReferenceNotFoundError extends AppError {
  constructor(
    entityType: 'contact' | 'deal' | 'stage',
    id: string,
    field: string = entityType === 'contact' ? 'contact_id' : entityType === 'deal' ? 'deal_id' : 'stage_id'
  ) {
    super('REFERENCE_NOT_FOUND', `The selected ${entityType} with ID '${id}' does not exist`, 422, [
      { field, message: `Choose an existing ${entityType}`, code: 'invalid_reference' },
    ]);
    this.name = 'ReferenceNotFoundError';
  }
}

export class DuplicateRecordError extends AppError {
  constructor(
    entityType: string,
    key: string,
    value: string,
    field: string = key
  ) {
    super('DUPLICATE_RECORD', `${entityType} with ${key} '${value}' already exists`, 409, [
      { field, message: `${entityType} ${key} must be unique`, code: 'unique_violation' },
    ]);
    this.name = 'DuplicateRecordError';
  }
}

export class BatchLoadHaltedError extends AppError {
  constructor(
    message = 'Batch execution stopped immediately: row failures exceeded the 10% threshold.',
    details: Array<{ field?: string; message: string; code?: string }> = []
  ) {
    super('STOPPED_EXCESSIVE_FAILURES', message, 422, details);
    this.name = 'BatchLoadHaltedError';
  }
}
