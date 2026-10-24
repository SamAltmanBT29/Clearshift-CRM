import React from 'react';
import type {
  DataTableColumn,
  TableSortState,
  TablePaginationState,
} from '../table/types.js';
import { TableSkeleton } from './TableSkeleton.js';
import { EmptyState } from './EmptyState.js';
import { ErrorAlert } from './ErrorAlert.js';
import { AccessDeniedView } from './AccessDeniedView.js';

export interface DataTableProps<T = Record<string, unknown>> {
  columns: DataTableColumn<T>[];
  data: T[];
  loading?: boolean | undefined;
  loadingRowCount?: number | undefined;
  error?: string | Error | { code?: string | undefined; message?: string | undefined; details?: unknown } | null | undefined;
  onRetry?: (() => void) | undefined;
  emptyTitle?: string | undefined;
  emptyDescription?: string | undefined;
  emptyActionLabel?: string | undefined;
  onEmptyAction?: (() => void) | undefined;
  hasActiveFilters?: boolean | undefined;
  onClearFilters?: (() => void) | undefined;
  isAccessDenied?: boolean | undefined;
  httpStatus?: number | undefined;
  requiredCapability?: string | undefined;
  requiredRole?: string | undefined;
  currentRole?: string | undefined;
  resourceName?: string | undefined;
  onAccessBack?: (() => void) | undefined;
  sort?: TableSortState | undefined;
  onSortChange?: ((columnKey: string) => void) | undefined;
  pagination?: TablePaginationState | undefined;
  onPageChange?: ((newPage: number) => void) | undefined;
  onSelectRow?: ((row: T) => void) | undefined;
  renderCustomCell?: ((columnKey: string, row: T, value: unknown) => React.ReactNode) | undefined;
  className?: string | undefined;
  tableAriaLabel?: string | undefined;
}

/**
 * Main CRM-3 Generic Data Table Component with integrated Loading, Empty, Error,
 * and 403 Forbidden Access-Denied UI States.
 * Conforms to ClearShift V1 Issue #150 (CRM3-17).
 */
export const DataTable = <T extends Record<string, unknown>>({
  columns,
  data,
  loading = false,
  loadingRowCount = 5,
  error = null,
  onRetry,
  emptyTitle = 'No tickets found',
  emptyDescription = 'There are no support tickets matching your current filter criteria.',
  emptyActionLabel,
  onEmptyAction,
  hasActiveFilters = false,
  onClearFilters,
  isAccessDenied = false,
  httpStatus,
  requiredCapability = 'module.read',
  requiredRole,
  currentRole,
  resourceName = 'Support Tickets Queue',
  onAccessBack,
  sort,
  onSortChange,
  pagination = { page: 1, pageSize: 25, total: 0, totalPages: 1 },
  onPageChange,
  onSelectRow,
  renderCustomCell,
  className = '',
  tableAriaLabel = 'Support Tickets Data Table',
}: DataTableProps<T>): React.ReactElement => {
  // -1. 403 Forbidden Access-Denied State
  if (isAccessDenied || httpStatus === 403) {
    return (
      <AccessDeniedView
        requiredCapability={requiredCapability}
        requiredRole={requiredRole}
        currentRole={currentRole}
        resourceName={resourceName}
        onBack={onAccessBack}
      />
    );
  }

  // 0. API Error State (Alert Banner with Retry)
  if (error) {
    return (
      <div className="cs-table-card cs-table-error-wrapper" role="region" aria-label="Table Error">
        <ErrorAlert error={error} onRetry={onRetry} />
      </div>
    );
  }

  // 1. Mandatory Loading State (Animated Table Skeleton)
  if (loading) {
    return (
      <TableSkeleton
        rowCount={loadingRowCount}
        columnCount={columns.length}
        ariaLabel="Loading support tickets queue..."
      />
    );
  }

  // 2. Mandatory Empty State
  if (data.length === 0) {
    if (hasActiveFilters) {
      return (
        <div className="cs-table-card" role="status">
          <EmptyState
            className="cs-empty-filter-state"
            icon="🔍"
            title={emptyTitle === 'No tickets found' ? 'No matching tickets found' : emptyTitle}
            description={
              emptyDescription === 'There are no support tickets matching your current filter criteria.'
                ? 'No tickets matched your search and filter criteria. Try adjusting your query or resetting filters.'
                : emptyDescription
            }
            actionLabel="Reset All Filters"
            onAction={onClearFilters}
          />
        </div>
      );
    }

    return (
      <div className="cs-table-card" role="status">
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          actionLabel={emptyActionLabel}
          onAction={onEmptyAction}
        />
      </div>
    );
  }

  // 3. Computed pagination records
  const startRecord =
    pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const endRecord = Math.min(pagination.page * pagination.pageSize, pagination.total);
  const isFirstDisabled = pagination.page <= 1;
  const isLastDisabled = pagination.page >= pagination.totalPages;

  return (
    <div className={`cs-table-card ${className}`.trim()}>
      <div className="cs-table-responsive">
        <table className="cs-table" role="table" aria-label={tableAriaLabel}>
          <thead className="cs-thead">
            <tr className="cs-tr">
              {columns.map((col) => {
                const isSorted = sort?.columnKey === col.key;
                const ariaSort = isSorted
                  ? sort.direction === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : col.sortable
                  ? 'none'
                  : undefined;

                const alignClass = col.align ? ` cs-text-${col.align}` : '';

                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={ariaSort}
                    className={`cs-th${alignClass}`}
                    style={col.width ? { width: col.width } : undefined}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        className="cs-th-sort-btn"
                        onClick={() => onSortChange?.(col.key)}
                        aria-label={`Sort by ${col.header}, currently ${
                          isSorted
                            ? sort.direction === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : 'unsorted'
                        }`}
                      >
                        <span>{col.header}</span>
                        {isSorted ? (
                          <span aria-hidden="true" className="cs-sort-icon">
                            {sort.direction === 'asc' ? '▲' : '▼'}
                          </span>
                        ) : (
                          <span aria-hidden="true" className="cs-sort-icon-idle">
                            ↕
                          </span>
                        )}
                      </button>
                    ) : (
                      <span>{col.header}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="cs-tbody">
            {data.map((row, rowIdx) => {
              const rowId = (row['id'] as string) ?? `row-${rowIdx}`;
              return (
                <tr
                  key={rowId}
                  className={`cs-tr${onSelectRow ? ' cs-tr-clickable' : ''}`}
                  onClick={() => onSelectRow?.(row)}
                  data-testid={`table-row-${rowId}`}
                >
                  {columns.map((col) => {
                    const rawVal = row[col.key];

                    if (renderCustomCell) {
                      const custom = renderCustomCell(col.key, row, rawVal);
                      if (custom !== undefined) {
                        return (
                          <td
                            key={col.key}
                            className={`cs-td${col.align ? ` cs-text-${col.align}` : ''}`}
                          >
                            {custom}
                          </td>
                        );
                      }
                    }

                    const formatted = col.format
                      ? col.format(rawVal, row)
                      : rawVal !== null && rawVal !== undefined
                      ? String(rawVal)
                      : '—';
                    const alignClass = col.align ? ` cs-text-${col.align}` : '';

                    return (
                      <td key={col.key} className={`cs-td${alignClass}`}>
                        {formatted}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Toolbar */}
      <nav aria-label="Table Pagination" className="cs-pagination-toolbar">
        <div className="cs-pagination-info">
          Showing <span className="cs-font-semibold">{startRecord}</span> to{' '}
          <span className="cs-font-semibold">{endRecord}</span> of{' '}
          <span className="cs-font-semibold">{pagination.total}</span> records
        </div>
        <div className="cs-pagination-controls">
          <button
            type="button"
            className="cs-pagination-btn"
            disabled={isFirstDisabled}
            aria-disabled={isFirstDisabled}
            onClick={() => onPageChange?.(1)}
            aria-label="Go to first page"
          >
            « First
          </button>
          <button
            type="button"
            className="cs-pagination-btn"
            disabled={isFirstDisabled}
            aria-disabled={isFirstDisabled}
            onClick={() => onPageChange?.(pagination.page - 1)}
            aria-label="Go to previous page"
          >
            ‹ Prev
          </button>
          <span className="cs-pagination-page" aria-current="page">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            type="button"
            className="cs-pagination-btn"
            disabled={isLastDisabled}
            aria-disabled={isLastDisabled}
            onClick={() => onPageChange?.(pagination.page + 1)}
            aria-label="Go to next page"
          >
            Next ›
          </button>
          <button
            type="button"
            className="cs-pagination-btn"
            disabled={isLastDisabled}
            aria-disabled={isLastDisabled}
            onClick={() => onPageChange?.(pagination.totalPages)}
            aria-label="Go to last page"
          >
            Last »
          </button>
        </div>
      </nav>
    </div>
  );
};
