import React from 'react';
import { Button } from '@cs/ui';
import type { CRM1ContactRead } from '@clearshift/contracts/crm-1';
import { DataTable } from '../components/DataTable.js';
import { FilterToolbar } from '../components/FilterToolbar.js';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';
import { CONTACTS_COLUMNS } from '../table/columns.js';
import { CRM1_CONTACTS_FACETS } from '../table/facets.js';
import type {
  TableSortState,
  TablePaginationState,
  TableFilterState,
  ActiveFilterPill,
  FilterFacet,
} from '../table/types.js';

export interface ContactsListPageProps {
  data?: CRM1ContactRead[];
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | Error | { code?: string; message?: string; details?: unknown } | null;
  onRetry?: (() => void) | undefined;
  httpStatus?: number;
  isAccessDenied?: boolean;
  requiredCapability?: string;
  requiredRole?: string;
  currentRole?: string;
  emptyActionLabel?: string;
  onEmptyAction?: (() => void) | undefined;
  sort?: TableSortState | undefined;
  onSortChange?: ((columnKey: string) => void) | undefined;
  pagination?: TablePaginationState | undefined;
  onPageChange?: ((newPage: number) => void) | undefined;
  search?: string;
  onSearchChange?: ((term: string) => void) | undefined;
  filters?: TableFilterState;
  onFilterChange?: ((key: string, value: string) => void) | undefined;
  onRemoveFilter?: ((key: string) => void) | undefined;
  onClearAllFilters?: (() => void) | undefined;
  activePills?: ActiveFilterPill[];
  facets?: FilterFacet[];
  hasActiveFilters?: boolean;
  canWrite?: boolean;
  onCreate?: (() => void) | undefined;
  onEdit?: ((contact: CRM1ContactRead) => void) | undefined;
}

/**
 * Contacts List Page Shell
 * Integrates with /api/v1/crm-contacts/contacts, FilterToolbar, and paginated DataTable.
 * Conforms to ClearShift V1 Issue #111 (CRM1-18) and Issue #112 (CRM1-19).
 */
export const ContactsListPage: React.FC<ContactsListPageProps> = ({
  data = [],
  isLoading = false,
  isEmpty = false,
  error = null,
  onRetry,
  httpStatus,
  isAccessDenied = false,
  requiredCapability = 'module.read',
  requiredRole,
  currentRole,
  emptyActionLabel = 'Add Contact',
  onEmptyAction,
  sort,
  onSortChange,
  pagination = { page: 1, pageSize: 25, total: 0, totalPages: 1 },
  onPageChange,
  search = '',
  onSearchChange,
  filters = {},
  onFilterChange,
  onRemoveFilter,
  onClearAllFilters,
  activePills = [],
  facets = CRM1_CONTACTS_FACETS,
  hasActiveFilters = false,
  canWrite = false,
  onCreate,
  onEdit,
}) => {
  const displayData = isEmpty ? [] : data;
  const isFiltersActive =
    hasActiveFilters ||
    Boolean(search.trim().length > 0) ||
    Object.values(filters).some((v) => v !== undefined && v.trim().length > 0) ||
    activePills.length > 0;

  const accessForbidden = isAccessDenied || httpStatus === 403;

  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Contacts Directory</h2>
        <p className="cs-page-desc">
          Manage contact records, golden identity keys, communication channels, and consent status.
        </p>
        {canWrite && onCreate && !accessForbidden && (
          <Button type="button" onClick={onCreate} aria-label="Create contact">
            Add Contact
          </Button>
        )}
      </div>

      {accessForbidden ? (
        <AccessDeniedView
          requiredCapability={requiredCapability}
          requiredRole={requiredRole}
          currentRole={currentRole}
          resourceName="Contacts Directory"
        />
      ) : (
        <>
          {onSearchChange && onFilterChange && (
            <FilterToolbar
              search={search}
              onSearchChange={onSearchChange}
              facets={facets}
              filters={filters}
              onFilterChange={onFilterChange}
              activePills={activePills}
              onRemoveFilter={onRemoveFilter ?? (() => {})}
              onClearAll={onClearAllFilters ?? (() => {})}
              searchPlaceholder="Search contacts by name or email..."
            />
          )}

          {error && (
            <div className="cs-error-container" style={{ marginBottom: '16px' }}>
              <ErrorAlert error={error} onRetry={onRetry} />
            </div>
          )}

          {isLoading ? (
            <TableSkeleton
              rowCount={5}
              columnCount={CONTACTS_COLUMNS.length}
              ariaLabel="Loading contacts from server..."
            />
          ) : !error && (
            <DataTable
              columns={CONTACTS_COLUMNS}
              data={displayData}
              loading={false}
              emptyTitle={isFiltersActive ? 'No matching records found' : 'No records found'}
              emptyDescription={
                isFiltersActive
                  ? 'No contacts match your search and filter criteria. Try adjusting your search term or clearing filters.'
                  : 'No contact records currently exist. Add a contact or import via Migration Kit.'
              }
              emptyActionLabel={emptyActionLabel}
              onEmptyAction={canWrite ? onEmptyAction ?? onCreate : undefined}
              hasActiveFilters={isFiltersActive}
              onClearFilters={onClearAllFilters}
              sort={sort}
              onSortChange={onSortChange}
              pagination={pagination}
              onPageChange={onPageChange}
              rowActions={canWrite && onEdit ? (contact) => (
                <Button type="button" variant="outline" size="sm" onClick={() => onEdit(contact)}>
                  Edit
                </Button>
              ) : undefined}
              rowActionsLabel="Contact actions"
            />
          )}
        </>
      )}
    </div>
  );
};
