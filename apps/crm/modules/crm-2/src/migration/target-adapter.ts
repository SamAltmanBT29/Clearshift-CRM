import { randomUUID } from 'node:crypto';
import type { TargetAdapter, TargetAdapterResult, TargetAdapterError, ImportReceipt } from '@cs/kit';
import { ok, err, type Result } from '@cs/kernel';
import {
  computeCanonicalPayloadHash,
  type ImportRowInput,
  type Crm2TargetEntity,
  type ImportReceiptContract,
  CreateDealInputSchema,
  CreateQuoteInputSchema,
  CreateQuoteLineInputSchema,
  CRM2_STAGES,
  type Crm2StageName,
} from '@clearshift/contracts';
import { Crm2Service, crm2Service } from '../services/crm2.service.js';
import {
  DomainValidationError,
  DealNotFoundError,
  QuoteNotFoundError,
} from '../domain/errors.js';

export interface TargetAdapterOptions {
  service?: Crm2Service;
  simulate503?: boolean;
  failReceiptCommit?: boolean;
}

export interface BatchLoadResult {
  loaded: TargetAdapterResult[];
  errors: Array<{ sourceRow: number; error: TargetAdapterError }>;
}

/**
 * CRM-2 Deals, Pipeline and Quotes Migration Kit Target Adapter (KIT-08 & Decision C4)
 * Safely loads CRM-2 entities strictly through in-process domain service invocation.
 * Guarantees atomic transaction commits between target business records and durable import receipts.
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
    const existing = this.receipts.get(idempotencyKey);
    if (existing) return existing;
    const fromService = this.service.getReceiptByKey(idempotencyKey);
    if (fromService) {
      return {
        id: fromService.id,
        batchId: fromService.batchId,
        sourceRow: fromService.sourceRow,
        sourceSystem: fromService.sourceSystem,
        sourceId: fromService.sourceId,
        entity: fromService.entity,
        schemaVersion: 1,
        idempotencyKey: fromService.idempotencyKey,
        payloadHash: fromService.payloadHash,
        targetId: fromService.targetId,
        kind: (fromService.kind as any) ?? 'created',
        outcome: (fromService.outcome as any) ?? 'created',
        createdAt: new Date(fromService.createdAt),
      };
    }
    return undefined;
  }

  public deleteReceipt(idempotencyKey: string): boolean {
    const receipt = this.receipts.get(idempotencyKey);
    if (!receipt) return false;
    this.receipts.delete(idempotencyKey);
    this.receiptsByBatchRow.delete(`${receipt.batchId}:${receipt.sourceRow}`);
    this.service.deleteReceipt(idempotencyKey);
    return true;
  }

  /**
   * Preflight validation during dry-run phase (zero database/service mutations).
   */
  public async preflight(
    batchId: string,
    rows: (ImportRowInput | Record<string, unknown>)[]
  ): Promise<Result<{ validCount: number; rejectCount: number }, TargetAdapterError>> {
    let validCount = 0;
    let rejectCount = 0;
    let index = 1;

    for (const raw of rows) {
      const entity = this.inferEntity(raw);
      const data = (raw as ImportRowInput).data ?? raw;
      const validation = await this.validateEntityData(entity, data as Record<string, unknown>);
      if (validation.ok) {
        validCount++;
      } else {
        rejectCount++;
      }
      index++;
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
    options?: TargetAdapterOptions
  ): Promise<Result<TargetAdapterResult, TargetAdapterError>> {
    // 1. Check for transient infrastructure failure simulation (e.g. 503)
    if (options?.simulate503) {
      return err({
        reasonCode: 'SERVICE_UNAVAILABLE',
        message: 'Simulated 503 infrastructure error; temporary transient failure.',
      });
    }

    // 2. Determine entity & canonical payload hashing
    const entity = this.inferEntity(cleanData);
    const normalizedData = ((cleanData as ImportRowInput).data ?? cleanData) as Record<string, unknown>;
    const currentPayloadHash = computeCanonicalPayloadHash({
      entity,
      batchId,
      sourceRow,
      data: normalizedData,
    });

    // 3. Idempotency Check
    const existingReceipt = this.receipts.get(idempotencyKey);
    if (existingReceipt) {
      // Same key + same canonical request returns the prior result without second mutation
      if (existingReceipt.payloadHash === currentPayloadHash) {
        const adapterReceipt: ImportReceipt = {
          batchId: existingReceipt.batchId,
          sourceRow: existingReceipt.sourceRow,
          entity: existingReceipt.entity,
          schemaVersion: existingReceipt.schemaVersion,
          idempotencyKey: existingReceipt.idempotencyKey,
          targetId: existingReceipt.targetId,
          kind: existingReceipt.kind as 'created' | 'linked',
          createdAt: existingReceipt.createdAt,
        };
        return ok({
          targetId: existingReceipt.targetId,
          receipt: adapterReceipt,
        });
      }

      // Same key + different request returns 409 Conflict
      return err({
        reasonCode: 'IDEMPOTENCY_CONFLICT',
        message: `Idempotency key '${idempotencyKey}' was already used with a different request payload.`,
      });
    }

    // 4. Validate domain business rules
    const validationResult = await this.validateEntityData(entity, normalizedData);
    if (!validationResult.ok) {
      const errObj: TargetAdapterError = {
        reasonCode: validationResult.reasonCode,
        message: validationResult.message,
        ...(validationResult.field ? { field: validationResult.field } : {}),
      };
      return err(errObj);
    }

    // 5. Atomic transaction execution: Target mutation + Durable Import Receipt
    const sourceSystem = (cleanData as ImportRowInput).sourceSystem ?? (normalizedData['sourceSystem'] as string) ?? 'kit_import';
    const sourceId = (cleanData as ImportRowInput).sourceId ?? (normalizedData['sourceId'] as string) ?? (normalizedData['source_id'] as string) ?? randomUUID();
    const schemaVersion = (cleanData as ImportRowInput).schemaVersion ?? 1;

    // Snapshot state for atomic rollback guarantee
    const snapshot = this.service.snapshotState();

    try {
      let targetId: string;
      let outcomeKind: 'created' | 'linked' = 'created';

      switch (entity) {
        case 'deal':
        case 'deals': {
          const dealData = validationResult.data;
          const existing = (sourceId
            ? await this.service.getDealBySource(sourceSystem, sourceId)
            : null) || (dealData['id'] ? await this.service.getDealById(String(dealData['id'])) : null);

          if (existing) {
            const updated = await this.service.updateDeal(existing.id, {
              name: dealData['name'] !== undefined ? String(dealData['name']) : undefined,
              contact_id: dealData['contact_id'] !== undefined ? (dealData['contact_id'] as string | null) : undefined,
              value: dealData['value'] !== undefined ? String(dealData['value']) : undefined,
              currency: dealData['currency'] !== undefined ? String(dealData['currency']) : undefined,
              stage_name: dealData['stage_name'] !== undefined ? (dealData['stage_name'] as any) : undefined,
              close_date: dealData['close_date'] !== undefined ? String(dealData['close_date']) : undefined,
            });
            targetId = updated.id;
            outcomeKind = 'linked';
          } else {
            const created = await this.service.createDeal({
              name: String(dealData['name']),
              contact_id: (dealData['contact_id'] as string | null) ?? null,
              value: String(dealData['value']),
              currency: (dealData['currency'] as string) || 'USD',
              stage_name: (dealData['stage_name'] as any) || 'New',
              close_date: String(dealData['close_date']),
              source_system: sourceSystem,
              source_id: sourceId,
            });
            targetId = created.id;
            outcomeKind = 'created';
          }
          break;
        }

        case 'quote':
        case 'quotes': {
          const quoteData = validationResult.data;
          const quoteNum = String(quoteData['quote_number']);
          const existing = (sourceId
            ? await this.service.getQuoteBySource(sourceSystem, sourceId)
            : null) || (await this.service.getQuoteByNumber(quoteNum));

          if (existing) {
            const updated = await this.service.updateQuote(existing.id, {
              deal_id: quoteData['deal_id'] !== undefined ? String(quoteData['deal_id']) : undefined,
              quote_number: quoteNum,
              date: quoteData['date'] !== undefined ? String(quoteData['date']) : undefined,
              amount: quoteData['amount'] !== undefined ? String(quoteData['amount']) : undefined,
              currency: quoteData['currency'] !== undefined ? String(quoteData['currency']) : undefined,
              note: quoteData['note'] !== undefined ? (quoteData['note'] as string | null) : undefined,
            });
            targetId = updated.id;
            outcomeKind = 'linked';
          } else {
            const created = await this.service.createQuote({
              deal_id: String(quoteData['deal_id']),
              quote_number: quoteNum,
              date: String(quoteData['date']),
              amount: String(quoteData['amount']),
              currency: (quoteData['currency'] as string) || 'USD',
              note: (quoteData['note'] as string | null | undefined) ?? null,
              source_system: sourceSystem,
              source_id: sourceId,
            });
            targetId = created.id;
            outcomeKind = 'created';
          }
          break;
        }

        case 'stage':
        case 'stages': {
          const stageData = validationResult.data;
          const stageName = String(stageData['name'] ?? stageData['stage_name']);
          const stages = await this.service.getStages();
          const matched = stages.find((s) => s.name.toLowerCase() === stageName.toLowerCase());
          if (!matched) {
            return err({
              reasonCode: 'STAGE_NOT_FOUND',
              message: `Stage '${stageName}' not found in fixed 6-stage set`,
              field: 'stage_name',
            });
          }
          targetId = matched.id;
          outcomeKind = 'linked';
          break;
        }

        case 'quote_line':
        case 'quote_lines':
        case 'quoteLines':
        default: {
          const lineData = validationResult.data;
          const quoteId = String(lineData['quote_id']);
          const lineNumber = Number(lineData['line_number']);
          const existingLines = await this.service.getQuoteLines(quoteId);
          const existing = existingLines.find((l) => l.line_number === lineNumber);

          if (existing) {
            targetId = existing.id;
            outcomeKind = 'linked';
          } else {
            const created = await this.service.createQuoteLine({
              quote_id: quoteId,
              line_number: lineNumber,
              product_id: (lineData['product_id'] as string | null) ?? null,
              description: String(lineData['description']),
              quantity: String(lineData['quantity'] ?? '1.0000'),
              unit_price: String(lineData['unit_price']),
              line_total: lineData['line_total'] ? String(lineData['line_total']) : undefined,
            });
            targetId = created.id;
            outcomeKind = 'created';
          }
          break;
        }
      }

      // Check if simulated receipt failure requested to test atomic rollback
      if (options?.failReceiptCommit) {
        this.service.restoreState(snapshot);
        throw new Error('Database transaction aborted: failed to persist import receipt');
      }

      // Commit durable import receipt
      const receiptContract: ImportReceiptContract = {
        id: randomUUID(),
        batchId,
        sourceRow,
        sourceSystem,
        sourceId,
        entity,
        schemaVersion,
        idempotencyKey,
        payloadHash: currentPayloadHash,
        targetId,
        kind: outcomeKind,
        outcome: outcomeKind,
        createdAt: new Date(),
      };

      this.receipts.set(idempotencyKey, receiptContract);
      this.receiptsByBatchRow.set(`${batchId}:${sourceRow}`, receiptContract);

      // Keep service receipts collection in sync
      if (!this.service.getReceiptByKey(idempotencyKey)) {
        (this.service as any).importReceipts.push({
          id: receiptContract.id,
          batchId: receiptContract.batchId,
          sourceRow: receiptContract.sourceRow,
          entity: receiptContract.entity,
          sourceSystem: receiptContract.sourceSystem ?? 'kit_import',
          sourceId: receiptContract.sourceId ?? '',
          targetId: receiptContract.targetId,
          idempotencyKey: receiptContract.idempotencyKey,
          payloadHash: receiptContract.payloadHash,
          kind: receiptContract.kind,
          outcome: receiptContract.outcome,
          createdAt: receiptContract.createdAt.toISOString(),
        });
      }

      const adapterReceipt: ImportReceipt = {
        batchId: receiptContract.batchId,
        sourceRow: receiptContract.sourceRow,
        entity: receiptContract.entity,
        schemaVersion: receiptContract.schemaVersion,
        idempotencyKey: receiptContract.idempotencyKey,
        targetId: receiptContract.targetId,
        kind: receiptContract.kind as 'created' | 'linked',
        createdAt: receiptContract.createdAt,
      };

      return ok({
        targetId,
        receipt: adapterReceipt,
      });
    } catch (error: unknown) {
      this.service.restoreState(snapshot);
      if (error instanceof DomainValidationError) {
        return err({
          reasonCode: error.code,
          message: error.message,
        });
      }
      if (error instanceof DealNotFoundError) {
        return err({
          reasonCode: 'REFERENCE_NOT_FOUND',
          message: error.message,
          field: 'deal_id',
        });
      }
      if (error instanceof QuoteNotFoundError) {
        return err({
          reasonCode: 'REFERENCE_NOT_FOUND',
          message: error.message,
          field: 'quote_id',
        });
      }
      throw error;
    }
  }

  /**
   * Implements the loadBatch interface executing type-safe UPSERT operations.
   * Atomically loads rows and commits durable import receipts.
   */
  public async loadBatch(
    batchId: string,
    rows: (ImportRowInput | Record<string, unknown>)[],
    options?: TargetAdapterOptions
  ): Promise<Result<BatchLoadResult, TargetAdapterError>> {
    const loaded: TargetAdapterResult[] = [];
    const errors: Array<{ sourceRow: number; error: TargetAdapterError }> = [];

    let rowIndex = 1;
    for (const raw of rows) {
      const sourceRow = (raw as ImportRowInput).sourceRow ?? rowIndex;
      const entity = this.inferEntity(raw);
      const idempotencyKey =
        (raw as ImportRowInput).idempotencyKey ??
        ((raw as Record<string, unknown>)['idempotencyKey'] as string) ??
        `${batchId}:${sourceRow}:${entity}`;

      const res = await this.importRow(batchId, sourceRow, idempotencyKey, raw, options);
      if (res.ok) {
        loaded.push(res.value);
      } else {
        errors.push({ sourceRow, error: res.error });
      }
      rowIndex++;
    }

    return ok({ loaded, errors });
  }

  private inferEntity(cleanData: ImportRowInput | Record<string, unknown>): Crm2TargetEntity {
    if ('entity' in cleanData && typeof cleanData.entity === 'string') {
      const e = cleanData.entity.toLowerCase();
      if (
        e === 'deal' ||
        e === 'deals' ||
        e === 'quote' ||
        e === 'quotes' ||
        e === 'stage' ||
        e === 'stages' ||
        e === 'quote_line' ||
        e === 'quote_lines' ||
        e === 'quotelines' ||
        e === 'quotelines'
      ) {
        return (e === 'quotelines' ? 'quote_line' : e) as Crm2TargetEntity;
      }
    }

    const payload = ((cleanData as ImportRowInput).data ?? cleanData) as Record<string, unknown>;
    if ('line_number' in payload || 'lineNumber' in payload || 'unit_price' in payload || 'unitPrice' in payload) {
      return 'quote_line';
    }
    if ('quote_number' in payload || 'quoteNumber' in payload || 'deal_id' in payload || 'dealId' in payload) {
      return 'quote';
    }
    if ('position' in payload || 'is_won' in payload || 'isWon' in payload) {
      return 'stage';
    }

    return 'deal';
  }

  private async validateEntityData(
    entity: Crm2TargetEntity,
    data: Record<string, unknown>
  ): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; reasonCode: string; message: string; field?: string }> {
    const entityLower = entity.toLowerCase();

    switch (entityLower) {
      case 'deal':
      case 'deals': {
        const dealInput = {
          name: data['name'] as string,
          contact_id: (data['contact_id'] ?? data['contactId'] ?? null) as string | null,
          value: String(data['value'] ?? ''),
          currency: (data['currency'] as string) || 'USD',
          stage_name: (data['stage_name'] ?? data['stageName'] ?? 'New') as any,
          close_date: (data['close_date'] ?? data['closeDate'] ?? '') as string,
          source_system: (data['source_system'] ?? data['sourceSystem'] ?? null) as string | null,
          source_id: (data['source_id'] ?? data['sourceId'] ?? null) as string | null,
        };

        const parsed = CreateDealInputSchema.safeParse(dealInput);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          const field = first && first.path.length > 0 ? first.path.join('.') : undefined;
          const isStageError = field === 'stage_name' || (dealInput.stage_name && !CRM2_STAGES.includes(dealInput.stage_name as Crm2StageName));
          return {
            ok: false,
            reasonCode: isStageError ? 'INVALID_STAGE' : 'VALIDATION_ERROR',
            message: isStageError
              ? `Stage '${dealInput.stage_name}' is not one of the approved 6 fixed stages: ${CRM2_STAGES.join(', ')}`
              : (first?.message ?? 'Invalid deal payload'),
            ...(field ? { field } : {}),
          };
        }

        // Contact reference verification (CRM-1 cross-module boundary)
        if (parsed.data.contact_id) {
          const exists = await this.service.getContactResolver().exists('contact', parsed.data.contact_id);
          if (!exists) {
            return {
              ok: false,
              reasonCode: 'REFERENCE_NOT_FOUND',
              message: `Contact with id '${parsed.data.contact_id}' does not exist in CRM-1`,
              field: 'contact_id',
            };
          }
        }

        // Stage verification
        if (parsed.data.stage_name && !CRM2_STAGES.includes(parsed.data.stage_name as Crm2StageName)) {
          return {
            ok: false,
            reasonCode: 'INVALID_STAGE',
            message: `Stage '${parsed.data.stage_name}' is not one of the approved 6 fixed stages: ${CRM2_STAGES.join(', ')}`,
            field: 'stage_name',
          };
        }

        return { ok: true, data: parsed.data as Record<string, unknown> };
      }

      case 'quote':
      case 'quotes': {
        const quoteInput = {
          deal_id: (data['deal_id'] ?? data['dealId'] ?? '') as string,
          quote_number: (data['quote_number'] ?? data['quoteNumber'] ?? '') as string,
          date: (data['date'] ?? data['quote_date'] ?? data['quoteDate'] ?? '') as string,
          amount: String(data['amount'] ?? ''),
          currency: (data['currency'] as string) || 'USD',
          note: (data['note'] as string | null | undefined) ?? null,
          source_system: (data['source_system'] ?? data['sourceSystem'] ?? null) as string | null,
          source_id: (data['source_id'] ?? data['sourceId'] ?? null) as string | null,
        };

        const parsed = CreateQuoteInputSchema.safeParse(quoteInput);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          const field = first && first.path.length > 0 ? first.path.join('.') : undefined;
          return {
            ok: false,
            reasonCode: 'VALIDATION_ERROR',
            message: first?.message ?? 'Invalid quote payload',
            ...(field ? { field } : {}),
          };
        }

        // Parent deal verification
        const deal = await this.service.getDealById(parsed.data.deal_id);
        if (!deal) {
          return {
            ok: false,
            reasonCode: 'REFERENCE_NOT_FOUND',
            message: `Parent deal with id '${parsed.data.deal_id}' does not exist`,
            field: 'deal_id',
          };
        }

        return { ok: true, data: parsed.data as Record<string, unknown> };
      }

      case 'stage':
      case 'stages': {
        const stageName = String(data['name'] ?? data['stage_name'] ?? data['stageName'] ?? '');
        if (!CRM2_STAGES.includes(stageName as Crm2StageName)) {
          return {
            ok: false,
            reasonCode: 'INVALID_STAGE',
            message: `Pipeline stage '${stageName}' is not in approved set: ${CRM2_STAGES.join(', ')}`,
            field: 'stage_name',
          };
        }
        return { ok: true, data: { name: stageName, ...data } };
      }

      case 'quote_line':
      case 'quote_lines':
      case 'quotelines':
      default: {
        const lineInput = {
          quote_id: (data['quote_id'] ?? data['quoteId'] ?? '') as string,
          line_number: Number(data['line_number'] ?? data['lineNumber'] ?? 1),
          product_id: (data['product_id'] ?? data['productId'] ?? null) as string | null,
          description: String(data['description'] ?? ''),
          quantity: String(data['quantity'] ?? '1.0000'),
          unit_price: String(data['unit_price'] ?? data['unitPrice'] ?? '0.00'),
          line_total: data['line_total'] ? String(data['line_total']) : undefined,
        };

        const parsed = CreateQuoteLineInputSchema.safeParse(lineInput);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          const field = first && first.path.length > 0 ? first.path.join('.') : undefined;
          return {
            ok: false,
            reasonCode: 'VALIDATION_ERROR',
            message: first?.message ?? 'Invalid quote line payload',
            ...(field ? { field } : {}),
          };
        }

        // Parent quote verification
        const quote = await this.service.getQuoteById(parsed.data.quote_id);
        if (!quote) {
          return {
            ok: false,
            reasonCode: 'REFERENCE_NOT_FOUND',
            message: `Parent quote with id '${parsed.data.quote_id}' does not exist`,
            field: 'quote_id',
          };
        }

        return { ok: true, data: parsed.data as Record<string, unknown> };
      }
    }
  }
}
