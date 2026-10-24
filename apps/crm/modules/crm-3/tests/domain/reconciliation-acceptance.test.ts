import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  Crm3Service,
  DefaultSyntheticContactResolver,
  CONTACT_BY_EMAIL_ENTITY,
} from '../../src/services/crm3.service.js';
import {
  Crm3TargetAdapter,
  buildCrm3IdempotencyKey,
  type Crm3ImportRow,
} from '../../src/migration/target-adapter.js';
import { evaluateReconciliation } from '@cs/kit';

const CSV_FILE = path.resolve(process.cwd(), 'sample-data/crm-3/dirty-data-v1.csv');
const MANIFEST_FILE = path.resolve(process.cwd(), 'sample-data/crm-3/manifest.json');
const PROFILE_FILE = path.resolve(process.cwd(), 'sample-data/crm-3/expected-profile.json');

class CanonicalPackContactResolver extends DefaultSyntheticContactResolver {
  private extraContacts = new Map<string, { firstName: string; lastName: string; email: string }>([
    ['90000000-0000-4000-8000-000000000003', { firstName: 'Elena', lastName: 'Rostova', email: 'elena.rostova@example.test' }],
    ['90000000-0000-4000-8000-000000000004', { firstName: 'Marcus', lastName: 'Vance', email: 'marcus.vance@example.test' }],
    ['90000000-0000-4000-8000-000000000005', { firstName: 'Priya', lastName: 'Sharma', email: 'priya.sharma@example.test' }],
  ]);

  override async exists(entityType: string, id: string): Promise<boolean> {
    if (this.extraContacts.has(id)) return true;
    return super.exists(entityType, id);
  }

  override async get<T = unknown>(entityType: string, id: string): Promise<T | null> {
    if (entityType === 'contact' && this.extraContacts.has(id)) {
      const c = this.extraContacts.get(id)!;
      return { id, firstName: c.firstName, lastName: c.lastName, email: c.email } as unknown as T;
    }
    if (entityType === CONTACT_BY_EMAIL_ENTITY) {
      const email = id.trim().toLowerCase();
      for (const [contactId, c] of this.extraContacts) {
        if (c.email.toLowerCase() === email) {
          return { id: contactId, email: c.email } as unknown as T;
        }
      }
    }
    return super.get<T>(entityType, id);
  }
}

interface CsvRow {
  sourceRow: number;
  subject: string;
  status: string;
  priority: string;
  customerEmail: string;
  orderRef?: string;
  sourceSystem: string;
  sourceId: string;
  text?: string;
}

function parseCsv(content: string): CsvRow[] {
  const lines = content.trim().split('\n');
  const rows: CsvRow[] = [];
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Simple CSV parser supporting quoted fields with commas
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let charIndex = 0; charIndex < line.length; charIndex++) {
      const char = line[charIndex];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current);

    rows.push({
      sourceRow: parseInt(fields[0], 10),
      subject: fields[1] || '',
      status: fields[2] || '',
      priority: fields[3] || '',
      customerEmail: fields[4] || '',
      orderRef: fields[5] || undefined,
      sourceSystem: fields[6] || 'legacy-zendesk',
      sourceId: fields[7] || '',
      text: fields[8] || undefined,
    });
  }
  return rows;
}

describe('CRM-3 Migration Reconciliation Acceptance & Conservation Balance Sheet ([CRM3-10] / Issue #35)', () => {
  let service: Crm3Service;
  let adapter: Crm3TargetAdapter;

  beforeEach(() => {
    service = new Crm3Service({ contactResolver: new CanonicalPackContactResolver() });
    adapter = new Crm3TargetAdapter(service);
  });

  describe('1. Static Fixture Integrity and Conservation Manifest', () => {
    it('verifies dirty-data-v1.csv, manifest.json, and expected-profile.json exist and are well-formed', () => {
      expect(fs.existsSync(CSV_FILE)).toBe(true);
      expect(fs.existsSync(MANIFEST_FILE)).toBe(true);
      expect(fs.existsSync(PROFILE_FILE)).toBe(true);

      const parsedRows = parseCsv(fs.readFileSync(CSV_FILE, 'utf8'));
      expect(parsedRows.length).toBe(100);

      const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
      expect(manifest.module).toBe('crm-3');
      expect(manifest.totalRecords).toBe(100);
      expect(manifest.cleanRecordsCount).toBe(75);
      expect(manifest.defectiveRecordsCount).toBe(25);

      const profile = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
      expect(profile.fixture.rows).toBe(100);
      expect(profile.knownProblems.totalProblemCount).toBe(25);
    });

    it('enforces mathematical conservation in manifest: source (100) = loaded (75) + rejected (17) + merged (8) + skipped (0)', () => {
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
      const eq = manifest.conservationEquation;

      expect(eq.source).toBe(100);
      expect(eq.loaded).toBe(75);
      expect(eq.rejected).toBe(17);
      expect(eq.merged).toBe(8);
      expect(eq.skipped).toBe(0);
      expect(eq.unaccounted).toBe(0);
      expect(eq.source).toBe(eq.loaded + eq.rejected + eq.merged + eq.skipped + eq.unaccounted);
      expect(eq.isBalanced).toBe(true);
    });

    it('confirms all defect categories match expected profile breakdown', () => {
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
      const profile = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));

      expect(manifest.defectCategories.EMPTY_SUBJECT.count).toBe(profile.knownProblems.emptySubjectCount);
      expect(manifest.defectCategories.INVALID_STATUS.count).toBe(profile.knownProblems.invalidStatusCount);
      expect(manifest.defectCategories.INVALID_PRIORITY.count).toBe(profile.knownProblems.invalidPriorityCount);
      expect(manifest.defectCategories.INVALID_EMAIL.count).toBe(profile.knownProblems.invalidEmailCount);
      expect(manifest.defectCategories.CUSTOMER_UNRESOLVED.count).toBe(profile.knownProblems.unresolvedCustomerCount);
      expect(manifest.defectCategories.DUPLICATE_SOURCE_KEY.count).toBe(profile.knownProblems.duplicateSourceKeyCount);

      const totalProblems =
        manifest.defectCategories.EMPTY_SUBJECT.count +
        manifest.defectCategories.INVALID_STATUS.count +
        manifest.defectCategories.INVALID_PRIORITY.count +
        manifest.defectCategories.INVALID_EMAIL.count +
        manifest.defectCategories.CUSTOMER_UNRESOLVED.count +
        manifest.defectCategories.DUPLICATE_SOURCE_KEY.count;

      expect(totalProblems).toBe(25);
    });
  });

  describe('2. End-to-End Migration Execution & Reconciliation Verification', () => {
    it('executes the 100-row dataset and verifies every row has exactly one terminal outcome', async () => {
      const parsedRows = parseCsv(fs.readFileSync(CSV_FILE, 'utf8'));
      const batchId = '90000000-0000-4000-8000-000000000001';

      type TerminalOutcome = 'loaded' | 'rejected' | 'merged' | 'skipped';
      interface RowResult {
        sourceRow: number;
        outcome: TerminalOutcome;
        reason?: string;
        targetId?: string;
      }

      const results: RowResult[] = [];

      for (const row of parsedRows) {
        const idempotencyKey = buildCrm3IdempotencyKey(batchId, row.sourceRow, 'ticket');

        const importData: Crm3ImportRow = {
          subject: row.subject,
          status: row.status as any,
          priority: row.priority as any,
          customerEmail: row.customerEmail,
          orderRef: row.orderRef,
          sourceSystem: row.sourceSystem,
          sourceId: row.sourceId,
          text: row.text,
        };

        const res = await adapter.importRow(batchId, row.sourceRow, idempotencyKey, importData);

        if (res.ok) {
          results.push({
            sourceRow: row.sourceRow,
            outcome: 'loaded',
            targetId: res.value.targetId,
          });
        } else {
          // If the rejection is DUPLICATE_SOURCE_KEY (rows 93-100), the migration manifest defines
          // deterministic merge into the existing primary ticket.
          if (res.error.reasonCode === 'DUPLICATE_SOURCE_KEY') {
            results.push({
              sourceRow: row.sourceRow,
              outcome: 'merged',
              reason: res.error.reasonCode,
            });
          } else {
            results.push({
              sourceRow: row.sourceRow,
              outcome: 'rejected',
              reason: res.error.reasonCode,
            });
          }
        }
      }

      // Assert exactly 100 rows processed with exactly one outcome each
      expect(results.length).toBe(100);
      const uniqueSourceRows = new Set(results.map((r) => r.sourceRow));
      expect(uniqueSourceRows.size).toBe(100);

      const loadedRows = results.filter((r) => r.outcome === 'loaded');
      const rejectedRows = results.filter((r) => r.outcome === 'rejected');
      const mergedRows = results.filter((r) => r.outcome === 'merged');
      const skippedRows = results.filter((r) => r.outcome === 'skipped');

      expect(loadedRows.length).toBe(75);
      expect(rejectedRows.length).toBe(17);
      expect(mergedRows.length).toBe(8);
      expect(skippedRows.length).toBe(0);

      // Verify conservation equation through @cs/kit helper
      const reconciliationCounts = {
        source: parsedRows.length,
        loaded: loadedRows.length,
        rejected: rejectedRows.length,
        merged: mergedRows.length,
        skipped: skippedRows.length,
        pending: 0,
      };

      const evalResult = evaluateReconciliation(reconciliationCounts);
      expect(evalResult.unaccounted).toBe(0);
      expect(evalResult.result).toBe('OK');

      // Verify specific defect categorizations for rejected rows
      const emptySubjectRejects = rejectedRows.filter((r) => r.reason === 'EMPTY_SUBJECT');
      expect(emptySubjectRejects.length).toBe(3);

      const invalidStatusRejects = rejectedRows.filter((r) => r.reason === 'INVALID_STATUS');
      expect(invalidStatusRejects.length).toBe(4);

      const invalidPriorityRejects = rejectedRows.filter((r) => r.reason === 'INVALID_PRIORITY');
      expect(invalidPriorityRejects.length).toBe(3);

      const invalidEmailRejects = rejectedRows.filter((r) => r.reason === 'INVALID_EMAIL');
      expect(invalidEmailRejects.length).toBe(4);

      const customerUnresolvedRejects = rejectedRows.filter((r) => r.reason === 'CUSTOMER_UNRESOLVED');
      expect(customerUnresolvedRejects.length).toBe(3);

      // Duplicate keys merged
      expect(mergedRows.every((r) => r.reason === 'DUPLICATE_SOURCE_KEY')).toBe(true);
    });

    it('proves target receipts and tickets are idempotent upon replay', async () => {
      const parsedRows = parseCsv(fs.readFileSync(CSV_FILE, 'utf8'));
      const batchId = '90000000-0000-4000-8000-000000000002';

      // Load row 1
      const row1 = parsedRows[0];
      const key1 = buildCrm3IdempotencyKey(batchId, row1.sourceRow, 'ticket');
      const importData: Crm3ImportRow = {
        subject: row1.subject,
        status: row1.status as any,
        priority: row1.priority as any,
        customerEmail: row1.customerEmail,
        orderRef: row1.orderRef,
        sourceSystem: row1.sourceSystem,
        sourceId: row1.sourceId,
        text: row1.text,
      };

      const firstOutcome = await adapter.importRow(batchId, row1.sourceRow, key1, importData);
      expect(firstOutcome.ok).toBe(true);

      const initialTicketsRes = await service.getTickets({ page: 1, pageSize: 50 });
      const initialTicketsCount = initialTicketsRes.total;
      const initialReceiptsCount = service.listImportReceipts(batchId).length;

      // Replay row 1 with identical payload and idempotency key
      const replayOutcome = await adapter.importRow(batchId, row1.sourceRow, key1, importData);
      expect(replayOutcome.ok).toBe(true);
      if (replayOutcome.ok && firstOutcome.ok) {
        expect(replayOutcome.value.targetId).toBe(firstOutcome.value.targetId);
      }

      // No duplicate tickets or receipts created
      const finalTicketsRes = await service.getTickets({ page: 1, pageSize: 50 });
      expect(finalTicketsRes.total).toBe(initialTicketsCount);
      expect(service.listImportReceipts(batchId).length).toBe(initialReceiptsCount);
    });
  });
});
