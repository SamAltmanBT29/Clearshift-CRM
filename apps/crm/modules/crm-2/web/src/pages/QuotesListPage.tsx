import React, { useEffect, useState } from 'react';
import { crm2Api } from '../api/crm-2.js';
import type { Quote, Deal } from '@clearshift/contracts';
import { Button, Spinner, Alert, Card, Badge, Pagination } from '@clearshift/ui';
import type { TableSortState } from '../table/types.js';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';

export interface QuotesListPageProps {
  data?: Quote[];
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
  initialSort?: TableSortState;
  initialPage?: number;
}

export const QuotesListPage: React.FC<QuotesListPageProps> = ({
  data: dataProp,
  isLoading: isLoadingProp,
  isEmpty: isEmptyProp,
  error: errorProp,
  onRetry: onRetryProp,
  httpStatus,
  isAccessDenied: isAccessDeniedProp,
  requiredCapability = 'module.read',
  requiredRole,
  currentRole,
  emptyActionLabel = 'Create Quote',
  onEmptyAction,
  onSelectDeal,
  onEditQuote,
  initialSort,
  initialPage = 1,
}) => {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [deals, setDeals] = useState<Map<string, Deal>>(new Map());
  const [page, setPage] = useState(initialPage);
  const [sort, setSort] = useState<TableSortState | undefined>(initialSort);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function loadQuotes() {
      try {
        setLoading(true);
        setError(null);
        const [quotesRes, dealsRes] = await Promise.all([
          crm2Api.getQuotes({
            page,
            pageSize: 10,
            sort: sort?.columnKey,
            order: sort?.direction,
          }),
          crm2Api.getDeals({ page: 1, pageSize: 100 }),
        ]);

        if (mounted) {
          setQuotes(quotesRes.items || []);
          setTotalPages(quotesRes.pagination?.totalPages || 1);
          setTotalCount(quotesRes.pagination?.totalCount || 0);

          const dealMap = new Map<string, Deal>();
          for (const d of dealsRes.items || []) {
            dealMap.set(d.id, d);
          }
          setDeals(dealMap);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || 'Failed to load quotes');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadQuotes();
    return () => {
      mounted = false;
    };
  }, [page, sort]);

  const handleSortChange = (columnKey: string) => {
    setSort((prev) => {
      if (prev?.columnKey === columnKey) {
        return { columnKey, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { columnKey, direction: 'asc' };
    });
    setPage(1);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-4">
        <Spinner size="lg" />
        <p className="text-slate-600 text-sm font-medium">Loading commercial quotes...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert variant="error" title="Quotes Error">
          {error}
        </Alert>
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <div className="p-12 text-center text-slate-500 bg-white rounded-lg border border-slate-200">
        <p className="text-base font-semibold text-slate-800">No records found</p>
        <p className="text-sm text-slate-500 mt-1">Commercial quotes directory is empty.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Commercial Quotes Directory</h2>
          <p className="text-sm text-slate-500 mt-1">
            Authoritative registry of commercial quotes linked to CRM-2 sales opportunities.
          </p>
        </div>
        <div className="text-sm font-medium text-slate-600">
          Total Quotes: <span className="font-bold text-slate-900">{totalCount}</span>
        </div>
      </div>

      {/* Quotes Table */}
      <Card className="p-0 overflow-hidden border-slate-200">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200 uppercase tracking-wider">
              <tr>
                <th
                  className="py-3 px-4"
                  aria-sort={
                    sort?.columnKey === 'quote_number'
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  <button
                    type="button"
                    className="flex items-center gap-1 font-semibold uppercase hover:text-slate-900"
                    onClick={() => handleSortChange('quote_number')}
                    aria-label="Sort by Quote Number"
                  >
                    <span>Quote Number</span>
                    <span aria-hidden="true">
                      {sort?.columnKey === 'quote_number'
                        ? sort.direction === 'asc'
                          ? '▲'
                          : '▼'
                        : '↕'}
                    </span>
                  </button>
                </th>
                <th className="py-3 px-4">Parent Deal</th>
                <th
                  className="py-3 px-4"
                  aria-sort={
                    sort?.columnKey === 'quote_date'
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  <button
                    type="button"
                    className="flex items-center gap-1 font-semibold uppercase hover:text-slate-900"
                    onClick={() => handleSortChange('quote_date')}
                    aria-label="Sort by Issue Date"
                  >
                    <span>Issue Date</span>
                    <span aria-hidden="true">
                      {sort?.columnKey === 'quote_date'
                        ? sort.direction === 'asc'
                          ? '▲'
                          : '▼'
                        : '↕'}
                    </span>
                  </button>
                </th>
                <th
                  className="py-3 px-4 text-right"
                  aria-sort={
                    sort?.columnKey === 'amount'
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  <button
                    type="button"
                    className="flex items-center gap-1 font-semibold uppercase hover:text-slate-900 ml-auto"
                    onClick={() => handleSortChange('amount')}
                    aria-label="Sort by Amount"
                  >
                    <span>Amount</span>
                    <span aria-hidden="true">
                      {sort?.columnKey === 'amount'
                        ? sort.direction === 'asc'
                          ? '▲'
                          : '▼'
                        : '↕'}
                    </span>
                  </button>
                </th>
                <th className="py-3 px-4">Note / Scope</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {quotes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    No commercial quotes found.
                  </td>
                </tr>
              ) : (
                quotes.map((quote) => {
                  const deal = deals.get(quote.deal_id);
                  return (
                    <tr key={quote.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-semibold text-indigo-700">
                        {quote.quote_number}
                      </td>
                      <td className="py-3 px-4">
                        {deal ? (
                          <button
                            type="button"
                            onClick={() => onSelectDeal?.(deal.id)}
                            className="font-medium text-slate-900 hover:text-indigo-600 hover:underline text-left"
                          >
                            {deal.name}
                          </button>
                        ) : (
                          <span className="text-xs font-mono text-slate-400">{quote.deal_id}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-mono text-xs">
                        {quote.date}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-slate-900">
                        {parseFloat(quote.amount).toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        <Badge variant="neutral" className="text-xs ml-1">
                          {quote.currency}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-slate-500 max-w-xs truncate text-xs">
                        {quote.note || '—'}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {onEditQuote && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => onEditQuote(quote)}
                          >
                            Edit
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-200 flex justify-end">
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalCount={totalCount}
              pageSize={10}
              onPageChange={(newPage) => setPage(newPage)}
            />
          </div>
        )}
      </Card>
    </div>
  );
};
export default QuotesListPage;
