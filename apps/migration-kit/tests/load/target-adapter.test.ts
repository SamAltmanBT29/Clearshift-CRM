import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeStableIdempotencyKey,
  computeCanonicalPayloadHash,
  type MigrationTargetAdapter,
} from '@clearshift/contracts';
import {
  BaseTargetAdapter,
  GenericTargetAdapterRegistry,
  InMemoryImportReceiptStore,
  TargetBatchLoader,
  DEFAULT_CHUNK_SIZE,
} from '../../src/load/target-adapter.js';

interface TestContactRow {
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * Concrete test adapter extending BaseTargetAdapter to verify target contract and receipts.
 */
class TestContactTargetAdapter extends BaseTargetAdapter<TestContactRow> {
  public readonly module = 'crm-1';
  public readonly entity = 'contacts';
  public readonly schemaVersion = 1;

  constructor(receiptStore?: InMemoryImportReceiptStore) {
    super(receiptStore);
  }

  protected async validateRow(row: TestContactRow): Promise<{
    valid: boolean;
    reasonCode?: string;
    message?: string;
    field?: string;
  }> {
    if (!row.email || !row.email.includes('@')) {
      return {
        valid: false,
        reasonCode: 'INVALID_EMAIL',
        message: 'A valid email is required',
        field: 'email',
      };
    }
    if (!row.firstName || row.firstName.trim().length === 0) {
      return {
        valid: false,
        reasonCode: 'FIRST_NAME_REQUIRED',
        message: 'First name is required',
        field: 'firstName',
      };
    }
    return { valid: true };
  }
}

describe('KIT-08: Generic Target Adapter, Stable Idempotency & Import Receipts', () => {
  let receiptStore: InMemoryImportReceiptStore;
  let adapter: TestContactTargetAdapter;
  let registry: GenericTargetAdapterRegistry;
  let loader: TargetBatchLoader;

  beforeEach(() => {
    receiptStore = new InMemoryImportReceiptStore();
    adapter = new TestContactTargetAdapter(receiptStore);
    registry = new GenericTargetAdapterRegistry();
    registry.register(adapter);
    loader = new TargetBatchLoader(registry);
  });

  describe('1. Stable Idempotency Key Derivation', () => {
    it('derives stable SHA-256 key from batch_id, source_row, module, entity, and version', () => {
      const key1 = computeStableIdempotencyKey({
        batchId: 'batch-001',
        sourceRow: 1,
        module: 'crm-1',
        entity: 'contacts',
        operationVersion: 1,
      });

      const key2 = computeStableIdempotencyKey({
        batchId: 'batch-001',
        sourceRow: 1,
        module: 'crm-1',
        entity: 'contacts',
        operationVersion: 1,
      });

      expect(key1).toBe(key2);
      expect(key1).toHaveLength(64); // SHA-256 hex string
    });

    it('generates distinct keys for different source rows or target entities', () => {
      const keyRow1 = computeStableIdempotencyKey({
        batchId: 'batch-001',
        sourceRow: 1,
        module: 'crm-1',
        entity: 'contacts',
      });
      const keyRow2 = computeStableIdempotencyKey({
        batchId: 'batch-001',
        sourceRow: 2,
        module: 'crm-1',
        entity: 'contacts',
      });
      const keyEntity2 = computeStableIdempotencyKey({
        batchId: 'batch-001',
        sourceRow: 1,
        module: 'crm-1',
        entity: 'companies',
      });

      expect(keyRow1).not.toBe(keyRow2);
      expect(keyRow1).not.toBe(keyEntity2);
    });

    it('throws validation error if row index is < 1 or fields are missing', () => {
      expect(() =>
        computeStableIdempotencyKey({
          batchId: 'batch-001',
          sourceRow: 0,
          module: 'crm-1',
          entity: 'contacts',
        })
      ).toThrow();

      expect(() =>
        computeStableIdempotencyKey({
          batchId: '',
          sourceRow: 1,
          module: 'crm-1',
          entity: 'contacts',
        })
      ).toThrow();
    });
  });

  describe('2. Idempotency Replay Semantics & Receipt Protocol', () => {
    it('creates exactly one target record and receipt when called three times with identical payload', async () => {
      const batchId = 'batch-idem-01';
      const sourceRow = 42;
      const key = computeStableIdempotencyKey({
        batchId,
        sourceRow,
        module: 'crm-1',
        entity: 'contacts',
      });
      const rowData: TestContactRow = {
        email: 'alex.chen@clearshift.internal',
        firstName: 'Alex',
        lastName: 'Chen',
      };

      // Call 1: initial import
      const res1 = await adapter.importRow(batchId, sourceRow, key, rowData);
      expect(res1.ok).toBe(true);
      if (!res1.ok) return;
      expect(res1.value.isExisting).toBe(false);
      const initialTargetId = res1.value.targetId;

      // Call 2: first retry
      const res2 = await adapter.importRow(batchId, sourceRow, key, rowData);
      expect(res2.ok).toBe(true);
      if (!res2.ok) return;
      expect(res2.value.targetId).toBe(initialTargetId);
      expect(res2.value.isExisting).toBe(true);

      // Call 3: second retry
      const res3 = await adapter.importRow(batchId, sourceRow, key, rowData);
      expect(res3.ok).toBe(true);
      if (!res3.ok) return;
      expect(res3.value.targetId).toBe(initialTargetId);
      expect(res3.value.isExisting).toBe(true);

      // Verify durable database state: exactly 1 business entity and 1 receipt
      expect(adapter.getTargetRecords()).toHaveLength(1);
      expect(await receiptStore.countByBatchId(batchId)).toBe(1);
    });

    it('returns prior target ID immediately on lost-response replay', async () => {
      const batchId = 'batch-lost-resp';
      const sourceRow = 15;
      const key = computeStableIdempotencyKey({
        batchId,
        sourceRow,
        module: 'crm-1',
        entity: 'contacts',
      });
      const rowData: TestContactRow = {
        email: 'sarah.connor@clearshift.internal',
        firstName: 'Sarah',
        lastName: 'Connor',
      };

      // Initial execution
      const initial = await adapter.importRow(batchId, sourceRow, key, rowData);
      expect(initial.ok).toBe(true);
      if (!initial.ok) return;
      const targetId = initial.value.targetId;

      // Simulate lost network response / client resending the exact same request
      const replay = await adapter.importRow(batchId, sourceRow, key, rowData);
      expect(replay.ok).toBe(true);
      if (!replay.ok) return;
      expect(replay.value.targetId).toBe(targetId);
      expect(replay.value.isExisting).toBe(true);
      expect(replay.value.receipt.targetId).toBe(targetId);
    });

    it('returns HTTP 409 conflict when same key is submitted with a modified payload', async () => {
      const batchId = 'batch-conflict-01';
      const sourceRow = 8;
      const key = computeStableIdempotencyKey({
        batchId,
        sourceRow,
        module: 'crm-1',
        entity: 'contacts',
      });
      const originalPayload: TestContactRow = {
        email: 'original@clearshift.internal',
        firstName: 'Original',
        lastName: 'User',
      };
      const alteredPayload: TestContactRow = {
        email: 'tampered@clearshift.internal',
        firstName: 'Tampered',
        lastName: 'User',
      };

      // Initial insert succeeds
      const first = await adapter.importRow(batchId, sourceRow, key, originalPayload);
      expect(first.ok).toBe(true);

      // Tampered payload with same idempotency key fails with 409 conflict
      const conflict = await adapter.importRow(batchId, sourceRow, key, alteredPayload);
      expect(conflict.ok).toBe(false);
      if (conflict.ok) return;
      expect(conflict.error.reasonCode).toBe('IDEMPOTENCY_CONFLICT');
      expect(conflict.error.message).toContain('already used with a different request payload');

      // Verify business table was NOT overwritten
      expect(adapter.getTargetRecords()).toHaveLength(1);
      expect(adapter.getTargetRecords()[0]?.data.email).toBe('original@clearshift.internal');
    });

    it('proves receipts survive worker process restart', async () => {
      const sharedDurableStore = new InMemoryImportReceiptStore();
      const batchId = 'batch-restart-01';
      const sourceRow = 99;
      const key = computeStableIdempotencyKey({
        batchId,
        sourceRow,
        module: 'crm-1',
        entity: 'contacts',
      });
      const payload: TestContactRow = {
        email: 'restart.survivor@clearshift.internal',
        firstName: 'Survivor',
        lastName: 'Worker',
      };

      // Worker 1 processes row and commits receipt to durable store
      const worker1Adapter = new TestContactTargetAdapter(sharedDurableStore);
      const res1 = await worker1Adapter.importRow(batchId, sourceRow, key, payload);
      expect(res1.ok).toBe(true);
      if (!res1.ok) return;
      const priorTargetId = res1.value.targetId;

      // Worker 1 crashes / terminates. Worker 2 spins up pointing to same durable store.
      const worker2Adapter = new TestContactTargetAdapter(sharedDurableStore);
      const res2 = await worker2Adapter.importRow(batchId, sourceRow, key, payload);

      expect(res2.ok).toBe(true);
      if (!res2.ok) return;
      expect(res2.value.targetId).toBe(priorTargetId);
      expect(res2.value.isExisting).toBe(true);
    });
  });

  describe('3. TargetBatchLoader & Chunked Execution Engine', () => {
    it('loads rows in default chunks of 500 rows', async () => {
      const rowCount = 1200;
      const rows = Array.from({ length: rowCount }, (_, i) => ({
        sourceRow: i + 1,
        data: {
          email: `user${i + 1}@clearshift.internal`,
          firstName: `User${i + 1}`,
          lastName: 'Test',
        },
      }));

      const summary = await loader.loadBatch('batch-chunk-01', 'crm-1', 'contacts', rows);

      expect(summary.totalSourceRows).toBe(1200);
      expect(summary.loadedCount).toBe(1200);
      expect(summary.rejectedCount).toBe(0);
      expect(summary.skippedCount).toBe(0);
      expect(summary.unaccountedCount).toBe(0);
      expect(summary.reconciliationStatus).toBe('OK');
      // 1200 / 500 chunks = 3 chunks (500 + 500 + 200)
      expect(summary.chunksProcessed).toBe(3);
      expect(adapter.getTargetRecords()).toHaveLength(1200);
    });

    it('stops safely when cumulative row failures exceed 10% threshold', async () => {
      // 100 rows total: first 5 rows valid, next 15 rows invalid (15/20 = 75% failure rate > 10%)
      const rows: Array<{ sourceRow: number; data: TestContactRow }> = [];
      for (let i = 1; i <= 5; i++) {
        rows.push({
          sourceRow: i,
          data: {
            email: `valid${i}@clearshift.internal`,
            firstName: `Valid${i}`,
            lastName: 'User',
          },
        });
      }
      for (let i = 6; i <= 100; i++) {
        rows.push({
          sourceRow: i,
          data: {
            email: 'invalid-email-format', // will fail validation
            firstName: '',
            lastName: 'User',
          },
        });
      }

      const summary = await loader.loadBatch('batch-fail-01', 'crm-1', 'contacts', rows, {
        chunkSize: 50,
        maxFailureRatePercent: 10.0,
      });

      expect(summary.halted).toBe(true);
      expect(summary.haltReason).toContain('exceeds 10% threshold');
      expect(summary.unaccountedCount).toBe(0);
      expect(summary.loadedCount + summary.rejectedCount + summary.skippedCount).toBe(100);
    });

    it('properly preserves skipped rows without mutating target and maintains row conservation', async () => {
      const rows = [
        {
          sourceRow: 1,
          data: { email: 'user1@clearshift.internal', firstName: 'User1', lastName: 'Test' },
          skipped: false,
        },
        {
          sourceRow: 2,
          data: { email: 'user2@clearshift.internal', firstName: 'User2', lastName: 'Test' },
          skipped: true,
          skipReason: 'EXPLICIT_USER_FILTER',
        },
        {
          sourceRow: 3,
          data: { email: 'user3@clearshift.internal', firstName: 'User3', lastName: 'Test' },
          skipped: false,
        },
      ];

      const summary = await loader.loadBatch('batch-skip-01', 'crm-1', 'contacts', rows);

      expect(summary.totalSourceRows).toBe(3);
      expect(summary.loadedCount).toBe(2);
      expect(summary.skippedCount).toBe(1);
      expect(summary.rejectedCount).toBe(0);
      expect(summary.unaccountedCount).toBe(0);
      expect(summary.reconciliationStatus).toBe('OK');
      expect(adapter.getTargetRecords()).toHaveLength(2);
    });

    it('dry run predicts outcomes with zero database mutations or receipts', async () => {
      const rows = [
        {
          sourceRow: 1,
          data: { email: 'dry1@clearshift.internal', firstName: 'Dry1', lastName: 'Test' },
        },
        {
          sourceRow: 2,
          data: { email: 'dry2@clearshift.internal', firstName: 'Dry2', lastName: 'Test' },
        },
      ];

      const summary = await loader.loadBatch('batch-dry-01', 'crm-1', 'contacts', rows, {
        isDryRun: true,
      });

      expect(summary.loadedCount).toBe(2);
      expect(summary.unaccountedCount).toBe(0);
      expect(summary.reconciliationStatus).toBe('OK');

      // Crucial invariant: zero target records and zero receipts created during dry-run
      expect(adapter.getTargetRecords()).toHaveLength(0);
      expect(await receiptStore.countByBatchId('batch-dry-01')).toBe(0);
    });
  });
});
