import React from 'react';

export interface AccessDeniedViewProps {
  requiredRole?: string | undefined;
  requiredCapability?: string | undefined;
  currentRole?: string | undefined;
  resourceName?: string | undefined;
  message?: string | undefined;
  backHref?: string | undefined;
  onBack?: (() => void) | undefined;
  className?: string | undefined;
  id?: string | undefined;
}

/**
 * 403 Forbidden Access-Denied View Component
 * Conforms to ClearShift V1 Issue #112 (CRM1-19).
 * Renders when authorization check fails, clearly explaining the missing role or capability.
 */
export const AccessDeniedView: React.FC<AccessDeniedViewProps> = ({
  requiredRole,
  requiredCapability = 'module.read',
  currentRole = 'viewer',
  resourceName = 'Contacts, Companies and Leads',
  message,
  backHref = '/crm-1',
  onBack,
  className = '',
  id = 'cs-access-denied-view',
}) => {
  const defaultExplanation = `You do not have the required permissions to view ${resourceName}. An authorized role with capability '${requiredCapability}' is required.`;

  return (
    <div
      id={id}
      className={`cs-access-denied-card ${className}`.trim()}
      role="region"
      aria-labelledby="cs-access-denied-title"
    >
      <div className="cs-access-denied-icon-wrapper" aria-hidden="true">
        <span className="cs-access-denied-icon">🔒</span>
      </div>

      <div className="cs-access-denied-content">
        <span className="cs-access-denied-badge">403 Forbidden</span>
        <h2 id="cs-access-denied-title" className="cs-access-denied-title">
          Access Denied
        </h2>
        <p className="cs-access-denied-desc">
          {message || defaultExplanation}
        </p>

        <div className="cs-access-denied-meta" role="note" aria-label="Permission details">
          <div className="cs-access-denied-meta-item">
            <span className="cs-meta-label">Required Capability:</span>
            <code className="cs-meta-code">{requiredCapability}</code>
          </div>
          {requiredRole && (
            <div className="cs-access-denied-meta-item">
              <span className="cs-meta-label">Required Role:</span>
              <code className="cs-meta-code">{requiredRole}</code>
            </div>
          )}
          <div className="cs-access-denied-meta-item">
            <span className="cs-meta-label">Current Role:</span>
            <code className="cs-meta-code cs-current-role">{currentRole}</code>
          </div>
        </div>

        <div className="cs-access-denied-actions">
          {onBack ? (
            <button
              type="button"
              className="cs-access-back-btn cs-btn-primary"
              onClick={onBack}
            >
              Return to Directory
            </button>
          ) : (
            <a href={backHref} className="cs-access-back-btn cs-btn-primary">
              Return to Directory
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
