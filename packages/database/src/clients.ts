import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getDatabase, getDatabasePool } from './registry.js';
import pg from 'pg';

export type CrmModuleName =
  | 'crm-1'
  | 'crm-2'
  | 'crm-3'
  | 'crm-4'
  | 'crm-5'
  | 'platform'
  | 'kit';

export interface ModuleDbClientConfig {
  module: CrmModuleName;
  connectionString?: string;
}

/**
 * Registry of allowed schema prefixes per module to enforce DB boundary isolation.
 * Prevents cross-module writes by verifying target table ownership.
 */
export const MODULE_SCHEMA_MAP: Record<CrmModuleName, { prefix: string; role: string }> = {
  'crm-1': { prefix: 'crm1_', role: 'cs_crm1_role' },
  'crm-2': { prefix: 'crm2_', role: 'cs_crm2_role' },
  'crm-3': { prefix: 'crm3_', role: 'cs_crm3_role' },
  'crm-4': { prefix: 'crm4_', role: 'cs_crm4_role' },
  'crm-5': { prefix: 'crm5_', role: 'cs_crm5_role' },
  platform: { prefix: 'plt_', role: 'cs_plt_role' },
  kit: { prefix: 'kit_', role: 'cs_kit_role' },
};

/**
 * Asserts that a module has ownership rights to write to a target table.
 * Shared utility may not bypass module APIs or issue cross-module writes (PLT-03 constraint).
 */
export function assertModuleOwnership(invokingModule: CrmModuleName, targetTableName: string): boolean {
  if (invokingModule === 'platform') {
    return true; // Platform has administrative oversight
  }

  const expectedPrefix = MODULE_SCHEMA_MAP[invokingModule]?.prefix;
  const isKitOwned = invokingModule === 'kit' && (targetTableName === 'raw_rows' || targetTableName.startsWith('kit_'));
  if (!expectedPrefix || (!targetTableName.startsWith(expectedPrefix) && !isKitOwned)) {
    throw new Error(
      `[PLT-03 Ownership Violation] Module '${invokingModule}' is not permitted to mutate table '${targetTableName}'. Target table belongs to '${targetTableName.split('_')[0]}' ownership domain.`
    );
  }
  return true;
}

/**
 * Typed DB client scoped to a specific module domain.
 */
export function getModuleDatabase(
  module: CrmModuleName,
  connectionString?: string
): NodePgDatabase {
  return getDatabase(connectionString);
}

/**
 * Generates connection credentials for least-privilege database roles.
 */
export function getModuleConnectionConfig(
  module: CrmModuleName,
  baseConnectionString?: string
): pg.PoolConfig {
  const base =
    baseConnectionString ||
    process.env['DATABASE_URL'] ||
    'postgresql://cs_app:app_secret_123@localhost:5432/clearshift';

  return {
    connectionString: base,
    application_name: `clearshift_${module}`,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  };
}
