import React from 'react';
import { DataTable } from '../components/DataTable.js';
import { CONTACTS_COLUMNS } from '../table/columns.js';
import type { TableSortState, TablePaginationState } from '../table/types.js';

export interface ContactsListPageProps {
  data?: Record<string, unknown>[];
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | null;
  sort?: TableSortState | undefined;
  onSortChange?: ((columnKey: string) => void) | undefined;
  pagination?: TablePaginationState | undefined;
  onPageChange?: ((newPage: number) => void) | undefined;
}

/**
 * Contacts List Page Shell
 * Integrates with /api/v1/crm-contacts/contacts and paginated DataTable
 */
export const ContactsListPage: React.FC<ContactsListPageProps> = ({
  data = [],
  isLoading = false,
  isEmpty = false,
  error = null,
  sort,
  onSortChange,
  pagination = { page: 1, pageSize: 25, total: 0, totalPages: 1 },
  onPageChange,
}) => {
  const displayData = isEmpty ? [] : data;

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
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <p className="cs-loading-text">Loading contacts from server...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="cs-error-card" role="alert">
          <p className="cs-error-message">Error loading contacts: {error}</p>
        </div>
      )}

      {!isLoading && !error && (
        <DataTable
          columns={CONTACTS_COLUMNS}
          data={displayData}
          loading={false}
          emptyTitle="No records found"
          emptyDescription="No contact records currently exist. Add a contact or import via Migration Kit."
          sort={sort}
          onSortChange={onSortChange}
          pagination={pagination}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
};
