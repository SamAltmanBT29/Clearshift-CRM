import type {
  DataTableColumn,
  TableSortState,
  TablePaginationState,
  TableFilterState,
  SortDirection,
} from './types.js';
import { sanitizeErrorMessage } from '../src/components/ErrorAlert.js';

export interface DataTableControllerOptions<T = Record<string, unknown>> {
  columns: DataTableColumn<T>[];
  initialPage?: number;
  initialPageSize?: number;
  initialSort?: TableSortState;
  initialFilters?: TableFilterState;
  onQueryChange?: (params: Record<string, string>) => void;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MIN_PAGE_SIZE = 5;

/**
 * Controller for bounded, accessible, server-side sorted & paginated CRM-4 data tables.
 * Fully compliant with WAI-ARIA standards, SDS CRM-4 specs, and ClearShift V1 performance ceilings.
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

  public previousPage(): boolean {
    if (this.page > 1) {
      this.setPage(this.page - 1);
      return true;
    }
    return false;
  }

  public setPageSize(newSize: number): void {
    const clamped = Math.min(MAX_PAGE_SIZE, Math.max(1, newSize));
    if (this.pageSize !== clamped) {
      this.pageSize = clamped;
      // Requirement: changing page size resets to page 1 to prevent out-of-range state
      this.page = 1;
      this.notifyQueryChange();
    }
  }

  public getSort(): TableSortState | undefined {
    return this.sort ? { ...this.sort } : undefined;
  }

  public toggleSort(columnKey: string): TableSortState {
    const col = this.columns.find((c) => c.key === columnKey);
    if (!col || col.sortable === false) {
      return this.sort ?? { columnKey, direction: 'asc' };
    }

    if (this.sort?.columnKey === columnKey) {
      // Toggle between asc and desc
      const newDirection: SortDirection = this.sort.direction === 'asc' ? 'desc' : 'asc';
      this.sort = { columnKey, direction: newDirection };
    } else {
      this.sort = { columnKey, direction: 'asc' };
    }

    // Changing sort resets pagination to page 1
    this.page = 1;
    this.notifyQueryChange();
    return { ...this.sort };
  }

  public setSort(columnKey: string, direction: SortDirection): void {
    this.sort = { columnKey, direction };
    this.page = 1;
    this.notifyQueryChange();
  }

  public clearSort(): void {
    if (this.sort) {
      this.sort = undefined;
      this.page = 1;
      this.notifyQueryChange();
    }
  }

  public getFilters(): TableFilterState {
    return { ...this.filters };
  }

  public setFilter(key: string, value: string | undefined): void {
    if (value === undefined || value === '') {
      delete this.filters[key];
    } else {
      this.filters[key] = value;
    }
    // Search or filter mutations reset to page 1
    this.page = 1;
    this.notifyQueryChange();
  }

  public clearFilter(key: string): void {
    if (this.filters[key] !== undefined) {
      delete this.filters[key];
      this.page = 1;
      this.notifyQueryChange();
    }
  }

  public clearAllFilters(): void {
    this.filters = {};
    this.page = 1;
    this.notifyQueryChange();
  }

  public hasActiveFilters(): boolean {
    return Object.values(this.filters).some((val) => val !== undefined && val !== '');
  }

  public toQueryParams(): Record<string, string> {
    const params: Record<string, string> = {
      page: String(this.page),
      pageSize: String(this.pageSize),
    };

    if (this.sort) {
      params['sortBy'] = this.sort.columnKey;
      params['sortDirection'] = this.sort.direction;
    }

    for (const [key, value] of Object.entries(this.filters)) {
      if (value !== undefined && value !== '') {
        params[key] = value;
      }
    }

    return params;
  }

  public toQueryString(): string {
    const params = this.toQueryParams();
    const query = new URLSearchParams(params).toString();
    return query ? `?${query}` : '';
  }

  /**
   * Generates accessible WAI-ARIA table markup with sortable headers,
   * skeleton loading state, empty state, error alert banner, and access-denied view.
   */
  public renderHtml(
    data: T[],
    options?: {
      loading?: boolean | undefined;
      loadingRowCount?: number | undefined;
      error?: unknown | undefined;
      onRetryAction?: string | undefined;
      emptyTitle?: string | undefined;
      emptyDescription?: string | undefined;
      emptyActionLabel?: string | undefined;
      emptyActionName?: string | undefined;
      hasActiveFilters?: boolean | undefined;
      httpStatus?: number | undefined;
      isAccessDenied?: boolean | undefined;
      requiredCapability?: string | undefined;
      requiredRole?: string | undefined;
      currentRole?: string | undefined;
      resourceName?: string | undefined;
    }
  ): string {
    // 0. Access Denied (403 Forbidden)
    if (options?.isAccessDenied || options?.httpStatus === 403) {
      return this.renderAccessDeniedHtml({
        requiredCapability: options?.requiredCapability,
        requiredRole: options?.requiredRole,
        currentRole: options?.currentRole,
        resourceName: options?.resourceName,
      });
    }

    // 1. API Error Banner
    if (options?.error) {
      return this.renderErrorAlertHtml(options.error, {
        onRetryAction: options?.onRetryAction,
      });
    }

    // 2. Loading Skeleton Table
    if (options?.loading) {
      return this.renderTableSkeletonHtml(options?.loadingRowCount ?? 5);
    }

    // 3. Empty State
    if (data.length === 0) {
      const activeFilters = options?.hasActiveFilters ?? this.hasActiveFilters();
      if (activeFilters) {
        return this.renderEmptyStateHtml({
          title: options?.emptyTitle ?? 'No matching records found',
          description:
            options?.emptyDescription ??
            'No records matched your search and filter criteria. Try adjusting your search term or clearing filters.',
          actionLabel: 'Reset All Filters',
          isFilterReset: true,
        });
      }

      return this.renderEmptyStateHtml({
        title: options?.emptyTitle ?? 'No records found',
        description:
          options?.emptyDescription ??
          'There are no records currently available in this view.',
        actionLabel: options?.emptyActionLabel,
        actionName: options?.emptyActionName,
      });
    }

    // 4. Header Rows with WAI-ARIA aria-sort
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

    // 5. Data Rows
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

    // 6. Pagination Toolbar
    const pagination = this.getPagination();
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

  /**
   * Renders loading skeleton table placeholder markup with shimmer effect.
   */
  public renderTableSkeletonHtml(rowCount: number = 5): string {
    const cols = this.columns;
    const headerCols = cols
      .map(
        (col, i) =>
          `<th class="cs-th" scope="col"><div class="cs-skeleton-line cs-skeleton-header-cell" style="width: ${
            60 + (i % 3) * 15
          }%"></div></th>`
      )
      .join('');

    const bodyRows = Array.from({ length: Math.max(1, rowCount) }, (_, r) => {
      const cells = cols
        .map((_, c) => {
          const variance = ((r + c) % 4) * 10;
          const cellWidth = Math.min(95, Math.max(45, 75 - variance));
          return `<td class="cs-td"><div class="cs-skeleton-line cs-skeleton-cell" style="width: ${cellWidth}%"></div></td>`;
        })
        .join('');
      return `<tr class="cs-tr cs-skeleton-row">${cells}</tr>`;
    }).join('');

    return `
<div class="cs-skeleton-container" aria-busy="true" aria-label="Loading table data" role="status">
  <div class="cs-table-card cs-skeleton-card">
    <span class="cs-sr-only">Loading table data</span>
    <div class="cs-table-responsive">
      <table class="cs-table cs-skeleton-table" role="table">
        <thead class="cs-thead">
          <tr class="cs-tr">${headerCols}</tr>
        </thead>
        <tbody class="cs-tbody">
          ${bodyRows}
        </tbody>
      </table>
    </div>
  </div>
</div>`;
  }

  /**
   * Renders empty zero-data state markup with call-to-action button.
   */
  public renderEmptyStateHtml(options?: {
    title?: string | undefined;
    description?: string | undefined;
    actionLabel?: string | undefined;
    actionName?: string | undefined;
    isFilterReset?: boolean | undefined;
  }): string {
    const title = options?.title ?? 'No records found';
    const description =
      options?.description ??
      'There are no records matching your current filter criteria.';
    const isFilterReset = options?.isFilterReset ?? false;
    const actionLabel = options?.actionLabel;
    const actionName =
      options?.actionName ?? (isFilterReset ? 'clear-all-filters' : 'primary-action');

    const buttonClass = `cs-empty-cta-btn cs-btn-primary${
      isFilterReset ? ' cs-clear-all-filters-btn cs-empty-reset-btn' : ''
    }`;

    const actionHtml = actionLabel
      ? `<div class="cs-empty-actions">
    <button type="button" class="${buttonClass}" data-action="${actionName}">
      ${actionLabel}
    </button>
  </div>`
      : '';

    return `
<div class="cs-empty-state${isFilterReset ? ' cs-empty-filter-state' : ''}" role="status" aria-label="${title}">
  <div class="cs-empty-icon" aria-hidden="true">📁</div>
  <h3 class="cs-empty-title">${title}</h3>
  <p class="cs-empty-text">${description}</p>
  ${actionHtml}
</div>`;
  }

  /**
   * Renders sanitized error banner markup with retry button.
   */
  public renderErrorAlertHtml(
    error: unknown,
    options?: {
      title?: string | undefined;
      onRetryAction?: string | undefined;
      retryLabel?: string | undefined;
    }
  ): string {
    const title = options?.title ?? 'Failed to load data';
    const retryLabel = options?.retryLabel ?? 'Retry';
    const message = sanitizeErrorMessage(error);
    const retryBtn = options?.onRetryAction
      ? `<div class="cs-error-banner-actions">
    <button type="button" class="cs-error-retry-btn" data-action="${options.onRetryAction}" aria-label="${retryLabel} failed operation">
      ${retryLabel}
    </button>
  </div>`
      : '';

    return `
<div class="cs-error-banner" role="alert" aria-live="assertive">
  <div class="cs-error-banner-content">
    <span class="cs-error-icon" aria-hidden="true">⚠️</span>
    <div class="cs-error-text-block">
      <h4 class="cs-error-title">${title}</h4>
      <p class="cs-error-message">${message}</p>
    </div>
  </div>
  ${retryBtn}
</div>`;
  }

  /**
   * Renders 403 Forbidden access-denied view markup explaining missing role/capability.
   */
  public renderAccessDeniedHtml(options?: {
    requiredCapability?: string | undefined;
    requiredRole?: string | undefined;
    currentRole?: string | undefined;
    resourceName?: string | undefined;
    message?: string | undefined;
    backHref?: string | undefined;
  }): string {
    const requiredCapability = options?.requiredCapability ?? 'module.read';
    const currentRole = options?.currentRole ?? 'viewer';
    const resourceName = options?.resourceName ?? 'Marketing Lists and Campaign History';
    const backHref = options?.backHref ?? '/crm-4';
    const message =
      options?.message ??
      `You do not have the required permissions to view ${resourceName}. An authorized role with capability '${requiredCapability}' is required.`;

    const requiredRoleHtml = options?.requiredRole
      ? `
      <div class="cs-access-denied-meta-item">
        <span class="cs-meta-label">Required Role:</span>
        <code class="cs-meta-code">${options.requiredRole}</code>
      </div>`
      : '';

    return `
<div id="cs-access-denied-view" class="cs-access-denied-card" role="region" aria-labelledby="cs-access-denied-title">
  <div class="cs-access-denied-icon-wrapper" aria-hidden="true">
    <span class="cs-access-denied-icon">🔒</span>
  </div>
  <div class="cs-access-denied-content">
    <span class="cs-access-denied-badge">403 Forbidden</span>
    <h2 id="cs-access-denied-title" class="cs-access-denied-title">Access Denied</h2>
    <p class="cs-access-denied-desc">${message}</p>
    <div class="cs-access-denied-meta" role="note" aria-label="Permission details">
      <div class="cs-access-denied-meta-item">
        <span class="cs-meta-label">Required Capability:</span>
        <code class="cs-meta-code">${requiredCapability}</code>
      </div>${requiredRoleHtml}
      <div class="cs-access-denied-meta-item">
        <span class="cs-meta-label">Current Role:</span>
        <code class="cs-meta-code cs-current-role">${currentRole}</code>
      </div>
    </div>
    <div class="cs-access-denied-actions">
      <a href="${backHref}" class="cs-access-back-btn cs-btn-primary">Return to Directory</a>
    </div>
  </div>
</div>`;
  }

  private notifyQueryChange(): void {
    if (this.onQueryChange) {
      this.onQueryChange(this.toQueryParams());
    }
  }
}
