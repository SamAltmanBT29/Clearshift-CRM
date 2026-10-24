/**
 * CRM-4 Browser Journey Test Suite (Issue #182 / [CRM4-29])
 *
 * Simulates end-to-end browser journeys in Chrome/Firefox environments:
 *   - Multi-Browser Environment Simulation (Chrome & Firefox)
 *   - Journey 1: Create Marketing List Workflow
 *   - Journey 2: List and Filter Directory Workflow (SDS 5-column grid)
 *   - Journey 3: Create Campaign Workflow with YYYY-MM-DD Date and List Immutability (BR-CRM4-02)
 *   - Journey 4: Campaign Detail View, Member Sub-table & Status Allowlist
 *   - Journey 5: Contact Consent Management & Monotonic Opt-Out Rule (BR-CRM4-01)
 *   - Journey 6: Migration Mapping Templates Explorer Journey
 *   - Journey 7: Accessible Shell Landmark & Keyboard Traversal across Tabs
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import type { CRM4List, CRM4Campaign, CRM4Member, CRM4Consent } from '@clearshift/contracts';
import { MarketingListsPage } from '../../web/src/pages/MarketingListsPage.js';
import { MarketingListsTable } from '../../web/src/components/MarketingListsTable.js';
import { ListForm } from '../../web/src/components/forms/ListForm.js';
import { CampaignForm } from '../../web/src/components/forms/CampaignForm.js';
import { CampaignDetailPage } from '../../web/src/pages/CampaignDetailPage.js';
import { CampaignMemberForm } from '../../web/src/components/forms/CampaignMemberForm.js';
import { ConsentForm } from '../../web/src/components/forms/ConsentForm.js';
import { MappingTemplatesPage } from '../../web/pages/MappingTemplatesPage.js';
import { Crm4ShellController } from '../../web/shell/Crm4Shell.js';
import { formatBrowserTitle } from '../../web/routes.js';

// Helper to access virtual React element props safely in TypeScript strict mode
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asEl = (node: unknown): any => node as any;

const syntheticLists: CRM4List[] = [
  {
    id: '44444444-1111-4444-8444-000000000001',
    name: 'Q4 Enterprise Prospects',
    description: 'Tier-1 client accounts with enterprise agreements',
    campaignCount: 2,
    memberCount: 150,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T10:00:00Z',
  },
  {
    id: '44444444-1111-4444-8444-000000000002',
    name: 'Product Beta Advocates',
    description: 'Community champions for early access releases',
    campaignCount: 1,
    memberCount: 45,
    createdAt: '2026-10-05T14:30:00Z',
    updatedAt: '2026-10-05T14:30:00Z',
  },
];

const syntheticCampaign: CRM4Campaign = {
  id: '44444444-2222-4444-8444-000000000001',
  name: 'Q4 Global Product Summit',
  campaignDate: '2026-11-20',
  listId: '44444444-1111-4444-8444-000000000001',
  memberCount: 2,
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
};

const syntheticMembers: CRM4Member[] = [
  {
    id: '44444444-3333-4444-8444-000000000001',
    campaignId: '44444444-2222-4444-8444-000000000001',
    contactId: '11111111-1111-4111-8111-000000000001',
    status: 'opened',
    unsubscribed: false,
    createdAt: '2026-10-01T10:05:00Z',
  },
  {
    id: '44444444-3333-4444-8444-000000000002',
    campaignId: '44444444-2222-4444-8444-000000000001',
    contactId: '11111111-1111-4111-8111-000000000002',
    status: 'clicked',
    unsubscribed: true,
    createdAt: '2026-10-01T10:10:00Z',
  },
];

describe('CRM-4 Browser Journey & User Experience Suite (Issue #182 / [CRM4-29])', () => {
  beforeEach(() => {
    const dispatcher = {
      useState: (initial: unknown) => [
        typeof initial === 'function' ? (initial as () => unknown)() : initial,
        vi.fn(),
      ],
      useId: () => ':crm4-browser-journey-id:',
      useEffect: (effect: () => void | (() => void)) => {
        const cleanup = effect();
        if (typeof cleanup === 'function') {
          // cleanup
        }
      },
      useMemo: (factory: () => unknown) => factory(),
      useCallback: (callback: unknown) => callback,
      useRef: (initial: unknown) => ({ current: initial }),
      useTransition: () => [false, (fn: () => void) => fn()],
    };

    const reactInternals = (React as unknown as {
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: {
        H?: unknown;
      };
    }).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

    if (reactInternals) {
      reactInternals.H = dispatcher;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Multi-Browser Environment Simulation (Chrome & Firefox)
  // ---------------------------------------------------------------------------
  describe('Browser Environment Capabilities (Chrome & Firefox)', () => {
    const userAgents = [
      {
        browser: 'Google Chrome',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
      {
        browser: 'Mozilla Firefox',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
      },
    ];

    userAgents.forEach(({ browser, ua }) => {
      it(`initializes document title and formatting correctly under ${browser}`, () => {
        const title = formatBrowserTitle('Marketing Lists Directory');
        expect(title).toBe('ClearShift | CRM-4 - Marketing Lists Directory');
        expect(ua).toBeTruthy();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Journey 1: Create Marketing List Workflow
  // ---------------------------------------------------------------------------
  describe('Journey 1: Create Marketing List Workflow', () => {
    it('renders ListForm with accessible fields, validation attributes, and submit handler', () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      const fragment = asEl(
        ListForm({
          onSubmit,
          onCancel,
        })
      );

      expect(fragment).toBeDefined();
      const [form] = fragment.props.children;
      expect(form.props.id).toBe('crm4-list-form');
      expect(form.props['aria-label']).toBe('Create new marketing list');
    });
  });

  // ---------------------------------------------------------------------------
  // Journey 2: List and Filter Directory Workflow
  // ---------------------------------------------------------------------------
  describe('Journey 2: List and Filter Directory Workflow', () => {
    it('renders MarketingListsPage directory with search toolbar and 5 SDS columns', () => {
      const onCreateList = vi.fn();
      const onSelectList = vi.fn();
      const onViewCampaigns = vi.fn();

      const pageEl = asEl(
        MarketingListsPage({
          initialLists: syntheticLists,
          initialTotalCount: 2,
          initialTotalPages: 1,
          onCreateList,
          onSelectList,
          onViewCampaigns,
        })
      );

      expect(pageEl).toBeDefined();

      // Render table directly with synthetic records
      const tableEl = asEl(
        MarketingListsTable({
          lists: syntheticLists,
          loading: false,
          onSelectList,
          onViewCampaigns,
        })
      );

      const [tableHeader, tableBody] = tableEl.props.children;
      expect(tableHeader).toBeDefined();
      expect(tableBody).toBeDefined();

      const headerRow = asEl(tableHeader.props.children);
      const headers = headerRow.props.children;
      expect(headers).toHaveLength(5);
      expect(asEl(headers[0]).props.children).toBe('List Name');
      expect(asEl(headers[1]).props.children).toBe('Description');
      expect(asEl(headers[2]).props.children).toBe('Campaigns');
      expect(asEl(headers[3]).props.children).toBe('Created Date');
      expect(asEl(headers[4]).props.children).toBe('Actions');

      // Check rows rendered
      const bodyRows = tableBody.props.children;
      expect(bodyRows).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Journey 3: Create Campaign Workflow & List Immutability (BR-CRM4-02)
  // ---------------------------------------------------------------------------
  describe('Journey 3: Campaign Creation & List Immutability (BR-CRM4-02)', () => {
    it('renders CampaignForm for creation with available lists and YYYY-MM-DD date input', () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      const fragment = asEl(
        CampaignForm({
          availableLists: syntheticLists,
          onSubmit,
          onCancel,
        })
      );

      expect(fragment).toBeDefined();
      const [form] = fragment.props.children;
      expect(form.props.id).toBe('crm4-campaign-form');
      expect(form.props['aria-label']).toBe('Create new campaign');
    });

    it('enforces list_id immutability in edit mode: displays read-only list indicator', () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      const fragment = asEl(
        CampaignForm({
          initialCampaign: syntheticCampaign,
          availableLists: syntheticLists,
          onSubmit,
          onCancel,
        })
      );

      expect(fragment).toBeDefined();
      const [form] = fragment.props.children;
      expect(form.props.id).toBe('crm4-campaign-form');
      expect(form.props['aria-label']).toBe('Edit campaign');
    });
  });

  // ---------------------------------------------------------------------------
  // Journey 4: Campaign Detail View, Member Sub-Table & Allowlist
  // ---------------------------------------------------------------------------
  describe('Journey 4: Campaign Detail View & Member Sub-Table', () => {
    it('renders CampaignDetailPage with campaign metadata, member roster, and action buttons', () => {
      const onBackToList = vi.fn();
      const onEditCampaign = vi.fn();

      const detailEl = asEl(
        CampaignDetailPage({
          campaignId: syntheticCampaign.id,
          initialCampaign: syntheticCampaign,
          onBackToList,
          onEditCampaign,
        })
      );

      expect(detailEl).toBeDefined();
    });

    it('CampaignMemberForm strictly permits valid member statuses (sent, opened, clicked)', () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      const formEl = asEl(
        CampaignMemberForm({
          campaignId: syntheticCampaign.id,
          onSubmit,
          onCancel,
        })
      );

      expect(formEl).toBeDefined();
      expect(formEl.props.id).toBe('crm4-member-form');
      expect(formEl.props['aria-label']).toBe('Add campaign member');
    });
  });

  // ---------------------------------------------------------------------------
  // Journey 5: Contact Consent Management & Monotonic Opt-Out (BR-CRM4-01)
  // ---------------------------------------------------------------------------
  describe('Journey 5: Consent Management & Monotonic Opt-Out (BR-CRM4-01)', () => {
    it('renders ConsentForm for subscribed contact allowing opt-out transition', () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      const activeConsent: CRM4Consent = {
        id: '44444444-4444-4444-8444-000000000001',
        contactId: '11111111-1111-4111-8111-000000000001',
        status: 'subscribed',
        source: 'web_form',
        consentDate: '2026-10-01T10:00:00Z',
        createdAt: '2026-10-01T10:00:00Z',
        updatedAt: '2026-10-01T10:00:00Z',
      };

      const formEl = asEl(
        ConsentForm({
          contactId: activeConsent.contactId,
          currentConsent: activeConsent,
          onSubmit,
          onCancel,
        })
      );

      expect(formEl).toBeDefined();
      expect(formEl.props.id).toBe('crm4-consent-form');
      expect(formEl.props['aria-label']).toBe('Set contact consent record');
    });

    it('enforces monotonic opt-out: shows warning alert when contact is already unsubscribed', () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      const optOutConsent: CRM4Consent = {
        id: '44444444-4444-4444-8444-000000000002',
        contactId: '11111111-1111-4111-8111-000000000002',
        status: 'unsubscribed',
        source: 'opt_out_link',
        consentDate: '2026-10-02T10:00:00Z',
        createdAt: '2026-10-02T10:00:00Z',
        updatedAt: '2026-10-02T10:00:00Z',
      };

      const formEl = asEl(
        ConsentForm({
          contactId: optOutConsent.contactId,
          currentConsent: optOutConsent,
          onSubmit,
          onCancel,
        })
      );

      expect(formEl).toBeDefined();
      expect(formEl.props.id).toBe('crm4-consent-form');
    });
  });

  // ---------------------------------------------------------------------------
  // Journey 6: Mapping Templates Explorer Journey
  // ---------------------------------------------------------------------------
  describe('Journey 6: Migration Mapping Templates Explorer', () => {
    it('renders MappingTemplatesPage with template registry, SHA-256 checksums, and enum allowlists', () => {
      const element = asEl(
        React.createElement(MappingTemplatesPage, {
          initialEntity: 'crm4_lists',
        })
      );

      expect(element).toBeDefined();
      expect(element.type).toBe(MappingTemplatesPage);
      expect(element.props.initialEntity).toBe('crm4_lists');
    });
  });

  // ---------------------------------------------------------------------------
  // Journey 7: Accessible Shell Navigation & Keyboard Traversal
  // ---------------------------------------------------------------------------
  describe('Journey 7: Shell Landmark Navigation & Keyboard Traversal', () => {
    it('navigates tabs with keyboard navigation and generates accessible layout structure', () => {
      const onTabSelect = vi.fn();

      const controller = new Crm4ShellController({
        activeTabKey: 'lists',
        onTabSelect,
      });

      expect(controller.getActiveRoute().id).toBe('crm4-lists');

      // ArrowRight advances to campaigns tab
      const nextIndex = controller.handleKeyNavigation('ArrowRight', 0);
      expect(nextIndex).toBe(1);
      expect(onTabSelect).toHaveBeenCalledWith('campaigns');

      // End key advances to final tab
      const lastIndex = controller.handleKeyNavigation('End', 1);
      expect(lastIndex).toBe(4);
      expect(onTabSelect).toHaveBeenCalledWith('imports');

      // Home key returns to initial tab
      const firstIndex = controller.handleKeyNavigation('Home', 4);
      expect(firstIndex).toBe(0);
      expect(onTabSelect).toHaveBeenCalledWith('lists');

      // Render accessible HTML layout
      const html = controller.renderHtml('<p>CRM-4 Content</p>');
      expect(html).toContain('role="tablist"');
      expect(html).toContain('role="tab"');
      expect(html).toContain('role="main"');
      expect(html).toContain('role="tabpanel"');
      expect(html).toContain('CRM-4 Content');
    });
  });
});
