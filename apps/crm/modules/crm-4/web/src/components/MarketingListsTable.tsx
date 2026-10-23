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
import type { CRM4List } from '@clearshift/contracts';

export interface MarketingListsTableProps {
  lists: CRM4List[];
  loading?: boolean | undefined;
  emptyTitle?: string | undefined;
  emptyDescription?: string | undefined;
  onSelectList?: ((list: CRM4List) => void) | undefined;
  onViewCampaigns?: ((list: CRM4List) => void) | undefined;
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
  emptyTitle = 'No marketing lists found',
  emptyDescription = 'No marketing lists or segmentation criteria have been created yet.',
  onSelectList,
  onViewCampaigns,
}: MarketingListsTableProps) {
  if (loading) {
    return (
      <div className="p-12 text-center" role="status" aria-label="Loading marketing lists">
        <div className="animate-spin inline-block w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full mb-3" />
        <p className="text-sm font-medium text-slate-600">Loading marketing lists from server...</p>
      </div>
    );
  }

  if (lists.length === 0) {
    return (
      <div className="p-12 text-center" role="status">
        <h3 className="text-base font-semibold text-slate-900">{emptyTitle}</h3>
        <p className="text-sm text-slate-500 mt-1">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <Table aria-label="CRM Marketing Lists Table">
      <TableHeader>
        <TableRow>
          <TableHead className="w-1/3">List Name</TableHead>
          <TableHead className="w-1/3">Description</TableHead>
          <TableHead className="w-28 text-center">Campaigns</TableHead>
          <TableHead className="w-36">Created Date</TableHead>
          <TableHead className="w-28 text-right">Actions</TableHead>
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
}
