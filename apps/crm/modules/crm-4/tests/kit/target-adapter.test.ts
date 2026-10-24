import { describe, it, expect, beforeEach } from 'vitest';
import { Crm4TargetAdapter } from '../../src/migration/target-adapter.js';
import { Crm4Service } from '../../src/services/crm4.service.js';

describe('CRM-4 Migration Kit Target Adapter & Durable Import Receipts (Issue #164 / [CRM4-11])', () => {
  let service: Crm4Service;
  let adapter: Crm4TargetAdapter;

  beforeEach(() => {
    service = new Crm4Service();
    service.seedSyntheticData();
    adapter = new Crm4TargetAdapter(service);
  });

  // =========================================================================
  // 1. Preflight Dry-Run Phase
  // =========================================================================
  describe('Preflight Validation (Dry-Run Phase)', () => {
    it('validates marketing list, campaign, member, and consent rows without mutating target store', async () => {
      const rows = [
        {
          entity: 'list',
          data: {
            name: 'Valid Preflight Cohort',
            description: 'Dry run test cohort',
          },
        },
        {
          entity: 'list',
          data: {
            name: '   ', // Invalid empty name
          },
        },
        {
          entity: 'campaign',
          data: {
            name: 'Valid Webinar',
            campaignDate: '2026-11-20',
            listId: '44444444-1111-4444-8444-000000000001',
          },
        },
        {
          entity: 'consent',
          data: {
            contactId: '11111111-1111-4111-8111-000000000002', // Contact 2 is known unsubscribed
            status: 'subscribed', // Opt-out violation (BR-CRM4-01)
            source: 'csv_file',
          },
        },
      ];

      const preflightResult = await adapter.preflight('batch-dry-run-crm4-01', rows);
      expect(preflightResult.ok).toBe(true);
      if (preflightResult.ok) {
        expect(preflightResult.value.validCount).toBe(2);
        expect(preflightResult.value.rejectCount).toBe(2);
      }

      // Assert zero database/store mutations occurred during dry run
      const listCheck = await service.getListByName('Valid Preflight Cohort');
      expect(listCheck).toBeUndefined();
      const campCheck = await service.getCampaignByName('Valid Webinar');
      expect(campCheck).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. Atomic importRow & Durable Import Receipt Commit
  // =========================================================================
  describe('Import Row & Durable Receipt Commit', () => {
    it('commits marketing list target record and durable receipt atomically', async () => {
      const result = await adapter.importRow(
        'batch-kit-crm4-01',
        1,
        'idemp-kit-list-01',
        {
          entity: 'list',
          data: {
            name: 'Production Migration List',
            description: 'Enterprise contacts from legacy system',
          },
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.targetId).toBeDefined();
        expect(result.value.receipt.batchId).toBe('batch-kit-crm4-01');
        expect(result.value.receipt.sourceRow).toBe(1);
        expect(result.value.receipt.idempotencyKey).toBe('idemp-kit-list-01');
        expect(result.value.receipt.kind).toBe('created');

        // Verify record is visible in domain service
        const list = await service.getListById(result.value.targetId);
        expect(list.name).toBe('Production Migration List');
        expect(list.description).toBe('Enterprise contacts from legacy system');
      }
    });

    it('commits campaign linked to parent list and increments parent list campaignCount', async () => {
      const listId = '44444444-1111-4444-8444-000000000002';
      const beforeList = await service.getListById(listId);
      const initialCount = beforeList.campaignCount;

      const result = await adapter.importRow(
        'batch-kit-crm4-01',
        2,
        'idemp-kit-camp-01',
        {
          entity: 'campaign',
          data: {
            name: 'Product Deep-Dive Webinar',
            campaignDate: '2026-11-28',
            listId,
          },
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.targetId).toBeDefined();
        expect(result.value.receipt.kind).toBe('created');

        const afterList = await service.getListById(listId);
        expect(afterList.campaignCount).toBe(initialCount + 1);
      }
    });

    it('commits campaign member record and updates memberCount', async () => {
      const campId = '44444444-2222-4444-8444-000000000002';
      const contactId = '11111111-9999-4111-8111-000000000009';

      const result = await adapter.importRow(
        'batch-kit-crm4-01',
        3,
        'idemp-kit-mem-01',
        {
          entity: 'member',
          data: {
            campaignId: campId,
            contactId,
            status: 'opened',
          },
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.receipt.kind).toBe('created');
        const member = await service.getMember(campId, contactId);
        expect(member).toBeDefined();
        expect(member?.status).toBe('opened');
      }
    });

    it('commits contact consent record with source and timestamp', async () => {
      const contactId = '11111111-8888-4111-8111-000000000008';

      const result = await adapter.importRow(
        'batch-kit-crm4-01',
        4,
        'idemp-kit-consent-01',
        {
          entity: 'consent',
          data: {
            contactId,
            status: 'subscribed',
            source: 'legacy_hubspot_import',
            consentDate: '2026-10-15T12:00:00.000Z',
          },
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.receipt.kind).toBe('created');
        const consent = await service.getConsent(contactId);
        expect(consent.status).toBe('subscribed');
        expect(consent.source).toBe('legacy_hubspot_import');
      }
    });

    it('returns existing receipt on exact idempotent replay without duplicate records', async () => {
      const rowPayload = {
        entity: 'list',
        data: {
          name: 'Idempotent Replay Cohort',
          description: 'Testing idempotent replay semantics',
        },
      };

      const firstResult = await adapter.importRow('batch-crm4-02', 1, 'idemp-replay-crm4-01', rowPayload);
      expect(firstResult.ok).toBe(true);

      const secondResult = await adapter.importRow('batch-crm4-02', 1, 'idemp-replay-crm4-01', rowPayload);
      expect(secondResult.ok).toBe(true);

      if (firstResult.ok && secondResult.ok) {
        expect(secondResult.value.targetId).toBe(firstResult.value.targetId);
        expect(secondResult.value.receipt.idempotencyKey).toBe(firstResult.value.receipt.idempotencyKey);
      }

      // Assert only 1 list was created in the service
      const allLists = await service.getLists({ search: 'Idempotent Replay Cohort' });
      expect(allLists.items).toHaveLength(1);
    });

    it('rejects idempotency key reuse with different payload with IDEMPOTENCY_CONFLICT', async () => {
      await adapter.importRow('batch-crm4-03', 1, 'conflict-key-crm4-01', {
        entity: 'list',
        data: {
          name: 'Initial Original Cohort',
        },
      });

      const conflictingResult = await adapter.importRow('batch-crm4-03', 1, 'conflict-key-crm4-01', {
        entity: 'list',
        data: {
          name: 'Tampered Different Cohort Name',
        },
      });

      expect(conflictingResult.ok).toBe(false);
      if (!conflictingResult.ok) {
        expect(conflictingResult.error.reasonCode).toBe('IDEMPOTENCY_CONFLICT');
      }
    });

    it('simulates 503 transient failure for bounded exponential backoff recovery', async () => {
      const transientResult = await adapter.importRow(
        'batch-transient-crm4',
        1,
        'transient-key-crm4-01',
        {
          entity: 'list',
          data: { name: 'Transient Cohort' },
        },
        { simulate503: true }
      );

      expect(transientResult.ok).toBe(false);
      if (!transientResult.ok) {
        expect(transientResult.error.reasonCode).toBe('SERVICE_UNAVAILABLE');
      }
    });

    it('rolls back target mutation atomically if receipt commit fails', async () => {
      await expect(
        adapter.importRow(
          'batch-rollback-01',
          1,
          'rollback-key-01',
          {
            entity: 'list',
            data: { name: 'Rollback Candidate List' },
          },
          { failReceiptCommit: true }
        )
      ).rejects.toThrow('Database transaction aborted');

      // Assert list was rolled back and never persisted
      const listCheck = await service.getListByName('Rollback Candidate List');
      expect(listCheck).toBeUndefined();
    });
  });

  // =========================================================================
  // 3. Domain Invariants & Business Rule Enforcement
  // =========================================================================
  describe('Domain Invariants Enforcement', () => {
    it('enforces BR-CRM4-01: rejects reversion of unsubscribed contact to subscribed', async () => {
      // Contact 2 is known unsubscribed
      const contact2Id = '11111111-1111-4111-8111-000000000002';

      const result = await adapter.importRow(
        'batch-optout-01',
        1,
        'idemp-optout-01',
        {
          entity: 'consent',
          data: {
            contactId: contact2Id,
            status: 'subscribed', // Re-subscribe attempt forbidden
            source: 'csv_reimport',
          },
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reasonCode).toBe('OPT_OUT_VIOLATION');
      }
    });

    it('strictly enforces member status allowlist (sent, opened, clicked)', async () => {
      const result = await adapter.importRow(
        'batch-mem-status-01',
        1,
        'idemp-mem-status-01',
        {
          entity: 'member',
          data: {
            campaignId: '44444444-2222-4444-8444-000000000001',
            contactId: '11111111-1111-4111-8111-000000000003',
            status: 'bounced', // Not allowed in V1
          },
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reasonCode).toBe('INVALID_MEMBER_STATUS');
      }
    });

    it('links existing campaign member without creating duplicate row', async () => {
      // Contact 1 is already in Campaign 1
      const initialMemberCount = (await service.getCampaignById('44444444-2222-4444-8444-000000000001')).memberCount;

      const result = await adapter.importRow(
        'batch-dup-mem-01',
        1,
        'idemp-dup-mem-01',
        {
          entity: 'member',
          data: {
            campaignId: '44444444-2222-4444-8444-000000000001',
            contactId: '11111111-1111-4111-8111-000000000001',
            status: 'opened',
          },
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.receipt.kind).toBe('linked');
        const afterCount = (await service.getCampaignById('44444444-2222-4444-8444-000000000001')).memberCount;
        expect(afterCount).toBe(initialMemberCount);
      }
    });
  });

  // =========================================================================
  // 4. Batch Loading (loadBatch Interface)
  // =========================================================================
  describe('loadBatch Interface Execution', () => {
    it('processes a sequence of mixed valid and invalid rows, reporting loaded receipts and errors', async () => {
      const rows = [
        {
          entity: 'list',
          data: { name: 'Batch Cohort 1', description: 'Batch test' },
        },
        {
          entity: 'list',
          data: { name: '   ' }, // Invalid blank name
        },
        {
          entity: 'consent',
          data: {
            contactId: '11111111-0000-4111-8111-000000000001',
            status: 'subscribed',
            source: 'web_form',
          },
        },
      ];

      const batchResult = await adapter.loadBatch('batch-multi-crm4', rows);
      expect(batchResult.ok).toBe(true);
      if (batchResult.ok) {
        expect(batchResult.value.loaded).toHaveLength(2);
        expect(batchResult.value.errors).toHaveLength(1);
        expect(batchResult.value.errors[0].sourceRow).toBe(2);
        expect(batchResult.value.errors[0].error.reasonCode).toBe('EMPTY_LIST_NAME');
      }
    });
  });
});
