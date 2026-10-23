import React, { useState, useEffect, useCallback } from 'react';
import type { ReconciliationReport } from '@clearshift/contracts';
import { Crm5ApiClient, crm5Api } from '../api/crm-5.js';

export interface ReconciliationDetailPageProps {
  batchId: string;
  apiClient?: Crm5ApiClient;
  onBackToList?: () => void;
}

/**
 * ReconciliationDetailPage
 * Mathematical conservation balance sheet audit for a batch.
 * Invariant: source = loaded + rejected + merged + skipped + unaccounted.
 * Status is OK if and only if unaccounted === 0.
 */
export const ReconciliationDetailPage: React.FC<ReconciliationDetailPageProps> = ({
  batchId,
  apiClient = crm5Api,
  onBackToList,
}) => {
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.getReconciliation(batchId);
      setReport(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [batchId, apiClient]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  if (isLoading) {
    return (
      <div className="cs-detail-container" role="status" aria-busy="true" style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
        <div className="cs-detail-header-card" style={{ background: '#ffffff', borderRadius: '12px', padding: '24px', border: '1px solid #e2e8f0' }}>
          <div className="cs-skeleton-title" style={{ height: '32px', width: '40%', background: '#e2e8f0', borderRadius: '4px' }} />
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="cs-detail-container" style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
        <div className="cs-alert-card cs-alert-error" role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '20px' }}>
          <span className="cs-alert-icon" aria-hidden="true" style={{ fontSize: '24px' }}>
            ❌
          </span>
          <div className="cs-alert-content">
            <h2 className="cs-alert-title" style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#991b1b' }}>Unable to Load Reconciliation Report</h2>
            <p className="cs-alert-desc" style={{ margin: '8px 0 0 0', fontSize: '14px', color: '#b91c1c' }}>
              {error ?? `Reconciliation report for batch '${batchId}' not found.`}
            </p>
            {onBackToList && (
              <button
                type="button"
                className="cs-btn cs-btn-secondary"
                style={{ marginTop: '12px', padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer' }}
                onClick={onBackToList}
              >
                ← Back to List
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isBalanced = report.status === 'OK' && report.unaccountedCount === 0;

  return (
    <div className="cs-detail-container" style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
      {/* Breadcrumbs linking back to list */}
      <nav className="cs-breadcrumbs" aria-label="Breadcrumbs" style={{ marginBottom: '16px' }}>
        <ol className="cs-breadcrumb-list" style={{ display: 'flex', alignItems: 'center', gap: '8px', listStyle: 'none', padding: 0, margin: 0, fontSize: '13px', color: '#64748b' }}>
          <li className="cs-breadcrumb-item">
            <span className="cs-breadcrumb-link">ClearShift</span>
          </li>
          <li aria-hidden="true">/</li>
          <li className="cs-breadcrumb-item">
            <span className="cs-breadcrumb-link">CRM-5 Migration Control</span>
          </li>
          <li aria-hidden="true">/</li>
          <li className="cs-breadcrumb-item">
            {onBackToList ? (
              <button
                type="button"
                className="cs-breadcrumb-link"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  color: '#2563eb',
                  font: 'inherit',
                }}
                onClick={onBackToList}
              >
                Reconciliation
              </button>
            ) : (
              <span>Reconciliation</span>
            )}
          </li>
          <li aria-hidden="true">/</li>
          <li className="cs-breadcrumb-item" aria-current="page">
            <span className="cs-code-inline" style={{ fontFamily: 'monospace', fontWeight: 600, color: '#0f172a' }}>{report.batchId}</span>
          </li>
        </ol>
      </nav>

      {/* Header Card */}
      <div className="cs-detail-header-card" style={{ background: '#ffffff', borderRadius: '12px', padding: '24px', border: '1px solid #e2e8f0', marginBottom: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div className="cs-detail-top-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              {onBackToList && (
                <button
                  type="button"
                  className="cs-btn cs-btn-secondary cs-btn-sm"
                  onClick={onBackToList}
                  style={{ padding: '4px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer' }}
                >
                  ← Back
                </button>
              )}
              <span className="cs-module-chip" style={{ padding: '2px 8px', background: '#f1f5f9', borderRadius: '4px', fontSize: '12px', fontWeight: 600, color: '#334155' }}>{report.module.toUpperCase()}</span>
            </div>
            <h1 className="cs-detail-title" style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
              Reconciliation Balance Sheet: {report.batchId}
              <span style={{ fontSize: '12px', fontWeight: 600, padding: '4px 10px', borderRadius: '9999px', background: isBalanced ? '#dcfce7' : '#fee2e2', color: isBalanced ? '#166534' : '#991b1b', border: isBalanced ? '1px solid #bbf7d0' : '1px solid #fecaca' }}>
                {report.status}
              </span>
            </h1>
          </div>

          <button
            type="button"
            className="cs-btn cs-btn-secondary"
            onClick={loadReport}
            style={{ padding: '8px 14px', fontSize: '13px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer' }}
          >
            🔄 Re-audit
          </button>
        </div>
      </div>

      {/* Conservation Equation Explanation */}
      <div className="cs-panel-card" style={{ background: '#ffffff', borderRadius: '12px', padding: '24px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <h2 className="cs-panel-title" style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          Conservation Law Balance Equation
          <span className="cs-readonly-badge" style={{ fontSize: '11px', fontWeight: 600, padding: '2px 6px', background: '#e2e8f0', borderRadius: '4px', color: '#475569' }}>Mathematical Proof</span>
        </h2>
        <div className="cs-prop-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px' }}>
          <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="cs-prop-label" style={{ color: '#64748b' }}>Source Records:</span>
            <span className="cs-prop-value" style={{ fontWeight: 600, color: '#0f172a' }}>{report.sourceCount.toLocaleString()}</span>
          </div>
          <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="cs-prop-label" style={{ color: '#64748b' }}>Loaded (Committed):</span>
            <span className="cs-prop-value cs-text-ok" style={{ fontWeight: 600, color: '#16a34a' }}>{report.loadedCount.toLocaleString()}</span>
          </div>
          <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="cs-prop-label" style={{ color: '#64748b' }}>Rejected:</span>
            <span className="cs-prop-value cs-text-err" style={{ fontWeight: 600, color: '#dc2626' }}>{report.rejectedCount.toLocaleString()}</span>
          </div>
          <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="cs-prop-label" style={{ color: '#64748b' }}>Merged:</span>
            <span className="cs-prop-value" style={{ fontWeight: 600, color: '#0f172a' }}>{report.mergedCount.toLocaleString()}</span>
          </div>
          <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="cs-prop-label" style={{ color: '#64748b' }}>Skipped:</span>
            <span className="cs-prop-value" style={{ fontWeight: 600, color: '#0f172a' }}>{report.skippedCount.toLocaleString()}</span>
          </div>
          <div className="cs-prop-row" style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
            <span className="cs-prop-label" style={{ fontWeight: 700, color: '#0f172a' }}>
              Unaccounted Discrepancy:
            </span>
            <span
              className={`cs-prop-value ${
                report.unaccountedCount === 0 ? 'cs-text-ok' : 'cs-text-err'
              }`}
              style={{ fontSize: '1.1rem', fontWeight: 700, color: report.unaccountedCount === 0 ? '#16a34a' : '#dc2626' }}
            >
              {report.unaccountedCount.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
