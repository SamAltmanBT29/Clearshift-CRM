import React from 'react';
import { Button, Select } from '@cs/ui';
import {
  CRM1LeadStatusSchema,
  CRM1_LEAD_STATUS_TRANSITIONS,
  type CRM1LeadRead,
} from '@clearshift/contracts/crm-1';
import { DataTable } from '../components/DataTable.js';
import { FilterToolbar } from '../components/FilterToolbar.js';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';
import { LEADS_COLUMNS } from '../table/columns.js';
import { CRM1_LEADS_FACETS } from '../table/facets.js';
import type {
  TableSortState,
  TablePaginationState,
  TableFilterState,
  ActiveFilterPill,
  FilterFacet,
} from '../table/types.js';

export interface LeadsPipelinePageProps {
  data?: CRM1LeadRead[];
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
  onEdit?: ((lead: CRM1LeadRead) => void) | undefined;
  onSetStatus?: ((lead: CRM1LeadRead, status: CRM1LeadRead['status']) => void) | undefined;
}

/**
 * Leads Pipeline Page Shell
 * Integrates with /api/v1/crm-contacts/leads, FilterToolbar, and paginated DataTable.
 * Conforms to ClearShift V1 Issue #111 (CRM1-18) and Issue #112 (CRM1-19).
 */
export const LeadsPipelinePage: React.FC<LeadsPipelinePageProps> = ({
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
  emptyActionLabel = 'Create Lead',
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
  facets = CRM1_LEADS_FACETS,
  hasActiveFilters = false,
  canWrite = false,
  onCreate,
  onEdit,
  onSetStatus,
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
        <h2>Leads Pipeline</h2>
        <p className="cs-page-desc">
          Track prospective sales opportunities through verified lifecycle stages: New, Working, Qualified, and Closed.
        </p>
        {canWrite && onCreate && !accessForbidden && (
          <Button type="button" onClick={onCreate} aria-label="Create lead">
            Add Lead
          </Button>
        )}
      </div>

      {accessForbidden ? (
        <AccessDeniedView
          requiredCapability={requiredCapability}
          requiredRole={requiredRole}
          currentRole={currentRole}
          resourceName="Leads Pipeline"
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
              searchPlaceholder="Search leads by contact name or email..."
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
              columnCount={LEADS_COLUMNS.length}
              ariaLabel="Loading leads pipeline from server..."
            />
          ) : !error && (
            <DataTable
              columns={LEADS_COLUMNS}
              data={displayData}
              loading={false}
              emptyTitle={isFiltersActive ? 'No matching records found' : 'No records found'}
              emptyDescription={
                isFiltersActive
                  ? 'No leads match your search and filter criteria. Try adjusting your search term or clearing filters.'
                  : 'No active leads in pipeline. Create a new lead or import prospects from marketing sources.'
              }
              emptyActionLabel={emptyActionLabel}
              onEmptyAction={canWrite ? onEmptyAction ?? onCreate : undefined}
              hasActiveFilters={isFiltersActive}
              onClearFilters={onClearAllFilters}
              sort={sort}
              onSortChange={onSortChange}
              pagination={pagination}
              onPageChange={onPageChange}
              rowActions={canWrite ? (lead) => (
                <div className="cs-flex cs-items-center cs-gap-2">
                  {onEdit && (
                    <Button type="button" variant="outline" size="sm" onClick={() => onEdit(lead)}>
                      Edit
                    </Button>
                  )}
                  {onSetStatus && (
                    <Select
                      label={`Update status for ${lead.contactName}`}
                      value={lead.status}
                      options={[lead.status, ...CRM1_LEAD_STATUS_TRANSITIONS[lead.status]].map((status) => ({
                        value: status,
                        label: status,
                      }))}
                      onChange={(event) => onSetStatus(lead, CRM1LeadStatusSchema.parse(event.target.value))}
                    />
                  )}
                </div>
              ) : undefined}
              rowActionsLabel="Lead actions"
            />
          )}
        </>
      )}
    </div>
  );
};
