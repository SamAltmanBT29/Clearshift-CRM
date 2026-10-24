import React, { useEffect, useRef, useId } from 'react';

export interface ConfirmActionDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible confirmation dialog for destructive or irreversible actions.
 * Enforces human confirmation before halting, terminating, or retrying batches.
 */
export const ConfirmActionDialog: React.FC<ConfirmActionDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm Action',
  cancelLabel = 'Cancel',
  isDestructive = true,
  onConfirm,
  onCancel,
}) => {
  const titleId = useId();
  const descId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Focus cancel button by default on open for safety
    cancelButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="cs-modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        className="cs-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '480px',
          width: '90%',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
        }}
      >
        <div className="cs-modal-header" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <span className="cs-alert-icon" aria-hidden="true" style={{ fontSize: '24px' }}>
            {isDestructive ? '⚠️' : 'ℹ️'}
          </span>
          <h2 id={titleId} className="cs-modal-title" style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#0f172a' }}>
            {title}
          </h2>
        </div>

        <p id={descId} className="cs-modal-desc" style={{ fontSize: '14px', color: '#475569', lineHeight: 1.5, margin: '0 0 24px 0' }}>
          {message}
        </p>

        <div className="cs-modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button
            ref={cancelButtonRef}
            type="button"
            className="cs-btn cs-btn-secondary"
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`cs-btn ${isDestructive ? 'cs-btn-danger' : 'cs-btn-primary'}`}
            onClick={onConfirm}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              background: isDestructive ? '#dc2626' : '#2563eb',
              color: '#ffffff',
              fontWeight: 500,
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
