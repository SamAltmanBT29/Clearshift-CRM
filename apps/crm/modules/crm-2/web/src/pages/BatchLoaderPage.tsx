import React, { useState } from 'react';
import {
  type Crm2BatchExecutionReport,
  type Crm2ExecuteBatchLoadInput,
  CRM2_DEFAULT_CHUNK_SIZE,
  CRM2_DEFAULT_FAILURE_THRESHOLD,
} from '@clearshift/contracts';
import { Button, Badge, Alert, Card } from '@clearshift/ui';
import { executeBatchLoad, Crm2ApiError } from '../api/crm-2.js';

export interface BatchLoaderPageProps {
  onBackToList?: () => void;
  initialReport?: Crm2BatchExecutionReport | null;
  onBatchCompleted?: (report: Crm2BatchExecutionReport) => void;
}

/**
 * CRM-2 Batch Ingestion & Partial-Load Stop Management UI (CRM2-13)
 * Provides operator visibility into 500-row chunked loading, bounded exponential retries,
 * and immediate stop behavior when row failures exceed 10%.
 */
export const BatchLoaderPage: React.FC<BatchLoaderPageProps> = ({
  onBackToList,
  initialReport = null,
  onBatchCompleted,
}) => {
  const [batchId, setBatchId] = useState(`batch-crm2-${Date.now()}`);
  const [chunkSize, setChunkSize] = useState(CRM2_DEFAULT_CHUNK_SIZE);
  const [simulateFailures, setSimulateFailures] = useState(false);
  const [rowCount, setRowCount] = useState(100);
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<Crm2BatchExecutionReport | null>(initialReport);
  const [error, setError] = useState<string | null>(null);

  const handleRunBatch = async () => {
    setIsLoading(true);
    setError(null);

    // Generate synthetic records for testing
    const records = Array.from({ length: rowCount }, (_, i) => {
      const rowNum = i + 1;
      // If simulateFailures is checked, fail rows 45 to 60 so failure rate > 10% after 50 rows
      const shouldFail = simulateFailures && rowNum >= 45 && rowNum <= 60;
      return {
        sourceRow: rowNum,
        idempotencyKey: `idemp-crm2-${batchId}-${rowNum}`,
        data: {
          entity: 'deal',
          name: shouldFail ? '' : `Enterprise Deal ${rowNum}`,
          value: shouldFail ? '-100.00' : '50000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-31',
        },
      };
    });

    const payload: Crm2ExecuteBatchLoadInput = {
      batchId,
      module: 'crm-2',
      step: 'load',
      chunkSize,
      records,
      failureThreshold: CRM2_DEFAULT_FAILURE_THRESHOLD,
      minAttemptedRows: 50,
      maxRetries: 2,
    };

    try {
      const result = await executeBatchLoad(payload);
      setReport(result);
      if (onBatchCompleted) {
        onBatchCompleted(result);
      }
    } catch (err: any) {
      if (err instanceof Crm2ApiError) {
        setError(`[${err.code}] ${err.message}`);
      } else {
        setError(err?.message || 'Failed to execute batch load operation.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Batch Load &amp; Reliability Monitor
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Chunked 500-row batch ingestion with idempotent exponential retry and immediate 10% stop behavior (CRM2-13).
          </p>
        </div>
        {onBackToList && (
          <Button variant="outline" size="sm" onClick={onBackToList}>
            &larr; Back to Deals
          </Button>
        )}
      </div>

      {/* Invariants & Policy Specification Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4 border-slate-200">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Chunked Ingestion
          </div>
          <div className="mt-1 text-lg font-bold text-slate-900">
            {CRM2_DEFAULT_CHUNK_SIZE} Rows / Chunk
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Records are sliced into deterministic sequential chunks of 500 rows to bound PG transaction size.
          </p>
        </Card>

        <Card className="p-4 border-slate-200">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Idempotent Retries
          </div>
          <div className="mt-1 text-lg font-bold text-slate-900">
            Bounded Backoff (Max 3)
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Transient failures trigger exponential backoff ($50 \times 2^{`{\\text{attempt}}`}$) preserving idempotency keys.
          </p>
        </Card>

        <Card className="p-4 border-slate-200">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Partial-Load Stop Policy
          </div>
          <div className="mt-1 text-lg font-bold text-slate-900">
            &gt; 10% Immediate Halt
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Halts batch immediately when failures exceed 10% after 50 attempts; committed rows remain durable.
          </p>
        </Card>
      </div>

      {/* Control Panel */}
      <Card className="p-6 border-slate-200 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">
          Execute Migration Batch Load
        </h2>

        {error && (
          <Alert variant="error" title="Batch Execution Error">
            {error}
          </Alert>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="batch-id-input" className="block text-xs font-medium text-slate-700 mb-1">
              Batch Identifier
            </label>
            <input
              id="batch-id-input"
              type="text"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              className="w-full text-sm rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="row-count-input" className="block text-xs font-medium text-slate-700 mb-1">
              Synthetic Row Count
            </label>
            <input
              id="row-count-input"
              type="number"
              min={1}
              max={2000}
              value={rowCount}
              onChange={(e) => setRowCount(Number(e.target.value))}
              className="w-full text-sm rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="chunk-size-input" className="block text-xs font-medium text-slate-700 mb-1">
              Chunk Size (Rows)
            </label>
            <input
              id="chunk-size-input"
              type="number"
              min={10}
              max={1000}
              value={chunkSize}
              onChange={(e) => setChunkSize(Number(e.target.value))}
              className="w-full text-sm rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <input
            id="simulate-failures-checkbox"
            type="checkbox"
            checked={simulateFailures}
            onChange={(e) => setSimulateFailures(e.target.checked)}
            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
          />
          <label htmlFor="simulate-failures-checkbox" className="text-sm text-slate-700 font-medium">
            Simulate Excessive Failures (&gt; 10% after 50 rows) to test immediate halting
          </label>
        </div>

        <div className="pt-2">
          <Button
            variant="primary"
            onClick={handleRunBatch}
            disabled={isLoading || !batchId.trim()}
          >
            {isLoading ? 'Processing In Chunks...' : 'Execute Chunked Batch Load'}
          </Button>
        </div>
      </Card>

      {/* Execution Report Display */}
      {report && (
        <Card className="p-6 border-slate-200 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">
                Batch Execution Status
              </div>
              <div className="text-xl font-bold text-slate-900 mt-1 flex items-center gap-3">
                <span>{report.batchId}</span>
                <span data-testid="status-badge">
                  {report.status === 'COMPLETED' ? (
                    <Badge variant="success">COMPLETED</Badge>
                  ) : report.status === 'STOPPED_EXCESSIVE_FAILURES' ? (
                    <Badge variant="danger">STOPPED_EXCESSIVE_FAILURES</Badge>
                  ) : (
                    <Badge variant="warning">{report.status}</Badge>
                  )}
                </span>
              </div>
            </div>

            <div className="text-right text-xs text-slate-500">
              Executed: {new Date(report.executedAt).toLocaleTimeString()}
            </div>
          </div>

          {/* Halt Banner if Excessive Failures */}
          {report.status === 'STOPPED_EXCESSIVE_FAILURES' && (
            <Alert
              variant="error"
              title="Execution Halted Immediately: 10% Failure Threshold Exceeded"
            >
              <p className="text-sm mt-1">{report.haltReason}</p>
              <p className="text-xs font-semibold text-rose-800 mt-2">
                &check; Durability Guarantee: {report.committedRecords} previously committed rows and receipts remain durable in storage. Zero destructive rollbacks were initiated.
              </p>
            </Alert>
          )}

          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
              <div className="text-xs text-slate-500 font-medium">Total Records</div>
              <div className="text-xl font-bold text-slate-900 mt-1">{report.totalRecords}</div>
            </div>

            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
              <div className="text-xs text-slate-500 font-medium">Attempted</div>
              <div className="text-xl font-bold text-slate-900 mt-1">{report.attemptedRecords}</div>
            </div>

            <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-200">
              <div className="text-xs text-emerald-700 font-medium">Committed</div>
              <div className="text-xl font-bold text-emerald-900 mt-1" data-testid="committed-records">
                {report.committedRecords}
              </div>
            </div>

            <div className="bg-rose-50 p-3 rounded-lg border border-rose-200">
              <div className="text-xs text-rose-700 font-medium">Failed</div>
              <div className="text-xl font-bold text-rose-900 mt-1">{report.failedRecords}</div>
            </div>

            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
              <div className="text-xs text-slate-500 font-medium">Chunks Processed</div>
              <div className="text-xl font-bold text-slate-900 mt-1">{report.chunksProcessed}</div>
            </div>

            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
              <div className="text-xs text-slate-500 font-medium">Failure Rate</div>
              <div className="text-xl font-bold text-slate-900 mt-1">
                {(report.failureRate * 100).toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Committed Durable Receipts Table Preview */}
          {report.committedReceipts.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Durable Committed Receipts ({report.committedReceipts.length})
                </h3>
                <span className="text-xs text-slate-500">Showing first 5 entries</span>
              </div>
              <div className="overflow-x-auto border border-slate-200 rounded-md">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead className="bg-slate-50 text-slate-700 font-medium">
                    <tr>
                      <th className="px-3 py-2 text-left">Source Row</th>
                      <th className="px-3 py-2 text-left">Idempotency Key</th>
                      <th className="px-3 py-2 text-left">Target Record ID</th>
                      <th className="px-3 py-2 text-left">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {report.committedReceipts.slice(0, 5).map((r) => (
                      <tr key={r.idempotencyKey} className="hover:bg-slate-50 font-mono">
                        <td className="px-3 py-2">{r.sourceRow}</td>
                        <td className="px-3 py-2">{r.idempotencyKey}</td>
                        <td className="px-3 py-2 text-indigo-600">{r.targetId}</td>
                        <td className="px-3 py-2 uppercase text-emerald-600">{r.kind}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Failed Rows Detail Table */}
          {report.failedRows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-rose-900">
                  Failed Rows ({report.failedRows.length})
                </h3>
                <span className="text-xs text-slate-500">Showing rejected inputs</span>
              </div>
              <div className="overflow-x-auto border border-rose-200 rounded-md">
                <table className="min-w-full divide-y divide-rose-200 text-xs">
                  <thead className="bg-rose-50 text-rose-900 font-medium">
                    <tr>
                      <th className="px-3 py-2 text-left">Source Row</th>
                      <th className="px-3 py-2 text-left">Idempotency Key</th>
                      <th className="px-3 py-2 text-left">Error Code</th>
                      <th className="px-3 py-2 text-left">Diagnostic Message</th>
                      <th className="px-3 py-2 text-left">Retries</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rose-100 bg-white">
                    {report.failedRows.slice(0, 5).map((f) => (
                      <tr key={f.idempotencyKey} className="text-rose-950 font-mono">
                        <td className="px-3 py-2 font-bold">{f.sourceRow}</td>
                        <td className="px-3 py-2">{f.idempotencyKey}</td>
                        <td className="px-3 py-2 font-semibold text-rose-700">{f.errorCode}</td>
                        <td className="px-3 py-2 font-sans">{f.errorMessage}</td>
                        <td className="px-3 py-2">{f.retryAttempts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};
