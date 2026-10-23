import React, { useEffect } from 'react';

export interface ConfirmationToastProps {
  show: boolean;
  title?: string | undefined;
  message: string;
  type?: 'success' | 'info' | 'warning' | 'error' | undefined;
  onDismiss?: (() => void) | undefined;
  autoDismissMs?: number | undefined;
}

/**
 * ConfirmationToast Component
 * Accessible toast notification compliant with WAI-ARIA status semantics.
 * Renders success confirmation upon form completion with auto-dismiss support.
 */
export const ConfirmationToast: React.FC<ConfirmationToastProps> = ({
  show,
  title = 'Success',
  message,
  type = 'success',
  onDismiss,
  autoDismissMs = 5000,
}) => {
  useEffect(() => {
    if (!show || !onDismiss || autoDismissMs <= 0) return;
    const timer = setTimeout(() => {
      onDismiss();
    }, autoDismissMs);

    return () => clearTimeout(timer);
  }, [show, onDismiss, autoDismissMs]);

  if (!show) {
    return null;
  }

  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '⚠️' : 'ℹ';

  return (
    <div
      className={`cs-toast cs-toast-${type}`}
      role="status"
      aria-live="polite"
      data-testid="confirmation-toast"
    >
      <div className="cs-toast-icon" aria-hidden="true">
        {icon}
      </div>
      <div className="cs-toast-body">
        {title && <div className="cs-toast-title">{title}</div>}
        <div className="cs-toast-message">{message}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          className="cs-toast-close"
          onClick={onDismiss}
          aria-label="Dismiss notification"
        >
          ×
        </button>
      )}
    </div>
  );
};
