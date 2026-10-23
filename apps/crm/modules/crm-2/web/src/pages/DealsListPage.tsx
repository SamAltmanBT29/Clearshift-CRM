import React from 'react';
import { Card, Input, Select, Button } from '@clearshift/ui';
import {
  type Deal,
  type Stage,
  type Crm2StageName,
  CRM2_STAGES,
} from '@clearshift/contracts';
import { DataTable } from '../components/DataTable.js';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';
import { DEALS_COLUMNS } from '../table/columns.js';
import type {
  TableSortState,
  TablePaginationState,
  TableFilterState,
} from '../table/types.js';

export interface DealsListPageProps {
  data?: Deal[];
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
  simulatePermissionDenied?: boolean;
  simulateError?: boolean;
  onCreateDeal?: () => void;
  onSelectDeal?: (deal: Deal) => void;
  onViewQuotes?: (deal: Deal) => void;
  sort?: TableSortState | undefined;
  onSortChange?: ((columnKey: string) => void) | undefined;
  pagination?: TablePaginationState | undefined;
  onPageChange?: ((newPage: number) => void) | undefined;
  search?: string;
  onSearchChange?: ((term: string) => void) | undefined;
  selectedStage?: Crm2StageName | '';
  onStageChange?: ((stage: Crm2StageName | '') => void) | undefined;
  onClearFilters?: (() => void) | undefined;
  hasActiveFilters?: boolean;
  stages?: Stage[];
  initialSort?: TableSortState;
  initialPage?: number;
  initialPageSize?: number;
  filters?: TableFilterState;
}

/**
 * CRM-2 Deals & Pipeline List Page Shell
 * Conforms to ClearShift V1 Issue #132 (CRM2-19).
 * Integrates TableSkeleton, EmptyState, ErrorAlert, and AccessDeniedView.
 */
export const DealsListPage: React.FC<DealsListPageProps> = ({
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
  emptyActionLabel = '+ New Deal',
  onEmptyAction,
  simulatePermissionDenied = false,
  simulateError = false,
  onCreateDeal,
  onSelectDeal,
  onViewQuotes,
  sort,
  onSortChange,
  pagination = { page: 1, pageSize: 25, total: 0, totalPages: 1 },
  onPageChange,
  search = '',
  onSearchChange,
  selectedStage = '',
  onStageChange,
  onClearFilters,
  hasActiveFilters = false,
  stages = CRM2_STAGES,
  filters = {},
}) => {
  const displayData = isEmpty ? [] : data;
  const isFiltersActive =
    Boolean(hasActiveFilters) ||
    Boolean(search) ||
    Boolean(selectedStage) ||
    Object.values(filters).some((v) => Boolean(v && String(v).trim().length > 0));

  const accessForbidden = isAccessDenied || httpStatus === 403 || simulatePermissionDenied;
  const effectiveError = simulateError
    ? new Error('Simulated network communication failure')
    : error;

  const onActionClick = onEmptyAction || onCreateDeal;

  const stageOptions = [
    { value: '', label: 'All Stages' },
    ...stages.map((st: any) => ({
      value: typeof st === 'string' ? st : st.name,
      label: typeof st === 'string' ? st : st.name,
    })),
  ];

  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <div>
          <h2>Deals &amp; Opportunities</h2>
          <p className="cs-page-desc">
            Manage pipeline stages, active negotiations, quote commitments, and deal closures.
          </p>
        </div>
        <div>
          <button
            type="button"
            className="cs-btn-primary cs-create-deal-btn"
            onClick={onCreateDeal}
          >
            + New Deal
          </button>
        </div>
      </div>

      {accessForbidden ? (
        <AccessDeniedView
          requiredCapability={requiredCapability}
          requiredRole={requiredRole}
          currentRole={currentRole}
          resourceName="Deals & Opportunities"
        />
      ) : (
        <>
          {onSearchChange && onStageChange ? (
            <Card className="p-4" data-testid="deals-filter-bar">
              <form
                className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end"
                onSubmit={(e) => e.preventDefault()}
                role="search"
              >
                <div className="sm:col-span-2">
                  <Input
                    id="deals-search-input"
                    label="Search Opportunities"
                    placeholder="Search by deal name or contact..."
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                    aria-label="Search deals by name or contact"
                  />
                </div>

                <div>
                  <Select
                    id="deals-stage-filter"
                    label="Filter by Stage"
                    placeholder="All Stages"
                    options={stageOptions}
                    value={selectedStage}
                    onChange={(e) => onStageChange(e.target.value as Crm2StageName | '')}
                    aria-label="Filter deals by pipeline stage"
                  />
                </div>

                <div className="flex items-center gap-2">
                  {(search || selectedStage) && onClearFilters && (
                    <Button
                      variant="ghost"
                      size="md"
                      onClick={onClearFilters}
                      className="w-full sm:w-auto"
                      aria-label="Reset search and filters"
                    >
                      Clear Filters
                    </Button>
                  )}
                </div>
              </form>
            </Card>
          ) : null}

          {effectiveError ? (
            <div className="cs-error-container" style={{ marginBottom: '16px' }} data-testid="recoverable-error-state">
              <ErrorAlert error={effectiveError} onRetry={onRetry} />
            </div>
          ) : null}

          {isLoading ? (
            <TableSkeleton
              rowCount={5}
              columnCount={DEALS_COLUMNS.length}
              ariaLabel="Loading CRM deals from server..."
            />
          ) : !effectiveError && (
            <DataTable
              columns={DEALS_COLUMNS}
              data={displayData as any}
              loading={false}
              emptyTitle={isFiltersActive ? 'No matching records found' : 'No deals found'}
              emptyDescription={
                isFiltersActive
                  ? 'No opportunities match your current filter criteria. Try adjusting your search term or clearing filters.'
                  : 'No sales opportunities are currently recorded in the system.'
              }
              emptyActionLabel={emptyActionLabel}
              onEmptyAction={onActionClick}
              hasActiveFilters={isFiltersActive}
              onClearFilters={onClearFilters}
              sort={sort}
              onSortChange={onSortChange}
              pagination={pagination}
              onPageChange={onPageChange}
            />
          )}
        </>
      )}
    </div>
  );
};

export default DealsListPage;
