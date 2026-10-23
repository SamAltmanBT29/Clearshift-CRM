import React, { useEffect, useId, useRef } from 'react';
import type { MigrationReject } from '@clearshift/contracts';
import {
  enhanceRejectRecord,
  type EnhancedRejectRecord,
} from '../utils/reject-helpers.js';

export interface RejectDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  reject: MigrationReject | null;
  rawPayload?: Record<string, unknown> | undefined;
  onNavigateBatch?: ((batchId: string) => void) | undefined;
}

/**
 * RejectDetailModal Component
 * Accessible dialog conforming to WAI-ARIA standards for reviewing row-level rejection details,
 * module-specific context identifiers, failure explanations, remediation steps, and masked payload samples.
 */
export const RejectDetailModal: React.FC<RejectDetailModalProps> = ({
  isOpen,
  onClose,
  reject,
  rawPayload,
  onNavigateBatch,
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

  // Prevent background scrolling when open
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

  if (!isOpen || !reject) {
    return null;
  }

  const enhanced: EnhancedRejectRecord = enhanceRejectRecord(reject, rawPayload);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleBatchClick = () => {
    if (onNavigateBatch) {
      onNavigateBatch(reject.batchId);
    }
    onClose();
  };

  return (
    <div
      className="cs-modal-backdrop"
      onClick={handleBackdropClick}
      data-testid="reject-detail-modal-backdrop"
    >
      <div
        ref={modalRef}
        className="cs-modal-card cs-reject-detail-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="cs-modal-header">
          <div className="cs-modal-header-text">
            <div className="cs-reject-modal-badge-row">
              <span className={`cs-badge cs-badge-module cs-badge-${reject.module}`}>
                {reject.module.toUpperCase()}
              </span>
              <span className="cs-badge cs-badge-error">
                {reject.errorCode}
              </span>
              <span className="cs-badge cs-badge-category">
                {enhanced.category}
              </span>
            </div>
            <h2 id={titleId} className="cs-modal-title">
              Rejection Inspection: Row #{reject.rowIndex}
            </h2>
            <p className="cs-modal-subtitle">
              Audit record for batch <code>{reject.batchId}</code>
            </p>
          </div>
          <button
            type="button"
            className="cs-modal-close-btn"
            onClick={onClose}
            aria-label="Close inspection dialog"
          >
            ×
          </button>
        </div>

        {/* Modal Body */}
        <div className="cs-modal-body cs-reject-modal-body">
          {/* Section 1: Module Context Identifiers */}
          <div className="cs-detail-section">
            <h4 className="cs-detail-section-title">Module Context & Entity Identifier</h4>
            <div className="cs-detail-grid">
              <div className="cs-detail-item">
                <span className="cs-detail-label">{enhanced.identifierLabel}</span>
                <span className="cs-detail-value cs-identifier-value">
                  {enhanced.identifierValue}
                </span>
              </div>
              <div className="cs-detail-item">
                <span className="cs-detail-label">Batch Correlation ID</span>
                <span className="cs-detail-value">
                  <button
                    type="button"
                    className="cs-link-btn"
                    onClick={handleBatchClick}
                    title={`View execution runs for batch ${reject.batchId}`}
                  >
                    {reject.batchId} ↗
                  </button>
                </span>
              </div>
              {enhanced.secondary && (
                <div className="cs-detail-item">
                  <span className="cs-detail-label">Secondary Context</span>
                  <span className="cs-detail-value">{enhanced.secondary}</span>
                </div>
              )}
              <div className="cs-detail-item">
                <span className="cs-detail-label">Recorded At</span>
                <span className="cs-detail-value">
                  {reject.createdAt instanceof Date
                    ? reject.createdAt.toISOString()
                    : String(reject.createdAt)}
                </span>
              </div>
            </div>
          </div>

          {/* Section 2: Failure Reason & Remediation */}
          <div className="cs-detail-section cs-detail-section-reason">
            <h4 className="cs-detail-section-title">Validation Failure Explanation</h4>
            <div className="cs-reason-box" role="alert">
              <div className="cs-reason-icon" aria-hidden="true">⚠️</div>
              <div className="cs-reason-content">
                <p className="cs-reason-text">{enhanced.explanation}</p>
                <div className="cs-remediation-guide">
                  <strong>Recommended Remediation:</strong> {enhanced.remediation}
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Sensitive Field Masking & Payload Audit */}
          <div className="cs-detail-section">
            <div className="cs-detail-section-header">
              <h4 className="cs-detail-section-title">Cryptographic & Masked Payload Audit</h4>
              <span className="cs-security-tag" title="Protected under PLT-06 / PLT-12">
                🔒 Protected & Masked
              </span>
            </div>

            <div className="cs-detail-item" style={{ marginBottom: '12px' }}>
              <span className="cs-detail-label">SHA-256 Raw Payload Hash</span>
              <code className="cs-hash-code">{reject.rawPayloadHash}</code>
            </div>

            {enhanced.maskedPayload ? (
              <div className="cs-payload-preview-container">
                <span className="cs-detail-label" style={{ marginBottom: '6px', display: 'block' }}>
                  Masked Payload Sample (Sensitive fields masked per security policy)
                </span>
                <pre className="cs-masked-payload-block" tabIndex={0}>
                  {JSON.stringify(enhanced.maskedPayload, null, 2)}
                </pre>
              </div>
            ) : (
              <p className="cs-field-helper">
                Raw payload omitted from review cache. Authenticity verified via SHA-256 payload hash.
              </p>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="cs-modal-footer">
          <button
            type="button"
            className="cs-btn cs-btn-secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
