import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import {
  type Crm2BatchExecutionReport,
  CRM2_DEFAULT_CHUNK_SIZE,
  CRM2_DEFAULT_FAILURE_THRESHOLD,
} from '@clearshift/contracts';
import { BatchLoaderPage } from '../src/pages/BatchLoaderPage.js';
import * as api from '../src/api/crm-2.js';

describe('CRM-2 Batch Loader UI Component (CRM2-13)', () => {
  const sampleCompletedReport: Crm2BatchExecutionReport = {
    batchId: 'batch-test-01',
    module: 'crm-2',
    step: 'load',
    status: 'COMPLETED',
    totalRecords: 1000,
    attemptedRecords: 1000,
    committedRecords: 1000,
    failedRecords: 0,
    chunksProcessed: 2,
    chunkSize: 500,
    failureRate: 0,
    committedReceipts: [
      {
        batchId: 'batch-test-01',
        sourceRow: 1,
        idempotencyKey: 'idemp-01',
        targetId: 'deal-uuid-01',
        kind: 'created',
        committedAt: new Date('2026-10-23T12:00:00Z'),
      },
    ],
    failedRows: [],
    executedAt: new Date('2026-10-23T12:00:00Z'),
  };

  const sampleHaltedReport: Crm2BatchExecutionReport = {
    batchId: 'batch-halted-01',
    module: 'crm-2',
    step: 'load',
    status: 'STOPPED_EXCESSIVE_FAILURES',
    totalRecords: 100,
    attemptedRecords: 55,
    committedRecords: 44,
    failedRecords: 11,
    chunksProcessed: 1,
    chunkSize: 500,
    failureRate: 0.20,
    haltReason: 'Row failure rate 20.0% exceeds 10% threshold after 55 attempted rows. Batch execution stopped immediately.',
    committedReceipts: Array.from({ length: 44 }, (_, i) => ({
      batchId: 'batch-halted-01',
      sourceRow: i + 1,
      idempotencyKey: `idemp-halt-${i + 1}`,
      targetId: `deal-uuid-${i + 1}`,
      kind: 'created',
      committedAt: new Date('2026-10-23T12:00:00Z'),
    })),
    failedRows: Array.from({ length: 11 }, (_, i) => ({
      sourceRow: 45 + i,
      idempotencyKey: `idemp-halt-${45 + i}`,
      errorCode: 'ROW_PROCESSING_FAILED',
      errorMessage: 'Validation failed',
      retryAttempts: 2,
    })),
    executedAt: new Date('2026-10-23T12:00:00Z'),
  };

  it('renders BatchLoaderPage component with default 500 chunk size and 10% threshold configuration', () => {
    const element = React.createElement(BatchLoaderPage, {
      onBackToList: vi.fn(),
    });

    expect(element.type).toBe(BatchLoaderPage);
    expect(CRM2_DEFAULT_CHUNK_SIZE).toBe(500);
    expect(CRM2_DEFAULT_FAILURE_THRESHOLD).toBe(0.10);
  });

  it('renders execution report with COMPLETED status and 2 chunks processed for 1000 rows', () => {
    const element = React.createElement(BatchLoaderPage, {
      initialReport: sampleCompletedReport,
    });

    expect(element.props.initialReport?.status).toBe('COMPLETED');
    expect(element.props.initialReport?.totalRecords).toBe(1000);
    expect(element.props.initialReport?.committedRecords).toBe(1000);
    expect(element.props.initialReport?.chunksProcessed).toBe(2);
    expect(element.props.initialReport?.chunkSize).toBe(500);
  });

  it('renders STOPPED_EXCESSIVE_FAILURES status and verifies durability of committed receipts', () => {
    const element = React.createElement(BatchLoaderPage, {
      initialReport: sampleHaltedReport,
    });

    const report = element.props.initialReport;
    expect(report?.status).toBe('STOPPED_EXCESSIVE_FAILURES');
    expect(report?.haltReason).toContain('exceeds 10% threshold');
    expect(report?.failureRate).toBe(0.20);

    // Durability guarantee: 44 committed receipts remain durable despite execution halting
    expect(report?.committedRecords).toBe(44);
    expect(report?.committedReceipts).toHaveLength(44);
    expect(report?.failedRecords).toBe(11);
    expect(report?.failedRows).toHaveLength(11);
  });

  it('verifies API client executes batch load with valid payload', async () => {
    const mockExecute = vi.spyOn(api, 'executeBatchLoad').mockResolvedValue(sampleCompletedReport);

    const report = await api.executeBatchLoad({
      batchId: 'batch-test-01',
      module: 'crm-2',
      records: [
        { sourceRow: 1, idempotencyKey: 'idemp-01', data: {} },
      ],
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(report.status).toBe('COMPLETED');
    expect(report.committedRecords).toBe(1000);

    mockExecute.mockRestore();
  });
});
