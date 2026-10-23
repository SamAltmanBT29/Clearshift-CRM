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
} from '@clearshift/ui';
import type { Deal } from '@clearshift/contracts';
import type { TableSortState } from '../table/types.js';
import { TableSkeleton } from './TableSkeleton.js';
import { EmptyState } from './EmptyState.js';
import { ErrorAlert } from './ErrorAlert.js';
import { AccessDeniedView } from './AccessDeniedView.js';

export interface DealsTableProps {
  deals: Deal[];
  loading?: boolean | undefined;
  loadingRowCount?: number | undefined;
  error?: string | Error | { code?: string | undefined; message?: string | undefined; details?: unknown } | null | undefined;
  onRetry?: (() => void) | undefined;
  isAccessDenied?: boolean | undefined;
  httpStatus?: number | undefined;
  requiredCapability?: string | undefined;
  requiredRole?: string | undefined;
  currentRole?: string | undefined;
  resourceName?: string | undefined;
  onAccessBack?: (() => void) | undefined;
  emptyTitle?: string | undefined;
  emptyDescription?: string | undefined;
  emptyActionLabel?: string | undefined;
  onEmptyAction?: (() => void) | undefined;
  hasActiveFilters?: boolean | undefined;
  onClearFilters?: (() => void) | undefined;
  onSelectDeal?: ((deal: Deal) => void) | undefined;
  onViewQuotes?: ((deal: Deal) => void) | undefined;
  sort?: TableSortState | undefined;
  onSortChange?: ((columnKey: string) => void) | undefined;
  className?: string | undefined;
}

/**
 * Format currency and decimal values safely
 */
export function formatCurrencyValue(value: string, currency: string): string {
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) {
    return `${currency} ${value}`;
  }

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${currency} ${num.toFixed(2)}`;
  }
}

/**
 * Stage pill styling helper
 */
function getStageBadgeVariant(stageName: string): 'stage' | 'success' | 'danger' | 'info' {
  switch (stageName) {
    case 'Won':
      return 'success';
    case 'Lost':
      return 'danger';
    case 'Qualified':
    case 'Proposal':
    case 'Negotiation':
      return 'stage';
    default:
      return 'info';
  }
}

export function DealsTable({
  deals,
  loading = false,
  loadingRowCount = 5,
  error = null,
  onRetry,
  isAccessDenied = false,
  httpStatus,
  requiredCapability = 'module.read',
  requiredRole,
  currentRole,
  resourceName = 'Deals & Pipeline',
  onAccessBack,
  emptyTitle = 'No deals found',
  emptyDescription = 'No sales opportunities are currently recorded in the system.',
  emptyActionLabel,
  onEmptyAction,
  hasActiveFilters = false,
  onClearFilters,
  onSelectDeal,
  onViewQuotes,
  sort,
  onSortChange,
  className = '',
}: DealsTableProps) {
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

  if (error) {
    return (
      <div className="cs-table-card cs-table-error-wrapper" role="region" aria-label="Table Error">
        <ErrorAlert error={error} onRetry={onRetry} />
      </div>
    );
  }

  if (loading) {
    return (
      <TableSkeleton
        rowCount={loadingRowCount}
        columnCount={7}
        ariaLabel="Loading opportunity records..."
      />
    );
  }

  if (deals.length === 0) {
    if (hasActiveFilters) {
      return (
        <div className="cs-table-card" role="status">
          <EmptyState
            className="cs-empty-filter-state"
            icon="🔍"
            title={emptyTitle === 'No deals found' ? 'No matching records found' : emptyTitle}
            description={
              emptyDescription === 'No sales opportunities are currently recorded in the system.'
                ? 'No deals matched your search and filter criteria. Try adjusting your search term or clearing filters.'
                : emptyDescription
            }
            actionLabel="Reset All Filters"
            onAction={onClearFilters}
          />
        </div>
      );
    }

    return (
      <div className="cs-table-card" role="status">
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          actionLabel={emptyActionLabel}
          onAction={onEmptyAction}
        />
      </div>
    );
  }

  const renderSortableHead = (columnKey: string, label: string, className: string) => {
    const isSorted = sort?.columnKey === columnKey;
    const ariaSort = isSorted
      ? sort.direction === 'asc'
        ? 'ascending'
        : 'descending'
      : onSortChange
      ? 'none'
      : undefined;

    return (
      <TableHead className={className} aria-sort={ariaSort}>
        {onSortChange ? (
          <button
            type="button"
            className="cs-th-sort-btn flex items-center gap-1 font-semibold text-slate-600 hover:text-slate-900 focus:outline-none focus:underline"
            onClick={() => onSortChange(columnKey)}
            aria-label={`Sort by ${label}, currently ${
              isSorted
                ? sort.direction === 'asc'
                  ? 'ascending'
                  : 'descending'
                : 'unsorted'
            }`}
          >
            <span>{label}</span>
            <span className="text-xs" aria-hidden="true">
              {isSorted ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
            </span>
          </button>
        ) : (
          <span>{label}</span>
        )}
      </TableHead>
    );
  };

  return (
    <Table aria-label="CRM Deals List">
      <TableHeader>
        <TableRow>
          {renderSortableHead('name', 'Deal Name', 'w-1/4')}
          {renderSortableHead('contact_name', 'Contact / Orphan Status', 'w-1/5')}
          {renderSortableHead('value', 'Value', 'w-1/6')}
          {renderSortableHead('stage_name', 'Pipeline Stage', 'w-1/6')}
          {renderSortableHead('close_date', 'Close Date', 'w-1/6')}
          <TableHead className="w-24 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {deals.map((deal) => {
          const isOrphan = deal.is_orphan || deal.contact_id === null;

          return (
            <TableRow key={deal.id} data-testid={`deal-row-${deal.id}`}>
              {/* Deal Name */}
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-semibold text-slate-900 line-clamp-1" title={deal.name}>
                    {deal.name}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    ID: {deal.id.slice(0, 8)}...
                  </span>
                </div>
              </TableCell>

              {/* Contact / Orphan Status - SDS Requirement: UI visibly warns on an orphan deal */}
              <TableCell>
                {isOrphan ? (
                  <div className="flex items-center gap-1.5" data-testid="orphan-warning">
                    <Badge
                      variant="warning"
                      size="sm"
                      className="border-amber-400 text-amber-950 font-semibold"
                      aria-label="Orphan Deal: No contact linked"
                    >
                      <span aria-hidden="true">⚠️</span> Orphan Deal
                    </Badge>
                  </div>
                ) : (
                  <div className="flex flex-col">
                    <span className="text-sm text-slate-800 font-medium">
                      {deal.contact_name || 'Linked Contact'}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      {deal.contact_id ? deal.contact_id.slice(0, 8) + '...' : ''}
                    </span>
                  </div>
                )}
              </TableCell>

              {/* Value & Currency */}
              <TableCell>
                <span className="font-medium text-slate-900 tabular-nums">
                  {formatCurrencyValue(deal.value, deal.currency)}
                </span>
                <span className="text-xs text-slate-500 ml-1 font-mono">{deal.currency}</span>
              </TableCell>

              {/* Pipeline Stage */}
              <TableCell>
                <Badge variant={getStageBadgeVariant(deal.stage_name)} size="sm">
                  {deal.stage_name}
                </Badge>
              </TableCell>

              {/* Close Date */}
              <TableCell>
                <span className="text-sm text-slate-700 whitespace-nowrap">
                  {deal.close_date}
                </span>
              </TableCell>

              {/* Actions */}
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onSelectDeal?.(deal)}
                    aria-label={`View deal details for ${deal.name}`}
                  >
                    View
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onViewQuotes?.(deal)}
                    aria-label={`View quotes for ${deal.name}`}
                  >
                    Quotes
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
