import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import {
  TableSkeleton,
  EmptyState,
  ErrorAlert,
  sanitizeErrorMessage,
  AccessDeniedView,
  DataTable,
  MarketingListsTable,
  MarketingListsPage,
  DataTableController,
  MARKETING_LISTS_COLUMNS,
} from '../index.js';

// Safe typed helper for JSX testing in Node/Vitest environment
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asEl = (node: unknown): any => node as any;

describe('CRM-4 UI Loading, Empty, Error, and 403 Access-Denied States (Issue #172 / CRM4-19)', () => {
  beforeEach(() => {
    const dispatcher = {
      useState: (initial: unknown) => [
        typeof initial === 'function' ? (initial as () => unknown)() : initial,
        vi.fn(),
      ],
      useId: () => ':crm4-test-id:',
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

  // ---------------------------------------------------------------------------
  // 1. TableSkeleton Component (Acceptance Criterion 1)
  // ---------------------------------------------------------------------------
  describe('1. TableSkeleton Component (Loading State)', () => {
    it('renders animated table skeleton placeholder with WAI-ARIA attributes', () => {
      const element = asEl(
        TableSkeleton({
          rowCount: 5,
          columnCount: 6,
          ariaLabel: 'Loading marketing lists...',
        })
      );

      expect(element).toBeDefined();
      expect(element.props['aria-busy']).toBe('true');
      expect(element.props.role).toBe('status');
      expect(element.props['aria-label']).toBe('Loading marketing lists...');
      expect(element.props.className).toContain('cs-skeleton-card');
    });

    it('creates table rows and columns matching requested counts and columnWidths', () => {
      const element = asEl(
        TableSkeleton({
          rowCount: 3,
          columnCount: 4,
          columnWidths: ['120px', '200px', '150px', '100px'],
        })
      );

      // Virtual DOM hierarchy: [srSpan, responsiveDiv]
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
      const element = asEl(
        TableSkeleton({
          ariaLabel: 'Fetching campaign lists in background...',
        })
      );

      const srSpan = element.props.children[0];
      expect(srSpan.props.className).toBe('cs-sr-only');
      expect(srSpan.props.children).toBe('Fetching campaign lists in background...');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. EmptyState Component (Acceptance Criterion 2)
  // ---------------------------------------------------------------------------
  describe('2. EmptyState Component (Zero-Data State)', () => {
    it('renders zero-data empty state with icon, title, and description', () => {
      const element = asEl(
        EmptyState({
          title: 'No marketing lists found',
          description: 'No marketing lists or audience segments have been created yet.',
          icon: '📁',
        })
      );

      expect(element.props.role).toBe('status');
      expect(element.props['aria-label']).toBe('No marketing lists found');
      expect(element.props.className).toContain('cs-empty-state');
    });

    it('renders primary call-to-action button and fires callback on click', () => {
      const onAction = vi.fn();
      const element = asEl(
        EmptyState({
          title: 'No marketing lists registered',
          actionLabel: 'Create New List',
          onAction,
        })
      );

      const actionsDiv = element.props.children[3];
      expect(actionsDiv).toBeDefined();

      const [primaryBtn] = actionsDiv.props.children;
      expect(primaryBtn.props.type).toBe('button');
      expect(primaryBtn.props.className).toContain('cs-empty-cta-btn');
      expect(primaryBtn.props.children).toBe('Create New List');

      primaryBtn.props.onClick();
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('renders secondary action button and fires callback on click', () => {
      const onSecondary = vi.fn();
      const element = asEl(
        EmptyState({
          title: 'Empty lists view',
          actionLabel: '+ New List',
          onAction: vi.fn(),
          secondaryActionLabel: 'Import CSV',
          onSecondaryAction: onSecondary,
        })
      );

      const actionsDiv = element.props.children[3];
      const [, secondaryBtn] = actionsDiv.props.children;
      expect(secondaryBtn.props.type).toBe('button');
      expect(secondaryBtn.props.className).toContain('cs-empty-secondary-btn');
      expect(secondaryBtn.props.children).toBe('Import CSV');

      secondaryBtn.props.onClick();
      expect(onSecondary).toHaveBeenCalledTimes(1);
    });

    it('adds reset filter classes and attributes when used in filter reset mode', () => {
      const onReset = vi.fn();
      const element = asEl(
        EmptyState({
          title: 'No matching marketing lists',
          actionLabel: 'Reset All Filters',
          onAction: onReset,
          className: 'cs-empty-filter-state',
        })
      );

      const actionsDiv = element.props.children[3];
      const [ctaBtn] = actionsDiv.props.children;
      expect(ctaBtn.props.className).toContain('cs-clear-all-filters-btn');
      expect(ctaBtn.props.className).toContain('cs-empty-reset-btn');
      expect(ctaBtn.props['data-action']).toBe('clear-all-filters');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. ErrorAlert & Error Sanitization (Acceptance Criterion 3 — Security Invariant)
  // ---------------------------------------------------------------------------
  describe('3. ErrorAlert & Error Sanitization (Security Invariant)', () => {
    it('sanitizes JavaScript stack traces and file paths from error messages', () => {
      const dirtyStackError = new Error(
        'Database query failed on syntax error\n' +
          '  at executeQuery (/Users/engineer/Clearshift-CRM/node_modules/pg/client.js:123:45)\n' +
          '  at async MarketingListController.getLists (/Users/engineer/Clearshift-CRM/apps/crm/modules/crm-4/src/api/lists.ts:40:12)'
      );

      const sanitized = sanitizeErrorMessage(dirtyStackError);
      expect(sanitized).toBe('Database query failed on syntax error');
      expect(sanitized).not.toContain('/Users/');
      expect(sanitized).not.toContain('node_modules');
      expect(sanitized).not.toContain('at executeQuery');
    });

    it('extracts message from structured server error objects', () => {
      const apiErrorObj = {
        code: 'ERR_RATE_LIMIT_EXCEEDED',
        message: 'Too many marketing queries. Please wait 30 seconds before retrying.',
      };

      const sanitized = sanitizeErrorMessage(apiErrorObj);
      expect(sanitized).toBe('Too many marketing queries. Please wait 30 seconds before retrying.');
    });

    it('falls back to code message when message is absent in error object', () => {
      const codeOnlyObj = { code: 'UNAUTHORIZED_MARKETING_ACCESS' };
      const sanitized = sanitizeErrorMessage(codeOnlyObj);
      expect(sanitized).toBe('Server returned error code: UNAUTHORIZED_MARKETING_ACCESS');
    });

    it('provides safe default fallback when error is null or undefined', () => {
      expect(sanitizeErrorMessage(null)).toBe(
        'An unexpected error occurred while communicating with the server.'
      );
      expect(sanitizeErrorMessage(undefined)).toBe(
        'An unexpected error occurred while communicating with the server.'
      );
    });

    it('caps message length to 240 characters to prevent UI blowout', () => {
      const longMessage = 'A'.repeat(300);
      const sanitized = sanitizeErrorMessage(longMessage);
      expect(sanitized.length).toBeLessThanOrEqual(240);
      expect(sanitized.endsWith('...')).toBe(true);
    });

    it('renders ErrorAlert banner with role="alert" and accessible Retry button', () => {
      const onRetry = vi.fn();
      const element = asEl(
        ErrorAlert({
          error: 'Failed to fetch marketing lists from backend',
          title: 'Network Communication Error',
          onRetry,
          retryLabel: 'Retry Query',
        })
      );

      expect(element).toBeDefined();
      expect(element.props.role).toBe('alert');
      expect(element.props['aria-live']).toBe('assertive');
      expect(element.props.className).toContain('cs-error-banner');

      // Locate retry button
      const actionsDiv = element.props.children[1];
      const [retryBtn] = actionsDiv.props.children;
      expect(retryBtn.props.type).toBe('button');
      expect(retryBtn.props.className).toBe('cs-error-retry-btn');
      expect(retryBtn.props.children).toBe('Retry Query');

      retryBtn.props.onClick();
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('renders dismiss button and invokes onDismiss when triggered', () => {
      const onDismiss = vi.fn();
      const element = asEl(
        ErrorAlert({
          error: 'Temporary marketing warning',
          onDismiss,
        })
      );

      const actionsDiv = element.props.children[1];
      const [, dismissBtn] = actionsDiv.props.children;
      expect(dismissBtn.props.type).toBe('button');
      expect(dismissBtn.props.className).toBe('cs-error-dismiss-btn');

      dismissBtn.props.onClick();
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('returns null when error is null or empty', () => {
      const element = ErrorAlert({ error: null });
      expect(element).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. AccessDeniedView (Acceptance Criterion 4 — 403 Forbidden State)
  // ---------------------------------------------------------------------------
  describe('4. AccessDeniedView (403 Forbidden State)', () => {
    it('renders 403 Forbidden view explaining missing role and capability', () => {
      const element = asEl(
        AccessDeniedView({
          requiredCapability: 'module.read',
          requiredRole: 'editor',
          currentRole: 'viewer',
          resourceName: 'Marketing Lists and Campaign History',
        })
      );

      expect(element.props.role).toBe('region');
      expect(element.props['aria-labelledby']).toBe('cs-access-denied-title');
      expect(element.props.className).toContain('cs-access-denied-card');

      const contentDiv = element.props.children[1];
      const [badge, title, desc, metaDiv] = contentDiv.props.children;

      expect(badge.props.children).toBe('403 Forbidden');
      expect(title.props.children).toBe('Access Denied');
      expect(desc.props.children).toContain('Marketing Lists and Campaign History');
      expect(desc.props.children).toContain('module.read');

      // Meta items: capability, role, currentRole
      const metaItems = metaDiv.props.children;
      expect(metaItems).toHaveLength(3);
    });

    it('provides keyboard-accessible return button when onBack callback is passed', () => {
      const onBack = vi.fn();
      const element = asEl(
        AccessDeniedView({
          onBack,
        })
      );

      const contentDiv = element.props.children[1];
      const actionsDiv = contentDiv.props.children[4];
      const backBtn = actionsDiv.props.children;

      expect(backBtn.props.type).toBe('button');
      expect(backBtn.props.className).toContain('cs-access-back-btn');
      expect(backBtn.props.children).toBe('Return to Directory');

      backBtn.props.onClick();
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('renders standard navigation anchor when onBack is omitted', () => {
      const element = asEl(
        AccessDeniedView({
          backHref: '/crm-4/lists',
        })
      );

      const contentDiv = element.props.children[1];
      const actionsDiv = contentDiv.props.children[4];
      const backAnchor = actionsDiv.props.children;

      expect(backAnchor.props.href).toBe('/crm-4/lists');
      expect(backAnchor.props.className).toContain('cs-access-back-btn');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. DataTableController HTML State Renderers
  // ---------------------------------------------------------------------------
  describe('5. DataTableController HTML State Renderers', () => {
    it('renders loading skeleton table HTML with shimmer headers and cells', () => {
      const controller = new DataTableController({ columns: MARKETING_LISTS_COLUMNS });
      const html = controller.renderTableSkeletonHtml(4);

      expect(html).toContain('class="cs-skeleton-container"');
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('cs-skeleton-table');
      expect(html).toContain('cs-skeleton-header-cell');
      expect(html).toContain('cs-skeleton-cell');
      expect(html).toContain('cs-skeleton-row');
    });

    it('renders sanitized error banner HTML with retry button', () => {
      const controller = new DataTableController({ columns: MARKETING_LISTS_COLUMNS });
      const html = controller.renderErrorAlertHtml('Connection timeout to CRM-4 backend', {
        title: 'Network Gateway Error',
        onRetryAction: 'fetch-lists',
        retryLabel: 'Try Again',
      });

      expect(html).toContain('class="cs-error-banner"');
      expect(html).toContain('role="alert"');
      expect(html).toContain('Network Gateway Error');
      expect(html).toContain('Connection timeout to CRM-4 backend');
      expect(html).toContain('data-action="fetch-lists"');
      expect(html).toContain('Try Again');
    });

    it('renders empty state HTML with call-to-action button', () => {
      const controller = new DataTableController({ columns: MARKETING_LISTS_COLUMNS });
      const html = controller.renderEmptyStateHtml({
        title: 'No marketing lists found',
        description: 'Create your first marketing segment.',
        actionLabel: '+ New List',
        actionName: 'create-list',
      });

      expect(html).toContain('class="cs-empty-state"');
      expect(html).toContain('No marketing lists found');
      expect(html).toContain('Create your first marketing segment.');
      expect(html).toContain('data-action="create-list"');
      expect(html).toContain('+ New List');
    });

    it('renders filter-reset empty state HTML when filters yield zero records', () => {
      const controller = new DataTableController({ columns: MARKETING_LISTS_COLUMNS });
      const html = controller.renderEmptyStateHtml({
        title: 'No matching records found',
        description: 'Try adjusting your filters.',
        actionLabel: 'Reset All Filters',
        isFilterReset: true,
      });

      expect(html).toContain('cs-empty-filter-state');
      expect(html).toContain('cs-clear-all-filters-btn');
      expect(html).toContain('cs-empty-reset-btn');
      expect(html).toContain('data-action="clear-all-filters"');
    });

    it('renders 403 Forbidden access-denied view HTML', () => {
      const controller = new DataTableController({ columns: MARKETING_LISTS_COLUMNS });
      const html = controller.renderAccessDeniedHtml({
        requiredCapability: 'module.read',
        requiredRole: 'editor',
        currentRole: 'viewer',
        resourceName: 'Marketing Lists and Campaign History',
      });

      expect(html).toContain('id="cs-access-denied-view"');
      expect(html).toContain('403 Forbidden');
      expect(html).toContain('Access Denied');
      expect(html).toContain('module.read');
      expect(html).toContain('editor');
      expect(html).toContain('viewer');
      expect(html).toContain('Return to Directory');
    });

    it('dispatches to appropriate HTML state based on renderHtml options', () => {
      const controller = new DataTableController({ columns: MARKETING_LISTS_COLUMNS });

      // 1. Access Denied (403)
      const deniedHtml = controller.renderHtml([], { isAccessDenied: true });
      expect(deniedHtml).toContain('403 Forbidden');

      // 2. Error
      const errorHtml = controller.renderHtml([], { error: 'Failed to fetch' });
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

  // ---------------------------------------------------------------------------
  // 6. DataTable React Component State Integration
  // ---------------------------------------------------------------------------
  describe('6. DataTable React Component State Integration', () => {
    it('renders TableSkeleton when loading={true}', () => {
      const element = asEl(
        DataTable({
          columns: MARKETING_LISTS_COLUMNS,
          data: [],
          loading: true,
          loadingRowCount: 4,
        })
      );

      expect(element.type).toBe(TableSkeleton);
      expect(element.props.rowCount).toBe(4);
      expect(element.props.columnCount).toBe(MARKETING_LISTS_COLUMNS.length);
      expect(element.props.role).toBe('status');
      expect(element.props['aria-label']).toBe('Loading table data');
    });

    it('renders Alert banner with sanitized stack trace when error is provided', () => {
      const onRetry = vi.fn();
      const dirtyStackError = new Error(
        'Database connection timed out\n' +
          '  at executeQuery (/Users/engineer/node_modules/pg/client.js:12:34)'
      );

      const element = asEl(
        DataTable({
          columns: MARKETING_LISTS_COLUMNS,
          data: [],
          error: dirtyStackError,
          onRetry,
        })
      );

      expect(element.props.className).toContain('cs-table-error-wrapper');
      expect(element.props.role).toBe('region');
      expect(element.props['aria-label']).toBe('Table Error Banner');

      const alert = asEl(element.props.children);
      expect(alert.props.title).toBe('Unable to load table data');
      const textMsg = asEl(alert.props.children[0]).props.children;
      expect(textMsg).toBe('Database connection timed out');
      expect(textMsg).not.toContain('node_modules');
      expect(textMsg).not.toContain('at executeQuery');

      const retryBtn = asEl(alert.props.children[1].props.children);
      expect(retryBtn.props['aria-label']).toBe('Retry loading table data');
      retryBtn.props.onClick();
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('renders AccessDeniedView when 403 Forbidden state is indicated', () => {
      const element = asEl(
        DataTable({
          columns: MARKETING_LISTS_COLUMNS,
          data: [],
          isAccessDenied: true,
          requiredCapability: 'module.read',
        })
      );

      expect(element.type).toBe(AccessDeniedView);
      expect(element.props.requiredCapability).toBe('module.read');
    });

    it('renders EmptyState wrapped in table card when data is empty and not loading or erroring', () => {
      const onAction = vi.fn();
      const element = asEl(
        DataTable({
          columns: MARKETING_LISTS_COLUMNS,
          data: [],
          emptyTitle: 'No marketing lists',
          emptyActionLabel: '+ New List',
          onEmptyAction: onAction,
        })
      );

      expect(element.props.className).toContain('cs-table-card');
      const innerEmpty = asEl(element.props.children);
      expect(innerEmpty.type).toBe(EmptyState);
      expect(innerEmpty.props.title).toBe('No marketing lists');
      expect(innerEmpty.props.actionLabel).toBe('+ New List');
      expect(innerEmpty.props.onAction).toBe(onAction);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. MarketingListsTable UI State Integration
  // ---------------------------------------------------------------------------
  describe('7. MarketingListsTable Component State Integration', () => {
    it('renders loading TableSkeleton when loading={true}', () => {
      const element = asEl(
        MarketingListsTable({
          lists: [],
          loading: true,
          loadingRowCount: 6,
        })
      );

      expect(element.props.role).toBe('status');
      expect(element.props['aria-busy']).toBe('true');
      const skeleton = asEl(element.props.children);
      expect(skeleton.type).toBe(TableSkeleton);
      expect(skeleton.props.rowCount).toBe(6);
    });

    it('renders ErrorAlert when error is provided', () => {
      const onRetry = vi.fn();
      const element = asEl(
        MarketingListsTable({
          lists: [],
          error: 'API server unreachable',
          onRetry,
        })
      );

      expect(element.props.className).toContain('cs-table-error-wrapper');
      const errorAlert = asEl(element.props.children);
      expect(errorAlert.type).toBe(ErrorAlert);
      expect(errorAlert.props.error).toBe('API server unreachable');
      expect(errorAlert.props.onRetry).toBe(onRetry);
    });

    it('renders AccessDeniedView when isAccessDenied={true}', () => {
      const element = asEl(
        MarketingListsTable({
          lists: [],
          isAccessDenied: true,
          requiredCapability: 'marketing.view',
        })
      );

      expect(element.type).toBe(AccessDeniedView);
      expect(element.props.requiredCapability).toBe('marketing.view');
    });

    it('renders EmptyState with action button when lists are empty and action props provided', () => {
      const onAdd = vi.fn();
      const element = asEl(
        MarketingListsTable({
          lists: [],
          emptyTitle: 'No lists created',
          emptyActionLabel: '+ New List',
          onEmptyAction: onAdd,
        })
      );

      expect(element.type).toBe(EmptyState);
      expect(element.props.title).toBe('No lists created');
      expect(element.props.actionLabel).toBe('+ New List');
      expect(element.props.onAction).toBe(onAdd);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. MarketingListsPage Page State Integration
  // ---------------------------------------------------------------------------
  describe('8. MarketingListsPage State Integration', () => {
    it('passes emptyActionLabel and onEmptyAction to MarketingListsTable when onCreateList is provided', () => {
      const onCreateList = vi.fn();
      const element = asEl(
        MarketingListsPage({
          initialLists: [],
          initialTotalCount: 0,
          onCreateList,
        })
      );

      const [, , , , dataCard] = element.props.children;
      expect(dataCard).toBeDefined();
      const table = asEl(dataCard.props.children[0]);
      expect(table.type).toBe(MarketingListsTable);
      expect(table.props.emptyActionLabel).toBe('+ New List');
      expect(table.props.onEmptyAction).toBe(onCreateList);
    });
  });
});
