import React from 'react';
import type { CRM1ContactRead } from '@clearshift/contracts/crm-1';

export interface ContactsListPageProps {
  contacts?: readonly CRM1ContactRead[];
  total?: number;
  search?: string;
  page?: number;
  pageSize?: number;
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | null;
  onSearchChange?: (search: string) => void;
  onPageChange?: (page: number) => void;
}

export const ContactsListPage: React.FC<ContactsListPageProps> = ({
  contacts,
  total,
  search = '',
  page = 1,
  pageSize = 25,
  isLoading = false,
  isEmpty = contacts === undefined || contacts.length === 0,
  error = null,
  onSearchChange,
  onPageChange,
}) => {
  const rows = contacts ?? [];
  const resultCount = total ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(resultCount / pageSize));
  const empty = contacts === undefined ? isEmpty : contacts.length === 0;

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

      {!isLoading && !error && onSearchChange && (
        <div className="cs-list-toolbar">
          <label htmlFor="crm1-contact-search">Search contacts by name or email</label>
          <input
            id="crm1-contact-search"
            type="search"
            value={search}
            onChange={(event) => {
              onSearchChange(event.currentTarget.value);
              onPageChange?.(1);
            }}
          />
        </div>
      )}

      {!isLoading && !error && empty && (
        <div className="cs-empty-state" role="status">
          <h3 className="cs-empty-title">No records found</h3>
          <p className="cs-empty-text">
            {search.trim()
              ? 'No contacts match this search. Adjust or clear the search to see more results.'
              : 'No contact records currently exist. Add a contact or import via Migration Kit.'}
          </p>
        </div>
      )}

      {!isLoading && !error && !empty && (
        <section id="contacts-container" aria-label="Contacts">
          <p className="cs-result-count">{resultCount} contacts</p>
          <div className="cs-table-scroll">
            <table className="cs-data-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Address</th>
                  <th scope="col">Company</th>
                  <th scope="col">Lead status</th>
                  <th scope="col">Golden ID</th>
                  <th scope="col">Consent</th>
                  <th scope="col">Unsubscribe</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((contact) => (
                  <tr key={contact.id}>
                    <th scope="row">{contact.firstName} {contact.lastName}</th>
                    <td>{contact.email ?? 'Not provided'}</td>
                    <td>{contact.phone ?? 'Not provided'}</td>
                    <td>{contact.address ?? 'Not provided'}</td>
                    <td>
                      {contact.companyId === null
                        ? <span className="cs-relationship-warning" role="note">No company linked</span>
                        : contact.companyName}
                    </td>
                    <td>{contact.leadStatus ?? 'Not set'}</td>
                    <td>{contact.goldenId}</td>
                    <td>{contact.consentStatus}</td>
                    <td>{contact.unsubscribed ? 'Unsubscribed' : 'Subscribed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {onPageChange && (
            <nav className="cs-pagination" aria-label="Contact list pages">
              <button type="button" className="cs-action-button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                Previous
              </button>
              <span>Page {page} of {pageCount}</span>
              <button
                type="button"
                className="cs-action-button"
                disabled={page >= pageCount}
                onClick={() => onPageChange(page + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </section>
      )}
    </div>
  );
};
