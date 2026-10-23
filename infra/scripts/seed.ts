/**
 * ClearShift Synthetic Data Seeder [PLT-02]
 *
 * Populates local development and test databases with safe, deterministic synthetic data.
 * Adheres strictly to non-negotiable ClearShift rules:
 * - Refuses to run against non-development / non-test database hosts
 * - Seeds strictly synthetic fixtures (never real customer or employee PII)
 * - Safe, idempotent execution (can be run repeatedly without duplicate errors)
 */

import pg from 'pg';

const { Pool } = pg;

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

const ALLOWED_HOSTS = ['localhost', '127.0.0.1', 'postgres'];
const ALLOWED_DB_NAMES = ['clearshift', 'clearshift_test', 'clearshift_dev'];

/**
 * Asserts that the database target URL is strictly a development or test instance.
 */
export function assertSafeDatabaseUrl(urlStr: string): void {
  const parsed = new URL(urlStr);
  const host = parsed.hostname;
  const dbName = parsed.pathname.replace(/^\//, '');

  if (!ALLOWED_HOSTS.includes(host)) {
    throw new Error(
      `[SECURITY GUARD] Refusing database seed! Host '${host}' is not in the safe development allowlist (${ALLOWED_HOSTS.join(', ')}).`
    );
  }

  const isAllowedDb = ALLOWED_DB_NAMES.includes(dbName) || dbName.endsWith('_test') || dbName.endsWith('_dev');
  if (!isAllowedDb) {
    throw new Error(
      `[SECURITY GUARD] Refusing database seed! Database '${dbName}' is not an authorized test/dev database name.`
    );
  }
}

export interface SeedOptions {
  databaseUrl?: string;
  silent?: boolean;
}

export function resolveSeedDatabaseUrl(): string {
  if (process.env['DATABASE_URL']) {
    return process.env['DATABASE_URL'];
  }
  if (process.env['DATABASE_URL_TEST']) {
    return process.env['DATABASE_URL_TEST'];
  }
  if (process.env['DATABASE_MIGRATOR_URL']) {
    return process.env['DATABASE_MIGRATOR_URL'];
  }
  return 'postgresql://postgres:postgres_dev_secret@localhost:5432/clearshift';
}

export async function seedDatabase(options: SeedOptions = {}): Promise<{ companies: number; contacts: number }> {
  const databaseUrl = options.databaseUrl || resolveSeedDatabaseUrl();

  assertSafeDatabaseUrl(databaseUrl);
  const silent = options.silent ?? false;

  if (!silent) {
    console.log(`🌱 [SEED] Seeding synthetic data into: ${maskDatabaseUrl(databaseUrl)}`);
  }

  await waitForDatabase(databaseUrl, 10000, 1000, silent);

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  let companiesCount = 0;
  let contactsCount = 0;

  try {
    // Check if crm1 schema exists
    const schemaCheck = await client.query(
      "SELECT 1 FROM information_schema.schemata WHERE schema_name = 'crm1'"
    );

    if (schemaCheck.rows.length === 0) {
      if (!silent) {
        console.log("ℹ️ [SEED] Schema 'crm1' does not exist yet. Please run migrations first.");
      }
      return { companies: 0, contacts: 0 };
    }

    // Seed synthetic companies idempotently
    const syntheticCompanies = [
      {
        name: 'Acme Industrial Solutions',
        tax_number: 'SYNTH-TAX-001',
        email: 'info@acme.synthetic',
        phone: '+1-555-0101',
        address: '100 Synthetic Way, Innovation Park',
        source_system: 'ERP-INITIAL-SEED',
        source_id: 'SEED-COMP-001',
      },
      {
        name: 'Globex Logistics Corp',
        tax_number: 'SYNTH-TAX-002',
        email: 'ops@globex.synthetic',
        phone: '+1-555-0102',
        address: '200 Demo Boulevard, Sector 4',
        source_system: 'ERP-INITIAL-SEED',
        source_id: 'SEED-COMP-002',
      },
    ];

    for (const comp of syntheticCompanies) {
      const res = await client.query(
        `INSERT INTO crm1.crm1_companies
           (name, tax_number, email, phone, address, source_system, source_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (source_system, source_id) DO NOTHING
         RETURNING id`,
        [comp.name, comp.tax_number, comp.email, comp.phone, comp.address, comp.source_system, comp.source_id]
      );
      if (res.rows.length > 0) {
        companiesCount++;
      }
    }

    // Retrieve company IDs for contact foreign keys
    const companyRows = await client.query(
      `SELECT id, source_id FROM crm1.crm1_companies WHERE source_system = 'ERP-INITIAL-SEED'`
    );
    const companyMap = new Map(companyRows.rows.map((r: { id: string; source_id: string }) => [r.source_id, r.id]));

    // Seed synthetic contacts idempotently
    const syntheticContacts = [
      {
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane.doe@acme.synthetic',
        phone: '+1-555-0201',
        address: '100 Synthetic Way, Innovation Park',
        company_id: companyMap.get('SEED-COMP-001'),
        lead_status: 'Qualified',
        golden_id: 'GLD-SYNTH-001',
        source_system: 'CRM-INITIAL-SEED',
        source_id: 'SEED-CONT-001',
        consent_status: 'granted',
        consent_updated_at: new Date(),
      },
      {
        first_name: 'John',
        last_name: 'Smith',
        email: 'john.smith@globex.synthetic',
        phone: '+1-555-0202',
        address: '200 Demo Boulevard, Sector 4',
        company_id: companyMap.get('SEED-COMP-002'),
        lead_status: 'New',
        golden_id: 'GLD-SYNTH-002',
        source_system: 'CRM-INITIAL-SEED',
        source_id: 'SEED-CONT-002',
        consent_status: 'granted',
        consent_updated_at: new Date(),
      },
    ];

    for (const cont of syntheticContacts) {
      const res = await client.query(
        `INSERT INTO crm1.crm1_contacts
           (first_name, last_name, email, phone, address, company_id, lead_status, golden_id, source_system, source_id, consent_status, consent_updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (source_system, source_id) DO NOTHING
         RETURNING id`,
        [
          cont.first_name,
          cont.last_name,
          cont.email,
          cont.phone,
          cont.address,
          cont.company_id,
          cont.lead_status,
          cont.golden_id,
          cont.source_system,
          cont.source_id,
          cont.consent_status,
          cont.consent_updated_at,
        ]
      );
      if (res.rows.length > 0) {
        contactsCount++;
      }
    }

    if (!silent) {
      console.log(`✅ [SEED] Seeded ${companiesCount} companies and ${contactsCount} contacts.`);
    }

    return { companies: companiesCount, contacts: contactsCount };
  } finally {
    client.release();
    await pool.end();
  }
}

// Direct CLI Execution
const isDirectCli = process.argv[1] && (process.argv[1].endsWith('seed.ts') || process.argv[1].endsWith('seed.js'));

if (isDirectCli) {
  seedDatabase()
    .then(() => {
      console.log('🎉 Synthetic data seeding completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Synthetic seeding failed:', err.message);
      process.exit(1);
    });
}
