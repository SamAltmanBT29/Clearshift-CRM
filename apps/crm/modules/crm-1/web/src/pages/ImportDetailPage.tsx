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
  type CRM1ImportBatchDetail,
  type CRM1ImportReject,
} from '@clearshift/contracts';
import { getImportBatch, getImportRejects } from '../api/crm-1.js';

export interface ImportDetailPageProps {
  batchId: string;
  initialBatch?: CRM1ImportBatchDetail | null | undefined;
  onBackToList: () => void;
}

export function ImportDetailPage({
  batchId,
  initialBatch,
  onBackToList,
}: ImportDetailPageProps) {
  const [batch, setBatch] = useState<CRM1ImportBatchDetail | null>(initialBatch ?? null);
  const [rejects, setRejects] = useState<CRM1ImportReject[]>([]);
  const [isLoading, setIsLoading] = useState(!initialBatch);
  const [isLoadingRejects, setIsLoadingRejects] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectFilter, setRejectFilter] = useState<string>('');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getImportBatch(batchId);
      setBatch(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load import batch details.');
    } finally {
      setIsLoading(false);
    }
  }, [batchId]);

  const loadRejects = useCallback(async () => {
    setIsLoadingRejects(true);
    try {
      const queryParams: { pageSize: number; reasonCode?: string } = { pageSize: 100 };
      if (rejectFilter) {
        queryParams.reasonCode = rejectFilter;
      }
      const res = await getImportRejects(batchId, queryParams);
      setRejects(res.items);
    } catch (err: any) {
      console.warn('Failed to load rejects:', err);
    } finally {
      setIsLoadingRejects(false);
    }
  }, [batchId, rejectFilter]);

  useEffect(() => {
    if (!initialBatch) {
      loadData();
    }
  }, [loadData, initialBatch]);

  useEffect(() => {
    loadRejects();
  }, [loadRejects]);

  const getStatusBadgeVariant = (st?: string): 'info' | 'success' | 'danger' | 'neutral' => {
    switch (st) {
      case 'completed':
        return 'success';
      case 'failed':
        return 'danger';
      case 'processing':
        return 'info';
      default:
        return 'neutral';
    }
  };

  const receipts = batch?.receipts ?? [];
  const loadedCount = batch?.loadedCount ?? receipts.length;
  const rejectedCount = batch?.rejectedCount ?? rejects.length;
  const totalAttempted = loadedCount + rejectedCount;

  return (
    <div className="cs-page-container max-w-5xl mx-auto p-6" style={{ maxWidth: '64rem', margin: '0 auto', padding: '24px' }}>
      <div className="mb-6 flex items-center justify-between" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onBackToList}
            aria-label="Back to imports overview"
            style={{ marginBottom: '12px' }}
          >
            ← Back to Imports
          </Button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
              Import Batch Review
            </h1>
            {batch?.status && (
              <Badge variant={getStatusBadgeVariant(batch.status)}>
                {batch.status.toUpperCase()}
              </Badge>
            )}
          </div>
          <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '4px' }}>
            Batch UUID: <code style={{ fontSize: '0.8125rem' }}>{batchId}</code>
          </p>
        </div>
      </div>

      {error && (
        <Alert variant="error" style={{ marginBottom: '24px' }}>
          {error}
        </Alert>
      )}

      {isLoading ? (
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px' }}>
            <Spinner size="lg" />
            <p style={{ marginTop: '16px', fontSize: '0.875rem', color: '#64748b' }}>
              Loading batch summary...
            </p>
          </div>
        </Card>
      ) : batch ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <Card>
              <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                Source System
              </span>
              <p style={{ margin: '4px 0 0', fontWeight: 600, fontSize: '1.125rem', color: '#0f172a' }}>
                {batch.sourceSystem}
              </p>
            </Card>
            <Card>
              <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                Committed Records
              </span>
              <p style={{ margin: '4px 0 0', fontWeight: 700, fontSize: '1.25rem', color: '#16a34a' }}>
                {loadedCount}
              </p>
            </Card>
            <Card>
              <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                Rejected Records
              </span>
              <p style={{ margin: '4px 0 0', fontWeight: 700, fontSize: '1.25rem', color: rejectedCount > 0 ? '#dc2626' : '#64748b' }}>
                {rejectedCount}
              </p>
            </Card>
            <Card>
              <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                Total Attempted
              </span>
              <p style={{ margin: '4px 0 0', fontWeight: 700, fontSize: '1.25rem', color: '#0f172a' }}>
                {totalAttempted}
              </p>
            </Card>
          </div>

          {/* Committed Receipts Section */}
          <Card>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#0f172a', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
              Durable Target Receipts ({receipts.length})
            </h2>
            {receipts.length === 0 ? (
              <p style={{ fontSize: '0.875rem', color: '#64748b', margin: 0 }}>
                No target records have been committed for this batch yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source Row</TableHead>
                    <TableHead>Target Entity</TableHead>
                    <TableHead>Target ID</TableHead>
                    <TableHead>Committed At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipts.map((rc, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{rc.sourceRow}</TableCell>
                      <TableCell>
                        <Badge variant="neutral">{rc.entity}</Badge>
                      </TableCell>
                      <TableCell>
                        <code style={{ fontSize: '0.8125rem' }}>{rc.targetId}</code>
                      </TableCell>
                      <TableCell>{new Date(rc.createdAt).toLocaleTimeString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          {/* Rejected Rows Section */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
                Rejected Records ({rejects.length})
              </h2>
              <div>
                <input
                  type="text"
                  placeholder="Filter by reason code..."
                  value={rejectFilter}
                  onChange={(e) => setRejectFilter(e.target.value)}
                  style={{
                    padding: '6px 12px',
                    fontSize: '0.875rem',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                  }}
                  aria-label="Filter rejected records by reason code"
                />
              </div>
            </div>

            {isLoadingRejects ? (
              <div style={{ padding: '24px', textAlign: 'center' }}>
                <Spinner size="md" />
              </div>
            ) : rejects.length === 0 ? (
              <p style={{ fontSize: '0.875rem', color: '#64748b', margin: 0 }}>
                No rejected rows recorded for this batch.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row #</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Reason Code</TableHead>
                    <TableHead>Error Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rejects.map((rj) => (
                    <TableRow key={rj.id}>
                      <TableCell>{rj.sourceRow}</TableCell>
                      <TableCell>
                        <Badge variant="neutral">{rj.entity}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="danger">{rj.reasonCode}</Badge>
                      </TableCell>
                      <TableCell style={{ fontSize: '0.875rem', color: '#475569' }}>
                        {rj.message}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
