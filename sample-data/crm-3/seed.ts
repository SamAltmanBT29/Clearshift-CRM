/**
 * ClearShift CRM-3 — Deterministic Synthetic Data Seeder & Dirty Data Pack Generator
 *
 * Requirements & Governance:
 * - 100% Synthetic data only; zero PII or credentials.
 * - Idempotent and deterministic: running with --reset produces identical state.
 * - Generates dirty-data-v1.csv (100 rows) satisfying the conservation equation:
 *     source (100) = loaded (75) + rejected (17) + merged (8) + skipped (0)
 *     unaccounted = 0
 * - Enforces domain invariants:
 *     Status in ('New', 'Open', 'Waiting', 'Solved', 'Closed')
 *     Priority in ('Low', 'Normal', 'High', 'Urgent')
 *     order_ref is text reference, not relational FK
 *     Notes append-only, newest-first
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type {
  CRM3TicketStatus,
  CRM3TicketPriority,
} from '../../packages/contracts/src/crm-3.js';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const CSV_OUTPUT_PATH = path.join(__dirname, 'dirty-data-v1.csv');
export const MANIFEST_OUTPUT_PATH = path.join(__dirname, 'manifest.json');
export const PROFILE_OUTPUT_PATH = path.join(__dirname, 'expected-profile.json');

export interface SeedCrm3Options {
  reset?: boolean;
  databaseUrl?: string;
  silent?: boolean;
}

export interface SeedCrm3Summary {
  ticketsCount: number;
  notesCount: number;
  importBatchesCount: number;
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

export const SYNTHETIC_CONTACTS = {
  SARAH: '90000000-0000-4000-8000-000000000001',
  LARS: '90000000-0000-4000-8000-000000000002',
  ELENA: '90000000-0000-4000-8000-000000000003',
  MARCUS: '90000000-0000-4000-8000-000000000004',
  PRIYA: '90000000-0000-4000-8000-000000000005',
} as const;

export const SYNTHETIC_EMAILS = {
  SARAH: 'sarah.connor@example.test',
  LARS: 'lars.lindqvist@example.test',
  ELENA: 'elena.rostova@example.test',
  MARCUS: 'marcus.vance@example.test',
  PRIYA: 'priya.sharma@example.test',
} as const;

export interface SeedTicket {
  id: string;
  subject: string;
  status: CRM3TicketStatus;
  priority: CRM3TicketPriority;
  contactId: string;
  orderRef?: string | null;
  sourceSystem?: string;
  sourceId?: string;
  createdAt: string;
  notes: Array<{
    id: string;
    authorId: string;
    noteText: string;
    createdAt: string;
  }>;
}

/**
 * 25 Deterministic Core Tickets spanning all statuses, priorities, and note sequences.
 */
export const SYNTHETIC_TICKETS: SeedTicket[] = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    subject: 'Production API latency spike after v2.4 deployment',
    status: 'New',
    priority: 'Urgent',
    contactId: SYNTHETIC_CONTACTS.SARAH,
    orderRef: 'ORD-2026-9001',
    sourceSystem: 'zendesk-core',
    sourceId: 'ZEN-10001',
    createdAt: '2026-10-01T08:30:00.000Z',
    notes: [
      {
        id: '31000000-0000-4000-8000-000000000001',
        authorId: 'synthetic-viewer',
        noteText: 'Customer reported intermittent 504 gateway timeouts on webhook intake.',
        createdAt: '2026-10-01T08:35:00.000Z',
      },
    ],
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    subject: 'Invoice PDF generation missing regional tax breakdown',
    status: 'Open',
    priority: 'High',
    contactId: SYNTHETIC_CONTACTS.LARS,
    orderRef: 'ORD-2026-9002',
    sourceSystem: 'zendesk-core',
    sourceId: 'ZEN-10002',
    createdAt: '2026-10-02T09:15:00.000Z',
    notes: [
      {
        id: '31000000-0000-4000-8000-000000000002',
        authorId: 'synthetic-editor',
        noteText: 'Investigating billing template rendering in ERP integration service.',
        createdAt: '2026-10-02T10:00:00.000Z',
      },
      {
        id: '31000000-0000-4000-8000-000000000003',
        authorId: 'synthetic-editor',
        noteText: 'Reproduced in staging environment with EU tax group rules.',
        createdAt: '2026-10-02T11:30:00.000Z',
      },
    ],
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    subject: 'Awaiting customer confirmation on SSO identity metadata update',
    status: 'Waiting',
    priority: 'Normal',
    contactId: SYNTHETIC_CONTACTS.ELENA,
    orderRef: null,
    sourceSystem: 'zendesk-core',
    sourceId: 'ZEN-10003',
    createdAt: '2026-10-03T11:00:00.000Z',
    notes: [
      {
        id: '31000000-0000-4000-8000-000000000004',
        authorId: 'synthetic-editor',
        noteText: 'Sent updated SAML 2.0 metadata cert to IT administrator; awaiting confirmation.',
        createdAt: '2026-10-03T11:30:00.000Z',
      },
    ],
  },
  {
    id: '30000000-0000-4000-8000-000000000004',
    subject: 'Webhook endpoint re-certification completed successfully',
    status: 'Solved',
    priority: 'Normal',
    contactId: SYNTHETIC_CONTACTS.MARCUS,
    orderRef: 'ORD-2026-9004',
    sourceSystem: 'zendesk-core',
    sourceId: 'ZEN-10004',
    createdAt: '2026-10-04T14:00:00.000Z',
    notes: [
      {
        id: '31000000-0000-4000-8000-000000000005',
        authorId: 'synthetic-admin',
        noteText: 'TLS 1.3 certificate rotated and verified via synthetic health probe.',
        createdAt: '2026-10-04T15:00:00.000Z',
      },
    ],
  },
  {
    id: '30000000-0000-4000-8000-000000000005',
    subject: 'Annual compliance review ticket for archival storage',
    status: 'Closed',
    priority: 'Low',
    contactId: SYNTHETIC_CONTACTS.PRIYA,
    orderRef: null,
    sourceSystem: 'zendesk-core',
    sourceId: 'ZEN-10005',
    createdAt: '2026-09-15T08:00:00.000Z',
    notes: [
      {
        id: '31000000-0000-4000-8000-000000000006',
        authorId: 'synthetic-admin',
        noteText: 'All audits passed; closed per annual governance schedule.',
        createdAt: '2026-09-20T17:00:00.000Z',
      },
    ],
  },
  // Additional 20 deterministic tickets to ensure 25+ rich baseline records
  ...Array.from({ length: 20 }, (_, idx) => {
    const num = idx + 6;
    const statuses: CRM3TicketStatus[] = ['New', 'Open', 'Waiting', 'Solved', 'Closed'];
    const priorities: CRM3TicketPriority[] = ['Low', 'Normal', 'High', 'Urgent'];
    const contactKeys = Object.keys(SYNTHETIC_CONTACTS) as Array<keyof typeof SYNTHETIC_CONTACTS>;
    const contactKey = contactKeys[idx % contactKeys.length]!;

    return {
      id: `30000000-0000-4000-8000-${num.toString(16).padStart(12, '0')}`,
      subject: `Deterministic Support Request #${num}: Service desk synthetic verification`,
      status: statuses[(num - 1) % statuses.length]!,
      priority: priorities[(num - 1) % priorities.length]!,
      contactId: SYNTHETIC_CONTACTS[contactKey],
      orderRef: num % 2 === 0 ? `ORD-2026-${(9000 + num).toString()}` : null,
      sourceSystem: 'zendesk-core',
      sourceId: `ZEN-100${num.toString().padStart(2, '0')}`,
      createdAt: `2026-10-${(idx + 5).toString().padStart(2, '0')}T10:00:00.000Z`,
      notes: [
        {
          id: `31000000-0000-4000-8000-${(num + 100).toString(16).padStart(12, '0')}`,
          authorId: 'synthetic-editor',
          noteText: `Automated assessment note for ticket #${num} verification.`,
          createdAt: `2026-10-${(idx + 5).toString().padStart(2, '0')}T10:15:00.000Z`,
        },
      ],
    };
  }),
];

/**
 * Generates the 100-row Dirty Data Pack CSV
 * Conservation equation:
 * source (100) = loaded (75) + rejected (17) + merged (8) + skipped (0)
 * unaccounted = 0
 */
export function generateDirtyDataPack(): {
  csv: string;
  manifest: Record<string, unknown>;
  expectedProfile: Record<string, unknown>;
} {
  const rows: Array<{
    source_row: number;
    subject: string;
    status: string;
    priority: string;
    customer_email: string;
    order_ref: string;
    source_system: string;
    source_id: string;
    text: string;
    expected_outcome: 'loaded' | 'rejected' | 'merged' | 'skipped';
    defect_category?: string;
  }> = [];

  const validStatuses: CRM3TicketStatus[] = ['New', 'Open', 'Waiting', 'Solved', 'Closed'];
  const validPriorities: CRM3TicketPriority[] = ['Low', 'Normal', 'High', 'Urgent'];
  const validEmails = Object.values(SYNTHETIC_EMAILS);

  // 1. Rows 1..75: Clean valid tickets -> loaded
  for (let i = 1; i <= 75; i++) {
    rows.push({
      source_row: i,
      subject: `Clean Customer Issue #${i}: Enterprise support inquiry`,
      status: validStatuses[(i - 1) % validStatuses.length]!,
      priority: validPriorities[(i - 1) % validPriorities.length]!,
      customer_email: validEmails[(i - 1) % validEmails.length]!,
      order_ref: i % 2 === 0 ? `ORD-BATCH-${i}` : '',
      source_system: 'legacy-zendesk',
      source_id: `ZEN-ROW-${i.toString().padStart(4, '0')}`,
      text: `Historical customer note for row ${i}. Fix confirmed on staging.`,
      expected_outcome: 'loaded',
    });
  }

  // 2. Rows 76..92: 17 Defective Rows -> rejected
  // 3 empty subjects
  rows.push({
    source_row: 76,
    subject: '',
    status: 'Open',
    priority: 'Normal',
    customer_email: SYNTHETIC_EMAILS.SARAH,
    order_ref: 'ORD-76',
    source_system: 'legacy-zendesk',
    source_id: 'ZEN-ROW-0076',
    text: 'Note text present but subject is missing',
    expected_outcome: 'rejected',
    defect_category: 'EMPTY_SUBJECT',
  });
  rows.push({
    source_row: 77,
    subject: '   ',
    status: 'New',
    priority: 'High',
    customer_email: SYNTHETIC_EMAILS.LARS,
    order_ref: '',
    source_system: 'legacy-zendesk',
    source_id: 'ZEN-ROW-0077',
    text: 'Whitespace-only subject',
    expected_outcome: 'rejected',
    defect_category: 'EMPTY_SUBJECT',
  });
  rows.push({
    source_row: 78,
    subject: '',
    status: 'Waiting',
    priority: 'Urgent',
    customer_email: SYNTHETIC_EMAILS.ELENA,
    order_ref: '',
    source_system: 'legacy-zendesk',
    source_id: 'ZEN-ROW-0078',
    text: 'Missing subject field',
    expected_outcome: 'rejected',
    defect_category: 'EMPTY_SUBJECT',
  });

  // 4 invalid statuses
  rows.push({
    source_row: 79,
    subject: 'Invalid status test: Pending',
    status: 'Pending',
    priority: 'Normal',
    customer_email: SYNTHETIC_EMAILS.MARCUS,
    order_ref: 'ORD-79',
    source_system: 'legacy-zendesk',
    source_id: 'ZEN-ROW-0079',
    text: 'Status Pending is forbidden in V1 SDS',
    expected_outcome: 'rejected',
    defect_category: 'INVALID_STATUS',
  });
  rows.push({
    source_row: 80,
    subject: 'Invalid status test: In Progress',
    status: 'In Progress',
    priority: 'High',
    customer_email: SYNTHETIC_EMAILS.PRIYA,
    order_ref: '',
    source_system: 'legacy-zendesk',
    source_id: 'ZEN-ROW-0080',
    text: 'Status In Progress is forbidden in V1 SDS',
    expected_outcome: 'rejected',
    defect_category: 'INVALID_STATUS',
  });
  rows.push({
    source_row: 81,
    subject: 'Invalid status test: Cancelled',
    status: 'Cancelled',
    priority: 'Low',
    customer_email: SYNTHETIC_EMAILS.SARAH,
    order_ref: '',
    source_system: 'legacy-zendesk',
    source_id: 'ZEN-ROW-0081',
    text: 'Status Cancelled is forbidden in V1 SDS',
    expected_outcome: 'rejected',
    defect_category: 'INVALID_STATUS',
  });
  rows.push({
    source_row: 82,
    subject: 'Invalid status test: Archived',
    status: 'Archived',
    priority: 'Normal',
    customer_email: SYNTHETIC_EMAILS.LARS,
    order_ref: '',
    source_system: 'legacy-zendesk',
    source_id: 'ZEN-ROW-0082',
    text: 'Status Archived is forbidden in V1 SDS',
    expected_outcome: 'rejected',
    defect_category: 'INVALID_STATUS',
  });

  // 3 invalid priorities
  rows.push({
    source_row: 83,
    subject: 'Invalid priority test: Critical',
    status: 'Open',
    priority: 'Critical',
    customer_email: SYNTHETIC_EMAILS.ELENA,
    order_ref: '',
    source_system: 'legacy-zendesk',
    source_id: 'ZEN-ROW-0083',
    text: 'Priority Critical is forbidden in V1 SDS (Urgent is required)',
    expected_outcome: 'rejected',
    defect_category: 'INVALID_PRIORITY',
  });
  rows.push({
    source_row: 84,
    subject: 'Invalid priority test: Medium',
    status: 'New',
    priority: 'Medium',
    customer_email: SYNTHETIC_EMAILS.MARCUS,
    order_ref: '',
    source_system: 'legacy-zendesk',
    source_id: 'ZEN-ROW-0084',
    text: 'Priority Medium is forbidden in V1 SDS (Normal is required)',
    expected_outcome: 'rejected',
    defect_category: 'INVALID_PRIORITY',
  });
  rows.push({
    source_row: 85,
    subject: 'Invalid priority test: P0',
    status: 'Open',
    priority: 'P0',
    customer_email: SYNTHETIC_EMAILS.PRIYA,
    order_ref: '',
    source_system: 'legacy-zendesk',
    source_id: 'ZEN-ROW-0085',
    text: 'Priority P0 is forbidden in V1 SDS',
    expected_outcome: 'rejected',
    defect_category: 'INVALID_PRIORITY',
  });

  // 4 invalid emails
  rows.push({
    source_row: 86,
    subject: 'Malformed email test: missing domain',
    status: 'New',
    priority: 'Normal',
    customer_email: 'invalid-email-address',
    order_ref: '',
    source_system: 'legacy-zendesk',
    source_id: 'ZEN-ROW-0086',
    text: 'Email missing @ and domain',
    expected_outcome: 'rejected',
    defect_category: 'INVALID_EMAIL',
  });
  rows.push({
    source_row: 87,
    subject: 'Malformed email test: missing username',
    status: 'Open',
    priority: 'Low',
    customer_email: '@missing-username.com',
    order_ref: '',
    source_system: 'legacy-zendesk',
    source_id: 'ZEN-ROW-0087',
    text: 'Email missing user prefix',
    expected_outcome: 'rejected',
    defect_category: 'INVALID_EMAIL',
  });
  rows.push({
    source_row: 88,
    subject: 'Malformed email test: whitespace in address',
    status: 'Open',
    priority: 'High',
    customer_email: 'sarah connor@example.test',
    order_ref: '',
    source_system: 'legacy-zendesk',
    source_id: 'ZEN-ROW-0088',
    text: 'Email contains illegal spaces',
    expected_outcome: 'rejected',
    defect_category: 'INVALID_EMAIL',
  });
  rows.push({
    source_row: 89,
    subject: 'Empty customer email test',
    status: 'New',
    priority: 'Normal',
    customer_email: '',
    order_ref: '',
    source_system: 'legacy-zendesk',
    source_id: 'ZEN-ROW-0089',
    text: 'Empty email fails contact resolution',
    expected_outcome: 'rejected',
    defect_category: 'INVALID_EMAIL',
  });

  // 3 customer unresolved
  rows.push({
    source_row: 90,
    subject: 'Unresolved customer reference test 1',
    status: 'Open',
    priority: 'Normal',
    customer_email: 'nonexistent.contact.1@unregistered.example.test',
    order_ref: '',
    source_system: 'legacy-zendesk',
    source_id: 'ZEN-ROW-0090',
    text: 'Contact email not registered in CRM-1',
    expected_outcome: 'rejected',
    defect_category: 'CUSTOMER_UNRESOLVED',
  });
  rows.push({
    source_row: 91,
    subject: 'Unresolved customer reference test 2',
    status: 'Waiting',
    priority: 'High',
    customer_email: 'unknown.enterprise.user@alien-corp.example.test',
    order_ref: '',
    source_system: 'legacy-zendesk',
    source_id: 'ZEN-ROW-0091',
    text: 'Contact email not registered in CRM-1',
    expected_outcome: 'rejected',
    defect_category: 'CUSTOMER_UNRESOLVED',
  });
  rows.push({
    source_row: 92,
    subject: 'Unresolved customer reference test 3',
    status: 'New',
    priority: 'Urgent',
    customer_email: 'lost.customer.999@orphan-records.example.test',
    order_ref: '',
    source_system: 'legacy-zendesk',
    source_id: 'ZEN-ROW-0092',
    text: 'Contact email not registered in CRM-1',
    expected_outcome: 'rejected',
    defect_category: 'CUSTOMER_UNRESOLVED',
  });

  // 3. Rows 93..100: 8 Duplicate / Re-run rows -> merged
  for (let i = 93; i <= 100; i++) {
    const targetSourceId = `ZEN-ROW-000${i - 92}`;
    rows.push({
      source_row: i,
      subject: `Merged note append for ${targetSourceId}`,
      status: 'Open',
      priority: 'Normal',
      customer_email: SYNTHETIC_EMAILS.SARAH,
      order_ref: `ORD-MERGE-${i}`,
      source_system: 'legacy-zendesk',
      source_id: targetSourceId,
      text: `Additional note appended via merge reconciliation from batch re-import row ${i}.`,
      expected_outcome: 'merged',
      defect_category: 'DUPLICATE_SOURCE_KEY',
    });
  }

  // Generate CSV text
  const csvHeaders = 'source_row,subject,status,priority,customer_email,order_ref,source_system,source_id,text';
  const csvLines = rows.map((r) =>
    [
      r.source_row,
      `"${r.subject.replace(/"/g, '""')}"`,
      r.status,
      r.priority,
      r.customer_email,
      r.order_ref,
      r.source_system,
      r.source_id,
      `"${r.text.replace(/"/g, '""')}"`,
    ].join(',')
  );
  const csv = [csvHeaders, ...csvLines].join('\n') + '\n';

  const manifest = {
    schemaVersion: 1,
    module: 'crm-3',
    totalRecords: 100,
    cleanRecordsCount: 75,
    defectiveRecordsCount: 25,
    conservationEquation: {
      source: 100,
      loaded: 75,
      rejected: 17,
      merged: 8,
      skipped: 0,
      unaccounted: 0,
      isBalanced: true,
    },
    defectCategories: {
      EMPTY_SUBJECT: { count: 3 },
      INVALID_STATUS: { count: 4 },
      INVALID_PRIORITY: { count: 3 },
      INVALID_EMAIL: { count: 4 },
      CUSTOMER_UNRESOLVED: { count: 3 },
      DUPLICATE_SOURCE_KEY: { count: 8 },
    },
    records: rows.map((r) => ({
      sourceRow: r.source_row,
      entityType: 'ticket',
      sourceId: r.source_id,
      expectedOutcome: r.expected_outcome,
      category: r.defect_category || 'golden_baseline',
    })),
  };

  const expectedProfile = {
    schemaVersion: 1,
    rulesetVersion: 1,
    fixture: {
      file: 'dirty-data-v1.csv',
      rows: 100,
    },
    knownProblems: {
      emptySubjectCount: 3,
      invalidStatusCount: 4,
      invalidPriorityCount: 3,
      invalidEmailCount: 4,
      unresolvedCustomerCount: 3,
      duplicateSourceKeyCount: 8,
      totalProblemCount: 25,
    },
    reconciliation: {
      source: 100,
      loaded: 75,
      rejected: 17,
      merged: 8,
      skipped: 0,
      unaccounted: 0,
    },
  };

  return { csv, manifest, expectedProfile };
}

/**
 * Executes database seeding or local file writes.
 */
export async function seedCrm3(options: SeedCrm3Options = {}): Promise<SeedCrm3Summary> {
  const silent = options.silent ?? false;
  const reset = options.reset ?? false;
  const dbUrl = options.databaseUrl || resolveDatabaseUrl();

  // 1. Generate and write Dirty Data Pack files
  const { csv, manifest, expectedProfile } = generateDirtyDataPack();
  fs.mkdirSync(__dirname, { recursive: true });
  fs.writeFileSync(CSV_OUTPUT_PATH, csv, 'utf8');
  fs.writeFileSync(MANIFEST_OUTPUT_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  fs.writeFileSync(PROFILE_OUTPUT_PATH, JSON.stringify(expectedProfile, null, 2) + '\n', 'utf8');

  let persistedToDb = false;
  let ticketsCount = SYNTHETIC_TICKETS.length;
  let notesCount = SYNTHETIC_TICKETS.reduce((acc, t) => acc + t.notes.length, 0);
  let importBatchesCount = 1;

  if (dbUrl) {
    const pool = new Pool({ connectionString: dbUrl });
    try {
      if (!silent) console.log('🌱 [CRM-3] Seeding PostgreSQL database...');

      if (reset) {
        if (!silent) console.log('🔄 [CRM-3] Resetting existing CRM-3 records...');
        await pool.query('DELETE FROM crm3.crm3_import_receipts');
        await pool.query('DELETE FROM crm3.crm3_import_batches');
        await pool.query('DELETE FROM crm3.crm3_notes');
        await pool.query('DELETE FROM crm3.crm3_tickets');
      }

      // Check migration presence
      const regRes = await pool.query<{ exists: string | null }>(
        "SELECT to_regclass('crm3.crm3_tickets') as exists"
      );
      if (regRes.rows[0]?.exists) {
        // Insert tickets and notes
        for (const ticket of SYNTHETIC_TICKETS) {
          await pool.query(
            `INSERT INTO crm3.crm3_tickets
              (id, subject, status, priority, contact_id, order_ref, source_system, source_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
             ON CONFLICT (id) DO UPDATE SET
               subject = EXCLUDED.subject,
               status = EXCLUDED.status,
               priority = EXCLUDED.priority,
               order_ref = EXCLUDED.order_ref,
               updated_at = NOW()`,
            [
              ticket.id,
              ticket.subject,
              ticket.status,
              ticket.priority,
              ticket.contactId,
              ticket.orderRef ?? null,
              ticket.sourceSystem ?? 'zendesk-core',
              ticket.sourceId ?? `ZEN-${ticket.id.slice(-5)}`,
              ticket.createdAt,
            ]
          );

          for (const note of ticket.notes) {
            await pool.query(
              `INSERT INTO crm3.crm3_notes
                (id, ticket_id, author_id, note_text, created_at)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (id) DO NOTHING`,
              [note.id, ticket.id, note.authorId, note.noteText, note.createdAt]
            );
          }
        }

        // Insert initial baseline import batch
        const batchId = '60000000-0000-4000-8000-000000000001';
        await pool.query(
          `INSERT INTO crm3.crm3_import_batches
            (id, source_system, status, loaded_count, rejected_count, idempotency_key, request_hash)
           VALUES ($1, 'zendesk-core', 'completed', 25, 0, 'seed_batch_crm3_01', 'hash_seed_crm3_01')
           ON CONFLICT (id) DO NOTHING`,
          [batchId]
        );

        persistedToDb = true;
      }
    } catch (err: any) {
      if (!silent) console.warn(`⚠️ [CRM-3] Database connection failed or tables not ready: ${err.message}`);
    } finally {
      await pool.end();
    }
  }

  const summary: SeedCrm3Summary = {
    ticketsCount,
    notesCount,
    importBatchesCount,
    dirtyDataRows: 100,
    persistedToDb,
  };

  if (!silent) {
    console.log('✅ [CRM-3] Deterministic seed & Dirty Data Pack completed successfully!');
    console.log(`   - Synthetic Tickets Seeded : ${summary.ticketsCount}`);
    console.log(`   - Append-Only Notes Seeded : ${summary.notesCount}`);
    console.log(`   - Dirty Data Pack Rows     : ${summary.dirtyDataRows}`);
    console.log(`   - Persisted to PostgreSQL  : ${summary.persistedToDb ? 'YES' : 'IN-MEMORY / FILES'}`);
  }

  return summary;
}

// Allow direct CLI invocation: npx tsx sample-data/crm-3/seed.ts [--reset]
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  const resetFlag = process.argv.includes('--reset');
  seedCrm3({ reset: resetFlag }).catch((err) => {
    console.error('❌ [CRM-3] Seed failed:', err);
    process.exit(1);
  });
}
