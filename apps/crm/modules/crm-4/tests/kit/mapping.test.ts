import { describe, it, expect } from 'vitest';
import {
  CRM4_LISTS_CANONICAL_V1,
  CRM4_LISTS_LEGACY_V1,
  CRM4_CAMPAIGNS_CANONICAL_V1,
  CRM4_CAMPAIGNS_LEGACY_V1,
  CRM4_MEMBERS_CANONICAL_V1,
  CRM4_MEMBERS_LEGACY_V1,
  CRM4_CONSENTS_CANONICAL_V1,
  CRM4_CONSENTS_LEGACY_V1,
  assertDryRunReady,
  validateTemplate,
  getTemplate,
  listTemplates,
  mapRow,
  templateChecksum,
  translateEnum,
  ENUMS,
} from '../../src/kit/mapping-defaults.js';

describe('CRM-4 Mapping Templates, Coercions & Dry-Run Guards (#181, [CRM4-28])', () => {
  describe('Marketing Lists Mapping (crm4_lists)', () => {
    it('maps canonical list row with defaults and coercions', () => {
      const source = {
        id: '44444444-1111-4444-8444-000000000001',
        name: 'Enterprise VIP Accounts',
        description: 'Tier-1 enterprise accounts in APAC region',
        campaign_count: '5',
        member_count: '150',
      };

      const result = mapRow(source, CRM4_LISTS_CANONICAL_V1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          id: '44444444-1111-4444-8444-000000000001',
          name: 'Enterprise VIP Accounts',
          description: 'Tier-1 enterprise accounts in APAC region',
          campaignCount: 5,
          memberCount: 150,
          updatedAt: null,
        });
      }
    });

    it('maps legacy list row to target schema attributes', () => {
      const legacy = {
        ListId: '44444444-1111-4444-8444-000000000002',
        ListName: 'SMB Prospects Q4',
        ListDescription: 'Small-mid business leads',
        TotalCampaigns: '2',
        TotalMembers: '45',
      };

      const result = mapRow(legacy, CRM4_LISTS_LEGACY_V1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value['name']).toBe('SMB Prospects Q4');
        expect(result.value['campaignCount']).toBe(2);
        expect(result.value['memberCount']).toBe(45);
      }
    });

    it('reports missing required list name', () => {
      const result = mapRow({ description: 'No name given' }, CRM4_LISTS_CANONICAL_V1);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]?.field).toBe('name');
        expect(result.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD');
      }
    });
  });

  describe('Campaigns Mapping (crm4_campaigns)', () => {
    it('maps canonical campaign with date and uuid coercion', () => {
      const source = {
        id: '44444444-2222-4444-8444-000000000001',
        name: 'Developer Workshop Sydney',
        campaign_date: '2026-11-10',
        list_id: '44444444-1111-4444-8444-000000000001',
        member_count: '75',
      };

      const result = mapRow(source, CRM4_CAMPAIGNS_CANONICAL_V1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          id: '44444444-2222-4444-8444-000000000001',
          name: 'Developer Workshop Sydney',
          campaignDate: '2026-11-10',
          listId: '44444444-1111-4444-8444-000000000001',
          memberCount: 75,
          updatedAt: null,
        });
      }
    });

    it('maps legacy campaign export headers to canonical fields', () => {
      const legacy = {
        CampaignId: '44444444-2222-4444-8444-000000000002',
        CampaignName: 'Product Launch Webinar',
        ScheduledDate: '2026-12-05',
        TargetListId: '44444444-1111-4444-8444-000000000001',
        TotalAudience: '250',
      };

      const result = mapRow(legacy, CRM4_CAMPAIGNS_LEGACY_V1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value['name']).toBe('Product Launch Webinar');
        expect(result.value['campaignDate']).toBe('2026-12-05');
        expect(result.value['listId']).toBe('44444444-1111-4444-8444-000000000001');
        expect(result.value['memberCount']).toBe(250);
      }
    });

    it('rejects invalid campaign date formats', () => {
      const source = {
        name: 'Invalid Date Campaign',
        campaign_date: '31/02/2026',
        list_id: '44444444-1111-4444-8444-000000000001',
      };

      const result = mapRow(source, CRM4_CAMPAIGNS_CANONICAL_V1);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.field === 'campaignDate' && e.code === 'INVALID_DATE')).toBe(true);
      }
    });
  });

  describe('Campaign Members Mapping (crm4_members)', () => {
    it('maps member status enum and boolean unsubscribe flag', () => {
      const source = {
        campaign_id: '44444444-2222-4444-8444-000000000001',
        contact_id: '11111111-1111-4111-8111-000000000001',
        status: 'delivered', // synonym for 'sent'
        unsubscribed: 'false',
      };

      const result = mapRow(source, CRM4_MEMBERS_CANONICAL_V1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value['status']).toBe('sent');
        expect(result.value['unsubscribed']).toBe(false);
      }
    });

    it('maps synonyms for member status (delivered -> sent, open -> opened, click -> clicked)', () => {
      const s1 = mapRow(
        { campaign_id: '44444444-2222-4444-8444-000000000001', contact_id: '11111111-1111-4111-8111-000000000001', status: 'viewed' },
        CRM4_MEMBERS_CANONICAL_V1
      );
      expect(s1.ok && s1.value['status']).toBe('opened');

      const s2 = mapRow(
        { campaign_id: '44444444-2222-4444-8444-000000000001', contact_id: '11111111-1111-4111-8111-000000000001', status: 'tap' },
        CRM4_MEMBERS_CANONICAL_V1
      );
      expect(s2.ok && s2.value['status']).toBe('clicked');
    });

    it('rejects unmappable member status values outside allowlist', () => {
      const source = {
        campaign_id: '44444444-2222-4444-8444-000000000001',
        contact_id: '11111111-1111-4111-8111-000000000001',
        status: 'bounced',
      };

      const result = mapRow(source, CRM4_MEMBERS_CANONICAL_V1);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]?.field).toBe('status');
        expect(result.errors[0]?.code).toBe('INVALID_ENUM_VALUE');
      }
    });
  });

  describe('Contact Consents Mapping & Monotonic Opt-Out Guard (crm4_consents, BR-CRM4-01)', () => {
    it('maps consent status synonyms (opt_in -> subscribed, opt_out -> unsubscribed)', () => {
      const inRow = mapRow(
        { contact_id: '11111111-1111-4111-8111-000000000001', status: 'opt_in', source: 'web_form' },
        CRM4_CONSENTS_CANONICAL_V1
      );
      expect(inRow.ok && inRow.value['status']).toBe('subscribed');

      const outRow = mapRow(
        { contact_id: '11111111-1111-4111-8111-000000000002', status: 'withdrawn', source: 'unsubscribe_link' },
        CRM4_CONSENTS_CANONICAL_V1
      );
      expect(outRow.ok && outRow.value['status']).toBe('unsubscribed');
    });

    it('enforces BR-CRM4-01 monotonic opt-out rule: blocks overwriting unsubscribed with subscribed', () => {
      const violatingRow = {
        contact_id: '11111111-1111-4111-8111-000000000004',
        status: 'subscribed',
        source: 're_engagement_campaign',
        prior_consent_status: 'unsubscribed',
      };

      const result = mapRow(violatingRow, CRM4_CONSENTS_CANONICAL_V1);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const err = result.errors.find((e) => e.code === 'MONOTONIC_OPT_OUT_VIOLATION');
        expect(err).toBeDefined();
        expect(err?.message).toContain('BR-CRM4-01');
      }
    });

    it('allows opt-out updates over prior opt-in status', () => {
      const allowedRow = {
        contact_id: '11111111-1111-4111-8111-000000000004',
        status: 'unsubscribed',
        source: 'user_settings',
        prior_consent_status: 'subscribed',
      };

      const result = mapRow(allowedRow, CRM4_CONSENTS_CANONICAL_V1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value['status']).toBe('unsubscribed');
      }
    });
  });

  describe('Dry-Run Enforcement Guards', () => {
    it('blocks dry-run execution when a required target column is unmapped', () => {
      const incompleteHeaders = ['id', 'description']; // Missing 'name'
      expect(() => assertDryRunReady(CRM4_LISTS_CANONICAL_V1, incompleteHeaders)).toThrow('Unmapped required');
    });

    it('passes dry-run readiness check when all mandatory columns are mapped', () => {
      const validHeaders = ['id', 'name', 'description', 'campaign_count', 'member_count'];
      expect(() => assertDryRunReady(CRM4_LISTS_CANONICAL_V1, validHeaders)).not.toThrow();
    });

    it('accepts alternate source aliases in dry-run readiness check', () => {
      const aliasHeaders = ['id', 'list_name', 'description']; // list_name is configured alias for name
      expect(() => assertDryRunReady(CRM4_LISTS_CANONICAL_V1, aliasHeaders)).not.toThrow();
    });

    it('returns structured validation report from validateTemplate', () => {
      const report = validateTemplate(CRM4_CAMPAIGNS_CANONICAL_V1, ['name']);
      expect(report.valid).toBe(false);
      expect(report.missingRequiredFields).toContain('campaignDate');
      expect(report.missingRequiredFields).toContain('listId');
    });
  });

  describe('Template Metadata, Versioning & Checksum Reproducibility', () => {
    it('retrieves templates by ID and version', () => {
      const template = getTemplate('crm4-lists-canonical', 1);
      expect(template).toBeDefined();
      expect(template?.id).toBe('crm4-lists-canonical');
      expect(template?.version).toBe(1);

      expect(getTemplate('crm4-lists-canonical', 99)).toBeUndefined();
    });

    it('lists templates filtered by target entity', () => {
      const listTemplatesResult = listTemplates('crm4_lists');
      expect(listTemplatesResult.length).toBe(2);
      expect(listTemplatesResult.every((t) => t.entity === 'crm4_lists')).toBe(true);
    });

    it('generates consistent and stable cryptographic SHA-256 digests', () => {
      const hash1 = templateChecksum(CRM4_LISTS_CANONICAL_V1);
      const hash2 = templateChecksum(CRM4_LISTS_CANONICAL_V1);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64); // SHA-256 hex length

      const hashLegacy = templateChecksum(CRM4_LISTS_LEGACY_V1);
      expect(hash1).not.toBe(hashLegacy);
    });

    it('is pure and deterministic: does not mutate source rows', () => {
      const source = {
        id: '44444444-1111-4444-8444-000000000001',
        name: 'Original Name',
        description: 'Original Description',
      };
      const snapshot = JSON.stringify(source);

      const r1 = mapRow(source, CRM4_LISTS_CANONICAL_V1);
      const r2 = mapRow(source, CRM4_LISTS_CANONICAL_V1);

      expect(JSON.stringify(source)).toBe(snapshot);
      expect(r1).toEqual(r2);
    });
  });
});
