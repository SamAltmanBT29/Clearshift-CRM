import { describe, it, expect, beforeEach } from 'vitest';
import {
  chunkArray,
  calculateBackoffDelay,
  executeCrm1ChunkedBatchLoad,
} from '../../src/domain/batch-loader.js';
import { Crm1Service } from '../../src/services/crm1.service.js';
import type { Crm1BatchRecordInput } from '@clearshift/contracts';

describe('CRM-1 Chunked Batch Ingestion & Idempotent Retry (CRM1-13)', () => {
  let service: Crm1Service;

  beforeEach(() => {
    service = new Crm1Service();
    service.resetBatchReports();
  });

  describe('chunkArray (500-Row Chunks)', () => {
    it('slices records into chunks of 500 rows by default', () => {
      const records = Array.from({ length: 1250 }, (_, i) => ({
        sourceRow: i + 1,
        idempotencyKey: `crm1-key-${i + 1}`,
        data: { firstName: `First${i + 1}`, lastName: `Last${i + 1}` },
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
        idempotencyKey: `crm1-key-${i + 1}`,
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

  describe('executeCrm1ChunkedBatchLoad (Acceptance Criteria)', () => {
    it('[AC-1] successfully processes 1000 records across 2 chunks of 500', async () => {
      const records: Crm1BatchRecordInput[] = Array.from({ length: 1000 }, (_, i) => ({
        sourceRow: i + 1,
        idempotencyKey: `idempotency-key-${i + 1}`,
        data: {
          firstName: `SyntheticFirstName${i + 1}`,
          lastName: `SyntheticLastName${i + 1}`,
          email: `user${i + 1}@synthetic.example.com`,
        },
      }));

      const report = await executeCrm1ChunkedBatchLoad({
        batchId: 'batch-crm1-1000',
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
      expect(report.chunkSize).toBe(500);
    });

    it('[AC-2] retries transient failures with exponential backoff without corrupting idempotency keys', async () => {
      const attemptsMap = new Map<string, number>();

      const records: Crm1BatchRecordInput[] = [
        { sourceRow: 1, idempotencyKey: 'durable-contact-key-01', data: { firstName: 'Alice' } },
        { sourceRow: 2, idempotencyKey: 'durable-contact-key-02', data: { firstName: 'Bob' } },
      ];

      const report = await executeCrm1ChunkedBatchLoad(
        {
          batchId: 'batch-retry-test',
          module: 'crm-1',
          records,
          maxRetries: 3,
        },
        {
          baseBackoffMs: 1,
          sleepFn: async () => {},
          worker: async (rec, attempt) => {
            attemptsMap.set(rec.idempotencyKey, attempt);
            // Simulate transient network failure on row 2 for first 2 attempts
            if (rec.sourceRow === 2 && attempt < 2) {
              throw new Error('Transient database lock / socket timeout');
            }
            return { targetId: `tgt-${rec.idempotencyKey}` };
          },
        }
      );

      expect(report.status).toBe('COMPLETED');
      expect(report.committedRecords).toBe(2);
      expect(report.failedRecords).toBe(0);

      // Verify row 2 was retried and succeeded on attempt 2
      expect(attemptsMap.get('durable-contact-key-02')).toBe(2);

      // Verify idempotency keys remain strictly intact and uncorrupted
      const receipt1 = report.committedReceipts.find((r) => r.sourceRow === 1);
      const receipt2 = report.committedReceipts.find((r) => r.sourceRow === 2);
      expect(receipt1?.idempotencyKey).toBe('durable-contact-key-01');
      expect(receipt2?.idempotencyKey).toBe('durable-contact-key-02');
    });

    it('[AC-2 & AC-3] exhausts bounded retries (maxRetries = 2) when transient failure does not recover', async () => {
      const records: Crm1BatchRecordInput[] = [
        { sourceRow: 1, idempotencyKey: 'key-fail-after-retries', data: { firstName: 'Charlie' } },
      ];

      const report = await executeCrm1ChunkedBatchLoad(
        {
          batchId: 'batch-exhaust-retry',
          module: 'crm-1',
          records,
          maxRetries: 2,
        },
        {
          baseBackoffMs: 1,
          sleepFn: async () => {},
          worker: async () => {
            throw new Error('Persistent network failure');
          },
        }
      );

      expect(report.status).toBe('FAILED');
      expect(report.failedRecords).toBe(1);
      expect(report.failedRows[0]?.retryAttempts).toBe(3); // attempt 0, 1, 2
      expect(report.failedRows[0]?.idempotencyKey).toBe('key-fail-after-retries');
      expect(report.failedRows[0]?.errorMessage).toBe('Persistent network failure');
    });

    it('[AC-3 & AC-4] stops batch immediately if row failures exceed 10% after 50 attempted rows; transitions to STOPPED_EXCESSIVE_FAILURES', async () => {
      // 100 rows total:
      // First 44 rows succeed (committed).
      // Rows 45 to 51 fail (7 failures out of 51 attempted rows = 13.7% > 10%).
      // Min attempted rows = 50.
      // Expected behavior: halt occurs immediately at row 51. Rows 52-100 are NEVER attempted.
      const records: Crm1BatchRecordInput[] = Array.from({ length: 100 }, (_, i) => ({
        sourceRow: i + 1,
        idempotencyKey: `idemp-crm1-halt-${i + 1}`,
        data: { index: i + 1 },
      }));

      const report = await executeCrm1ChunkedBatchLoad(
        {
          batchId: 'batch-crm1-halt-10pct',
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
          worker: async (rec) => {
            if (rec.sourceRow >= 45 && rec.sourceRow <= 51) {
              throw new Error(`Data validation constraint failed on row ${rec.sourceRow}`);
            }
            return { targetId: `tgt-${rec.sourceRow}` };
          },
        }
      );

      expect(report.status).toBe('STOPPED_EXCESSIVE_FAILURES');
      expect(report.haltReason).toContain('exceeds 10% threshold');
      expect(report.attemptedRecords).toBe(50); // Stopped exactly at 50th row where 6/50 = 12% > 10%!
      expect(report.committedRecords).toBe(44);
      expect(report.failedRecords).toBe(6);
      expect(report.totalRecords).toBe(100);

      // Verify that unattempted rows (51 to 100) were NOT executed
      expect(report.attemptedRecords).toBeLessThan(report.totalRecords);
      expect(report.committedReceipts).toHaveLength(44);
      expect(report.failedRows).toHaveLength(6);
    });

    it('[AC-4 & AC-5] already committed rows and receipts remain durable without destructive rollback saga', async () => {
      const records: Crm1BatchRecordInput[] = Array.from({ length: 60 }, (_, i) => ({
        sourceRow: i + 1,
        idempotencyKey: `idemp-crm1-durable-${i + 1}`,
        data: { contactIndex: i + 1 },
      }));

      const report = await executeCrm1ChunkedBatchLoad(
        {
          batchId: 'batch-crm1-durable-receipts',
          module: 'crm-1',
          records,
          minAttemptedRows: 50,
          failureThreshold: 0.10,
          maxRetries: 0,
        },
        {
          worker: async (rec) => {
            if (rec.sourceRow >= 45) {
              throw new Error('Fatal database constraint error');
            }
            return { targetId: `tgt-durable-${rec.sourceRow}` };
          },
        }
      );

      expect(report.status).toBe('STOPPED_EXCESSIVE_FAILURES');

      // The 44 successfully processed rows remain fully durable in committedReceipts
      expect(report.committedReceipts).toHaveLength(44);
      for (let i = 0; i < 44; i++) {
        const rcpt = report.committedReceipts[i];
        expect(rcpt?.sourceRow).toBe(i + 1);
        expect(rcpt?.idempotencyKey).toBe(`idemp-crm1-durable-${i + 1}`);
        expect(rcpt?.targetId).toBe(`tgt-durable-${i + 1}`);
        expect(rcpt?.committedAt).toBeInstanceOf(Date);
      }

      // No destructive rollback occurred: receipts were not erased
      expect(report.committedRecords).toBe(44);
    });

    it('processes batches through Crm1Service and stores report for subsequent retrieval', async () => {
      const records: Crm1BatchRecordInput[] = [
        { sourceRow: 1, idempotencyKey: 'svc-key-01', data: { firstName: 'Diana' } },
        { sourceRow: 2, idempotencyKey: 'svc-key-02', data: { firstName: 'Evan' } },
      ];

      const report = await service.executeBatchLoad({
        batchId: 'batch-svc-001',
        module: 'crm-1',
        records,
      });

      expect(report.status).toBe('COMPLETED');
      expect(report.committedRecords).toBe(2);

      const retrieved = service.getBatchReport('batch-svc-001');
      expect(retrieved).toBeDefined();
      expect(retrieved?.batchId).toBe('batch-svc-001');
      expect(retrieved?.committedRecords).toBe(2);

      service.resetBatchReports();
      expect(service.getBatchReport('batch-svc-001')).toBeUndefined();
    });
  });
});
