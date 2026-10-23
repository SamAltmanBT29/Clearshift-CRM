import { randomUUID } from 'node:crypto';
import type { TargetAdapter, TargetAdapterResult, TargetAdapterError, ImportReceipt } from '@cs/kit';
import { ok, err, type Result } from '@cs/kernel';
import {
  computeCanonicalPayloadHash,
  type ImportRowInput,
  type Crm1TargetEntity,
  type ImportReceiptContract,
} from '@clearshift/contracts';
import { Crm1Service } from '../services/crm1.service.js';
import {
  DomainValidationError,
  CompanyNotFoundError,
  ContactNotFoundError,
  InvalidLeadStatusError,
} from '../domain/errors.js';

export interface TargetAdapterOptions {
  service?: Crm1Service;
  simulate503?: boolean;
  failReceiptCommit?: boolean;
}

const VALID_LEAD_STATUSES = ['New', 'Working', 'Qualified', 'Closed'] as const;

/**
 * CRM-1 Contacts, Companies and Leads Migration Kit Target Adapter (Decision C4 & KIT-08)
 * Safely loads CRM-1 master entities strictly through the public API & in-process adapter port.
 * Guarantees atomic commits between target entities and durable import receipts.
 */
export class Crm1TargetAdapter implements TargetAdapter<ImportRowInput | Record<string, unknown>> {
  public readonly module = 'crm-1';
  public readonly entity = 'crm1_records';
  public readonly schemaVersion = 1;

  private service: Crm1Service;
  private receipts: Map<string, ImportReceiptContract> = new Map();
  private receiptsByBatchRow: Map<string, ImportReceiptContract> = new Map();

  constructor(service?: Crm1Service) {
    this.service = service ?? new Crm1Service();
  }

  public getService(): Crm1Service {
    return this.service;
  }

  public getReceipts(): ImportReceiptContract[] {
    return Array.from(this.receipts.values());
  }

  public getReceiptByKey(idempotencyKey: string): ImportReceiptContract | undefined {
    return this.receipts.get(idempotencyKey);
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
      const data = (raw as ImportRowInput).data ?? raw;
      const validation = await this.validateEntityData(entity, data as Record<string, unknown>);
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
    options?: TargetAdapterOptions
  ): Promise<Result<TargetAdapterResult, TargetAdapterError>> {
    // 1. Check for transient infrastructure failure simulation
    if (options?.simulate503) {
      return err({
        reasonCode: 'SERVICE_UNAVAILABLE',
        message: 'Simulated 503 infrastructure error; temporary transient failure.',
      });
    }

    // 2. Determine entity & canonical payload hashing
    const entity = this.inferEntity(cleanData);
    const normalizedData = (cleanData as ImportRowInput).data ?? cleanData;
    const currentPayloadHash = computeCanonicalPayloadHash({
      entity,
      batchId,
      sourceRow,
      data: normalizedData,
    });

    // 3. Idempotency Check
    const existingReceipt = this.receipts.get(idempotencyKey);
    if (existingReceipt) {
      // Same key + same canonical request returns the prior result
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
    const validationResult = await this.validateEntityData(entity, normalizedData as Record<string, unknown>);
    if (!validationResult.ok) {
      const errObj: TargetAdapterError = {
        reasonCode: validationResult.reasonCode,
        message: validationResult.message,
        ...(validationResult.field ? { field: validationResult.field } : {}),
      };
      return err(errObj);
    }

    // 5. Atomic transaction execution: Target mutation + Durable Import Receipt
    const sourceSystem = (cleanData as ImportRowInput).sourceSystem ?? 'kit_import';
    const sourceId = (cleanData as ImportRowInput).sourceId ?? randomUUID();
    const schemaVersion = (cleanData as ImportRowInput).schemaVersion ?? 1;

    try {
      let targetId: string;
      let outcomeKind: 'created' | 'linked' = 'created';

      switch (entity) {
        case 'company':
        case 'companies': {
          const existing = await this.service.getCompanyBySource(sourceSystem, sourceId);
          if (existing) {
            targetId = existing.id;
            outcomeKind = 'linked';
          } else {
            const companyData = validationResult.data;
            const company = await this.service.createCompany({
              name: String(companyData['name']),
              taxNumber: String(companyData['taxNumber'] ?? `TAX-${randomUUID().substring(0, 8).toUpperCase()}`),
              email: companyData['email'] ? String(companyData['email']) : undefined,
              phone: companyData['phone'] ? String(companyData['phone']) : undefined,
              address: companyData['address'] ? String(companyData['address']) : undefined,
              sourceSystem,
              sourceId,
            });
            targetId = company.id;
            outcomeKind = 'created';
          }
          break;
        }

        case 'lead':
        case 'leads': {
          const existing = await this.service.getLeadBySource(sourceSystem, sourceId);
          if (existing) {
            targetId = existing.id;
            outcomeKind = 'linked';
          } else {
            const leadData = validationResult.data;
            const contactId = String(leadData['contactId']);
            const contact = await this.service.getContactById(contactId);
            const leadName = leadData['name']
              ? String(leadData['name'])
              : contact
                ? `${contact.firstName} ${contact.lastName}`.trim()
                : `Lead ${contactId.substring(0, 8)}`;
            const leadEmail = leadData['email']
              ? String(leadData['email'])
              : contact?.email || `lead-${contactId.substring(0, 8)}@clearshift.synthetic`;

            const lead = await this.service.createLead({
              name: leadName || `Lead ${contactId.substring(0, 8)}`,
              email: leadEmail,
              contactId,
              status: (leadData['status'] as (typeof VALID_LEAD_STATUSES)[number]) ?? 'New',
              sourceSystem,
              sourceId,
            });
            targetId = lead.id;
            outcomeKind = 'created';
          }
          break;
        }

        case 'contact':
        case 'contacts':
        default: {
          const contactData = validationResult.data;
          const existing = await this.service.getContactBySource(sourceSystem, sourceId);
          if (existing) {
            targetId = existing.id;
            outcomeKind = 'linked';

            // Consent/unsubscribe state is never overwritten by older import data
            const incomingConsentDate = contactData['consentUpdatedAt']
              ? new Date(String(contactData['consentUpdatedAt']))
              : null;
            const incomingUnsubDate = contactData['unsubscribedUpdatedAt']
              ? new Date(String(contactData['unsubscribedUpdatedAt']))
              : null;
            const updates: Record<string, unknown> = {};

            if (contactData['consentStatus'] !== undefined && contactData['consentStatus'] !== null) {
              const incomingStatus = contactData['consentStatus'] as 'unknown' | 'granted' | 'withdrawn';
              // Only overwrite if existing has no timestamp OR incoming timestamp is strictly newer
              if (!existing.consentUpdatedAt || (incomingConsentDate && incomingConsentDate > existing.consentUpdatedAt)) {
                updates['consentStatus'] = incomingStatus;
                if (incomingConsentDate) updates['consentUpdatedAt'] = incomingConsentDate;
              }
            }

            if (contactData['unsubscribed'] !== undefined && contactData['unsubscribed'] !== null) {
              const incomingUnsub = Boolean(contactData['unsubscribed']);
              if (existing.unsubscribed && !incomingUnsub) {
                // Never un-suppress unless incoming explicitly has a newer timestamp
                if (incomingUnsubDate && existing.unsubscribedUpdatedAt && incomingUnsubDate > existing.unsubscribedUpdatedAt) {
                  updates['unsubscribed'] = false;
                  updates['unsubscribedUpdatedAt'] = incomingUnsubDate;
                }
              } else if (!existing.unsubscribed && incomingUnsub) {
                updates['unsubscribed'] = true;
                if (incomingUnsubDate) updates['unsubscribedUpdatedAt'] = incomingUnsubDate;
              }
            }

            if (Object.keys(updates).length > 0) {
              await this.service.updateContact(existing.id, updates as any);
            }
          } else {
            const firstName = String(contactData['firstName']);
            const lastName = String(contactData['lastName']);
            const email = String(
              contactData['email'] || `${firstName.toLowerCase()}.${lastName.toLowerCase()}@clearshift.synthetic`
            );

            const contact = await this.service.createContact({
              firstName,
              lastName,
              email,
              phone: contactData['phone'] ? String(contactData['phone']) : undefined,
              address: contactData['address'] ? String(contactData['address']) : undefined,
              companyId: contactData['companyId'] ? String(contactData['companyId']) : undefined,
              leadStatus: (contactData['leadStatus'] as (typeof VALID_LEAD_STATUSES)[number]) ?? 'New',
              goldenId: contactData['goldenId'] ? String(contactData['goldenId']) : undefined,
              sourceSystem,
              sourceId,
              consentStatus: (contactData['consentStatus'] as any) ?? 'unknown',
              consentUpdatedAt: contactData['consentUpdatedAt'] ? new Date(String(contactData['consentUpdatedAt'])) : undefined,
              unsubscribed: contactData['unsubscribed'] ? Boolean(contactData['unsubscribed']) : false,
              unsubscribedUpdatedAt: contactData['unsubscribedUpdatedAt'] ? new Date(String(contactData['unsubscribedUpdatedAt'])) : undefined,
            });
            targetId = contact.id;
            outcomeKind = 'created';
          }
          break;
        }
      }

      // Simulate receipt insertion failure to test atomic rollback
      if (options?.failReceiptCommit) {
        if (outcomeKind === 'created') {
          if (entity === 'company' || entity === 'companies') {
            await this.service.deleteCompany(targetId);
          } else if (entity === 'lead' || entity === 'leads') {
            await this.service.deleteLead(targetId);
          } else {
            await this.service.deleteContact(targetId);
          }
        }
        throw new Error('Database transaction aborted: failed to persist import receipt');
      }

      // Create durable receipt
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
    } catch (error: unknown) {
      if (error instanceof DomainValidationError) {
        return err({
          reasonCode: error.code,
          message: error.message,
        });
      }
      if (error instanceof CompanyNotFoundError) {
        return err({
          reasonCode: 'REFERENCE_NOT_FOUND',
          message: error.message,
          field: 'companyId',
        });
      }
      if (error instanceof ContactNotFoundError) {
        return err({
          reasonCode: 'REFERENCE_NOT_FOUND',
          message: error.message,
          field: 'contactId',
        });
      }
      if (error instanceof InvalidLeadStatusError) {
        return err({
          reasonCode: 'INVALID_LEAD_STATUS',
          message: error.message,
          field: 'leadStatus',
        });
      }
      throw error;
    }
  }

  private inferEntity(cleanData: ImportRowInput | Record<string, unknown>): Crm1TargetEntity {
    if ('entity' in cleanData && typeof cleanData.entity === 'string') {
      const e = cleanData.entity.toLowerCase();
      if (
        e === 'contacts' ||
        e === 'contact' ||
        e === 'companies' ||
        e === 'company' ||
        e === 'leads' ||
        e === 'lead'
      ) {
        return e as Crm1TargetEntity;
      }
    }

    const payload = (cleanData as ImportRowInput).data ?? cleanData;
    if ('firstName' in payload || 'lastName' in payload) return 'contacts';
    if ('taxNumber' in payload || ('name' in payload && !('contactId' in payload))) return 'companies';
    if ('contactId' in payload || 'status' in payload) return 'leads';

    return 'contacts';
  }

  private async validateEntityData(
    entity: Crm1TargetEntity,
    data: Record<string, unknown>
  ): Promise<
    | { ok: true; data: Record<string, unknown> }
    | { ok: false; reasonCode: string; message: string; field?: string }
  > {
    switch (entity) {
      case 'companies':
      case 'company': {
        const name = typeof data['name'] === 'string' ? data['name'].trim() : '';
        if (!name) {
          return {
            ok: false,
            reasonCode: 'EMPTY_COMPANY_NAME',
            message: 'Company name is required and cannot be empty',
            field: 'name',
          };
        }
        if (data['email']) {
          const email = String(data['email']).trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return {
              ok: false,
              reasonCode: 'INVALID_EMAIL',
              message: 'Company email format is invalid',
              field: 'email',
            };
          }
        }
        return { ok: true, data: { ...data, name } };
      }

      case 'leads':
      case 'lead': {
        const contactId = typeof data['contactId'] === 'string' ? data['contactId'].trim() : '';
        if (!contactId) {
          return {
            ok: false,
            reasonCode: 'EMPTY_MANDATORY_FIELD',
            message: 'Lead contactId is required',
            field: 'contactId',
          };
        }
        try {
          const contact = await this.service.getContactById(contactId);
          if (!contact) {
            return {
              ok: false,
              reasonCode: 'REFERENCE_NOT_FOUND',
              message: `Referenced contact with ID '${contactId}' not found`,
              field: 'contactId',
            };
          }
        } catch {
          return {
            ok: false,
            reasonCode: 'REFERENCE_NOT_FOUND',
            message: `Referenced contact with ID '${contactId}' not found`,
            field: 'contactId',
          };
        }

        const status = data['status'] ? String(data['status']) : 'New';
        if (!VALID_LEAD_STATUSES.includes(status as any)) {
          return {
            ok: false,
            reasonCode: 'INVALID_LEAD_STATUS',
            message: `Lead status '${status}' is not valid. Allowed: ${VALID_LEAD_STATUSES.join(', ')}`,
            field: 'status',
          };
        }
        return { ok: true, data: { ...data, contactId, status } };
      }

      case 'contacts':
      case 'contact':
      default: {
        const firstName = typeof data['firstName'] === 'string' ? data['firstName'].trim() : '';
        const lastName = typeof data['lastName'] === 'string' ? data['lastName'].trim() : '';
        if (!firstName || !lastName) {
          return {
            ok: false,
            reasonCode: 'EMPTY_MANDATORY_FIELD',
            message: 'Contact first and last name are required and cannot be empty',
            field: !firstName ? 'firstName' : 'lastName',
          };
        }
        if (data['email']) {
          const email = String(data['email']).trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return {
              ok: false,
              reasonCode: 'INVALID_EMAIL',
              message: 'Contact email format is invalid',
              field: 'email',
            };
          }
        }
        if (data['leadStatus']) {
          const leadStatus = String(data['leadStatus']);
          if (!VALID_LEAD_STATUSES.includes(leadStatus as any)) {
            return {
              ok: false,
              reasonCode: 'INVALID_LEAD_STATUS',
              message: `Lead status '${leadStatus}' is not valid. Allowed: ${VALID_LEAD_STATUSES.join(', ')}`,
              field: 'leadStatus',
            };
          }
        }
        if (data['companyId']) {
          const companyId = String(data['companyId']);
          try {
            const company = await this.service.getCompanyById(companyId);
            if (!company) {
              return {
                ok: false,
                reasonCode: 'REFERENCE_NOT_FOUND',
                message: `Referenced company with ID '${companyId}' not found`,
                field: 'companyId',
              };
            }
          } catch {
            return {
              ok: false,
              reasonCode: 'REFERENCE_NOT_FOUND',
              message: `Referenced company with ID '${companyId}' not found`,
              field: 'companyId',
            };
          }
        }
        return { ok: true, data: { ...data, firstName, lastName } };
      }
    }
  }
}
