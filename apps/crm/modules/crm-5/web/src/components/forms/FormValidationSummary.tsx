import React from 'react';

export interface FormValidationSummaryProps {
  title?: string | undefined;
  errors: Record<string, string | undefined> | Record<string, unknown> | string[] | object;
}

/**
 * Accessible Validation Summary banner.
 * Displays field-level and server validation errors prominently with role="alert" and aria-live="assertive".
 */
export const FormValidationSummary: React.FC<FormValidationSummaryProps> = ({
  title = 'Please correct the following errors before proceeding:',
  errors,
}) => {
  const errorList: string[] = Array.isArray(errors)
    ? errors
    : Object.entries(errors as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
        .map(([field, msg]) => `${field}: ${msg}`);

  if (errorList.length === 0) {
    return null;
  }

  return (
    <div
      className="cs-validation-summary"
      role="alert"
      aria-live="assertive"
      style={{
        background: '#fef2f2',
        border: '1px solid #fecaca',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '20px',
      }}
    >
      <h3
        className="cs-validation-summary-title"
        style={{
          margin: '0 0 8px 0',
          fontSize: '14px',
          fontWeight: 600,
          color: '#991b1b',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span aria-hidden="true">❌</span>
        {title}
      </h3>
      <ul
        className="cs-validation-summary-list"
        style={{
          margin: 0,
          paddingLeft: '24px',
          fontSize: '13px',
          color: '#b91c1c',
          lineHeight: 1.5,
        }}
      >
        {errorList.map((err, idx) => (
          <li key={idx}>{err}</li>
        ))}
      </ul>
    </div>
  );
};
