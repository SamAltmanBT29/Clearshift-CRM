import { describe, it, expect } from 'vitest';
import { readdirSync } from 'fs';
import { resolve } from 'path';
import {
  assertModuleOwnership,
  MODULE_SCHEMA_MAP,
  getModuleConnectionConfig,
} from '../src/clients.js';
import { withTransaction } from '../src/tx.js';

describe('[PLT-03] Database Ownership and Isolation Tests', () => {
  describe('Schema Ownership Isolation', () => {
    it('defines distinct prefix and role for every CRM module and kit', () => {
      expect(MODULE_SCHEMA_MAP['crm-1'].prefix).toBe('crm1_');
      expect(MODULE_SCHEMA_MAP['crm-2'].prefix).toBe('crm2_');
      expect(MODULE_SCHEMA_MAP['crm-3'].prefix).toBe('crm3_');
      expect(MODULE_SCHEMA_MAP['crm-4'].prefix).toBe('crm4_');
      expect(MODULE_SCHEMA_MAP['crm-5'].prefix).toBe('crm5_');
      expect(MODULE_SCHEMA_MAP['kit'].prefix).toBe('kit_');
      expect(MODULE_SCHEMA_MAP['platform'].prefix).toBe('plt_');
    });

    it('allows a module to write to tables within its own schema prefix', () => {
      expect(assertModuleOwnership('crm-1', 'crm1_contacts')).toBe(true);
      expect(assertModuleOwnership('crm-1', 'crm1_companies')).toBe(true);
      expect(assertModuleOwnership('crm-5', 'crm5_migration_runs')).toBe(true);
      expect(assertModuleOwnership('kit', 'kit_batches')).toBe(true);
    });

    it('strictly forbids cross-module direct writes', () => {
      // CRM-2 cannot write CRM-1 tables
      expect(() => {
        assertModuleOwnership('crm-2', 'crm1_contacts');
      }).toThrow(/\[PLT-03 Ownership Violation\]/);

      // CRM-3 cannot write CRM-5 tables
      expect(() => {
        assertModuleOwnership('crm-3', 'crm5_migration_runs');
      }).toThrow(/\[PLT-03 Ownership Violation\]/);
    });

    it('forbids Kit from writing module target tables directly (requires adapter)', () => {
      expect(() => {
        assertModuleOwnership('kit', 'crm1_contacts');
      }).toThrow(/\[PLT-03 Ownership Violation\]/);

      expect(() => {
        assertModuleOwnership('kit', 'crm5_migration_runs');
      }).toThrow(/\[PLT-03 Ownership Violation\]/);
    });

    it('allows platform administrative oversight across prefixes', () => {
      expect(assertModuleOwnership('platform', 'crm1_contacts')).toBe(true);
      expect(assertModuleOwnership('platform', 'plt_audit_log')).toBe(true);
    });
  });

  describe('Connection Scoping and Security', () => {
    it('configures distinct application_name and pooled timeouts for least-privilege roles', () => {
      const config = getModuleConnectionConfig('crm-1');
      expect(config.application_name).toBe('clearshift_crm-1');
      expect(config.max).toBe(10);
      expect(config.idleTimeoutMillis).toBe(30000);
      expect(config.connectionTimeoutMillis).toBe(2000);
    });
  });

  describe('Atomic Transaction Rollback Contract', () => {
    it('rolls back and propagates error when transaction callback throws', async () => {
      let rolledBack = false;
      const fakeDb = {
        transaction: async (cb: (tx: any) => Promise<any>) => {
          try {
            await cb({});
          } catch (err) {
            rolledBack = true;
            throw err;
          }
        },
      };

      await expect(
        withTransaction(async () => {
          throw new Error('Simulated atomic failure');
        }, fakeDb as any)
      ).rejects.toThrow('Simulated atomic failure');

      expect(rolledBack).toBe(true);
    });
  });

  describe('Migration Ledger Verification', () => {
    it('verifies migration directory exists with versioned SQL scripts', () => {
      const migrationsDir = resolve(__dirname, '../migrations');
      const files = readdirSync(migrationsDir);
      const sqlFiles = files.filter((f) => f.endsWith('.sql'));

      expect(sqlFiles.length).toBeGreaterThan(0);
      for (const sqlFile of sqlFiles) {
        expect(sqlFile).toMatch(/^[a-z0-9_]+_v[0-9]+.*\.sql$/);
      }
    });
  });
});
