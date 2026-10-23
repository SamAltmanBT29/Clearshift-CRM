import React, { useState, useEffect, useCallback, useTransition } from 'react';
import {
  Card,
  Input,
  Button,
  Pagination,
  Alert,
} from '@clearshift/ui';
import type { CRM4List } from '@clearshift/contracts';
import { getMarketingLists, Crm4ApiError } from '../api/crm-4.js';
import { MarketingListsTable } from '../components/MarketingListsTable.js';

export interface MarketingListsPageProps {
  simulatePermissionDenied?: boolean;
  simulateError?: boolean;
  onCreateList?: () => void;
  onSelectList?: (list: CRM4List) => void;
  onViewCampaigns?: (list: CRM4List) => void;
}

export function MarketingListsPage({
  simulatePermissionDenied = false,
  simulateError = false,
  onCreateList,
  onSelectList,
  onViewCampaigns,
}: MarketingListsPageProps) {
  // Query state
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Data state
  const [lists, setLists] = useState<CRM4List[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Status state
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Crm4ApiError | null>(null);
  const [, startTransition] = useTransition();

  // Fetch marketing lists from server
  const loadLists = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await getMarketingLists(
        {
          page: currentPage,
          pageSize,
          search: search || undefined,
        },
        {
          simulatePermissionDenied,
          simulateError,
        }
      );

      setLists(response.items);
      setTotalCount(response.pagination.totalCount);
      setTotalPages(response.pagination.totalPages);
    } catch (err: any) {
      if (err instanceof Crm4ApiError) {
        setError(err);
      } else {
        setError(
          new Crm4ApiError(
            500,
            'UNEXPECTED_ERROR',
            err.message || 'An unexpected error occurred while loading marketing lists.'
          )
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, pageSize, search, simulatePermissionDenied, simulateError]);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  // Search input handler
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    startTransition(() => {
      setSearch(val);
      setCurrentPage(1); // Requirement: search/filter changes reset pagination to first page
    });
  };

  const handleClearSearch = () => {
    startTransition(() => {
      setSearch('');
      setCurrentPage(1);
    });
  };

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Marketing Lists &amp; Segmentation
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            ClearShift CRM-4: Manage audience segments, campaign recipient history, and contact consent state.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={loadLists}
            disabled={isLoading}
            aria-label="Refresh marketing lists from server"
          >
            Refresh
          </Button>
          {onCreateList && (
            <Button
              variant="primary"
              size="sm"
              onClick={onCreateList}
              aria-label="Create new marketing list"
            >
              + New List
            </Button>
          )}
        </div>
      </div>

      {/* Search and Filters Bar */}
      <Card className="p-4 bg-slate-50/50">
        <form
          role="search"
          aria-label="Filter Marketing Lists"
          onSubmit={(e) => e.preventDefault()}
          className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end"
        >
          <div className="sm:col-span-2">
            <Input
              id="marketing-lists-search"
              label="Search Marketing Lists"
              placeholder="Search by list name or audience..."
              value={search}
              onChange={handleSearchChange}
              aria-label="Search marketing lists by name"
            />
          </div>

          <div className="flex items-center gap-2">
            {search && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearSearch}
                aria-label="Clear active search filter"
                className="text-slate-600"
              >
                Clear Search
              </Button>
            )}
            <span className="text-xs text-slate-400 font-mono ml-auto" aria-live="polite">
              {totalCount} {totalCount === 1 ? 'list' : 'lists'} found
            </span>
          </div>
        </form>
      </Card>

      {/* Permission-Denied State (403) */}
      {error && error.isPermissionDenied && (
        <Alert
          variant="error"
          title="Access Restricted"
          className="border-red-200 bg-red-50"
        >
          <div className="flex flex-col gap-2">
            <p className="text-sm text-red-700">
              You do not have the required role or capability (<code>module.read</code>) to view Marketing Lists.
            </p>
            <p className="text-xs text-red-500">
              Please contact your ClearShift Hub administrator to request marketing view permissions.
            </p>
          </div>
        </Alert>
      )}

      {/* Recoverable Error State */}
      {error && !error.isPermissionDenied && (
        <Alert
          variant="error"
          title="Failed to Load Marketing Lists"
          className="border-red-200 bg-red-50"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-red-700">{error.message}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={loadLists}
              className="text-xs shrink-0 bg-white"
              aria-label="Retry loading marketing lists from server"
            >
              Retry
            </Button>
          </div>
        </Alert>
      )}

      {/* Data Table */}
      {!error && (
        <Card className="overflow-hidden border border-slate-200 shadow-sm">
          <MarketingListsTable
            lists={lists}
            loading={isLoading}
            emptyTitle={search ? 'No matching marketing lists' : 'No marketing lists recorded'}
            emptyDescription={
              search
                ? `No marketing lists match the query "${search}". Try adjusting your search term.`
                : 'No marketing lists are currently registered in CRM-4.'
            }
            onSelectList={onSelectList}
            onViewCampaigns={onViewCampaigns}
          />

          {/* Bounded Server Pagination */}
          {!isLoading && totalPages > 1 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalCount={totalCount}
              pageSize={pageSize}
              onPageChange={(page) => setCurrentPage(page)}
            />
          )}
        </Card>
      )}
    </div>
  );
}

export default MarketingListsPage;
