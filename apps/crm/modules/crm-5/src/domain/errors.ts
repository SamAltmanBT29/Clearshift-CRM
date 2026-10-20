/**
 * CRM-5 Domain Errors
 * Maps domain rule violations to HTTP status codes and error envelope codes.
 */

export class DomainValidationError extends Error {
  public readonly code = 'UNPROCESSABLE_ENTITY';
  public readonly statusCode = 422;
  public readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'DomainValidationError';
    this.details = details;
  }
}

export class DomainConflictError extends Error {
  public readonly code = 'CONFLICT';
  public readonly statusCode = 409;
  public readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'DomainConflictError';
    this.details = details;
  }
}

export class AutoMergeForbiddenError extends Error {
  public readonly code = 'AUTO_MERGE_FORBIDDEN';
  public readonly statusCode = 422;
  public readonly details?: unknown;

  constructor(
    message = 'Automatic fuzzy or unreviewed merging is forbidden in V1. Duplicate candidates must be held for authorized human review.',
    details?: unknown
  ) {
    super(message);
    this.name = 'AutoMergeForbiddenError';
    this.details = details;
  }
}

export class DuplicateCandidateNotFoundError extends Error {
  public readonly code = 'NOT_FOUND';
  public readonly statusCode = 404;

  constructor(id: string) {
    super(`Duplicate candidate with ID '${id}' not found`);
    this.name = 'DuplicateCandidateNotFoundError';
  }
}
export class IllegalStateTransitionError extends DomainConflictError {
  constructor(fromState: string, toState: string, details?: unknown) {
    const msg =
      fromState === 'completed' || fromState === 'failed'
        ? `Cannot revert run from terminal state '${fromState}' to '${toState}'. Illegal state transition.`
        : `Illegal state transition from '${fromState}' to '${toState}'. Allowed transitions are strictly enforced by the state machine.`;
    super(msg, details ?? { fromState, toState });
    this.name = 'IllegalStateTransitionError';
  }
}

export class BatchLoadHaltedError extends Error {
  public readonly code = 'STOPPED_EXCESSIVE_FAILURES';
  public readonly statusCode = 422;
  public readonly details?: unknown;

  constructor(
    message = 'Batch execution stopped immediately: row failures exceeded the 10% threshold.',
    details?: unknown
  ) {
    super(message);
    this.name = 'BatchLoadHaltedError';
    this.details = details;
  }
}

export class IdempotencyConflictError extends DomainConflictError {
  constructor(idempotencyKey: string, details?: unknown) {
    super(
      `Idempotency key '${idempotencyKey}' was already used with a different request payload.`,
      details ?? { idempotencyKey }
    );
    this.name = 'IdempotencyConflictError';
  }
}

export class RetryableInfrastructureError extends Error {
  public readonly code = 'SERVICE_UNAVAILABLE';
  public readonly statusCode = 503;
  public readonly retryable = true;
  public readonly details?: unknown;

  constructor(message = 'Service temporarily unavailable; retryable infrastructure failure.', details?: unknown) {
    super(message);
    this.name = 'RetryableInfrastructureError';
    this.details = details;
  }
}


