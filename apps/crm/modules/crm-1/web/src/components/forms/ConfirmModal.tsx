import React from 'react';
import { Button } from '@clearshift/ui';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary' | 'outline';
  onConfirm: () => void;
  onCancel: () => void;
}

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
      aria-labelledby="crm1-confirm-title"
      aria-describedby="crm1-confirm-desc"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200"
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          maxWidth: '28rem',
          width: '100%',
          padding: '24px',
          border: '1px solid #e2e8f0',
        }}
      >
        <h2
          id="crm1-confirm-title"
          className="text-lg font-bold text-slate-900 mb-2"
          style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}
        >
          {title}
        </h2>
        <p
          id="crm1-confirm-desc"
          className="text-sm text-slate-600 mb-6 leading-relaxed"
          style={{ fontSize: '0.875rem', color: '#475569', marginBottom: '24px', lineHeight: 1.5 }}
        >
          {message}
        </p>
        <div
          className="flex items-center justify-end gap-3"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px' }}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            aria-label={cancelLabel}
          >
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
