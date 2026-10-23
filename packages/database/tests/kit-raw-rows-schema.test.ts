import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { assertModuleOwnership } from '../src/clients.js';
import { rawRows } from '../src/schema/kit.js';

describe('Migration Kit Raw Rows Schema & Immutability (KIT-02)', () => {
  const migrationPath = join(__dirname, '../migrations/kit_raw_rows_v1.sql');

  // ---------------------------------------------------------------------------
  // 1. Migration File Presence & SQL Invariants
  // ---------------------------------------------------------------------------
  describe('kit_raw_rows_v1.sql DDL Invariants', () => {
    it('migration file exists in packages/database/migrations', () => {
      expect(existsSync(migrationPath)).toBe(true);
    });

    it('defines public.raw_rows table with required columns and constraints', () => {
      const sql = readFileSync(migrationPath, 'utf8');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.raw_rows');
      expect(sql).toContain('batch_id UUID NOT NULL REFERENCES public.kit_batches(id)');
      expect(sql).toContain('source_row INTEGER NOT NULL');
      expect(sql).toContain('headers TEXT[] NOT NULL');
      expect(sql).toContain('cells TEXT[] NOT NULL');
      expect(sql).toContain('payload JSONB NOT NULL');
      expect(sql).toContain('row_hash VARCHAR(64) NOT NULL');
      expect(sql).toContain('CONSTRAINT uq_raw_rows_batch_source UNIQUE (batch_id, source_row)');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_raw_rows_batch_id');
    });

    it('defines database trigger preventing UPDATE and DELETE on raw_rows', () => {
      const sql = readFileSync(migrationPath, 'utf8');
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.fn_guard_raw_rows_immutable()');
      expect(sql).toContain('CREATE TRIGGER trg_guard_raw_rows_immutable');
      expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.raw_rows');
      expect(sql).toContain('Mutation violation: raw_rows is an immutable landing table and cannot be modified or deleted');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Module Ownership & Boundary Isolation (PLT-03)
  // ---------------------------------------------------------------------------
  describe('PLT-03 Table Ownership Boundary', () => {
    it('allows kit module to own and write to raw_rows', () => {
      expect(assertModuleOwnership('kit', 'raw_rows')).toBe(true);
    });

    it('allows platform role administrative access to raw_rows', () => {
      expect(assertModuleOwnership('platform', 'raw_rows')).toBe(true);
    });

    it('forbids other CRM modules from writing to raw_rows directly', () => {
      expect(() => {
        assertModuleOwnership('crm-1', 'raw_rows');
      }).toThrow(/\[PLT-03 Ownership Violation\]/);

      expect(() => {
        assertModuleOwnership('crm-2', 'raw_rows');
      }).toThrow(/\[PLT-03 Ownership Violation\]/);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Drizzle Table Mapping
  // ---------------------------------------------------------------------------
  describe('Drizzle Table Schema Definition', () => {
    it('exports rawRows table mapping', () => {
      expect(rawRows).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((rawRows as any)[Symbol.for('drizzle:Name')]).toBe('raw_rows');
    });
  });
});
