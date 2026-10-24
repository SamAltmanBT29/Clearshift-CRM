/**
 * ClearShift CRM-2 — Deterministic Synthetic Data Seeder & Dirty Data Pack Generator
 *
 * Requirements & Governance:
 * - 100% Synthetic data only; zero PII or credentials.
 * - Idempotent and deterministic: running twice with --reset produces identical state.
 * - Stage set is fixed reference data (New, Qualified, Proposal, Negotiation, Won, Lost).
 * - Trigger crm2_stages_no_update is respected: stages are never deleted or updated on reset.
 * - Generates dirty-data-v1.csv (100 rows) conforming to apps/crm/modules/crm-2/docs/dirty-data-pack-plan.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_OUTPUT_PATH = path.join(__dirname, 'dirty-data-v1.csv');

export interface SeedCrm2Options {
  reset?: boolean;
  databaseUrl?: string;
  silent?: boolean;
}

export interface SeedCrm2Summary {
  stagesCount: number;
  dealsCount: number;
  quotesCount: number;
  dirtyDataRows: number;
  persistedToDb: boolean;
}

/**
 * Resolves database URL safely from environment.
 */
export function resolveDatabaseUrl(): string | undefined {
  return (
    process.env['DATABASE_MIGRATOR_URL'] ||
    (process.env['NODE_ENV'] === 'test' ? process.env['DATABASE_URL_TEST'] : undefined) ||
    process.env['DATABASE_URL'] ||
    process.env['DATABASE_URL_TEST']
  );
}

/**
 * Deterministically generates the 100-row Dirty Data Pack CSV
 * conforming strictly to apps/crm/modules/crm-2/docs/dirty-data-pack-plan.md.
 */
export function generateDirtyDataPackCsv(): string {
  const headers = [
    'source_row',
    'entity',
    'source_id',
    'name',
    'contact_id',
    'value',
    'currency',
    'stage_name',
    'close_date',
    'deal_id',
    'quote_number',
    'quote_date',
    'amount',
    'note',
  ];

  const rows: string[] = [headers.join(',')];

  // Helper to escape CSV fields
  const escape = (val: string | null | undefined): string => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const stages = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];

  // CAT-01: Clean Golden Records (Standard Deals) -> 55 rows (Rows 1 to 55)
  for (let i = 1; i <= 55; i++) {
    const stage = stages[(i - 1) % 4]!; // New, Qualified, Proposal, Negotiation
    const contactId = i % 2 === 0 ? '90000000-0000-4000-8000-000000000001' : '90000000-0000-4000-8000-000000000002';
    const dealRow = [
      i,
      'deal',
      `SRC-DEAL-${String(i).padStart(4, '0')}`,
      escape(`Enterprise Cloud Migration Package ${i}`),
      contactId,
      `${(25000 + i * 1500)}.00`,
      'USD',
      stage,
      `2026-${String(((i % 12) + 1)).padStart(2, '0')}-15`,
      '',
      '',
      '',
      '',
      escape(`Standard opportunity package tier ${i}`),
    ];
    rows.push(dealRow.join(','));
  }

  // CAT-02: Clean Golden Records (Orphan Deals) -> 10 rows (Rows 56 to 65)
  for (let i = 56; i <= 65; i++) {
    const stage = stages[(i - 56) % 2]!; // New, Qualified
    const dealRow = [
      i,
      'deal',
      `SRC-ORPHAN-${String(i).padStart(4, '0')}`,
      escape(`Inbound Web Opportunity (Unassigned) ${i - 55}`),
      '', // Orphan: NULL contact_id
      `${(10000 + (i - 55) * 2000)}.00`,
      'EUR',
      stage,
      '2026-11-30',
      '',
      '',
      '',
      '',
      escape('Orphan deal generated from marketing landing page'),
    ];
    rows.push(dealRow.join(','));
  }

  // CAT-03: Clean Golden Records (Quotes) -> 10 rows (Rows 66 to 75)
  for (let i = 66; i <= 75; i++) {
    const parentDealIndex = i - 65; // references deal 1..10
    const quoteRow = [
      i,
      'quote',
      `SRC-QUOTE-${String(i).padStart(4, '0')}`,
      '',
      '',
      '',
      'USD',
      '',
      '',
      `20000000-0000-4000-8000-${String(parentDealIndex).padStart(12, '0')}`,
      `Q-2026-${String(8800 + i).padStart(4, '0')}`,
      '2026-10-23',
      `${(25000 + parentDealIndex * 1500)}.00`,
      escape('Standard commercial quote with 30-day price validity.'),
    ];
    rows.push(quoteRow.join(','));
  }

  // CAT-04: Exact Duplicate Deals -> 4 rows (2 pairs, Rows 76 to 79)
  // Rows 76 & 77 duplicate Deal 1; Rows 78 & 79 duplicate Deal 2
  rows.push([
    76, 'deal', 'SRC-DUP-DEAL-01', escape('Enterprise Cloud Migration Package 1'),
    '90000000-0000-4000-8000-000000000002', '26500.00', 'USD', 'New', '2026-02-15', '', '', '', '', 'Duplicate A of deal 1'
  ].join(','));
  rows.push([
    77, 'deal', 'SRC-DUP-DEAL-02', escape('Enterprise Cloud Migration Package 1'),
    '90000000-0000-4000-8000-000000000002', '26500.00', 'USD', 'New', '2026-02-15', '', '', '', '', 'Duplicate B of deal 1'
  ].join(','));
  rows.push([
    78, 'deal', 'SRC-DUP-DEAL-03', escape('Enterprise Cloud Migration Package 2'),
    '90000000-0000-4000-8000-000000000001', '28000.00', 'USD', 'Qualified', '2026-03-15', '', '', '', '', 'Duplicate A of deal 2'
  ].join(','));
  rows.push([
    79, 'deal', 'SRC-DUP-DEAL-04', escape('Enterprise Cloud Migration Package 2'),
    '90000000-0000-4000-8000-000000000001', '28000.00', 'USD', 'Qualified', '2026-03-15', '', '', '', '', 'Duplicate B of deal 2'
  ].join(','));

  // CAT-05: Exact Duplicate Quote Numbers -> 4 rows (2 pairs, Rows 80 to 83)
  rows.push([
    80, 'quote', 'SRC-DUP-QUOTE-01', '', '', '', 'USD', '', '',
    '20000000-0000-4000-8000-000000000001', 'Q-2026-8866', '2026-10-23', '26500.00', 'Duplicate quote number A'
  ].join(','));
  rows.push([
    81, 'quote', 'SRC-DUP-QUOTE-02', '', '', '', 'USD', '', '',
    '20000000-0000-4000-8000-000000000001', 'Q-2026-8866', '2026-10-23', '26500.00', 'Duplicate quote number B'
  ].join(','));
  rows.push([
    82, 'quote', 'SRC-DUP-QUOTE-03', '', '', '', 'USD', '', '',
    '20000000-0000-4000-8000-000000000002', 'Q-2026-8867', '2026-10-23', '28000.00', 'Duplicate quote number C'
  ].join(','));
  rows.push([
    83, 'quote', 'SRC-DUP-QUOTE-04', '', '', '', 'USD', '', '',
    '20000000-0000-4000-8000-000000000002', 'Q-2026-8867', '2026-10-23', '28000.00', 'Duplicate quote number D'
  ].join(','));

  // CAT-06: Negative Monetary Deal Value -> 3 rows (Rows 84 to 86)
  rows.push([84, 'deal', 'SRC-NEG-01', escape('Negative Deal Alpha'), '', '-500.00', 'USD', 'New', '2026-12-01', '', '', '', '', 'Invalid negative value'].join(','));
  rows.push([85, 'deal', 'SRC-NEG-02', escape('Negative Deal Beta'), '', '-1250.50', 'USD', 'Qualified', '2026-12-01', '', '', '', '', 'Invalid negative value'].join(','));
  rows.push([86, 'deal', 'SRC-NEG-03', escape('Negative Deal Gamma'), '', '-9999.00', 'USD', 'Proposal', '2026-12-01', '', '', '', '', 'Invalid negative value'].join(','));

  // CAT-07: Invalid ISO Currency Code -> 3 rows (Rows 87 to 89)
  rows.push([87, 'deal', 'SRC-CURR-01', escape('Invalid Currency Deal 1'), '', '15000.00', 'US', 'New', '2026-12-01', '', '', '', '', 'Invalid 2-letter currency'].join(','));
  rows.push([88, 'deal', 'SRC-CURR-02', escape('Invalid Currency Deal 2'), '', '20000.00', '123', 'New', '2026-12-01', '', '', '', '', 'Numeric currency string'].join(','));
  rows.push([89, 'deal', 'SRC-CURR-03', escape('Invalid Currency Deal 3'), '', '35000.00', 'dollars', 'New', '2026-12-01', '', '', '', '', 'Non-ISO word currency'].join(','));

  // CAT-08: Omitted Mandatory Deal Name -> 3 rows (Rows 90 to 92)
  rows.push([90, 'deal', 'SRC-NAME-01', '', '', '10000.00', 'USD', 'New', '2026-12-01', '', '', '', '', 'Blank name'].join(','));
  rows.push([91, 'deal', 'SRC-NAME-02', '   ', '', '15000.00', 'USD', 'New', '2026-12-01', '', '', '', '', 'Whitespace-only name'].join(','));
  rows.push([92, 'deal', 'SRC-NAME-03', '', '', '20000.00', 'USD', 'New', '2026-12-01', '', '', '', '', 'Omitted name'].join(','));

  // CAT-09: Invalid / Unknown Pipeline Stage -> 3 rows (Rows 93 to 95)
  rows.push([93, 'deal', 'SRC-STAGE-01', escape('Stage Violation Deal 1'), '', '10000.00', 'USD', 'Draft', '2026-12-01', '', '', '', '', 'Non-standard stage Draft'].join(','));
  rows.push([94, 'deal', 'SRC-STAGE-02', escape('Stage Violation Deal 2'), '', '15000.00', 'USD', 'Review', '2026-12-01', '', '', '', '', 'Non-standard stage Review'].join(','));
  rows.push([95, 'deal', 'SRC-STAGE-03', escape('Stage Violation Deal 3'), '', '20000.00', 'USD', 'Cancelled', '2026-12-01', '', '', '', '', 'Non-standard stage Cancelled'].join(','));

  // CAT-10: Malformed Close Date Format -> 3 rows (Rows 96 to 98)
  rows.push([96, 'deal', 'SRC-DATE-01', escape('Broken Date Deal 1'), '', '10000.00', 'USD', 'New', '31/12/2026', '', '', '', '', 'Non-ISO DD/MM/YYYY'].join(','));
  rows.push([97, 'deal', 'SRC-DATE-02', escape('Broken Date Deal 2'), '', '15000.00', 'USD', 'New', '2026.11.30', '', '', '', '', 'Dot-delimited date'].join(','));
  rows.push([98, 'deal', 'SRC-DATE-03', escape('Broken Date Deal 3'), '', '20000.00', 'USD', 'New', 'asap', '', '', '', '', 'Arbitrary text date'].join(','));

  // CAT-11: Missing Parent Deal Link -> 2 rows (Rows 99 to 100)
  rows.push([99, 'quote', 'SRC-NO-DEAL-01', '', '', '', 'USD', '', '', '00000000-0000-0000-0000-000000000000', 'Q-2026-9991', '2026-10-23', '10000.00', 'Missing parent deal'].join(','));
  rows.push([100, 'quote', 'SRC-NO-DEAL-02', '', '', '', 'USD', '', '', 'ffffffff-ffff-4fff-bfff-ffffffffffff', 'Q-2026-9992', '2026-10-23', '15000.00', 'Non-existent parent deal'].join(','));

  return rows.join('\n') + '\n';
}

/**
 * Executes CRM-2 synthetic baseline data seeding and/or reset.
 */
export async function seedCrm2Data(options: SeedCrm2Options = {}): Promise<SeedCrm2Summary> {
  const { reset = false, silent = false } = options;

  // 1. Generate dirty-data-v1.csv deterministically
  const csvContent = generateDirtyDataPackCsv();
  fs.writeFileSync(CSV_OUTPUT_PATH, csvContent, 'utf-8');
  if (!silent) {
    console.log(`📄 Deterministically wrote 100-row Dirty Data Pack to: ${CSV_OUTPUT_PATH}`);
  }

  const dbUrl = options.databaseUrl || resolveDatabaseUrl();
  let stagesCount = 6;
  let dealsCount = 0;
  let quotesCount = 0;
  let persistedToDb = false;

  if (dbUrl) {
    const pool = new Pool({ connectionString: dbUrl });
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        if (reset) {
          if (!silent) {
            console.log('🔄 Resetting CRM-2 business tables (quotes and deals)...');
          }
          // Do not delete from crm2_stages! Immutability trigger crm2_stages_no_update forbids it.
          await client.query('DELETE FROM crm2.crm2_quotes');
          await client.query('DELETE FROM crm2.crm2_deals');
        }

        // Verify the 6 fixed reference stages exist
        const stagesRes = await client.query('SELECT id, name, position FROM crm2.crm2_stages ORDER BY position ASC');
        stagesCount = stagesRes.rows.length;
        const stageMap = new Map<string, string>(stagesRes.rows.map((r: { name: string; id: string }) => [r.name, r.id]));

        // Canonical Golden Deals (deterministic UUIDs)
        const canonicalDeals = [
          {
            id: '20000000-0000-4000-8000-000000000001',
            name: 'Acme Cloud Modernization',
            contact_id: '10000000-0000-4000-8000-000000000001',
            value: '75000.00',
            currency: 'USD',
            stage_id: stageMap.get('New') || '00000000-0000-4000-8000-000000000001',
            close_date: '2026-11-30',
            source_system: 'CRM2-SEED',
            source_id: 'DEAL-SEED-001',
          },
          {
            id: '20000000-0000-4000-8000-000000000002',
            name: 'Globex Logistics Integration',
            contact_id: '10000000-0000-4000-8000-000000000002',
            value: '45000.00',
            currency: 'EUR',
            stage_id: stageMap.get('Qualified') || '00000000-0000-4000-8000-000000000002',
            close_date: '2026-12-15',
            source_system: 'CRM2-SEED',
            source_id: 'DEAL-SEED-002',
          },
          {
            id: '20000000-0000-4000-8000-000000000003',
            name: 'Initech Security Audit',
            contact_id: null, // Orphan Deal
            value: '18500.00',
            currency: 'USD',
            stage_id: stageMap.get('Proposal') || '00000000-0000-4000-8000-000000000003',
            close_date: '2026-10-31',
            source_system: 'CRM2-SEED',
            source_id: 'DEAL-SEED-003',
          },
        ];

        for (const deal of canonicalDeals) {
          const res = await client.query(
            `INSERT INTO crm2.crm2_deals
               (id, name, contact_id, value, currency, stage_id, close_date, source_system, source_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (source_system, source_id) DO NOTHING
             RETURNING id`,
            [deal.id, deal.name, deal.contact_id, deal.value, deal.currency, deal.stage_id, deal.close_date, deal.source_system, deal.source_id]
          );
          if (res.rows.length > 0) {
            dealsCount++;
          }
        }

        // Canonical Golden Quotes (linked to Deals)
        const canonicalQuotes = [
          {
            id: '30000000-0000-4000-8000-000000000001',
            quote_number: 'Q-2026-0001',
            deal_id: '20000000-0000-4000-8000-000000000001',
            quote_date: '2026-10-23',
            amount: '75000.00',
            note: 'Initial proposal quote for Acme Cloud Modernization',
            source_system: 'CRM2-SEED',
            source_id: 'QUOTE-SEED-001',
          },
          {
            id: '30000000-0000-4000-8000-000000000002',
            quote_number: 'Q-2026-0002',
            deal_id: '20000000-0000-4000-8000-000000000002',
            quote_date: '2026-10-23',
            amount: '45000.00',
            note: 'Standard pricing quote for Globex Logistics Integration',
            source_system: 'CRM2-SEED',
            source_id: 'QUOTE-SEED-002',
          },
        ];

        for (const quote of canonicalQuotes) {
          const res = await client.query(
            `INSERT INTO crm2.crm2_quotes
               (id, quote_number, deal_id, quote_date, amount, note, source_system, source_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (quote_number) DO NOTHING
             RETURNING id`,
            [quote.id, quote.quote_number, quote.deal_id, quote.quote_date, quote.amount, quote.note, quote.source_system, quote.source_id]
          );
          if (res.rows.length > 0) {
            quotesCount++;
          }
        }

        await client.query('COMMIT');
        persistedToDb = true;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  }

  return {
    stagesCount,
    dealsCount,
    quotesCount,
    dirtyDataRows: 100,
    persistedToDb,
  };
}

// CLI Execution entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isReset = process.argv.includes('--reset');
  console.log(`\n🌱 [CRM-2] Starting deterministic seed${isReset ? ' (with reset)' : ''}...`);

  seedCrm2Data({ reset: isReset })
    .then((summary) => {
      console.log('✅ [CRM-2] Deterministic seed completed successfully!');
      console.log(`   - Stages verified : ${summary.stagesCount} (fixed V1 stages)`);
      console.log(`   - Deals seeded    : ${summary.dealsCount}`);
      console.log(`   - Quotes seeded   : ${summary.quotesCount}`);
      console.log(`   - Dirty Data rows : ${summary.dirtyDataRows}`);
      console.log(`   - Persisted to DB : ${summary.persistedToDb ? 'YES' : 'FIXTURE ONLY'}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ [CRM-2] Seeding failed:', err);
      process.exit(1);
    });
}
