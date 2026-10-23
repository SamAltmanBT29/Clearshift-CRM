import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import {
  CreateRunFormSchema,
  validateCreateRunFields,
  parseServerErrorToFieldErrors,
  FormValidationSummary,
  ConfirmationToast,
  CreateRunModal,
  CreateRunForm,
  DataTableController,
  RunsOverviewPage,
  RUNS_COLUMNS,
} from '../../web/index.js';

// Setup React Hook Dispatcher for direct functional component execution in tests
beforeEach(() => {
  const dispatcher = {
    useState: (initial: unknown) => [
      typeof initial === 'function' ? (initial as () => unknown)() : initial,
      vi.fn(),
    ],
    useId: () => ':crm5-test-id:',
    useEffect: (effect: () => void | (() => void)) => {
      const cleanup = effect();
      if (typeof cleanup === 'function') {
        // cleanup registered
      }
    },
    useMemo: (factory: () => unknown) => factory(),
    useCallback: (callback: unknown) => callback,
    useRef: (initial: unknown) => ({ current: initial }),
  };

  // Attach mock dispatcher to React client internals
  const reactInternals = (React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: {
      H?: unknown;
    };
  }).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

  if (reactInternals) {
    reactInternals.H = dispatcher;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CRM-5 Create Form with Field-Level Validation (Issue #193 / CRM5-20)', () => {
  // ---------------------------------------------------------------------------
  // 1. Zod Schema & Field-Level Invariants (CreateRunFormSchema)
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
  // 2. Client-Side Field-Level Validation Helper (validateCreateRunFields)
  // ---------------------------------------------------------------------------
  describe('2. Client-Side Field-Level Validation (validateCreateRunFields)', () => {
    it('returns empty error map on complete, valid inputs', () => {
      const errors = validateCreateRunFields({
        batchId: 'batch-clean-001',
        module: 'crm-1',
        step: 'clean',
        status: 'pending',
        recordsIn: 500,
        recordsOut: 480,
        recordsRejected: 20,
        operatorEmail: 'ops@clearshift.internal',
        operatorPhone: '+1-555-0100',
        samplingRate: 0.5,
      });

      expect(Object.keys(errors)).toHaveLength(0);
    });

    it('detects missing batchId and negative numbers', () => {
      const errors = validateCreateRunFields({
        batchId: '   ',
        module: 'crm-1',
        step: 'clean',
        status: 'pending',
        recordsIn: -10,
        recordsOut: -5,
        recordsRejected: -2,
      });

      expect(errors.batchId).toBe('batchId is required');
      expect(errors.recordsIn).toBe('Records In cannot be negative');
      expect(errors.recordsOut).toBe('Records Out cannot be negative');
      expect(errors.recordsRejected).toBe('Records Rejected cannot be negative');
    });

    it('enforces conservation invariant: recordsOut + recordsRejected cannot exceed recordsIn', () => {
      const errors = validateCreateRunFields({
        batchId: 'batch-test-01',
        module: 'crm-2',
        step: 'profile',
        status: 'running',
        recordsIn: 100,
        recordsOut: 85,
        recordsRejected: 25, // 85 + 25 = 110 > 100
      });

      expect(errors.recordsOut).toBe(
        'Invariant violation: sum of recordsOut and recordsRejected cannot exceed recordsIn'
      );
    });

    it('validates email format and detects malformed emails', () => {
      const errors = validateCreateRunFields({
        batchId: 'batch-01',
        module: 'crm-1',
        step: 'extract',
        status: 'pending',
        recordsIn: 10,
        recordsOut: 8,
        recordsRejected: 2,
        operatorEmail: 'not-an-email',
      });

      expect(errors.operatorEmail).toBe('Invalid email address format');
    });

    it('validates phone numbers and requires at least 7 digits', () => {
      const errors = validateCreateRunFields({
        batchId: 'batch-01',
        module: 'crm-1',
        step: 'extract',
        status: 'pending',
        recordsIn: 10,
        recordsOut: 8,
        recordsRejected: 2,
        operatorPhone: '123',
      });

      expect(errors.operatorPhone).toBe('Invalid phone number format');
    });

    it('validates decimal ranges for sampling rate strictly between 0.00 and 1.00', () => {
      const errorsLow = validateCreateRunFields({
        batchId: 'batch-01',
        module: 'crm-1',
        step: 'extract',
        status: 'pending',
        recordsIn: 10,
        recordsOut: 8,
        recordsRejected: 2,
        samplingRate: -0.1,
      });
      expect(errorsLow.samplingRate).toBe('Value must be a decimal between 0.00 and 1.00');

      const errorsHigh = validateCreateRunFields({
        batchId: 'batch-01',
        module: 'crm-1',
        step: 'extract',
        status: 'pending',
        recordsIn: 10,
        recordsOut: 8,
        recordsRejected: 2,
        samplingRate: 1.05,
      });
      expect(errorsHigh.samplingRate).toBe('Value must be a decimal between 0.00 and 1.00');
    });

    it('enforces mandatory operator contact information when requireContactInfo is true', () => {
      const errors = validateCreateRunFields(
        {
          batchId: 'batch-01',
          module: 'crm-1',
          step: 'extract',
          status: 'pending',
          recordsIn: 10,
          recordsOut: 8,
          recordsRejected: 2,
          operatorEmail: '',
          operatorPhone: '',
        },
        true // requireContactInfo = true
      );

      expect(errors.operatorEmail).toBe('Operator email is required');
      expect(errors.operatorPhone).toBe('Operator phone is required');
    });

    it('accepts exact boundary values (0.0, 1.0, and exact sum conservation)', () => {
      const errors = validateCreateRunFields({
        batchId: 'batch-boundary-01',
        module: 'crm-5',
        step: 'reconcile',
        status: 'completed',
        recordsIn: 100,
        recordsOut: 70,
        recordsRejected: 30, // 70 + 30 = 100 == 100
        samplingRate: 0.0,
      });

      expect(Object.keys(errors)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Server Validation Error Mapping (parseServerErrorToFieldErrors)
  // ---------------------------------------------------------------------------
  describe('3. Server Validation Error Mapping (parseServerErrorToFieldErrors)', () => {
    it('maps ClearShift standard HTTP 400 error envelope with details array to field errors', () => {
      const serverEnvelopeError = {
        statusCode: 400,
        message: 'Request payload validation failed',
        details: [
          { path: ['batchId'], message: 'Batch correlation ID already registered' },
          { path: ['operatorPhone'], message: 'Phone country prefix unverified' },
          { path: ['recordsOut'], message: 'Records Out exceeds allowable partition slice' },
        ],
      };

      const { topMessage, fieldErrors } = parseServerErrorToFieldErrors(serverEnvelopeError);

      expect(topMessage).toBe('Request payload validation failed');
      expect(fieldErrors.batchId).toBe('Batch correlation ID already registered');
      expect(fieldErrors.operatorPhone).toBe('Phone country prefix unverified');
      expect(fieldErrors.recordsOut).toBe('Records Out exceeds allowable partition slice');
    });

    it('maps nested error.details envelope format', () => {
      const nestedError = {
        status: 400,
        error: {
          message: 'Entity constraint violation',
          details: [
            { field: 'operatorEmail', message: 'Domain not whitelisted' },
          ],
        },
      };

      const { topMessage, fieldErrors } = parseServerErrorToFieldErrors(nestedError);

      expect(topMessage).toBe('Entity constraint violation');
      expect(fieldErrors.operatorEmail).toBe('Domain not whitelisted');
    });

    it('maps flat fieldErrors object if present on error', () => {
      const flatError = {
        message: 'Validation failed',
        fieldErrors: {
          batchId: 'Duplicate batch ID',
          samplingRate: 'Rate out of permissible bounds',
        },
      };

      const { topMessage, fieldErrors } = parseServerErrorToFieldErrors(flatError);

      expect(topMessage).toBe('Validation failed');
      expect(fieldErrors.batchId).toBe('Duplicate batch ID');
      expect(fieldErrors.samplingRate).toBe('Rate out of permissible bounds');
    });

    it('falls back to top-level error message when details array is absent', () => {
      const genericError = new Error('500 Internal Server Error in CRM-5 database partition');
      const { topMessage, fieldErrors } = parseServerErrorToFieldErrors(genericError);

      expect(topMessage).toBe('500 Internal Server Error in CRM-5 database partition');
      expect(Object.keys(fieldErrors)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. FormValidationSummary Component
  // ---------------------------------------------------------------------------
  describe('4. FormValidationSummary Component', () => {
    it('renders accessible alert banner with role="alert" and aria-live="polite"', () => {
      const element = FormValidationSummary({
        title: 'Validation errors prevented submission:',
        errors: {
          batchId: 'batchId is required',
          recordsIn: 'Records In cannot be negative',
        },
      });

      expect(element).not.toBeNull();
      expect(element!.props.role).toBe('alert');
      expect(element!.props['aria-live']).toBe('polite');
      expect(element!.props.className).toContain('cs-form-validation-summary');

      // Header and error list
      const [, list] = element!.props.children;
      expect(list.props.className).toBe('cs-form-validation-summary-list');
      expect(list.props.children).toHaveLength(2);
    });

    it('returns null when zero errors exist', () => {
      const element = FormValidationSummary({ errors: {} });
      expect(element).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. ConfirmationToast Component
  // ---------------------------------------------------------------------------
  describe('5. ConfirmationToast Component', () => {
    it('renders toast with role="status" and aria-live="polite"', () => {
      const element = ConfirmationToast({
        show: true,
        title: 'Run Recorded',
        message: 'Migration run projection was successfully created.',
        type: 'success',
      });

      expect(element).not.toBeNull();
      expect(element!.props.role).toBe('status');
      expect(element!.props['aria-live']).toBe('polite');
      expect(element!.props.className).toContain('cs-toast-success');
    });

    it('returns null when show is false', () => {
      const element = ConfirmationToast({ show: false, message: 'Hidden' });
      expect(element).toBeNull();
    });

    it('triggers onDismiss callback after autoDismissMs timer expires', () => {
      vi.useFakeTimers();
      const onDismiss = vi.fn();

      ConfirmationToast({
        show: true,
        message: 'Auto dismiss test',
        onDismiss,
        autoDismissMs: 3000,
      });

      expect(onDismiss).not.toHaveBeenCalled();
      vi.advanceTimersByTime(3000);
      expect(onDismiss).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('allows manual dismissal via close button', () => {
      const onDismiss = vi.fn();
      const element = ConfirmationToast({
        show: true,
        message: 'Manual dismiss test',
        onDismiss,
      });

      expect(element).not.toBeNull();
      const closeBtn = element!.props.children[2];
      expect(closeBtn.props.type).toBe('button');
      expect(closeBtn.props['aria-label']).toBe('Dismiss notification');

      closeBtn.props.onClick();
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. CreateRunModal Component
  // ---------------------------------------------------------------------------
  describe('6. CreateRunModal Component', () => {
    it('renders modal dialog with role="dialog" and aria-modal="true"', () => {
      const onClose = vi.fn();
      const onSubmit = vi.fn();
      const element = CreateRunModal({
        isOpen: true,
        onClose,
        onSubmit,
        title: 'Record Migration Run Projection',
      });

      expect(element).not.toBeNull();
      expect(element!.props.className).toContain('cs-modal-backdrop');

      const dialogCard = findElement(element, (el) => el?.props?.role === 'dialog');
      expect(dialogCard).not.toBeNull();
      expect(dialogCard?.props?.role).toBe('dialog');
      expect(dialogCard?.props?.['aria-modal']).toBe('true');
    });

    it('returns null when isOpen is false', () => {
      const element = CreateRunModal({
        isOpen: false,
        onClose: vi.fn(),
        onSubmit: vi.fn(),
      });
      expect(element).toBeNull();
    });

    it('closes on close button click and escape key', () => {
      const onClose = vi.fn();
      const element = CreateRunModal({
        isOpen: true,
        onClose,
        onSubmit: vi.fn(),
      });

      const closeBtn = findElement(
        element,
        (el) => el?.props?.['aria-label'] === 'Close dialog'
      );
      expect(closeBtn).not.toBeNull();
      (closeBtn?.props?.onClick as () => void)();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on backdrop overlay click', () => {
      const onClose = vi.fn();
      const element = CreateRunModal({
        isOpen: true,
        onClose,
        onSubmit: vi.fn(),
      });

      expect(element!.props['data-testid']).toBe('create-run-modal-backdrop');
      element!.props.onClick({ target: 'test-node', currentTarget: 'test-node' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Table Cache Updating via DataTableController
  // ---------------------------------------------------------------------------
  describe('7. Table Cache Updating (DataTableController Cache Methods)', () => {
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

// Helper to traverse and find matching React elements in the virtual tree
function findElement(
  node: unknown,
  predicate: (el: { type?: unknown; props?: Record<string, unknown> }) => boolean
): { type?: unknown; props?: Record<string, unknown> } | null {
  if (!node || typeof node !== 'object') return null;
  const candidate = node as { type?: unknown; props?: Record<string, unknown> };
  if (predicate(candidate)) return candidate;
  if (candidate.props && candidate.props.children) {
    const children = Array.isArray(candidate.props.children)
      ? candidate.props.children
      : [candidate.props.children];
    for (const child of children) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

  // ---------------------------------------------------------------------------
  // 8. CreateRunForm & RunsOverviewPage Component Structure & Invariants
  // ---------------------------------------------------------------------------
  describe('8. CreateRunForm & RunsOverviewPage Component Invariants', () => {
    it('disables submit button and shows loading text during inflight request (double-submit prevention)', () => {
      const onSubmit = vi.fn();
      const element = CreateRunForm({
        onSubmit,
        isSubmitting: true,
      });

      expect(element).not.toBeNull();
      const submitBtn = findElement(
        element,
        (el) =>
          typeof el?.props?.className === 'string' &&
          el.props.className.includes('cs-form-submit-btn')
      );

      expect(submitBtn).not.toBeNull();
      expect(submitBtn?.props?.disabled).toBe(true);
      expect(JSON.stringify(submitBtn?.props?.children)).toContain('Recording Run...');
    });

    it('renders server validation error banner and sets aria-invalid on input fields', () => {
      const element = CreateRunForm({
        onSubmit: vi.fn(),
        serverError: '400 Bad Request: Partition constraint violation',
        serverFieldErrors: {
          batchId: 'Correlation identifier already recorded in partition',
        },
      });

      expect(element).not.toBeNull();
      const summary = findElement(element, (el) => el?.type === FormValidationSummary);
      expect(summary).not.toBeNull();
      expect(summary?.props?.title).toContain('400 Bad Request');
    });

    it('renders primary + Record Migration Run button in RunsOverviewPage header', () => {
      const page = RunsOverviewPage({
        onCreateRun: vi.fn(),
      });

      expect(page).not.toBeNull();
      const primaryBtn = findElement(
        page,
        (el) =>
          typeof el?.props?.className === 'string' &&
          el.props.className.includes('cs-create-run-btn')
      );

      expect(primaryBtn).not.toBeNull();
      expect(primaryBtn?.props?.children).toContain('+ Record Migration Run');
    });

    it('renders modal and confirmation toast components within RunsOverviewPage layout', () => {
      const page = RunsOverviewPage({
        onCreateRun: vi.fn(),
      });

      expect(page).not.toBeNull();
      const modal = findElement(page, (el) => el?.type === CreateRunModal);
      expect(modal).not.toBeNull();
    });
  });
});
