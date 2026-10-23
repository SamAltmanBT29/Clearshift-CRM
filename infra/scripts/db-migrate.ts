/**
 * ClearShift Controlled Database Migration Runner [PLT-02]
 *
 * Enforces single-process, idempotent execution of database migrations with:
 * - Connection health-check and wait-for-ready polling
 * - PostgreSQL advisory locking to eliminate race conditions between app instances
 * - Atomic per-migration transactions with rollback on error
 * - Public schema_migrations tracking ledger
 * - Safe credential handling and masked logging
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = join(__dirname, '../../packages/database/migrations');

export interface MigrationOptions {
  databaseUrl?: string;
  migrationsDir?: string;
  wait?: boolean;
  timeoutMs?: number;
  waitOnly?: boolean;
  silent?: boolean;
}

export interface MigrationResult {
  applied: number;
  skipped: number;
  total: number;
}

/**
 * Masks database credentials from connection strings for safe logging.
 */
export function maskDatabaseUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    if (parsed.password) {
      parsed.password = '****';
    }
    return parsed.toString();
  } catch {
    return urlStr.replace(/:[^:@]+@/, ':****@');
  }
}

/**
 * Resolves the appropriate database URL based on runtime environment variables.
 * Priority: DATABASE_MIGRATOR_URL (DDL role) > DATABASE_URL_TEST (if test) > DATABASE_URL > default dev
 */
export function resolveDatabaseUrl(): string {
  if (process.env['DATABASE_MIGRATOR_URL']) {
    return process.env['DATABASE_MIGRATOR_URL'];
  }
  if (process.env['NODE_ENV'] === 'test' && process.env['DATABASE_URL_TEST']) {
    return process.env['DATABASE_URL_TEST'];
  }
  if (process.env['DATABASE_URL']) {
    return process.env['DATABASE_URL'];
  }
  return 'postgresql://postgres:postgres_dev_secret@localhost:5432/clearshift';
}

/**
 * Polls the PostgreSQL connection until healthy or timeout expires.
 */
export async function waitForDatabase(
  databaseUrl: string,
  timeoutMs: number = 30000,
  intervalMs: number = 1000,
  silent: boolean = false
): Promise<boolean> {
  const maskedUrl = maskDatabaseUrl(databaseUrl);
  if (!silent) {
    console.log(`🔌 Checking database readiness at ${maskedUrl}...`);
  }

  const startTime = Date.now();
  let attempts = 0;

  while (Date.now() - startTime < timeoutMs) {
    attempts++;
    const testPool = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: Math.min(3000, intervalMs * 2),
    });

    try {
      const client = await testPool.connect();
      try {
        await client.query('SELECT 1');
        if (!silent) {
          console.log(`✅ Database is healthy and ready (connected after ${attempts} attempt(s)).`);
        }
        return true;
      } finally {
        client.release();
        await testPool.end();
      }
    } catch {
      await testPool.end().catch(() => {});
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
      if (!silent) {
        console.log(`⏳ Waiting for database to become healthy... (${elapsedSec}s elapsed)`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw new Error(`Database at ${maskedUrl} failed to become healthy within ${timeoutMs}ms.`);
}

/**
 * Executes pending database migrations sequentially inside individual transactions.
 */
export async function runMigrations(options: MigrationOptions = {}): Promise<MigrationResult> {
  const databaseUrl = options.databaseUrl || resolveDatabaseUrl();
  const migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const timeoutMs = options.timeoutMs ?? 30000;
  const silent = options.silent ?? false;

  // 1. Wait for database health
  await waitForDatabase(databaseUrl, timeoutMs, 1000, silent);

  if (options.waitOnly) {
    return { applied: 0, skipped: 0, total: 0 };
  }

  const pool = new Pool({ connectionString: databaseUrl });
  let client: pg.PoolClient | null = null;
  let lockAcquired = false;

  try {
    client = await pool.connect();

    // 2. Acquire PostgreSQL advisory lock to ensure single-runner execution
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['clearshift.schema_migrations']);
    lockAcquired = true;

    // 3. Ensure schema_migrations ledger exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        id          SERIAL PRIMARY KEY,
        migration   VARCHAR(256) NOT NULL UNIQUE,
        applied_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `);

    // 4. Discover and sort migration files
    const migrationFiles = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    let applied = 0;
    let skipped = 0;

    for (const file of migrationFiles) {
      const migrationName = file.replace(/\.sql$/, '');

      // Check if already recorded
      const { rows } = await client.query(
        'SELECT 1 FROM public.schema_migrations WHERE migration = $1',
        [migrationName]
      );

      if (rows.length > 0) {
        if (!silent) {
          console.log(`⏭️  Skipping ${migrationName} (already applied)`);
        }
        skipped++;
        continue;
      }

      if (!silent) {
        console.log(`⚡ Applying migration: ${migrationName} ...`);
      }

      const sql = readFileSync(join(migrationsDir, file), 'utf-8');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO public.schema_migrations (migration) VALUES ($1)',
          [migrationName]
        );
        await client.query('COMMIT');

        if (!silent) {
          console.log(`✅ ${migrationName} applied successfully`);
        }
        applied++;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Failed to apply migration ${migrationName}: ${err instanceof Error ? err.message : String(err)}`, {
          cause: err,
        });
      }
    }

    if (!silent) {
      console.log('\n📊 Migration Summary:');
      console.log(`   Applied : ${applied}`);
      console.log(`   Skipped : ${skipped}`);
      console.log(`   Total   : ${migrationFiles.length}`);
    }

    return { applied, skipped, total: migrationFiles.length };
  } finally {
    if (client && lockAcquired) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['clearshift.schema_migrations']).catch(() => {});
    }
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

// Direct CLI Execution
const isDirectCli = process.argv[1] && (process.argv[1].endsWith('db-migrate.ts') || process.argv[1].endsWith('db-migrate.js'));

if (isDirectCli) {
  const args = process.argv.slice(2);
  const waitOnly = args.includes('--wait-only') || args.includes('--wait');
  const timeoutArgIdx = args.indexOf('--timeout');
  const timeoutMs = timeoutArgIdx !== -1 && args[timeoutArgIdx + 1] ? parseInt(args[timeoutArgIdx + 1], 10) : 30000;

  runMigrations({ waitOnly, timeoutMs })
    .then(() => {
      console.log('🎉 Database migration operations completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Database migration failed:', err);
      process.exit(1);
    });
}
