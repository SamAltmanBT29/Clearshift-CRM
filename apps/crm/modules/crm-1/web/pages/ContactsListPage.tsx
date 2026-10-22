import React from 'react';

export interface ContactsListPageProps {
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | null;
}

/**
 * Contacts List Page Shell
 * Integrates with /api/v1/crm-contacts/contacts
 */
export const ContactsListPage: React.FC<ContactsListPageProps> = ({
  isLoading = false,
  isEmpty = false,
  error = null,
}) => {
  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Contacts Directory</h2>
        <p className="cs-page-desc">
          Manage contact records, golden identity keys, communication channels, and consent status.
        </p>
      </div>

      {isLoading && (
        <div className="cs-skeleton-container" aria-busy="true" aria-label="Loading contacts list">
          <div className="cs-skeleton-line" style={{ width: '100%' }} />
          <div className="cs-skeleton-line" style={{ width: '90%' }} />
          <p className="cs-loading-text">Loading contacts from server...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="cs-error-card" role="alert">
          <p className="cs-error-message">Error loading contacts: {error}</p>
        </div>
      )}

      {!isLoading && !error && isEmpty && (
        <div className="cs-empty-state" role="status">
          <h3 className="cs-empty-title">No records found</h3>
          <p className="cs-empty-text">
            No contact records currently exist. Add a contact or import via Migration Kit.
          </p>
        </div>
      )}

      {!isLoading && !error && !isEmpty && (
        <div className="cs-content-placeholder" id="contacts-container">
          <p className="cs-ready-notice">Ready for contacts data table integration.</p>
        </div>
      )}
    </div>
  );
};
