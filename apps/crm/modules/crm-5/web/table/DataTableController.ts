import type {
  DataTableColumn,
  TableSortState,
  TablePaginationState,
  TableFilterState,
  SortDirection,
} from './types.js';

export interface DataTableControllerOptions<T = Record<string, unknown>> {
  columns: DataTableColumn<T>[];
  initialPage?: number;
  initialPageSize?: number;
  initialSort?: TableSortState;
  initialFilters?: TableFilterState;
  onQueryChange?: (params: Record<string, string>) => void;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Controller for bounded, accessible, server-side sorted & paginated data tables.
 * Fully compliant with WAI-ARIA standards and ClearShift V1 performance ceilings.
 */
export class DataTableController<T = Record<string, unknown>> {
  private columns: DataTableColumn<T>[];
  private page: number;
  private pageSize: number;
  private total: number = 0;
  private sort?: TableSortState | undefined;
  private filters: TableFilterState;
  private onQueryChange?: ((params: Record<string, string>) => void) | undefined;

  constructor(options: DataTableControllerOptions<T>) {
    this.columns = options.columns;
    this.page = Math.max(1, options.initialPage ?? 1);
    this.pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, options.initialPageSize ?? DEFAULT_PAGE_SIZE)
    );
    this.sort = options.initialSort;
    this.filters = { ...(options.initialFilters ?? {}) };
    this.onQueryChange = options.onQueryChange;
  }

  public getColumns(): DataTableColumn<T>[] {
    return [...this.columns];
  }

  public getPagination(): TablePaginationState {
    const totalPages = Math.max(1, Math.ceil(this.total / this.pageSize));
    return {
      page: this.page,
      pageSize: this.pageSize,
      total: this.total,
      totalPages,
    };
  }

  public setTotal(total: number): void {
    this.total = Math.max(0, total);
    const { totalPages } = this.getPagination();
    if (this.page > totalPages && totalPages > 0) {
      this.page = totalPages;
    }
  }

  public setPage(newPage: number): void {
    const { totalPages } = this.getPagination();
    const clamped = Math.max(1, Math.min(newPage, totalPages));
    if (this.page !== clamped) {
      this.page = clamped;
      this.notifyQueryChange();
    }
  }

  public nextPage(): boolean {
    const { totalPages } = this.getPagination();
    if (this.page < totalPages) {
      this.setPage(this.page + 1);
      return true;
    }
    return false;
  }

  public prevPage(): boolean {
    if (this.page > 1) {
      this.setPage(this.page - 1);
      return true;
    }
    return false;
  }

  public firstPage(): void {
    this.setPage(1);
  }

  public lastPage(): void {
    const { totalPages } = this.getPagination();
    this.setPage(totalPages);
  }

  public setPageSize(newSize: number): void {
    const clamped = Math.min(MAX_PAGE_SIZE, Math.max(1, newSize));
    if (this.pageSize !== clamped) {
      this.pageSize = clamped;
      this.page = 1; // Reset to page 1 on pageSize change
      this.notifyQueryChange();
    }
  }

  public getSort(): TableSortState | undefined {
    return this.sort ? { ...this.sort } : undefined;
  }

  public toggleSort(columnKey: string): void {
    const col = this.columns.find((c) => c.key === columnKey);
    if (!col || col.sortable === false) return;

    if (this.sort?.columnKey === columnKey) {
      const nextDir: SortDirection = this.sort.direction === 'asc' ? 'desc' : 'asc';
      this.sort = { columnKey, direction: nextDir };
    } else {
      this.sort = { columnKey, direction: 'asc' };
    }

    this.page = 1; // Reset to page 1 on sort change
    this.notifyQueryChange();
  }

  public setFilters(filters: TableFilterState): void {
    this.filters = { ...filters };
    this.page = 1;
    this.notifyQueryChange();
  }

  public getFilters(): TableFilterState {
    return { ...this.filters };
  }

  public toQueryParams(): Record<string, string> {
    const params: Record<string, string> = {
      page: String(this.page),
      pageSize: String(this.pageSize),
      limit: String(this.pageSize),
    };

    if (this.sort) {
      params['sort'] = this.sort.columnKey;
      params['order'] = this.sort.direction;
    }

    if (this.filters.module) params['module'] = this.filters.module;
    if (this.filters.batchId) params['batchId'] = this.filters.batchId;
    if (this.filters.status) params['status'] = this.filters.status;
    if (this.filters.step) params['step'] = this.filters.step;

    return params;
  }

  public toQueryString(): string {
    const params = this.toQueryParams();
    const query = new URLSearchParams(params).toString();
    return query ? `?${query}` : '';
  }

  private notifyQueryChange(): void {
    if (this.onQueryChange) {
      this.onQueryChange(this.toQueryParams());
    }
  }

  /**
   * Generates accessible WAI-ARIA table markup with sortable headers,
   * skeleton loading state, empty state, and pagination toolbar.
   */
  public renderHtml(
    data: T[],
    options?: {
      loading?: boolean;
      emptyTitle?: string;
      emptyDescription?: string;
    }
  ): string {
    const loading = options?.loading ?? false;
    const pagination = this.getPagination();

    // 1. Loading Skeleton
    if (loading) {
      return `
<div class="cs-table-card">
  <div class="cs-skeleton-container" role="status" aria-label="Loading table data">
    <div class="cs-skeleton-line" style="width: 100%; height: 44px;"></div>
    <div class="cs-skeleton-line" style="width: 100%; height: 44px;"></div>
    <div class="cs-skeleton-line" style="width: 100%; height: 44px;"></div>
    <div class="cs-skeleton-line" style="width: 100%; height: 44px;"></div>
  </div>
</div>`;
    }

    // 2. Empty State
    if (data.length === 0) {
      const emptyTitle = options?.emptyTitle ?? 'No records found';
      const emptyDesc =
        options?.emptyDescription ??
        'There are no records matching your current filter criteria.';
      return `
<div class="cs-table-card">
  <div class="cs-empty-state" role="status">
    <h3 class="cs-empty-title">${emptyTitle}</h3>
    <p class="cs-empty-text">${emptyDesc}</p>
  </div>
</div>`;
    }

    // 3. Header Rows with WAI-ARIA aria-sort
    const headerHtml = this.columns
      .map((col) => {
        const isSorted = this.sort?.columnKey === col.key;
        const ariaSort = isSorted
          ? this.sort!.direction === 'asc'
            ? 'ascending'
            : 'descending'
          : col.sortable
          ? 'none'
          : undefined;

        const sortAttr = ariaSort ? ` aria-sort="${ariaSort}"` : '';
        const widthAttr = col.width ? ` style="width: ${col.width};"` : '';
        const alignClass = col.align ? ` cs-text-${col.align}` : '';

        if (col.sortable) {
          const sortIndicator = isSorted
            ? this.sort!.direction === 'asc'
              ? ' <span aria-hidden="true" class="cs-sort-icon">▲</span>'
              : ' <span aria-hidden="true" class="cs-sort-icon">▼</span>'
            : ' <span aria-hidden="true" class="cs-sort-icon-idle">↕</span>';

          return `<th scope="col"${sortAttr}${widthAttr} class="cs-th${alignClass}">
  <button type="button" class="cs-th-sort-btn" data-key="${col.key}" aria-label="Sort by ${col.header}">
    <span>${col.header}</span>${sortIndicator}
  </button>
</th>`;
        }

        return `<th scope="col"${widthAttr} class="cs-th${alignClass}">${col.header}</th>`;
      })
      .join('');

    // 4. Data Rows
    const bodyHtml = data
      .map((row) => {
        const rowRecord = row as Record<string, unknown>;
        const cellsHtml = this.columns
          .map((col) => {
            const rawVal = rowRecord[col.key];
            const formatted = col.format
              ? col.format(rawVal, row)
              : rawVal !== null && rawVal !== undefined
              ? String(rawVal)
              : '—';
            const alignClass = col.align ? ` cs-text-${col.align}` : '';
            return `<td class="cs-td${alignClass}">${formatted}</td>`;
          })
          .join('');
        return `<tr class="cs-tr">${cellsHtml}</tr>`;
      })
      .join('');

    // 5. Pagination Toolbar
    const startRecord = this.total === 0 ? 0 : (this.page - 1) * this.pageSize + 1;
    const endRecord = Math.min(this.page * this.pageSize, this.total);
    const isFirstDisabled = this.page <= 1;
    const isLastDisabled = this.page >= pagination.totalPages;

    const paginationToolbarHtml = `
<nav aria-label="Table Pagination" class="cs-pagination-toolbar">
  <div class="cs-pagination-info">
    Showing <span class="cs-font-semibold">${startRecord}</span> to <span class="cs-font-semibold">${endRecord}</span> of <span class="cs-font-semibold">${this.total}</span> records
  </div>
  <div class="cs-pagination-controls">
    <button type="button" class="cs-pagination-btn" data-action="first"${isFirstDisabled ? ' disabled aria-disabled="true"' : ''} aria-label="Go to first page">« First</button>
    <button type="button" class="cs-pagination-btn" data-action="prev"${isFirstDisabled ? ' disabled aria-disabled="true"' : ''} aria-label="Go to previous page">‹ Prev</button>
    <span class="cs-pagination-page" aria-current="page">Page ${this.page} of ${pagination.totalPages}</span>
    <button type="button" class="cs-pagination-btn" data-action="next"${isLastDisabled ? ' disabled aria-disabled="true"' : ''} aria-label="Go to next page">Next ›</button>
    <button type="button" class="cs-pagination-btn" data-action="last"${isLastDisabled ? ' disabled aria-disabled="true"' : ''} aria-label="Go to last page">Last »</button>
  </div>
</nav>`;

    return `
<div class="cs-table-card">
  <div class="cs-table-responsive">
    <table class="cs-table" role="table">
      <thead class="cs-thead">
        <tr class="cs-tr">${headerHtml}</tr>
      </thead>
      <tbody class="cs-tbody">
        ${bodyHtml}
      </tbody>
    </table>
  </div>
  ${paginationToolbarHtml}
</div>`;
  }
}
