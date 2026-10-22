import { describe, it, expect } from 'vitest';
import {
  chunkArray,
  calculateBackoffDelay,
  executeChunkedBatchLoad,
} from '../../src/domain/batch-loader.js';
import type { BatchRecordInput } from '@clearshift/contracts';

describe('CRM-5 Chunked Batch Ingestion & Idempotent Retry (CRM5-13)', () => {
  describe('chunkArray', () => {
    it('slices records into chunks of 500 rows by default', () => {
      const records = Array.from({ length: 1250 }, (_, i) => ({
        sourceRow: i + 1,
        idempotencyKey: `key-${i + 1}`,
        data: { name: `Customer ${i + 1}` },
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
        idempotencyKey: `key-${i + 1}`,
        data: {},
      }));

      const chunks = chunkArray(records, 500);
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toHaveLength(500);
      expect(chunks[1]).toHaveLength(500);
    });
  });

  describe('calculateBackoffDelay', () => {
    it('calculates exponential backoff delay correctly', () => {
      expect(calculateBackoffDelay(0, 50)).toBe(50); // 50 * 2^0 = 50ms
      expect(calculateBackoffDelay(1, 50)).toBe(100); // 50 * 2^1 = 100ms
      expect(calculateBackoffDelay(2, 50)).toBe(200); // 50 * 2^2 = 200ms
      expect(calculateBackoffDelay(3, 50)).toBe(400); // 50 * 2^3 = 400ms
    });
  });

  describe('executeChunkedBatchLoad', () => {
    it('successfully processes 1000 records across 2 chunks of 500', async () => {
      const records: BatchRecordInput[] = Array.from({ length: 1000 }, (_, i) => ({
        sourceRow: i + 1,
        idempotencyKey: `idempotency-key-${i + 1}`,
        data: { email: `user${i + 1}@example.com` },
      }));

      const report = await executeChunkedBatchLoad({
        batchId: 'batch-full-1000',
        module: 'crm-1',
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
    });

    it('retries transient failures with exponential backoff without corrupting idempotency keys', async () => {
      const attemptsMap = new Map<string, number>();

      const records: BatchRecordInput[] = [
        { sourceRow: 1, idempotencyKey: 'durable-key-01', data: {} },
        { sourceRow: 2, idempotencyKey: 'durable-key-02', data: {} },
      ];

      const report = await executeChunkedBatchLoad(
        {
          batchId: 'batch-retry-test',
          module: 'crm-1',
          records,
          maxRetries: 3,
        },
        {
          baseBackoffMs: 1,
          sleepFn: async () => {}, // instant sleep for test speed
          worker: async (record) => {
            const count = (attemptsMap.get(record.idempotencyKey) ?? 0) + 1;
            attemptsMap.set(record.idempotencyKey, count);

            // Fail on first attempt for key-02, then succeed on retry
            if (record.idempotencyKey === 'durable-key-02' && count === 1) {
              throw new Error('Transient database lock conflict');
            }

            return { targetId: `target-${record.sourceRow}`, kind: 'created' };
          },
        }
      );

      expect(report.status).toBe('COMPLETED');
      expect(report.committedRecords).toBe(2);
      expect(report.failedRecords).toBe(0);
      expect(attemptsMap.get('durable-key-01')).toBe(1);
      expect(attemptsMap.get('durable-key-02')).toBe(2); // Retried once!

      // Verify idempotency keys in durable receipts are identical and preserved
      expect(report.committedReceipts[0]?.idempotencyKey).toBe('durable-key-01');
      expect(report.committedReceipts[1]?.idempotencyKey).toBe('durable-key-02');
    });

    it('stops batch immediately if row failures exceed 10% after 50 attempted rows', async () => {
      // 60 total rows: rows 1 to 45 succeed, rows 46 to 55 fail (10 failures out of 55 attempted = 18.2% > 10%)
      const records: BatchRecordInput[] = Array.from({ length: 100 }, (_, i) => ({
        sourceRow: i + 1,
        idempotencyKey: `key-${i + 1}`,
        data: {},
      }));

      const report = await executeChunkedBatchLoad(
        {
          batchId: 'batch-threshold-test',
          module: 'crm-1',
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
      expect(report.attemptedRecords).toBeLessThan(100); // Stopped early!
      expect(report.haltReason).toContain('exceeds 10% threshold');
      expect(report.failureRate).toBeGreaterThan(0.10);

      // Verify durability: already committed rows and receipts remain durable
      expect(report.committedRecords).toBe(44);
      expect(report.committedReceipts).toHaveLength(44);
      expect(report.committedReceipts[0]?.targetId).toBe('tgt-1');
      expect(report.committedReceipts[43]?.targetId).toBe('tgt-44');
    });

    it('does not halt before minAttemptedRows (50 rows) even if initial rows fail', async () => {
      // 20 rows, first 3 fail (15% failure rate, but attempted < 50)
      const records: BatchRecordInput[] = Array.from({ length: 20 }, (_, i) => ({
        sourceRow: i + 1,
        idempotencyKey: `key-${i + 1}`,
        data: {},
      }));

      const report = await executeChunkedBatchLoad(
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
  });
});
