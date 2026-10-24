import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import {
  TableSkeleton,
  EmptyState,
  ErrorAlert,
  sanitizeErrorMessage,
  AccessDeniedView,
  DataTable,
  DealsTable,
  DealsListPage,
  QuotesListPage,
  PipelineOverviewPage,
} from '../../web/index.js';
import { DataTableController } from '../../web/table/DataTableController.js';
import { DEALS_COLUMNS } from '../../web/table/columns.js';

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
    useMemo: (factory: () => unknown) => (typeof factory === 'function' ? factory() : factory),
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

describe('CRM-2 UI Loading, Empty, Error, and 403 Access-Denied States (Issue #132 / CRM2-19)', () => {
  describe('1. TableSkeleton Component', () => {
    it('renders animated table skeleton placeholder with WAI-ARIA attributes', () => {
      const element = TableSkeleton({
        rowCount: 5,
        columnCount: 6,
        ariaLabel: 'Loading deals directory...',
      });

      expect(element).toBeDefined();
      expect(element.props['aria-busy']).toBe('true');
      expect(element.props.role).toBe('status');
      expect(element.props['aria-label']).toBe('Loading deals directory...');
      expect(element.props.className).toContain('cs-skeleton-card');
    });

    it('creates table rows and columns matching requested counts and columnWidths', () => {
      const element = TableSkeleton({
        rowCount: 3,
        columnCount: 4,
        columnWidths: ['120px', '200px', '150px', '100px'],
      });

      // Navigate virtual element tree
      const responsiveDiv = element.props.children[1];
      const table = responsiveDiv.props.children;
      const [thead, tbody] = table.props.children;

      const headerRow = thead.props.children;
      const headerCols = headerRow.props.children;
      expect(headerCols).toHaveLength(4);
      expect(headerCols[0].props.style).toEqual({ width: '120px' });
      expect(headerCols[1].props.style).toEqual({ width: '200px' });

      const bodyRows = tbody.props.children;
      expect(bodyRows).toHaveLength(3);
      for (const row of bodyRows) {
        expect(row.props.children).toHaveLength(4);
      }
    });

    it('includes screen-reader-only announcement text', () => {
      const element = TableSkeleton({
        ariaLabel: 'Fetching deals in background...',
      });

      const srSpan = element.props.children[0];
      expect(srSpan.props.className).toBe('cs-sr-only');
      expect(srSpan.props.children).toBe('Fetching deals in background...');
    });
  });

  describe('2. EmptyState Component', () => {
    it('renders zero-data empty state with icon, title, and description', () => {
      const element = EmptyState({
        title: 'No deal records found',
        description: 'Zero deal records were found matching your criteria.',
        icon: '📁',
      });

      expect(element.props.role).toBe('status');
      expect(element.props['aria-label']).toBe('No deal records found');
      expect(element.props.className).toContain('cs-empty-state');
    });

    it('renders primary call-to-action button and fires callback on click', () => {
      const onAction = vi.fn();
      const element = EmptyState({
        title: 'No deals registered',
        actionLabel: 'Create Deal',
        onAction,
      });

      const actionsDiv = element.props.children[3];
      expect(actionsDiv).toBeDefined();

      const [primaryBtn] = actionsDiv.props.children;
      expect(primaryBtn.props.type).toBe('button');
      expect(primaryBtn.props.className).toContain('cs-empty-cta-btn');
      expect(primaryBtn.props.children).toBe('Create Deal');

      primaryBtn.props.onClick();
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('renders secondary action button and fires callback on click', () => {
      const onSecondary = vi.fn();
      const element = EmptyState({
        title: 'No deals',
        secondaryActionLabel: 'Learn More',
        onSecondaryAction: onSecondary,
      });

      const actionsDiv = element.props.children[3];
      const [, secondaryBtn] = actionsDiv.props.children;
      expect(secondaryBtn.props.className).toContain('cs-empty-secondary-btn');
      expect(secondaryBtn.props.children).toBe('Learn More');

      secondaryBtn.props.onClick();
      expect(onSecondary).toHaveBeenCalledTimes(1);
    });

    it('applies filter reset styling when in filter reset mode', () => {
      const onReset = vi.fn();
      const element = EmptyState({
        title: 'No matching deals',
        className: 'cs-empty-filter-state',
        actionLabel: 'Reset All Filters',
        onAction: onReset,
      });

      expect(element.props.className).toContain('cs-empty-filter-state');
      const actionsDiv = element.props.children[3];
      const [ctaBtn] = actionsDiv.props.children;
      expect(ctaBtn.props.className).toContain('cs-clear-all-filters-btn');
      expect(ctaBtn.props['data-action']).toBe('clear-all-filters');
    });
  });

  describe('3. ErrorAlert Component and sanitizeErrorMessage', () => {
    it('returns null when error is null or undefined', () => {
      expect(ErrorAlert({ error: null })).toBeNull();
      expect(ErrorAlert({ error: undefined })).toBeNull();
    });

    it('renders accessible alert banner with role="alert" and aria-live="assertive"', () => {
      const element = ErrorAlert({
        error: 'Failed to communicate with CRM-2 service',
        title: 'Network Timeout',
      });

      expect(element).not.toBeNull();
      expect(element!.props.role).toBe('alert');
      expect(element!.props['aria-live']).toBe('assertive');
      expect(element!.props.className).toContain('cs-error-banner');
    });

    it('renders retry button and triggers callback when provided', () => {
      const onRetry = vi.fn();
      const element = ErrorAlert({
        error: '503 Service Unavailable',
        onRetry,
        retryLabel: 'Try Again',
      });

      const actionsDiv = element!.props.children[1];
      const [retryBtn] = actionsDiv.props.children;
      expect(retryBtn.props.className).toBe('cs-error-retry-btn');
      expect(retryBtn.props.children).toBe('Try Again');

      retryBtn.props.onClick();
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('renders dismiss button and triggers callback when provided', () => {
      const onDismiss = vi.fn();
      const element = ErrorAlert({
        error: 'Transient warning',
        onDismiss,
      });

      const actionsDiv = element!.props.children[1];
      const [, dismissBtn] = actionsDiv.props.children;
      expect(dismissBtn.props.className).toBe('cs-error-dismiss-btn');

      dismissBtn.props.onClick();
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    describe('sanitizeErrorMessage Security & Masking Invariants', () => {
      it('strips JavaScript stack traces from raw error strings', () => {
        const rawError = `TypeError: Cannot read properties of undefined (reading 'items')
    at DealsTable (/Users/developer/clearshift/apps/crm/modules/crm-2/web/src/components/DealsTable.tsx:42:15)
    at renderWithHooks (/Users/developer/clearshift/node_modules/react-dom/cjs/react-dom.development.js:15486:18)`;

        const sanitized = sanitizeErrorMessage(rawError);
        expect(sanitized).not.toContain('at DealsTable');
        expect(sanitized).not.toContain('/Users/developer');
        expect(sanitized).not.toContain('node_modules');
        expect(sanitized).not.toContain('renderWithHooks');
        expect(sanitized).toBe("TypeError: Cannot read properties of undefined (reading 'items')");
      });

      it('masks absolute filesystem paths in error messages', () => {
        const raw = 'Failed to load file /Users/admin/clearshift/packages/backend/src/secret.ts:12:4';
        const sanitized = sanitizeErrorMessage(raw);
        expect(sanitized).not.toContain('/Users/admin');
        expect(sanitized).toBe('An unexpected operational error occurred. Details have been logged for diagnostics.');
      });

      it('extracts messages from standard ClearShift error envelope objects', () => {
        const envelope = {
          code: 'CRM2_DEAL_NOT_FOUND',
          message: 'Deal opportunity with ID 4402 could not be located.',
          details: { id: '4402' },
        };
        const sanitized = sanitizeErrorMessage(envelope);
        expect(sanitized).toBe('Deal opportunity with ID 4402 could not be located.');
      });

      it('extracts error code when message is absent in error envelope', () => {
        const envelope = {
          code: 'RATE_LIMIT_EXCEEDED',
        };
        const sanitized = sanitizeErrorMessage(envelope);
        expect(sanitized).toBe('Server returned error code: RATE_LIMIT_EXCEEDED');
      });

      it('caps oversized error strings to prevent UI layout blowout', () => {
        const giantString = 'A'.repeat(500);
        const sanitized = sanitizeErrorMessage(giantString);
        expect(sanitized.length).toBeLessThanOrEqual(240);
        expect(sanitized.endsWith('...')).toBe(true);
      });

      it('provides safe fallback message for empty, null, or undefined errors', () => {
        expect(sanitizeErrorMessage(null)).toBe('An unexpected error occurred while communicating with the server.');
        expect(sanitizeErrorMessage('')).toBe('An unexpected error occurred while communicating with the server.');
        expect(sanitizeErrorMessage({})).toBe('An unexpected error occurred. Please try again.');
      });
    });
  });

  describe('4. AccessDeniedView Component', () => {
    it('renders 403 Forbidden access-denied view with default capability and role info', () => {
      const element = AccessDeniedView({
        requiredCapability: 'module.read',
        currentRole: 'viewer',
        resourceName: 'Deals & Pipeline',
      });

      expect(element.props.id).toBe('cs-access-denied-view');
      expect(element.props.role).toBe('region');
      expect(element.props.className).toContain('cs-access-denied-card');

      const content = element.props.children[1];
      const [badge, title, desc, meta] = content.props.children;
      expect(badge.props.children).toBe('403 Forbidden');
      expect(title.props.children).toBe('Access Denied');
      expect(desc.props.children).toContain('Deals & Pipeline');
      expect(desc.props.children).toContain('module.read');

      const metaItems = meta.props.children;
      const capabilityItem = metaItems[0];
      expect(capabilityItem.props.children[1].props.children).toBe('module.read');
    });

    it('renders required role when specified', () => {
      const element = AccessDeniedView({
        requiredRole: 'crm2_admin',
        currentRole: 'sales_rep',
      });

      const content = element.props.children[1];
      const meta = content.props.children[3];
      const [, roleItem] = meta.props.children;
      expect(roleItem).toBeDefined();
      expect(roleItem.props.children[1].props.children).toBe('crm2_admin');
    });

    it('renders clickable button when onBack callback is supplied', () => {
      const onBack = vi.fn();
      const element = AccessDeniedView({
        onBack,
      });

      const content = element.props.children[1];
      const actions = content.props.children[4];
      const actionBtn = actions.props.children;

      expect(actionBtn.type).toBe('button');
      expect(actionBtn.props.className).toContain('cs-access-back-btn');
      actionBtn.props.onClick();
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('renders anchor link when onBack callback is not supplied', () => {
      const element = AccessDeniedView({
        backHref: '/custom-crm-back',
      });

      const content = element.props.children[1];
      const actions = content.props.children[4];
      const actionLink = actions.props.children;

      expect(actionLink.type).toBe('a');
      expect(actionLink.props.href).toBe('/custom-crm-back');
      expect(actionLink.props.children).toBe('Return to Pipeline');
    });
  });

  describe('5. DataTableController HTML State Renderers', () => {
    it('renders table skeleton placeholder HTML', () => {
      const controller = new DataTableController({ columns: DEALS_COLUMNS });
      const html = controller.renderTableSkeletonHtml(3);

      expect(html).toContain('class="cs-skeleton-container"');
      expect(html).toContain('cs-skeleton-table');
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('class="cs-sr-only"');
      expect(html).toContain('cs-skeleton-row');
    });

    it('renders empty zero-data state callout HTML', () => {
      const controller = new DataTableController({ columns: DEALS_COLUMNS });
      const html = controller.renderEmptyStateHtml({
        title: 'Zero deals found',
        description: 'Try adjusting your search query',
        actionLabel: '+ New Deal',
      });

      expect(html).toContain('class="cs-empty-state"');
      expect(html).toContain('Zero deals found');
      expect(html).toContain('Try adjusting your search query');
      expect(html).toContain('+ New Deal');
      expect(html).toContain('cs-empty-cta-btn');
    });

    it('renders empty state in filter reset mode HTML', () => {
      const controller = new DataTableController({ columns: DEALS_COLUMNS });
      const html = controller.renderEmptyStateHtml({
        title: 'No matching records found',
        isFilterReset: true,
        actionLabel: 'Reset All Filters',
      });

      expect(html).toContain('class="cs-empty-state cs-empty-filter-state"');
      expect(html).toContain('cs-clear-all-filters-btn');
      expect(html).toContain('data-action="clear-all-filters"');
      expect(html).toContain('Reset All Filters');
    });

    it('renders sanitized error banner HTML with retry action', () => {
      const controller = new DataTableController({ columns: DEALS_COLUMNS });
      const html = controller.renderErrorAlertHtml('Database connection pool exhausted', {
        title: 'API Unavailable',
        onRetryAction: 'retry-load',
        retryLabel: 'Reload Pipeline',
      });

      expect(html).toContain('class="cs-error-banner"');
      expect(html).toContain('API Unavailable');
      expect(html).toContain('Database connection pool exhausted');
      expect(html).toContain('data-action="retry-load"');
      expect(html).toContain('Reload Pipeline');
    });

    it('renders 403 Forbidden access-denied view HTML', () => {
      const controller = new DataTableController({ columns: DEALS_COLUMNS });
      const html = controller.renderAccessDeniedHtml({
        requiredCapability: 'module.read',
        requiredRole: 'sales_manager',
        currentRole: 'viewer',
        resourceName: 'CRM-2 Deals Pipeline',
      });

      expect(html).toContain('id="cs-access-denied-view"');
      expect(html).toContain('403 Forbidden');
      expect(html).toContain('Access Denied');
      expect(html).toContain('module.read');
      expect(html).toContain('sales_manager');
      expect(html).toContain('viewer');
      expect(html).toContain('Return to Pipeline');
    });

    it('dispatches to appropriate HTML state based on renderHtml options', () => {
      const controller = new DataTableController({ columns: DEALS_COLUMNS });

      // 1. Access Denied (403)
      const deniedHtml = controller.renderHtml([], { isAccessDenied: true });
      expect(deniedHtml).toContain('403 Forbidden');

      // 2. Error
      const errorHtml = controller.renderHtml([], { error: 'Failed to fetch deals' });
      expect(errorHtml).toContain('class="cs-error-banner"');

      // 3. Loading
      const loadingHtml = controller.renderHtml([], { loading: true });
      expect(loadingHtml).toContain('class="cs-skeleton-container"');

      // 4. Empty (zero records)
      const emptyHtml = controller.renderHtml([]);
      expect(emptyHtml).toContain('class="cs-empty-state"');
      expect(emptyHtml).toContain('No records found');
    });
  });

  describe('6. DataTable React Component State Integration', () => {
    it('renders TableSkeleton when loading={true}', () => {
      const element = DataTable({
        columns: DEALS_COLUMNS,
        data: [],
        loading: true,
        loadingRowCount: 4,
      });

      expect(element.type).toBe(TableSkeleton);
      expect(element.props.rowCount).toBe(4);
      expect(element.props.columnCount).toBe(DEALS_COLUMNS.length);
    });

    it('renders ErrorAlert wrapped in error card when error is provided', () => {
      const onRetry = vi.fn();
      const element = DataTable({
        columns: DEALS_COLUMNS,
        data: [],
        error: 'Network connection dropped',
        onRetry,
      });

      expect(element.props.className).toContain('cs-table-error-wrapper');
      const innerAlert = element.props.children;
      expect(innerAlert.type).toBe(ErrorAlert);
      expect(innerAlert.props.error).toBe('Network connection dropped');
      expect(innerAlert.props.onRetry).toBe(onRetry);
    });

    it('renders AccessDeniedView when 403 Forbidden state is indicated', () => {
      const element = DataTable({
        columns: DEALS_COLUMNS,
        data: [],
        isAccessDenied: true,
        requiredCapability: 'module.read',
      });

      expect(element.type).toBe(AccessDeniedView);
      expect(element.props.requiredCapability).toBe('module.read');
    });

    it('renders EmptyState wrapped in table card when data is empty and not loading or erroring', () => {
      const onAction = vi.fn();
      const element = DataTable({
        columns: DEALS_COLUMNS,
        data: [],
        emptyTitle: 'No deal records',
        emptyActionLabel: 'Upload Deals',
        onEmptyAction: onAction,
      });

      expect(element.props.className).toContain('cs-table-card');
      const innerEmpty = element.props.children;
      expect(innerEmpty.type).toBe(EmptyState);
      expect(innerEmpty.props.title).toBe('No deal records');
      expect(innerEmpty.props.actionLabel).toBe('Upload Deals');
      expect(innerEmpty.props.onAction).toBe(onAction);
    });

    it('renders filter reset EmptyState when hasActiveFilters={true}', () => {
      const onClear = vi.fn();
      const element = DataTable({
        columns: DEALS_COLUMNS,
        data: [],
        hasActiveFilters: true,
        onClearFilters: onClear,
      });

      expect(element.props.className).toContain('cs-table-card');
      const innerEmpty = element.props.children;
      expect(innerEmpty.type).toBe(EmptyState);
      expect(innerEmpty.props.className).toBe('cs-empty-filter-state');
      expect(innerEmpty.props.icon).toBe('🔍');
      expect(innerEmpty.props.actionLabel).toBe('Reset All Filters');
    });
  });

  describe('7. DealsTable React Component State Integration', () => {
    it('renders TableSkeleton when loading={true}', () => {
      const element = DealsTable({
        deals: [],
        loading: true,
        loadingRowCount: 5,
      });

      expect(element.type).toBe(TableSkeleton);
      expect(element.props.rowCount).toBe(5);
    });

    it('renders ErrorAlert when error is provided', () => {
      const onRetry = vi.fn();
      const element = DealsTable({
        deals: [],
        error: '500 Server Error',
        onRetry,
      });

      expect(element.props.className).toContain('cs-table-error-wrapper');
      const alert = element.props.children;
      expect(alert.type).toBe(ErrorAlert);
      expect(alert.props.error).toBe('500 Server Error');
      expect(alert.props.onRetry).toBe(onRetry);
    });

    it('renders AccessDeniedView when isAccessDenied={true}', () => {
      const element = DealsTable({
        deals: [],
        isAccessDenied: true,
        requiredRole: 'crm2_editor',
      });

      expect(element.type).toBe(AccessDeniedView);
      expect(element.props.requiredRole).toBe('crm2_editor');
    });

    it('renders EmptyState when deals is empty', () => {
      const onAction = vi.fn();
      const element = DealsTable({
        deals: [],
        emptyTitle: 'No deals recorded',
        emptyActionLabel: '+ New Deal',
        onEmptyAction: onAction,
      });

      expect(element.props.className).toContain('cs-table-card');
      const empty = element.props.children;
      expect(empty.type).toBe(EmptyState);
      expect(empty.props.title).toBe('No deals recorded');
      expect(empty.props.actionLabel).toBe('+ New Deal');
    });
  });

  describe('8. DealsListPage Page State Integration', () => {
    it('renders TableSkeleton when isLoading={true}', () => {
      const element = DealsListPage({
        isLoading: true,
      });

      expect(element).not.toBeNull();
      const skeleton = findElement(element, (el) => el?.type === TableSkeleton);
      expect(skeleton).not.toBeNull();
      expect(skeleton?.props?.ariaLabel).toContain('Loading CRM deals');
    });

    it('renders ErrorAlert with onRetry when error is provided', () => {
      const onRetry = vi.fn();
      const element = DealsListPage({
        error: 'Database timeout',
        onRetry,
      });

      expect(element).not.toBeNull();
      const errorContainer = findElement(
        element,
        (el) => el?.props?.['data-testid'] === 'recoverable-error-state'
      );
      expect(errorContainer).not.toBeNull();
      const errorAlert = findElement(element, (el) => el?.type === ErrorAlert);
      expect(errorAlert).not.toBeNull();
      expect(errorAlert?.props?.error).toBe('Database timeout');
    });

    it('renders AccessDeniedView when isAccessDenied={true}', () => {
      const element = DealsListPage({
        isAccessDenied: true,
        requiredRole: 'admin',
      });

      expect(element).not.toBeNull();
      const accessDenied = findElement(element, (el) => el?.type === AccessDeniedView);
      expect(accessDenied).not.toBeNull();
      expect(accessDenied?.props?.requiredRole).toBe('admin');
    });

    it('renders DataTable with emptyActionLabel when empty', () => {
      const onAdd = vi.fn();
      const element = DealsListPage({
        isEmpty: true,
        emptyActionLabel: '+ Add Opportunity',
        onEmptyAction: onAdd,
      });

      expect(element).not.toBeNull();
      const emptyContainer = findElement(
        element,
        (el) => el?.props?.['data-testid'] === 'empty-results-state'
      );
      expect(emptyContainer).not.toBeNull();
      const actionBtn = findElement(
        emptyContainer,
        (el) => el?.props?.children === '+ Add Opportunity'
      );
      expect(actionBtn).not.toBeNull();
      expect(actionBtn?.props?.children).toBe('+ Add Opportunity');
    });
  });

  describe('9. PipelineOverviewPage and QuotesListPage State Integration', () => {
    it('PipelineOverviewPage renders AccessDeniedView on 403', () => {
      const element = PipelineOverviewPage({
        isAccessDenied: true,
        requiredCapability: 'crm2.pipeline.read',
      });

      expect(element.type).toBe(AccessDeniedView);
      expect(element.props.requiredCapability).toBe('crm2.pipeline.read');
    });

    it('PipelineOverviewPage renders ErrorAlert on error', () => {
      const onRetry = vi.fn();
      const element = PipelineOverviewPage({
        error: 'Failed to load stages',
        onRetry,
      });

      expect(element.props.className).toContain('cs-error-container');
      const alert = element.props.children;
      expect(alert.type).toBe(ErrorAlert);
      expect(alert.props.error).toBe('Failed to load stages');
    });

    it('PipelineOverviewPage renders TableSkeleton on loading', () => {
      const element = PipelineOverviewPage({
        isLoading: true,
        stages: [],
      });

      const skeleton = element.props.children;
      expect(skeleton.type).toBe(TableSkeleton);
    });

    it('PipelineOverviewPage renders EmptyState when stages are empty', () => {
      const onCreate = vi.fn();
      const element = PipelineOverviewPage({
        stages: [],
        isEmpty: true,
        onCreateDeal: onCreate,
      });

      const empty = element.props.children;
      expect(empty.type).toBe(EmptyState);
      expect(empty.props.title).toBe('No pipeline stages found');
      expect(empty.props.actionLabel).toBe('+ New Opportunity');
    });

    it('QuotesListPage renders AccessDeniedView on 403', () => {
      const element = QuotesListPage({
        isAccessDenied: true,
        requiredRole: 'finance_manager',
      });

      expect(element.type).toBe(AccessDeniedView);
      expect(element.props.requiredRole).toBe('finance_manager');
    });

    it('QuotesListPage renders ErrorAlert on error', () => {
      const onRetry = vi.fn();
      const element = QuotesListPage({
        error: 'Pricing engine unreachable',
        onRetry,
      });

      expect(element.props.className).toContain('cs-error-container');
      const alert = element.props.children;
      expect(alert.type).toBe(ErrorAlert);
      expect(alert.props.error).toBe('Pricing engine unreachable');
    });

    it('QuotesListPage renders TableSkeleton on loading', () => {
      const element = QuotesListPage({
        isLoading: true,
        data: [],
      });

      const skeleton = element.props.children;
      expect(skeleton.type).toBe(TableSkeleton);
    });

    it('QuotesListPage renders EmptyState when quotes are empty', () => {
      const onAction = vi.fn();
      const element = QuotesListPage({
        isEmpty: true,
        emptyActionLabel: 'Create First Quote',
        onEmptyAction: onAction,
      });

      const empty = element.props.children;
      expect(empty.type).toBe(EmptyState);
      expect(empty.props.title).toBe('No quotes found');
      expect(empty.props.actionLabel).toBe('Create First Quote');
    });
  });
});
