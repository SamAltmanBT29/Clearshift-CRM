import React, { useEffect, useId, useRef } from 'react';
import { CreateDealForm, type CreateDealFormData } from './CreateDealForm.js';
import type { Stage } from '@clearshift/contracts';

export interface CreateDealModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (values: CreateDealFormData) => Promise<unknown>;
  onSuccess?: ((result: unknown) => void) | undefined;
  initialValues?: Partial<CreateDealFormData> | undefined;
  title?: string | undefined;
  requireContactInfo?: boolean | undefined;
  stages?: Stage[] | undefined;
}

/**
 * CreateDealModal Component
 * Accessible dialog modal wrapping CreateDealForm.
 * Complies with WAI-ARIA modal dialog specifications, keyboard escape handling,
 * and backdrop dismissal.
 */
export const CreateDealModal: React.FC<CreateDealModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  onSuccess,
  initialValues,
  title = 'Create New Deal Opportunity',
  requireContactInfo = false,
  stages = [],
}) => {
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;

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
    if (typeof document === 'undefined') return;

    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.body.style.overflow = '';
      }
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
      data-testid="create-deal-modal-backdrop"
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
              Enter sales opportunity information with field-level validation and CRM-1 contact links.
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
          <CreateDealForm
            {...(initialValues ? { initialValues } : {})}
            onSubmit={onSubmit}
            onSuccess={handleSuccess}
            onCancel={onClose}
            requireContactInfo={requireContactInfo}
            stages={stages}
          />
        </div>
      </div>
    </div>
  );
};
