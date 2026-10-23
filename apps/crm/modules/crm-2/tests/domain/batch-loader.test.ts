import { describe, it, expect, beforeEach } from 'vitest';
import {
  chunkArray,
  calculateBackoffDelay,
  executeCrm2ChunkedBatchLoad,
} from '../../src/domain/batch-loader.js';
import { Crm2Service } from '../../src/services/crm2.service.js';
import type { BatchRecordInput } from '@clearshift/contracts';

describe('CRM-2 Chunked Batch Ingestion & Idempotent Retry (CRM2-13)', () => {
  let service: Crm2Service;

  beforeEach(() => {
    service = new Crm2Service();
    service.resetStore();
  });

  describe('chunkArray (500-Row Chunks)', () => {
    it('slices records into chunks of 500 rows by default', () => {
      const records = Array.from({ length: 1250 }, (_, i) => ({
        sourceRow: i + 1,
        idempotencyKey: `crm2-key-${i + 1}`,
        data: { name: `Deal Opportunity ${i + 1}` },
      }));

      const chunks = chunkArray(records, 500);
      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toHaveLength(500);
      expect(chunks[1]).toHaveLength(500);
      expect(chunks[2]).toHaveLength(250);
      expect(chunks[0]?.[0]?.sourceRow).toBe(1);
      expect(chunks[1]?.[0]?.sourceRow).toBe(501);
      expect(chunks[2]?.[0]?.sourceRow).toBe(1001);
    });

    it('handles exact multiples of chunk size', () => {
      const records = Array.from({ length: 1000 }, (_, i) => ({
        sourceRow: i + 1,
        idempotencyKey: `crm2-key-${i + 1}`,
        data: {},
      }));

      const chunks = chunkArray(records, 500);
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toHaveLength(500);
      expect(chunks[1]).toHaveLength(500);
    });

    it('throws error for non-positive chunk size', () => {
      expect(() => chunkArray([1, 2, 3], 0)).toThrow('chunkSize must be greater than 0');
      expect(() => chunkArray([1, 2, 3], -5)).toThrow('chunkSize must be greater than 0');
    });
  });

  describe('calculateBackoffDelay (Exponential Backoff)', () => {
    it('calculates bounded exponential backoff delay correctly without jitter', () => {
      expect(calculateBackoffDelay(0, 50)).toBe(50); // 50 * 2^0 = 50ms
      expect(calculateBackoffDelay(1, 50)).toBe(100); // 50 * 2^1 = 100ms
      expect(calculateBackoffDelay(2, 50)).toBe(200); // 50 * 2^2 = 200ms
      expect(calculateBackoffDelay(3, 50)).toBe(400); // 50 * 2^3 = 400ms
    });
  });

  describe('executeCrm2ChunkedBatchLoad (Acceptance Criteria)', () => {
    it('[AC-1] successfully processes 1000 records across 2 chunks of 500', async () => {
      const records: BatchRecordInput[] = Array.from({ length: 1000 }, (_, i) => ({
        sourceRow: i + 1,
        idempotencyKey: `idempotency-key-${i + 1}`,
        data: { name: `Deal Opportunity ${i + 1}`, value: '5000.00', currency: 'USD' },
      }));

      const report = await executeCrm2ChunkedBatchLoad({
        batchId: 'batch-full-1000',
        module: 'crm-2',
        records,
        chunkSize: 500,
      });

      expect(report.status).toBe('COMPLETED');
      expect(report.totalRecords).toBe(1000);
      expect(report.attemptedRecords).toBe(1000);
      expect(report.committedRecords).toBe(1000);
      expect(report.failedRecords).toBe(0);
      expect(report.chunksProcessed).toBe(2);
      expect(report.committedReceipts).toHaveLength(1000);
      expect(report.failureRate).toBe(0);
      expect(report.chunkSize).toBe(500);
    });

    it('[AC-2] retries transient failures with exponential backoff without corrupting idempotency keys', async () => {
      const attemptsMap = new Map<string, number>();

      const records: BatchRecordInput[] = [
        { sourceRow: 1, idempotencyKey: 'durable-deal-key-01', data: { name: 'Deal 1' } },
        { sourceRow: 2, idempotencyKey: 'durable-deal-key-02', data: { name: 'Deal 2' } },
      ];

      const report = await executeCrm2ChunkedBatchLoad(
        {
          batchId: 'batch-retry-test',
          module: 'crm-2',
          records,
          maxRetries: 3,
        },
        {
          baseBackoffMs: 1,
          sleepFn: async () => {}, // Instant sleep for test speed
          worker: async (record) => {
            const count = (attemptsMap.get(record.idempotencyKey) ?? 0) + 1;
            attemptsMap.set(record.idempotencyKey, count);

            // Simulate transient network or database lock failure on attempt 1 for key-02
            if (record.idempotencyKey === 'durable-deal-key-02' && count === 1) {
              throw new Error('Transient PostgreSQL lock timeout; retryable');
            }

            return { targetId: `tgt-${record.sourceRow}`, kind: 'created' };
          },
        }
      );

      expect(report.status).toBe('COMPLETED');
      expect(report.committedRecords).toBe(2);
      expect(report.failedRecords).toBe(0);
      expect(attemptsMap.get('durable-deal-key-01')).toBe(1);
      expect(attemptsMap.get('durable-deal-key-02')).toBe(2); // Retried once and succeeded!

      // Non-negotiable invariant: idempotency keys in durable receipts are strictly preserved
      expect(report.committedReceipts[0]?.idempotencyKey).toBe('durable-deal-key-01');
      expect(report.committedReceipts[1]?.idempotencyKey).toBe('durable-deal-key-02');
    });

    it('[AC-3 & AC-4] stops batch immediately if row failures exceed 10% after 50 attempted rows; transitions to STOPPED_EXCESSIVE_FAILURES', async () => {
      // 100 rows total: rows 1 to 45 succeed, rows 46 to 55 fail (10 failures out of 55 attempted = 18.2% > 10%)
      const records: BatchRecordInput[] = Array.from({ length: 100 }, (_, i) => ({
        sourceRow: i + 1,
        idempotencyKey: `crm2-key-${i + 1}`,
        data: { name: `Deal ${i + 1}` },
      }));

      const report = await executeCrm2ChunkedBatchLoad(
        {
          batchId: 'batch-threshold-test',
          module: 'crm-2',
          records,
          chunkSize: 500,
          failureThreshold: 0.10,
          minAttemptedRows: 50,
          maxRetries: 1,
        },
        {
          baseBackoffMs: 1,
          sleepFn: async () => {},
          worker: async (record) => {
            // Fail rows 45 through 55
            if (record.sourceRow >= 45 && record.sourceRow <= 55) {
              throw new Error(`Data validation rejection at row ${record.sourceRow}`);
            }
            return { targetId: `tgt-${record.sourceRow}` };
          },
        }
      );

      expect(report.status).toBe('STOPPED_EXCESSIVE_FAILURES');
      expect(report.attemptedRecords).toBeLessThan(100); // Stopped immediately!
      expect(report.haltReason).toContain('exceeds 10% threshold');
      expect(report.failureRate).toBeGreaterThan(0.10);

      // [AC-4] Durability Guarantee: already committed rows and receipts remain durable
      expect(report.committedRecords).toBe(44);
      expect(report.committedReceipts).toHaveLength(44);
      expect(report.committedReceipts[0]?.targetId).toBe('tgt-1');
      expect(report.committedReceipts[43]?.targetId).toBe('tgt-44');

      // [AC-5] No rollback saga or destructive uncommitted data loss
      expect(report.failedRows.length).toBeGreaterThanOrEqual(6);
    });

    it('does not halt before minAttemptedRows (50 rows) even if initial failure rate exceeds 10%', async () => {
      // 20 rows, first 3 fail (15% failure rate, but attempted < 50)
      const records: BatchRecordInput[] = Array.from({ length: 20 }, (_, i) => ({
        sourceRow: i + 1,
        idempotencyKey: `key-${i + 1}`,
        data: {},
      }));

      const report = await executeCrm2ChunkedBatchLoad(
        {
          batchId: 'batch-below-min',
          module: 'crm-2',
          records,
          minAttemptedRows: 50,
          maxRetries: 0,
        },
        {
          worker: async (record) => {
            if (record.sourceRow <= 3) {
              throw new Error('Initial row failure');
            }
            return { targetId: `tgt-${record.sourceRow}` };
          },
        }
      );

      // Completes processing all 20 rows without prematurely halting
      expect(report.status).toBe('COMPLETED');
      expect(report.attemptedRecords).toBe(20);
      expect(report.committedRecords).toBe(17);
      expect(report.failedRecords).toBe(3);
    });

    it('integrates seamlessly with Crm2Service to load synthetic deals and quotes with durable receipts', async () => {
      const records: BatchRecordInput[] = [
        {
          sourceRow: 1,
          idempotencyKey: 'idemp-deal-001',
          data: {
            entity: 'deal',
            name: 'Cloud Migration Deal',
            value: '75000.00',
            currency: 'USD',
            stage_name: 'Qualified',
            close_date: '2026-12-15',
          },
        },
        {
          sourceRow: 2,
          idempotencyKey: 'idemp-deal-002',
          data: {
            entity: 'deal',
            name: 'DevOps Modernization',
            value: '35000.00',
            currency: 'USD',
            stage_name: 'New',
            close_date: '2026-11-30',
          },
        },
      ];

      const report = await service.executeBatchLoad({
        batchId: 'batch-crm2-service-test',
        module: 'crm-2',
        records,
      });

      expect(report.status).toBe('COMPLETED');
      expect(report.committedRecords).toBe(2);
      expect(report.failedRecords).toBe(0);

      // Verify deals are accessible in service read queries
      const deals = await service.getDeals({ search: 'Cloud Migration' });
      expect(deals.items.length).toBeGreaterThanOrEqual(1);
      expect(deals.items.find((d) => d.name === 'Cloud Migration Deal')).toBeDefined();

      // Verify receipts are stored and retrievable
      const receipts = service.getReceipts();
      const r1 = receipts.find((r) => r.idempotencyKey === 'idemp-deal-001');
      expect(r1).toBeDefined();
      expect(r1?.entity).toBe('deal');

      // Verify batch report is recorded in service
      const retrievedReport = service.getBatchReport('batch-crm2-service-test');
      expect(retrievedReport).toBeDefined();
      expect(retrievedReport?.status).toBe('COMPLETED');
    });
  });
});
