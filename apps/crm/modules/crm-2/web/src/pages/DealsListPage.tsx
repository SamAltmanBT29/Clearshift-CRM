import React, { useState, useEffect, useCallback, useTransition } from 'react';
import {
  Card,
  Input,
  Select,
  Button,
  Pagination,
  Alert,
  Spinner,
} from '@clearshift/ui';
import {
  type Deal,
  type Stage,
  type Crm2StageName,
  CRM2_STAGES,
} from '@clearshift/contracts';
import { getDeals, getStages, Crm2ApiError } from '../api/crm-2.js';
import { DealsTable } from '../components/DealsTable.js';

export interface DealsListPageProps {
  simulatePermissionDenied?: boolean;
  simulateError?: boolean;
  onCreateDeal?: () => void;
  onSelectDeal?: (deal: Deal) => void;
  onViewQuotes?: (deal: Deal) => void;
}

export function DealsListPage({
  simulatePermissionDenied = false,
  simulateError = false,
  onCreateDeal,
  onSelectDeal,
  onViewQuotes,
}: DealsListPageProps) {
  // Query state
  const [search, setSearch] = useState('');
  const [selectedStage, setSelectedStage] = useState<Crm2StageName | ''>('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Data state
  const [deals, setDeals] = useState<Deal[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Status state
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Crm2ApiError | null>(null);
  const [, startTransition] = useTransition();

  // Load available stages on mount
  useEffect(() => {
    let isSubscribed = true;
    getStages()
      .then((res) => {
        if (isSubscribed) {
          setStages(res.items);
        }
      })
      .catch((err) => {
        // Stage loading non-fatal fallback
        console.warn('Failed to load stages from API:', err);
      });

    return () => {
      isSubscribed = false;
    };
  }, []);

  // Fetch deals from server
  const loadDeals = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await getDeals(
        {
          page: currentPage,
          pageSize,
          search: search || undefined,
          stage: selectedStage || undefined,
        },
        {
          simulatePermissionDenied,
          simulateError,
        }
      );

      setDeals(response.items);
      setTotalCount(response.pagination.totalCount);
      setTotalPages(response.pagination.totalPages);
    } catch (err: any) {
      if (err instanceof Crm2ApiError) {
        setError(err);
      } else {
        setError(new Crm2ApiError(500, 'UNEXPECTED_ERROR', err.message || 'An unexpected error occurred.'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, pageSize, search, selectedStage, simulatePermissionDenied, simulateError]);

  useEffect(() => {
    loadDeals();
  }, [loadDeals]);

  // Handlers
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    startTransition(() => {
      setSearch(val);
      setCurrentPage(1); // Requirement: search/filter resets pagination to first page
    });
  };

  const handleStageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as Crm2StageName | '';
    startTransition(() => {
      setSelectedStage(val);
      setCurrentPage(1); // Requirement: search/filter resets pagination to first page
    });
  };

  const handleClearFilters = () => {
    startTransition(() => {
      setSearch('');
      setSelectedStage('');
      setCurrentPage(1);
    });
  };

  const stageOptions = (stages.length > 0 ? stages.map((s) => s.name) : CRM2_STAGES).map(
    (stageName) => ({
      label: stageName,
      value: stageName,
    })
  );

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Deals &amp; Pipeline
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            ClearShift CRM-2: Monitor pipeline opportunities, stage progressions, and sales quotes.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={loadDeals}
            disabled={isLoading}
            aria-label="Refresh deals list from server"
          >
            Refresh
          </Button>
          {onCreateDeal && (
            <Button
              variant="primary"
              size="sm"
              onClick={onCreateDeal}
              aria-label="Create new deal opportunity"
            >
              + New Deal
            </Button>
          )}
        </div>
      </div>

      {/* Search and Filters Bar */}
      <Card className="p-4 bg-slate-50/50">
        <form
          role="search"
          aria-label="Filter Deals"
          onSubmit={(e) => e.preventDefault()}
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-end"
        >
          <div className="sm:col-span-2">
            <Input
              id="deals-search-input"
              label="Search Opportunities"
              placeholder="Search by deal name or contact..."
              value={search}
              onChange={handleSearchChange}
              aria-label="Search deals by name or contact"
            />
          </div>

          <div>
            <Select
              id="deals-stage-filter"
              label="Filter by Stage"
              placeholder="All Stages"
              options={stageOptions}
              value={selectedStage}
              onChange={handleStageChange}
              aria-label="Filter deals by pipeline stage"
            />
          </div>

          <div className="flex items-center gap-2">
            {(search || selectedStage) && (
              <Button
                variant="ghost"
                size="md"
                onClick={handleClearFilters}
                className="w-full sm:w-auto"
                aria-label="Reset search and filters"
              >
                Clear Filters
              </Button>
            )}
          </div>
        </form>
      </Card>

      {/* Main View Area: Distinct states */}
      <Card>
        {/* Permission Denied State (403 Forbidden) */}
        {error?.isPermissionDenied ? (
          <div className="p-8 text-center" data-testid="permission-denied-state">
            <Alert
              variant="error"
              title="Access Denied: Missing CRM-2 Permissions"
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadDeals}
                  aria-label="Re-check permissions"
                >
                  Retry Request
                </Button>
              }
            >
              <p className="mb-2">
                Your role does not have authorization to view or manage Deals in the ClearShift CRM-2 module.
              </p>
              <p className="text-xs text-rose-700">
                Contact your workspace administrator to request access (Gate G3/G4 clearance required).
              </p>
            </Alert>
          </div>
        ) : error ? (
          /* Recoverable Error State */
          <div className="p-8" data-testid="recoverable-error-state">
            <Alert
              variant="error"
              title="Unable to Load Deals"
              action={
                <Button
                  variant="danger"
                  size="sm"
                  onClick={loadDeals}
                  aria-label="Retry loading deals"
                >
                  Retry
                </Button>
              }
            >
              <p className="mb-1 font-medium">{error.message}</p>
              <p className="text-xs text-rose-700">
                A server or network communication issue occurred. You can retry the request without losing your active filter selections.
              </p>
            </Alert>
          </div>
        ) : isLoading ? (
          /* Loading State */
          <div className="py-20" data-testid="loading-state">
            <Spinner label="Loading CRM deals from server..." />
          </div>
        ) : deals.length === 0 ? (
          /* Empty Results State */
          <div className="py-16 px-6 text-center" data-testid="empty-results-state">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 mb-4 text-xl">
              📂
            </div>
            <h3 className="text-base font-semibold text-slate-900">No deals found</h3>
            <p className="mt-1 text-sm text-slate-500 max-w-sm mx-auto">
              {search || selectedStage
                ? 'No opportunities match your current filter criteria. Try clearing or modifying your filters.'
                : 'No sales opportunities are currently recorded in the system.'}
            </p>
            {(search || selectedStage) && (
              <div className="mt-6">
                <Button variant="outline" size="sm" onClick={handleClearFilters}>
                  Reset All Filters
                </Button>
              </div>
            )}
          </div>
        ) : (
          /* Loaded Data Table View */
          <div>
            <DealsTable
              deals={deals}
              onSelectDeal={onSelectDeal}
              onViewQuotes={onViewQuotes}
            />
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalCount={totalCount}
              pageSize={pageSize}
              onPageChange={(page) => setCurrentPage(page)}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
