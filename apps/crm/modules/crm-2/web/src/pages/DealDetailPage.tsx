import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Button,
  Badge,
  Alert,
  Spinner,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@clearshift/ui';
import {
  type Deal,
  type Quote,
} from '@clearshift/contracts';
import { getDealById, getQuotes, Crm2ApiError } from '../api/crm-2.js';
import { formatCurrencyValue } from '../components/DealsTable.js';

export interface DealDetailPageProps {
  dealId: string;
  initialDeal?: Deal | null | undefined;
  onBackToList: () => void;
  onEditDeal: (deal: Deal) => void;
  onAddQuote: (deal: Deal) => void;
  onEditQuote: (quote: Quote, deal: Deal) => void;
}

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

export function DealDetailPage({
  dealId,
  initialDeal,
  onBackToList,
  onEditDeal,
  onAddQuote,
  onEditQuote,
}: DealDetailPageProps) {
  const [deal, setDeal] = useState<Deal | null>(initialDeal ?? null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [isLoading, setIsLoading] = useState(!initialDeal);
  const [isLoadingQuotes, setIsLoadingQuotes] = useState(true);
  const [error, setError] = useState<Crm2ApiError | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const dealData = await getDealById(dealId);
      setDeal(dealData);
    } catch (err: any) {
      if (err instanceof Crm2ApiError) {
        setError(err);
      } else {
        setError(new Crm2ApiError(500, 'UNEXPECTED_ERROR', err.message || 'Failed to load deal details.'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [dealId]);

  const loadQuotes = useCallback(async () => {
    setIsLoadingQuotes(true);
    try {
      const res = await getQuotes({ deal_id: dealId, page: 1, pageSize: 100 });
      setQuotes(res.items);
    } catch (err) {
      console.warn('Failed to load quotes for deal:', err);
    } finally {
      setIsLoadingQuotes(false);
    }
  }, [dealId]);

  useEffect(() => {
    loadData();
    loadQuotes();
  }, [loadData, loadQuotes]);

  // Server-computed total quote amount
  const totalQuoteAmount = quotes.reduce((acc, q) => {
    const num = Number.parseFloat(q.amount);
    return acc + (Number.isNaN(num) ? 0 : num);
  }, 0);

  if (isLoading) {
    return (
      <div className="py-24 max-w-7xl mx-auto px-4" data-testid="detail-loading-state">
        <Spinner label="Loading deal details..." />
      </div>
    );
  }

  if (error || !deal) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12" data-testid="detail-error-state">
        <Alert
          variant="error"
          title="Deal Not Found"
          action={
            <Button variant="outline" size="sm" onClick={onBackToList}>
              Back to Deals
            </Button>
          }
        >
          <p className="text-sm font-medium">
            {error?.message || `Deal with ID '${dealId}' could not be located.`}
          </p>
        </Alert>
      </div>
    );
  }

  const isOrphan = deal.is_orphan || deal.contact_id === null;

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 animate-in fade-in duration-150">
      {/* Top Header & Breadcrumb Context Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBackToList}
            aria-label="Back to Deals List"
            className="text-slate-600 hover:text-slate-900"
          >
            ← Back to Deals
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                {deal.name}
              </h1>
              <Badge variant={getStageBadgeVariant(deal.stage_name)} size="md">
                {deal.stage_name}
              </Badge>
              {isOrphan && (
                <Badge variant="warning" size="md" className="border-amber-400 font-semibold">
                  ⚠️ Orphan Deal
                </Badge>
              )}
            </div>
            <p className="text-xs text-slate-400 font-mono mt-1">
              UUID: {deal.id}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              loadData();
              loadQuotes();
            }}
            aria-label="Refresh deal details"
          >
            Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onEditDeal(deal)}
            aria-label={`Edit deal ${deal.name}`}
          >
            Edit Deal
          </Button>
        </div>
      </div>

      {/* Prominent Orphan Deal Warning (SDS FR-CRM2-05) */}
      {isOrphan && (
        <Alert
          variant="warning"
          title="Orphan Deal: No Customer Contact Linked"
        >
          <p className="text-sm">
            This sales opportunity is not linked to any contact record in CRM-1. Per domain rules, orphan deals remain visible in the pipeline but must be linked before closing.
          </p>
        </Alert>
      )}

      {/* Overview Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Financial & Pipeline Summary */}
        <Card className="p-6 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Opportunity Value &amp; Stage
          </h2>
          <div>
            <span className="text-xs text-slate-400">Deal Value</span>
            <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
              {formatCurrencyValue(deal.value, deal.currency)}
            </div>
            <span className="text-xs text-slate-500 font-mono">Currency: {deal.currency}</span>
          </div>

          <div className="pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-xs text-slate-400 block">Current Stage</span>
              <span className="font-semibold text-slate-800">{deal.stage_name}</span>
            </div>
            <div>
              <span className="text-xs text-slate-400 block">Target Close Date</span>
              <span className="font-semibold text-slate-800">{deal.close_date}</span>
            </div>
          </div>
        </Card>

        {/* Contact Reference Summary */}
        <Card className="p-6 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Contact Reference (CRM-1)
          </h2>
          {isOrphan ? (
            <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
              <span className="text-sm font-bold text-amber-900 block mb-1">
                No Contact Linked
              </span>
              <p className="text-xs text-amber-800 leading-relaxed">
                Edit this deal to connect an active contact UUID from the Contacts module.
              </p>
            </div>
          ) : (
            <div>
              <span className="text-xs text-slate-400 block">Linked Customer Contact</span>
              <span className="text-lg font-bold text-slate-900 block">
                {deal.contact_name || 'CRM-1 Contact'}
              </span>
              <span className="text-xs text-slate-500 font-mono block mt-1">
                Contact ID: {deal.contact_id}
              </span>
            </div>
          )}
        </Card>

        {/* Read-Only System Audit Metadata */}
        <Card className="p-6 space-y-3 bg-slate-50/50">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Audit &amp; System Metadata
          </h2>
          <div className="text-xs space-y-2 text-slate-600">
            <div>
              <span className="text-slate-400 block">System Identifier (Immutable):</span>
              <span className="font-mono text-slate-800 select-all">{deal.id}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Created At:</span>
              <span>{new Date(deal.created_at).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Last Updated:</span>
              <span>{new Date(deal.updated_at).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Total Quotes Value (Server-computed):</span>
              <span className="font-bold text-slate-900">
                {deal.currency} {totalQuoteAmount.toFixed(2)}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Linked Quotes Sub-Table Section */}
      <Card className="p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Commercial Quotes
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              SDS FR-CRM2-04: Simple quotes linked to this deal ({quotes.length} total).
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onAddQuote(deal)}
            aria-label="Create new quote for this deal"
          >
            + Add Quote
          </Button>
        </div>

        {isLoadingQuotes ? (
          <div className="py-12 text-center">
            <Spinner label="Loading quotes..." />
          </div>
        ) : quotes.length === 0 ? (
          <div className="py-12 text-center" data-testid="empty-quotes-state">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400 mb-3 text-lg">
              📄
            </div>
            <h3 className="text-sm font-semibold text-slate-900">No quotes created yet</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Add a commercial quote to specify pricing, amount, and scope terms for this deal.
            </p>
            <div className="mt-4">
              <Button variant="outline" size="sm" onClick={() => onAddQuote(deal)}>
                Create First Quote
              </Button>
            </div>
          </div>
        ) : (
          <Table aria-label="Linked Commercial Quotes">
            <TableHeader>
              <TableRow>
                <TableHead className="w-1/5">Quote Number</TableHead>
                <TableHead className="w-1/6">Date</TableHead>
                <TableHead className="w-1/5">Amount</TableHead>
                <TableHead className="w-1/3">Scope / Terms</TableHead>
                <TableHead className="w-20 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotes.map((q) => (
                <TableRow key={q.id} data-testid={`quote-row-${q.id}`}>
                  <TableCell>
                    <span className="font-semibold text-slate-900">{q.quote_number}</span>
                    <span className="text-xs text-slate-400 font-mono block">
                      {q.id.slice(0, 8)}...
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-slate-700 whitespace-nowrap">{q.date}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium text-slate-900 tabular-nums">
                      {formatCurrencyValue(q.amount, q.currency)}
                    </span>
                    <span className="text-xs text-slate-500 ml-1 font-mono">{q.currency}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-slate-600 line-clamp-2" title={q.note ?? ''}>
                      {q.note || <span className="text-slate-400 italic">No notes provided</span>}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onEditQuote(q, deal)}
                      aria-label={`Edit quote ${q.quote_number}`}
                    >
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
