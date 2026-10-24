import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import type { CRM1ContactRead } from '@clearshift/contracts';
import {
  ContactsListPage,
  ContactsTable,
  getContacts,
  getContactById,
  createContact,
  updateContact,
  Crm1ApiError,
} from '../src/index.js';
import { TableSkeleton } from '../components/TableSkeleton.js';

// Helper to access virtual React element props safely in TypeScript strict mode
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asEl = (node: unknown): any => node as any;

const createSyntheticContact = (overrides: Partial<CRM1ContactRead> = {}): CRM1ContactRead => ({
  id: '550e8400-e29b-41d4-a716-446655440001',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane.doe@clearshift.internal',
  phone: '+1-555-0100',
  address: '100 Innovation Way, Suite 400',
  companyId: '550e8400-e29b-41d4-a716-446655440099',
  companyName: 'Acme Corporation',
  leadStatus: 'Qualified',
  goldenId: 'GLD-CONT-0001',
  consentStatus: 'granted',
  consentUpdatedAt: '2026-10-01T00:00:00.000Z',
  unsubscribed: false,
  unsubscribedUpdatedAt: null,
  sourceSystem: 'crm_legacy',
  sourceId: 'LEGACY_C_101',
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  ...overrides,
});

describe('Issue #9 [CRM1-04] Contacts List Screen, API Client, and UI States', () => {
  beforeEach(() => {
    const dispatcher = {
      useState: (initial: unknown) => [
        typeof initial === 'function' ? (initial as () => unknown)() : initial,
        vi.fn(),
      ],
      useId: () => ':crm1-test-id:',
      useEffect: (effect: () => void | (() => void)) => {
        const cleanup = effect();
        if (typeof cleanup === 'function') {
          // cleanup
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

  describe('1. API Client Contract & Error Handling', () => {
    it('throws Crm1ApiError with isPermissionDenied=true when 403 simulated', async () => {
      await expect(
        getContacts({}, { simulatePermissionDenied: true })
      ).rejects.toThrow(Crm1ApiError);

      try {
        await getContacts({}, { simulatePermissionDenied: true });
      } catch (err: unknown) {
        const apiErr = err as Crm1ApiError;
        expect(apiErr.status).toBe(403);
        expect(apiErr.isPermissionDenied()).toBe(true);
        expect(apiErr.code).toBe('FORBIDDEN');
      }
    });

    it('throws Crm1ApiError with status=500 when server failure simulated', async () => {
      await expect(
        getContacts({}, { simulateError: true })
      ).rejects.toThrow(Crm1ApiError);

      try {
        await getContacts({}, { simulateError: true });
      } catch (err: unknown) {
        const apiErr = err as Crm1ApiError;
        expect(apiErr.status).toBe(500);
        expect(apiErr.isPermissionDenied()).toBe(false);
      }
    });
  });

  describe('2. ContactsTable Component & SDS Columns', () => {
    it('renders SDS-required columns: Name, Email, Phone, Company, Lead Status, Golden ID, Consent, Actions', () => {
      const contact = createSyntheticContact();
      const onSelect = vi.fn();
      const onEdit = vi.fn();

      const el = asEl(
        ContactsTable({
          contacts: [contact],
          onSelectContact: onSelect,
          onEditContact: onEdit,
        })
      );

      expect(el).toBeDefined();
      const table = asEl(el.props.children);
      const [thead, tbody] = table.props.children;
      const headerRow = asEl(thead.props.children);
      const ths = headerRow.props.children;

      // 8 SDS columns: Name, Email, Phone, Company, Lead Status, Golden ID, Consent, Actions
      expect(ths).toHaveLength(8);
      expect(ths[0].props.children).toBe('Contact Name');
      expect(ths[1].props.children).toBe('Email Address');
      expect(ths[2].props.children).toBe('Phone Number');
      expect(ths[3].props.children).toBe('Company');
      expect(ths[4].props.children).toBe('Lead Status');
      expect(ths[5].props.children).toBe('Golden Identity');
      expect(ths[6].props.children).toBe('Consent');
      expect(ths[7].props.children).toBe('Actions');

      // Verify row values
      const bodyRows = tbody.props.children;
      expect(bodyRows).toHaveLength(1);
      const row = asEl(bodyRows[0]);
      const cells = row.props.children;

      // Contact name interactive button
      const nameCell = asEl(cells[0]);
      const nameBtn = asEl(nameCell.props.children);
      expect(nameBtn.props.children).toBe('Jane Doe');
      nameBtn.props.onClick();
      expect(onSelect).toHaveBeenCalledWith(contact);

      // Email, Golden ID
      expect(cells[1].props.children).toBe('jane.doe@clearshift.internal');
      expect(cells[5].props.children.props.children).toBe('GLD-CONT-0001');

      // Action buttons
      const actionsCell = asEl(cells[7]);
      const actionBtns = actionsCell.props.children.props.children;
      expect(actionBtns).toHaveLength(2);
      const editBtn = asEl(actionBtns[1]);
      editBtn.props.onClick();
      expect(onEdit).toHaveBeenCalledWith(contact);
    });

    it('renders empty table fallback row when contacts list is empty', () => {
      const el = asEl(ContactsTable({ contacts: [] }));
      const table = asEl(el.props.children);
      const tbody = table.props.children[1];
      const emptyRow = asEl(tbody.props.children);
      expect(emptyRow.props.children.props.children).toContain('No records found');
    });
  });

  describe('3. ContactsListPage Vertical Slice & UI States', () => {
    it('renders loading skeleton when isLoading=true with accessible aria-busy attribute', () => {
      const el = asEl(
        ContactsListPage({
          isLoading: true,
          data: [],
        })
      );

      expect(el).toBeDefined();
      expect(el.props['data-testid']).toBe('contacts-list-page');

      // Check toolbar, skeleton, etc.
      const children = el.props.children;
      const skeletonContainer = children.find(
        (c: any) => c && c.props && c.props['data-testid'] === 'contacts-skeleton-loading'
      );
      expect(skeletonContainer).toBeDefined();
      const skeleton = asEl(skeletonContainer.props.children);
      expect(skeleton.props.ariaLabel).toBe('Loading contacts from server...');
      const renderedSkeleton = asEl(TableSkeleton(skeleton.props));
      expect(renderedSkeleton.props['aria-busy']).toBe('true');
    });

    it('renders empty state when data is empty and not loading', () => {
      const onAdd = vi.fn();
      const el = asEl(
        ContactsListPage({
          isLoading: false,
          isEmpty: true,
          data: [],
          onAddContact: onAdd,
        })
      );

      const children = el.props.children;
      const emptyContainer = children.find(
        (c: any) => c && c.props && c.props['data-testid'] === 'contacts-empty-state'
      );
      expect(emptyContainer).toBeDefined();
      const emptyState = asEl(emptyContainer.props.children);
      expect(emptyState.props.title).toBe('No contacts registered');

      // Trigger empty action
      emptyState.props.onAction();
      expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it('renders empty state with Clear Search action when search or filters are active', () => {
      const onClearAll = vi.fn();
      const el = asEl(
        ContactsListPage({
          isLoading: false,
          data: [],
          search: 'NonExistentPerson',
          onClearAllFilters: onClearAll,
        })
      );

      const children = el.props.children;
      const emptyContainer = children.find(
        (c: any) => c && c.props && c.props['data-testid'] === 'contacts-empty-state'
      );
      expect(emptyContainer).toBeDefined();
      const emptyState = asEl(emptyContainer.props.children);
      expect(emptyState.props.title).toBe('No matching contact records found');
    });

    it('renders error alert with retry button when error is present', () => {
      const onRetry = vi.fn();
      const el = asEl(
        ContactsListPage({
          isLoading: false,
          data: [],
          error: 'Connection timed out',
          onRetry,
        })
      );

      const children = el.props.children;
      const errorBanner = children.find(
        (c: any) => c && c.props && c.props['data-testid'] === 'crm1-error-state'
      );
      expect(errorBanner).toBeDefined();
      const errorAlert = asEl(errorBanner.props.children);
      expect(errorAlert.props.error).toBe('Connection timed out');

      errorAlert.props.onRetry();
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('renders access denied view when permission is forbidden (403)', () => {
      const el = asEl(
        ContactsListPage({
          isAccessDenied: true,
          httpStatus: 403,
          requiredCapability: 'crm1.contacts.read',
          currentRole: 'guest',
        })
      );

      expect(el.props['data-testid']).toBe('contacts-access-denied');
      const accessView = asEl(el.props.children);
      expect(accessView.props.resourceName).toBe('Contacts Directory');
      expect(accessView.props.requiredCapability).toBe('crm1.contacts.read');
    });

    it('renders server-side pagination with default 25 pageSize and page navigation', () => {
      const onPageChange = vi.fn();
      const contacts = [
        createSyntheticContact({ id: 'c-1', firstName: 'Alice' }),
        createSyntheticContact({ id: 'c-2', firstName: 'Bob' }),
      ];

      const el = asEl(
        ContactsListPage({
          isLoading: false,
          data: contacts,
          pagination: {
            page: 2,
            pageSize: 25,
            total: 60,
            totalPages: 3,
          },
          onPageChange,
        })
      );

      const children = el.props.children;
      const tableWrapper = children.find(
        (c: any) => c && c.props && c.props['data-testid'] === 'contacts-table-wrapper'
      );
      expect(tableWrapper).toBeDefined();

      const paginationNav = tableWrapper.props.children[1];
      expect(paginationNav.props.role).toBe('navigation');
      expect(paginationNav.props['aria-label']).toBe('Contacts pagination navigation');

      const controls = paginationNav.props.children[1];
      const [prevBtn, pageIndicator, nextBtn] = controls.props.children;

      expect(pageIndicator.props.children).toEqual(['Page ', 2, ' of ', 3]);

      // Previous button triggers page 1
      prevBtn.props.onClick();
      expect(onPageChange).toHaveBeenCalledWith(1);

      // Next button triggers page 3
      nextBtn.props.onClick();
      expect(onPageChange).toHaveBeenCalledWith(3);
    });

    it('resets pagination to page 1 when search query changes', () => {
      const onSearchChange = vi.fn();
      const el = asEl(
        ContactsListPage({
          search: 'Jane',
          onSearchChange,
          pagination: { page: 3, pageSize: 25, total: 100, totalPages: 4 },
        })
      );

      const toolbarContainer = el.props.children[1];
      const filterToolbar = asEl(toolbarContainer.props.children);

      // Trigger search change
      filterToolbar.props.onSearchChange('John');
      expect(onSearchChange).toHaveBeenCalledWith('John');
    });
  });
});
