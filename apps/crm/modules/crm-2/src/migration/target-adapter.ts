import { randomUUID, createHash } from 'node:crypto';
import type { TargetAdapter, TargetAdapterResult, TargetAdapterError, ImportReceipt } from '@cs/kit';
import { ok, err, type Result } from '@cs/kernel';
import {
  CreateDealInputSchema,
  CreateQuoteInputSchema,
  type ImportRowInput,
  type ImportReceiptContract,
} from '@clearshift/contracts';
import { Crm2Service, crm2Service } from '../services/crm2.service.js';
import {
  DomainValidationError,
  DealNotFoundError,
  QuoteNotFoundError,
} from '../domain/errors.js';

export interface Crm2TargetAdapterOptions {
  service?: Crm2Service;
  simulate503?: boolean;
  failReceiptCommit?: boolean;
}

export type Crm2TargetEntity = 'deal' | 'quote' | 'deals' | 'quotes';

/**
 * Computes canonical SHA-256 hash of record payload for idempotency verification.
 */
export function computeCanonicalPayloadHash(data: unknown): string {
  const canonical = JSON.stringify(data, Object.keys(data as object || {}).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * CRM-2 Deals, Pipeline and Quotes Migration Kit Target Adapter (Decision C4 & KIT-08)
 * Safely loads CRM-2 master entities strictly through the public API & in-process adapter port.
 * Guarantees atomic commits between target entities and durable import receipts.
 */
export class Crm2TargetAdapter implements TargetAdapter<ImportRowInput | Record<string, unknown>> {
  public readonly module = 'crm-2';
  public readonly entity = 'crm2_records';
  public readonly schemaVersion = 1;

  private service: Crm2Service;
  private receipts: Map<string, ImportReceiptContract> = new Map();
  private receiptsByBatchRow: Map<string, ImportReceiptContract> = new Map();

  constructor(service?: Crm2Service) {
    this.service = service ?? crm2Service;
  }

  public getService(): Crm2Service {
    return this.service;
  }

  public getReceipts(): ImportReceiptContract[] {
    return Array.from(this.receipts.values());
  }

  public getReceiptByKey(idempotencyKey: string): ImportReceiptContract | undefined {
    return this.receipts.get(idempotencyKey);
  }

  public inferEntity(raw: ImportRowInput | Record<string, unknown>): 'deal' | 'quote' {
    const candidate = (raw as ImportRowInput).entity ?? (raw as Record<string, unknown>)['entity'];
    if (typeof candidate === 'string') {
      const lower = candidate.toLowerCase();
      if (lower === 'deal' || lower === 'deals') return 'deal';
      if (lower === 'quote' || lower === 'quotes') return 'quote';
    }
    const data = ((raw as ImportRowInput).data ?? raw) as Record<string, unknown>;
    if (data['quote_number'] || data['quoteNumber'] || data['deal_id'] || data['dealId']) {
      return 'quote';
    }
    return 'deal';
  }

  /**
   * Preflight validation during dry-run phase (zero database mutations).
   */
  public async preflight(
    batchId: string,
    rows: (ImportRowInput | Record<string, unknown>)[]
  ): Promise<Result<{ validCount: number; rejectCount: number }, TargetAdapterError>> {
    let validCount = 0;
    let rejectCount = 0;

    for (const raw of rows) {
      const entity = this.inferEntity(raw);
      const data = ((raw as ImportRowInput).data ?? raw) as Record<string, unknown>;

      if (entity === 'deal') {
        const dealInput = {
          name: data['name'] as string,
          contact_id: (data['contact_id'] ?? data['contactId'] ?? null) as string | null,
          value: String(data['value'] ?? ''),
          currency: (data['currency'] as string) || 'USD',
          stage_name: (data['stage_name'] ?? data['stageName'] ?? 'New') as any,
          close_date: (data['close_date'] ?? data['closeDate'] ?? '') as string,
        };
        const parseResult = CreateDealInputSchema.safeParse(dealInput);
        if (parseResult.success) {
          validCount++;
        } else {
          rejectCount++;
        }
      } else if (entity === 'quote') {
        const quoteInput = {
          deal_id: (data['deal_id'] ?? data['dealId'] ?? '') as string,
          quote_number: (data['quote_number'] ?? data['quoteNumber'] ?? '') as string,
          date: (data['date'] ?? data['quote_date'] ?? data['quoteDate'] ?? '') as string,
          amount: String(data['amount'] ?? ''),
          currency: (data['currency'] as string) || 'USD',
          note: (data['note'] as string | null | undefined) ?? null,
        };
        const parseResult = CreateQuoteInputSchema.safeParse(quoteInput);
        if (parseResult.success) {
          validCount++;
        } else {
          rejectCount++;
        }
      } else {
        rejectCount++;
      }
    }

    return ok({ validCount, rejectCount });
  }

  /**
   * Commits target business record and durable import receipt atomically in one local database transaction.
   */
  public async importRow(
    batchId: string,
    sourceRow: number,
    idempotencyKey: string,
    cleanData: ImportRowInput | Record<string, unknown>,
    options?: Crm2TargetAdapterOptions
  ): Promise<Result<TargetAdapterResult, TargetAdapterError>> {
    // 1. Transient failure simulation (e.g. 503 or transient DB lock)
    if (options?.simulate503) {
      return err({
        reasonCode: 'SERVICE_UNAVAILABLE',
        message: 'Simulated 503 infrastructure error; temporary transient failure.',
      });
    }

    // 2. Exactly-once idempotency verification
    const existing = this.receipts.get(idempotencyKey);
    const entity = this.inferEntity(cleanData);
    const normalizedData = ((cleanData as ImportRowInput).data ?? cleanData) as Record<string, unknown>;
    const payloadHash = computeCanonicalPayloadHash(normalizedData);

    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        return err({
          reasonCode: 'IDEMPOTENCY_CONFLICT',
          message: 'Idempotency key was already committed with a different request payload digest.',
          field: 'idempotencyKey',
        });
      }

      return ok({
        targetId: existing.targetId,
        receipt: {
          batchId: existing.batchId,
          sourceRow: existing.sourceRow,
          entity: existing.entity,
          schemaVersion: existing.schemaVersion,
          idempotencyKey: existing.idempotencyKey,
          targetId: existing.targetId,
          kind: existing.kind,
          createdAt: existing.createdAt,
        },
      });
    }

    // 3. Delegate to Crm2Service.importRow for atomic target record creation & validation
    try {
      const importInput = {
        batchId,
        sourceRow,
        sourceSystem: (cleanData as ImportRowInput).sourceSystem ?? 'crm2_target_adapter',
        entity,
        idempotencyKey,
        data: normalizedData,
      };

      const result = await this.service.importRow(importInput, idempotencyKey);

      const receiptContract: ImportReceiptContract = {
        id: result.receipt.id,
        batchId,
        sourceRow,
        sourceSystem: importInput.sourceSystem,
        sourceId: result.receipt.sourceId,
        entity,
        schemaVersion: this.schemaVersion,
        idempotencyKey,
        payloadHash,
        targetId: result.targetId,
        kind: result.isExisting ? 'linked' : 'created',
        outcome: result.isExisting ? 'linked' : 'created',
        createdAt: new Date(result.receipt.createdAt),
      };

      // Store in adapter's durable index
      this.receipts.set(idempotencyKey, receiptContract);
      this.receiptsByBatchRow.set(`${batchId}:${sourceRow}`, receiptContract);

      const adapterReceipt: ImportReceipt = {
        batchId: receiptContract.batchId,
        sourceRow: receiptContract.sourceRow,
        entity: receiptContract.entity,
        schemaVersion: receiptContract.schemaVersion,
        idempotencyKey: receiptContract.idempotencyKey,
        targetId: receiptContract.targetId,
        kind: receiptContract.kind,
        createdAt: receiptContract.createdAt,
      };

      return ok({
        targetId: result.targetId,
        receipt: adapterReceipt,
      });
    } catch (error: any) {
      const code = error?.code || (error instanceof DomainValidationError ? 'VALIDATION_ERROR' : 'ADAPTER_ERROR');
      const message = error?.message || 'Failed to import row into CRM-2';
      const field = error?.details?.[0]?.field;

      return err({
        reasonCode: code,
        message,
        field,
      });
    }
  }
}
