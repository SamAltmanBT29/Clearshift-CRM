import React from 'react';
import type { Quote, Deal } from '@clearshift/contracts';
import { Button, Badge, Pagination } from '@clearshift/ui';
import type { TableSortState } from '../table/types.js';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';

export interface QuotesListPageProps {
  data?: Quote[];
  deals?: Map<string, Deal>;
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | Error | { code?: string; message?: string; details?: unknown } | null;
  onRetry?: (() => void) | undefined;
  httpStatus?: number;
  isAccessDenied?: boolean;
  requiredCapability?: string;
  requiredRole?: string;
  currentRole?: string;
  emptyActionLabel?: string;
  onEmptyAction?: (() => void) | undefined;
  onSelectDeal?: (dealId: string) => void;
  onEditQuote?: (quote: Quote) => void;
  sort?: TableSortState | undefined;
  onSortChange?: ((columnKey: string) => void) | undefined;
  page?: number;
  totalPages?: number;
  totalCount?: number;
  onPageChange?: ((newPage: number) => void) | undefined;
}

export const QuotesListPage: React.FC<QuotesListPageProps> = ({
  data = [],
  deals = new Map(),
  isLoading = false,
  isEmpty = false,
  error = null,
  onRetry,
  httpStatus,
  isAccessDenied = false,
  requiredCapability = 'module.read',
  requiredRole,
  currentRole,
  emptyActionLabel = 'Create Quote',
  onEmptyAction,
  onSelectDeal,
  onEditQuote,
  sort,
  onSortChange,
  page = 1,
  totalPages = 1,
  totalCount = 0,
  onPageChange,
}) => {
  // 1. 403 Forbidden Access Denied State
  if (isAccessDenied || httpStatus === 403) {
    return (
      <AccessDeniedView
        requiredCapability={requiredCapability}
        requiredRole={requiredRole}
        currentRole={currentRole}
        resourceName="CRM-2 Quotes"
      />
    );
  }

  // 2. Error State
  if (error) {
    return (
      <div className="cs-error-container p-6">
        <ErrorAlert error={error} onRetry={onRetry} />
      </div>
    );
  }

  // 3. Loading State (Skeleton)
  if (isLoading) {
    return (
      <div className="p-6">
        <TableSkeleton
          rowCount={5}
          columnCount={6}
          ariaLabel="Loading quotes directory..."
        />
      </div>
    );
  }

  // 4. Empty State
  const isCurrentlyEmpty = isEmpty || data.length === 0;
  if (isCurrentlyEmpty) {
    return (
      <div className="p-6">
        <EmptyState
          title="No quotes found"
          description="No pricing quotes or commitments have been generated."
          actionLabel={emptyActionLabel}
          onAction={onEmptyAction}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Quotes &amp; Commitments</h2>
          <p className="text-sm text-slate-500 mt-1">
            Authoritative server-computed pricing calculations with precise decimal arithmetic.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto bg-white rounded-lg border border-slate-200 shadow-sm">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase text-slate-500 tracking-wider">
            <tr>
              <th
                className="px-6 py-3 cursor-pointer hover:bg-slate-100"
                onClick={() => onSortChange?.('number')}
              >
                Quote #{sort?.columnKey === 'number' ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
              <th className="px-6 py-3">Associated Deal</th>
              <th
                className="px-6 py-3 cursor-pointer hover:bg-slate-100"
                onClick={() => onSortChange?.('status')}
              >
                Status{sort?.columnKey === 'status' ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
              <th
                className="px-6 py-3 cursor-pointer hover:bg-slate-100 text-right"
                onClick={() => onSortChange?.('amount')}
              >
                Amount{sort?.columnKey === 'amount' ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
              <th className="px-6 py-3">Currency</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {data.map((quote) => {
              const deal = deals.get(quote.deal_id);
              const quoteAny = quote as any;
              const status = quoteAny.status || 'active';
              return (
                <tr key={quote.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-mono font-medium text-slate-900">
                    {quote.quote_number || quote.id.slice(0, 8)}
                  </td>
                  <td className="px-6 py-4">
                    {deal ? (
                      onSelectDeal ? (
                        <button
                          type="button"
                          className="text-primary-600 hover:text-primary-800 font-medium underline"
                          onClick={() => onSelectDeal(deal.id)}
                        >
                          {deal.name}
                        </button>
                      ) : (
                        <span>{deal.name}</span>
                      )
                    ) : (
                      <span className="text-slate-400 font-mono text-xs">{quote.deal_id.slice(0, 8)}</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={status === 'accepted' ? 'success' : status === 'rejected' ? 'danger' : 'neutral'}>
                      {status}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-right font-mono font-semibold text-slate-900">
                    {parseFloat(quote.amount || '0').toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="px-6 py-4 font-mono text-xs">{quote.currency}</td>
                  <td className="px-6 py-4 text-right">
                    {onEditQuote && (
                      <Button variant="outline" size="sm" onClick={() => onEditQuote(quote)}>
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-200 flex justify-end">
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalCount={totalCount}
              pageSize={10}
              onPageChange={onPageChange ?? (() => {})}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default QuotesListPage;
