import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CRM4List, CRM4Campaign, CRM4Member, CRM4Consent } from '../../packages/contracts/src/crm-4.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIRTY_CSV_PATH = path.join(__dirname, 'dirty-data-v1.csv');

export interface CRM4SeedSummary {
  listsCount: number;
  campaignsCount: number;
  membersCount: number;
  consentsCount: number;
  persistedToDb: boolean;
}

/**
 * Deterministic synthetic marketing lists.
 */
export const SYNTHETIC_LISTS: CRM4List[] = [
  {
    id: '44444444-1111-4444-8444-000000000001',
    name: 'Q1 Enterprise Outreach',
    description: 'Tier-1 enterprise strategic accounts for Q1 outreach',
    campaignCount: 2,
    memberCount: 3,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: '44444444-1111-4444-8444-000000000002',
    name: 'Product Beta Advocates',
    description: 'Early beta champions and power users',
    campaignCount: 1,
    memberCount: 2,
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
  },
  {
    id: '44444444-1111-4444-8444-000000000003',
    name: 'EMEA Partner Channel',
    description: 'Regional certified systems integrators in Europe',
    campaignCount: 1,
    memberCount: 0,
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z',
  },
  {
    id: '44444444-1111-4444-8444-000000000004',
    name: 'APAC High Growth Accounts',
    description: 'Fastest growing commercial accounts in APAC region',
    campaignCount: 1,
    memberCount: 0,
    createdAt: '2026-10-04T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:00.000Z',
  },
  {
    id: '44444444-1111-4444-8444-000000000005',
    name: 'Cloud Migration Webinar Attendees',
    description: 'Registered attendees for infrastructure migration sessions',
    campaignCount: 1,
    memberCount: 0,
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
  },
  {
    id: '44444444-1111-4444-8444-000000000006',
    name: 'Developers Ecosystem',
    description: 'API developers, open source contributors, and integrations leads',
    campaignCount: 1,
    memberCount: 0,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
  },
  {
    id: '44444444-1111-4444-8444-000000000007',
    name: 'Executive Round Table 2026',
    description: 'C-level executives invited to the annual briefing',
    campaignCount: 1,
    memberCount: 0,
    createdAt: '2026-10-07T00:00:00.000Z',
    updatedAt: '2026-10-07T00:00:00.000Z',
  },
  {
    id: '44444444-1111-4444-8444-000000000008',
    name: 'Customer Advisory Board',
    description: 'Governance and feedback board members',
    campaignCount: 1,
    memberCount: 0,
    createdAt: '2026-10-08T00:00:00.000Z',
    updatedAt: '2026-10-08T00:00:00.000Z',
  },
  {
    id: '44444444-1111-4444-8444-000000000009',
    name: 'Security Leadership Forum',
    description: 'CISOs and security compliance directors',
    campaignCount: 1,
    memberCount: 0,
    createdAt: '2026-10-09T00:00:00.000Z',
    updatedAt: '2026-10-09T00:00:00.000Z',
  },
  {
    id: '44444444-1111-4444-8444-000000000010',
    name: 'Fintech Innovation Circle',
    description: 'Financial institutions and regulatory technology leads',
    campaignCount: 1,
    memberCount: 0,
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
  },
];

/**
 * Deterministic synthetic marketing campaigns.
 */
export const SYNTHETIC_CAMPAIGNS: CRM4Campaign[] = [
  {
    id: '44444444-2222-4444-8444-000000000001',
    name: 'Q1 Launch Blitz',
    campaignDate: '2026-11-01',
    listId: '44444444-1111-4444-8444-000000000001',
    listName: 'Q1 Enterprise Outreach',
    memberCount: 3,
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
  },
  {
    id: '44444444-2222-4444-8444-000000000002',
    name: 'Beta Feedback Drive',
    campaignDate: '2026-11-15',
    listId: '44444444-1111-4444-8444-000000000002',
    listName: 'Product Beta Advocates',
    memberCount: 2,
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
  },
  {
    id: '44444444-2222-4444-8444-000000000003',
    name: 'EMEA Quarterly Meetup',
    campaignDate: '2026-11-20',
    listId: '44444444-1111-4444-8444-000000000003',
    listName: 'EMEA Partner Channel',
    memberCount: 0,
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
  },
  {
    id: '44444444-2222-4444-8444-000000000004',
    name: 'APAC Partner Summit',
    campaignDate: '2026-11-25',
    listId: '44444444-1111-4444-8444-000000000004',
    listName: 'APAC High Growth Accounts',
    memberCount: 0,
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
  },
  {
    id: '44444444-2222-4444-8444-000000000005',
    name: 'Webinar Followup Sequence',
    campaignDate: '2026-12-01',
    listId: '44444444-1111-4444-8444-000000000005',
    listName: 'Cloud Migration Webinar Attendees',
    memberCount: 0,
    createdAt: '2026-10-14T00:00:00.000Z',
    updatedAt: '2026-10-14T00:00:00.000Z',
  },
  {
    id: '44444444-2222-4444-8444-000000000006',
    name: 'Developer Hackathon Invite',
    campaignDate: '2026-12-05',
    listId: '44444444-1111-4444-8444-000000000006',
    listName: 'Developers Ecosystem',
    memberCount: 0,
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
  },
  {
    id: '44444444-2222-4444-8444-000000000007',
    name: 'Roundtable Briefing',
    campaignDate: '2026-12-10',
    listId: '44444444-1111-4444-8444-000000000007',
    listName: 'Executive Round Table 2026',
    memberCount: 0,
    createdAt: '2026-10-16T00:00:00.000Z',
    updatedAt: '2026-10-16T00:00:00.000Z',
  },
  {
    id: '44444444-2222-4444-8444-000000000008',
    name: 'Advisory Board Pre-read',
    campaignDate: '2026-12-15',
    listId: '44444444-1111-4444-8444-000000000008',
    listName: 'Customer Advisory Board',
    memberCount: 0,
    createdAt: '2026-10-17T00:00:00.000Z',
    updatedAt: '2026-10-17T00:00:00.000Z',
  },
  {
    id: '44444444-2222-4444-8444-000000000009',
    name: 'Security Whitepaper Release',
    campaignDate: '2026-12-20',
    listId: '44444444-1111-4444-8444-000000000009',
    listName: 'Security Leadership Forum',
    memberCount: 0,
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
  },
  {
    id: '44444444-2222-4444-8444-000000000010',
    name: 'Fintech Regulatory Update',
    campaignDate: '2026-12-28',
    listId: '44444444-1111-4444-8444-000000000010',
    listName: 'Fintech Innovation Circle',
    memberCount: 0,
    createdAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-19T00:00:00.000Z',
  },
];

/**
 * Deterministic synthetic contact consents.
 */
export const SYNTHETIC_CONSENTS: CRM4Consent[] = [
  {
    id: '44444444-4444-4444-8444-000000000001',
    contactId: '11111111-1111-4111-8111-000000000001',
    status: 'subscribed',
    consentDate: '2026-10-01T00:00:00.000Z',
    source: 'web_form',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: '44444444-4444-4444-8444-000000000002',
    contactId: '11111111-1111-4111-8111-000000000002',
    status: 'unsubscribed', // BR-CRM4-01 target
    consentDate: '2026-10-02T00:00:00.000Z',
    source: 'unsubscribe_link',
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
  },
  {
    id: '44444444-4444-4444-8444-000000000003',
    contactId: '11111111-1111-4111-8111-000000000003',
    status: 'subscribed',
    consentDate: '2026-10-03T00:00:00.000Z',
    source: 'csv_import',
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z',
  },
  {
    id: '44444444-4444-4444-8444-000000000004',
    contactId: '11111111-1111-4111-8111-000000000004',
    status: 'unsubscribed', // BR-CRM4-01 target
    consentDate: '2026-10-04T00:00:00.000Z',
    source: 'customer_support_optout',
    createdAt: '2026-10-04T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:00.000Z',
  },
  {
    id: '44444444-4444-4444-8444-000000000005',
    contactId: '11111111-1111-4111-8111-000000000005',
    status: 'subscribed',
    consentDate: '2026-10-05T00:00:00.000Z',
    source: 'sales_call',
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
  },
];

/**
 * Deterministic synthetic campaign members.
 */
export const SYNTHETIC_MEMBERS: CRM4Member[] = [
  {
    id: '44444444-3333-4444-8444-000000000001',
    campaignId: '44444444-2222-4444-8444-000000000001',
    contactId: '11111111-1111-4111-8111-000000000001',
    status: 'sent',
    unsubscribed: false,
    createdAt: '2026-10-15T00:00:00.000Z',
  },
  {
    id: '44444444-3333-4444-8444-000000000002',
    campaignId: '44444444-2222-4444-8444-000000000001',
    contactId: '11111111-1111-4111-8111-000000000002',
    status: 'opened',
    unsubscribed: true,
    createdAt: '2026-10-15T00:00:00.000Z',
  },
  {
    id: '44444444-3333-4444-8444-000000000003',
    campaignId: '44444444-2222-4444-8444-000000000001',
    contactId: '11111111-1111-4111-8111-000000000003',
    status: 'clicked',
    unsubscribed: false,
    createdAt: '2026-10-15T00:00:00.000Z',
  },
  {
    id: '44444444-3333-4444-8444-000000000004',
    campaignId: '44444444-2222-4444-8444-000000000002',
    contactId: '11111111-1111-4111-8111-000000000004',
    status: 'sent',
    unsubscribed: true,
    createdAt: '2026-10-16T00:00:00.000Z',
  },
  {
    id: '44444444-3333-4444-8444-000000000005',
    campaignId: '44444444-2222-4444-8444-000000000002',
    contactId: '11111111-1111-4111-8111-000000000005',
    status: 'clicked',
    unsubscribed: false,
    createdAt: '2026-10-16T00:00:00.000Z',
  },
];

/**
 * Seeds CRM-4 synthetic data into database or in-memory fixtures.
 */
export async function seedCrm4Data(options: { reset?: boolean } = {}): Promise<CRM4SeedSummary> {
  const { reset = false } = options;
  let persistedToDb = false;

  const dbUrl = process.env['DATABASE_URL_TEST'] || process.env['DATABASE_URL'];

  if (dbUrl) {
    try {
      const { drizzle } = await import('drizzle-orm/node-postgres');
      const pg = await import('pg');
      const { crm4Lists, crm4Campaigns, crm4Members, crm4Consents } = await import(
        '../../apps/crm/modules/crm-4/db/schema.js'
      );

      const pool = new pg.default.Pool({ connectionString: dbUrl });
      const db = drizzle(pool);

      if (reset) {
        await db.delete(crm4Members);
        await db.delete(crm4Consents);
        await db.delete(crm4Campaigns);
        await db.delete(crm4Lists);
      }

      // Upsert lists
      for (const list of SYNTHETIC_LISTS) {
        await db
          .insert(crm4Lists)
          .values({
            id: list.id,
            name: list.name,
            description: list.description,
            campaignCount: list.campaignCount,
            memberCount: list.memberCount,
            createdAt: new Date(list.createdAt),
            updatedAt: new Date(list.updatedAt),
          })
          .onConflictDoNothing();
      }

      // Upsert campaigns
      for (const camp of SYNTHETIC_CAMPAIGNS) {
        await db
          .insert(crm4Campaigns)
          .values({
            id: camp.id,
            name: camp.name,
            campaignDate: camp.campaignDate,
            listId: camp.listId,
            memberCount: camp.memberCount,
            createdAt: new Date(camp.createdAt),
            updatedAt: new Date(camp.updatedAt),
          })
          .onConflictDoNothing();
      }

      // Upsert consents
      for (const consent of SYNTHETIC_CONSENTS) {
        await db
          .insert(crm4Consents)
          .values({
            id: consent.id,
            contactId: consent.contactId,
            status: consent.status,
            consentDate: new Date(consent.consentDate),
            source: consent.source,
            createdAt: new Date(consent.createdAt),
            updatedAt: new Date(consent.updatedAt),
          })
          .onConflictDoNothing();
      }

      // Upsert members
      for (const member of SYNTHETIC_MEMBERS) {
        await db
          .insert(crm4Members)
          .values({
            id: member.id,
            campaignId: member.campaignId,
            contactId: member.contactId,
            status: member.status,
            unsubscribed: member.unsubscribed,
            createdAt: new Date(member.createdAt),
          })
          .onConflictDoNothing();
      }

      await pool.end();
      persistedToDb = true;
    } catch {
      persistedToDb = false;
    }
  }

  return {
    listsCount: SYNTHETIC_LISTS.length,
    campaignsCount: SYNTHETIC_CAMPAIGNS.length,
    membersCount: SYNTHETIC_MEMBERS.length,
    consentsCount: SYNTHETIC_CONSENTS.length,
    persistedToDb,
  };
}

// CLI Execution entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isReset = process.argv.includes('--reset');
  console.log(`\n🌱 [CRM-4] Starting deterministic seed${isReset ? ' (with reset)' : ''}...`);

  seedCrm4Data({ reset: isReset })
    .then((summary) => {
      console.log('✅ [CRM-4] Deterministic seed completed successfully!');
      console.log(`   - Marketing Lists           : ${summary.listsCount}`);
      console.log(`   - Marketing Campaigns       : ${summary.campaignsCount}`);
      console.log(`   - Campaign Memberships      : ${summary.membersCount}`);
      console.log(`   - Contact Consents          : ${summary.consentsCount}`);
      console.log(
        `   - Persisted to PostgreSQL   : ${summary.persistedToDb ? 'YES' : 'IN-MEMORY / FIXTURE MODE'}`
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ [CRM-4] Seeding failed:', err);
      process.exit(1);
    });
}
