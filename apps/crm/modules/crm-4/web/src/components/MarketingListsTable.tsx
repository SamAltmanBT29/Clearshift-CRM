import React from 'react';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  Button,
} from '@cs/ui';
import type { CRM4List } from '@clearshift/contracts';
import type { TableSortState, TablePaginationState } from '../../table/types.js';
import { TableSkeleton } from './TableSkeleton.js';
import { EmptyState } from './EmptyState.js';
import { ErrorAlert } from './ErrorAlert.js';
import { AccessDeniedView } from './AccessDeniedView.js';

export interface MarketingListsTableProps {
  lists: CRM4List[];
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
  onAccessBack?: (() => void) | undefined;
  onSelectList?: ((list: CRM4List) => void) | undefined;
  onViewCampaigns?: ((list: CRM4List) => void) | undefined;
  sort?: TableSortState | undefined;
  onSortChange?: ((columnKey: string) => void) | undefined;
  pagination?: TablePaginationState | undefined;
  onPageChange?: ((newPage: number) => void) | undefined;
  onPageSizeChange?: ((newPageSize: number) => void) | undefined;
}

export function formatDateValue(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function MarketingListsTable({
  lists,
  loading = false,
  loadingRowCount = 5,
  error = null,
  onRetry,
  emptyTitle = 'No marketing lists found',
  emptyDescription = 'No marketing lists or segmentation criteria have been created yet.',
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
  onAccessBack,
  onSelectList,
  onViewCampaigns,
  sort,
  onSortChange,
  pagination,
  onPageChange,
  onPageSizeChange,
}: MarketingListsTableProps) {
  // 403 Access Denied State
  if (isAccessDenied || httpStatus === 403) {
    return (
      <AccessDeniedView
        requiredCapability={requiredCapability}
        requiredRole={requiredRole}
        currentRole={currentRole}
        resourceName="Marketing Lists and Campaign History"
        onBack={onAccessBack}
      />
    );
  }

  // Error State
  if (error) {
    return (
      <div className="cs-table-card cs-table-error-wrapper" role="region" aria-label="Table Error">
        <ErrorAlert error={error} onRetry={onRetry} />
      </div>
    );
  }

  // Loading State
  if (loading) {
    return (
      <div
        className="cs-table-card cs-skeleton-card"
        role="status"
        aria-label="Loading marketing lists"
        aria-busy="true"
      >
        <TableSkeleton
          rowCount={loadingRowCount}
          columnCount={5}
          ariaLabel="Loading marketing lists"
        />
      </div>
    );
  }

  // Empty State
  if (lists.length === 0) {
    if (emptyActionLabel && onEmptyAction) {
      return (
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          actionLabel={emptyActionLabel}
          onAction={onEmptyAction}
          secondaryActionLabel={secondaryActionLabel}
          onSecondaryAction={onSecondaryAction}
          className={hasActiveFilters ? 'cs-empty-filter-state' : ''}
        />
      );
    }
    return (
      <div className="p-12 text-center" role="status">
        <h3 className="text-base font-semibold text-slate-900">{emptyTitle}</h3>
        <p className="text-sm text-slate-500 mt-1">{emptyDescription}</p>
      </div>
    );
  }

  // Sort helper
  const renderSortableHeader = (columnKey: string, label: string) => {
    if (!onSortChange) {
      return label;
    }

    const isSorted = sort?.columnKey === columnKey;
    const direction = isSorted ? sort.direction : undefined;

    return (
      <button
        type="button"
        onClick={() => onSortChange(columnKey)}
        className={`inline-flex items-center gap-1 font-semibold hover:text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded px-1 -mx-1 ${
          isSorted ? 'text-indigo-600' : 'text-slate-900'
        }`}
        aria-label={`Sort by ${label}${
          isSorted
            ? direction === 'asc'
              ? ', currently ascending'
              : ', currently descending'
            : ''
        }`}
      >
        <span>{label}</span>
        <span className="text-xs" aria-hidden="true">
          {isSorted ? (direction === 'asc' ? ' ▲' : ' ▼') : ' ↕'}
        </span>
      </button>
    );
  };

  const getAriaSort = (columnKey: string): 'ascending' | 'descending' | 'none' | undefined => {
    if (!onSortChange) return undefined;
    if (sort?.columnKey === columnKey) {
      return sort.direction === 'asc' ? 'ascending' : 'descending';
    }
    return 'none';
  };

  // Pagination calculation
  const page = pagination?.page ?? 1;
  const pageSize = pagination?.pageSize ?? 25;
  const total = pagination?.total ?? lists.length;
  const totalPages = pagination?.totalPages ?? Math.max(1, Math.ceil(total / pageSize));
  const startItem = total > 0 ? (page - 1) * pageSize + 1 : 0;
  const endItem = total > 0 ? Math.min(page * pageSize, total) : 0;

  const tableContent = (
    <Table aria-label="CRM Marketing Lists Table">
      <TableHeader>
        <TableRow>
          <TableHead className="w-1/3" aria-sort={getAriaSort('name')}>
            {renderSortableHeader('name', 'List Name')}
          </TableHead>
          <TableHead className="w-1/3">
            Description
          </TableHead>
          <TableHead className="w-28 text-center" aria-sort={getAriaSort('campaignCount')}>
            {renderSortableHeader('campaignCount', 'Campaigns')}
          </TableHead>
          <TableHead className="w-36" aria-sort={getAriaSort('createdAt')}>
            {renderSortableHeader('createdAt', 'Created Date')}
          </TableHead>
          <TableHead className="w-28 text-right">
            Actions
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lists.map((list) => (
          <TableRow key={list.id} className="hover:bg-slate-50 transition-colors">
            <TableCell className="font-medium text-slate-900">
              {onSelectList ? (
                <button
                  type="button"
                  onClick={() => onSelectList(list)}
                  className="text-left font-semibold text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded px-1 -mx-1"
                  aria-label={`View details for list ${list.name}`}
                >
                  {list.name}
                </button>
              ) : (
                <span>{list.name}</span>
              )}
            </TableCell>
            <TableCell className="text-slate-600 text-sm">
              {list.description ? (
                <span>{list.description}</span>
              ) : (
                <span className="text-slate-400 italic">No description provided</span>
              )}
            </TableCell>
            <TableCell className="text-center">
              <Badge variant={list.campaignCount > 0 ? 'stage' : 'neutral'}>
                {list.campaignCount} {list.campaignCount === 1 ? 'campaign' : 'campaigns'}
              </Badge>
            </TableCell>
            <TableCell className="text-slate-500 text-sm whitespace-nowrap">
              {formatDateValue(list.createdAt)}
            </TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-2">
                {onViewCampaigns && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onViewCampaigns(list)}
                    aria-label={`View campaigns for list ${list.name}`}
                    className="text-xs"
                  >
                    Campaigns
                  </Button>
                )}
                {onSelectList && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onSelectList(list)}
                    aria-label={`Edit or view list ${list.name}`}
                    className="text-xs"
                  >
                    View
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  if (!pagination) {
    return tableContent;
  }

  return (
    <div className="space-y-4">
      {tableContent}

      {/* Pagination Controls */}
      <div
        className="flex flex-col sm:flex-row items-center justify-between gap-4 py-3 px-2 border-t border-slate-200"
        role="navigation"
        aria-label="Marketing lists pagination"
      >
        <div className="text-sm text-slate-600" aria-live="polite">
          Showing <span className="font-semibold text-slate-900">{startItem}</span> to{' '}
          <span className="font-semibold text-slate-900">{endItem}</span> of{' '}
          <span className="font-semibold text-slate-900">{total}</span> lists
        </div>

        <div className="flex items-center gap-4">
          {onPageSizeChange && (
            <div className="flex items-center gap-2">
              <label htmlFor="crm4-lists-page-size" className="text-sm text-slate-600">
                Rows:
              </label>
              <select
                id="crm4-lists-page-size"
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
    </div>
  );
}

export default MarketingListsTable;
