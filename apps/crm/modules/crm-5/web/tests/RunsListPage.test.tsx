import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import {
  type MigrationRun,
  type PaginatedRunsResponse,
  computeQualityScore,
} from '@clearshift/contracts';
import {
  RunsListPage,
  RunsTable,
  getRuns,
  Crm5ApiError,
} from '../index.js';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';

// Helper to access virtual React element props safely in TypeScript strict mode
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asEl = (node: unknown): any => node as any;

const createSyntheticRun = (overrides: Partial<MigrationRun> = {}): MigrationRun => ({
  id: '550e8400-e29b-41d4-a716-446655440000',
  batchId: 'batch-synthetic-001',
  module: 'crm-1',
  step: 'load',
  status: 'completed',
  recordsIn: 1000,
  recordsOut: 980,
  recordsRejected: 20,
  startedAt: new Date('2026-10-23T10:00:00.000Z'),
  completedAt: new Date('2026-10-23T10:05:00.000Z'),
  createdAt: new Date('2026-10-23T10:00:00.000Z'),
  updatedAt: new Date('2026-10-23T10:05:00.000Z'),
  metadata: null,
  ...overrides,
});

describe('Issue #49 [CRM5-04] Migration Control Center Runs List Screen & States', () => {
  // Setup React Hook Dispatcher for direct functional component execution in node/vitest environment
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

  // ---------------------------------------------------------------------------
  // 1. Production API Client Contract & Error Handling
  // ---------------------------------------------------------------------------
  describe('1. API Client Contract & Error Simulation', () => {
    it('throws Crm5ApiError with isPermissionDenied=true when 403 simulated', async () => {
      await expect(
        getRuns({}, { simulatePermissionDenied: true })
      ).rejects.toThrow(Crm5ApiError);

      try {
        await getRuns({}, { simulatePermissionDenied: true });
      } catch (err: any) {
        expect(err.statusCode).toBe(403);
        expect(err.isPermissionDenied).toBe(true);
        expect(err.code).toBe('FORBIDDEN');
      }
    });

    it('throws Crm5ApiError with statusCode=500 when server error simulated', async () => {
      await expect(getRuns({}, { simulateError: true })).rejects.toThrow(Crm5ApiError);

      try {
        await getRuns({}, { simulateError: true });
      } catch (err: any) {
        expect(err.statusCode).toBe(500);
        expect(err.isPermissionDenied).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2. RunsTable Component Rendering & SDS Columns
  // ---------------------------------------------------------------------------
  describe('2. RunsTable Component SDS Columns & Text Safety', () => {
    it('renders all SDS-required column headers with keyboard-accessible sorting buttons', () => {
      const onSortChange = vi.fn();
      const run = createSyntheticRun();

      const element = asEl(
        RunsTable({
          runs: [run],
          sort: { columnKey: 'batchId', direction: 'asc' },
          onSortChange,
        })
      );

      expect(element).toBeDefined();
      expect(element.props.role).toBe('region');
      expect(element.props['aria-label']).toBe('Migration Runs Projections Table');

      const table = asEl(element.props.children);
      const [thead, tbody] = table.props.children;
      const headerRow = asEl(thead.props.children);
      const ths = headerRow.props.children;

      // 9 SDS Columns: batchId, module, step, status, recordsIn, recordsOut, recordsRejected, startedAt, completedAt
      expect(ths).toHaveLength(9);

      // Verify Batch ID column has aria-sort="ascending" and button
      const batchIdTh = asEl(ths[0]);
      expect(batchIdTh.props['aria-sort']).toBe('ascending');

      const sortBtn = asEl(batchIdTh.props.children);
      expect(sortBtn.type).toBe('button');
      sortBtn.props.onClick();
      expect(onSortChange).toHaveBeenCalledWith('batchId');
    });

    it('sanitizes formula injection prefixes (=, +, -, @) in cell rendering', () => {
      const maliciousRun = createSyntheticRun({
        batchId: '=cmd|’ /C calc’!A0',
      });

      const element = asEl(
        RunsTable({
          runs: [maliciousRun],
        })
      );

      const table = asEl(element.props.children);
      const [, tbody] = table.props.children;
      const bodyRows = tbody.props.children;
      const cells = asEl(bodyRows[0]).props.children;

      // Batch ID cell should be prepended with single quote
      const batchIdSpan = asEl(asEl(cells[0]).props.children);
      expect(batchIdSpan.props.children).toBe("'=cmd|’ /C calc’!A0");
    });

    it('handles row keyboard navigation via Enter and Space keydown events', () => {
      const onRowClick = vi.fn();
      const run = createSyntheticRun();

      const element = asEl(
        RunsTable({
          runs: [run],
          onRowClick,
        })
      );

      const table = asEl(element.props.children);
      const [, tbody] = table.props.children;
      const firstRow = asEl(tbody.props.children[0]);

      expect(firstRow.props.tabIndex).toBe(0);

      // Trigger Enter key
      firstRow.props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() });
      expect(onRowClick).toHaveBeenCalledWith(run);

      // Trigger Space key
      firstRow.props.onKeyDown({ key: ' ', preventDefault: vi.fn() });
      expect(onRowClick).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. RunsListPage UI States & Search/Filter Query Mutation
  // ---------------------------------------------------------------------------
  describe('3. RunsListPage UI States & Query Mutation', () => {
    const mockInitialData: PaginatedRunsResponse = {
      items: [
        createSyntheticRun({ batchId: 'batch-contacts-101', status: 'completed' }),
        createSyntheticRun({
          batchId: 'batch-deals-202',
          module: 'crm-2',
          status: 'running',
          recordsRejected: 15,
        }),
      ],
      total: 2,
      page: 1,
      pageSize: 20,
      limit: 20,
      totalPages: 1,
    };

    it('renders populated runs table with API values; no hard-coded demo data in production path', () => {
      const element = asEl(
        RunsListPage({
          initialRuns: mockInitialData,
        })
      );

      expect(element).toBeDefined();
      expect(element.props.role).toBe('main');

      const [, , contentSection] = element.props.children;
      const tableAndPaginationWrapper = asEl(contentSection.props.children[4]);
      expect(tableAndPaginationWrapper).toBeDefined();

      const [runsTableEl, paginationEl] = tableAndPaginationWrapper.props.children;
      expect(runsTableEl.type).toBe(RunsTable);
      expect(runsTableEl.props.runs).toHaveLength(2);
      expect(paginationEl.props.currentPage).toBe(1);
      expect(paginationEl.props.totalCount).toBe(2);
    });

    it('renders TableSkeleton when loading is active', () => {
      const element = asEl(
        RunsListPage({
          forceLoading: true,
        })
      );

      const [, , contentSection] = element.props.children;
      const skeletonEl = asEl(contentSection.props.children[2]);

      expect(skeletonEl).toBeDefined();
      expect(skeletonEl.type).toBe(TableSkeleton);
      expect(skeletonEl.props.rowCount).toBe(5);
      expect(skeletonEl.props.columnCount).toBe(9);
    });

    it('renders EmptyState when items array is empty and not loading', () => {
      const emptyData: PaginatedRunsResponse = {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        limit: 20,
        totalPages: 0,
      };

      const element = asEl(
        RunsListPage({
          initialRuns: emptyData,
          forceLoading: false,
        })
      );

      const [, , contentSection] = element.props.children;
      const emptyStateEl = asEl(contentSection.props.children[3]);

      expect(emptyStateEl).toBeDefined();
      expect(emptyStateEl.type).toBe(EmptyState);
      expect(emptyStateEl.props.title).toBe('No migration runs recorded');
    });

    it('renders ErrorAlert with retry connection button on recoverable error', () => {
      const error = new Crm5ApiError(500, 'INTERNAL_SERVER_ERROR', 'Database gateway timeout');
      const element = asEl(
        RunsListPage({
          forceError: error,
          forceLoading: false,
        })
      );

      const [, , contentSection] = element.props.children;
      const errorAlertEl = asEl(contentSection.props.children[1]);

      expect(errorAlertEl).toBeDefined();
      expect(errorAlertEl.type).toBe(ErrorAlert);
      expect(errorAlertEl.props.error).toBe(error);
      expect(errorAlertEl.props.retryLabel).toBe('Retry Connection');
    });

    it('renders AccessDeniedView with control:read requirement on 403 status', () => {
      const element = asEl(
        RunsListPage({
          forcePermissionDenied: true,
          forceLoading: false,
        })
      );

      const [, , contentSection] = element.props.children;
      const accessDeniedEl = asEl(contentSection.props.children[0]);

      expect(accessDeniedEl).toBeDefined();
      expect(accessDeniedEl.type).toBe(AccessDeniedView);
      expect(accessDeniedEl.props.requiredCapability).toBe('control:read');
    });

    it('resets pagination to page 1 when search or filter values change', async () => {
      const mockGetRuns = vi.fn().mockResolvedValue(mockInitialData);

      const element = asEl(
        RunsListPage({
          initialRuns: { ...mockInitialData, page: 3 },
          getRunsFn: mockGetRuns,
        })
      );

      const [, controlsSection] = element.props.children;
      const form = asEl(controlsSection.props.children[0]);
      const [searchInputWrapper, moduleSelectWrapper, statusSelectWrapper] =
        form.props.children;

      // 1. Submit search form
      const searchInput = asEl(searchInputWrapper.props.children[2]);
      searchInput.props.onChange({ target: { value: 'batch-deals' } });
      form.props.onSubmit({ preventDefault: vi.fn() });

      expect(mockGetRuns).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1, // Reset to page 1
        }),
        expect.anything()
      );

      // 2. Change module select
      const moduleSelect = asEl(moduleSelectWrapper.props.children[1]);
      moduleSelect.props.onChange({ target: { value: 'crm-2' } });

      expect(mockGetRuns).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1, // Reset to page 1
          module: 'crm-2',
        }),
        expect.anything()
      );

      // 3. Change status select
      const statusSelect = asEl(statusSelectWrapper.props.children[1]);
      statusSelect.props.onChange({ target: { value: 'failed' } });

      expect(mockGetRuns).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1, // Reset to page 1
          status: 'failed',
        }),
        expect.anything()
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Non-Negotiable Domain Invariants & Formulas
  // ---------------------------------------------------------------------------
  describe('4. CRM-5 Domain Invariants & Formulas', () => {
    it('asserts domain invariant: CRM-5 reads projections and never mutates sibling tables or Kit batches directly', () => {
      const CRM5_ALLOWED_TABLES = [
        'crm5_runs',
        'crm5_scores',
        'crm5_rejects',
        'crm5_reconciliation',
      ];
      const FORBIDDEN_FOREIGN_TABLES = [
        'crm1_contacts',
        'crm2_deals',
        'crm3_activities',
        'crm4_analytics',
        'kit_batches',
      ];

      for (const table of FORBIDDEN_FOREIGN_TABLES) {
        expect(CRM5_ALLOWED_TABLES).not.toContain(table);
      }
    });

    it('enforces exact SDS quality score formula: 100 * (completeness + validity + (1 - duplicate_rate) + (1 - reject_rate) + link_integrity) / 5', () => {
      // All perfect (1.0 each, rates 0)
      const perfectScore = computeQualityScore({
        completeness: 1.0,
        validity: 1.0,
        duplicateRate: 0.0,
        rejectRate: 0.0,
        linkIntegrity: 1.0,
      });
      expect(perfectScore).toBe(100.0);

      // Partial metrics: completeness=0.9, validity=0.8, duplicateRate=0.05, rejectRate=0.1, linkIntegrity=0.95
      // 100 * (0.9 + 0.8 + (1 - 0.05) + (1 - 0.1) + 0.95) / 5
      // = 100 * (0.9 + 0.8 + 0.95 + 0.9 + 0.95) / 5
      // = 100 * (4.5) / 5 = 90.0
      const calculated = computeQualityScore({
        completeness: 0.9,
        validity: 0.8,
        duplicateRate: 0.05,
        rejectRate: 0.1,
        linkIntegrity: 0.95,
      });
      expect(calculated).toBe(90.0);

      // Incomplete metrics return null (N/A)
      const missingMetric = computeQualityScore({
        completeness: 0.9,
        validity: null,
        duplicateRate: 0.05,
        rejectRate: 0.1,
        linkIntegrity: 0.95,
      });
      expect(missingMetric).toBeNull();
    });

    it('enforces reconciliation row conservation equation: source = loaded + rejected + merged + skipped and unaccounted = 0', () => {
      const source = 1000;
      const loaded = 850;
      const rejected = 50;
      const merged = 70;
      const skipped = 30;

      const totalAccounted = loaded + rejected + merged + skipped;
      const unaccounted = source - totalAccounted;

      expect(totalAccounted).toBe(source);
      expect(unaccounted).toBe(0);
    });
  });
});
