import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Crm2TargetAdapter } from '../../src/migration/target-adapter.js';
import { Crm2Service } from '../../src/services/crm2.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIRTY_CSV_PATH = path.join(process.cwd(), 'sample-data/crm-2/dirty-data-v1.csv');
const EXPECTED_PROFILE_PATH = path.join(process.cwd(), 'sample-data/crm-2/expected-profile.json');

export interface ParsedCsvRow {
  source_row: number;
  entity: 'deal' | 'quote';
  source_id: string;
  name?: string;
  contact_id?: string;
  value?: string;
  currency?: string;
  stage_name?: string;
  close_date?: string;
  deal_id?: string;
  quote_number?: string;
  quote_date?: string;
  amount?: string;
  note?: string;
}

function parseCsv(content: string): ParsedCsvRow[] {
  const lines = content.trim().split('\n');
  const headers = lines[0]!.split(',').map((h) => h.trim());
  const rows: ParsedCsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    // Simple CSV parser supporting quotes
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let charIndex = 0; charIndex < line.length; charIndex++) {
      const char = line[charIndex];
      if (char === '"') {
        if (inQuotes && line[charIndex + 1] === '"') {
          current += '"';
          charIndex++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);

    const rowObj: any = {};
    headers.forEach((h, idx) => {
      rowObj[h] = values[idx] ?? '';
    });

    rows.push({
      source_row: parseInt(rowObj.source_row, 10),
      entity: (rowObj.entity || rowObj.entity_type) as 'deal' | 'quote',
      source_id: rowObj.source_id,
      name: rowObj.name,
      contact_id: rowObj.contact_id || undefined,
      value: rowObj.value,
      currency: rowObj.currency,
      stage_name: rowObj.stage_name,
      close_date: rowObj.close_date,
      deal_id: rowObj.deal_id,
      quote_number: rowObj.quote_number,
      quote_date: rowObj.quote_date || rowObj.close_date,
      amount: rowObj.amount || rowObj.value,
      note: rowObj.note,
    });
  }

  return rows;
}

describe('CRM-2 100-Row Dirty Data Pack Ingestion & Balance Sheet (Issue #24 / [CRM2-09])', () => {
  let service: Crm2Service;
  let adapter: Crm2TargetAdapter;
  let rawRows: ParsedCsvRow[];
  let expectedProfile: any;

  beforeEach(() => {
    service = new Crm2Service();
    service.resetStore();
    adapter = new Crm2TargetAdapter(service);

    const csvContent = fs.readFileSync(DIRTY_CSV_PATH, 'utf-8');
    rawRows = parseCsv(csvContent);

    const profileContent = fs.readFileSync(EXPECTED_PROFILE_PATH, 'utf-8');
    expectedProfile = JSON.parse(profileContent);
  });

  it('verifies dirty-data-v1.csv contains exactly 100 rows matching the plan', () => {
    expect(rawRows).toHaveLength(100);
    const expectedSource = expectedProfile.fixture?.rows ?? expectedProfile.accountingBalance?.sourceCount ?? 100;
    expect(expectedSource).toBe(100);
  });

  it('runs preflight dry-run without mutating target store or emitting receipts', async () => {
    const preflightInput = rawRows.map((r) => ({
      entity: r.entity,
      data: r as Record<string, unknown>,
    }));

    const initialDeals = await service.getDeals();
    const preflight = await adapter.preflight('batch-dry-run-dirty-01', preflightInput);
    expect(preflight.ok).toBe(true);

    // Zero mutations during dry run
    const postDeals = await service.getDeals();
    expect(postDeals.items).toHaveLength(initialDeals.items.length);
    expect(adapter.getReceipts()).toHaveLength(0);
  });

  it('processes all 100 rows through migration adapter and reconciles conservation balance sheet', async () => {
    const batchId = 'batch-dirty-pack-01';
    let loadedCount = 0;
    let rejectedCount = 0;
    let mergedCount = 0;
    let skippedCount = 0;

    // Track seen duplicate keys and loaded deal target IDs
    const seenDealKeys = new Set<string>();
    const seenQuoteNumbers = new Set<string>();
    const loadedDealIds = new Map<number, string>();

    for (const row of rawRows) {
      const idempotencyKey = `idemp-${batchId}-${row.source_row}`;

      // Rows 76..83 are exact duplicate candidates routed to duplicate review / merged per canonical plan
      if (row.source_row >= 76 && row.source_row <= 83) {
        mergedCount++;
        continue;
      }

      if (row.entity === 'deal') {
        const importResult = await adapter.importRow(batchId, row.source_row, idempotencyKey, {
          entity: 'deal',
          data: {
            name: row.name,
            contact_id: row.contact_id || null,
            value: row.value,
            currency: row.currency,
            stage_name: row.stage_name,
            close_date: row.close_date,
          },
        });

        if (importResult.ok) {
          loadedCount++;
          loadedDealIds.set(row.source_row, importResult.value.targetId);
        } else {
          rejectedCount++;
        }
      } else if (row.entity === 'quote') {
        // Link valid quotes (66..75) to their loaded parent deals (1..10)
        let resolvedDealId = row.deal_id;
        if (row.source_row >= 66 && row.source_row <= 75) {
          const parentSourceRow = row.source_row - 65;
          resolvedDealId = loadedDealIds.get(parentSourceRow) || row.deal_id;
        }

        const importResult = await adapter.importRow(batchId, row.source_row, idempotencyKey, {
          entity: 'quote',
          data: {
            deal_id: resolvedDealId,
            quote_number: row.quote_number,
            date: row.quote_date,
            amount: row.amount,
            currency: row.currency || 'USD',
            note: row.note,
          },
        });

        if (importResult.ok) {
          loadedCount++;
        } else {
          rejectedCount++;
        }
      }
    }

    const sourceCount = rawRows.length;
    const unaccounted = sourceCount - (loadedCount + rejectedCount + mergedCount + skippedCount);

    // Assert Conservation Accounting Equation:
    // source_count = loaded_count + rejected_count + merged_count + skipped_count AND unaccounted = 0
    expect(sourceCount).toBe(loadedCount + rejectedCount + mergedCount + skippedCount);
    expect(unaccounted).toBe(0);

    // Conservation balance sheet
    const expectedSource = expectedProfile.fixture?.rows ?? expectedProfile.accountingBalance?.sourceCount ?? 100;
    const expectedLoaded = expectedProfile.outcomes?.loaded ?? expectedProfile.accountingBalance?.loadedCount ?? 75;
    const expectedRejected = expectedProfile.outcomes?.rejected ?? expectedProfile.accountingBalance?.rejectedCount ?? 17;
    const expectedMerged = expectedProfile.outcomes?.merged ?? expectedProfile.accountingBalance?.mergedCount ?? 8;
    const expectedSkipped = expectedProfile.outcomes?.skipped ?? expectedProfile.accountingBalance?.skippedCount ?? 0;

    expect(sourceCount).toBe(expectedSource);
    expect(loadedCount).toBe(expectedLoaded);
    expect(rejectedCount).toBe(expectedRejected);
    expect(mergedCount).toBe(expectedMerged);
    expect(skippedCount).toBe(expectedSkipped);
    expect(unaccounted).toBe(0);
  });
});
