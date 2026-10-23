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

export interface DataTableProps<T = Record<string, unknown>> {
  columns: DataTableColumn<T>[];
  data: T[];
  loading?: boolean | undefined;
  error?: string | Error | null | undefined;
  onRetry?: (() => void) | undefined;
  emptyTitle?: string | undefined;
  emptyDescription?: string | undefined;
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
  error = null,
  onRetry,
  emptyTitle = 'No records found',
  emptyDescription = 'There are no records matching your current filter criteria.',
  sort,
  onSortChange,
  pagination,
  onPageChange,
  onPageSizeChange,
  renderCell,
  keyExtractor,
  ariaLabel = 'CRM Data Table',
}: DataTableProps<T>): React.ReactElement {
  // Error state
  if (error) {
    const errorMsg = typeof error === 'string' ? error : error.message;
    return (
      <div className="p-4" role="region" aria-label="Table Error Banner">
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

  // Loading state
  if (loading) {
    return (
      <div className="p-12 text-center" role="status" aria-label="Loading table data">
        <div className="animate-spin inline-block w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full mb-3" />
        <p className="text-sm font-medium text-slate-600">Loading data from server...</p>
      </div>
    );
  }

  // Empty state
  if (data.length === 0) {
    return (
      <div className="p-12 text-center" role="status" aria-label="No records found">
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
