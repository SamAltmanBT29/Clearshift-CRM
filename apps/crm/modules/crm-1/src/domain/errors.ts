/**
 * CRM-1 Domain Errors
 * Maps CRM-1 domain rule violations to HTTP status codes and standard error envelopes.
 */

export class DomainValidationError extends Error {
  public readonly code = 'BAD_REQUEST';
  public readonly statusCode = 400;
  public readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'DomainValidationError';
    this.details = details;
  }
}

export class DomainNotFoundError extends Error {
  public readonly code = 'NOT_FOUND';
  public readonly statusCode = 404;
  public readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'DomainNotFoundError';
    this.details = details;
  }
}

export class CompanyNotFoundError extends DomainValidationError {
  constructor(companyId: string) {
    super(`Referenced company with ID '${companyId}' does not exist. Company link must refer to an existing company.`, { companyId });
    this.name = 'CompanyNotFoundError';
  }
}

export class InvalidLeadStatusError extends DomainValidationError {
  constructor(status: string) {
    super(`Invalid lead status '${status}'. Must be one of: New, Working, Qualified, Closed.`, { status });
    this.name = 'InvalidLeadStatusError';
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
