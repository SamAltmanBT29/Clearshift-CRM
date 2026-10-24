import React, { useState } from 'react';
import type {
  Crm1BatchExecutionReport,
  Crm1ExecuteBatchLoadInput,
} from '@clearshift/contracts';
import {
  CRM1_DEFAULT_CHUNK_SIZE,
  CRM1_DEFAULT_FAILURE_THRESHOLD,
  CRM1_DEFAULT_MIN_ATTEMPTED_ROWS,
  CRM1_DEFAULT_MAX_RETRIES,
} from '@clearshift/contracts';
import { executeCrm1ChunkedBatchLoad } from '../../src/domain/batch-loader.js';

export interface BatchLoaderPageProps {
  onBackToList?: () => void;
  initialReport?: Crm1BatchExecutionReport | null;
  onBatchCompleted?: (report: Crm1BatchExecutionReport) => void;
}

/**
 * CRM-1 Batch Ingestion & Partial-Load Stop Management UI (CRM1-13)
 * Provides operator visibility into 500-row chunked loading, bounded exponential retries,
 * and immediate stop behavior when row failures exceed 10%.
 */
export const BatchLoaderPage: React.FC<BatchLoaderPageProps> = ({
  onBackToList,
  initialReport = null,
  onBatchCompleted,
}) => {
  const [batchId, setBatchId] = useState(`batch-crm1-${Date.now()}`);
  const [chunkSize, setChunkSize] = useState(CRM1_DEFAULT_CHUNK_SIZE);
  const [simulateFailures, setSimulateFailures] = useState(false);
  const [rowCount, setRowCount] = useState(100);
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<Crm1BatchExecutionReport | null>(initialReport);
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
        idempotencyKey: `idemp-crm1-${batchId}-${rowNum}`,
        data: {
          entity: 'contact',
          firstName: shouldFail ? '' : `SyntheticFirstName${rowNum}`,
          lastName: shouldFail ? '' : `SyntheticLastName${rowNum}`,
          email: shouldFail ? 'invalid-email' : `user${rowNum}@synthetic-example.com`,
          phone: '+15551234567',
        },
      };
    });

    const payload: Crm1ExecuteBatchLoadInput = {
      batchId,
      module: 'crm-1',
      step: 'load',
      chunkSize,
      records,
      failureThreshold: CRM1_DEFAULT_FAILURE_THRESHOLD,
      minAttemptedRows: CRM1_DEFAULT_MIN_ATTEMPTED_ROWS,
      maxRetries: CRM1_DEFAULT_MAX_RETRIES,
    };

    try {
      const result = await executeCrm1ChunkedBatchLoad(payload);
      setReport(result);
      if (onBatchCompleted) {
        onBatchCompleted(result);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to execute batch load operation.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="crm1-batch-loader-page p-6 max-w-7xl mx-auto" data-testid="crm1-batch-loader-page">
      <header className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Batch Ingestion & Partial-Load Stop Management
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            CRM-1 Contacts, Companies and Leads — 500-Row Chunks, Bounded Retries &amp; 10% Failure Halt Policy (CRM1-13)
          </p>
        </div>
        {onBackToList && (
          <button
            type="button"
            onClick={onBackToList}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            Back to Directory
          </button>
        )}
      </header>

      {error && (
        <div className="mb-6 p-4 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm" role="alert">
          {error}
        </div>
      )}

      {/* Control Panel */}
      <section className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Batch Execution Configuration</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label htmlFor="batch-id-input" className="block text-xs font-semibold text-gray-700 uppercase mb-1">
              Batch Identifier
            </label>
            <input
              id="batch-id-input"
              type="text"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              disabled={isLoading}
            />
          </div>
          <div>
            <label htmlFor="chunk-size-input" className="block text-xs font-semibold text-gray-700 uppercase mb-1">
              Chunk Size (Rows)
            </label>
            <input
              id="chunk-size-input"
              type="number"
              value={chunkSize}
              onChange={(e) => setChunkSize(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              disabled={isLoading}
            />
          </div>
          <div>
            <label htmlFor="row-count-input" className="block text-xs font-semibold text-gray-700 uppercase mb-1">
              Synthetic Rows
            </label>
            <input
              id="row-count-input"
              type="number"
              value={rowCount}
              onChange={(e) => setRowCount(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              disabled={isLoading}
            />
          </div>
          <div className="flex flex-col justify-end">
            <label className="flex items-center space-x-2 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={simulateFailures}
                onChange={(e) => setSimulateFailures(e.target.checked)}
                className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                disabled={isLoading}
              />
              <span className="text-xs font-medium text-gray-700">Simulate &gt;10% Failures (Stop Invariant)</span>
            </label>
            <button
              type="button"
              onClick={handleRunBatch}
              disabled={isLoading}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? 'Processing Chunks...' : 'Execute Batch Load'}
            </button>
          </div>
        </div>
      </section>

      {/* Execution Results Summary */}
      {report && (
        <section className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6" data-testid="batch-report-section">
          <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-200">
            <div>
              <h2 className="text-lg font-medium text-gray-900">Batch Execution Report</h2>
              <span className="text-xs text-gray-500">ID: {report.batchId}</span>
            </div>
            <div>
              <span
                data-testid="batch-status-badge"
                className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                  report.status === 'COMPLETED'
                    ? 'bg-green-100 text-green-800'
                    : report.status === 'STOPPED_EXCESSIVE_FAILURES'
                      ? 'bg-red-100 text-red-800'
                      : 'bg-yellow-100 text-yellow-800'
                }`}
              >
                {report.status}
              </span>
            </div>
          </div>

          {report.status === 'STOPPED_EXCESSIVE_FAILURES' && (
            <div className="mb-4 p-4 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm">
              <div className="font-semibold mb-1">⚠️ Batch Execution Halted Immediately</div>
              <p>{report.haltReason}</p>
              <p className="mt-2 text-xs text-red-700">
                Non-negotiable invariant: Already committed receipts remain fully durable; zero destructive rollback performed.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-center">
            <div className="p-3 bg-gray-50 rounded-md">
              <span className="block text-xs text-gray-500 uppercase">Total Rows</span>
              <span className="text-xl font-bold text-gray-900">{report.totalRecords}</span>
            </div>
            <div className="p-3 bg-gray-50 rounded-md">
              <span className="block text-xs text-gray-500 uppercase">Attempted</span>
              <span className="text-xl font-bold text-gray-900">{report.attemptedRecords}</span>
            </div>
            <div className="p-3 bg-green-50 rounded-md">
              <span className="block text-xs text-green-700 uppercase">Committed</span>
              <span className="text-xl font-bold text-green-800">{report.committedRecords}</span>
            </div>
            <div className="p-3 bg-red-50 rounded-md">
              <span className="block text-xs text-red-700 uppercase">Failed</span>
              <span className="text-xl font-bold text-red-800">{report.failedRecords}</span>
            </div>
            <div className="p-3 bg-gray-50 rounded-md">
              <span className="block text-xs text-gray-500 uppercase">Chunks</span>
              <span className="text-xl font-bold text-gray-900">{report.chunksProcessed}</span>
            </div>
            <div className="p-3 bg-gray-50 rounded-md">
              <span className="block text-xs text-gray-500 uppercase">Failure Rate</span>
              <span className="text-xl font-bold text-gray-900">{(report.failureRate * 100).toFixed(1)}%</span>
            </div>
          </div>
        </section>
      )}

      {/* Tables of Committed Receipts & Failed Rows */}
      {report && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <section className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              Durable Committed Receipts ({report.committedReceipts.length})
            </h3>
            <div className="max-h-60 overflow-y-auto border border-gray-100 rounded">
              <table className="min-w-full divide-y divide-gray-200 text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Row</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Idempotency Key</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Target ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {report.committedReceipts.slice(0, 50).map((rcpt) => (
                    <tr key={rcpt.idempotencyKey}>
                      <td className="px-3 py-1.5 font-mono">{rcpt.sourceRow}</td>
                      <td className="px-3 py-1.5 font-mono truncate max-w-xs">{rcpt.idempotencyKey}</td>
                      <td className="px-3 py-1.5 font-mono text-gray-600">{rcpt.targetId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              Failed Rows ({report.failedRows.length})
            </h3>
            <div className="max-h-60 overflow-y-auto border border-gray-100 rounded">
              <table className="min-w-full divide-y divide-gray-200 text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Row</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Error Code</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Retries</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {report.failedRows.slice(0, 50).map((fail) => (
                    <tr key={fail.idempotencyKey}>
                      <td className="px-3 py-1.5 font-mono">{fail.sourceRow}</td>
                      <td className="px-3 py-1.5 font-mono text-red-600">{fail.errorCode}</td>
                      <td className="px-3 py-1.5 font-mono">{fail.retryAttempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
