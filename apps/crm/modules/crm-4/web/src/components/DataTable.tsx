import React from 'react';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Button,
  Alert,
} from '@cs/ui';
import type {
  DataTableColumn,
  TableSortState,
  TablePaginationState,
} from '../../table/types.js';
import { TableSkeleton } from './TableSkeleton.js';
import { EmptyState } from './EmptyState.js';
import { AccessDeniedView } from './AccessDeniedView.js';
import { sanitizeErrorMessage } from './ErrorAlert.js';

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
  secondaryActionLabel?: string | undefined;
  onSecondaryAction?: (() => void) | undefined;
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
  renderCell?: ((column: DataTableColumn<T>, row: T) => React.ReactNode) | undefined;
  keyExtractor?: ((row: T) => string) | undefined;
  ariaLabel?: string | undefined;
}

export function DataTable<T extends Record<string, unknown>>({
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
  secondaryActionLabel,
  onSecondaryAction,
  hasActiveFilters = false,
  onClearFilters,
  isAccessDenied = false,
  httpStatus,
  requiredCapability = 'module.read',
  requiredRole,
  currentRole,
  resourceName = 'Marketing Lists and Campaign History',
  onAccessBack,
  sort,
  onSortChange,
  pagination,
  onPageChange,
  onPageSizeChange,
  renderCell,
  keyExtractor,
  ariaLabel = 'CRM Data Table',
}: DataTableProps<T>): React.ReactElement {
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

  // 0. API Error State (Alert Banner with Retry and Sanitized Message)
  if (error) {
    const errorMsg = sanitizeErrorMessage(error);
    return (
      <div
        className="p-4 cs-table-card cs-table-error-wrapper"
        role="region"
        aria-label="Table Error Banner"
      >
        <Alert variant="error" title="Unable to load table data">
          <p className="text-sm mt-1">{errorMsg}</p>
          {onRetry && (
            <div className="mt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                aria-label="Retry loading table data"
              >
                Retry
              </Button>
            </div>
          )}
        </Alert>
      </div>
    );
  }

  // 1. Mandatory Loading State (Animated Table Skeleton)
  if (loading) {
    return (
      <TableSkeleton
        role="status"
        aria-label="Loading table data"
        rowCount={loadingRowCount}
        columnCount={columns.length}
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

    if (emptyActionLabel && onEmptyAction) {
      return (
        <div className="cs-table-card" role="status">
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            actionLabel={emptyActionLabel}
            onAction={onEmptyAction}
            secondaryActionLabel={secondaryActionLabel}
            onSecondaryAction={onSecondaryAction}
          />
        </div>
      );
    }

    return (
      <div className="p-12 text-center cs-table-card" role="status" aria-label="No records found">
        <h3 className="text-base font-semibold text-slate-900">{emptyTitle}</h3>
        <p className="text-sm text-slate-500 mt-1">{emptyDescription}</p>
      </div>
    );
  }

  // Pagination calculation
  const page = pagination?.page ?? 1;
  const pageSize = pagination?.pageSize ?? 25;
  const total = pagination?.total ?? data.length;
  const totalPages = pagination?.totalPages ?? Math.max(1, Math.ceil(total / pageSize));
  const startItem = total > 0 ? (page - 1) * pageSize + 1 : 0;
  const endItem = total > 0 ? Math.min(page * pageSize, total) : 0;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <Table aria-label={ariaLabel}>
          <TableHeader>
            <TableRow>
              {columns.map((col) => {
                const isSorted = sort?.columnKey === col.key;
                const sortDirection = isSorted ? sort.direction : undefined;
                const ariaSort = isSorted
                  ? sortDirection === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : col.sortable
                    ? 'none'
                    : undefined;

                return (
                  <TableHead
                    key={col.key}
                    style={col.width ? { width: col.width } : undefined}
                    className={`whitespace-nowrap ${
                      col.align === 'center'
                        ? 'text-center'
                        : col.align === 'right'
                          ? 'text-right'
                          : 'text-left'
                    }`}
                    aria-sort={ariaSort}
                  >
                    {col.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => onSortChange(col.key)}
                        className={`inline-flex items-center gap-1 font-semibold text-xs tracking-wider uppercase transition-colors hover:text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded px-1 -mx-1 ${
                          isSorted ? 'text-indigo-600 font-bold' : 'text-slate-700'
                        }`}
                        aria-label={`Sort by ${col.header}${
                          isSorted
                            ? sortDirection === 'asc'
                              ? ', currently ascending'
                              : ', currently descending'
                            : ''
                        }`}
                      >
                        <span>{col.header}</span>
                        <span className="text-xs" aria-hidden="true">
                          {isSorted ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : ' ↕'}
                        </span>
                      </button>
                    ) : (
                      <span className="font-semibold text-xs tracking-wider uppercase text-slate-700">
                        {col.header}
                      </span>
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row, index) => {
              const rowKey = keyExtractor
                ? keyExtractor(row)
                : typeof row['id'] === 'string'
                  ? row['id']
                  : `row-${index}`;

              return (
                <TableRow key={rowKey} className="hover:bg-slate-50 transition-colors">
                  {columns.map((col) => {
                    const value = (row as Record<string, unknown>)[col.key];
                    const content = renderCell
                      ? renderCell(col, row)
                      : col.format
                        ? col.format(value, row)
                        : value !== null && value !== undefined
                          ? String(value)
                          : '';

                    return (
                      <TableCell
                        key={`${rowKey}-${col.key}`}
                        className={`text-sm ${
                          col.align === 'center'
                            ? 'text-center'
                            : col.align === 'right'
                              ? 'text-right'
                              : 'text-left'
                        }`}
                      >
                        {content}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Controls */}
      {pagination && (
        <div
          className="flex flex-col sm:flex-row items-center justify-between gap-4 py-2 px-1"
          role="navigation"
          aria-label="Table pagination"
        >
          <div className="text-sm text-slate-600" aria-live="polite">
            Showing <span className="font-semibold text-slate-900">{startItem}</span> to{' '}
            <span className="font-semibold text-slate-900">{endItem}</span> of{' '}
            <span className="font-semibold text-slate-900">{total}</span> records
          </div>

          <div className="flex items-center gap-4">
            {onPageSizeChange && (
              <div className="flex items-center gap-2">
                <label htmlFor="crm4-page-size-select" className="text-sm text-slate-600">
                  Rows per page:
                </label>
                <select
                  id="crm4-page-size-select"
                  value={pageSize}
                  onChange={(e) => onPageSizeChange(Number(e.target.value))}
                  className="text-sm border border-slate-300 rounded px-2 py-1 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label="Select rows per page"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPageChange?.(page - 1)}
                disabled={page <= 1}
                aria-label="Previous page"
              >
                Previous
              </Button>
              <span className="text-sm text-slate-600 px-2">
                Page <span className="font-semibold text-slate-900">{page}</span> of{' '}
                <span className="font-semibold text-slate-900">{totalPages}</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPageChange?.(page + 1)}
                disabled={page >= totalPages}
                aria-label="Next page"
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
