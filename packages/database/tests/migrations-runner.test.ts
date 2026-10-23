/**
 * Migration Runner & Compose Environment Verification [PLT-02]
 *
 * Validates the controlled migration runner, wait-for-health guards,
 * credential masking, and synthetic seed safety.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  maskDatabaseUrl,
  resolveDatabaseUrl,
  waitForDatabase,
} from '../../../infra/scripts/db-migrate.js';
import { assertSafeDatabaseUrl } from '../../../infra/scripts/seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../migrations');
const COMPOSE_FILE = join(__dirname, '../../../infra/compose.yaml');

describe('[PLT-02] Controlled DB Migrations, Health Checks & Compose Safety', () => {
  describe('A. Credential Masking & Logging Safety', () => {
    it('masks passwords in standard PostgreSQL connection URLs', () => {
      const plainUrl = 'postgresql://cs_app:super_secret_password_123@localhost:5432/clearshift';
      const masked = maskDatabaseUrl(plainUrl);

      expect(masked).not.toContain('super_secret_password_123');
      expect(masked).toContain('****');
      expect(masked).toContain('cs_app:****@localhost:5432/clearshift');
    });

    it('masks passwords in fallback/raw format gracefully', () => {
      const raw = 'postgres://user:mysecret@127.0.0.1:5432/clearshift_dev';
      const masked = maskDatabaseUrl(raw);

      expect(masked).not.toContain('mysecret');
      expect(masked).toContain('****');
    });

    it('handles connection strings without passwords safely', () => {
      const noPass = 'postgresql://localhost:5432/clearshift_test';
      const masked = maskDatabaseUrl(noPass);

      expect(masked).toBe(noPass);
    });
  });

  describe('B. Runtime Credential Resolution & Role Separation', () => {
    it('prioritizes DATABASE_MIGRATOR_URL for DDL operations', () => {
      const originalMigrator = process.env['DATABASE_MIGRATOR_URL'];
      const originalApp = process.env['DATABASE_URL'];

      try {
        process.env['DATABASE_MIGRATOR_URL'] =
          'postgresql://cs_migrator:migrator_secret@localhost:5432/clearshift';
        process.env['DATABASE_URL'] =
          'postgresql://cs_app:app_secret@localhost:5432/clearshift';

        const resolved = resolveDatabaseUrl();
        expect(resolved).toBe(
          'postgresql://cs_migrator:migrator_secret@localhost:5432/clearshift'
        );
      } finally {
        if (originalMigrator !== undefined) {
          process.env['DATABASE_MIGRATOR_URL'] = originalMigrator;
        } else {
          delete process.env['DATABASE_MIGRATOR_URL'];
        }
        if (originalApp !== undefined) {
          process.env['DATABASE_URL'] = originalApp;
        } else {
          delete process.env['DATABASE_URL'];
        }
      }
    });

    it('falls back to DATABASE_URL when DATABASE_MIGRATOR_URL is unset', () => {
      const originalMigrator = process.env['DATABASE_MIGRATOR_URL'];
      const originalApp = process.env['DATABASE_URL'];
      const originalTest = process.env['DATABASE_URL_TEST'];

      try {
        delete process.env['DATABASE_MIGRATOR_URL'];
        delete process.env['DATABASE_URL_TEST'];
        process.env['DATABASE_URL'] =
          'postgresql://cs_app:app_secret@localhost:5432/clearshift';

        const resolved = resolveDatabaseUrl();
        expect(resolved).toBe(
          'postgresql://cs_app:app_secret@localhost:5432/clearshift'
        );
      } finally {
        if (originalMigrator !== undefined) process.env['DATABASE_MIGRATOR_URL'] = originalMigrator;
        if (originalApp !== undefined) process.env['DATABASE_URL'] = originalApp;
        if (originalTest !== undefined) process.env['DATABASE_URL_TEST'] = originalTest;
      }
    });
  });

  describe('C. Database Safety Guards (Non-Negotiable §9.4)', () => {
    it('allows safe local development and test database hosts', () => {
      expect(() => {
        assertSafeDatabaseUrl('postgresql://localhost:5432/clearshift');
      }).not.toThrow();

      expect(() => {
        assertSafeDatabaseUrl('postgresql://127.0.0.1:5432/clearshift_test');
      }).not.toThrow();

      expect(() => {
        assertSafeDatabaseUrl('postgresql://postgres:5432/clearshift_dev');
      }).not.toThrow();
    });

    it('strictly refuses database reset or seed against remote/production hosts', () => {
      expect(() => {
        assertSafeDatabaseUrl('postgresql://prod-db.clearshift.internal:5432/clearshift');
      }).toThrow(/Refusing database seed! Host 'prod-db.clearshift.internal' is not in the safe development allowlist/);

      expect(() => {
        assertSafeDatabaseUrl('postgresql://rds.amazonaws.com:5432/clearshift');
      }).toThrow(/Refusing database seed!/);
    });

    it('strictly refuses execution against unauthorized database names', () => {
      expect(() => {
        assertSafeDatabaseUrl('postgresql://localhost:5432/production');
      }).toThrow(/Database 'production' is not an authorized test\/dev database name/);

      expect(() => {
        assertSafeDatabaseUrl('postgresql://127.0.0.1:5432/customer_live_data');
      }).toThrow(/not an authorized test\/dev database name/);
    });
  });

  describe('D. Migration File Registry & Ordering', () => {
    it('discovers ordered migration files in packages/database/migrations', () => {
      expect(existsSync(MIGRATIONS_DIR)).toBe(true);

      const files = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      expect(files.length).toBeGreaterThan(0);
      expect(files).toContain('crm1_v1.sql');
      expect(files).toContain('platform_outbox_v1.sql');

      for (const file of files) {
        const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
        expect(content.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe('E. Compose Configuration Verification', () => {
    it('verifies infra/compose.yaml exists with pinned tags and healthchecks', () => {
      expect(existsSync(COMPOSE_FILE)).toBe(true);

      const yamlContent = readFileSync(COMPOSE_FILE, 'utf-8');

      // Pinned images
      expect(yamlContent).toMatch(/image:\s*postgres:18\.6/);
      expect(yamlContent).toMatch(/image:\s*redis:8\.10\.1/);

      // Healthchecks
      expect(yamlContent).toContain('healthcheck:');
      expect(yamlContent).toContain('pg_isready');
      expect(yamlContent).toContain('redis-cli');

      // Named persistent volumes
      expect(yamlContent).toContain('pgdata:');
      expect(yamlContent).toContain('redisdata:');

      // Runtime environment variables
      expect(yamlContent).toContain('${POSTGRES_DB:-clearshift}');
      expect(yamlContent).toContain('${POSTGRES_USER:-postgres}');
    });
  });

  describe('F. Wait-For-Database Timeout Handling', () => {
    it('fails fast with clean error message when database is unreachable within timeout', async () => {
      // Connect to non-existent port with 300ms timeout
      const unreachableUrl = 'postgresql://localhost:59999/clearshift_test';

      await expect(
        waitForDatabase(unreachableUrl, 300, 100, true)
      ).rejects.toThrow(/failed to become healthy within 300ms/);
    });
  });
});
