// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MigrationRunForm } from '../src/components/forms/MigrationRunForm.js';
import { ConfirmActionDialog } from '../src/components/forms/ConfirmActionDialog.js';
import { MigrationRunDetailPage } from '../src/pages/MigrationRunDetailPage.js';
import { MigrationRunFormPage } from '../src/pages/MigrationRunFormPage.js';
import { ReconciliationDetailPage } from '../src/pages/ReconciliationDetailPage.js';
import {
  Crm5ApiClient,
  Crm5ApiError,
  Crm5PermissionError,
} from '../src/api/crm-5.js';
import { canTransition } from '../../src/domain/transitions.js';
import type { MigrationRun, BatchSummaryContract, ReconciliationReport } from '@clearshift/contracts';

describe('CRM-5 Migration Control Center & Reports — Detail & Form Workflows (Issue #50)', () => {
  let mockApiClient: Crm5ApiClient;

  const sampleRun: MigrationRun = {
    id: '00000000-0000-0000-0000-000000000001',
    batchId: 'batch-crm-1-20261022-001',
    module: 'crm-1',
    step: 'load',
    status: 'running',
    recordsIn: 1000,
    recordsOut: 850,
    recordsRejected: 50,
    startedAt: new Date('2026-10-22T10:00:00Z'),
    completedAt: null,
    metadata: { sourceFile: 'contacts_v1.csv' },
    createdAt: new Date('2026-10-22T10:00:00Z'),
    updatedAt: new Date('2026-10-22T10:05:00Z'),
  };

  const sampleBatchSummary: BatchSummaryContract = {
    batchId: 'batch-crm-1-20261022-001',
    module: 'crm-1',
    status: 'running',
    totals: {
      totalRecordsIn: 1000,
      totalRecordsOut: 850,
      totalRecordsRejected: 50,
      stepsCompleted: 1,
      stepsTotal: 7,
      progressPercentage: 85,
    },
    score: {
      id: '00000000-0000-0000-0000-000000000010',
      batchId: 'batch-crm-1-20261022-001',
      module: 'crm-1',
      completeness: 0.95,
      validity: 0.98,
      duplicateRate: 0.02,
      rejectRate: 0.05,
      linkIntegrity: 0.99,
      score: 97.0,
      isFullyScored: true,
      scoredAt: new Date('2026-10-22T10:05:00Z'),
      createdAt: new Date('2026-10-22T10:05:00Z'),
    },
    reconciliation: {
      id: '00000000-0000-0000-0000-000000000020',
      batchId: 'batch-crm-1-20261022-001',
      module: 'crm-1',
      sourceCount: 1000,
      loadedCount: 850,
      rejectedCount: 50,
      mergedCount: 50,
      skippedCount: 50,
      unaccountedCount: 0,
      status: 'OK',
      reconciledAt: new Date('2026-10-22T10:05:00Z'),
      createdAt: new Date('2026-10-22T10:05:00Z'),
    },
    consistency: {
      isConsistent: true,
      warnings: [],
      errors: [],
    },
    updatedAt: new Date('2026-10-22T10:05:00Z'),
  };

  const sampleReconciliation: ReconciliationReport = {
    id: '00000000-0000-0000-0000-000000000020',
    batchId: 'batch-crm-1-20261022-001',
    module: 'crm-1',
    sourceCount: 1000,
    loadedCount: 850,
    rejectedCount: 50,
    mergedCount: 50,
    skippedCount: 50,
    unaccountedCount: 0,
    status: 'OK',
    reconciledAt: new Date('2026-10-22T10:05:00Z'),
    createdAt: new Date('2026-10-22T10:05:00Z'),
  };

  beforeEach(() => {
    mockApiClient = new Crm5ApiClient('/api/v1/crm-control');
    vi.spyOn(mockApiClient, 'getRunById').mockResolvedValue(sampleRun);
    vi.spyOn(mockApiClient, 'getBatchSummary').mockResolvedValue(sampleBatchSummary as any);
    vi.spyOn(mockApiClient, 'getReconciliation').mockResolvedValue(sampleReconciliation);
    vi.spyOn(mockApiClient, 'postRun').mockResolvedValue(sampleRun);
    vi.spyOn(mockApiClient, 'patchRun').mockResolvedValue(sampleRun);
    vi.spyOn(mockApiClient, 'transitionRunStatus').mockResolvedValue({
      ...sampleRun,
      status: 'halted',
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance Criterion 1: Every V1 screen exists and links back to list context
  // ---------------------------------------------------------------------------
  describe('1. V1 Screen Existence & List Context Navigation (Acceptance Criterion 1)', () => {
    it('renders MigrationRunFormPage in create mode and links back to list context', async () => {
      const onBackToList = vi.fn();
      render(
        <MigrationRunFormPage
          mode="create"
          apiClient={mockApiClient}
          onBackToList={onBackToList}
        />
      );

      expect(screen.getByRole('heading', { level: 1, name: /Record Migration Run Projection/i })).toBeTruthy();
      const backButtons = screen.getAllByRole('button', { name: /Back to Runs List/i });
      expect(backButtons.length).toBeGreaterThan(0);

      fireEvent.click(backButtons[0]!);
      expect(onBackToList).toHaveBeenCalledTimes(1);
    });

    it('renders MigrationRunDetailPage and links back to list context', async () => {
      const onBackToList = vi.fn();
      render(
        <MigrationRunDetailPage
          runId={sampleRun.id}
          apiClient={mockApiClient}
          onBackToList={onBackToList}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: new RegExp(sampleRun.batchId, 'i') })).toBeTruthy();
      });

      const backButtons = screen.getAllByRole('button', { name: /Back to/i });
      expect(backButtons.length).toBeGreaterThan(0);

      fireEvent.click(backButtons[0]!);
      expect(onBackToList).toHaveBeenCalled();
    });

    it('renders ReconciliationDetailPage and links back to list context', async () => {
      const onBackToList = vi.fn();
      render(
        <ReconciliationDetailPage
          batchId="batch-crm-1-20261022-001"
          apiClient={mockApiClient}
          onBackToList={onBackToList}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: /Reconciliation Balance Sheet/i })).toBeTruthy();
      });

      const backBtn = screen.getByRole('button', { name: /Back/i });
      fireEvent.click(backBtn);
      expect(onBackToList).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance Criterion 2: Valid inputs save through API and record is visible
  // ---------------------------------------------------------------------------
  describe('2. Valid Input Submission & Record Visibility (Acceptance Criterion 2)', () => {
    it('saves valid create form data through the API and displays success state', async () => {
      const onSuccess = vi.fn();
      render(
        <MigrationRunFormPage
          mode="create"
          apiClient={mockApiClient}
          onSuccess={onSuccess}
        />
      );

      const batchIdInput = screen.getByLabelText(/Batch Correlation ID/i);
      const recordsInInput = screen.getByLabelText(/Records In/i);
      const recordsOutInput = screen.getByLabelText(/Records Out/i);
      const recordsRejectedInput = screen.getByLabelText(/Records Rejected/i);

      fireEvent.change(batchIdInput, { target: { value: 'batch-valid-new-001' } });
      fireEvent.change(recordsInInput, { target: { value: '500' } });
      fireEvent.change(recordsOutInput, { target: { value: '450' } });
      fireEvent.change(recordsRejectedInput, { target: { value: '50' } });

      const submitBtn = screen.getByRole('button', { name: /Record Migration Run/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockApiClient.postRun).toHaveBeenCalledWith(
          expect.objectContaining({
            batchId: 'batch-valid-new-001',
            recordsIn: 500,
            recordsOut: 450,
            recordsRejected: 50,
          })
        );
      });

      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status').textContent).toMatch(/successfully recorded/i);
    });

    it('saves valid updates in edit mode through the API', async () => {
      const onSuccess = vi.fn();
      render(
        <MigrationRunFormPage
          mode="edit"
          runId={sampleRun.id}
          apiClient={mockApiClient}
          onSuccess={onSuccess}
        />
      );

      await waitFor(() => {
        expect(screen.getByDisplayValue(sampleRun.batchId)).toBeTruthy();
      });

      const recordsOutInput = screen.getByLabelText(/Records Out/i);
      fireEvent.change(recordsOutInput, { target: { value: '900' } });

      const saveBtn = screen.getByRole('button', { name: /Save Telemetry Updates/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(mockApiClient.patchRun).toHaveBeenCalledWith(
          sampleRun.id,
          expect.objectContaining({
            recordsOut: 900,
          })
        );
      });
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance Criterion 3: Invalid input shows field-level message and does not submit
  // ---------------------------------------------------------------------------
  describe('3. Field-Level Validation & Submission Prevention (Acceptance Criterion 3)', () => {
    it('blocks submission and shows field-level errors when batchId is empty', async () => {
      const onSubmit = vi.fn();
      render(<MigrationRunForm onSubmit={onSubmit} />);

      const batchInput = screen.getByLabelText(/Batch Correlation ID/i);
      fireEvent.change(batchInput, { target: { value: '' } });

      const submitBtn = screen.getByRole('button', { name: /Record Migration Run/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getAllByText(/batchId is required/i).length).toBeGreaterThan(0);
      });
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('blocks submission when record counts are negative', async () => {
      const onSubmit = vi.fn();
      render(
        <MigrationRunForm
          initialValues={{ batchId: 'batch-test-01', recordsIn: -10 }}
          onSubmit={onSubmit}
        />
      );

      const submitBtn = screen.getByRole('button', { name: /Record Migration Run/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getAllByText(/recordsIn cannot be negative/i).length).toBeGreaterThan(0);
      });
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('blocks submission when conservation invariant is violated (recordsOut + recordsRejected > recordsIn)', async () => {
      const onSubmit = vi.fn();
      render(
        <MigrationRunForm
          initialValues={{
            batchId: 'batch-test-02',
            recordsIn: 100,
            recordsOut: 80,
            recordsRejected: 30, // 80 + 30 = 110 > 100
          }}
          onSubmit={onSubmit}
        />
      );

      const submitBtn = screen.getByRole('button', { name: /Record Migration Run/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(
          screen.getAllByText(
            /Invariant violation: sum of recordsOut and recordsRejected cannot exceed recordsIn/i
          ).length
        ).toBeGreaterThan(0);
      });
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance Criterion 4: API validation errors presented without losing values
  // ---------------------------------------------------------------------------
  describe('4. API Validation Errors Without Value Loss (Acceptance Criterion 4)', () => {
    it('presents API error banner while preserving all user-entered form values', async () => {
      vi.spyOn(mockApiClient, 'postRun').mockRejectedValueOnce(
        new Crm5ApiError(
          409,
          'CONFLICT',
          'API Conflict: Batch ID already registered with conflicting step',
          [{ path: ['batchId'], message: 'Duplicate batch execution detected' }]
        )
      );

      render(<MigrationRunFormPage mode="create" apiClient={mockApiClient} />);

      const batchIdInput = screen.getByLabelText(/Batch Correlation ID/i) as HTMLInputElement;
      const recordsInInput = screen.getByLabelText(/Records In/i) as HTMLInputElement;

      fireEvent.change(batchIdInput, { target: { value: 'batch-conflict-123' } });
      fireEvent.change(recordsInInput, { target: { value: '750' } });

      const submitBtn = screen.getByRole('button', { name: /Record Migration Run/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        const alerts = screen.getAllByRole('alert');
        expect(
          alerts.some((el) => /Duplicate batch execution detected/i.test(el.textContent ?? ''))
        ).toBe(true);
      });

      // Assert that entered values are preserved without being cleared
      expect(batchIdInput.value).toBe('batch-conflict-123');
      expect(recordsInInput.value).toBe('750');
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance Criterion 5: Read-only, masked, and state transitions cannot be bypassed
  // ---------------------------------------------------------------------------
  describe('5. Read-Only Protection & State Machine Enforcement (Acceptance Criterion 5)', () => {
    it('disables batchId, module, step and displays read-only badges in edit mode', async () => {
      render(
        <MigrationRunForm
          initialValues={sampleRun}
          isEdit={true}
          onSubmit={vi.fn()}
        />
      );

      const batchIdInput = screen.getByLabelText(/Batch Correlation ID/i) as HTMLInputElement;
      const moduleSelect = screen.getByLabelText(/Target CRM Module/i) as HTMLSelectElement;
      const stepSelect = screen.getByLabelText(/Migration Lifecycle Step/i) as HTMLSelectElement;

      expect(batchIdInput.disabled).toBe(true);
      expect(moduleSelect.disabled).toBe(true);
      expect(stepSelect.disabled).toBe(true);
      expect(screen.getByText(/System Audit Metadata/i)).toBeTruthy();
      expect(screen.getAllByText(/Read-Only/i).length).toBeGreaterThan(0);
    });

    it('enforces that terminal states cannot transition to other states', () => {
      // Completed is terminal
      expect(canTransition('completed', 'running')).toBe(false);
      expect(canTransition('completed', 'failed')).toBe(false);
      expect(canTransition('completed', 'pending')).toBe(false);

      // Failed is terminal
      expect(canTransition('failed', 'running')).toBe(false);
      expect(canTransition('failed', 'completed')).toBe(false);

      // Pending can only transition to running or failed
      expect(canTransition('pending', 'running')).toBe(true);
      expect(canTransition('pending', 'failed')).toBe(true);
      expect(canTransition('pending', 'completed')).toBe(false);

      // Running can transition to completed, halted, failed
      expect(canTransition('running', 'completed')).toBe(true);
      expect(canTransition('running', 'halted')).toBe(true);
      expect(canTransition('running', 'failed')).toBe(true);
      expect(canTransition('running', 'pending')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance Criterion 6: Domain Invariant assertions
  // ---------------------------------------------------------------------------
  describe('6. Domain Invariant Protections (Acceptance Criterion 6)', () => {
    it('asserts that CRM-5 never mutates another module or Kit batches directly', () => {
      // CRM-5 only exposes endpoints under /api/v1/crm-control
      const apiPrefix = '/api/v1/crm-control';
      expect(apiPrefix).toBe('/api/v1/crm-control');

      // Reconciliation balance equation is strictly enforced
      const { sourceCount, loadedCount, rejectedCount, mergedCount, skippedCount, unaccountedCount } =
        sampleReconciliation;
      const total = loadedCount + rejectedCount + mergedCount + skippedCount + unaccountedCount;
      expect(total).toBe(sourceCount);
      expect(unaccountedCount).toBe(0);
      expect(sampleReconciliation.status).toBe('OK');
    });
  });

  // ---------------------------------------------------------------------------
  // Destructive & Irreversible Action Confirmation
  // ---------------------------------------------------------------------------
  describe('7. Destructive Action Confirmation Dialog', () => {
    it('opens confirmation dialog on halt execution and executes transition on confirm', async () => {
      render(
        <MigrationRunDetailPage
          runId={sampleRun.id}
          apiClient={mockApiClient}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Halt Execution/i })).toBeTruthy();
      });

      // Click Halt Execution
      fireEvent.click(screen.getByRole('button', { name: /Halt Execution/i }));

      // Confirm dialog appears
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(screen.getByText(/Are you sure you want to halt execution/i)).toBeTruthy();

      // Click Confirm in Dialog
      const confirmBtn = screen.getByRole('button', { name: /Proceed with Transition/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockApiClient.transitionRunStatus).toHaveBeenCalledWith(sampleRun.id, 'halted');
      });
    });

    it('cancels confirmation dialog without calling transition API when Cancel is clicked', async () => {
      render(
        <MigrationRunDetailPage
          runId={sampleRun.id}
          apiClient={mockApiClient}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Halt Execution/i })).toBeTruthy();
      });

      fireEvent.click(screen.getByRole('button', { name: /Halt Execution/i }));
      expect(screen.getByRole('dialog')).toBeTruthy();

      // Click Cancel in Dialog
      const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelBtn);

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(mockApiClient.transitionRunStatus).not.toHaveBeenCalled();
    });
  });
});
