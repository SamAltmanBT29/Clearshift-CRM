import React from 'react';
import { Button } from '@cs/ui';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible confirmation dialog for destructive / irreversible actions.
 * Rendered as a modal overlay with ARIA alertdialog semantics.
 */
export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="crm4-confirm-title"
      aria-describedby="crm4-confirm-desc"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
        <h2 id="crm4-confirm-title" className="text-lg font-bold text-slate-900 mb-2">
          {title}
        </h2>
        <p id="crm4-confirm-desc" className="text-sm text-slate-600 mb-6 leading-relaxed">
          {message}
        </p>
        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} aria-label={cancelLabel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant === 'danger' ? 'danger' : 'primary'}
            size="sm"
            onClick={onConfirm}
            aria-label={confirmLabel}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
