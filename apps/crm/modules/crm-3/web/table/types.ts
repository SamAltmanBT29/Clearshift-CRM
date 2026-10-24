export type SortDirection = 'asc' | 'desc';

export interface TableSortState {
  columnKey: string;
  direction: SortDirection;
}

export interface TablePaginationState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface DataTableColumn<T = Record<string, unknown>> {
  key: string;
  header: string;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: string;
  format?: (value: unknown, row: T) => string;
}

export interface TableFilterState {
  search?: string | undefined;
  status?: string | undefined;
  priority?: string | undefined;
  contactId?: string | undefined;
  [key: string]: string | undefined;
}

export interface ActiveFilterPill {
  key: string;
  label: string;
  value: string;
  displayValue: string;
}

export interface FilterFacetOption {
  value: string;
  label: string;
  count?: number;
}

export interface FilterFacet {
  id: string;
  label: string;
  paramKey: string;
  options: FilterFacetOption[];
}

export interface TableState<T = Record<string, unknown>> {
  columns: DataTableColumn<T>[];
  data: T[];
  loading: boolean;
  error?: string | undefined;
  sort?: TableSortState | undefined;
  pagination: TablePaginationState;
  filters: TableFilterState;
}
