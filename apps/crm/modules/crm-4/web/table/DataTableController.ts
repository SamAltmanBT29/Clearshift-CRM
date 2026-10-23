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

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

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

  private notifyQueryChange(): void {
    if (this.onQueryChange) {
      this.onQueryChange(this.toQueryParams());
    }
  }
}
