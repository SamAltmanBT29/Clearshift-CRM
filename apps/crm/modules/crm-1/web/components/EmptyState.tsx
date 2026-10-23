import React from 'react';

export interface EmptyStateProps {
  title?: string | undefined;
  description?: string | undefined;
  icon?: React.ReactNode | undefined;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  secondaryActionLabel?: string | undefined;
  onSecondaryAction?: (() => void) | undefined;
  className?: string | undefined;
  id?: string | undefined;
}

/**
 * Accessible Zero-Data Empty State Component
 * Conforms to ClearShift V1 Issue #112 (CRM1-19).
 * Displays informative message and actionable call-to-action button when data collection is empty.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  title = 'No records found',
  description = 'There are no records currently available in this view.',
  icon = '📁',
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  className = '',
  id,
}) => {
  return (
    <div
      id={id}
      className={`cs-empty-state ${className}`.trim()}
      role="status"
      aria-label={title}
    >
      {icon && (
        <div className="cs-empty-icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className="cs-empty-title">{title}</h3>
      <p className="cs-empty-text">{description}</p>
      {(actionLabel || secondaryActionLabel) && (
        <div className="cs-empty-actions">
          {actionLabel && onAction && (
            <button
              type="button"
              className={`cs-empty-cta-btn cs-btn-primary ${
                className.includes('cs-empty-filter-state')
                  ? 'cs-clear-all-filters-btn cs-empty-reset-btn'
                  : ''
              }`.trim()}
              data-action={
                className.includes('cs-empty-filter-state') ? 'clear-all-filters' : undefined
              }
              onClick={onAction}
            >
              {actionLabel}
            </button>
          )}
          {secondaryActionLabel && onSecondaryAction && (
            <button
              type="button"
              className="cs-empty-secondary-btn cs-btn-secondary"
              onClick={onSecondaryAction}
            >
              {secondaryActionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
