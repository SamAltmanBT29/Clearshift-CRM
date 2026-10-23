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

export interface DealsTableProps {
  deals: Deal[];
  loading?: boolean | undefined;
  emptyTitle?: string | undefined;
  emptyDescription?: string | undefined;
  onSelectDeal?: ((deal: Deal) => void) | undefined;
  onViewQuotes?: ((deal: Deal) => void) | undefined;
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
  emptyTitle = 'No deals found',
  emptyDescription = 'No sales opportunities are currently recorded in the system.',
  onSelectDeal,
  onViewQuotes,
}: DealsTableProps) {
  if (loading) {
    return (
      <div className="p-12 text-center" role="status" aria-label="Loading deals table">
        <div className="animate-spin inline-block w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full mb-3" />
        <p className="text-sm font-medium text-slate-600">Loading opportunity data...</p>
      </div>
    );
  }

  if (deals.length === 0) {
    return (
      <div className="p-12 text-center" role="status">
        <h3 className="text-base font-semibold text-slate-900">{emptyTitle}</h3>
        <p className="text-sm text-slate-500 mt-1">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <Table aria-label="CRM Deals List">
      <TableHeader>
        <TableRow>
          <TableHead className="w-1/4">Deal Name</TableHead>
          <TableHead className="w-1/5">Contact / Orphan Status</TableHead>
          <TableHead className="w-1/6">Value</TableHead>
          <TableHead className="w-1/6">Pipeline Stage</TableHead>
          <TableHead className="w-1/6">Close Date</TableHead>
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
