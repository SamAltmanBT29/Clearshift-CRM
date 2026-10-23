import React from 'react';
import type { Stage, Deal } from '@clearshift/contracts';
import { Card, Button, Badge } from '@clearshift/ui';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';

export interface PipelineOverviewPageProps {
  onCreateDeal?: () => void;
  onFilterByStage?: (stageName: string) => void;
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | Error | { code?: string; message?: string; details?: unknown } | null;
  onRetry?: (() => void) | undefined;
  httpStatus?: number;
  isAccessDenied?: boolean;
  requiredCapability?: string;
  requiredRole?: string;
  currentRole?: string;
  stages?: Stage[];
  deals?: Deal[];
}

export const PipelineOverviewPage: React.FC<PipelineOverviewPageProps> = ({
  onCreateDeal,
  onFilterByStage,
  isLoading = false,
  isEmpty = false,
  error = null,
  onRetry,
  httpStatus,
  isAccessDenied = false,
  requiredCapability = 'module.read',
  requiredRole,
  currentRole,
  stages = [],
  deals = [],
}) => {
  // 1. 403 Forbidden Access Denied State
  if (isAccessDenied || httpStatus === 403) {
    return (
      <AccessDeniedView
        requiredCapability={requiredCapability}
        requiredRole={requiredRole}
        currentRole={currentRole}
        resourceName="Pipeline Stages Overview"
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
          rowCount={3}
          columnCount={6}
          ariaLabel="Loading sales pipeline stages..."
        />
      </div>
    );
  }

  // 4. Empty State
  if (isEmpty || stages.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title="No pipeline stages found"
          description="There are no sales pipeline stages recorded in the system."
          actionLabel={onCreateDeal ? '+ New Opportunity' : undefined}
          onAction={onCreateDeal}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Sales Pipeline Stages</h2>
          <p className="text-sm text-slate-500 mt-1">
            Authoritative 6-stage sales progression model. Stages are permanently seeded and cannot be renamed or duplicated.
          </p>
        </div>
        {onCreateDeal && (
          <Button variant="primary" onClick={onCreateDeal}>
            + New Opportunity
          </Button>
        )}
      </div>

      {/* Stage Flow Pipeline Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {stages.map((stage) => {
          const stageDeals = deals.filter((d) => d.stage_name === stage.name);
          const totalVal = stageDeals.reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);

          let stageVariant: 'neutral' | 'success' | 'warning' | 'danger' | 'info' = 'neutral';
          if (stage.name === 'Won') stageVariant = 'success';
          else if (stage.name === 'Lost') stageVariant = 'danger';
          else if (stage.name === 'Proposal' || stage.name === 'Negotiation') stageVariant = 'warning';
          else if (stage.name === 'Qualified') stageVariant = 'info';

          return (
            <Card key={stage.id} className="flex flex-col justify-between border-slate-200 hover:shadow-md transition-shadow">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-mono font-bold text-slate-400">
                    STAGE {stage.order}
                  </span>
                  <Badge variant={stageVariant}>{stage.name}</Badge>
                </div>
                <div className="mt-2">
                  <div className="text-2xl font-bold text-slate-900">{stageDeals.length}</div>
                  <div className="text-xs text-slate-500 font-medium">
                    {stageDeals.length === 1 ? 'Opportunity' : 'Opportunities'}
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <div className="text-xs text-slate-400 font-medium">Pipeline Value</div>
                  <div className="text-sm font-semibold text-slate-700">
                    ${totalVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              {onFilterByStage && (
                <div className="mt-4 pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => onFilterByStage(stage.name)}
                  >
                    View Deals
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default PipelineOverviewPage;
