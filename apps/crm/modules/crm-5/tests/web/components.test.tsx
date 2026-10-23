import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import {
  DataTable,
  TableSkeleton,
  EmptyState,
  ErrorAlert,
  AccessDeniedView,
  FilterToolbar,
  FacetedFilterSidebar,
  ActiveFilterPills,
} from '../../web/index.js';
import { RUNS_COLUMNS } from '../../web/table/columns.js';
import { CRM5_RUNS_FACETS } from '../../web/table/facets.js';

// Helper to access virtual React element props safely in TypeScript strict mode
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asEl = (node: unknown): any => node as any;

describe('CRM-5 Web UI Components Integration Suite (#55, [CRM5-10])', () => {
  // ---------------------------------------------------------------------------
  // 1. DataTable Component States & Virtual Element Tree
  // ---------------------------------------------------------------------------
  describe('1. DataTable Component States & Elements', () => {
    const mockRunsData = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        batchId: 'batch-001',
        module: 'crm-1',
        step: 'clean',
        status: 'completed',
        recordsIn: 100,
        recordsOut: 98,
        recordsRejected: 2,
        startedAt: '2026-10-23T10:00:00.000Z',
        completedAt: '2026-10-23T10:01:00.000Z',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        batchId: 'batch-002',
        module: 'crm-2',
        step: 'load',
        status: 'failed',
        recordsIn: 50,
        recordsOut: 40,
        recordsRejected: 10,
        startedAt: '2026-10-23T11:00:00.000Z',
        completedAt: '2026-10-23T11:02:00.000Z',
      },
    ];

    it('renders normal table with header columns and data rows', () => {
      const element = asEl(
        DataTable({
          columns: RUNS_COLUMNS,
          data: mockRunsData,
          pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
        })
      );

      expect(element).toBeDefined();
      expect(element.props.className).toContain('cs-table-card');

      // Check table child elements
      const tableWrapper = asEl(element.props.children[0]);
      expect(tableWrapper.props.className).toContain('cs-table-responsive');

      const table = asEl(tableWrapper.props.children);
      expect(table.type).toBe('table');
      expect(table.props.className).toContain('cs-table');

      const thead = asEl(table.props.children[0]);
      const tbody = asEl(table.props.children[1]);
      expect(thead.type).toBe('thead');
      expect(tbody.type).toBe('tbody');

      // Validate header cells match columns
      const headerRow = asEl(thead.props.children);
      const ths = headerRow.props.children;
      expect(ths).toHaveLength(RUNS_COLUMNS.length);

      // Validate body rows match data count
      const trs = tbody.props.children;
      expect(trs).toHaveLength(2);
    });

    it('renders TableSkeleton when loading prop is true', () => {
      const element = asEl(
        DataTable({
          columns: RUNS_COLUMNS,
          data: [],
          loading: true,
          loadingRowCount: 4,
        })
      );

      expect(element).toBeDefined();
      expect(element.type).toBe(TableSkeleton);
      expect(element.props.rowCount).toBe(4);
      expect(element.props.columnCount).toBe(RUNS_COLUMNS.length);
    });

    it('renders EmptyState when data array is empty and not loading', () => {
      const onClearFilters = vi.fn();
      const element = asEl(
        DataTable({
          columns: RUNS_COLUMNS,
          data: [],
          loading: false,
          hasActiveFilters: true,
          onClearFilters,
          emptyTitle: 'No migration batches match',
        })
      );

      expect(element).toBeDefined();
      expect(element.props.className).toContain('cs-table-card');
      expect(element.props.role).toBe('status');

      // The child is the EmptyState component
      const emptyStateEl = asEl(element.props.children);
      expect(emptyStateEl.props.title).toBe('No migration batches match');
      expect(emptyStateEl.props.actionLabel).toBe('Reset All Filters');
    });

    it('renders ErrorAlert wrapped in container when error prop is provided', () => {
      const onRetry = vi.fn();
      const element = asEl(
        DataTable({
          columns: RUNS_COLUMNS,
          data: [],
          error: 'Failed to fetch runs from /api/v1/crm-control/runs',
          onRetry,
        })
      );

      expect(element).toBeDefined();
      expect(element.props.className).toContain('cs-table-error-wrapper');
      expect(element.props.role).toBe('region');
      expect(element.props['aria-label']).toBe('Table Error');

      const errorAlertEl = asEl(element.props.children);
      expect(errorAlertEl.props.error).toBe('Failed to fetch runs from /api/v1/crm-control/runs');
      expect(errorAlertEl.props.onRetry).toBe(onRetry);
    });

    it('renders AccessDeniedView when isAccessDenied is true', () => {
      const onAccessBack = vi.fn();
      const element = asEl(
        DataTable({
          columns: RUNS_COLUMNS,
          data: [],
          isAccessDenied: true,
          requiredRole: 'crm_admin',
          currentRole: 'viewer',
          onAccessBack,
        })
      );

      expect(element).toBeDefined();
      expect(element.props.requiredRole).toBe('crm_admin');
      expect(element.props.currentRole).toBe('viewer');
      expect(element.props.onBack).toBe(onAccessBack);
    });

    it('renders pagination bar when totalPages > 1 or total records are present', () => {
      const onPageChange = vi.fn();
      const element = asEl(
        DataTable({
          columns: RUNS_COLUMNS,
          data: mockRunsData,
          pagination: { page: 1, pageSize: 20, total: 45, totalPages: 3 },
          onPageChange,
        })
      );

      const paginationContainer = asEl(element.props.children[1]);
      expect(paginationContainer).toBeDefined();
      expect(paginationContainer.props.className).toContain('cs-pagination-toolbar');
      expect(paginationContainer.props['aria-label']).toBe('Table Pagination');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. FilterToolbar & ActiveFilterPills Components
  // ---------------------------------------------------------------------------
  describe('2. FilterToolbar and ActiveFilterPills Components', () => {
    it('renders search input, quick facets, and active pills', () => {
      const onSearchChange = vi.fn();
      const onFilterChange = vi.fn();
      const onRemoveFilter = vi.fn();
      const onClearAll = vi.fn();

      const activePills = [
        { key: 'module', label: 'Module', value: 'crm-1', displayValue: 'CRM-1 Contacts' },
        { key: 'status', label: 'Status', value: 'completed', displayValue: 'Completed' },
      ];

      const element = asEl(
        FilterToolbar({
          search: 'batch-contacts',
          onSearchChange,
          facets: CRM5_RUNS_FACETS,
          filters: { module: 'crm-1', status: 'completed' },
          onFilterChange,
          activePills,
          onRemoveFilter,
          onClearAll,
        })
      );

      expect(element).toBeDefined();
      expect(element.props.className).toContain('cs-filter-toolbar');

      const topSection = asEl(element.props.children[0]);
      const pillsSection = asEl(element.props.children[1]);
      expect(topSection.props.className).toBe('cs-filter-toolbar-top');

      // Verify pills section element
      expect(pillsSection).toBeDefined();
      expect(pillsSection.props.pills).toEqual(activePills);
      expect(pillsSection.props.onRemoveFilter).toBe(onRemoveFilter);
      expect(pillsSection.props.onClearAll).toBe(onClearAll);
    });

    it('renders ActiveFilterPills standalone with removable badges and clear-all button', () => {
      const onRemoveFilter = vi.fn();
      const onClearAll = vi.fn();
      const pills = [
        { key: 'status', label: 'Status', value: 'failed', displayValue: 'Failed' },
      ];

      const element = asEl(
        ActiveFilterPills({
          pills,
          onRemoveFilter,
          onClearAll,
        })
      );

      expect(element).toBeDefined();
      expect(element.props.className).toContain('cs-active-filter-pills');
      expect(element.props.role).toBe('region');
      expect(element.props['aria-label']).toBe('Active filters');

      const labelSpan = asEl(element.props.children[0]);
      const listDiv = asEl(element.props.children[1]);
      expect(labelSpan.props.className).toBe('cs-filter-pills-label');
      expect(listDiv.props.className).toBe('cs-filter-pills-list');

      // listDiv has pills array at index 0 and clear-all button at index 1
      const pillsList = listDiv.props.children[0];
      const clearBtnNode = listDiv.props.children[1];
      expect(pillsList).toHaveLength(1);
      const pillSpan = asEl(pillsList[0]);
      expect(pillSpan.props.className).toContain('cs-filter-pill');
      const clearBtn = asEl(clearBtnNode);
      expect(clearBtn.type).toBe('button');
      expect(clearBtn.props.className).toContain('cs-clear-all-filters-btn');
    });

    it('renders null for ActiveFilterPills when pills list is empty', () => {
      const element = ActiveFilterPills({
        pills: [],
        onRemoveFilter: vi.fn(),
        onClearAll: vi.fn(),
      });

      expect(element).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. FacetedFilterSidebar Component
  // ---------------------------------------------------------------------------
  describe('3. FacetedFilterSidebar Component', () => {
    it('renders accessible facet sidebar with filters and clear button', () => {
      const onFilterChange = vi.fn();
      const onClearAll = vi.fn();

      const element = asEl(
        FacetedFilterSidebar({
          facets: CRM5_RUNS_FACETS,
          filters: { module: 'crm-1' },
          onFilterChange,
          onClearAll,
          hasActiveFilters: true,
        })
      );

      expect(element).toBeDefined();
      expect(element.props.className).toContain('cs-filter-sidebar');
      expect(element.props['aria-label']).toBe('Faceted Filters');

      const header = asEl(element.props.children[0]);
      const facetList = asEl(element.props.children[1]);
      expect(header.props.className).toBe('cs-sidebar-header');
      expect(facetList.props.className).toBe('cs-sidebar-facets');
      expect(facetList.props.children).toHaveLength(CRM5_RUNS_FACETS.length);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. EmptyState & AccessDeniedView Accessibility & Contract
  // ---------------------------------------------------------------------------
  describe('4. EmptyState and AccessDeniedView Component Contracts', () => {
    it('EmptyState renders icon, heading, description and action button', () => {
      const onAction = vi.fn();
      const element = asEl(
        EmptyState({
          title: 'No rejections recorded',
          description: 'All migration rows for this batch passed validation without error.',
          actionLabel: 'Reset filters',
          onAction,
        })
      );

      expect(element).toBeDefined();
      expect(element.props.role).toBe('status');
      expect(element.props['aria-label']).toBe('No rejections recorded');

      const iconDiv = asEl(element.props.children[0]);
      const titleH3 = asEl(element.props.children[1]);
      const descP = asEl(element.props.children[2]);
      const actionDiv = asEl(element.props.children[3]);

      expect(iconDiv.props.className).toContain('cs-empty-icon');
      expect(titleH3.props.children).toBe('No rejections recorded');
      expect(descP.props.children).toContain('All migration rows');

      // actionDiv contains the action buttons
      const buttonEl = asEl(actionDiv.props.children[0]);
      expect(buttonEl.props.children).toBe('Reset filters');
    });

    it('AccessDeniedView renders 403 Forbidden with security context and back button', () => {
      const onBack = vi.fn();
      const element = asEl(
        AccessDeniedView({
          requiredRole: 'crm_admin',
          requiredCapability: 'control:admin',
          currentRole: 'viewer',
          resourceName: 'CRM-5 Rejection Audits',
          onBack,
        })
      );

      expect(element).toBeDefined();
      expect(element.props.className).toContain('cs-access-denied-card');
      expect(element.props.role).toBe('region');
      expect(element.props['aria-labelledby']).toBe('cs-access-denied-title');

      const content = asEl(element.props.children[1]);
      expect(content.props.className).toBe('cs-access-denied-content');
    });

    it('ErrorAlert sanitizes raw database errors and does not leak internal stack traces', () => {
      const onRetry = vi.fn();
      const rawErrorWithStack = 'Error: Connection pool exhausted\n    at Pool.connect (/Users/clearshift/node_modules/pg/lib/pool.js:12:4)\n    at Query.run';
      const element = asEl(
        ErrorAlert({
          error: rawErrorWithStack,
          onRetry,
        })
      );

      expect(element).toBeDefined();
      expect(element.props.role).toBe('alert');
      expect(element.props['aria-live']).toBe('assertive');

      const content = asEl(element.props.children[0]);
      const actions = asEl(element.props.children[1]);
      const textBlock = asEl(content.props.children[1]);
      const errorMessage = asEl(textBlock.props.children[1]).props.children;

      expect(errorMessage).not.toContain('node_modules');
      expect(errorMessage).not.toContain('/Users/');
      expect(asEl(actions.props.children[0]).props.onClick).toBe(onRetry);
    });
  });
});
