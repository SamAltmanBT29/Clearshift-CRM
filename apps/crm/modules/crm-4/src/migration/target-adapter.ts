import { randomUUID } from 'node:crypto';
import type { TargetAdapter, TargetAdapterResult, TargetAdapterError, ImportReceipt } from '@cs/kit';
import { ok, err, type Result } from '@cs/kernel';
import {
  computeCanonicalPayloadHash,
  type ImportRowInput,
  type ImportReceiptContract,
  CRM4ListCreateSchema,
  CRM4CampaignCreateSchema,
  CRM4MemberCreateSchema,
  CRM4ConsentSetSchema,
  assertMonotonicOptOut,
  assertValidMemberStatus,
} from '@clearshift/contracts';
import { Crm4Service, crm4Service } from '../services/crm4.service.js';
import type { Crm4TargetEntity } from '../kit/mapping.js';

export { computeCanonicalPayloadHash };
export type { Crm4TargetEntity };

export type Crm4AdapterEntityName = 'list' | 'campaign' | 'member' | 'consent' | Crm4TargetEntity;

export interface Crm4TargetAdapterOptions {
  service?: Crm4Service;
  simulate503?: boolean;
  failReceiptCommit?: boolean;
}

export type TargetAdapterOptions = Crm4TargetAdapterOptions;

export interface BatchLoadResult {
  loaded: TargetAdapterResult[];
  errors: Array<{ sourceRow: number; error: TargetAdapterError }>;
}

/**
 * CRM-4 Marketing Lists and Campaign History Migration Kit Target Adapter (KIT-08 & CRM4-11)
 * Safely loads CRM-4 entities strictly through in-process domain service invocation.
 * Guarantees atomic transaction commits between target business records and durable import receipts.
 * Strictly enforces BR-CRM4-01 monotonic opt-out and member status invariants.
 */
export class Crm4TargetAdapter implements TargetAdapter<ImportRowInput | Record<string, unknown>> {
  public readonly module = 'crm-4';
  public readonly entity = 'crm4_records';
  public readonly schemaVersion = 1;

  private service: Crm4Service;
  private receipts: Map<string, ImportReceiptContract> = new Map();
  private receiptsByBatchRow: Map<string, ImportReceiptContract> = new Map();

  constructor(serviceOrOptions?: Crm4Service | Crm4TargetAdapterOptions) {
    if (serviceOrOptions instanceof Crm4Service) {
      this.service = serviceOrOptions;
    } else if (serviceOrOptions && typeof serviceOrOptions === 'object') {
      this.service = serviceOrOptions.service ?? crm4Service;
    } else {
      this.service = crm4Service;
    }
  }

  public getService(): Crm4Service {
    return this.service;
  }

  public getReceipts(): ImportReceiptContract[] {
    return Array.from(this.receipts.values());
  }

  public getReceiptByKey(idempotencyKey: string): ImportReceiptContract | undefined {
    return this.receipts.get(idempotencyKey);
  }

  public deleteReceipt(idempotencyKey: string): boolean {
    const receipt = this.receipts.get(idempotencyKey);
    if (!receipt) return false;
    this.receipts.delete(idempotencyKey);
    this.receiptsByBatchRow.delete(`${receipt.batchId}:${receipt.sourceRow}`);
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

    for (const raw of rows) {
      const entity = this.inferEntity(raw);
      const data = ((raw as ImportRowInput).data ?? raw) as Record<string, unknown>;
      const validation = await this.validateEntityData(entity, data);
      if (validation.ok) {
        validCount++;
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
    options?: Crm4TargetAdapterOptions
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
      return err({
        reasonCode: validationResult.reasonCode,
        message: validationResult.message,
        ...(validationResult.field ? { field: validationResult.field } : {}),
      });
    }

    // 5. Atomic transaction execution: Target mutation + Durable Import Receipt
    const sourceSystem =
      (cleanData as ImportRowInput).sourceSystem ??
      (normalizedData['sourceSystem'] as string) ??
      'kit_import';
    const sourceId =
      (cleanData as ImportRowInput).sourceId ??
      (normalizedData['sourceId'] as string) ??
      (normalizedData['source_id'] as string) ??
      randomUUID();
    const schemaVersion = (cleanData as ImportRowInput).schemaVersion ?? 1;

    // Snapshot state for atomic rollback guarantee
    const snapshot = this.service.snapshotState();

    try {
      let targetId: string;
      let outcomeKind: 'created' | 'linked' = 'created';

      switch (entity) {
        case 'list': {
          const listData = validationResult.data;
          const listName = String(listData['name']).trim();
          const existing =
            (listData['id'] ? await this.service.getListById(String(listData['id'])).catch(() => null) : null) ||
            (await this.service.getListByName(listName));

          if (existing) {
            const updated = await this.service.patchList(existing.id, {
              description: listData['description'] !== undefined ? (listData['description'] ? String(listData['description']).trim() : null) : undefined,
            });
            targetId = updated.id;
            outcomeKind = 'linked';
          } else {
            const created = await this.service.createList({
              id: listData['id'] ? String(listData['id']) : undefined,
              name: listName,
              description: listData['description'] ? String(listData['description']).trim() : null,
            } as any);
            targetId = created.id;
            outcomeKind = 'created';
          }
          break;
        }

        case 'campaign': {
          const campData = validationResult.data;
          const campName = String(campData['name']).trim();
          const listId = String(campData['listId'] ?? campData['list_id']);

          // Ensure parent list exists
          await this.service.getListById(listId);

          const existing =
            (campData['id'] ? await this.service.getCampaignById(String(campData['id'])).catch(() => null) : null) ||
            (await this.service.getCampaignByName(campName, listId));

          if (existing) {
            const updated = await this.service.patchCampaign(existing.id, {
              campaignDate: campData['campaignDate'] ? String(campData['campaignDate']) : undefined,
            });
            targetId = updated.id;
            outcomeKind = 'linked';
          } else {
            const created = await this.service.createCampaign({
              id: campData['id'] ? String(campData['id']) : undefined,
              name: campName,
              campaignDate: String(campData['campaignDate'] ?? campData['campaign_date']),
              listId,
            } as any);
            targetId = created.id;
            outcomeKind = 'created';
          }
          break;
        }

        case 'member': {
          const memData = validationResult.data;
          const campaignId = String(memData['campaignId'] ?? memData['campaign_id']);
          const contactId = String(memData['contactId'] ?? memData['contact_id']);
          const status = String(memData['status'] ?? 'sent');

          assertValidMemberStatus(status);

          // Verify parent campaign exists
          await this.service.getCampaignById(campaignId);

          const existing = await this.service.getMember(campaignId, contactId);
          if (existing) {
            targetId = existing.id;
            outcomeKind = 'linked';
          } else {
            const created = await this.service.addCampaignMember({
              campaignId,
              contactId,
              status,
              unsubscribed: Boolean(memData['unsubscribed']),
            });
            targetId = created.id;
            outcomeKind = 'created';
          }
          break;
        }

        case 'consent': {
          const consentData = validationResult.data;
          const contactId = String(consentData['contactId'] ?? consentData['contact_id']);
          const status = String(consentData['status']) as 'subscribed' | 'unsubscribed';
          const source = String(consentData['source'] ?? 'csv_import').trim();

          const existing = await this.service.getConsent(contactId).catch(() => null);
          if (existing) {
            // Enforce BR-CRM4-01 monotonic opt-out rule
            assertMonotonicOptOut(existing.status, status);
            outcomeKind = 'linked';
          } else {
            outcomeKind = 'created';
          }

          const upserted = await this.service.setConsent({
            contactId,
            status,
            source,
            consentDate: consentData['consentDate'] ? String(consentData['consentDate']) : undefined,
          });
          targetId = upserted.id;
          break;
        }

        default:
          throw new Error(`Unsupported CRM-4 entity type '${entity}'`);
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
    } catch (error: any) {
      // Guaranteed rollback of in-process state snapshot on failure
      this.service.restoreState(snapshot);

      if (options?.failReceiptCommit) {
        throw error;
      }

      const message = error.message || 'Atomic transaction failed while loading target record and receipt.';
      let reasonCode = 'TARGET_ADAPTER_ERROR';

      if (message.includes('BR-CRM4-01') || message.includes('monotonic')) {
        reasonCode = 'OPT_OUT_VIOLATION';
      } else if (message.includes('not found') || error.code === 'NOT_FOUND') {
        reasonCode = 'FOREIGN_KEY_NOT_FOUND';
      } else if (message.includes('CONFLICT') || error.code === 'CONFLICT') {
        reasonCode = 'DUPLICATE_MEMBER';
      } else if (error.code === 'VALIDATION_ERROR' || error.code === 'UNPROCESSABLE_ENTITY') {
        reasonCode = 'VALIDATION_ERROR';
      }

      return err({
        reasonCode,
        message,
      });
    }
  }

  /**
   * Executes type-safe batch loading across a sequence of source rows.
   */
  public async loadBatch(
    batchId: string,
    rows: (ImportRowInput | Record<string, unknown>)[],
    options?: Crm4TargetAdapterOptions
  ): Promise<Result<BatchLoadResult, TargetAdapterError>> {
    const loaded: TargetAdapterResult[] = [];
    const errors: Array<{ sourceRow: number; error: TargetAdapterError }> = [];

    let rowIdx = 1;
    for (const row of rows) {
      const sourceRow = (row as ImportRowInput).sourceRow ?? rowIdx;
      const idempotencyKey =
        (row as ImportRowInput).idempotencyKey ?? `batch-${batchId}-row-${sourceRow}`;

      const res = await this.importRow(batchId, sourceRow, idempotencyKey, row, options);
      if (res.ok) {
        loaded.push(res.value);
      } else {
        errors.push({ sourceRow, error: res.error });
      }
      rowIdx++;
    }

    return ok({ loaded, errors });
  }

  /**
   * Infers CRM-4 target entity from payload structure.
   */
  public inferEntity(raw: ImportRowInput | Record<string, unknown>): Crm4AdapterEntityName {
    const candidate =
      (raw as ImportRowInput).entity ?? (raw as Record<string, unknown>)['entity'];
    if (typeof candidate === 'string') {
      const lower = candidate.toLowerCase();
      if (lower === 'list' || lower === 'lists' || lower === 'crm4_lists' || lower === 'marketing_list') {
        return 'list';
      }
      if (lower === 'campaign' || lower === 'campaigns' || lower === 'crm4_campaigns') {
        return 'campaign';
      }
      if (lower === 'member' || lower === 'members' || lower === 'crm4_members' || lower === 'campaign_member') {
        return 'member';
      }
      if (lower === 'consent' || lower === 'consents' || lower === 'crm4_consents' || lower === 'contact_consent') {
        return 'consent';
      }
    }

    const data = ((raw as ImportRowInput).data ?? raw) as Record<string, unknown>;
    if ('campaignId' in data || 'campaign_id' in data) {
      return 'member';
    }
    if ('campaignDate' in data || 'campaign_date' in data) {
      return 'campaign';
    }
    if ('consentDate' in data || 'consent_date' in data || ('contactId' in data && 'status' in data && !('campaignId' in data))) {
      return 'consent';
    }
    return 'list';
  }

  /**
   * Validates row data against canonical entity schemas and business rules.
   */
  private async validateEntityData(
    entity: Crm4AdapterEntityName,
    data: Record<string, unknown>
  ): Promise<
    | { ok: true; data: Record<string, unknown> }
    | { ok: false; reasonCode: string; message: string; field?: string }
  > {
    switch (entity) {
      case 'list': {
        const name = typeof data['name'] === 'string' ? data['name'].trim() : '';
        if (!name || name.length === 0) {
          return {
            ok: false,
            reasonCode: 'EMPTY_LIST_NAME',
            message: 'Marketing list name cannot be empty or blank',
            field: 'name',
          };
        }
        return { ok: true, data: { ...data, name } };
      }

      case 'campaign': {
        const name = typeof data['name'] === 'string' ? data['name'].trim() : '';
        if (!name || name.length === 0) {
          return {
            ok: false,
            reasonCode: 'EMPTY_CAMPAIGN_NAME',
            message: 'Campaign name cannot be empty or blank',
            field: 'name',
          };
        }
        const listId = (data['listId'] ?? data['list_id']) as string | undefined;
        if (!listId || typeof listId !== 'string') {
          return {
            ok: false,
            reasonCode: 'MISSING_LIST_ID',
            message: 'Campaign must reference a valid parent marketing list ID',
            field: 'listId',
          };
        }
        const dateVal = (data['campaignDate'] ?? data['campaign_date']) as string | undefined;
        if (!dateVal || !/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
          return {
            ok: false,
            reasonCode: 'INVALID_CAMPAIGN_DATE',
            message: 'Campaign date must follow YYYY-MM-DD format',
            field: 'campaignDate',
          };
        }
        return { ok: true, data: { ...data, name, listId, campaignDate: dateVal } };
      }

      case 'member': {
        const campaignId = (data['campaignId'] ?? data['campaign_id']) as string | undefined;
        if (!campaignId) {
          return {
            ok: false,
            reasonCode: 'MISSING_CAMPAIGN_ID',
            message: 'Campaign member must reference a valid campaignId',
            field: 'campaignId',
          };
        }
        const contactId = (data['contactId'] ?? data['contact_id']) as string | undefined;
        if (!contactId) {
          return {
            ok: false,
            reasonCode: 'MISSING_CONTACT_ID',
            message: 'Campaign member must reference a valid contactId',
            field: 'contactId',
          };
        }
        const status = (data['status'] as string | undefined) ?? 'sent';
        try {
          assertValidMemberStatus(status);
        } catch (e: any) {
          return {
            ok: false,
            reasonCode: 'INVALID_MEMBER_STATUS',
            message: e.message || `Member status '${status}' is not permitted (must be sent, opened, clicked)`,
            field: 'status',
          };
        }
        return { ok: true, data: { ...data, campaignId, contactId, status } };
      }

      case 'consent': {
        const contactId = (data['contactId'] ?? data['contact_id']) as string | undefined;
        if (!contactId) {
          return {
            ok: false,
            reasonCode: 'MISSING_CONTACT_ID',
            message: 'Consent record must reference a valid contactId',
            field: 'contactId',
          };
        }
        const status = data['status'] as string | undefined;
        if (status !== 'subscribed' && status !== 'unsubscribed') {
          return {
            ok: false,
            reasonCode: 'INVALID_CONSENT_STATUS',
            message: `Consent status '${status}' is not permitted (must be subscribed or unsubscribed)`,
            field: 'status',
          };
        }
        const source = (data['source'] as string | undefined)?.trim();
        if (!source || source.length === 0) {
          return {
            ok: false,
            reasonCode: 'EMPTY_CONSENT_SOURCE',
            message: 'Consent source cannot be empty or blank',
            field: 'source',
          };
        }
        // Enforce BR-CRM4-01 check during preflight if contact already has known consent
        const existingConsent = await this.service.getConsent(contactId).catch(() => null);
        if (existingConsent && existingConsent.status === 'unsubscribed' && status === 'subscribed') {
          return {
            ok: false,
            reasonCode: 'OPT_OUT_VIOLATION',
            message: 'Domain Invariant Violation (BR-CRM4-01): Known opt-out cannot be changed to subscribed.',
            field: 'status',
          };
        }

        return { ok: true, data: { ...data, contactId, status, source } };
      }

      default:
        return {
          ok: false,
          reasonCode: 'UNSUPPORTED_ENTITY',
          message: `Entity '${entity}' is not supported by CRM-4 target adapter`,
        };
    }
  }
}

export const crm4TargetAdapter = new Crm4TargetAdapter();
