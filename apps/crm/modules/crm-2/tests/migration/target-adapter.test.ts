import { describe, it, expect, beforeEach } from 'vitest';
import { Crm2TargetAdapter } from '../../src/migration/target-adapter.js';
import { Crm2Service } from '../../src/services/crm2.service.js';

describe('CRM-2 Migration Kit Target Adapter & Durable Import Receipts (KIT-08 & CRM2-11/13)', () => {
  let service: Crm2Service;
  let adapter: Crm2TargetAdapter;

  beforeEach(() => {
    service = new Crm2Service();
    service.resetStore();
    adapter = new Crm2TargetAdapter(service);
  });

  describe('Preflight Validation (Dry-Run Phase)', () => {
    it('validates deal and quote records in preflight without writing to database or store', async () => {
      const rows = [
        {
          entity: 'deal',
          data: {
            name: 'Valid Enterprise Opportunity',
            value: '50000.00',
            currency: 'USD',
            stage_name: 'New',
            close_date: '2026-12-31',
          },
        },
        {
          entity: 'deal',
          data: {
            name: '', // Invalid empty name
            value: '50000.00',
            currency: 'USD',
            stage_name: 'New',
            close_date: '2026-12-31',
          },
        },
      ];

      const preflightResult = await adapter.preflight('batch-dry-run-01', rows);
      expect(preflightResult.ok).toBe(true);
      if (preflightResult.ok) {
        expect(preflightResult.value.validCount).toBe(1);
        expect(preflightResult.value.rejectCount).toBe(1);
      }

      // Assert zero database mutations occurred during preflight
      const deals = await service.getDeals();
      expect(deals.items.find((d) => d.name === 'Valid Enterprise Opportunity')).toBeUndefined();
    });
  });

  describe('Import Row & Durable Receipt Commit', () => {
    it('commits deal target record and durable receipt atomically', async () => {
      const result = await adapter.importRow(
        'batch-kit-01',
        1,
        'idemp-kit-deal-01',
        {
          entity: 'deal',
          data: {
            name: 'Production Migration Deal',
            value: '80000.00',
            currency: 'USD',
            stage_name: 'Qualified',
            close_date: '2026-11-15',
          },
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.targetId).toBeDefined();
        expect(result.value.receipt.batchId).toBe('batch-kit-01');
        expect(result.value.receipt.sourceRow).toBe(1);
        expect(result.value.receipt.idempotencyKey).toBe('idemp-kit-deal-01');
        expect(result.value.receipt.kind).toBe('created');

        // Verify record is visible in domain read service
        const deal = await service.getDealById(result.value.targetId);
        expect(deal.name).toBe('Production Migration Deal');
        expect(deal.value).toBe('80000.00');
      }
    });

    it('returns existing receipt without duplication on exact idempotent replay', async () => {
      const rowPayload = {
        entity: 'deal',
        data: {
          name: 'Idempotent Replay Deal',
          value: '40000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-01',
        },
      };

      const firstResult = await adapter.importRow('batch-kit-02', 1, 'idemp-replay-01', rowPayload);
      expect(firstResult.ok).toBe(true);

      const secondResult = await adapter.importRow('batch-kit-02', 1, 'idemp-replay-01', rowPayload);
      expect(secondResult.ok).toBe(true);

      if (firstResult.ok && secondResult.ok) {
        expect(secondResult.value.targetId).toBe(firstResult.value.targetId);
        expect(secondResult.value.receipt.idempotencyKey).toBe(firstResult.value.receipt.idempotencyKey);
      }

      // Assert only 1 deal was created
      const allDeals = await service.getDeals({ search: 'Idempotent Replay Deal' });
      expect(allDeals.items).toHaveLength(1);
    });

    it('rejects idempotency key reuse with different payload with IDEMPOTENCY_CONFLICT', async () => {
      await adapter.importRow('batch-kit-03', 1, 'conflict-key-01', {
        entity: 'deal',
        data: {
          name: 'Original Deal',
          value: '10000.00',
          currency: 'USD',
          stage_name: 'New',
          close_date: '2026-12-01',
        },
      });

      const conflictingResult = await adapter.importRow('batch-kit-03', 1, 'conflict-key-01', {
        entity: 'deal',
        data: {
          name: 'Tampered Different Deal Payload',
          value: '99000.00',
          currency: 'USD',
          stage_name: 'Won',
          close_date: '2026-12-01',
        },
      });

      expect(conflictingResult.ok).toBe(false);
      if (!conflictingResult.ok) {
        expect(conflictingResult.error.reasonCode).toBe('IDEMPOTENCY_CONFLICT');
      }
    });

    it('simulates 503 transient failure for bounded exponential backoff testing', async () => {
      const transientResult = await adapter.importRow(
        'batch-transient-01',
        1,
        'transient-key-01',
        {
          entity: 'deal',
          data: { name: 'Deal Transient', value: '1000.00', currency: 'USD', close_date: '2026-12-31' },
        },
        { simulate503: true }
      );

      expect(transientResult.ok).toBe(false);
      if (!transientResult.ok) {
        expect(transientResult.error.reasonCode).toBe('SERVICE_UNAVAILABLE');
      }
    });
  });
});
