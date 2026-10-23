import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import {
  TableSkeleton,
  EmptyState,
  ErrorAlert,
  sanitizeErrorMessage,
  AccessDeniedView,
  DataTable,
  ContactsListPage,
} from '../../web/index.js';
import { DataTableController } from '../../web/table/DataTableController.js';
import { CONTACTS_COLUMNS } from '../../web/table/columns.js';

describe('CRM-1 UI Loading, Empty, Error, and 403 Access-Denied States (Issue #112 / CRM1-19)', () => {
  describe('1. TableSkeleton Component', () => {
    it('renders animated table skeleton placeholder with WAI-ARIA attributes', () => {
      const element = TableSkeleton({
        rowCount: 5,
        columnCount: 6,
        ariaLabel: 'Loading contacts directory...',
      });

      expect(element).toBeDefined();
      expect(element.props['aria-busy']).toBe('true');
      expect(element.props.role).toBe('status');
      expect(element.props['aria-label']).toBe('Loading contacts directory...');
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
        ariaLabel: 'Fetching contacts in background...',
      });

      const srSpan = element.props.children[0];
      expect(srSpan.props.className).toBe('cs-sr-only');
      expect(srSpan.props.children).toBe('Fetching contacts in background...');
    });
  });

  describe('2. EmptyState Component', () => {
    it('renders zero-data empty state with icon, title, and description', () => {
      const element = EmptyState({
        title: 'No contact records found',
        description: 'Zero contact records were found matching your criteria.',
        icon: '📁',
      });

      expect(element.props.role).toBe('status');
      expect(element.props['aria-label']).toBe('No contact records found');
      expect(element.props.className).toContain('cs-empty-state');
    });

    it('renders primary call-to-action button and fires callback on click', () => {
      const onAction = vi.fn();
      const element = EmptyState({
        title: 'No contacts registered',
        actionLabel: 'Add Contact',
        onAction,
      });

      const actionsDiv = element.props.children[3];
      expect(actionsDiv).toBeDefined();

      const [primaryBtn] = actionsDiv.props.children;
      expect(primaryBtn.props.type).toBe('button');
      expect(primaryBtn.props.className).toContain('cs-empty-cta-btn');
      expect(primaryBtn.props.children).toBe('Add Contact');

      primaryBtn.props.onClick();
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('renders secondary action button and fires callback on click', () => {
      const onSecondary = vi.fn();
      const element = EmptyState({
        title: 'Empty directory',
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
          '  at executeQuery (/Users/engineer/Clearshift-CRM/node_modules/pg/client.js:123:45)\n' +
          '  at async ContactController.getContacts (/Users/engineer/Clearshift-CRM/apps/crm/modules/crm-1/src/api/contacts.ts:40:12)'
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
        error: 'Failed to fetch contacts from server',
        title: 'Network Communication Error',
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
        requiredCapability: 'module.read',
        requiredRole: 'editor',
        currentRole: 'viewer',
        resourceName: 'Contacts Directory',
      });

      expect(element.props.role).toBe('region');
      expect(element.props['aria-labelledby']).toBe('cs-access-denied-title');
      expect(element.props.className).toContain('cs-access-denied-card');

      const contentDiv = element.props.children[1];
      const [badge, title, desc, metaDiv] = contentDiv.props.children;

      expect(badge.props.children).toBe('403 Forbidden');
      expect(title.props.children).toBe('Access Denied');
      expect(desc.props.children).toContain('Contacts Directory');
      expect(desc.props.children).toContain('module.read');

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
      expect(backBtn.props.children).toBe('Return to Directory');

      backBtn.props.onClick();
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('renders standard navigation anchor when onBack is omitted', () => {
      const element = AccessDeniedView({
        backHref: '/crm-1/contacts',
      });

      const contentDiv = element.props.children[1];
      const actionsDiv = contentDiv.props.children[4];
      const backAnchor = actionsDiv.props.children;

      expect(backAnchor.props.href).toBe('/crm-1/contacts');
      expect(backAnchor.props.className).toContain('cs-access-back-btn');
    });
  });

  describe('5. DataTableController HTML State Renderers', () => {
    it('renders loading skeleton table HTML with shimmer headers and cells', () => {
      const controller = new DataTableController({ columns: CONTACTS_COLUMNS });
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
      const controller = new DataTableController({ columns: CONTACTS_COLUMNS });
      const html = controller.renderErrorAlertHtml('Connection timeout to CRM-1 backend', {
        title: 'Network Gateway Error',
        onRetryAction: 'fetch-contacts',
        retryLabel: 'Try Again',
      });

      expect(html).toContain('class="cs-error-banner"');
      expect(html).toContain('role="alert"');
      expect(html).toContain('Network Gateway Error');
      expect(html).toContain('Connection timeout to CRM-1 backend');
      expect(html).toContain('data-action="fetch-contacts"');
      expect(html).toContain('Try Again');
    });

    it('renders empty state HTML with call-to-action button', () => {
      const controller = new DataTableController({ columns: CONTACTS_COLUMNS });
      const html = controller.renderEmptyStateHtml({
        title: 'No active contacts',
        description: 'Create your first customer contact.',
        actionLabel: 'New Contact',
        actionName: 'create-contact',
      });

      expect(html).toContain('class="cs-empty-state"');
      expect(html).toContain('No active contacts');
      expect(html).toContain('Create your first customer contact.');
      expect(html).toContain('data-action="create-contact"');
      expect(html).toContain('New Contact');
    });

    it('renders filter-reset empty state HTML when filters yield zero records', () => {
      const controller = new DataTableController({ columns: CONTACTS_COLUMNS });
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
      const controller = new DataTableController({ columns: CONTACTS_COLUMNS });
      const html = controller.renderAccessDeniedHtml({
        requiredCapability: 'module.read',
        requiredRole: 'editor',
        currentRole: 'viewer',
        resourceName: 'CRM-1 Contacts Directory',
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
      const controller = new DataTableController({ columns: CONTACTS_COLUMNS });

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
        columns: CONTACTS_COLUMNS,
        data: [],
        loading: true,
        loadingRowCount: 4,
      });

      expect(element.type).toBe(TableSkeleton);
      expect(element.props.rowCount).toBe(4);
      expect(element.props.columnCount).toBe(CONTACTS_COLUMNS.length);
    });

    it('renders ErrorAlert wrapped in error card when error is provided', () => {
      const onRetry = vi.fn();
      const element = DataTable({
        columns: CONTACTS_COLUMNS,
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
        columns: CONTACTS_COLUMNS,
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
        columns: CONTACTS_COLUMNS,
        data: [],
        emptyTitle: 'No contact records',
        emptyActionLabel: 'Upload CSV',
        onEmptyAction: onAction,
      });

      expect(element.props.className).toContain('cs-table-card');
      const innerEmpty = element.props.children;
      expect(innerEmpty.type).toBe(EmptyState);
      expect(innerEmpty.props.title).toBe('No contact records');
      expect(innerEmpty.props.actionLabel).toBe('Upload CSV');
      expect(innerEmpty.props.onAction).toBe(onAction);
    });
  });

  describe('7. ContactsListPage Page State Integration', () => {
    it('renders TableSkeleton when isLoading={true}', () => {
      const element = ContactsListPage({
        isLoading: true,
      });

      // Child index: header [0], filtertoolbar [1], skeleton [2]
      const children = element.props.children;
      const header = children[0];
      expect(header.props.className).toBe('cs-page-header');

      const content = children[1];
      const skeleton = content.props.children[2];
      expect(skeleton.type).toBe(TableSkeleton);
    });

    it('renders ErrorAlert with onRetry when error is provided', () => {
      const onRetry = vi.fn();
      const element = ContactsListPage({
        error: 'Database timeout',
        onRetry,
      });

      const content = element.props.children[1];
      const errorContainer = content.props.children[1];
      expect(errorContainer.props.className).toBe('cs-error-container');
      const errorAlert = errorContainer.props.children;
      expect(errorAlert.type).toBe(ErrorAlert);
      expect(errorAlert.props.error).toBe('Database timeout');
    });

    it('renders AccessDeniedView when isAccessDenied={true}', () => {
      const element = ContactsListPage({
        isAccessDenied: true,
        requiredRole: 'admin',
      });

      const accessDenied = element.props.children[1];
      expect(accessDenied.type).toBe(AccessDeniedView);
      expect(accessDenied.props.requiredRole).toBe('admin');
    });

    it('renders DataTable with emptyActionLabel when empty', () => {
      const onAdd = vi.fn();
      const element = ContactsListPage({
        isEmpty: true,
        emptyActionLabel: 'Add First Contact',
        onEmptyAction: onAdd,
      });

      const content = element.props.children[1];
      const dataTable = content.props.children[2];
      expect(dataTable.type).toBe(DataTable);
      expect(dataTable.props.emptyActionLabel).toBe('Add First Contact');
    });
  });
});
