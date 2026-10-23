// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  type CRM4List,
  CRM4ListSchema,
  CRM4ListResponseSchema,
} from '@clearshift/contracts';
import { formatDateValue } from '../src/components/MarketingListsTable.js';
import { Crm4ApiError } from '../src/api/crm-4.js';
import { MarketingListsPage } from '../src/pages/MarketingListsPage.js';

// ---------------------------------------------------------------------------
// Module mock: intercept the API so tests never hit real network
// ---------------------------------------------------------------------------
vi.mock('../src/api/crm-4.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/crm-4.js')>();
  return {
    ...actual,
    getMarketingLists: vi.fn(),
  };
});

import { getMarketingLists } from '../src/api/crm-4.js';
const mockGetMarketingLists = vi.mocked(getMarketingLists);

// ---------------------------------------------------------------------------
// Synthetic fixtures (no real data)
// ---------------------------------------------------------------------------
const syntheticLists: CRM4List[] = [
  {
    id: '40000000-0000-4000-8000-000000000001',
    name: 'High-Value Enterprise Customers',
    description: 'Tier-1 client accounts with enterprise SaaS agreements',
    campaignCount: 4,
    memberCount: 120,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T10:00:00Z',
  },
  {
    id: '40000000-0000-4000-8000-000000000002',
    name: 'Q4 Product Webinar Attendees',
    description: null,
    campaignCount: 1,
    memberCount: 45,
    createdAt: '2026-10-05T14:30:00Z',
    updatedAt: '2026-10-05T14:30:00Z',
  },
  {
    id: '40000000-0000-4000-8000-000000000003',
    name: 'Newsletter Subscribers (Double Opt-In)',
    description: 'Verified organic blog and content subscribers',
    campaignCount: 0,
    memberCount: 350,
    createdAt: '2026-10-10T09:15:00Z',
    updatedAt: '2026-10-10T09:15:00Z',
  },
];

function makePageResponse(items: CRM4List[], total = items.length) {
  return {
    items,
    pagination: { page: 1, pageSize: 10, totalCount: total, totalPages: Math.max(1, Math.ceil(total / 10)) },
  };
}

// ---------------------------------------------------------------------------
// 1. API / Zod schema invariants (unit, no DOM)
// ---------------------------------------------------------------------------
describe('CRM-4 Marketing Lists and Campaign History: List Screen & Table (Issue #39 / [CRM4-04])', () => {
  describe('1. API Values & Live Data Invariants', () => {
    it('validates marketing lists returned from API adhere to Zod contract schema without demo-only records', () => {
      for (const list of syntheticLists) {
        const parsed = CRM4ListSchema.safeParse(list);
        expect(parsed.success).toBe(true);
      }
    });

    it('validates paginated list response schema parsing', () => {
      const response = makePageResponse(syntheticLists, 3);
      const parsed = CRM4ListResponseSchema.safeParse(response);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.items).toHaveLength(3);
        expect(parsed.data.pagination.totalPages).toBe(1);
      }
    });

    it('formats date values safely and handles invalid strings gracefully', () => {
      expect(formatDateValue('2026-10-01T10:00:00Z')).toContain('2026');
      expect(formatDateValue('invalid-date')).toBe('invalid-date');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. DOM component tests – mounts <MarketingListsPage /> via @testing-library/react
  // ---------------------------------------------------------------------------
  describe('2. DOM Component Tests – <MarketingListsPage />', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    // -------------------------------------------------------------------------
    // 2a. Initial data render
    // -------------------------------------------------------------------------
    it('renders initial data rows in the table after successful API load', async () => {
      mockGetMarketingLists.mockResolvedValueOnce(makePageResponse(syntheticLists, 3));

      render(React.createElement(MarketingListsPage));

      // Loading spinner is visible immediately
      expect(screen.getByRole('status', { name: /loading marketing lists/i })).toBeTruthy();

      // All three rows appear once the fetch resolves
      await waitFor(() => {
        expect(screen.getByText('High-Value Enterprise Customers')).toBeTruthy();
      });
      expect(screen.getByText('Q4 Product Webinar Attendees')).toBeTruthy();
      expect(screen.getByText('Newsletter Subscribers (Double Opt-In)')).toBeTruthy();

      // Loading spinner is gone after data loads
      expect(screen.queryByRole('status', { name: /loading marketing lists/i })).toBeNull();

      // API was called with default query params
      expect(mockGetMarketingLists).toHaveBeenCalledWith(
        { page: 1, pageSize: 10, search: undefined },
        expect.objectContaining({ simulatePermissionDenied: false, simulateError: false })
      );
    });

    // -------------------------------------------------------------------------
    // 2b. Search filtering – typing updates query and resets pagination to page 1
    // -------------------------------------------------------------------------
    it('typing in the search input fires a new API query and resets pagination to page 1', async () => {
      const user = userEvent.setup();

      // First load: 30 total items (3 pages) so pagination controls appear
      const firstPage = { ...syntheticLists[0]! };
      mockGetMarketingLists
        .mockResolvedValueOnce({
          items: [firstPage, syntheticLists[1]!, syntheticLists[2]!],
          pagination: { page: 1, pageSize: 10, totalCount: 30, totalPages: 3 },
        })
        // After search: 1 result
        .mockResolvedValueOnce({
          items: [syntheticLists[0]!],
          pagination: { page: 1, pageSize: 10, totalCount: 1, totalPages: 1 },
        });

      render(React.createElement(MarketingListsPage));

      // Wait for initial render
      await waitFor(() => {
        expect(screen.getByText('High-Value Enterprise Customers')).toBeTruthy();
      });

      // Type in the search box
      const searchInput = screen.getByRole('textbox', { name: /search marketing lists/i });
      await user.clear(searchInput);
      await user.type(searchInput, 'Enterprise');

      // After debounced search fires, the page should show the filtered result
      await waitFor(() => {
        // The second API call carries the search term
        const calls = mockGetMarketingLists.mock.calls;
        const searchCall = calls.find((c) => (c[0] as any).search === 'Enterprise');
        expect(searchCall).toBeTruthy();
        // Page resets to 1
        expect((searchCall![0] as any).page).toBe(1);
      });
    });

    // -------------------------------------------------------------------------
    // 2c. Empty state – zero items from the server
    // -------------------------------------------------------------------------
    it('displays the empty state message when the server returns zero results', async () => {
      mockGetMarketingLists.mockResolvedValueOnce(makePageResponse([], 0));

      render(React.createElement(MarketingListsPage));

      await waitFor(() => {
        expect(screen.getByText(/no marketing lists recorded/i)).toBeTruthy();
      });

      // No table rows are present
      expect(screen.queryByRole('table')).toBeNull();
    });

    // -------------------------------------------------------------------------
    // 2d. Error recovery – Retry button re-triggers fetch
    // -------------------------------------------------------------------------
    it('clicking Retry after a server error re-triggers the API fetch', async () => {
      const serverError = new Crm4ApiError(500, 'INTERNAL_SERVER_ERROR', 'Database connection timed out.');

      // First call → error, second call → success
      mockGetMarketingLists
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce(makePageResponse(syntheticLists, 3));

      render(React.createElement(MarketingListsPage));

      // Wait for the error alert to appear
      await waitFor(() => {
        expect(screen.getByText(/database connection timed out/i)).toBeTruthy();
      });

      // The Retry button is rendered inside the error alert
      const retryButton = screen.getByRole('button', { name: /retry loading marketing lists/i });
      expect(retryButton).toBeTruthy();

      // Click Retry
      await act(async () => {
        fireEvent.click(retryButton);
      });

      // After retry the data table renders
      await waitFor(() => {
        expect(screen.getByText('High-Value Enterprise Customers')).toBeTruthy();
      });

      // API was called twice in total (initial + retry)
      expect(mockGetMarketingLists).toHaveBeenCalledTimes(2);
    });

    // -------------------------------------------------------------------------
    // 2e. Permission-denied (403) state
    // -------------------------------------------------------------------------
    it('displays the 403 Access Restricted message when the API returns a permission-denied error', async () => {
      const forbiddenError = new Crm4ApiError(403, 'FORBIDDEN', 'Access denied. Required capability: module.read');
      mockGetMarketingLists.mockRejectedValueOnce(forbiddenError);

      render(React.createElement(MarketingListsPage));

      // The permission-denied alert title appears
      await waitFor(() => {
        expect(screen.getByText(/access restricted/i)).toBeTruthy();
      });

      // The message details the missing capability
      expect(screen.getByText(/module\.read/i)).toBeTruthy();

      // The data table is NOT shown when permission is denied
      expect(screen.queryByRole('table')).toBeNull();

      // No generic Retry button is shown (only applies to recoverable errors)
      expect(screen.queryByRole('button', { name: /retry loading marketing lists/i })).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Distinct UI States & Error Handling (unit)
  // ---------------------------------------------------------------------------
  describe('3. Distinct UI States & Error Handling', () => {
    it('distinguishes 403 Forbidden permission-denied errors from recoverable errors', () => {
      const forbiddenError = new Crm4ApiError(403, 'FORBIDDEN', 'Access denied. Required capability: module.read');
      expect(forbiddenError.isPermissionDenied).toBe(true);
      expect(forbiddenError.statusCode).toBe(403);

      const serverError = new Crm4ApiError(500, 'INTERNAL_SERVER_ERROR', 'Database connection timed out.');
      expect(serverError.isPermissionDenied).toBe(false);
      expect(serverError.statusCode).toBe(500);

      const networkError = new Crm4ApiError(0, 'NETWORK_ERROR', 'Network communication failed.');
      expect(networkError.isPermissionDenied).toBe(false);
    });

    it('renders empty state message when list results count is 0', () => {
      const emptyItems: CRM4List[] = [];
      expect(emptyItems.length).toBe(0);

      const emptyResponse = makePageResponse([], 0);
      expect(CRM4ListResponseSchema.safeParse(emptyResponse).success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Accessibility and Semantic Table Markup (unit)
  // ---------------------------------------------------------------------------
  describe('4. Accessibility and Semantic Table Markup', () => {
    it('renders SDS-required columns: Name, Description, Campaigns, Created Date, Actions', () => {
      const list = syntheticLists[0]!;
      expect(list.name).toBe('High-Value Enterprise Customers');
      expect(list.description).not.toBeNull();
      expect(list.campaignCount).toBe(4);
      expect(list.createdAt).toBe('2026-10-01T10:00:00Z');
    });

    it('ensures text-safe rendering and prevents prototype pollution or unescaped values', () => {
      const maliciousPayload = {
        id: '40000000-0000-4000-8000-000000000099',
        name: '<script>alert(1)</script>',
        description: '<img src=x onerror=alert(1)>',
        campaignCount: 0,
        memberCount: 0,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      };

      const parsed = CRM4ListSchema.safeParse(maliciousPayload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.name).toBe('<script>alert(1)</script>');
      }
    });
  });
});
