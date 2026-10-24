import React from 'react';
import { Alert } from '@clearshift/ui';

export interface FormValidationSummaryProps {
  serverError?: string | null | undefined;
  fieldErrors?: Record<string, string | string[]> | null | undefined;
  className?: string;
}

export function FormValidationSummary({
  serverError,
  fieldErrors,
  className = '',
}: FormValidationSummaryProps) {
  const errorList: string[] = [];

  if (fieldErrors) {
    for (const [field, err] of Object.entries(fieldErrors)) {
      if (Array.isArray(err)) {
        for (const msg of err) {
          if (msg) errorList.push(`${field}: ${msg}`);
        }
      } else if (err) {
        errorList.push(`${field}: ${err}`);
      }
    }
  }

  if (!serverError && errorList.length === 0) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`cs-form-validation-summary mb-4 ${className}`}
      style={{ marginBottom: '16px' }}
    >
      <Alert variant="error">
        {serverError && (
          <div style={{ fontWeight: 600, marginBottom: errorList.length > 0 ? '8px' : 0 }}>
            {serverError}
          </div>
        )}
        {errorList.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: '20px', listStyleType: 'disc' }}>
            {errorList.map((err, idx) => (
              <li key={idx} style={{ fontSize: '0.875rem' }}>
                {err}
              </li>
            ))}
          </ul>
        )}
      </Alert>
    </div>
  );
}
