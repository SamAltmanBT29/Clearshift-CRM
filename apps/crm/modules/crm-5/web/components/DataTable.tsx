import React from 'react';
import type {
  DataTableColumn,
  TableSortState,
  TablePaginationState,
} from '../table/types.js';

export interface DataTableProps<T = Record<string, unknown>> {
  columns: DataTableColumn<T>[];
  data: T[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  sort?: TableSortState | undefined;
  onSortChange?: ((columnKey: string) => void) | undefined;
  pagination: TablePaginationState;
  onPageChange?: ((newPage: number) => void) | undefined;
}

export const DataTable = <T extends Record<string, unknown>>({
  columns,
  data,
  loading = false,
  emptyTitle = 'No records found',
  emptyDescription = 'There are no records matching your current filter criteria.',
  sort,
  onSortChange,
  pagination,
  onPageChange,
}: DataTableProps<T>): React.ReactElement => {
  // 1. Mandatory Loading State (Skeleton)
  if (loading) {
    return (
      <div className="cs-table-card" aria-busy="true" aria-label="Loading table data">
        <div className="cs-skeleton-container" role="status">
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
        </div>
      </div>
    );
  }

  // 2. Mandatory Empty State
  if (data.length === 0) {
    return (
      <div className="cs-table-card" role="status">
        <div className="cs-empty-state">
          <h3 className="cs-empty-title">{emptyTitle}</h3>
          <p className="cs-empty-text">{emptyDescription}</p>
        </div>
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
    <div className="cs-table-card">
      <div className="cs-table-responsive">
        <table className="cs-table" role="table">
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
                        aria-label={`Sort by ${col.header}`}
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
            {data.map((row, rowIdx) => (
              <tr key={(row['id'] as string) ?? rowIdx} className="cs-tr">
                {columns.map((col) => {
                  const rawVal = row[col.key];
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
            ))}
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
