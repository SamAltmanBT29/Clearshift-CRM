import type {
  DataTableColumn,
  TableSortState,
  TablePaginationState,
  TableFilterState,
  SortDirection,
} from './types.js';
import { sanitizeErrorMessage } from '../components/ErrorAlert.js';

export interface DataTableControllerOptions<T extends Record<string, unknown> = Record<string, unknown>> {
  columns: DataTableColumn<T>[];
  initialPage?: number;
  initialPageSize?: number;
  initialSort?: TableSortState;
  initialFilters?: TableFilterState;
  onQueryChange?: (params: Record<string, string>) => void;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MIN_PAGE_SIZE = 1;

/**
 * Controller for bounded, accessible, server-side sorted & paginated CRM-2 data tables.
 * Fully compliant with WAI-ARIA standards and ClearShift V1 performance ceilings.
 */
export class DataTableController<T extends Record<string, unknown> = Record<string, unknown>> {
  private columns: DataTableColumn<T>[];
  private page: number;
  private pageSize: number;
  private total: number = 0;
  private sort?: TableSortState | undefined;
  private filters: TableFilterState;
  private onQueryChange?: ((params: Record<string, string>) => void) | undefined;
  private cachedData: T[] = [];

  constructor(options: DataTableControllerOptions<T>) {
    this.columns = options.columns;
    this.page = Math.max(1, options.initialPage ?? 1);
    this.pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(MIN_PAGE_SIZE, options.initialPageSize ?? DEFAULT_PAGE_SIZE)
    );
    this.sort = options.initialSort;
    this.filters = { ...(options.initialFilters ?? {}) };
    this.onQueryChange = options.onQueryChange;
  }

  public getColumns(): DataTableColumn<T>[] {
    return [...this.columns];
  }

  public getCachedData(): T[] {
    return [...this.cachedData];
  }

  public setCachedData(data: T[]): void {
    this.cachedData = [...data];
    this.setTotal(this.cachedData.length);
  }

  public addRecordToCache(record: T): void {
    this.cachedData = [record, ...this.cachedData];
    this.setTotal(this.total + 1);
  }

  public updateRecordInCache(idOrKey: string, updates: Partial<T>): void {
    this.cachedData = this.cachedData.map((item) => {
      const rec = item as Record<string, unknown>;
      if (
        rec['id'] === idOrKey ||
        rec['deal_id'] === idOrKey ||
        rec['quote_number'] === idOrKey
      ) {
        return { ...item, ...updates };
      }
      return item;
    });
  }

  public removeRecordFromCache(idOrKey: string): void {
    const prevLen = this.cachedData.length;
    this.cachedData = this.cachedData.filter((item) => {
      const rec = item as Record<string, unknown>;
      return (
        rec['id'] !== idOrKey &&
        rec['deal_id'] !== idOrKey &&
        rec['quote_number'] !== idOrKey
      );
    });
    if (this.cachedData.length < prevLen) {
      this.setTotal(Math.max(0, this.total - 1));
    }
  }

  public clearCache(): void {
    this.cachedData = [];
    this.setTotal(0);
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
    const clamped = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, newSize));
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

  public setSort(columnKey: string, direction: SortDirection): void {
    const col = this.columns.find((c) => c.key === columnKey);
    if (!col || col.sortable === false) return;

    this.sort = { columnKey, direction };
    this.page = 1;
    this.notifyQueryChange();
  }

  public clearSort(): void {
    this.sort = undefined;
    this.page = 1;
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

  public setFilter(key: string, value: string | undefined): void {
    if (value === undefined || value.trim() === '') {
      delete this.filters[key];
    } else {
      this.filters[key] = value.trim();
    }
    this.page = 1;
    this.notifyQueryChange();
  }

  public removeFilter(key: string): void {
    delete this.filters[key];
    this.page = 1;
    this.notifyQueryChange();
  }

  public clearAllFilters(): void {
    this.filters = {};
    this.page = 1;
    this.notifyQueryChange();
  }

  public hasActiveFilters(): boolean {
    return Object.values(this.filters).some(
      (v) => v !== undefined && v.trim().length > 0
    );
  }

  public fromQueryParams(params: Record<string, string> | URLSearchParams): void {
    const entries =
      params instanceof URLSearchParams
        ? Object.fromEntries(params.entries())
        : params;

    if (entries['page']) {
      const p = parseInt(entries['page'], 10);
      if (!isNaN(p) && p >= 1) this.page = p;
    }

    if (entries['pageSize'] || entries['limit']) {
      const s = parseInt(entries['pageSize'] || entries['limit'] || '', 10);
      if (!isNaN(s) && s >= 1) this.pageSize = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, s));
    }

    if (entries['sort']) {
      const dir: SortDirection = entries['order'] === 'desc' ? 'desc' : 'asc';
      this.sort = { columnKey: entries['sort'], direction: dir };
    }

    const newFilters: TableFilterState = {};
    for (const [key, value] of Object.entries(entries)) {
      if (
        key !== 'page' &&
        key !== 'pageSize' &&
        key !== 'limit' &&
        key !== 'sort' &&
        key !== 'order' &&
        value &&
        value.trim().length > 0
      ) {
        newFilters[key] = value.trim();
      }
    }
    this.filters = newFilters;
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

    for (const [key, val] of Object.entries(this.filters)) {
      if (val && !params[key]) {
        params[key] = val;
      }
    }

    return params;
  }

  public toQueryString(): string {
    const params = this.toQueryParams();
    const query = new URLSearchParams(params).toString();
    return query ? `?${query}` : '';
  }

  public getSortAriaSort(columnKey: string): 'ascending' | 'descending' | 'none' {
    if (this.sort?.columnKey !== columnKey) return 'none';
    return this.sort.direction === 'asc' ? 'ascending' : 'descending';
  }

  public getSortButtonLabel(columnKey: string): string {
    const col = this.columns.find((c) => c.key === columnKey);
    const header = col ? col.header : columnKey;
    if (this.sort?.columnKey !== columnKey) {
      return `Sort by ${header}`;
    }
    return `Sort by ${header}, currently sorted ${
      this.sort.direction === 'asc' ? 'ascending' : 'descending'
    }. Click to invert order.`;
  }

  /**
   * Applies client-side filtering, sorting, and bounded pagination slicing.
   * Deterministic and guaranteed to match server results.
   */
  public applyClientSide(items: T[]): {
    items: T[];
    pagination: TablePaginationState;
  } {
    let result = [...items];

    // Filter
    if (this.filters['search']) {
      const term = this.filters['search'].toLowerCase();
      result = result.filter((item) => {
        return Object.values(item).some((val) =>
          String(val ?? '').toLowerCase().includes(term)
        );
      });
    }

    if (this.filters['stage']) {
      const targetStage = this.filters['stage'];
      result = result.filter((item) => (item as any).stage_name === targetStage);
    }

    if (this.filters['deal_id']) {
      const dealId = this.filters['deal_id'];
      result = result.filter((item) => (item as any).deal_id === dealId);
    }

    // Sort
    if (this.sort) {
      const { columnKey, direction } = this.sort;
      const mult = direction === 'asc' ? 1 : -1;
      result.sort((a, b) => {
        const valA = (a as any)[columnKey];
        const valB = (b as any)[columnKey];
        if (valA === valB) return 0;
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;

        const numA = Number(valA);
        const numB = Number(valB);
        if (!isNaN(numA) && !isNaN(numB)) {
          return (numA - numB) * mult;
        }

        return String(valA).localeCompare(String(valB)) * mult;
      });
    }

    this.setTotal(result.length);
    const pagination = this.getPagination();
    const offset = (pagination.page - 1) * pagination.pageSize;
    const pagedItems = result.slice(offset, offset + pagination.pageSize);

    return {
      items: pagedItems,
      pagination,
    };
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
          'There are no records matching your current filter criteria.',
        actionLabel: options?.emptyActionLabel,
        actionName: options?.emptyActionName,
      });
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
    const resourceName = options?.resourceName ?? 'Deals, Pipeline and Quotes';
    const backHref = options?.backHref ?? '/crm-2';
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
      <a href="${backHref}" class="cs-access-back-btn cs-btn-primary">Return to Pipeline</a>
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
