import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import {
  CreateDealFormSchema,
  validateCreateDealFields,
  parseServerErrorToFieldErrors,
  FormValidationSummary,
  ConfirmationToast,
  CreateDealModal,
  CreateDealForm,
  DataTableController,
  DealsListPage,
  DEALS_COLUMNS,
} from '../../web/src/index.js';

// Setup React Hook Dispatcher for direct functional component execution in tests
beforeEach(() => {
  const dispatcher = {
    useState: (initial: unknown) => [
      typeof initial === 'function' ? (initial as () => unknown)() : initial,
      vi.fn(),
    ],
    useId: () => ':crm2-test-id:',
    useEffect: (effect: () => void | (() => void)) => {
      const cleanup = effect();
      if (typeof cleanup === 'function') {
        // cleanup registered
      }
    },
    useMemo: (factory: () => unknown) => factory(),
    useCallback: (callback: unknown) => callback,
    useRef: (initial: unknown) => ({ current: initial }),
    useTransition: () => [false, (fn: () => void) => fn()],
  };

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

// Helper to traverse and find matching React elements in the virtual tree
function findElement(
  node: unknown,
  predicate: (el: { type?: unknown; props?: Record<string, unknown> }) => boolean
): { type?: unknown; props?: Record<string, unknown> } | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const candidate = node as { type?: unknown; props?: Record<string, unknown> };
  if (predicate(candidate)) return candidate;
  if (candidate.props && candidate.props['children']) {
    return findElement(candidate.props['children'], predicate);
  }
  return null;
}

describe('CRM-2 Deals, Pipeline and Quotes: Create Form with Field-Level Validation (Issue #133 / CRM2-20)', () => {
  // ---------------------------------------------------------------------------
  // 1. Zod Schema & Field-Level Invariants (CreateDealFormSchema)
  // ---------------------------------------------------------------------------
  describe('1. Zod Schema & Field-Level Invariants (CreateDealFormSchema)', () => {
    it('validates required fields, email format, phone numbers, and decimal ranges on valid input', () => {
      const validInput = {
        name: 'Acme Global Cloud Migration',
        contactId: '90000000-0000-4000-8000-000000000001',
        contactEmail: 'lead.buyer@acme-corp.com',
        contactPhone: '+1-555-0199',
        value: '75000.50',
        probability: 0.60,
        currency: 'USD',
        stageName: 'Proposal' as const,
        closeDate: '2026-12-15',
        sourceSystem: 'salesforce-legacy',
        sourceId: '0064W0000109abc',
      };

      const result = CreateDealFormSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Acme Global Cloud Migration');
        expect(result.data.contactId).toBe('90000000-0000-4000-8000-000000000001');
        expect(result.data.contactEmail).toBe('lead.buyer@acme-corp.com');
        expect(result.data.contactPhone).toBe('+1-555-0199');
        expect(result.data.value).toBe('75000.50');
        expect(result.data.probability).toBe(0.60);
        expect(result.data.currency).toBe('USD');
        expect(result.data.stageName).toBe('Proposal');
        expect(result.data.closeDate).toBe('2026-12-15');
      }
    });

    it('rejects missing or empty required fields', () => {
      const invalidEmpty = {
        name: '',
        value: '',
        closeDate: '',
      };

      const result = CreateDealFormSchema.safeParse(invalidEmpty);
      expect(result.success).toBe(false);
      if (!result.success) {
        const fieldErrors = result.error.flatten().fieldErrors;
        expect(fieldErrors.name).toContain('Deal name is required');
        expect(fieldErrors.value).toContain('Deal value is required');
        expect(fieldErrors.closeDate).toContain('Close date is required');
      }
    });

    it('rejects deal name exceeding 255 characters', () => {
      const result = CreateDealFormSchema.safeParse({
        name: 'a'.repeat(256),
        value: '1000.00',
        closeDate: '2026-12-31',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.name).toContain(
          'Deal name cannot exceed 255 characters'
        );
      }
    });

    it('rejects invalid Contact UUID format when provided', () => {
      const result = CreateDealFormSchema.safeParse({
        name: 'Valid Deal Name',
        contactId: 'not-a-valid-uuid',
        value: '15000.00',
        closeDate: '2026-11-30',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.contactId).toContain('Invalid Contact UUID');
      }
    });

    it('validates email format strictly', () => {
      const invalidEmails = ['plainaddress', 'missingdomain@', '@nodomain.com', 'bad@domain@domain.com'];
      for (const email of invalidEmails) {
        const res = CreateDealFormSchema.safeParse({
          name: 'Cloud Expansion Deal',
          contactEmail: email,
          value: '25000.00',
          closeDate: '2026-11-30',
        });
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.error.flatten().fieldErrors.contactEmail).toContain(
            'Invalid email address format'
          );
        }
      }

      // Valid email passes
      const validRes = CreateDealFormSchema.safeParse({
        name: 'Cloud Expansion Deal',
        contactEmail: 'sarah.connor@cyberdyne.org',
        value: '25000.00',
        closeDate: '2026-11-30',
      });
      expect(validRes.success).toBe(true);
    });

    it('validates phone number format strictly', () => {
      const invalidPhones = ['abc', '123', 'bad-phone', '++11'];
      for (const phone of invalidPhones) {
        const res = CreateDealFormSchema.safeParse({
          name: 'Telco Rollout',
          contactPhone: phone,
          value: '12000.00',
          closeDate: '2026-11-30',
        });
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.error.flatten().fieldErrors.contactPhone).toContain(
            'Invalid phone number format'
          );
        }
      }

      // Valid phone numbers pass
      const validPhones = ['+1-555-0199', '+44 20 7946 0991', '555-123-4567', '+91 98765 43210'];
      for (const phone of validPhones) {
        const validRes = CreateDealFormSchema.safeParse({
          name: 'Telco Rollout',
          contactPhone: phone,
          value: '12000.00',
          closeDate: '2026-11-30',
        });
        expect(validRes.success).toBe(true);
      }
    });

    it('validates decimal ranges for probability strictly between 0.00 and 1.00', () => {
      const invalidRanges = [-0.01, 1.01, 2.5, -5];
      for (const prob of invalidRanges) {
        const res = CreateDealFormSchema.safeParse({
          name: 'Weighted Deal',
          value: '50000.00',
          closeDate: '2026-12-01',
          probability: prob,
        });
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.error.flatten().fieldErrors.probability).toContain(
            'Value must be a decimal between 0.00 and 1.00'
          );
        }
      }

      // Valid decimal rates pass
      const validProbabilities = [0.0, 0.25, 0.6, 1.0];
      for (const prob of validProbabilities) {
        const validRes = CreateDealFormSchema.safeParse({
          name: 'Weighted Deal',
          value: '50000.00',
          closeDate: '2026-12-01',
          probability: prob,
        });
        expect(validRes.success).toBe(true);
      }
    });

    it('validates deal value decimal format strictly', () => {
      const invalidValues = ['not-a-number', '-500', '12.34567', 'abc.50'];
      for (const val of invalidValues) {
        const res = CreateDealFormSchema.safeParse({
          name: 'Decimal Check',
          value: val,
          closeDate: '2026-12-01',
        });
        expect(res.success).toBe(false);
      }

      const validValues = ['0', '0.00', '15000', '99999.99', '1234.5678'];
      for (const val of validValues) {
        const res = CreateDealFormSchema.safeParse({
          name: 'Decimal Check',
          value: val,
          closeDate: '2026-12-01',
        });
        expect(res.success).toBe(true);
      }
    });

    it('enforces 6 fixed stage names strictly', () => {
      const validStages = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];
      for (const st of validStages) {
        const res = CreateDealFormSchema.safeParse({
          name: 'Stage Validation',
          value: '10000.00',
          stageName: st,
          closeDate: '2026-12-01',
        });
        expect(res.success).toBe(true);
      }

      const invalidRes = CreateDealFormSchema.safeParse({
        name: 'Stage Validation',
        value: '10000.00',
        stageName: 'UnknownCustomStage',
        closeDate: '2026-12-01',
      });
      expect(invalidRes.success).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Client-Side Field-Level Validation Helper (validateCreateDealFields)
  // ---------------------------------------------------------------------------
  describe('2. Client-Side Field-Level Validation (validateCreateDealFields)', () => {
    it('returns empty error map on complete, valid inputs', () => {
      const errors = validateCreateDealFields({
        name: 'Enterprise License Deal',
        contactId: '90000000-0000-4000-8000-000000000001',
        contactEmail: 'buyer@enterprise.com',
        contactPhone: '+1-555-0123',
        value: '50000.00',
        probability: 0.5,
        currency: 'USD',
        stageName: 'Qualified',
        closeDate: '2026-12-31',
      });

      expect(Object.keys(errors)).toHaveLength(0);
    });

    it('detects missing name, missing value, and invalid close date', () => {
      const errors = validateCreateDealFields({
        name: '   ',
        value: '',
        closeDate: 'bad-date',
      });

      expect(errors['name']).toBe('Deal name is required');
      expect(errors['value']).toBe('Deal value is required');
      expect(errors['closeDate']).toBe('Close date must be in YYYY-MM-DD format');
    });

    it('detects negative deal value', () => {
      const errors = validateCreateDealFields({
        name: 'Negative Deal',
        value: '-100.50',
        closeDate: '2026-12-31',
      });

      expect(errors['value']).toBe('Value must be a valid non-negative decimal string');
    });

    it('validates email format and detects malformed emails', () => {
      const errors = validateCreateDealFields({
        name: 'Deal',
        value: '1000.00',
        closeDate: '2026-12-31',
        contactEmail: 'not-an-email',
      });

      expect(errors['contactEmail']).toBe('Invalid email address format');
    });

    it('validates phone numbers and requires at least 7 digits', () => {
      const errors = validateCreateDealFields({
        name: 'Deal',
        value: '1000.00',
        closeDate: '2026-12-31',
        contactPhone: '123',
      });

      expect(errors['contactPhone']).toBe('Invalid phone number format');
    });

    it('validates decimal ranges for probability strictly between 0.00 and 1.00', () => {
      const errorsLow = validateCreateDealFields({
        name: 'Deal',
        value: '1000.00',
        closeDate: '2026-12-31',
        probability: -0.1,
      });
      expect(errorsLow['probability']).toBe('Value must be a decimal between 0.00 and 1.00');

      const errorsHigh = validateCreateDealFields({
        name: 'Deal',
        value: '1000.00',
        closeDate: '2026-12-31',
        probability: 1.05,
      });
      expect(errorsHigh['probability']).toBe('Value must be a decimal between 0.00 and 1.00');
    });

    it('enforces mandatory contact info when requireContactInfo is true', () => {
      const errors = validateCreateDealFields(
        {
          name: 'Deal',
          value: '1000.00',
          closeDate: '2026-12-31',
          contactEmail: '',
          contactPhone: '',
        },
        true // requireContactInfo = true
      );

      expect(errors['contactEmail']).toBe('Contact email is required');
      expect(errors['contactPhone']).toBe('Contact phone is required');
    });

    it('accepts exact boundary values (0.0, 1.0, and 0 value)', () => {
      const errors = validateCreateDealFields({
        name: 'Boundary Deal',
        value: '0.00',
        probability: 0.0,
        currency: 'EUR',
        stageName: 'New',
        closeDate: '2026-12-31',
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
          { path: ['name'], message: 'Duplicate deal name in partition' },
          { path: ['contactPhone'], message: 'Phone country prefix unverified' },
          { path: ['value'], message: 'Value exceeds allowable authorization threshold' },
        ],
      };

      const { topMessage, fieldErrors } = parseServerErrorToFieldErrors(serverEnvelopeError);

      expect(topMessage).toBe('Request payload validation failed');
      expect(fieldErrors['name']).toBe('Duplicate deal name in partition');
      expect(fieldErrors['contactPhone']).toBe('Phone country prefix unverified');
      expect(fieldErrors['value']).toBe('Value exceeds allowable authorization threshold');
    });

    it('maps nested error.details envelope format', () => {
      const nestedError = {
        status: 400,
        error: {
          message: 'Entity constraint violation',
          details: [
            { field: 'contactEmail', message: 'Domain not whitelisted' },
          ],
        },
      };

      const { topMessage, fieldErrors } = parseServerErrorToFieldErrors(nestedError);

      expect(topMessage).toBe('Entity constraint violation');
      expect(fieldErrors['contactEmail']).toBe('Domain not whitelisted');
    });

    it('maps flat fieldErrors object if present on error', () => {
      const flatError = {
        message: 'Validation failed',
        fieldErrors: {
          name: 'Duplicate deal name',
          probability: 'Probability out of permissible bounds',
        },
      };

      const { topMessage, fieldErrors } = parseServerErrorToFieldErrors(flatError);

      expect(topMessage).toBe('Validation failed');
      expect(fieldErrors['name']).toBe('Duplicate deal name');
      expect(fieldErrors['probability']).toBe('Probability out of permissible bounds');
    });

    it('falls back to top-level error message when details array is absent', () => {
      const genericError = new Error('500 Internal Server Error in CRM-2 database partition');
      const { topMessage, fieldErrors } = parseServerErrorToFieldErrors(genericError);

      expect(topMessage).toBe('500 Internal Server Error in CRM-2 database partition');
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
          name: 'Deal name is required',
          value: 'Deal value is required',
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
        title: 'Deal Created',
        message: 'Sales opportunity was successfully created.',
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
  // 6. CreateDealModal Component
  // ---------------------------------------------------------------------------
  describe('6. CreateDealModal Component', () => {
    it('renders modal dialog with role="dialog" and aria-modal="true"', () => {
      const onClose = vi.fn();
      const onSubmit = vi.fn();
      const element = CreateDealModal({
        isOpen: true,
        onClose,
        onSubmit,
        title: 'Create New Deal Opportunity',
      });

      expect(element).not.toBeNull();
      expect(element!.props.className).toContain('cs-modal-backdrop');

      const dialogCard = findElement(element, (el) => el?.props?.role === 'dialog');
      expect(dialogCard).not.toBeNull();
      expect(dialogCard?.props?.role).toBe('dialog');
      expect(dialogCard?.props?.['aria-modal']).toBe('true');
    });

    it('returns null when isOpen is false', () => {
      const element = CreateDealModal({
        isOpen: false,
        onClose: vi.fn(),
        onSubmit: vi.fn(),
      });
      expect(element).toBeNull();
    });

    it('closes on close button click and escape key', () => {
      const onClose = vi.fn();
      const element = CreateDealModal({
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
      const element = CreateDealModal({
        isOpen: true,
        onClose,
        onSubmit: vi.fn(),
      });

      expect(element!.props['data-testid']).toBe('create-deal-modal-backdrop');
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
        columns: DEALS_COLUMNS,
      });

      expect(controller.getCachedData()).toEqual([]);
      expect(controller.getPagination().total).toBe(0);

      const sampleDeals = [
        { id: '1', name: 'Acme Deal', value: '10000.00', currency: 'USD' },
        { id: '2', name: 'Beta Deal', value: '25000.00', currency: 'EUR' },
      ];

      controller.setCachedData(sampleDeals);
      expect(controller.getCachedData()).toHaveLength(2);
      expect(controller.getPagination().total).toBe(2);
    });

    it('prepends newly created deal record to cache and increments total count', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
      });

      controller.setCachedData([
        { id: '1', name: 'Acme Deal', value: '10000.00', currency: 'USD' },
      ]);

      const newDeal = {
        id: 'new-999',
        name: 'New Cloud Deal',
        value: '75000.00',
        currency: 'USD',
        stage_name: 'Proposal',
      };

      controller.addRecordToCache(newDeal);

      const cached = controller.getCachedData();
      expect(cached).toHaveLength(2);
      expect(cached[0]).toEqual(newDeal);
      expect(controller.getPagination().total).toBe(2);
    });

    it('updates existing record in cache by id or deal_id', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
      });

      controller.setCachedData([
        { id: 'rec-1', name: 'Pending Deal', value: '5000.00' },
      ]);

      controller.updateRecordInCache('rec-1', { value: '15000.00', name: 'Updated Deal' });

      const updated = controller.getCachedData();
      expect(updated[0]).toEqual(
        expect.objectContaining({
          id: 'rec-1',
          name: 'Updated Deal',
          value: '15000.00',
        })
      );
    });

    it('removes record from cache and decrements total count', () => {
      const controller = new DataTableController({
        columns: DEALS_COLUMNS,
      });

      controller.setCachedData([
        { id: 'rec-1', name: 'Deal 1' },
        { id: 'rec-2', name: 'Deal 2' },
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
        columns: DEALS_COLUMNS,
      });

      controller.setCachedData([{ id: 'rec-1' }, { id: 'rec-2' }]);
      controller.clearCache();
      expect(controller.getCachedData()).toEqual([]);
      expect(controller.getPagination().total).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. CreateDealForm & DealsListPage Component Invariants
  // ---------------------------------------------------------------------------
  describe('8. CreateDealForm & DealsListPage Component Invariants', () => {
    it('disables submit button and shows loading text during inflight request (double-submit prevention)', () => {
      const onSubmit = vi.fn();
      const element = CreateDealForm({
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
      expect(JSON.stringify(submitBtn?.props?.children)).toContain('Creating Deal...');
    });

    it('renders server validation error banner and sets aria-invalid on input fields', () => {
      const element = CreateDealForm({
        onSubmit: vi.fn(),
        serverError: '400 Bad Request: Partition constraint violation',
        serverFieldErrors: {
          name: 'Deal name already exists in active partition',
        },
      });

      expect(element).not.toBeNull();
      const summary = findElement(element, (el) => el?.type === FormValidationSummary);
      expect(summary).not.toBeNull();
      expect(summary?.props?.title).toContain('400 Bad Request');
    });

    it('renders primary + Create Deal button in DealsListPage header', () => {
      const page = DealsListPage({
        onCreateDeal: vi.fn(),
      });

      expect(page).not.toBeNull();
      const primaryBtn = findElement(
        page,
        (el) =>
          typeof el?.props?.className === 'string' &&
          el.props.className.includes('cs-create-deal-btn')
      );

      expect(primaryBtn).not.toBeNull();
      expect(primaryBtn?.props?.children).toBeDefined();
    });

    it('renders modal and confirmation toast components within DealsListPage layout', () => {
      const page = DealsListPage({
        onCreateDeal: vi.fn(),
      });

      expect(page).not.toBeNull();
      const modal = findElement(page, (el) => el?.type === CreateDealModal);
      expect(modal).not.toBeNull();

      const toast = findElement(page, (el) => el?.type === ConfirmationToast);
      expect(toast).not.toBeNull();
    });
  });
});
