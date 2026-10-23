import {
  cleanRows,
  cleanContactRows,
  cleanCompanyRows,
  cleanLeadRows,
  Crm1Cleaner,
  type CleanOptions,
  type CleanResult,
  type AuditEntry,
  type RowReject,
} from '../kit/cleaner.js';

export interface CleaningSummary {
  totalRows: number;
  cleanedRows: number;
  rejectedRows: number;
  auditEntriesCount: number;
  byRule: Record<string, number>;
  byReasonCode: Record<string, number>;
}

export interface CleaningBatchResult extends CleanResult {
  batchId?: string | undefined;
  summary: CleaningSummary;
  timestamp: string;
}

export class Crm1CleaningService {
  private readonly cleaner: Crm1Cleaner;

  constructor(defaultOptions: CleanOptions = {}) {
    this.cleaner = new Crm1Cleaner(defaultOptions);
  }

  public cleanRows(
    rows: readonly Record<string, string>[],
    options?: CleanOptions
  ): CleanResult {
    return this.cleaner.clean(rows, options);
  }

  public cleanContacts(
    rows: readonly Record<string, string>[],
    options?: CleanOptions
  ): CleanResult {
    return this.cleaner.cleanContacts(rows, options);
  }

  public cleanCompanies(
    rows: readonly Record<string, string>[],
    options?: CleanOptions
  ): CleanResult {
    return this.cleaner.cleanCompanies(rows, options);
  }

  public cleanLeads(
    rows: readonly Record<string, string>[],
    options?: CleanOptions
  ): CleanResult {
    return this.cleaner.cleanLeads(rows, options);
  }

  public processBatchCleaning(
    rows: readonly Record<string, string>[],
    batchId?: string,
    options?: CleanOptions
  ): CleaningBatchResult {
    const result = this.cleaner.clean(rows, options);
    const summary = this.computeSummary(rows.length, result.rows.length, result.audit, result.rejects);

    return {
      batchId,
      ...result,
      summary,
      timestamp: new Date().toISOString(),
    };
  }

  public computeSummary(
    total: number,
    cleaned: number,
    audits: readonly AuditEntry[],
    rejects: readonly RowReject[]
  ): CleaningSummary {
    const byRule: Record<string, number> = {};
    for (const a of audits) {
      byRule[a.rule_id] = (byRule[a.rule_id] ?? 0) + 1;
    }

    const byReasonCode: Record<string, number> = {};
    for (const r of rejects) {
      byReasonCode[r.reason_code] = (byReasonCode[r.reason_code] ?? 0) + 1;
    }

    return {
      totalRows: total,
      cleanedRows: cleaned,
      rejectedRows: rejects.length,
      auditEntriesCount: audits.length,
      byRule,
      byReasonCode,
    };
  }
}

export const crm1CleaningService = new Crm1CleaningService();
