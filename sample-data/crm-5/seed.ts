import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MigrationRun, QualityScore, MigrationReject, ReconciliationReport } from '../../packages/contracts/src/crm-5.js';
import { computeQualityScore, verifyReconciliation } from '../../packages/contracts/src/crm-5.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIRTY_CSV_PATH = path.join(__dirname, 'dirty-data-v1.csv');

export interface SeedSummary {
  runsCount: number;
  scoresCount: number;
  rejectsCount: number;
  reconciliationsCount: number;
  persistedToDb: boolean;
}

/**
 * Parses dirty-data-v1.csv into typed synthetic migration run projections.
 */
export function parseDirtyDataPackRuns(): MigrationRun[] {
  if (!fs.existsSync(DIRTY_CSV_PATH)) {
    return [];
  }

  const rawCsv = fs.readFileSync(DIRTY_CSV_PATH, 'utf-8').trim();
  const lines = rawCsv.split('\n');
  if (lines.length <= 1) return [];

  const runs: MigrationRun[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    // Handle CSV quoting for metadata JSON
    const firstQuote = line.indexOf('"{');
    let parts: string[];
    let metadataStr = '{}';

    if (firstQuote !== -1) {
      const beforeQuote = line.slice(0, firstQuote - 1);
      parts = beforeQuote.split(',');
      metadataStr = line.slice(firstQuote + 1, -1).replace(/""/g, '"');
    } else {
      parts = line.split(',');
    }

    const id = parts[0] || `c5000001-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const batchId = parts[1] || `batch-crm-1-${String(i).padStart(4, '0')}`;
    const module = (parts[2] || 'crm-1') as any;
    const step = (parts[3] || 'load') as any;
    const status = (parts[4] || 'completed') as any;
    const recordsIn = parseInt(parts[5] || '0', 10);
    const recordsOut = parseInt(parts[6] || '0', 10);
    const recordsRejected = parseInt(parts[7] || '0', 10);
    const startedAt = parts[8] ? new Date(parts[8]) : new Date();
    const completedAt = parts[9] ? new Date(parts[9]) : null;

    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(metadataStr);
    } catch {
      metadata = { raw: metadataStr };
    }

    runs.push({
      id,
      batchId,
      module,
      step,
      status,
      recordsIn,
      recordsOut,
      recordsRejected,
      startedAt,
      completedAt,
      metadata,
      createdAt: startedAt,
      updatedAt: completedAt ?? startedAt,
    });
  }

  return runs;
}

/**
 * Builds canonical synthetic test fixtures for CRM-5.
 */
export function buildCanonicalFixtures() {
  const baseTime = new Date('2026-10-18T10:00:00Z');
  const earlier = new Date('2026-10-18T09:30:00Z');

  const runs: MigrationRun[] = [
    {
      id: 'a0000000-0000-0000-0000-000000000001',
      batchId: 'batch-contacts-01',
      module: 'crm-1',
      step: 'load',
      status: 'completed',
      recordsIn: 1000,
      recordsOut: 980,
      recordsRejected: 20,
      startedAt: earlier,
      completedAt: baseTime,
      metadata: { source: 'csv', checksum: 'sha256-synthetic-01' },
      createdAt: earlier,
      updatedAt: baseTime,
    },
    {
      id: 'a0000000-0000-0000-0000-000000000002',
      batchId: 'batch-deals-02',
      module: 'crm-2',
      step: 'validate',
      status: 'running',
      recordsIn: 500,
      recordsOut: 450,
      recordsRejected: 50,
      startedAt: baseTime,
      completedAt: null,
      metadata: { source: 'hubspot', checksum: 'sha256-synthetic-02' },
      createdAt: baseTime,
      updatedAt: baseTime,
    },
    {
      id: 'a0000000-0000-0000-0000-000000000003',
      batchId: 'batch-leads-03',
      module: 'crm-1',
      step: 'extract',
      status: 'completed',
      recordsIn: 300,
      recordsOut: 300,
      recordsRejected: 0,
      startedAt: earlier,
      completedAt: baseTime,
      metadata: { source: 'salesforce', checksum: 'sha256-synthetic-03' },
      createdAt: earlier,
      updatedAt: baseTime,
    },
    {
      id: 'a0000000-0000-0000-0000-000000000004',
      batchId: 'batch-companies-04',
      module: 'crm-1',
      step: 'load',
      status: 'failed',
      recordsIn: 200,
      recordsOut: 150,
      recordsRejected: 50,
      startedAt: earlier,
      completedAt: baseTime,
      metadata: { source: 'csv', error: 'High reject threshold exceeded' },
      createdAt: earlier,
      updatedAt: baseTime,
    },
    ...parseDirtyDataPackRuns(),
  ];

  const scores: QualityScore[] = [
    {
      id: 'b0000000-0000-0000-0000-000000000001',
      batchId: 'batch-contacts-01',
      module: 'crm-1',
      completeness: 0.98,
      validity: 0.95,
      duplicateRate: 0.02,
      rejectRate: 0.02,
      linkIntegrity: 1.0,
      score: computeQualityScore({ completeness: 0.98, validity: 0.95, duplicateRate: 0.02, rejectRate: 0.02, linkIntegrity: 1.0 })!,
      isFullyScored: true,
      scoredAt: baseTime,
      createdAt: baseTime,
    },
    {
      id: 'b0000000-0000-0000-0000-000000000002',
      batchId: 'batch-leads-03',
      module: 'crm-1',
      completeness: 0.99,
      validity: 0.98,
      duplicateRate: 0.01,
      rejectRate: 0.0,
      linkIntegrity: 1.0,
      score: computeQualityScore({ completeness: 0.99, validity: 0.98, duplicateRate: 0.01, rejectRate: 0.0, linkIntegrity: 1.0 })!,
      isFullyScored: true,
      scoredAt: baseTime,
      createdAt: baseTime,
    },
    {
      id: 'b0000000-0000-0000-0000-000000000003',
      batchId: 'batch-companies-04',
      module: 'crm-1',
      completeness: 0.85,
      validity: 0.80,
      duplicateRate: 0.05,
      rejectRate: 0.25,
      linkIntegrity: 0.90,
      score: computeQualityScore({ completeness: 0.85, validity: 0.80, duplicateRate: 0.05, rejectRate: 0.25, linkIntegrity: 0.90 })!,
      isFullyScored: true,
      scoredAt: baseTime,
      createdAt: baseTime,
    },
  ];

  const rejects: MigrationReject[] = [
    {
      id: 'c0000000-0000-0000-0000-000000000001',
      batchId: 'batch-contacts-01',
      module: 'crm-1',
      rowIndex: 42,
      errorCode: 'INVALID_EMAIL_FORMAT',
      errorMessage: 'Contact row has malformed email syntax',
      rawPayloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      createdAt: baseTime,
    },
    {
      id: 'c0000000-0000-0000-0000-000000000002',
      batchId: 'batch-contacts-01',
      module: 'crm-1',
      rowIndex: 73,
      errorCode: 'MISSING_REQUIRED_NAME',
      errorMessage: 'Contact missing required last name field',
      rawPayloadHash: 'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e',
      createdAt: baseTime,
    },
    {
      id: 'c0000000-0000-0000-0000-000000000003',
      batchId: 'batch-companies-04',
      module: 'crm-1',
      rowIndex: 12,
      errorCode: 'DUPLICATE_COMPANY_KEY',
      errorMessage: 'Exact tax ID duplicate detected and held for review',
      rawPayloadHash: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
      createdAt: baseTime,
    },
  ];

  const rec1 = verifyReconciliation({ sourceCount: 1000, loadedCount: 980, rejectedCount: 20, mergedCount: 0, skippedCount: 0 });
  const rec3 = verifyReconciliation({ sourceCount: 300, loadedCount: 300, rejectedCount: 0, mergedCount: 0, skippedCount: 0 });
  const rec4 = verifyReconciliation({ sourceCount: 200, loadedCount: 150, rejectedCount: 50, mergedCount: 0, skippedCount: 0 });

  const reconciliations: ReconciliationReport[] = [
    {
      id: 'd0000000-0000-0000-0000-000000000001',
      batchId: 'batch-contacts-01',
      module: 'crm-1',
      sourceCount: 1000,
      loadedCount: 980,
      rejectedCount: 20,
      mergedCount: 0,
      skippedCount: 0,
      unaccountedCount: rec1.unaccountedCount,
      isBalanced: rec1.isBalanced,
      status: rec1.status,
      reconciledAt: baseTime,
      createdAt: baseTime,
    },
    {
      id: 'd0000000-0000-0000-0000-000000000002',
      batchId: 'batch-leads-03',
      module: 'crm-1',
      sourceCount: 300,
      loadedCount: 300,
      rejectedCount: 0,
      mergedCount: 0,
      skippedCount: 0,
      unaccountedCount: rec3.unaccountedCount,
      isBalanced: rec3.isBalanced,
      status: rec3.status,
      reconciledAt: baseTime,
      createdAt: baseTime,
    },
    {
      id: 'd0000000-0000-0000-0000-000000000003',
      batchId: 'batch-companies-04',
      module: 'crm-1',
      sourceCount: 200,
      loadedCount: 150,
      rejectedCount: 50,
      mergedCount: 0,
      skippedCount: 0,
      unaccountedCount: rec4.unaccountedCount,
      isBalanced: rec4.isBalanced,
      status: rec4.status,
      reconciledAt: baseTime,
      createdAt: baseTime,
    },
  ];

  return { runs, scores, rejects, reconciliations };
}

/**
 * Deterministically seeds CRM-5 data.
 */
export async function seedCrm5Data(options: { reset?: boolean } = {}): Promise<SeedSummary> {
  const { reset = false } = options;
  const { runs, scores, rejects, reconciliations } = buildCanonicalFixtures();

  let persistedToDb = false;
  const dbUrl = process.env['DATABASE_URL_TEST'] || process.env['DATABASE_URL'];

  if (dbUrl) {
    try {
      const { drizzle } = await import('drizzle-orm/node-postgres');
      const pg = await import('pg');
      const { crm5Runs, crm5Scores, crm5Rejects, crm5ReconciliationReports } = await import('../../apps/crm/modules/crm-5/db/schema.js');

      const pool = new pg.default.Pool({ connectionString: dbUrl });
      const db = drizzle(pool);

      if (reset) {
        await db.delete(crm5Rejects);
        await db.delete(crm5Scores);
        await db.delete(crm5ReconciliationReports);
        await db.delete(crm5Runs);
      }

      // Upsert runs in batches
      for (const run of runs) {
        await db.insert(crm5Runs).values({
          id: run.id,
          batchId: run.batchId,
          module: run.module,
          step: run.step,
          status: run.status,
          recordsIn: run.recordsIn,
          recordsOut: run.recordsOut,
          recordsRejected: run.recordsRejected,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          metadata: run.metadata,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        }).onConflictDoNothing();
      }

      for (const score of scores) {
        await db.insert(crm5Scores).values({
          id: score.id,
          batchId: score.batchId,
          module: score.module,
          completeness: String(score.completeness),
          validity: String(score.validity),
          duplicateRate: String(score.duplicateRate),
          rejectRate: String(score.rejectRate),
          linkIntegrity: String(score.linkIntegrity),
          score: String(score.score),
          isFullyScored: score.isFullyScored,
          scoredAt: score.scoredAt,
          createdAt: score.createdAt,
        }).onConflictDoNothing();
      }

      for (const reject of rejects) {
        await db.insert(crm5Rejects).values({
          id: reject.id,
          batchId: reject.batchId,
          module: reject.module,
          rowIndex: reject.rowIndex,
          errorCode: reject.errorCode,
          errorMessage: reject.errorMessage,
          rawPayloadHash: reject.rawPayloadHash,
          createdAt: reject.createdAt,
        }).onConflictDoNothing();
      }

      for (const report of reconciliations) {
        await db.insert(crm5ReconciliationReports).values({
          id: report.id,
          batchId: report.batchId,
          module: report.module,
          sourceCount: report.sourceCount,
          loadedCount: report.loadedCount,
          rejectedCount: report.rejectedCount,
          mergedCount: report.mergedCount,
          skippedCount: report.skippedCount,
          unaccountedCount: report.unaccountedCount,
          isBalanced: report.isBalanced,
          status: report.status,
          reconciledAt: report.reconciledAt,
          createdAt: report.createdAt,
        }).onConflictDoNothing();
      }

      await pool.end();
      persistedToDb = true;
    } catch {
      // Continue safely if DB is not reachable in CI/offline run
      persistedToDb = false;
    }
  }

  return {
    runsCount: runs.length,
    scoresCount: scores.length,
    rejectsCount: rejects.length,
    reconciliationsCount: reconciliations.length,
    persistedToDb,
  };
}

// CLI Execution entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isReset = process.argv.includes('--reset');
  console.log(`\n🌱 [CRM-5] Starting deterministic seed${isReset ? ' (with reset)' : ''}...`);

  seedCrm5Data({ reset: isReset })
    .then((summary) => {
      console.log('✅ [CRM-5] Deterministic seed completed successfully!');
      console.log(`   - Migration Runs           : ${summary.runsCount}`);
      console.log(`   - Quality Scorecards       : ${summary.scoresCount}`);
      console.log(`   - Row-Level Rejections     : ${summary.rejectsCount}`);
      console.log(`   - Reconciliation Reports   : ${summary.reconciliationsCount}`);
      console.log(`   - Persisted to PostgreSQL  : ${summary.persistedToDb ? 'YES' : 'IN-MEMORY / FIXTURE MODE'}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ [CRM-5] Seeding failed:', err);
      process.exit(1);
    });
}
