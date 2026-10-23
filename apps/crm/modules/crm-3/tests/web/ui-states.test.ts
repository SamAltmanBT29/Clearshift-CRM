import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import {
  TableSkeleton,
  EmptyState,
  ErrorAlert,
  sanitizeErrorMessage,
  AccessDeniedView,
  TicketsListPage,
  ActivitiesTimelinePage,
  TicketNotesPage,
  SlaTrackingPage,
  ImportsOverviewPage,
} from '../../web/index.js';

describe('CRM-3 UI Loading, Empty, Error, and 403 Access-Denied States (Issue #152 / CRM3-19)', () => {
  describe('1. TableSkeleton Component', () => {
    it('renders animated table skeleton placeholder with WAI-ARIA attributes', () => {
      const element = TableSkeleton({
        rowCount: 5,
        columnCount: 7,
        ariaLabel: 'Loading support tickets queue...',
      });

      expect(element).toBeDefined();
      expect(element.props['aria-busy']).toBe('true');
      expect(element.props.role).toBe('status');
      expect(element.props['aria-label']).toBe('Loading support tickets queue...');
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
        ariaLabel: 'Fetching support tickets in background...',
      });

      const srSpan = element.props.children[0];
      expect(srSpan.props.className).toBe('cs-sr-only');
      expect(srSpan.props.children).toBe('Fetching support tickets in background...');
    });
  });

  describe('2. EmptyState Component', () => {
    it('renders zero-data empty state with icon, title, and description', () => {
      const element = EmptyState({
        title: 'No support tickets found',
        description: 'There are currently no tickets in the queue.',
        icon: '🎫',
      });

      expect(element.props.role).toBe('status');
      expect(element.props['aria-label']).toBe('No support tickets found');
      expect(element.props.className).toContain('cs-empty-state');
    });

    it('renders primary call-to-action button and fires callback on click', () => {
      const onAction = vi.fn();
      const element = EmptyState({
        title: 'No tickets created',
        actionLabel: 'Create Ticket',
        onAction,
      });

      const actionsDiv = element.props.children[3];
      expect(actionsDiv).toBeDefined();

      const [primaryBtn] = actionsDiv.props.children;
      expect(primaryBtn.props.type).toBe('button');
      expect(primaryBtn.props.className).toContain('cs-empty-cta-btn');
      expect(primaryBtn.props.children).toBe('Create Ticket');

      primaryBtn.props.onClick();
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('renders secondary action button and fires callback on click', () => {
      const onSecondary = vi.fn();
      const element = EmptyState({
        title: 'Empty queue',
        actionLabel: 'Create Ticket',
        onAction: () => {},
        secondaryActionLabel: 'Import CSV',
        onSecondaryAction: onSecondary,
      });

      const actionsDiv = element.props.children[3];
      const [, secondaryBtn] = actionsDiv.props.children;
      expect(secondaryBtn.props.type).toBe('button');
      expect(secondaryBtn.props.className).toContain('cs-empty-secondary-btn');
      expect(secondaryBtn.props.children).toBe('Import CSV');

      secondaryBtn.props.onClick();
      expect(onSecondary).toHaveBeenCalledTimes(1);
    });

    it('omits actions container when no action callbacks or labels are provided', () => {
      const element = EmptyState({
        title: 'Read-only empty state',
      });

      expect(element.props.children[3]).toBeUndefined();
    });
  });

  describe('3. ErrorAlert Component & sanitizeErrorMessage', () => {
    it('sanitizes Error instances by stripping internal file paths and stack lines', () => {
      const rawError = new Error(
        'Database connection timeout\n' +
          '  at Pool.acquire (/Users/user/Clearshift-CRM/node_modules/pg/lib/pool.js:42:15)\n' +
          '  at async TicketService.getTickets (/Users/user/Clearshift-CRM/apps/crm/modules/crm-3/src/services/crm3.service.ts:50:10)'
      );
      const sanitized = sanitizeErrorMessage(rawError);

      expect(sanitized).toBe('Database connection timeout');
      expect(sanitized).not.toContain('/Users/');
      expect(sanitized).not.toContain('node_modules');
      expect(sanitized).not.toContain('at Pool.acquire');
    });

    it('handles standard API error envelope object { code, message }', () => {
      const apiError = {
        code: 'VALIDATION_ERROR',
        message: 'Invalid ticket subject or status',
        details: [{ path: 'subject', error: 'Subject is required' }],
      };
      const sanitized = sanitizeErrorMessage(apiError);

      expect(sanitized).toBe('Invalid ticket subject or status');
    });

    it('falls back to code explanation if message is missing', () => {
      const apiError = { code: 'CONFLICT' };
      const sanitized = sanitizeErrorMessage(apiError);

      expect(sanitized).toBe('Server returned error code: CONFLICT');
    });

    it('returns default fallback message if error is null/undefined/empty', () => {
      expect(sanitizeErrorMessage(null)).toBe(
        'An unexpected error occurred while communicating with the server.'
      );
      expect(sanitizeErrorMessage('')).toBe(
        'An unexpected error occurred while communicating with the server.'
      );
    });

    it('truncates long messages to prevent UI blowout', () => {
      const longMessage = 'A'.repeat(300);
      const sanitized = sanitizeErrorMessage(longMessage);

      expect(sanitized.length).toBeLessThanOrEqual(240);
      expect(sanitized.endsWith('...')).toBe(true);
    });

    it('renders accessible alert banner with aria-live and role=alert', () => {
      const onRetry = vi.fn();
      const element = ErrorAlert({
        error: 'Failed to fetch tickets',
        onRetry,
      });

      expect(element).not.toBeNull();
      expect(element!.props.role).toBe('alert');
      expect(element!.props['aria-live']).toBe('assertive');
      expect(element!.props.className).toContain('cs-error-banner');
    });

    it('triggers onRetry when retry button is activated', () => {
      const onRetry = vi.fn();
      const element = ErrorAlert({
        error: 'Network failure',
        retryLabel: 'Try Again',
        onRetry,
      });

      const actionsDiv = element!.props.children[1];
      const retryBtn = actionsDiv.props.children[0];
      expect(retryBtn.props.type).toBe('button');
      expect(retryBtn.props.children).toBe('Try Again');

      retryBtn.props.onClick();
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('triggers onDismiss when dismiss button is activated', () => {
      const onDismiss = vi.fn();
      const element = ErrorAlert({
        error: 'Notice error',
        onDismiss,
      });

      const actionsDiv = element!.props.children[1];
      const dismissBtn = actionsDiv.props.children[1];
      expect(dismissBtn.props.type).toBe('button');
      expect(dismissBtn.props.children).toBe('✕');

      dismissBtn.props.onClick();
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('returns null when error is null or undefined', () => {
      expect(ErrorAlert({ error: null })).toBeNull();
      expect(ErrorAlert({ error: undefined })).toBeNull();
    });
  });

  describe('4. AccessDeniedView (403 Forbidden State)', () => {
    it('renders 403 Forbidden view with missing role and capability details', () => {
      const element = AccessDeniedView({
        requiredRole: 'admin',
        requiredCapability: 'crm3.ticket.delete',
        currentRole: 'viewer',
        resourceName: 'Support Tickets Queue',
      });

      expect(element.props.role).toBe('region');
      expect(element.props.id).toBe('cs-access-denied-view');

      const content = element.props.children[1];
      const [badge, title, desc, metaBlock, actions] = content.props.children;

      expect(badge.props.children).toBe('403 Forbidden');
      expect(title.props.children).toBe('Access Denied');
      expect(desc.props.children).toContain('crm3.ticket.delete');

      // Meta block details
      const metaItems = metaBlock.props.children;
      expect(metaItems[0].props.children[1].props.children).toBe('crm3.ticket.delete');
      expect(metaItems[1].props.children[1].props.children).toBe('admin');
      expect(metaItems[2].props.children[1].props.children).toBe('viewer');

      // Actions back link
      const backLink = actions.props.children;
      expect(backLink.props.href).toBe('/crm-3');
    });

    it('supports onBack callback action instead of anchor link', () => {
      const onBack = vi.fn();
      const element = AccessDeniedView({
        onBack,
      });

      const content = element.props.children[1];
      const actions = content.props.children[4];
      const backBtn = actions.props.children;

      expect(backBtn.props.type).toBe('button');
      backBtn.props.onClick();
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('5. TicketsListPage Page State Integration', () => {
    it('renders TableSkeleton when isLoading={true}', () => {
      const element = TicketsListPage({
        isLoading: true,
      });

      const children = element.props.children;
      const header = children[0];
      expect(header.props.className).toBe('cs-page-header');

      const content = children[1];
      const skeleton = content.props.children[1];
      expect(skeleton.type).toBe(TableSkeleton);
    });

    it('renders ErrorAlert with onRetry when error is provided', () => {
      const onRetry = vi.fn();
      const element = TicketsListPage({
        error: 'PostgreSQL connection timeout',
        onRetry,
      });

      const content = element.props.children[1];
      const errorContainer = content.props.children[0];
      expect(errorContainer.props.className).toBe('cs-error-container');
      const errorAlert = errorContainer.props.children;
      expect(errorAlert.type).toBe(ErrorAlert);
      expect(errorAlert.props.error).toBe('PostgreSQL connection timeout');
    });

    it('renders AccessDeniedView when isAccessDenied={true} or httpStatus=403', () => {
      const element = TicketsListPage({
        isAccessDenied: true,
        requiredRole: 'admin',
      });

      const accessDenied = element.props.children[1];
      expect(accessDenied.type).toBe(AccessDeniedView);
      expect(accessDenied.props.requiredRole).toBe('admin');

      const element403 = TicketsListPage({
        httpStatus: 403,
        requiredCapability: 'crm3.ticket.write',
      });
      const accessDenied403 = element403.props.children[1];
      expect(accessDenied403.type).toBe(AccessDeniedView);
      expect(accessDenied403.props.requiredCapability).toBe('crm3.ticket.write');
    });

    it('renders EmptyState with call-to-action button when data is empty', () => {
      const onAction = vi.fn();
      const element = TicketsListPage({
        data: [],
        emptyActionLabel: 'Create New Ticket',
        onEmptyAction: onAction,
      });

      const content = element.props.children[1];
      const emptyState = content.props.children[1];
      expect(emptyState.type).toBe(EmptyState);
      expect(emptyState.props.actionLabel).toBe('Create New Ticket');
      expect(emptyState.props.onAction).toBe(onAction);
    });

    it('renders loaded content card when data has items', () => {
      const element = TicketsListPage({
        data: [{ id: '1', subject: 'Login issue' }, { id: '2', subject: 'Billing error' }],
      });

      const content = element.props.children[1];
      const dataCard = content.props.children[1];
      expect(dataCard.props.className).toBe('cs-page-card');
      expect(dataCard.props.children.props.children[0]).toBe(2);
    });
  });

  describe('6. ActivitiesTimelinePage Page State Integration', () => {
    it('renders TableSkeleton during loading', () => {
      const element = ActivitiesTimelinePage({ isLoading: true });
      const skeleton = element.props.children[1].props.children[1];
      expect(skeleton.type).toBe(TableSkeleton);
    });

    it('renders EmptyState when no activity exists', () => {
      const element = ActivitiesTimelinePage({ data: [] });
      const empty = element.props.children[1].props.children[1];
      expect(empty.type).toBe(EmptyState);
      expect(empty.props.title).toBe('No activity records logged');
    });

    it('renders ErrorAlert on error', () => {
      const element = ActivitiesTimelinePage({ error: 'Failed to fetch activity feed' });
      const errBox = element.props.children[1].props.children[0];
      expect(errBox.props.children.type).toBe(ErrorAlert);
    });

    it('renders AccessDeniedView on 403', () => {
      const element = ActivitiesTimelinePage({ httpStatus: 403 });
      expect(element.props.children[1].type).toBe(AccessDeniedView);
    });
  });

  describe('7. TicketNotesPage Page State Integration', () => {
    it('renders TableSkeleton during loading', () => {
      const element = TicketNotesPage({ isLoading: true });
      const skeleton = element.props.children[1].props.children[1];
      expect(skeleton.type).toBe(TableSkeleton);
    });

    it('renders EmptyState when no notes exist', () => {
      const element = TicketNotesPage({ data: [] });
      const empty = element.props.children[1].props.children[1];
      expect(empty.type).toBe(EmptyState);
      expect(empty.props.title).toBe('No internal notes recorded');
    });

    it('renders ErrorAlert on error', () => {
      const element = TicketNotesPage({ error: 'Failed to fetch notes' });
      const errBox = element.props.children[1].props.children[0];
      expect(errBox.props.children.type).toBe(ErrorAlert);
    });

    it('renders AccessDeniedView on 403', () => {
      const element = TicketNotesPage({ isAccessDenied: true });
      expect(element.props.children[1].type).toBe(AccessDeniedView);
    });
  });

  describe('8. SlaTrackingPage and ImportsOverviewPage State Integration', () => {
    it('renders TableSkeleton and EmptyState for SlaTrackingPage', () => {
      const loadingEl = SlaTrackingPage({ isLoading: true });
      expect(loadingEl.props.children[1].props.children[1].type).toBe(TableSkeleton);

      const emptyEl = SlaTrackingPage({ data: [] });
      expect(emptyEl.props.children[1].props.children[1].type).toBe(EmptyState);

      const errorEl = SlaTrackingPage({ error: 'SLA engine unreachable' });
      expect(errorEl.props.children[1].props.children[0].props.children.type).toBe(ErrorAlert);

      const deniedEl = SlaTrackingPage({ httpStatus: 403 });
      expect(deniedEl.props.children[1].type).toBe(AccessDeniedView);
    });

    it('renders TableSkeleton and EmptyState for ImportsOverviewPage', () => {
      const loadingEl = ImportsOverviewPage({ isLoading: true });
      expect(loadingEl.props.children[1].props.children[1].type).toBe(TableSkeleton);

      const emptyEl = ImportsOverviewPage({ data: [] });
      expect(emptyEl.props.children[1].props.children[1].type).toBe(EmptyState);

      const errorEl = ImportsOverviewPage({ error: 'Batch registry error' });
      expect(errorEl.props.children[1].props.children[0].props.children.type).toBe(ErrorAlert);

      const deniedEl = ImportsOverviewPage({ httpStatus: 403 });
      expect(deniedEl.props.children[1].type).toBe(AccessDeniedView);
    });
  });
});
