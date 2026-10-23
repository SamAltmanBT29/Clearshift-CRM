import React from 'react';

export interface FormValidationSummaryProps {
  title?: string;
  errors: Record<string, string | undefined>;
}

/**
 * FormValidationSummary Component
 * Renders an accessible banner summarizing form validation errors.
 * Complies with WAI-ARIA alert and live region standards.
 */
export const FormValidationSummary: React.FC<FormValidationSummaryProps> = ({
  title = 'Validation errors prevented submission:',
  errors,
}) => {
  const activeErrors = Object.entries(errors).filter(
    (entry): entry is [string, string] => Boolean(entry[1] && entry[1].trim().length > 0)
  );

  if (activeErrors.length === 0) {
    return null;
  }

  return (
    <div
      className="cs-form-validation-summary"
      role="alert"
      aria-live="polite"
      tabIndex={-1}
    >
      <div className="cs-form-validation-summary-header">
        <span className="cs-form-validation-summary-icon" aria-hidden="true">
          ⚠️
        </span>
        <h4 className="cs-form-validation-summary-title">{title}</h4>
      </div>
      <ul className="cs-form-validation-summary-list">
        {activeErrors.map(([field, msg]) => (
          <li key={field} className="cs-form-validation-summary-item">
            <span className="cs-form-validation-field-name">{field}:</span>{' '}
            <span className="cs-form-validation-field-msg">{msg}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
