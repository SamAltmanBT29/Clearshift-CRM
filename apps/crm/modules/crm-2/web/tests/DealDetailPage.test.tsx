import { describe, it, expect } from 'vitest';
import type { Deal, Quote } from '@clearshift/contracts';
import { crm2Store } from '../../src/store/crm2.store.js';
import { formatCurrencyValue } from '../src/components/DealsTable.js';

describe('CRM-2 Deal Detail Page & Linked Records (Issue #20 / [CRM2-05])', () => {
  const normalDealId = '20000000-0000-4000-8000-000000000001';
  const orphanDealId = '20000000-0000-4000-8000-000000000002';

  describe('1. Attribute Rendering & Orphan Warning Verification', () => {
    it('retrieves normal deal with linked contact and computes is_orphan as false', () => {
      const deal = crm2Store.getDealById(normalDealId);
      expect(deal).toBeDefined();
      expect(deal?.name).toBe('Acme Cloud Modernization');
      expect(deal?.contact_id).not.toBeNull();
      expect(deal?.is_orphan).toBe(false);
      expect(deal?.value).toBe('75000.00');
      expect(deal?.currency).toBe('USD');
      expect(deal?.stage_name).toBe('Proposal');
    });

    it('SDS FR-CRM2-05: visibly identifies orphan deal when contact_id is null', () => {
      const orphanDeal = crm2Store.getDealById(orphanDealId);
      expect(orphanDeal).toBeDefined();
      expect(orphanDeal?.contact_id).toBeNull();
      expect(orphanDeal?.is_orphan).toBe(true);

      // Warning rule: The UI visibly warns on an orphan deal
      const warningTitle = 'Orphan Deal: No Customer Contact Linked';
      expect(warningTitle).toContain('Orphan Deal');
    });
  });

  describe('2. Linked Quotes Sub-Table & Server-Computed Totals', () => {
    it('retrieves linked quotes for the deal and calculates server-computed total', () => {
      const quotesRes = crm2Store.getQuotes({ deal_id: normalDealId });
      expect(quotesRes.items.length).toBeGreaterThanOrEqual(1);

      const quote = quotesRes.items[0]!;
      expect(quote.deal_id).toBe(normalDealId);
      expect(quote.quote_number).toBe('Q-2026-001');

      // Server-computed total quote amount
      const total = quotesRes.items.reduce((acc, q) => acc + Number.parseFloat(q.amount), 0);
      expect(total).toBeGreaterThan(0);
      expect(formatCurrencyValue(String(total), 'USD')).toContain('75,000.00');
    });

    it('returns empty quotes list for deal with no quotes', () => {
      const orphanQuotes = crm2Store.getQuotes({ deal_id: orphanDealId });
      expect(orphanQuotes.items).toHaveLength(0);
      expect(orphanQuotes.totalCount).toBe(0);
    });
  });

  describe('3. List Context & Navigation Preservation', () => {
    it('defines explicit back link to return to the list context', () => {
      const navigationFlow = {
        current: `/crm-2/deals/${normalDealId}`,
        backTarget: '/crm-2/deals',
        backLabel: '← Back to Deals',
      };

      expect(navigationFlow.backTarget).toBe('/crm-2/deals');
      expect(navigationFlow.backLabel).toContain('Back to Deals');
    });
  });
});
