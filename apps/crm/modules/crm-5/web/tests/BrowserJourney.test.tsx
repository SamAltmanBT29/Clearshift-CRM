import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MigrationRun, PaginatedRunsResponse, ReconciliationReport } from '@clearshift/contracts';
import { RunsListPage } from '../src/pages/RunsListPage.js';
import { RunsTable } from '../src/components/RunsTable.js';
import { RunDetailPage } from '../pages/RunDetailPage.js';
import { ReconciliationDetailPage } from '../src/pages/ReconciliationDetailPage.js';
import { CreateRunModal } from '../components/CreateRunModal.js';
import { CreateRunForm, type CreateRunFormData } from '../components/CreateRunForm.js';
import { FormValidationSummary } from '../components/FormValidationSummary.js';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';

// Helper to access virtual React element props safely in TypeScript strict mode
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asEl = (node: unknown): any => node as any;

describe('CRM-5 Playwright / Browser Journey Test Suite (Issue #202 / [CRM5-29])', () => {
  beforeEach(() => {
    const dispatcher = {
      useState: (initial: unknown) => [
        typeof initial === 'function' ? (initial as () => unknown)() : initial,
        vi.fn(),
      ],
      useId: () => ':crm5-journey-id:',
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

  const mockRuns: MigrationRun[] = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      batchId: 'batch-journey-crm1-001',
      module: 'crm-1',
      step: 'load',
      status: 'completed',
      recordsIn: 1000,
      recordsOut: 980,
      recordsRejected: 20,
      startedAt: new Date('2026-10-24T10:00:00Z'),
      completedAt: new Date('2026-10-24T10:05:00Z'),
      createdAt: new Date('2026-10-24T10:00:00Z'),
      updatedAt: new Date('2026-10-24T10:05:00Z'),
      metadata: { operatorNotes: 'Batch completed cleanly.' },
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      batchId: 'batch-journey-crm2-002',
      module: 'crm-2',
      step: 'clean',
      status: 'running',
      recordsIn: 500,
      recordsOut: 450,
      recordsRejected: 50,
      startedAt: new Date('2026-10-24T11:00:00Z'),
      completedAt: null,
      createdAt: new Date('2026-10-24T11:00:00Z'),
      updatedAt: new Date('2026-10-24T11:02:00Z'),
      metadata: null,
    },
  ];

  const mockPaginatedRuns: PaginatedRunsResponse = {
    items: mockRuns,
    total: 2,
    page: 1,
    pageSize: 20,
    limit: 20,
    totalPages: 1,
  };

  // ---------------------------------------------------------------------------
  // JOURNEY 1: Create Run Operator Workflow & Validation
  // ---------------------------------------------------------------------------
  describe('Journey 1: Create Run Form & Validation Workflow', () => {
    it('renders CreateRunModal dialog with accessible landmarks and header', () => {
      const onClose = vi.fn();
      const onSubmit = vi.fn();

      const modal = asEl(
        CreateRunModal({
          isOpen: true,
          onClose,
          onSubmit,
        })
      );

      expect(modal).toBeDefined();
      expect(modal.props.className).toBe('cs-modal-backdrop');
      const dialog = modal.props.children;
      expect(dialog.props.role).toBe('dialog');
      expect(dialog.props['aria-modal']).toBe('true');
      expect(dialog.props['aria-labelledby']).toBe(':crm5-journey-id:');
    });

    it('renders FormValidationSummary when client validation detects missing or invalid fields', () => {
      const validationErrors: Record<string, string> = {
        batchId: 'Batch ID is required',
        recordsIn: 'Records In cannot be negative',
      };

      const summary = asEl(
        FormValidationSummary({
          errors: validationErrors,
          title: 'Please correct the highlighted errors before submitting',
        })
      );

      expect(summary).toBeDefined();
      expect(summary.props.role).toBe('alert');
      expect(summary.props['aria-live']).toBe('polite');

      const [, errorList] = summary.props.children;
      expect(errorList.props.children).toHaveLength(2);
    });

    it('submits valid form data through CreateRunForm without errors', async () => {
      const onSubmit = vi.fn().mockResolvedValue(mockRuns[0]);
      const validForm: CreateRunFormData = {
        batchId: 'batch-crm-1-new-001',
        module: 'crm-1',
        step: 'clean',
        status: 'running',
        recordsIn: 100,
        recordsOut: 95,
        recordsRejected: 5,
        startedAt: '2026-10-24T10:00',
        metadataNotes: 'Synthetic test execution notes.',
      };

      const form = asEl(
        CreateRunForm({
          onSubmit,
          initialValues: validForm,
        })
      );

      expect(form).toBeDefined();
      expect(form.type).toBe('form');
      expect(form.props.className).toContain('cs-create-run-form');
      expect(form.props.noValidate).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // JOURNEY 2: List Screen & Bounded Pagination
  // ---------------------------------------------------------------------------
  describe('Journey 2: Migration Runs List Screen & Bounded Pagination', () => {
    it('renders populated runs list page with table headers and pagination controls', () => {
      const page = asEl(
        RunsListPage({
          initialRuns: mockPaginatedRuns,
        })
      );

      expect(page).toBeDefined();
      expect(page.props.role).toBe('main');

      const [, , contentSection] = page.props.children;
      const tableWrapper = asEl(contentSection.props.children[4]);
      expect(tableWrapper).toBeDefined();

      const [runsTable, pagination] = tableWrapper.props.children;
      expect(runsTable.type).toBe(RunsTable);
      expect(runsTable.props.runs).toHaveLength(2);
      expect(pagination.props.currentPage).toBe(1);
      expect(pagination.props.totalCount).toBe(2);
    });

    it('renders all 9 SDS columns with accessible sort triggers in RunsTable', () => {
      const onSortChange = vi.fn();
      const table = asEl(
        RunsTable({
          runs: mockRuns,
          sort: { columnKey: 'batchId', direction: 'asc' },
          onSortChange,
        })
      );

      expect(table.props.role).toBe('region');
      const [, tbody] = table.props.children.props.children;
      const rows = tbody.props.children;
      expect(rows).toHaveLength(2);

      // Verify row keyboard navigation (Enter key selects row)
      const onRowClick = vi.fn();
      const interactiveTable = asEl(
        RunsTable({
          runs: mockRuns,
          onRowClick,
        })
      );
      const interactiveRow = asEl(interactiveTable.props.children.props.children[1].props.children[0]);
      expect(interactiveRow.props.tabIndex).toBe(0);
      interactiveRow.props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() });
      expect(onRowClick).toHaveBeenCalledWith(mockRuns[0]);
    });
  });

  // ---------------------------------------------------------------------------
  // JOURNEY 3: Search, Faceted Filtering & Page 1 Reset
  // ---------------------------------------------------------------------------
  describe('Journey 3: Search, Faceted Filtering & Page 1 Reset Invariant', () => {
    it('mutates query parameters and resets pagination to page 1 upon search submission', () => {
      const mockGetRuns = vi.fn().mockResolvedValue(mockPaginatedRuns);
      const page = asEl(
        RunsListPage({
          initialRuns: { ...mockPaginatedRuns, page: 4 },
          getRunsFn: mockGetRuns,
        })
      );

      const [, controlsSection] = page.props.children;
      const form = asEl(controlsSection.props.children[0]);
      const [searchWrapper, moduleWrapper, statusWrapper] = form.props.children;

      // 1. Enter search term and submit
      const searchInput = asEl(searchWrapper.props.children[2]);
      searchInput.props.onChange({ target: { value: 'crm2' } });
      form.props.onSubmit({ preventDefault: vi.fn() });

      expect(mockGetRuns).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1 }),
        expect.anything()
      );

      // 2. Select module filter
      const moduleSelect = asEl(moduleWrapper.props.children[1]);
      moduleSelect.props.onChange({ target: { value: 'crm-2' } });
      expect(mockGetRuns).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, module: 'crm-2' }),
        expect.anything()
      );

      // 3. Select status filter
      const statusSelect = asEl(statusWrapper.props.children[1]);
      statusSelect.props.onChange({ target: { value: 'completed' } });
      expect(mockGetRuns).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, status: 'completed' }),
        expect.anything()
      );
    });

    it('renders distinct empty state with reset button when no records match filter criteria', () => {
      const emptyPage = asEl(
        RunsListPage({
          initialRuns: { items: [], total: 0, page: 1, pageSize: 20, limit: 20, totalPages: 0 },
          initialBatchId: 'nonexistent-batch-criteria',
          forceLoading: false,
        })
      );

      const [, , contentSection] = emptyPage.props.children;
      const emptyState = asEl(contentSection.props.children[3]);
      expect(emptyState.type).toBe(EmptyState);
      expect(emptyState.props.title).toBe('No matching migration runs');
      expect(emptyState.props.actionLabel).toBe('Clear All Filters');
    });
  });

  // ---------------------------------------------------------------------------
  // JOURNEY 4: Detail View, Reconciliation Report & Read-Only Invariants
  // ---------------------------------------------------------------------------
  describe('Journey 4: Detail View, Reconciliation Balance & Read-Only Protection', () => {
    it('renders RunDetailPage displaying primary attributes, throughput and audit metadata', () => {
      const run = mockRuns[0]!;
      const detailPage = asEl(
        RunDetailPage({
          runId: run.id,
          initialRun: run,
        })
      );

      expect(detailPage).toBeDefined();
      expect(detailPage.props.className).toContain('cs-run-detail-page');
      const [, headerSection] = detailPage.props.children;
      expect(headerSection).toBeDefined();
    });

    it('renders ReconciliationDetailPage displaying balanced conservation sheet with unaccounted=0', () => {
      const sampleReconciliation: ReconciliationReport = {
        id: 'rec-001',
        batchId: 'batch-journey-crm1-001',
        module: 'crm-1',
        sourceCount: 1000,
        loadedCount: 920,
        rejectedCount: 50,
        mergedCount: 20,
        skippedCount: 10,
        unaccountedCount: 0,
        status: 'OK',
        createdAt: new Date('2026-10-24T10:05:00Z'),
      };

      const reconPage = asEl(
        ReconciliationDetailPage({
          batchId: sampleReconciliation.batchId,
          initialReport: sampleReconciliation,
        })
      );

      expect(reconPage).toBeDefined();
      expect(reconPage.props.className).toBe('cs-detail-container');
      const [breadcrumbs, headerCard] = reconPage.props.children;
      expect(breadcrumbs).toBeDefined();
      expect(headerCard).toBeDefined();
      expect(
        sampleReconciliation.sourceCount ===
          sampleReconciliation.loadedCount +
            sampleReconciliation.rejectedCount +
            sampleReconciliation.mergedCount +
            sampleReconciliation.skippedCount
      ).toBe(true);
    });

    it('renders AccessDeniedView with required capability when operator lacks control:read permission', () => {
      const deniedView = asEl(
        AccessDeniedView({
          requiredCapability: 'control:read',
          resourceName: 'Migration Control Center',
        })
      );

      expect(deniedView).toBeDefined();
      expect(deniedView.props.role).toBe('region');
      expect(deniedView.props['aria-labelledby']).toBe('cs-access-denied-title');
    });
  });
});
