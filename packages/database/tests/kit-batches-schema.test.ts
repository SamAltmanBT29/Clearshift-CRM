import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { assertModuleOwnership } from '../src/clients.js';
import { kitBatches, kitBatchSteps } from '../src/schema/kit.js';

describe('Migration Kit Database Schema & Ownership (KIT-01 / PLT-03)', () => {
  const migrationPath = join(__dirname, '../migrations/kit_batches_v1.sql');

  // ---------------------------------------------------------------------------
  // 1. Migration File Presence & SQL Invariants
  // ---------------------------------------------------------------------------
  describe('kit_batches_v1.sql DDL Invariants', () => {
    it('migration file exists in packages/database/migrations', () => {
      expect(existsSync(migrationPath)).toBe(true);
    });

    it('defines public.kit_batches and public.kit_batch_steps tables', () => {
      const sql = readFileSync(migrationPath, 'utf8');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.kit_batches');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.kit_batch_steps');
    });

    it('enforces status check constraints for all 17 V1 lifecycle states', () => {
      const sql = readFileSync(migrationPath, 'utf8');
      const requiredStatuses = [
        'created',
        'extracting',
        'extracted',
        'profiled',
        'cleaned',
        'mapped',
        'dry_run_passed',
        'loading',
        'loaded',
        'validating',
        'validated',
        'reconciled',
        'failed',
        'load_failed_partial',
        'rollback_pending',
        'rollback_blocked',
        'rolled_back',
      ];

      for (const status of requiredStatuses) {
        expect(sql).toContain(`'${status}'`);
      }
    });

    it('defines state transition trigger guard function and trigger', () => {
      const sql = readFileSync(migrationPath, 'utf8');
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.fn_guard_kit_batch_transition');
      expect(sql).toContain('CREATE TRIGGER trg_guard_kit_batch_transition');
      expect(sql).toContain('BEFORE UPDATE OF status ON public.kit_batches');
      expect(sql).toContain('cannot restart from created implicitly');
      expect(sql).toContain('Reconciliation invariant violation');
    });

    it('defines append-only immutable step ledger trigger function and trigger', () => {
      const sql = readFileSync(migrationPath, 'utf8');
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.fn_guard_kit_batch_steps_immutable');
      expect(sql).toContain('CREATE TRIGGER trg_guard_kit_batch_steps_immutable');
      expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.kit_batch_steps');
      expect(sql).toContain('Mutation violation: kit_batch_steps is an immutable append-only ledger');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Module Ownership & Boundary Isolation (PLT-03)
  // ---------------------------------------------------------------------------
  describe('PLT-03 Table Ownership Boundary', () => {
    it('allows kit module to write to kit_batches and kit_batch_steps', () => {
      expect(assertModuleOwnership('kit', 'kit_batches')).toBe(true);
      expect(assertModuleOwnership('kit', 'kit_batch_steps')).toBe(true);
    });

    it('allows platform role administrative access to kit tables', () => {
      expect(assertModuleOwnership('platform', 'kit_batches')).toBe(true);
      expect(assertModuleOwnership('platform', 'kit_batch_steps')).toBe(true);
    });

    it('forbids crm-1, crm-2, crm-5 or erp modules from directly writing to kit tables', () => {
      expect(() => assertModuleOwnership('crm-1', 'kit_batches')).toThrow(
        /PLT-03 Ownership Violation/
      );
      expect(() => assertModuleOwnership('crm-5', 'kit_batches')).toThrow(
        /PLT-03 Ownership Violation/
      );
      expect(() => assertModuleOwnership('crm-2', 'kit_batch_steps')).toThrow(
        /PLT-03 Ownership Violation/
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Drizzle Schema Columns Verification
  // ---------------------------------------------------------------------------
  describe('Drizzle ORM Schema Objects', () => {
    it('kitBatches schema object defines all required columns', () => {
      expect(kitBatches.id).toBeDefined();
      expect(kitBatches.batchNumber).toBeDefined();
      expect(kitBatches.module).toBeDefined();
      expect(kitBatches.status).toBeDefined();
      expect(kitBatches.previousStatus).toBeDefined();
      expect(kitBatches.checkpoint).toBeDefined();
      expect(kitBatches.attempt).toBeDefined();
      expect(kitBatches.maxAttempts).toBeDefined();
      expect(kitBatches.totalRows).toBeDefined();
      expect(kitBatches.loadedRows).toBeDefined();
      expect(kitBatches.rejectedRows).toBeDefined();
      expect(kitBatches.mergedRows).toBeDefined();
      expect(kitBatches.skippedRows).toBeDefined();
      expect(kitBatches.unaccountedRows).toBeDefined();
      expect(kitBatches.ruleVersion).toBeDefined();
      expect(kitBatches.codeVersion).toBeDefined();
      expect(kitBatches.correlationId).toBeDefined();
      expect(kitBatches.metadata).toBeDefined();
    });

    it('kitBatchSteps schema object defines all required ledger columns', () => {
      expect(kitBatchSteps.id).toBeDefined();
      expect(kitBatchSteps.batchId).toBeDefined();
      expect(kitBatchSteps.stepNumber).toBeDefined();
      expect(kitBatchSteps.stepName).toBeDefined();
      expect(kitBatchSteps.fromStatus).toBeDefined();
      expect(kitBatchSteps.toStatus).toBeDefined();
      expect(kitBatchSteps.attempt).toBeDefined();
      expect(kitBatchSteps.checkpoint).toBeDefined();
      expect(kitBatchSteps.recordsIn).toBeDefined();
      expect(kitBatchSteps.recordsOut).toBeDefined();
      expect(kitBatchSteps.recordsRejected).toBeDefined();
      expect(kitBatchSteps.recordsMerged).toBeDefined();
      expect(kitBatchSteps.recordsSkipped).toBeDefined();
      expect(kitBatchSteps.correlationId).toBeDefined();
      expect(kitBatchSteps.actor).toBeDefined();
      expect(kitBatchSteps.durationMs).toBeDefined();
      expect(kitBatchSteps.startedAt).toBeDefined();
      expect(kitBatchSteps.finishedAt).toBeDefined();
    });
  });
});
