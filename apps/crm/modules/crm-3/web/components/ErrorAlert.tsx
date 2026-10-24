import React from 'react';

export interface ErrorAlertProps {
  error: string | Error | { code?: string | undefined; message?: string | undefined; details?: unknown } | null | undefined;
  title?: string | undefined;
  onRetry?: (() => void) | undefined;
  retryLabel?: string | undefined;
  onDismiss?: (() => void) | undefined;
  className?: string | undefined;
  id?: string | undefined;
}

/**
 * Sanitizes error inputs to ensure internal stack traces, DB queries,
 * and system paths are never exposed in the user interface.
 */
export function sanitizeErrorMessage(rawError: unknown): string {
  if (!rawError) {
    return 'An unexpected error occurred while communicating with the server.';
  }

  let text = '';
  if (typeof rawError === 'string') {
    text = rawError;
  } else if (rawError instanceof Error) {
    text = rawError.message;
  } else if (typeof rawError === 'object' && rawError !== null) {
    const obj = rawError as { message?: string; error?: string; code?: string };
    text = obj.message || obj.error || (obj.code ? `Server returned error code: ${obj.code}` : '');
  }

  if (!text) {
    return 'An unexpected error occurred. Please try again.';
  }

  // Strip JavaScript stack traces (lines starting with 'at ...' or containing file paths)
  const lines = text.split(/\r?\n/);
  const cleanLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('at ') || trimmed.startsWith('Error:')) {
      return false;
    }
    if (/\b(?:node_modules|\/Users\/|\/home\/|\/var\/|\.ts:\d+|\.js:\d+)\b/.test(trimmed)) {
      return false;
    }
    return true;
  });

  const sanitized = cleanLines.join(' ').trim();
  if (!sanitized || sanitized.length === 0) {
    return 'An unexpected operational error occurred. Details have been logged for diagnostics.';
  }

  // Cap message length to prevent UI blowout
  return sanitized.length > 240 ? `${sanitized.substring(0, 237)}...` : sanitized;
}

/**
 * Accessible Error Alert Banner with Retry Action
 * Conforms to ClearShift V1 Issue #152 (CRM3-19).
 * Hides raw stack traces and provides keyboard-accessible retry mechanism.
 */
export const ErrorAlert: React.FC<ErrorAlertProps> = ({
  error,
  title = 'Failed to load support data',
  onRetry,
  retryLabel = 'Retry',
  onDismiss,
  className = '',
  id,
}) => {
  if (!error) {
    return null;
  }

  const sanitizedMessage = sanitizeErrorMessage(error);

  return (
    <div
      id={id}
      className={`cs-error-banner ${className}`.trim()}
      role="alert"
      aria-live="assertive"
    >
      <div className="cs-error-banner-content">
        <span className="cs-error-icon" aria-hidden="true">
          ⚠️
        </span>
        <div className="cs-error-text-block">
          <h4 className="cs-error-title">{title}</h4>
          <p className="cs-error-message">{sanitizedMessage}</p>
        </div>
      </div>
      <div className="cs-error-banner-actions">
        {onRetry && (
          <button
            type="button"
            className="cs-error-retry-btn"
            onClick={onRetry}
            aria-label={`${retryLabel} failed operation`}
          >
            {retryLabel}
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            className="cs-error-dismiss-btn"
            onClick={onDismiss}
            aria-label="Dismiss error notification"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
};
