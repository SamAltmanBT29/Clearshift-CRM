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
  leadStatus?: string | undefined;
  consentStatus?: string | undefined;
  unsubscribed?: string | undefined;
  companyId?: string | undefined;
  status?: string | undefined;
  entity?: string | undefined;
  sourceSystem?: string | undefined;
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
  pagination: TablePaginationState;
  sort?: TableSortState | undefined;
  filters?: TableFilterState | undefined;
}
