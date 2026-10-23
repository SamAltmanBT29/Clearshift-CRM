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
  onPageSizeChange?: ((newPageSize: number) => void) | undefined;
  renderRowActions?: ((row: T) => React.ReactNode) | undefined;
  renderCustomCell?: ((col: DataTableColumn<T>, row: T) => React.ReactNode | null) | undefined;
  className?: string | undefined;
  id?: string | undefined;
}

/**
 * Main CRM-2 Data Table Component with integrated Bounded Pagination,
 * Predictable Header Sorting, Loading Skeleton, Empty State, Error Alert,
 * and 403 Forbidden Access-Denied UI States.
 * Conforms to ClearShift V1 Issue #130 (CRM2-17).
 */
export const DataTable = <T extends Record<string, unknown>>({
  columns,
  data,
  loading = false,
  loadingRowCount = 5,
  error = null,
  onRetry,
  emptyTitle = 'No records found',
  emptyDescription = 'There are no records matching your current filter criteria.',
  emptyActionLabel,
  onEmptyAction,
  hasActiveFilters = false,
  onClearFilters,
  isAccessDenied = false,
  httpStatus,
  requiredCapability = 'module.read',
  requiredRole,
  currentRole,
  resourceName = 'Deals, Pipeline and Quotes',
  onAccessBack,
  sort,
  onSortChange,
  pagination = { page: 1, pageSize: 25, total: 0, totalPages: 1 },
  onPageChange,
  onPageSizeChange,
  renderRowActions,
  renderCustomCell,
  className = '',
  id,
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
        columnCount={columns.length + (renderRowActions ? 1 : 0)}
        ariaLabel="Loading opportunity records..."
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
            title={emptyTitle === 'No records found' ? 'No matching records found' : emptyTitle}
            description={
              emptyDescription === 'There are no records matching your current filter criteria.'
                ? 'No records matched your search and filter criteria. Try adjusting your search term or clearing filters.'
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

  // 3. Computed pagination records (virtualization/bounded paging)
  const startRecord =
    pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const endRecord = Math.min(pagination.page * pagination.pageSize, pagination.total);
  const isFirstDisabled = pagination.page <= 1;
  const isLastDisabled = pagination.page >= pagination.totalPages || pagination.totalPages === 0;

  return (
    <div id={id} className={`cs-table-card ${className}`.trim()}>
      <div className="cs-table-responsive">
        <table className="cs-table" role="table" aria-label="Data Table">
          <thead className="cs-thead">
            <tr className="cs-tr">
              {columns.map((col) => {
                const isSorted = sort?.columnKey === col.key;
                const ariaSort = isSorted
                  ? sort.direction === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : col.sortable !== false
                  ? 'none'
                  : undefined;

                return (
                  <th
                    key={`col-${col.key}`}
                    scope="col"
                    aria-sort={ariaSort}
                    className={`cs-th ${
                      col.align === 'right'
                        ? 'cs-text-right'
                        : col.align === 'center'
                        ? 'cs-text-center'
                        : 'cs-text-left'
                    }`}
                    style={col.width ? { width: col.width } : undefined}
                  >
                    {col.sortable !== false && onSortChange ? (
                      <button
                        type="button"
                        className="cs-th-sort-btn"
                        onClick={() => onSortChange(col.key)}
                        aria-label={`Sort by ${col.header}, currently ${
                          isSorted
                            ? sort.direction === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : 'unsorted'
                        }`}
                      >
                        <span>{col.header}</span>
                        <span className="cs-sort-indicator" aria-hidden="true">
                          {isSorted ? (
                            sort.direction === 'asc' ? (
                              <span className="cs-sort-icon">▲</span>
                            ) : (
                              <span className="cs-sort-icon">▼</span>
                            )
                          ) : (
                            <span className="cs-sort-icon-idle">↕</span>
                          )}
                        </span>
                      </button>
                    ) : (
                      <span>{col.header}</span>
                    )}
                  </th>
                );
              })}
              {renderRowActions && (
                <th scope="col" className="cs-th cs-text-right" style={{ width: '120px' }}>
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="cs-tbody">
            {data.map((row, rowIndex) => {
              const rowId = (row as any).id || `row-${rowIndex}`;
              return (
                <tr
                  key={`row-${rowId}`}
                  className="cs-tr"
                  data-testid={`table-row-${rowId}`}
                >
                  {columns.map((col) => {
                    const customCell = renderCustomCell ? renderCustomCell(col, row) : null;
                    if (customCell !== null && customCell !== undefined) {
                      return (
                        <td
                          key={`cell-${rowId}-${col.key}`}
                          className={`cs-td ${
                            col.align === 'right'
                              ? 'cs-text-right'
                              : col.align === 'center'
                              ? 'cs-text-center'
                              : 'cs-text-left'
                          }`}
                        >
                          {customCell}
                        </td>
                      );
                    }

                    const rawVal = (row as any)[col.key];
                    const formatted = col.format
                      ? col.format(rawVal, row)
                      : rawVal === null || rawVal === undefined
                      ? '—'
                      : String(rawVal);

                    return (
                      <td
                        key={`cell-${rowId}-${col.key}`}
                        className={`cs-td ${
                          col.align === 'right'
                            ? 'cs-text-right'
                            : col.align === 'center'
                            ? 'cs-text-center'
                            : 'cs-text-left'
                        }`}
                      >
                        {formatted}
                      </td>
                    );
                  })}
                  {renderRowActions && (
                    <td className="cs-td cs-text-right">
                      {renderRowActions(row)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <nav
        className="cs-pagination-toolbar"
        role="navigation"
        aria-label="Table Pagination"
      >
        <div className="cs-pagination-info">
          Showing <span className="cs-font-semibold">{startRecord}</span> to{' '}
          <span className="cs-font-semibold">{endRecord}</span> of{' '}
          <span className="cs-font-semibold">{pagination.total}</span> records
        </div>

        <div className="cs-pagination-actions">
          {onPageSizeChange && (
            <div className="cs-page-size-selector">
              <label htmlFor="cs-table-page-size" className="cs-sr-only">
                Rows per page
              </label>
              <select
                id="cs-table-page-size"
                className="cs-page-size-select"
                value={pagination.pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                aria-label="Select number of records per page"
              >
                <option value={10}>10 / page</option>
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
                <option value={100}>100 / page</option>
              </select>
            </div>
          )}

          <div className="cs-pagination-nav-buttons">
            <button
              type="button"
              className="cs-pagination-btn"
              disabled={isFirstDisabled}
              onClick={() => onPageChange?.(1)}
              aria-label="Go to first page"
            >
              «
            </button>
            <button
              type="button"
              className="cs-pagination-btn"
              disabled={isFirstDisabled}
              onClick={() => onPageChange?.(pagination.page - 1)}
              aria-label="Go to previous page"
            >
              Previous
            </button>
            <span className="cs-pagination-current-page" aria-current="page">
              Page {pagination.page} of {Math.max(1, pagination.totalPages)}
            </span>
            <button
              type="button"
              className="cs-pagination-btn"
              disabled={isLastDisabled}
              onClick={() => onPageChange?.(pagination.page + 1)}
              aria-label="Go to next page"
            >
              Next
            </button>
            <button
              type="button"
              className="cs-pagination-btn"
              disabled={isLastDisabled}
              onClick={() => onPageChange?.(pagination.totalPages)}
              aria-label="Go to last page"
            >
              »
            </button>
          </div>
        </div>
      </nav>
    </div>
  );
};
