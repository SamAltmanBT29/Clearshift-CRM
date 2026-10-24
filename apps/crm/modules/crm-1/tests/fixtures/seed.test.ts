import { describe, it, expect } from 'vitest';
import {
  verifyDirtyDataPacks,
  seedCrm1Data,
  CANONICAL_COMPANIES,
  CANONICAL_CONTACTS,
  CANONICAL_LEADS,
  CANONICAL_BATCH,
  CANONICAL_RECEIPTS,
  CANONICAL_REJECTS,
} from '../../../../../../sample-data/crm-1/seed.js';

describe('CRM-1 Deterministic Seeder & Dirty Data Pack Verification (Issue #15 / [CRM1-10])', () => {
  describe('1. Static Fixture Integrity & Checksum Verification', () => {
    it('verifies dirty data packs exist and match expected profile hashes', () => {
      const result = verifyDirtyDataPacks();
      expect(result.valid).toBe(true);
      expect(result.dirtyPackSha256).toBe('a87d39a0f1432eb5e6a12c639b3f82f80d01a542802275dfd658c54cccb77062');
      expect(result.dirtyDataV1Sha256).toBe('23d214a7a308a81c4b867ec7f8907b23d1cdb87c5e24c3c05d4ce9b15d23a6d0');
    });

    it('asserts canonical companies conform to V1 flat master structure', () => {
      expect(CANONICAL_COMPANIES).toHaveLength(5);
      for (const company of CANONICAL_COMPANIES) {
        expect(company.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(company.name.trim().length).toBeGreaterThan(0);
        expect(company.tax_number).toBeTruthy();
        expect(company.source_system).toBe('CRM1-SEED');
      }
    });

    it('asserts canonical contacts exceed default page size (27 > 25) for server paging', () => {
      expect(CANONICAL_CONTACTS.length).toBe(27);
      expect(CANONICAL_CONTACTS.length).toBeGreaterThan(25);

      for (const contact of CANONICAL_CONTACTS) {
        expect(contact.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(contact.first_name.trim().length).toBeGreaterThan(0);
        expect(contact.last_name.trim().length).toBeGreaterThan(0);
        expect(contact.golden_id).toMatch(/^GLD-CRM1-/);

        // Consent timestamp invariant: if consent is not 'unknown', timestamp must exist
        if (contact.consent_status !== 'unknown') {
          expect(contact.consent_updated_at).not.toBeNull();
        } else {
          expect(contact.consent_updated_at).toBeNull();
        }

        // Unsubscribe timestamp invariant: if unsubscribed is true, timestamp must exist
        if (contact.unsubscribed) {
          expect(contact.unsubscribed_updated_at).not.toBeNull();
        }
      }
    });

    it('includes cross-module contact IDs referenced by CRM-2 deals', () => {
      const contactIds = new Set(CANONICAL_CONTACTS.map((c) => c.id));
      expect(contactIds.has('10000000-0000-4000-8000-000000000001')).toBe(true);
      expect(contactIds.has('10000000-0000-4000-8000-000000000002')).toBe(true);
      expect(contactIds.has('90000000-0000-4000-8000-000000000001')).toBe(true);
      expect(contactIds.has('90000000-0000-4000-8000-000000000002')).toBe(true);
    });

    it('asserts canonical leads conform to valid V1 status allowlist', () => {
      expect(CANONICAL_LEADS).toHaveLength(4);
      const allowedStatuses = new Set(['New', 'Working', 'Qualified', 'Closed']);
      for (const lead of CANONICAL_LEADS) {
        expect(lead.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(lead.contact_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(allowedStatuses.has(lead.status)).toBe(true);
      }
    });

    it('verifies audit batch, receipts, and reject fixtures', () => {
      expect(CANONICAL_BATCH.id).toBeDefined();
      expect(CANONICAL_RECEIPTS.length).toBeGreaterThan(0);
      expect(CANONICAL_REJECTS.length).toBeGreaterThan(0);
    });
  });

  describe('2. In-Memory / Fixture-Only Seeding Execution', () => {
    it('executes safely when no database is configured', async () => {
      const summary = await seedCrm1Data({ fixtureOnly: true, silent: true });
      expect(summary.checksumsVerified).toBe(true);
      expect(summary.companiesCount).toBe(5);
      expect(summary.contactsCount).toBe(27);
      expect(summary.leadsCount).toBe(4);
      expect(summary.dirtyDataRows).toBe(100);
      expect(summary.persistedToDb).toBe(false);
    });
  });

  const testDbUrl = process.env['DATABASE_URL_TEST'];
  const dbSuite = testDbUrl ? describe : describe.skip;

  dbSuite('3. Live PostgreSQL Seeding and Deterministic Reset', () => {
    it('executes deterministic seed with reset and persists all entities to database', async () => {
      const summary = await seedCrm1Data({
        databaseUrl: testDbUrl,
        reset: true,
        silent: true,
      });

      expect(summary.persistedToDb).toBe(true);
      expect(summary.companiesCount).toBe(5);
      expect(summary.contactsCount).toBe(27);
      expect(summary.leadsCount).toBe(4);
      expect(summary.batchesCount).toBe(1);
      expect(summary.receiptsCount).toBe(2);
      expect(summary.rejectsCount).toBe(1);
    });

    it('demonstrates idempotency when executed twice without reset', async () => {
      const secondRun = await seedCrm1Data({
        databaseUrl: testDbUrl,
        reset: false,
        silent: true,
      });

      expect(secondRun.persistedToDb).toBe(true);
      // No new records should be inserted due to ON CONFLICT DO NOTHING
      expect(secondRun.companiesCount).toBe(0);
      expect(secondRun.contactsCount).toBe(0);
      expect(secondRun.leadsCount).toBe(0);
    });
  });
});
