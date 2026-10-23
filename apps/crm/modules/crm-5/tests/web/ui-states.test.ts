import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import {
  TableSkeleton,
  EmptyState,
  ErrorAlert,
  sanitizeErrorMessage,
  AccessDeniedView,
  DataTable,
} from '../../web/index.js';
import { DataTableController } from '../../web/table/DataTableController.js';
import { RUNS_COLUMNS } from '../../web/table/columns.js';

describe('CRM-5 UI Loading, Empty, Error, and 403 Access-Denied States (Issue #192 / CRM5-19)', () => {
  describe('1. TableSkeleton Component', () => {
    it('renders animated table skeleton placeholder with WAI-ARIA attributes', () => {
      const element = TableSkeleton({
        rowCount: 5,
        columnCount: 6,
        ariaLabel: 'Loading migration runs...',
      });

      expect(element).toBeDefined();
      expect(element.props['aria-busy']).toBe('true');
      expect(element.props.role).toBe('status');
      expect(element.props['aria-label']).toBe('Loading migration runs...');
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
        ariaLabel: 'Fetching batches in background...',
      });

      const srSpan = element.props.children[0];
      expect(srSpan.props.className).toBe('cs-sr-only');
      expect(srSpan.props.children).toBe('Fetching batches in background...');
    });
  });

  describe('2. EmptyState Component', () => {
    it('renders zero-data empty state with icon, title, and description', () => {
      const element = EmptyState({
        title: 'No duplicate records found',
        description: 'Zero duplicate customer records were identified.',
        icon: '🔍',
      });

      expect(element.props.role).toBe('status');
      expect(element.props['aria-label']).toBe('No duplicate records found');
      expect(element.props.className).toContain('cs-empty-state');
    });

    it('renders primary call-to-action button and fires callback on click', () => {
      const onAction = vi.fn();
      const element = EmptyState({
        title: 'No migration batches',
        actionLabel: 'Create Migration Batch',
        onAction,
      });

      const actionsDiv = element.props.children[3];
      expect(actionsDiv).toBeDefined();

      const [primaryBtn] = actionsDiv.props.children;
      expect(primaryBtn.props.type).toBe('button');
      expect(primaryBtn.props.className).toContain('cs-empty-cta-btn');
      expect(primaryBtn.props.children).toBe('Create Migration Batch');

      // Execute callback
      primaryBtn.props.onClick();
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('renders secondary action button and fires callback on click', () => {
      const onSecondary = vi.fn();
      const element = EmptyState({
        title: 'Empty table',
        actionLabel: 'Primary CTA',
        onAction: vi.fn(),
        secondaryActionLabel: 'Learn More',
        onSecondaryAction: onSecondary,
      });

      const actionsDiv = element.props.children[3];
      const [, secondaryBtn] = actionsDiv.props.children;
      expect(secondaryBtn.props.type).toBe('button');
      expect(secondaryBtn.props.className).toContain('cs-empty-secondary-btn');
      expect(secondaryBtn.props.children).toBe('Learn More');

      secondaryBtn.props.onClick();
      expect(onSecondary).toHaveBeenCalledTimes(1);
    });

    it('adds reset filter classes and attributes when used in filter reset mode', () => {
      const onReset = vi.fn();
      const element = EmptyState({
        title: 'No matching records',
        actionLabel: 'Reset All Filters',
        onAction: onReset,
        className: 'cs-empty-filter-state',
      });

      const actionsDiv = element.props.children[3];
      const [ctaBtn] = actionsDiv.props.children;
      expect(ctaBtn.props.className).toContain('cs-clear-all-filters-btn');
      expect(ctaBtn.props.className).toContain('cs-empty-reset-btn');
      expect(ctaBtn.props['data-action']).toBe('clear-all-filters');
    });
  });

  describe('3. ErrorAlert & Error Sanitization (Security Invariant)', () => {
    it('sanitizes JavaScript stack traces and file paths from errors', () => {
      const dirtyStackError = new Error(
        'Database query failed on syntax error\n' +
          '  at executeQuery (/Users/dhruv29/Clearshift-CRM/node_modules/pg/client.js:123:45)\n' +
          '  at async RunController.getRuns (/Users/dhruv29/Clearshift-CRM/apps/crm/modules/crm-5/src/api/runs.ts:40:12)'
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
        message: 'Too many requests. Please wait 30 seconds before retrying.',
      };

      const sanitized = sanitizeErrorMessage(apiErrorObj);
      expect(sanitized).toBe('Too many requests. Please wait 30 seconds before retrying.');
    });

    it('falls back to code message when message is absent in error object', () => {
      const codeOnlyObj = { code: 'UNAUTHORIZED_UPSTREAM' };
      const sanitized = sanitizeErrorMessage(codeOnlyObj);
      expect(sanitized).toBe('Server returned error code: UNAUTHORIZED_UPSTREAM');
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
      const element = ErrorAlert({
        error: 'Failed to fetch migration runs from cluster',
        title: 'Cluster Communication Error',
        onRetry,
        retryLabel: 'Retry Query',
      });

      expect(element).toBeDefined();
      expect(element!.props.role).toBe('alert');
      expect(element!.props['aria-live']).toBe('assertive');
      expect(element!.props.className).toContain('cs-error-banner');

      // Locate retry button
      const actionsDiv = element!.props.children[1];
      const [retryBtn] = actionsDiv.props.children;
      expect(retryBtn.props.type).toBe('button');
      expect(retryBtn.props.className).toBe('cs-error-retry-btn');
      expect(retryBtn.props.children).toBe('Retry Query');

      retryBtn.props.onClick();
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('renders dismiss button and invokes onDismiss when triggered', () => {
      const onDismiss = vi.fn();
      const element = ErrorAlert({
        error: 'Temporary warning',
        onDismiss,
      });

      const actionsDiv = element!.props.children[1];
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

  describe('4. AccessDeniedView (403 Forbidden State)', () => {
    it('renders 403 Forbidden view explaining missing role and capability', () => {
      const element = AccessDeniedView({
        requiredCapability: 'control:read',
        requiredRole: 'migration_admin',
        currentRole: 'auditor',
        resourceName: 'Migration Runs Overview',
      });

      expect(element.props.role).toBe('region');
      expect(element.props['aria-labelledby']).toBe('cs-access-denied-title');
      expect(element.props.className).toContain('cs-access-denied-card');

      const contentDiv = element.props.children[1];
      const [badge, title, desc, metaDiv] = contentDiv.props.children;

      expect(badge.props.children).toBe('403 Forbidden');
      expect(title.props.children).toBe('Access Denied');
      expect(desc.props.children).toContain('Migration Runs Overview');
      expect(desc.props.children).toContain('control:read');

      // Meta items
      const metaItems = metaDiv.props.children;
      expect(metaItems).toHaveLength(3); // capability, role, currentRole
    });

    it('provides keyboard-accessible return button when onBack callback is passed', () => {
      const onBack = vi.fn();
      const element = AccessDeniedView({
        onBack,
      });

      const contentDiv = element.props.children[1];
      const actionsDiv = contentDiv.props.children[4];
      const backBtn = actionsDiv.props.children;

      expect(backBtn.props.type).toBe('button');
      expect(backBtn.props.className).toContain('cs-access-back-btn');
      expect(backBtn.props.children).toBe('Return to Control Center');

      backBtn.props.onClick();
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('renders standard navigation anchor when onBack is omitted', () => {
      const element = AccessDeniedView({
        backHref: '/crm-5/dashboard',
      });

      const contentDiv = element.props.children[1];
      const actionsDiv = contentDiv.props.children[4];
      const backAnchor = actionsDiv.props.children;

      expect(backAnchor.props.href).toBe('/crm-5/dashboard');
      expect(backAnchor.props.className).toContain('cs-access-back-btn');
    });
  });

  describe('5. DataTableController HTML State Renderers', () => {
    it('renders loading skeleton table HTML with shimmer headers and cells', () => {
      const controller = new DataTableController({ columns: RUNS_COLUMNS });
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
      const controller = new DataTableController({ columns: RUNS_COLUMNS });
      const html = controller.renderErrorAlertHtml('Connection timeout to CRM-5 backend', {
        title: 'Network Gateway Error',
        onRetryAction: 'fetch-runs',
        retryLabel: 'Try Again',
      });

      expect(html).toContain('class="cs-error-banner"');
      expect(html).toContain('role="alert"');
      expect(html).toContain('Network Gateway Error');
      expect(html).toContain('Connection timeout to CRM-5 backend');
      expect(html).toContain('data-action="fetch-runs"');
      expect(html).toContain('Try Again');
    });

    it('renders empty state HTML with call-to-action button', () => {
      const controller = new DataTableController({ columns: RUNS_COLUMNS });
      const html = controller.renderEmptyStateHtml({
        title: 'No active batches',
        description: 'Start your first data migration batch.',
        actionLabel: 'New Batch',
        actionName: 'start-batch',
      });

      expect(html).toContain('class="cs-empty-state"');
      expect(html).toContain('No active batches');
      expect(html).toContain('Start your first data migration batch.');
      expect(html).toContain('data-action="start-batch"');
      expect(html).toContain('New Batch');
    });

    it('renders filter-reset empty state HTML when filters yield zero records', () => {
      const controller = new DataTableController({ columns: RUNS_COLUMNS });
      const html = controller.renderEmptyStateHtml({
        title: 'No matching records found',
        description: 'Try adjusting your filters.',
        actionLabel: 'Reset All Filters',
        isFilterReset: true,
      });

      expect(html).toContain('cs-empty-filter-state');
      expect(html).toContain('cs-clear-all-filters-btn');
      expect(html).toContain('cs-empty-reset-btn');
      expect(html).toContain('data-action="clear-all-filters');
    });

    it('renders 403 Forbidden access-denied view HTML', () => {
      const controller = new DataTableController({ columns: RUNS_COLUMNS });
      const html = controller.renderAccessDeniedHtml({
        requiredCapability: 'control:read',
        requiredRole: 'migration_admin',
        currentRole: 'viewer',
        resourceName: 'CRM-5 Duplicates Queue',
      });

      expect(html).toContain('id="cs-access-denied-view"');
      expect(html).toContain('403 Forbidden');
      expect(html).toContain('Access Denied');
      expect(html).toContain('control:read');
      expect(html).toContain('migration_admin');
      expect(html).toContain('viewer');
      expect(html).toContain('Return to Control Center');
    });

    it('dispatches to appropriate HTML state based on renderHtml options', () => {
      const controller = new DataTableController({ columns: RUNS_COLUMNS });

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

  describe('6. DataTable React Component State Integration', () => {
    it('renders TableSkeleton when loading={true}', () => {
      const element = DataTable({
        columns: RUNS_COLUMNS,
        data: [],
        loading: true,
        loadingRowCount: 4,
      });

      expect(element.type).toBe(TableSkeleton);
      expect(element.props.rowCount).toBe(4);
      expect(element.props.columnCount).toBe(RUNS_COLUMNS.length);
    });

    it('renders ErrorAlert wrapped in error card when error is provided', () => {
      const onRetry = vi.fn();
      const element = DataTable({
        columns: RUNS_COLUMNS,
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
        columns: RUNS_COLUMNS,
        data: [],
        isAccessDenied: true,
        requiredCapability: 'control:read',
      });

      expect(element.type).toBe(AccessDeniedView);
      expect(element.props.requiredCapability).toBe('control:read');
    });

    it('renders EmptyState wrapped in table card when data is empty and not loading or erroring', () => {
      const onAction = vi.fn();
      const element = DataTable({
        columns: RUNS_COLUMNS,
        data: [],
        emptyTitle: 'No batch records',
        emptyActionLabel: 'Upload CSV',
        onEmptyAction: onAction,
      });

      expect(element.props.className).toContain('cs-table-card');
      const innerEmpty = element.props.children;
      expect(innerEmpty.type).toBe(EmptyState);
      expect(innerEmpty.props.title).toBe('No batch records');
      expect(innerEmpty.props.actionLabel).toBe('Upload CSV');
      expect(innerEmpty.props.onAction).toBe(onAction);
    });
  });
});
