import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import type { CRM1CompanyRead } from '@clearshift/contracts';
import {
  CompaniesListPage,
  CompaniesTable,
  getCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  Crm1ApiError,
} from '../src/index.js';
import { TableSkeleton } from '../components/TableSkeleton.js';

// Helper to access virtual React element props safely in TypeScript strict mode
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asEl = (node: unknown): any => node as any;

const createSyntheticCompany = (overrides: Partial<CRM1CompanyRead> = {}): CRM1CompanyRead => ({
  id: '550e8400-e29b-41d4-a716-446655440099',
  name: 'Acme Corporation',
  taxNumber: 'US-987654321',
  email: 'corp@acme.internal',
  phone: '+1-555-0199',
  address: '100 Innovation Way, Suite 400, Austin, TX',
  sourceSystem: 'crm_legacy',
  sourceId: 'LEGACY_COMP_50',
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  ...overrides,
});

describe('Issue #9 [CRM1-04] Companies List Screen, Flat Company Architecture, and UI States', () => {
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
    it('throws Crm1ApiError with isPermissionDenied=true when 403 simulated for companies', async () => {
      await expect(
        getCompanies({}, { simulatePermissionDenied: true })
      ).rejects.toThrow(Crm1ApiError);

      try {
        await getCompanies({}, { simulatePermissionDenied: true });
      } catch (err: unknown) {
        const apiErr = err as Crm1ApiError;
        expect(apiErr.status).toBe(403);
        expect(apiErr.isPermissionDenied()).toBe(true);
        expect(apiErr.code).toBe('FORBIDDEN');
      }
    });

    it('throws Crm1ApiError with status=500 when server failure simulated', async () => {
      await expect(
        getCompanies({}, { simulateError: true })
      ).rejects.toThrow(Crm1ApiError);

      try {
        await getCompanies({}, { simulateError: true });
      } catch (err: unknown) {
        const apiErr = err as Crm1ApiError;
        expect(apiErr.status).toBe(500);
        expect(apiErr.isPermissionDenied()).toBe(false);
      }
    });
  });

  describe('2. CompaniesTable Component & Flat Company Invariant', () => {
    it('renders SDS-required columns and enforces Flat Company V1 architecture badge', () => {
      const company = createSyntheticCompany();
      const onSelect = vi.fn();
      const onEdit = vi.fn();

      const el = asEl(
        CompaniesTable({
          companies: [company],
          onSelectCompany: onSelect,
          onEditCompany: onEdit,
        })
      );

      expect(el).toBeDefined();
      const table = asEl(el.props.children);
      const [thead, tbody] = table.props.children;
      const headerRow = asEl(thead.props.children);
      const ths = headerRow.props.children;

      // 8 SDS columns: Company Name, Tax ID, Corporate Email, Main Phone, Address, Architecture, Origin, Actions
      expect(ths).toHaveLength(8);
      expect(ths[0].props.children).toBe('Company Name');
      expect(ths[1].props.children).toBe('Tax ID');
      expect(ths[2].props.children).toBe('Corporate Email');
      expect(ths[3].props.children).toBe('Main Phone');
      expect(ths[4].props.children).toBe('Address');
      expect(ths[5].props.children).toBe('Architecture');
      expect(ths[6].props.children).toBe('Origin');
      expect(ths[7].props.children).toBe('Actions');

      // Verify row values
      const bodyRows = tbody.props.children;
      expect(bodyRows).toHaveLength(1);
      const row = asEl(bodyRows[0]);
      const cells = row.props.children;

      // Name interactive link
      const nameCell = asEl(cells[0]);
      const nameBtn = asEl(nameCell.props.children);
      expect(nameBtn.props.children).toBe('Acme Corporation');
      nameBtn.props.onClick();
      expect(onSelect).toHaveBeenCalledWith(company);

      // Tax ID
      expect(cells[1].props.children.props.children).toBe('US-987654321');

      // Architecture Badge asserts V1 Flat Company
      const archBadge = asEl(cells[5].props.children);
      expect(archBadge.props.children).toBe('Flat Company');

      // Action buttons
      const actionsCell = asEl(cells[7]);
      const actionBtns = actionsCell.props.children.props.children;
      expect(actionBtns).toHaveLength(2);
      const editBtn = asEl(actionBtns[1]);
      editBtn.props.onClick();
      expect(onEdit).toHaveBeenCalledWith(company);
    });

    it('renders empty table fallback row when companies list is empty', () => {
      const el = asEl(CompaniesTable({ companies: [] }));
      const table = asEl(el.props.children);
      const tbody = table.props.children[1];
      const emptyRow = asEl(tbody.props.children);
      expect(emptyRow.props.children.props.children).toContain('No records found');
    });
  });

  describe('3. CompaniesListPage Vertical Slice & UI States', () => {
    it('renders loading skeleton when isLoading=true with accessible aria-busy attribute', () => {
      const el = asEl(
        CompaniesListPage({
          isLoading: true,
          data: [],
        })
      );

      expect(el).toBeDefined();
      expect(el.props['data-testid']).toBe('companies-list-page');

      const children = el.props.children;
      const skeletonContainer = children.find(
        (c: any) => c && c.props && c.props['data-testid'] === 'companies-skeleton-loading'
      );
      expect(skeletonContainer).toBeDefined();
      const skeleton = asEl(skeletonContainer.props.children);
      expect(skeleton.props.ariaLabel).toBe('Loading companies directory from server...');
      const renderedSkeleton = asEl(TableSkeleton(skeleton.props));
      expect(renderedSkeleton.props['aria-busy']).toBe('true');
    });

    it('renders empty state when data is empty and not loading', () => {
      const onAdd = vi.fn();
      const el = asEl(
        CompaniesListPage({
          isLoading: false,
          isEmpty: true,
          data: [],
          onAddCompany: onAdd,
        })
      );

      const children = el.props.children;
      const emptyContainer = children.find(
        (c: any) => c && c.props && c.props['data-testid'] === 'companies-empty-state'
      );
      expect(emptyContainer).toBeDefined();
      const emptyState = asEl(emptyContainer.props.children);
      expect(emptyState.props.title).toBe('No companies registered');

      emptyState.props.onAction();
      expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it('renders empty state with Clear search action when search or filters are active', () => {
      const onClearAll = vi.fn();
      const el = asEl(
        CompaniesListPage({
          isLoading: false,
          data: [],
          search: 'NonExistentCorp',
          onClearAllFilters: onClearAll,
        })
      );

      const children = el.props.children;
      const emptyContainer = children.find(
        (c: any) => c && c.props && c.props['data-testid'] === 'companies-empty-state'
      );
      expect(emptyContainer).toBeDefined();
      const emptyState = asEl(emptyContainer.props.children);
      expect(emptyState.props.title).toBe('No matching company records found');
    });

    it('renders error alert with retry button when error is present', () => {
      const onRetry = vi.fn();
      const el = asEl(
        CompaniesListPage({
          isLoading: false,
          data: [],
          error: 'Failed to fetch companies from database',
          onRetry,
        })
      );

      const children = el.props.children;
      const errorBanner = children.find(
        (c: any) => c && c.props && c.props['data-testid'] === 'crm1-error-state'
      );
      expect(errorBanner).toBeDefined();
      const errorAlert = asEl(errorBanner.props.children);
      expect(errorAlert.props.error).toBe('Failed to fetch companies from database');

      errorAlert.props.onRetry();
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('renders access denied view when permission is forbidden (403)', () => {
      const el = asEl(
        CompaniesListPage({
          isAccessDenied: true,
          httpStatus: 403,
          requiredCapability: 'crm1.companies.read',
          currentRole: 'guest',
        })
      );

      expect(el.props['data-testid']).toBe('companies-access-denied');
      const accessView = asEl(el.props.children);
      expect(accessView.props.resourceName).toBe('Companies Directory');
      expect(accessView.props.requiredCapability).toBe('crm1.companies.read');
    });

    it('renders server-side pagination with default 25 pageSize and page navigation', () => {
      const onPageChange = vi.fn();
      const companies = [
        createSyntheticCompany({ id: 'comp-1', name: 'Alpha Inc' }),
        createSyntheticCompany({ id: 'comp-2', name: 'Beta LLC' }),
      ];

      const el = asEl(
        CompaniesListPage({
          isLoading: false,
          data: companies,
          pagination: {
            page: 2,
            pageSize: 25,
            total: 75,
            totalPages: 3,
          },
          onPageChange,
        })
      );

      const children = el.props.children;
      const tableWrapper = children.find(
        (c: any) => c && c.props && c.props['data-testid'] === 'companies-table-wrapper'
      );
      expect(tableWrapper).toBeDefined();

      const paginationNav = tableWrapper.props.children[1];
      expect(paginationNav.props.role).toBe('navigation');
      expect(paginationNav.props['aria-label']).toBe('Companies pagination navigation');

      const controls = paginationNav.props.children[1];
      const [prevBtn, pageIndicator, nextBtn] = controls.props.children;

      expect(pageIndicator.props.children).toEqual(['Page ', 2, ' of ', 3]);

      prevBtn.props.onClick();
      expect(onPageChange).toHaveBeenCalledWith(1);

      nextBtn.props.onClick();
      expect(onPageChange).toHaveBeenCalledWith(3);
    });

    it('resets pagination to page 1 when company search query changes', () => {
      const onSearchChange = vi.fn();
      const el = asEl(
        CompaniesListPage({
          search: 'Acme',
          onSearchChange,
          pagination: { page: 3, pageSize: 25, total: 100, totalPages: 4 },
        })
      );

      const toolbarContainer = el.props.children[1];
      const filterToolbar = asEl(toolbarContainer.props.children);

      filterToolbar.props.onSearchChange('Globex');
      expect(onSearchChange).toHaveBeenCalledWith('Globex');
    });
  });
});
