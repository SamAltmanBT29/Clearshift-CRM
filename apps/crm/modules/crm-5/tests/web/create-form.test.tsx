// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import {
  CreateRunForm,
  CreateRunFormSchema,
  CreateRunModal,
  ConfirmationToast,
  FormValidationSummary,
} from '../../web/index.js';
import { DataTableController } from '../../web/table/DataTableController.js';
import { RunsOverviewPage } from '../../web/pages/RunsOverviewPage.js';
import { RUNS_COLUMNS } from '../../web/table/columns.js';

describe('CRM-5 Create Form with Field-Level Validation (Issue #193 / CRM5-20)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. Zod Schema & Field Validation Logic
  // ---------------------------------------------------------------------------
  describe('1. Zod Schema & Field-Level Invariants (CreateRunFormSchema)', () => {
    it('validates required fields, email format, phone numbers, and decimal ranges on valid input', () => {
      const validInput = {
        batchId: 'batch-contacts-20261023-001',
        module: 'crm-1',
        step: 'extract',
        status: 'pending',
        recordsIn: 1000,
        recordsOut: 850,
        recordsRejected: 50,
        operatorEmail: 'lead.analyst@clearshift.internal',
        operatorPhone: '+1-555-0199',
        samplingRate: 0.95,
      };

      const result = CreateRunFormSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.batchId).toBe('batch-contacts-20261023-001');
        expect(result.data.recordsIn).toBe(1000);
        expect(result.data.operatorEmail).toBe('lead.analyst@clearshift.internal');
        expect(result.data.operatorPhone).toBe('+1-555-0199');
        expect(result.data.samplingRate).toBe(0.95);
      }
    });

    it('rejects missing or empty required fields', () => {
      const invalidEmpty = {
        batchId: '',
        module: 'invalid-mod',
        step: 'invalid-step',
        recordsIn: -5,
        recordsOut: -1,
        recordsRejected: -2,
      };

      const result = CreateRunFormSchema.safeParse(invalidEmpty);
      expect(result.success).toBe(false);
      if (!result.success) {
        const fieldErrors = result.error.flatten().fieldErrors;
        expect(fieldErrors.batchId).toContain('batchId is required');
        expect(fieldErrors.recordsIn).toContain('Records In cannot be negative');
        expect(fieldErrors.recordsOut).toContain('Records Out cannot be negative');
        expect(fieldErrors.recordsRejected).toContain('Records Rejected cannot be negative');
      }
    });

    it('rejects batchId exceeding 128 characters', () => {
      const result = CreateRunFormSchema.safeParse({
        batchId: 'a'.repeat(129),
        module: 'crm-1',
        step: 'clean',
        recordsIn: 100,
        recordsOut: 90,
        recordsRejected: 10,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.batchId).toContain(
          'batchId cannot exceed 128 characters'
        );
      }
    });

    it('validates email format strictly', () => {
      const invalidEmails = ['plainaddress', 'missingdomain@', '@nodomain.com', 'bad@domain@domain.com'];
      for (const email of invalidEmails) {
        const res = CreateRunFormSchema.safeParse({
          batchId: 'batch-001',
          module: 'crm-2',
          step: 'profile',
          recordsIn: 50,
          recordsOut: 40,
          recordsRejected: 5,
          operatorEmail: email,
        });
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.error.flatten().fieldErrors.operatorEmail).toContain(
            'Invalid email address format'
          );
        }
      }

      // Valid email passes
      const validRes = CreateRunFormSchema.safeParse({
        batchId: 'batch-001',
        module: 'crm-2',
        step: 'profile',
        recordsIn: 50,
        recordsOut: 40,
        recordsRejected: 5,
        operatorEmail: 'operator@company.org',
      });
      expect(validRes.success).toBe(true);
    });

    it('validates phone number format strictly', () => {
      const invalidPhones = ['abc', '123', 'bad-phone', '++11'];
      for (const phone of invalidPhones) {
        const res = CreateRunFormSchema.safeParse({
          batchId: 'batch-001',
          module: 'crm-3',
          step: 'clean',
          recordsIn: 50,
          recordsOut: 40,
          recordsRejected: 5,
          operatorPhone: phone,
        });
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.error.flatten().fieldErrors.operatorPhone).toContain(
            'Invalid phone number format'
          );
        }
      }

      // Valid phone numbers pass
      const validPhones = ['+1-555-0199', '+44 20 7946 0991', '555-123-4567', '+91 98765 43210'];
      for (const phone of validPhones) {
        const validRes = CreateRunFormSchema.safeParse({
          batchId: 'batch-001',
          module: 'crm-3',
          step: 'clean',
          recordsIn: 50,
          recordsOut: 40,
          recordsRejected: 5,
          operatorPhone: phone,
        });
        expect(validRes.success).toBe(true);
      }
    });

    it('validates decimal ranges strictly between 0.00 and 1.00', () => {
      const invalidRanges = [-0.01, 1.01, 2.5, -5];
      for (const rate of invalidRanges) {
        const res = CreateRunFormSchema.safeParse({
          batchId: 'batch-001',
          module: 'crm-4',
          step: 'map',
          recordsIn: 50,
          recordsOut: 40,
          recordsRejected: 5,
          samplingRate: rate,
        });
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.error.flatten().fieldErrors.samplingRate).toContain(
            'Value must be a decimal between 0.00 and 1.00'
          );
        }
      }

      // Valid decimal rates pass
      const validRates = [0.0, 0.5, 0.85, 1.0];
      for (const rate of validRates) {
        const validRes = CreateRunFormSchema.safeParse({
          batchId: 'batch-001',
          module: 'crm-4',
          step: 'map',
          recordsIn: 50,
          recordsOut: 40,
          recordsRejected: 5,
          samplingRate: rate,
        });
        expect(validRes.success).toBe(true);
      }
    });

    it('enforces conservation invariant (recordsOut + recordsRejected <= recordsIn)', () => {
      // Invariant violated: 80 + 30 = 110 > 100
      const violatedRes = CreateRunFormSchema.safeParse({
        batchId: 'batch-001',
        module: 'crm-5',
        step: 'load',
        recordsIn: 100,
        recordsOut: 80,
        recordsRejected: 30,
      });

      expect(violatedRes.success).toBe(false);
      if (!violatedRes.success) {
        const fieldErrors = violatedRes.error.flatten().fieldErrors;
        expect(fieldErrors.recordsOut).toContain(
          'Invariant violation: sum of recordsOut and recordsRejected cannot exceed recordsIn'
        );
      }

      // Invariant satisfied: 80 + 20 = 100 <= 100
      const validRes = CreateRunFormSchema.safeParse({
        batchId: 'batch-001',
        module: 'crm-5',
        step: 'load',
        recordsIn: 100,
        recordsOut: 80,
        recordsRejected: 20,
      });
      expect(validRes.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. CreateRunForm Component Rendering & Double-Submit Prevention
  // ---------------------------------------------------------------------------
  describe('2. CreateRunForm Component Rendering & Controls', () => {
    it('renders form fields with semantic labels, required asterisks, and inputs', () => {
      const onSubmit = vi.fn().mockResolvedValue({});
      render(
        <CreateRunForm
          onSubmit={onSubmit}
          initialValues={{
            batchId: 'batch-test-001',
            module: 'crm-1',
            recordsIn: 500,
            recordsOut: 450,
            recordsRejected: 20,
          }}
        />
      );

      const batchInput = screen.getByLabelText(/Batch Correlation ID/i);
      expect(batchInput).toBeDefined();
      expect((batchInput as HTMLInputElement).value).toBe('batch-test-001');

      const submitBtn = screen.getByRole('button', { name: /Record Migration Run/i });
      expect(submitBtn).toBeDefined();
      expect(submitBtn.hasAttribute('disabled')).toBe(false);
    });

    it('validates fields and shows error messages when submitted with invalid inputs', async () => {
      const onSubmit = vi.fn();
      render(
        <CreateRunForm
          onSubmit={onSubmit}
          initialValues={{
            batchId: '',
            recordsIn: 100,
            recordsOut: 90,
            recordsRejected: 20, // 90 + 20 = 110 > 100 invariant violation
            operatorEmail: 'not-an-email',
            operatorPhone: '123',
            samplingRate: 1.5,
          }}
        />
      );

      const submitBtn = screen.getByRole('button', { name: /Record Migration Run/i });
      fireEvent.click(submitBtn);

      expect(onSubmit).not.toHaveBeenCalled();

      // Batch ID error
      expect(screen.getByText(/❌ batchId is required/i)).toBeDefined();

      // Invariant error
      expect(
        screen.getByText(/❌ Invariant violation: sum of recordsOut and recordsRejected cannot exceed recordsIn/i)
      ).toBeDefined();

      // Email format error
      expect(screen.getByText(/❌ Invalid email address format/i)).toBeDefined();

      // Phone format error
      expect(screen.getByText(/❌ Invalid phone number format/i)).toBeDefined();

      // Decimal range error
      expect(screen.getByText(/❌ Value must be a decimal between 0.00 and 1.00/i)).toBeDefined();
    });

    it('disables submission button during inflight request to prevent double-submit', async () => {
      let resolveSubmit: (val: unknown) => void = () => {};
      const pendingPromise = new Promise((resolve) => {
        resolveSubmit = resolve;
      });
      const onSubmit = vi.fn().mockReturnValue(pendingPromise);

      render(
        <CreateRunForm
          onSubmit={onSubmit}
          initialValues={{
            batchId: 'batch-inflight-001',
            module: 'crm-1',
            step: 'load',
            recordsIn: 100,
            recordsOut: 80,
            recordsRejected: 10,
          }}
        />
      );

      const submitBtn = screen.getByRole('button', { name: /Record Migration Run/i });
      fireEvent.click(submitBtn);

      expect(onSubmit).toHaveBeenCalledTimes(1);

      // Submit button should now be disabled during inflight
      expect(submitBtn.hasAttribute('disabled')).toBe(true);
      expect(submitBtn.textContent).toContain('Recording Run...');

      // Subsequent clicks should NOT trigger onSubmit again
      fireEvent.click(submitBtn);
      fireEvent.click(submitBtn);
      expect(onSubmit).toHaveBeenCalledTimes(1);

      // Resolve the pending promise
      resolveSubmit({});
      await waitFor(() => {
        expect(submitBtn.hasAttribute('disabled')).toBe(false);
      });
    });

    it('displays server validation errors (400) directly on corresponding input fields', () => {
      const serverFieldErrors = {
        batchId: 'Correlation identifier already recorded in partition',
        recordsOut: 'Invariant violation: recordsOut exceeds partition maximum',
        operatorEmail: 'Email domain not permitted for migration alerts',
      };

      render(
        <CreateRunForm
          onSubmit={vi.fn()}
          serverError="400 Bad Request: Partition constraint violation"
          serverFieldErrors={serverFieldErrors}
        />
      );

      // Verification of Error Summary Banner
      expect(screen.getByText(/400 Bad Request/i)).toBeDefined();
      expect(
        screen.getAllByText(/Correlation identifier already recorded in partition/i)
      ).toHaveLength(2);

      // Direct field-level error mapping
      expect(
        screen.getByText(/❌ Correlation identifier already recorded in partition/i)
      ).toBeDefined();
      expect(
        screen.getByText(/❌ Invariant violation: recordsOut exceeds partition maximum/i)
      ).toBeDefined();
      expect(
        screen.getByText(/❌ Email domain not permitted for migration alerts/i)
      ).toBeDefined();

      // aria-invalid applied to inputs
      const batchInput = screen.getByLabelText(/Batch Correlation ID/i);
      expect(batchInput.getAttribute('aria-invalid')).toBe('true');
    });

    it('handles server rejection 400 with standard ClearShift error envelope and maps to fields', async () => {
      const serverEnvelopeError = {
        statusCode: 400,
        message: 'Request payload validation failed',
        details: [
          { path: ['batchId'], message: 'Batch correlation ID already registered' },
          { path: ['operatorPhone'], message: 'Phone country prefix unverified' },
        ],
      };

      const onSubmit = vi.fn().mockRejectedValue(serverEnvelopeError);

      render(
        <CreateRunForm
          onSubmit={onSubmit}
          initialValues={{
            batchId: 'batch-dup-001',
            module: 'crm-2',
            step: 'extract',
            recordsIn: 100,
            recordsOut: 80,
            recordsRejected: 10,
            operatorPhone: '+1-555-0199',
          }}
        />
      );

      const submitBtn = screen.getByRole('button', { name: /Record Migration Run/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText(/❌ Batch correlation ID already registered/i)).toBeDefined();
        expect(screen.getByText(/❌ Phone country prefix unverified/i)).toBeDefined();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 3. FormValidationSummary Component
  // ---------------------------------------------------------------------------
  describe('3. FormValidationSummary Component', () => {
    it('renders accessible alert banner with role="alert" and aria-live="polite"', () => {
      render(
        <FormValidationSummary
          title="Validation errors prevented submission:"
          errors={{
            batchId: 'batchId is required',
            recordsIn: 'Records In cannot be negative',
          }}
        />
      );

      const alertBanner = screen.getByRole('alert');
      expect(alertBanner).toBeDefined();
      expect(alertBanner.getAttribute('aria-live')).toBe('polite');
      expect(alertBanner.className).toContain('cs-form-validation-summary');
      expect(screen.getByText(/batchId is required/i)).toBeDefined();
      expect(screen.getByText(/Records In cannot be negative/i)).toBeDefined();
    });

    it('renders null when zero errors exist', () => {
      const { container } = render(
        <FormValidationSummary errors={{}} />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. ConfirmationToast Component
  // ---------------------------------------------------------------------------
  describe('4. ConfirmationToast Component', () => {
    it('renders toast with role="status" and aria-live="polite"', () => {
      render(
        <ConfirmationToast
          show={true}
          title="Run Recorded"
          message="Migration run projection was successfully created."
          type="success"
        />
      );

      const toast = screen.getByRole('status');
      expect(toast).toBeDefined();
      expect(toast.getAttribute('aria-live')).toBe('polite');
      expect(toast.className).toContain('cs-toast-success');
      expect(screen.getByText(/Run Recorded/i)).toBeDefined();
      expect(
        screen.getByText(/Migration run projection was successfully created./i)
      ).toBeDefined();
    });

    it('renders null when show is false', () => {
      const { container } = render(
        <ConfirmationToast show={false} message="Hidden toast" />
      );
      expect(container.firstChild).toBeNull();
    });

    it('triggers onDismiss callback after autoDismissMs timer expires', () => {
      vi.useFakeTimers();
      const onDismiss = vi.fn();
      render(
        <ConfirmationToast
          show={true}
          message="Auto dismiss test"
          onDismiss={onDismiss}
          autoDismissMs={3000}
        />
      );

      expect(onDismiss).not.toHaveBeenCalled();
      vi.advanceTimersByTime(3000);
      expect(onDismiss).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('allows manual dismissal via close button', () => {
      const onDismiss = vi.fn();
      render(
        <ConfirmationToast
          show={true}
          message="Manual dismiss test"
          onDismiss={onDismiss}
        />
      );

      const closeBtn = screen.getByRole('button', { name: /Dismiss notification/i });
      fireEvent.click(closeBtn);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. CreateRunModal Component
  // ---------------------------------------------------------------------------
  describe('5. CreateRunModal Component', () => {
    it('renders modal dialog with role="dialog" and aria-modal="true"', () => {
      const onClose = vi.fn();
      const onSubmit = vi.fn();
      render(
        <CreateRunModal
          isOpen={true}
          onClose={onClose}
          onSubmit={onSubmit}
          title="Record Migration Run Projection"
        />
      );

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeDefined();
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(screen.getByText(/Record Migration Run Projection/i)).toBeDefined();
    });

    it('renders null when isOpen is false', () => {
      const { container } = render(
        <CreateRunModal
          isOpen={false}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it('closes on close button click and escape key', () => {
      const onClose = vi.fn();
      render(
        <CreateRunModal
          isOpen={true}
          onClose={onClose}
          onSubmit={vi.fn()}
        />
      );

      const closeBtn = screen.getByRole('button', { name: /Close dialog/i });
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('closes on backdrop overlay click', () => {
      const onClose = vi.fn();
      render(
        <CreateRunModal
          isOpen={true}
          onClose={onClose}
          onSubmit={vi.fn()}
        />
      );

      const backdrop = screen.getByTestId('create-run-modal-backdrop');
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes modal and triggers onSuccess callback upon successful form submit', async () => {
      const onClose = vi.fn();
      const onSuccess = vi.fn();
      const createdRecord = { id: 'created-1', batchId: 'batch-success-01' };
      const onSubmit = vi.fn().mockResolvedValue(createdRecord);

      render(
        <CreateRunModal
          isOpen={true}
          onClose={onClose}
          onSubmit={onSubmit}
          onSuccess={onSuccess}
          initialValues={{
            batchId: 'batch-success-01',
            module: 'crm-1',
            step: 'extract',
            recordsIn: 100,
            recordsOut: 80,
            recordsRejected: 10,
          }}
        />
      );

      const submitBtn = screen.getByRole('button', { name: /Record Migration Run/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
        expect(onSuccess).toHaveBeenCalledWith(createdRecord);
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Table Cache Updating via DataTableController
  // ---------------------------------------------------------------------------
  describe('6. Table Cache Updating (DataTableController Cache Methods)', () => {
    it('initializes empty cache and populates with setCachedData', () => {
      const controller = new DataTableController({
        columns: RUNS_COLUMNS,
      });

      expect(controller.getCachedData()).toEqual([]);
      expect(controller.getPagination().total).toBe(0);

      const sampleRuns = [
        { id: '1', batchId: 'batch-001', module: 'crm-1', status: 'running' },
        { id: '2', batchId: 'batch-002', module: 'crm-2', status: 'completed' },
      ];

      controller.setCachedData(sampleRuns);
      expect(controller.getCachedData()).toHaveLength(2);
      expect(controller.getPagination().total).toBe(2);
    });

    it('prepends newly created record to cache and increments total count', () => {
      const controller = new DataTableController({
        columns: RUNS_COLUMNS,
      });

      controller.setCachedData([
        { id: '1', batchId: 'batch-001', module: 'crm-1', status: 'completed' },
      ]);

      const newRun = {
        id: 'new-999',
        batchId: 'batch-new-created',
        module: 'crm-3',
        status: 'pending',
        recordsIn: 100,
        recordsOut: 90,
        recordsRejected: 5,
      };

      controller.addRecordToCache(newRun);

      const cached = controller.getCachedData();
      expect(cached).toHaveLength(2);
      expect(cached[0]).toEqual(newRun);
      expect(controller.getPagination().total).toBe(2);
    });

    it('updates existing record in cache by id or batchId', () => {
      const controller = new DataTableController({
        columns: RUNS_COLUMNS,
      });

      controller.setCachedData([
        { id: 'rec-1', batchId: 'batch-001', status: 'pending', recordsOut: 0 },
      ]);

      controller.updateRecordInCache('rec-1', { status: 'completed', recordsOut: 100 });

      const updated = controller.getCachedData();
      expect(updated[0]).toEqual(
        expect.objectContaining({
          id: 'rec-1',
          status: 'completed',
          recordsOut: 100,
        })
      );
    });

    it('removes record from cache and decrements total count', () => {
      const controller = new DataTableController({
        columns: RUNS_COLUMNS,
      });

      controller.setCachedData([
        { id: 'rec-1', batchId: 'batch-001' },
        { id: 'rec-2', batchId: 'batch-002' },
      ]);

      controller.removeRecordFromCache('rec-1');
      expect(controller.getCachedData()).toHaveLength(1);
      expect(controller.getPagination().total).toBe(1);
      expect(controller.getCachedData()[0]).toEqual(
        expect.objectContaining({ id: 'rec-2' })
      );
    });

    it('clears cache and resets total to 0', () => {
      const controller = new DataTableController({
        columns: RUNS_COLUMNS,
      });

      controller.setCachedData([{ id: 'rec-1' }, { id: 'rec-2' }]);
      controller.clearCache();
      expect(controller.getCachedData()).toEqual([]);
      expect(controller.getPagination().total).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Full Workflow Integration with RunsOverviewPage
  // ---------------------------------------------------------------------------
  describe('7. RunsOverviewPage Integration with Create Modal & Toast', () => {
    it('renders primary + Record Migration Run button in header', () => {
      const { container } = render(<RunsOverviewPage />);

      const createBtn = container.querySelector('.cs-create-run-btn');
      expect(createBtn).toBeDefined();
      expect(createBtn?.textContent).toContain('+ Record Migration Run');
    });

    it('opens modal on clicking primary action and empty action button', () => {
      const { container } = render(<RunsOverviewPage isEmpty={true} />);

      const createBtn = container.querySelector('.cs-create-run-btn');
      expect(createBtn).not.toBeNull();
      fireEvent.click(createBtn!);

      expect(screen.getByRole('dialog')).toBeDefined();
    });

    it('successfully creates run, closes modal, updates table rows, and shows confirmation toast', async () => {
      const onCreateRun = vi.fn().mockImplementation(async (data) => ({
        id: 'new-run-uuid-001',
        batchId: data.batchId,
        module: data.module,
        step: data.step,
        status: data.status,
        recordsIn: data.recordsIn,
        recordsOut: data.recordsOut,
        recordsRejected: data.recordsRejected,
      }));

      const onRunCreated = vi.fn();

      const { container } = render(
        <RunsOverviewPage
          onCreateRun={onCreateRun}
          onRunCreated={onRunCreated}
        />
      );

      // Open Modal via primary header button
      const openBtn = container.querySelector('.cs-create-run-btn');
      expect(openBtn).not.toBeNull();
      fireEvent.click(openBtn!);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeDefined();

      // Fill in required fields
      const batchInput = screen.getByLabelText(/Batch Correlation ID/i);
      fireEvent.change(batchInput, { target: { value: 'batch-integration-01' } });

      const recordsInInput = screen.getByLabelText(/Records In/i);
      fireEvent.change(recordsInInput, { target: { value: '250' } });

      const recordsOutInput = screen.getByLabelText(/Records Out/i);
      fireEvent.change(recordsOutInput, { target: { value: '200' } });

      const recordsRejectedInput = screen.getByLabelText(/Records Rejected/i);
      fireEvent.change(recordsRejectedInput, { target: { value: '25' } });

      // Submit Form
      const submitBtn = container.querySelector('.cs-form-submit-btn');
      expect(submitBtn).not.toBeNull();
      fireEvent.click(submitBtn!);

      // Modal closes, onRunCreated triggered, confirmation toast displayed
      await waitFor(() => {
        expect(onCreateRun).toHaveBeenCalled();
        expect(onRunCreated).toHaveBeenCalledWith(
          expect.objectContaining({ batchId: 'batch-integration-01' })
        );
        expect(screen.queryByRole('dialog')).toBeNull();
      });

      // Toast is visible
      const toast = screen.getByTestId('confirmation-toast');
      expect(toast).toBeDefined();
      expect(toast.textContent).toContain(
        "Migration run projection for batch 'batch-integration-01' was successfully created."
      );

      // Table displays the newly recorded row
      expect(screen.getByText('batch-integration-01')).toBeDefined();
    });
  });
});
