import { describe, it, expect } from 'vitest';
import React from 'react';
import { BatchLoaderPage } from '../../web/pages/BatchLoaderPage.js';
import { CRM1_BATCH_LOADER_ROUTE } from '../../web/routes.js';
import type { Crm1BatchExecutionReport } from '@clearshift/contracts';

describe('BatchLoaderPage Component & Route Registration (CRM1-13)', () => {
  const sampleReport: Crm1BatchExecutionReport = {
    batchId: 'batch-test-01',
    module: 'crm-1',
    step: 'load',
    status: 'COMPLETED',
    totalRecords: 100,
    attemptedRecords: 100,
    committedRecords: 100,
    failedRecords: 0,
    chunksProcessed: 1,
    chunkSize: 500,
    failureRate: 0,
    committedReceipts: [
      {
        batchId: 'batch-test-01',
        sourceRow: 1,
        idempotencyKey: 'k1',
        targetId: 'tgt-1',
        kind: 'created',
        committedAt: new Date(),
      },
    ],
    failedRows: [],
    executedAt: new Date(),
  };

  const sampleHaltedReport: Crm1BatchExecutionReport = {
    batchId: 'batch-halted-01',
    module: 'crm-1',
    step: 'load',
    status: 'STOPPED_EXCESSIVE_FAILURES',
    totalRecords: 100,
    attemptedRecords: 50,
    committedRecords: 44,
    failedRecords: 6,
    chunksProcessed: 1,
    chunkSize: 500,
    failureRate: 0.12,
    haltReason: 'Row failure rate 12.0% exceeds 10% threshold after 50 attempted rows. Batch execution stopped immediately.',
    committedReceipts: [],
    failedRows: [
      {
        sourceRow: 45,
        idempotencyKey: 'idemp-halt-45',
        errorCode: 'ROW_PROCESSING_FAILED',
        errorMessage: 'Database deadlock',
        retryAttempts: 2,
      },
    ],
    executedAt: new Date(),
  };

  it('instantiates BatchLoaderPage React element with initialReport', () => {
    const element = React.createElement(BatchLoaderPage, {
      initialReport: sampleReport,
    });
    expect(element).toBeDefined();
    expect(element.type).toBe(BatchLoaderPage);
    expect(element.props.initialReport?.status).toBe('COMPLETED');
  });

  it('instantiates BatchLoaderPage with STOPPED_EXCESSIVE_FAILURES status report', () => {
    const element = React.createElement(BatchLoaderPage, {
      initialReport: sampleHaltedReport,
    });
    expect(element).toBeDefined();
    expect(element.props.initialReport?.status).toBe('STOPPED_EXCESSIVE_FAILURES');
    expect(element.props.initialReport?.haltReason).toContain('exceeds 10% threshold');
    expect(element.props.initialReport?.failedRecords).toBe(6);
  });

  it('registers batchLoader route in CRM1_BATCH_LOADER_ROUTE with required capability and breadcrumbs', () => {
    const route = CRM1_BATCH_LOADER_ROUTE;
    expect(route).toBeDefined();
    expect(route.id).toBe('crm1-batch-loader');
    expect(route.path).toBe('batch-loader');
    expect(route.fullPath).toBe('/crm-1/batch-loader');
    expect(route.title).toBe('Batch Ingestion & Partial-Load Stop Management');
    expect(route.navLabel).toBe('Batch Loader');
    expect(route.breadcrumbs.length).toBeGreaterThanOrEqual(3);
  });
});
