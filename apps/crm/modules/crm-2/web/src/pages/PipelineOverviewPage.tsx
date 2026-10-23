import React, { useEffect, useState } from 'react';
import { crm2Api } from '../api/crm-2.js';
import type { Stage, Deal } from '@clearshift/contracts';
import { Card, Button, Spinner, Alert, Badge } from '@clearshift/ui';

export interface PipelineOverviewPageProps {
  onCreateDeal?: () => void;
  onFilterByStage?: (stageName: string) => void;
}

export const PipelineOverviewPage: React.FC<PipelineOverviewPageProps> = ({
  onCreateDeal,
  onFilterByStage,
}) => {
  const [stages, setStages] = useState<Stage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        const [stagesRes, dealsRes] = await Promise.all([
          crm2Api.getStages(),
          crm2Api.getDeals({ page: 1, pageSize: 100 }),
        ]);
        if (mounted) {
          setStages(stagesRes.items || []);
          setDeals(dealsRes.items || []);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || 'Failed to load pipeline data');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadData();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-4">
        <Spinner size="lg" />
        <p className="text-slate-600 text-sm font-medium">Loading sales pipeline stages...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert variant="error" title="Pipeline Error">
          {error}
        </Alert>
      </div>
    );
  }

  if (stages.length === 0) {
    return (
      <div className="p-12 text-center text-slate-500 bg-white rounded-lg border border-slate-200">
        <p className="text-base font-semibold text-slate-800">No records found</p>
        <p className="text-sm text-slate-500 mt-1">Pipeline stages directory is empty.</p>
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
