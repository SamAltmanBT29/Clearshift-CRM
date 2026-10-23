import React, { useEffect, useId, useRef } from 'react';
import { CreateRunForm, type CreateRunFormData } from './CreateRunForm.js';

export interface CreateRunModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (values: CreateRunFormData) => Promise<unknown>;
  onSuccess?: (result: unknown) => void;
  initialValues?: Partial<CreateRunFormData>;
  title?: string;
  requireContactInfo?: boolean;
}

/**
 * CreateRunModal Component
 * Accessible dialog modal wrapping CreateRunForm.
 * Complies with WAI-ARIA modal dialog specifications, keyboard escape handling,
 * and backdrop dismissal.
 */
export const CreateRunModal: React.FC<CreateRunModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  onSuccess,
  initialValues,
  title = 'Record Migration Run Projection',
  requireContactInfo = false,
}) => {
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Prevent background scrolling when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleSuccess = (result: unknown) => {
    if (onSuccess) {
      onSuccess(result);
    }
    onClose();
  };

  return (
    <div
      className="cs-modal-backdrop"
      onClick={handleBackdropClick}
      data-testid="create-run-modal-backdrop"
    >
      <div
        ref={modalRef}
        className="cs-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="cs-modal-header">
          <div className="cs-modal-header-text">
            <h2 id={titleId} className="cs-modal-title">
              {title}
            </h2>
            <p className="cs-modal-subtitle">
              Record new batch execution event telemetry and conservation counts.
            </p>
          </div>
          <button
            type="button"
            className="cs-modal-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>

        <div className="cs-modal-body">
          <CreateRunForm
            {...(initialValues ? { initialValues } : {})}
            onSubmit={onSubmit}
            onSuccess={handleSuccess}
            onCancel={onClose}
            requireContactInfo={requireContactInfo}
          />
        </div>
      </div>
    </div>
  );
};
