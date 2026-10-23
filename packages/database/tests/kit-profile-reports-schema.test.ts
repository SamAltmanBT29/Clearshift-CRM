import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { assertModuleOwnership } from '../src/clients.js';
import { kitProfileReports } from '../src/schema/kit.js';

describe('Migration Kit Profile Reports Schema & Ownership (KIT-03)', () => {
  const migrationPath = join(__dirname, '../migrations/kit_profile_reports_v1.sql');

  // ---------------------------------------------------------------------------
  // 1. Migration File Presence & SQL Invariants
  // ---------------------------------------------------------------------------
  describe('kit_profile_reports_v1.sql DDL Invariants', () => {
    it('migration file exists in packages/database/migrations', () => {
      expect(existsSync(migrationPath)).toBe(true);
    });

    it('defines public.kit_profile_reports table with required columns and constraints', () => {
      const sql = readFileSync(migrationPath, 'utf8');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.kit_profile_reports');
      expect(sql).toContain('batch_id UUID NOT NULL REFERENCES public.kit_batches(id)');
      expect(sql).toContain('column_name TEXT NOT NULL');
      expect(sql).toContain('empty_count INTEGER NOT NULL DEFAULT 0');
      expect(sql).toContain('invalid_count INTEGER NOT NULL DEFAULT 0');
      expect(sql).toContain('distinct_count INTEGER NOT NULL DEFAULT 0');
      expect(sql).toContain('inferred_type TEXT NOT NULL DEFAULT \'string\'');
      expect(sql).toContain('top_values_json JSONB NOT NULL DEFAULT \'[]\'');
      expect(sql).toContain('CONSTRAINT uq_kit_profile_reports_batch_col UNIQUE (batch_id, column_name)');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_kit_profile_reports_batch_id');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Module Ownership & Boundary Isolation (PLT-03)
  // ---------------------------------------------------------------------------
  describe('PLT-03 Table Ownership Boundary', () => {
    it('allows kit module to write to kit_profile_reports', () => {
      expect(assertModuleOwnership('kit', 'kit_profile_reports')).toBe(true);
    });

    it('allows platform role administrative access to kit_profile_reports', () => {
      expect(assertModuleOwnership('platform', 'kit_profile_reports')).toBe(true);
    });

    it('forbids other CRM modules from writing to kit_profile_reports directly', () => {
      expect(() => {
        assertModuleOwnership('crm-1', 'kit_profile_reports');
      }).toThrow(/\[PLT-03 Ownership Violation\]/);

      expect(() => {
        assertModuleOwnership('crm-2', 'kit_profile_reports');
      }).toThrow(/\[PLT-03 Ownership Violation\]/);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Drizzle Table Mapping
  // ---------------------------------------------------------------------------
  describe('Drizzle Table Schema Definition', () => {
    it('exports kitProfileReports table mapping', () => {
      expect(kitProfileReports).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((kitProfileReports as any)[Symbol.for('drizzle:Name')]).toBe('kit_profile_reports');
    });
  });
});
