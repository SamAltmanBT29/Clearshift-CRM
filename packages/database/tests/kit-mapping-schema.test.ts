import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { kitMappings, cleanCrm } from '../src/schema/kit.js';
import { assertModuleOwnership } from '../src/clients.js';

describe('KIT-05: Mapping Tables Schema & PLT-03 Module Ownership', () => {
  const migrationPath = resolve(process.cwd(), 'packages/database/migrations/kit_mapping_v1.sql');
  const sql = readFileSync(migrationPath, 'utf8');

  it('defines public.kit_mappings table with required columns and constraints', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.kit_mappings');
    expect(sql).toContain('id UUID PRIMARY KEY DEFAULT gen_random_uuid()');
    expect(sql).toContain('module TEXT NOT NULL');
    expect(sql).toContain('name TEXT NOT NULL');
    expect(sql).toContain('version TEXT NOT NULL DEFAULT');
    expect(sql).toContain('target_entity TEXT NOT NULL DEFAULT');
    expect(sql).toContain('mapping_json JSONB NOT NULL');
    expect(sql).toContain('value_conversions_json JSONB NOT NULL');
    expect(sql).toContain('CONSTRAINT uq_kit_mappings_module_name_version UNIQUE (module, name, version)');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_kit_mappings_module ON public.kit_mappings(module)');
  });

  it('defines public.clean_crm table with required columns, constraints and indexes', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.clean_crm');
    expect(sql).toContain('id UUID PRIMARY KEY DEFAULT gen_random_uuid()');
    expect(sql).toContain('batch_id UUID NOT NULL REFERENCES public.kit_batches(id) ON DELETE CASCADE');
    expect(sql).toContain('source_row INTEGER NOT NULL');
    expect(sql).toContain('payload JSONB NOT NULL');
    expect(sql).toContain('CONSTRAINT uq_clean_crm_batch_source_row UNIQUE (batch_id, source_row)');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_clean_crm_batch_id ON public.clean_crm(batch_id)');
  });

  it('allows kit module to write to kit_mappings and clean_crm', () => {
    expect(assertModuleOwnership('kit', 'kit_mappings')).toBe(true);
    expect(assertModuleOwnership('kit', 'clean_crm')).toBe(true);
  });

  it('allows platform module administrative oversight to kit_mappings and clean_crm', () => {
    expect(assertModuleOwnership('platform', 'kit_mappings')).toBe(true);
    expect(assertModuleOwnership('platform', 'clean_crm')).toBe(true);
  });

  it('rejects cross-module direct writes from crm-1 to kit_mappings or clean_crm', () => {
    expect(() => assertModuleOwnership('crm-1', 'kit_mappings')).toThrow(/\[PLT-03 Ownership Violation\]/);
    expect(() => assertModuleOwnership('crm-1', 'clean_crm')).toThrow(/\[PLT-03 Ownership Violation\]/);
  });

  it('exports valid Drizzle pgTable definitions', () => {
    expect(kitMappings).toBeDefined();
    expect((kitMappings as any)[Symbol.for('drizzle:Name')]).toBe('kit_mappings');

    expect(cleanCrm).toBeDefined();
    expect((cleanCrm as any)[Symbol.for('drizzle:Name')]).toBe('clean_crm');
  });
});
