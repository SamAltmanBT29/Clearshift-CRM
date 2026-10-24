import { describe, it, expect, beforeEach } from 'vitest';
import { Roles, signAccessToken } from '@cs/identity';
import type { ReferenceResolver } from '@cs/kernel';
import { AppError } from '@cs/kernel';
import { buildApp } from '../../src/app.js';
import { Crm4Service } from '../../src/services/crm4.service.js';
import { Crm4AuditService } from '../../src/services/audit.js';
import {
  ALLOWED_MEMBER_TRANSITIONS,
  assertValidMemberStatusTransition,
  assertValidConsentStatusTransition,
  assertContactExists,
} from '../../src/domain/relationships.js';

describe('CRM-4 Domain Relationships, State Transitions & Read-Model Consistency (Issue #41 / [CRM4-06])', () => {
  // =========================================================================
  // 1. Domain Unit Rules: Member Status Transitions
  // =========================================================================
  describe('1. Member Status Transitions (assertValidMemberStatusTransition)', () => {
    it('defines forward-only transitions accurately in ALLOWED_MEMBER_TRANSITIONS', () => {
      expect(ALLOWED_MEMBER_TRANSITIONS.sent).toEqual(['opened', 'clicked']);
      expect(ALLOWED_MEMBER_TRANSITIONS.opened).toEqual(['clicked']);
      expect(ALLOWED_MEMBER_TRANSITIONS.clicked).toEqual([]);
    });

    it('allows valid forward transition: sent -> opened', () => {
      expect(() => assertValidMemberStatusTransition('sent', 'opened')).not.toThrow();
    });

    it('allows valid forward transition: sent -> clicked', () => {
      expect(() => assertValidMemberStatusTransition('sent', 'clicked')).not.toThrow();
    });

    it('allows valid forward transition: opened -> clicked', () => {
      expect(() => assertValidMemberStatusTransition('opened', 'clicked')).not.toThrow();
    });

    it('allows idempotent self-transition without error', () => {
      expect(() => assertValidMemberStatusTransition('sent', 'sent')).not.toThrow();
      expect(() => assertValidMemberStatusTransition('opened', 'opened')).not.toThrow();
      expect(() => assertValidMemberStatusTransition('clicked', 'clicked')).not.toThrow();
    });

    it('strictly forbids backwards transition: opened -> sent with 422 INVALID_STATE_TRANSITION', () => {
      expect(() => assertValidMemberStatusTransition('opened', 'sent')).toThrowError(
        expect.objectContaining({
          code: 'INVALID_STATE_TRANSITION',
          statusCode: 422,
        })
      );
    });

    it('strictly forbids backwards transition: clicked -> opened with 422 INVALID_STATE_TRANSITION', () => {
      expect(() => assertValidMemberStatusTransition('clicked', 'opened')).toThrowError(
        expect.objectContaining({
          code: 'INVALID_STATE_TRANSITION',
          statusCode: 422,
        })
      );
    });

    it('strictly forbids backwards transition: clicked -> sent with 422 INVALID_STATE_TRANSITION', () => {
      expect(() => assertValidMemberStatusTransition('clicked', 'sent')).toThrowError(
        expect.objectContaining({
          code: 'INVALID_STATE_TRANSITION',
          statusCode: 422,
        })
      );
    });

    it('rejects invalid or unknown status transitions with 422', () => {
      expect(() => assertValidMemberStatusTransition('sent', 'bounced' as any)).toThrowError(
        expect.objectContaining({
          code: 'INVALID_STATE_TRANSITION',
          statusCode: 422,
        })
      );
    });
  });

  // =========================================================================
  // 2. Domain Unit Rules: Consent Status Monotonic Opt-Out (BR-CRM4-01)
  // =========================================================================
  describe('2. Consent Transitions (assertValidConsentStatusTransition)', () => {
    it('allows initial subscription from null or undefined', () => {
      expect(() => assertValidConsentStatusTransition(null, 'subscribed')).not.toThrow();
      expect(() => assertValidConsentStatusTransition(undefined, 'subscribed')).not.toThrow();
    });

    it('allows transition from subscribed -> unsubscribed', () => {
      expect(() => assertValidConsentStatusTransition('subscribed', 'unsubscribed')).not.toThrow();
    });

    it('allows idempotent unsubscribed -> unsubscribed re-assertion', () => {
      expect(() => assertValidConsentStatusTransition('unsubscribed', 'unsubscribed')).not.toThrow();
    });

    it('strictly forbids unsubscribed -> subscribed reversal with 409 CONFLICT', () => {
      expect(() => assertValidConsentStatusTransition('unsubscribed', 'subscribed')).toThrowError(
        expect.objectContaining({
          code: 'CONFLICT',
          statusCode: 409,
        })
      );
    });
  });

  // =========================================================================
  // 3. Domain Unit Rules: Cross-Module Contact Referential Integrity
  // =========================================================================
  describe('3. Cross-Module Reference Validation (assertContactExists)', () => {
    it('passes without error when ReferenceResolver confirms contact exists in CRM-1', async () => {
      const mockResolver: ReferenceResolver = {
        exists: async (entityType: string, id: string) => {
          return entityType === 'contact' && id === 'contact-valid-uuid';
        },
      };

      await expect(assertContactExists(mockResolver, 'contact-valid-uuid')).resolves.toBeUndefined();
    });

    it('throws 404 NOT_FOUND when ReferenceResolver returns false (missing contact)', async () => {
      const mockResolver: ReferenceResolver = {
        exists: async () => false,
      };

      await expect(assertContactExists(mockResolver, 'missing-contact-uuid')).rejects.toThrowError(
        expect.objectContaining({
          code: 'NOT_FOUND',
          statusCode: 404,
        })
      );
    });

    it('proceeds safely when no ReferenceResolver is injected (standalone mode)', async () => {
      await expect(assertContactExists(undefined, 'any-contact-uuid')).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // 4. Service-Level Verification: Service Integration with Transitions & Consistency
  // =========================================================================
  describe('4. Crm4Service Integration: Transitions & Derived Read-Model Consistency', () => {
    let service: Crm4Service;
    const knownContact = '11111111-1111-4111-8111-000000000001';
    const nonExistentContact = '99999999-9999-4999-8999-999999999999';

    beforeEach(() => {
      const mockResolver: ReferenceResolver = {
        exists: async (entityType: string, id: string) => {
          return entityType === 'contact' && (id === knownContact || id === '11111111-1111-4111-8111-000000000003');
        },
      };
      service = new Crm4Service(mockResolver);
      service.seedSyntheticData();
    });

    it('rejects adding a member if contactId does not exist in CRM-1', async () => {
      const campaignId = '11111111-1111-4111-8111-100000000001';
      await expect(
        service.addCampaignMember({
          campaignId,
          contactId: nonExistentContact,
          status: 'sent',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'NOT_FOUND',
          statusCode: 404,
        })
      );
    });

    it('maintains immediate derived memberCount and campaignCount read-model consistency', async () => {
      // 1. Create a list
      const list = await service.createList({
        name: 'Consistency Test List',
        type: 'static',
      });
      expect(list.memberCount).toBe(0);
      expect(list.campaignCount).toBe(0);

      // 2. Create a campaign associated with list
      const campaign = await service.createCampaign({
        name: 'Consistency Test Campaign',
        listId: list.id,
        status: 'draft',
      });

      // Derived campaignCount on list should immediately reflect 1
      const updatedList = await service.getListById(list.id);
      expect(updatedList.campaignCount).toBe(1);

      // 3. Add member to campaign
      const member = await service.addCampaignMember({
        campaignId: campaign.id,
        contactId: knownContact,
        status: 'sent',
      });
      expect(member.status).toBe('sent');

      // Member count on list reflects added member
      const listAfterMember = await service.getListById(list.id);
      expect(listAfterMember.memberCount).toBe(1);
    });

    it('allows valid member state transition via service.patchMember (sent -> opened)', async () => {
      const campaignId = '44444444-2222-4444-8444-000000000001';
      const contact3Id = '11111111-1111-4111-8111-000000000003';
      const member = await service.addCampaignMember({
        campaignId,
        contactId: contact3Id,
        status: 'sent',
      });

      const updated = await service.patchMember(campaignId, member.id, {
        status: 'opened',
      });
      expect(updated.status).toBe('opened');
    });

    it('forbids invalid backward member state transition via service.patchMember (opened -> sent)', async () => {
      const campaignId = '44444444-2222-4444-8444-000000000001';
      const contact3Id = '11111111-1111-4111-8111-000000000003';
      const member = await service.addCampaignMember({
        campaignId,
        contactId: contact3Id,
        status: 'sent',
      });
      await service.patchMember(campaignId, member.id, { status: 'opened' });

      await expect(
        service.patchMember(campaignId, member.id, { status: 'sent' })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'INVALID_STATE_TRANSITION',
          statusCode: 422,
        })
      );
    });
  });

  // =========================================================================
  // 5. HTTP API End-to-End: PATCH /campaigns/:id/members/:memberId
  // =========================================================================
  describe('5. HTTP API: PATCH /campaigns/:id/members/:memberId', () => {
    let app: ReturnType<typeof buildApp>;
    let service: Crm4Service;
    let auditService: Crm4AuditService;
    let editorToken: string;
    let viewerToken: string;

    const editorHeaders = () => ({ authorization: `Bearer ${editorToken}` });
    const viewerHeaders = () => ({ authorization: `Bearer ${viewerToken}` });

    beforeEach(async () => {
      service = new Crm4Service();
      service.seedSyntheticData();
      auditService = new Crm4AuditService();
      app = buildApp({ service, auditService, authEnabled: true });
      await app.ready();

      editorToken = await signAccessToken('test-editor-user', [Roles.EDITOR]);
      viewerToken = await signAccessToken('test-viewer-user', [Roles.VIEWER]);
    });

    it('returns 200 OK and updates member when state transition is forward (sent -> opened)', async () => {
      const campaignId = '44444444-2222-4444-8444-000000000001';
      const memberId = '44444444-3333-4444-8444-000000000001'; // status is 'sent' in seed

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/crm-marketing/campaigns/${campaignId}/members/${memberId}`,
        headers: editorHeaders(),
        payload: {
          status: 'opened',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(memberId);
      expect(body.status).toBe('opened');
    });

    it('returns 422 Unprocessable Entity when backward state transition is attempted (opened -> sent)', async () => {
      const campaignId = '44444444-2222-4444-8444-000000000001';
      const memberId = '44444444-3333-4444-8444-000000000002'; // status is 'opened' in seed

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/crm-marketing/campaigns/${campaignId}/members/${memberId}`,
        headers: editorHeaders(),
        payload: {
          status: 'sent',
        },
      });

      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('returns 403 Forbidden when a VIEWER attempts to update member status', async () => {
      const campaignId = '44444444-2222-4444-8444-000000000001';
      const memberId = '44444444-3333-4444-8444-000000000001';

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/crm-marketing/campaigns/${campaignId}/members/${memberId}`,
        headers: viewerHeaders(),
        payload: {
          status: 'opened',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('returns 404 Not Found when member does not exist', async () => {
      const campaignId = '44444444-2222-4444-8444-000000000001';
      const nonExistentMember = '00000000-0000-0000-0000-000000000000';

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/crm-marketing/campaigns/${campaignId}/members/${nonExistentMember}`,
        headers: editorHeaders(),
        payload: {
          status: 'opened',
        },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.code).toBe('NOT_FOUND');
    });
  });
});
