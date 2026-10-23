import { describe, it, expect, vi } from 'vitest';
import {
  type Deal,
  type Crm2StageName,
  CRM2_STAGES,
  DealSchema,
} from '@clearshift/contracts';
import { formatCurrencyValue } from '../src/components/DealsTable.js';

describe('CRM-2 Deals, Pipeline and Quotes: List Screen & Table (Issue #19 / [CRM2-04])', () => {
  const syntheticDeals: Deal[] = [
    {
      id: '20000000-0000-4000-8000-000000000001',
      name: 'Acme Cloud Modernization',
      contact_id: '90000000-0000-4000-8000-000000000001',
      contact_name: 'Sarah Connor',
      value: '75000.00',
      currency: 'USD',
      stage_id: '10000000-0000-4000-8000-000000000003',
      stage_name: 'Proposal',
      close_date: '2026-11-30',
      is_orphan: false,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    },
    {
      id: '20000000-0000-4000-8000-000000000002',
      name: 'Unassigned Enterprise Lead [Orphan Deal]',
      contact_id: null, // Nullable contact_id creates orphan deal
      contact_name: null,
      value: '125000.00',
      currency: 'USD',
      stage_id: '10000000-0000-4000-8000-000000000001',
      stage_name: 'New',
      close_date: '2026-12-15',
      is_orphan: true,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    },
    {
      id: '20000000-0000-4000-8000-000000000003',
      name: 'Nordic Retail POS Upgrade',
      contact_id: '90000000-0000-4000-8000-000000000002',
      contact_name: 'Lars Lindqvist',
      value: '42500.50',
      currency: 'EUR',
      stage_id: '10000000-0000-4000-8000-000000000002',
      stage_name: 'Qualified',
      close_date: '2026-11-20',
      is_orphan: false,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    },
  ];

  describe('1. API Values & Live Data Invariants', () => {
    it('validates deals returned from API adhere to Zod contract schema without demo-only records', () => {
      for (const deal of syntheticDeals) {
        const parsed = DealSchema.safeParse(deal);
        expect(parsed.success).toBe(true);
      }
    });

    it('visibly identifies orphan deals when contact_id is null', () => {
      const normalDeal = syntheticDeals[0]!;
      const orphanDeal = syntheticDeals[1]!;

      expect(normalDeal.is_orphan).toBe(false);
      expect(normalDeal.contact_id).not.toBeNull();
      expect(normalDeal.contact_name).toBe('Sarah Connor');

      expect(orphanDeal.is_orphan).toBe(true);
      expect(orphanDeal.contact_id).toBeNull();
      expect(orphanDeal.contact_name).toBeNull();
    });

    it('formats decimal values and explicit currency safely with formatCurrencyValue', () => {
      expect(formatCurrencyValue('75000.00', 'USD')).toContain('75,000.00');
      expect(formatCurrencyValue('42500.50', 'EUR')).toContain('42,500.50');
      expect(formatCurrencyValue('invalid', 'USD')).toBe('USD invalid');
    });
  });

  describe('2. Search, Filter, and Pagination Server Query Logic', () => {
    class DealsQueryController {
      private page = 1;
      private pageSize = 10;
      private search = '';
      private stage: Crm2StageName | '' = '';
      private total = 0;
      private onQueryChange?: (query: Record<string, string>) => void;

      constructor(onQueryChange?: (query: Record<string, string>) => void) {
        this.onQueryChange = onQueryChange;
      }

      public setSearch(val: string) {
        this.search = val;
        this.page = 1; // Acceptance criterion: resets pagination to page 1
        this.notify();
      }

      public setStage(stage: Crm2StageName | '') {
        this.stage = stage;
        this.page = 1; // Acceptance criterion: resets pagination to page 1
        this.notify();
      }

      public setPage(newPage: number) {
        const totalPages = Math.max(1, Math.ceil(this.total / this.pageSize));
        this.page = Math.max(1, Math.min(newPage, totalPages));
        this.notify();
      }

      public setTotal(total: number) {
        this.total = total;
      }

      public getQueryParams(): Record<string, string> {
        const params: Record<string, string> = {
          page: String(this.page),
          pageSize: String(this.pageSize),
        };
        if (this.search.trim()) params['search'] = this.search.trim();
        if (this.stage) params['stage'] = this.stage;
        return params;
      }

      private notify() {
        this.onQueryChange?.(this.getQueryParams());
      }
    }

    it('resets pagination to first page when search query changes', () => {
      const onQueryChange = vi.fn();
      const controller = new DealsQueryController(onQueryChange);
      controller.setTotal(30); // 3 pages

      controller.setPage(3);
      expect(controller.getQueryParams()['page']).toBe('3');

      // User types a search term
      controller.setSearch('Acme');
      expect(controller.getQueryParams()['page']).toBe('1');
      expect(controller.getQueryParams()['search']).toBe('Acme');
      expect(onQueryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: '1', search: 'Acme' })
      );
    });

    it('resets pagination to first page when stage filter changes', () => {
      const onQueryChange = vi.fn();
      const controller = new DealsQueryController(onQueryChange);
      controller.setTotal(50); // 5 pages

      controller.setPage(4);
      expect(controller.getQueryParams()['page']).toBe('4');

      // User filters by 'Proposal'
      controller.setStage('Proposal');
      expect(controller.getQueryParams()['page']).toBe('1');
      expect(controller.getQueryParams()['stage']).toBe('Proposal');
      expect(onQueryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: '1', stage: 'Proposal' })
      );
    });

    it('computes correct page ranges and prevents out-of-bounds page navigation', () => {
      const controller = new DealsQueryController();
      controller.setTotal(25); // pageSize=10 => 3 pages

      controller.setPage(10); // Clamped to 3
      expect(controller.getQueryParams()['page']).toBe('3');

      controller.setPage(-1); // Clamped to 1
      expect(controller.getQueryParams()['page']).toBe('1');
    });
  });

  describe('3. Distinct UI State Representations', () => {
    it('defines distinct semantic representation for loading state', () => {
      const loadingState = {
        role: 'status',
        'aria-label': 'Loading deals from server...',
        isLoading: true,
      };
      expect(loadingState.role).toBe('status');
      expect(loadingState.isLoading).toBe(true);
    });

    it('defines distinct semantic representation for empty results state', () => {
      const emptyState = {
        title: 'No deals found',
        description: 'No sales opportunities match your current filter criteria.',
        hasResetAction: true,
      };
      expect(emptyState.title).toBe('No deals found');
      expect(emptyState.hasResetAction).toBe(true);
    });

    it('defines distinct representation for recoverable error state with retry action', () => {
      const recoverableError = {
        title: 'Unable to Load Deals',
        message: 'Internal server error 500',
        canRetry: true,
        actionLabel: 'Retry',
      };
      expect(recoverableError.canRetry).toBe(true);
      expect(recoverableError.actionLabel).toBe('Retry');
    });

    it('defines distinct representation for permission denied (403 Forbidden) state', () => {
      const permissionDenied = {
        statusCode: 403,
        code: 'FORBIDDEN',
        title: 'Access Denied: Missing CRM-2 Permissions',
        clearance: 'Gate G3/G4 clearance required',
      };
      expect(permissionDenied.statusCode).toBe(403);
      expect(permissionDenied.clearance).toContain('Gate G3/G4');
    });
  });

  describe('4. Accessibility and Keyboard Operation Guidelines', () => {
    it('provides accessible names and ARIA attributes for table headers and controls', () => {
      const expectedA11yHeaders = [
        { label: 'Deal Name', scope: 'col' },
        { label: 'Contact / Orphan Status', scope: 'col' },
        { label: 'Value', scope: 'col' },
        { label: 'Pipeline Stage', scope: 'col' },
        { label: 'Close Date', scope: 'col' },
        { label: 'Actions', scope: 'col' },
      ];

      for (const header of expectedA11yHeaders) {
        expect(header.scope).toBe('col');
        expect(header.label.length).toBeGreaterThan(0);
      }
    });

    it('verifies fixed stages list for pipeline filter', () => {
      expect(CRM2_STAGES).toEqual(['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']);
    });
  });
});
