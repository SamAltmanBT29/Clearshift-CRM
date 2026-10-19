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
