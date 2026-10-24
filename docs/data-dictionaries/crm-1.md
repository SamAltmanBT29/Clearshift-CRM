# ClearShift CRM — Data Dictionary: CRM-1 Contacts, Companies and Leads

**Module ID:** `CRM-1`
**Module Name:** Contacts, Companies and Leads (Master Data Domain)
**Owning Team:** Team `crm-contacts` (Group 1 — Role 4 Data / QA Lead)
**Schema Version:** 1.0.0
**Storage Engine:** PostgreSQL 18.6 with Drizzle ORM
**Target Milestone:** Gate G1 — Design Complete (Sprint 1)
**Access Pattern:** Authenticated module API `/api/v1/crm-contacts` with EdDSA JWTs & RBAC; Migration Kit in-process Target Adapter for atomic batch writes. Strictly zero direct cross-module SQL mutations.
**Traceability:** ClearShift Project Plan v3.0 §§9.3–9.6, 17; SDS ClearShift CRM v2.0 §4.2, §4.7, §4.11, §4.12; Master Architecture Baseline 1.0-A §4.2; Issue #117 `[CRM1-24]`.

---

## 1. Entity Relationship Overview & Master-Data Ownership

CRM-1 owns the customer and company master data domain across ClearShift. The module maintains 6 core tables in the `crm1` PostgreSQL schema:

```
┌──────────────────────────────────────┐
│           crm1_companies             │
│        (Flat Master Entity)          │
└──────────────────┬───────────────────┘
                   │ 1
                   │
         0..N (FK) │ (ON DELETE RESTRICT)
                   ▼
┌──────────────────────────────────────┐
│           crm1_contacts              │◀─────────────┐
│       (Golden Identity Entity)       │              │
└──────────────────┬───────────────────┘              │
                   │ 1                                │
                   │                                  │
         0..N (FK) │ (ON DELETE RESTRICT)             │
                   ▼                                  │
┌──────────────────────────────────────┐              │
│            crm1_leads                │              │
│       (Sales Prospect Entity)        │              │
└──────────────────────────────────────┘              │
                                                      │
┌──────────────────────────────────────┐              │
│         crm1_import_batches          │              │
│      (Migration Execution State)     │              │
└──────────┬───────────────────────────┘              │
           │ 1                                        │
           ├──────────────────────────┐               │
 0..N (FK) │ (ON DELETE CASCADE)      │ 0..N (FK)     │ (polymorphic target_id)
           ▼                          ▼ (CASCADE)     │
┌─────────────────────────┐  ┌────────────────────────┴────────┐
│   crm1_import_rejects   │  │      crm1_import_receipts       │
│ (Row Rejection Audit)   │  │   (Atomic Durable Receipts)     │
└─────────────────────────┘  └─────────────────────────────────┘
```

### Master-Data Ownership Boundaries (PLT-03):
* **Owner:** Team `crm-contacts` exclusively owns the `crm1` PostgreSQL schema and tables.
* **No Direct External Writes:** The Migration Kit never writes directly to `crm1` tables; all migrations pass through the CRM-1 Target Adapter / API, committing target domain records and durable receipts in a single atomic transaction.
* **No Cross-Schema Foreign Keys:** Cross-module references (e.g. Deals in CRM-2, Tickets in CRM-3, Orders in ERP-3) resolve customer contacts via public CRM-1 APIs and read projections (`contactName`, `companyName`), never direct table joins or SQL writes.

---

## 2. Table Specifications (Field-Level Data Dictionary)

### 2.1 Table: `crm1.crm1_companies`
**Description:** Company master records. Maintained as flat companies in V1 (parent company hierarchies are deferred to V2).

| Column | PostgreSQL Type | Nullable | Default | Constraints | Business Rule | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID generated at creation. | `550e8400-e29b-41d4-a716-446655440000` |
| `name` | `text` | No | — | `crm1_companies_name_nonempty_check`, `crm1_companies_name_search_idx` | Legal or trade company name; trimmed length must be > 0. Indexed lowercase. | `Acme Industrial Solutions Inc` |
| `tax_number` | `text` | Yes | `NULL` | Exact candidate key | Normalized company tax identifier (alphanumeric uppercase). Used for deterministic deduplication. | `US-EIN-987654321` |
| `email` | `text` | Yes | `NULL` | RFC-5322 syntax | Company primary communications email. Normalized lowercase on lookup. | `contact@acmeindustrial.example.com` |
| `phone` | `text` | Yes | `NULL` | — | Primary telephone contact number for company headquarters. | `+1-555-019-2834` |
| `address` | `text` | Yes | `NULL` | Single flat string | Single flat postal address string (street, suite, city, state, postal code, country). | `100 Enterprise Way, Chicago, IL 60601` |
| `source_system` | `text` | Yes | `NULL` | `crm1_companies_source_pair_check`, `crm1_companies_source_key` (UNIQUE) | Originating legacy system identifier; must be paired with `source_id`. | `salesforce_legacy` |
| `source_id` | `text` | Yes | `NULL` | `crm1_companies_source_pair_check`, `crm1_companies_source_key` (UNIQUE) | Stable record primary key in legacy system. The pair `(source_system, source_id)` is globally unique. | `0015000000XyZ1AAAZ` |
| `created_at` | `timestamptz` | No | `now()` | UTC timestamp | Record creation audit timestamp. Set once on initial insert. | `2026-10-23T08:00:00.000Z` |
| `updated_at` | `timestamptz` | No | `now()` | UTC timestamp | Record modification timestamp. Updated automatically on any field change. | `2026-10-23T08:15:00.000Z` |

**Indexes & Checks:**
* `crm1_companies_source_key` ON `(source_system, source_id)` (UNIQUE)
* `crm1_companies_name_search_idx` ON `(lower(name))`
* Check `crm1_companies_name_nonempty_check`: `length(btrim(name)) > 0`
* Check `crm1_companies_source_pair_check`: `(source_system IS NULL AND source_id IS NULL) OR (source_system IS NOT NULL AND source_id IS NOT NULL AND length(btrim(source_system)) > 0 AND length(btrim(source_id)) > 0)`

---

### 2.2 Table: `crm1.crm1_contacts`
**Description:** Golden contact master records. Tracks identity keys, consent state, and company links.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Business Rule | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID primary key. | `a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d` |
| `first_name` | `text` | No | — | `crm1_contacts_first_name_nonempty_check`, `crm1_contacts_name_search_idx` | Contact given name; trimmed length must be > 0. Indexed lowercase with last_name. | `Elena` |
| `last_name` | `text` | No | — | `crm1_contacts_last_name_nonempty_check`, `crm1_contacts_name_search_idx` | Contact family name; trimmed length must be > 0. Indexed lowercase with first_name. | `Rostova` |
| `email` | `text` | Yes | `NULL` | `crm1_contacts_email_search_idx`, Exact candidate key | Contact email address. Exact matches are flagged for human review; no fuzzy auto-merge. | `elena.rostova@example.com` |
| `phone` | `text` | Yes | `NULL` | Combined candidate key | Contact telephone number. Paired with normalized name for compound duplicate evaluation. | `+1-555-014-9988` |
| `address` | `text` | Yes | `NULL` | Single flat string | Contact postal address string. | `742 Evergreen Terrace, Springfield, OR 97477` |
| `company_id` | `uuid` | Yes | `NULL` | Foreign Key `crm1_companies(id)`, `ON DELETE RESTRICT`, Indexed | Optional association to parent company. Cannot delete company while linked contacts exist. | `550e8400-e29b-41d4-a716-446655440000` |
| `lead_status` | `text` | Yes | `NULL` | `crm1_contacts_lead_status_check` | Contact-level sales workflow status. Allowlist: `NULL` or `'New'`, `'Working'`, `'Qualified'`, `'Closed'`. | `Qualified` |
| `golden_id` | `text` | No | — | `crm1_contacts_golden_id_key` (UNIQUE), Check non-empty | Master identity key assigned by Golden ID service. Unique and immutable once created. | `GID-CRM1-2026-9048123` |
| `source_system` | `text` | Yes | `NULL` | `crm1_contacts_source_pair_check`, `crm1_contacts_source_key` (UNIQUE) | Legacy system tag from migration ingest; paired with `source_id`. | `hubspot_crm` |
| `source_id` | `text` | Yes | `NULL` | `crm1_contacts_source_pair_check`, `crm1_contacts_source_key` (UNIQUE) | Unique source record identifier in origin system. The pair is unique. | `hs_contact_884129` |
| `consent_status` | `text` | No | `'unknown'` | Check `unknown`, `granted`, `withdrawn` | Privacy consent state. Non-unknown status requires valid `consent_updated_at`. | `granted` |
| `consent_updated_at` | `timestamptz` | Yes | `NULL` | Monotonic timestamp check | Timestamp of source consent event. Database rejects older/equal timestamp updates. | `2026-10-23T08:00:00.000Z` |
| `unsubscribed` | `boolean` | No | `false` | Monotonic trigger check | Unsubscribe flag (BR-CRM4-01). True requires `unsubscribed_updated_at`; never overwritten by import. | `false` |
| `unsubscribed_updated_at`| `timestamptz` | Yes | `NULL` | Monotonic timestamp check | Timestamp when contact opted out / unsubscribed. | `NULL` |
| `created_at` | `timestamptz` | No | `now()` | UTC timestamp | Record creation audit timestamp. | `2026-10-23T08:00:00.000Z` |
| `updated_at` | `timestamptz` | No | `now()` | UTC timestamp | Record modification audit timestamp. | `2026-10-23T08:15:00.000Z` |

**Indexes & Checks:**
* `crm1_contacts_golden_id_key` ON `(golden_id)` (UNIQUE)
* `crm1_contacts_source_key` ON `(source_system, source_id)` (UNIQUE)
* `crm1_contacts_name_search_idx` ON `(lower(first_name), lower(last_name))`
* `crm1_contacts_email_search_idx` ON `(lower(email))`
* `crm1_contacts_company_id_idx` ON `(company_id)`
* Check `crm1_contacts_lead_status_check`: `lead_status IS NULL OR lead_status IN ('New', 'Working', 'Qualified', 'Closed')`
* Check `crm1_contacts_consent_status_check`: `consent_status IN ('unknown', 'granted', 'withdrawn')`

---

### 2.3 Table: `crm1.crm1_leads`
**Description:** Sales pipeline prospect records linked to a master contact.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Business Rule | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID primary key. | `c3d4e5f6-7a8b-9c0d-1e2f-3a4b5c6d7e8f` |
| `contact_id` | `uuid` | No | — | Foreign Key `crm1_contacts(id)`, `ON DELETE RESTRICT`, Indexed | Mandatory reference to the contact. Orphan leads are prohibited. | `a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d` |
| `status` | `text` | No | — | `crm1_leads_status_check`, Indexed | Forward-only lifecycle: `New -> Working -> Qualified -> Closed`. Regressions return 422. | `New` |
| `source_system` | `text` | Yes | `NULL` | `crm1_leads_source_pair_check`, `crm1_leads_source_key` (UNIQUE) | Legacy system tag for migrated leads. | `pipedrive_source` |
| `source_id` | `text` | Yes | `NULL` | `crm1_leads_source_pair_check`, `crm1_leads_source_key` (UNIQUE) | Origin system lead identifier. | `pd_lead_44901` |
| `created_at` | `timestamptz` | No | `now()` | UTC timestamp | Record creation timestamp. | `2026-10-23T08:00:00.000Z` |
| `updated_at` | `timestamptz` | No | `now()` | UTC timestamp | Record modification timestamp. Updated when status advances. | `2026-10-23T08:10:00.000Z` |

**Indexes & Checks:**
* `crm1_leads_source_key` ON `(source_system, source_id)` (UNIQUE)
* `crm1_leads_contact_id_idx` ON `(contact_id)`
* `crm1_leads_status_idx` ON `(status)`
* Check `crm1_leads_status_check`: `status IN ('New', 'Working', 'Qualified', 'Closed')`

---

### 2.4 Table: `crm1.crm1_import_batches`
**Description:** Persists migration batch state, loaded/rejected counts, and idempotency digests.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Business Rule | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Migration batch correlation identifier. | `b1a2c3d4-0000-4000-8000-111122223333` |
| `source_system` | `text` | No | — | Non-empty check | Origin system name (e.g. `'salesforce'`, `'csv_upload_contacts'`). | `csv_upload_contacts` |
| `status` | `text` | No | `'pending'` | Check enum | Batch state: `'pending'`, `'processing'`, `'completed'`, or `'failed'`. | `completed` |
| `idempotency_key` | `text` | Yes | `NULL` | `crm1_import_batches_idempotency_key` (UNIQUE), Paired check | Caller-supplied request key. Same key + same hash returns original batch; mismatch returns 409. | `idem-crm1-batch-20261023-001` |
| `request_hash` | `text` | Yes | `NULL` | Paired check | Deterministic SHA-256 hash of validated input payload. | `e3b0c44298fc1c149afbf4c8996fb92427ae...` |
| `loaded_count` | `integer` | No | `0` | Check `>= 0` | Committed target records count. Updated atomically with receipts. | `780` |
| `rejected_count` | `integer` | No | `0` | Check `>= 0` | Count of rejected rows stored in rejects table. | `140` |
| `created_at` | `timestamptz` | No | `now()` | Indexed | Batch execution start timestamp. | `2026-10-23T08:00:00.000Z` |
| `updated_at` | `timestamptz` | No | `now()` | UTC timestamp | Last state and counter update timestamp. | `2026-10-23T08:01:30.000Z` |
| `completed_at` | `timestamptz` | Yes | `NULL` | Terminal state timestamp | Execution completion timestamp. | `2026-10-23T08:01:30.000Z` |

---

### 2.5 Table: `crm1.crm1_import_receipts`
**Description:** Durable receipts written atomically with target records. Provides per-row idempotency and audit provenance.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Business Rule | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Surrogate UUID for the receipt. | `d4e5f67a-8b9c-0d1e-2f3a-4b5c6d7e8f9a` |
| `batch_id` | `uuid` | No | — | Foreign Key `crm1_import_batches(id)`, `ON DELETE CASCADE` | Owning migration batch. Pruned on batch cleanup. | `b1a2c3d4-0000-4000-8000-111122223333` |
| `source_row` | `integer` | No | — | Check `> 0` | 1-indexed source row number in input file or stream. | `42` |
| `entity` | `text` | No | — | Check `'contact'`, `'company'`, `'lead'` | Target entity type. | `contact` |
| `source_system` | `text` | No | — | Non-empty check | Origin system tag for audit trail. | `csv_upload_contacts` |
| `source_id` | `text` | No | — | Non-empty check | Legacy identifier or synthetic row key from origin system. | `legacy_row_42` |
| `target_id` | `uuid` | No | — | Indexed | Primary key UUID of created/mutated target domain record. | `a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d` |
| `idempotency_key` | `text` | No | — | `crm1_import_receipts_idempotency_key` (UNIQUE) | Deterministic key: `${batchId}:${sourceRow}:${entity}`. Retries safely skip insertion. | `b1a2c3d4-0000-4000-8000-111122223333:42:contact` |
| `created_at` | `timestamptz` | No | `now()` | UTC timestamp | Timestamp when receipt and target record committed together. | `2026-10-23T08:00:45.000Z` |

---

### 2.6 Table: `crm1.crm1_import_rejects`
**Description:** Audits failed migration rows with reason codes and privacy-safe messages (strictly zero raw PII).

| Column | PostgreSQL Type | Nullable | Default | Constraints | Business Rule | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Surrogate UUID for the rejection audit record. | `e5f67a8b-9c0d-1e2f-3a4b-5c6d7e8f9a0b` |
| `batch_id` | `uuid` | No | — | Foreign Key `crm1_import_batches(id)`, `ON DELETE CASCADE`, Indexed | Owning migration batch identifier. | `b1a2c3d4-0000-4000-8000-111122223333` |
| `source_row` | `integer` | No | — | Check `> 0` | 1-indexed source row number where validation failed. | `87` |
| `entity` | `text` | No | — | Check `'contact'`, `'company'`, `'lead'` | Attempted target entity. | `contact` |
| `reason_code` | `text` | No | — | Non-empty check | Standard machine-readable rejection reason code. | `INVALID_EMAIL` |
| `message` | `text` | No | — | Non-empty check | Privacy-safe diagnostic message explaining reason (no raw PII). | `Email format does not conform to RFC-5322 syntax specification` |
| `created_at` | `timestamptz` | No | `now()` | UTC timestamp | Timestamp when failure was audited. | `2026-10-23T08:00:50.000Z` |

---

## 3. Requirement-to-Test Traceability Matrix Summary

All 12 Must requirements from SDS ClearShift CRM v2.0 §4.2 and platform non-negotiable rules map to automated tests:

| Requirement ID | Summary Description | Test Type | Automated Test Suite | Test File Location |
| :--- | :--- | :---: | :--- | :--- |
| `FR-CRM1-01` | Paged contacts list & search | Contract | `CRM-1 List/Read API & Contracts` | `tests/api/list.test.ts` |
| `FR-CRM1-02` | Validated contact mutations | Regression | `CRM-1 mutation API` | `tests/api/mutations.test.ts` |
| `FR-CRM1-03` | Validated company mutations | Regression | `CRM-1 mutation API` | `tests/api/mutations.test.ts` |
| `FR-CRM1-04` | Contact-company link restrict | Schema | `CRM-1 Drizzle schema constraints` | `tests/db/schema.test.ts` |
| `FR-CRM1-05` | Lead lifecycle allowlist | Unit | `CRM-1 Relationships & Domain Invariants` | `tests/domain/relationships.test.ts` |
| `FR-CRM1-06` | Atomic import execution | Integration | `CRM-1 mutation service & idempotent imports`| `tests/services/crm1-mutation.service.test.ts` |
| `FR-CRM1-07` | Safe reject list with codes | Contract | `CRM-1 List/Read API & Contracts` | `tests/api/list.test.ts` |
| `FR-CRM1-08` | Accessible empty states | Unit | `CRM-1 Frontend Route Registration` | `tests/web/routes.test.ts` |
| `FR-CRM1-10` | Deterministic duplicate review | Unit | `CRM-1 Frontend Route Registration` | `tests/web/routes.test.ts` |
| `FR-CRM1-14` | Import history & counts | Contract | `CRM-1 List/Read API & Contracts` | `tests/api/list.test.ts` |
| `FR-CRM1-16` | Route shell & ARIA landmarks | Unit | `CRM-1 Frontend Route Registration` | `tests/web/routes.test.ts` |
| `FR-CRM1-23` | Append-only audit trail | Security | `CRM-1 Security & Authorization` | `tests/security/authorization.test.ts` |
| `BR-CRM1-DUP-01..03`| Exact key normalizers | Unit | `CRM-1 QA Gate G1 Design Specifications` | `tests/domain/qa-g1-design.test.ts` |
| `SEC-01 / SEC-02` | JWT/RBAC & sensitive masking | Security | `CRM-1 Security & Authorization` | `tests/security/authorization.test.ts` |
| `MIG-01..03` | Conservation & 10% halt | Unit | `CRM-1 QA Gate G1 Design Specifications` | `tests/domain/qa-g1-design.test.ts` |

*Complete matrix details: See [traceability-matrix.md](file:///Users/ajitsingh/Desktop/Clearshift-CRM/apps/crm/modules/crm-1/docs/traceability-matrix.md).*

---

## 4. Dirty Data Pack Plan Summary

The synthetic test fixture strategy specifies exact defect distributions across 100-row and 1,000-row packs with mathematical conservation:

$$\text{source} (1000) = \text{loaded} (780) + \text{rejected} (140) + \text{merged} (80) + \text{skipped} (0) \quad [\text{unaccounted} = 0]$$

| Defect Category | Expected Count (1,000-Pack) | Expected Count (100-Pack) | Reason Code | Expected Outcome |
| :--- | :---: | :---: | :--- | :---: |
| Clean Golden Records | 780 | 74 | None | `loaded` |
| Exact Email Duplicate Candidates | 40 (20 pairs) | 4 (2 pairs) | `EXACT_EMAIL_MATCH` | `merged` (Human Review) |
| Exact Phone + Name Duplicates | 40 (20 pairs) | 4 (2 pairs) | `EXACT_PHONE_NAME_MATCH` | `merged` (Human Review) |
| Malformed RFC-5322 Emails | 35 | 4 | `INVALID_EMAIL` | `rejected` |
| Malformed Phone Numbers | 25 | 2 | `INVALID_PHONE` | `rejected` |
| Omitted Mandatory Names | 30 | 4 | `EMPTY_MANDATORY_FIELD` | `rejected` |
| Blank Company Names | 20 | 2 | `EMPTY_COMPANY_NAME` | `rejected` |
| Referential FK Orphans | 15 | 2 | `REFERENCE_NOT_FOUND` | `rejected` |
| Lead Workflow Violations | 10 | 2 | `INVALID_LEAD_STATUS_TRANSITION` | `rejected` |
| CSV Formula Injections | 3 | 1 | `FORMULA_INJECTION_RISK` | `rejected` |
| Boundary & Encoding Cases | 2 | 1 | `FIELD_TOO_LONG` | `rejected` |

*Complete plan & sample payloads: See [dirty-data-pack-plan.md](file:///Users/ajitsingh/Desktop/Clearshift-CRM/apps/crm/modules/crm-1/docs/dirty-data-pack-plan.md).*

### 4.1 V1 Data Quality Rules & Committed Sample Data (`[CRM1-08]`)

* **Ruleset Version:** 1 (`CRM1-DQ-001` through `CRM1-DQ-019`)
* **Rule Engine Implementation:** [`apps/crm/modules/crm-1/src/migration/rules.ts`](file:///Users/ajitsingh/Desktop/Clearshift-CRM/apps/crm/modules/crm-1/src/migration/rules.ts)
* **Rule Specification Catalogue:** [`apps/crm/modules/crm-1/docs/data-quality-rules.md`](file:///Users/ajitsingh/Desktop/Clearshift-CRM/apps/crm/modules/crm-1/docs/data-quality-rules.md)
* **Committed Sample Fixture:** [`sample-data/crm-1/dirty-data-v1.csv`](file:///Users/ajitsingh/Desktop/Clearshift-CRM/sample-data/crm-1/dirty-data-v1.csv) (100 synthetic rows)
* **Expected Profile Assertions:** [`sample-data/crm-1/expected-profile.json`](file:///Users/ajitsingh/Desktop/Clearshift-CRM/sample-data/crm-1/expected-profile.json) (SHA-256: `23d214a7a308a81c4b867ec7f8907b23d1cdb87c5e24c3c05d4ce9b15d23a6d0`)
* **Canonical Mapping Template:** [`sample-data/crm-1/mapping-template.json`](file:///Users/ajitsingh/Desktop/Clearshift-CRM/sample-data/crm-1/mapping-template.json) (Checksum: `d6e91b238861236b25fa135146765bcecac26ea9aadd1d5378909858c4e735d5`)

### 4.2 V1 Profiling Configuration & Manifest Assertions (`[CRM1-26]`)

* **Profiling Engine:** [`apps/crm/modules/crm-1/src/kit/profiler.ts`](file:///Users/ajitsingh/Desktop/Clearshift-CRM/apps/crm/modules/crm-1/src/kit/profiler.ts)
* **Automated Regression Suite:** [`apps/crm/modules/crm-1/tests/kit/profiler.test.ts`](file:///Users/ajitsingh/Desktop/Clearshift-CRM/apps/crm/modules/crm-1/tests/kit/profiler.test.ts) (21 tests, 97%+ coverage)
* **Profiled Target Table:** `crm1_contacts` (`['crm1_contacts', 'crm1_companies', 'crm1_leads']`)
* **Profiled Columns (15):** `id`, `first_name`, `last_name`, `email`, `phone`, `address`, `company_id`, `company_name`, `lead_status`, `source_system`, `source_id`, `consent_status`, `unsubscribed`, `annual_revenue`, `created_at`
* **Defect Categories (7):**
  1. `EXACT_DUPLICATE`: 8 rows (rows 75–82) — 2 email duplicate pairs + 2 compound phone+name duplicate pairs
  2. `NULL_REQUIRED`: 4 rows (rows 83–86) — missing/whitespace mandatory names
  3. `MALFORMED`: 8 rows (rows 87–94) — invalid RFC-5322 emails (4), non-E.164 phone numbers (2), non-allowlist lead statuses (2)
  4. `FOREIGN_KEY_MISSING`: 2 rows (rows 95–96) — orphan parent company_id UUIDs
  5. `FORMULA_INJECTION_RISK`: 2 rows (rows 97–98) — leading formula tokens (`=`, `+`)
  6. `BOUNDARY_NUMBERS`: 1 row (row 99) — negative revenue violating domain invariant
  7. `FIELD_TOO_LONG`: 1 row (row 100) — string length > 255 chars
* **Row Conservation Balance Sheet:**
  $$\text{source} (100) = \text{loaded} (74) + \text{merged} (8) + \text{rejected} (18) + \text{skipped} (0) \quad [\text{unaccounted} = 0]$$
* **Non-Destructive Operation:** Profiler operates strictly on immutable/frozen input arrays without modifying row objects or cell values.
* **Platform Integration:** Implements `toPlatformProfileReport` mapping module reports directly to `@clearshift/contracts` `ProfileReportSchema`.

---

## 5. Public API Endpoints (`/api/v1/crm-contacts`) & Authorization Matrix

In compliance with SDS ClearShift CRM v2.0 §7.1, endpoints strictly enforce authenticated identity roles (`viewer`, `editor`, `analyst`, `admin`, `migration_runner`) validated via `@cs/identity` asymmetric JWTs (EdDSA). Unauthenticated requests yield HTTP 401; unauthorized roles yield HTTP 403.

| Endpoint | HTTP Method | Allowed Roles | Description |
|---|---|---|---|
| `/health` | `GET` | (public) | Health check and version verification. |
| `/contacts` | `GET` | `viewer`, `editor`, `analyst`, `admin` | Server-paged contacts list (case-insensitive search by name or email, default pageSize 25, max 100). |
| `/contacts/:id` | `GET` | `viewer`, `editor`, `analyst`, `admin` | Retrieve contact by UUID. |
| `/contacts` | `POST` | `editor`, `migration_runner`, `admin` | Create contact (validates companyId and leadStatus). Generates audit event. |
| `/contacts/:id` | `PATCH` | `editor`, `migration_runner`, `admin` | Partial update of contact fields; source identity and Golden ID are server-maintained. |
| `/companies` | `GET` | `viewer`, `editor`, `admin` | Server-paged companies list (search by name, email, or tax number, default pageSize 25, max 100). |
| `/companies/:id` | `GET` | `viewer`, `editor`, `admin` | Retrieve company by UUID. |
| `/companies` | `POST` | `editor`, `migration_runner`, `admin` | Create company. Generates audit event. |
| `/companies/:id` | `PATCH` | `editor`, `migration_runner`, `admin` | Update editable company fields; source identity is server-maintained. |
| `/leads` | `GET` | `viewer`, `editor`, `admin` | Server-paged leads list (search linked contact's name/email, default pageSize 25, max 100). |
| `/leads/:id` | `GET` | `viewer`, `editor`, `admin` | Retrieve lead by UUID. |
| `/leads` | `POST` | `editor`, `migration_runner`, `admin` | Create lead. Generates audit event. |
| `/leads/:id` | `PATCH` | `editor`, `migration_runner`, `admin` | Advance lead status to next allowlist state. Invalid transitions return 422 `INVALID_LEAD_STATUS_TRANSITION`. |
| `/imports` | `POST` | `migration_runner`, `admin` | Initiate migration batch with required batchId, positive per-row sourceRow, and Idempotency-Key. |
| `/imports/:batch` | `GET` | `viewer`, `analyst`, `admin` | Check batch execution status and committed receipts. |
| `/imports/:batch/rejects` | `GET` | `viewer`, `analyst`, `admin` | Retrieve paginated rejected rows for review. |
| `/import/row` | `POST` | `migration_runner`, `admin` | Target Adapter port for KIT-08 row-level mapped ingestion. Commits target mutation and durable receipt atomically with idempotency protection. |
| `/import/receipts` | `GET` | `viewer`, `analyst`, `admin` | List durable import receipts recorded by the Target Adapter. |
| `/import/receipts/:idempotencyKey` | `GET` | `viewer`, `analyst`, `admin` | Retrieve specific durable import receipt by idempotency key. |

---

## 6. Sensitive Fields & Masking Policy

1. **Bank Details**: Masked as `XXXX-XXXX-7890` (preserving only the terminal 4 digits). Shorter values masked completely as `XXXX`.
2. **Salary Information**: Numeric values masked as `XX,XXX` or converted to `"salary hidden"`.
3. **Credentials & Secrets**: Tokens, passwords, and bearer headers are stripped or redacted (`[REDACTED]`).
4. **CSV Formula Injection**: Values starting with `=`, `+`, `-`, `@`, `\t`, or `\r` are escaped with a leading single quote (`'`).
5. **Log Redaction**: System logs and error traces mask account numbers, authorization headers, and raw PII.

---

## 7. Audit Trail Specification

All domain mutations, migration executions, and privileged actions produce append-only audit records containing:
* `actor`: Authenticated User UUID (`sub`) and role set.
* `action`: Action verb (`contact_create`, `contact_update`, `company_create`, `company_update`, `lead_create`, `lead_update`, `import_start`, etc.).
* `timestamp`: ISO-8601 UTC timestamp.
* `entity`: Affected entity name (`contact`, `company`, `lead`, `import_batch`).
* `entity_id`: Primary record UUID.
* `correlation_id`: Request correlation ID or Migration Batch UUID.
* `result`: Outcome status (`success` or `failure`).
* `metadata`: Contextual payload with sensitive fields pre-redacted (no raw rows, tokens, or plaintext credentials).

---

## 8. Frontend Module Routes, Navigation & Layout Shell (CRM1-16)

### Module Route Registration
CRM-1 registers 5 primary sub-views under the common ClearShift layout shell:

| Route Path | View Identifier | Display Title | Nav Label | Required Capability |
| :--- | :--- | :--- | :--- | :--- |
| `/crm-1/contacts` | `crm1-contacts` | Contacts Directory | Contacts | `module.read` |
| `/crm-1/companies` | `crm1-companies` | Companies Directory | Companies | `module.read` |
| `/crm-1/leads` | `crm1-leads` | Leads Pipeline | Leads | `module.read` |
| `/crm-1/duplicates` | `crm1-duplicates` | Exact Duplicate Candidate Review | Duplicate Review | `module.read` |
| `/crm-1/imports` | `crm1-imports` | Import Batches & Receipts | Imports | `module.read` |

### Hub Authentication & Route Guards
* **Session Verification:** Route guards verify the user's active Hub session before allowing access to any module route.
* **Unauthenticated Access:** Unauthenticated requests or expired sessions are intercepted and redirected to `/login?returnUrl=<encoded_path>`.
* **RBAC Authorization:** All module routes require the `module.read` capability. Users lacking this capability are redirected to `/access-denied?required=module.read`.

### Layout Shell & Accessibility Standards
* **ARIA Landmarks:** Employs `<header role="banner">`, `<nav aria-label="Breadcrumb">`, `<nav role="tablist">`, and `<main id="main-content" role="main">` with `<section role="tabpanel">`.
* **Skip Link:** Provides `<a href="#main-content" class="cs-skip-link">Skip to main content</a>` for keyboard accessibility.
* **Keyboard Navigation:** Tab controls support `ArrowLeft`, `ArrowRight`, `Home`, and `End` navigation for full keyboard-driven operation.
* **Title Synchronization:** Dynamically sets `document.title` to `ClearShift | CRM-1 - <View Title>`.

---

## 9. Main Paginated Data Table Specification (CRM1-17)

### Column Schemas & Alignment
The main CRM-1 collection screens implement bounded paginated tables with stable column keys matching the database schema:

- **Contacts (`CONTACTS_COLUMNS`)**: `id`, `firstName`, `lastName`, `email`, `phone`, `companyId`, `leadStatus`, `goldenId`, `consentStatus`, `unsubscribed`, `createdAt`
- **Companies (`COMPANIES_COLUMNS`)**: `id`, `name`, `taxNumber`, `email`, `phone`, `address`, `sourceSystem`, `sourceId`, `createdAt`
- **Leads (`LEADS_COLUMNS`)**: `id`, `contactId`, `status`, `sourceSystem`, `sourceId`, `createdAt`
- **Duplicates (`DUPLICATES_COLUMNS`)**: `id`, `entity`, `matchKey`, `matchType`, `existingId`, `incomingId`, `status`, `detectedAt`
- **Imports (`IMPORTS_COLUMNS`)**: `id`, `sourceSystem`, `status`, `loadedCount`, `rejectedCount`, `createdAt`, `completedAt`

### Bounded Pagination & Server-Side Query Binding
- **Default Page Size**: 25 records (configurable up to `MAX_PAGE_SIZE = 100`).
- **Query Parameter Serialization**: Encodes `page`, `pageSize`, `limit`, `sort`, `order` into API query parameters.
- **Boundaries**: Page clamping prevents out-of-bounds navigation and DOM degradation.

### Sorting Controls & ARIA Landmarks
- **Header Sorting**: Clicking sortable column headers predictably toggles between `asc` and `desc`, resetting the active page to 1.
- **WAI-ARIA Conformance**: Accessible `<table role="table">`, `<th aria-sort="...">`, sort toggle `<button aria-label="Sort by ...">`, and pagination toolbar (`<nav aria-label="Table Pagination">`).

---

## 10. Search, Faceted Filters, and Active Filter Tags (CRM1-18)

### 300ms Keystroke Debouncing Protocol
- **Debounce Delay Window**: Free-text search input enforces an exact 300ms debounce interval (`SEARCH_DEBOUNCE_MS = 300`) to prevent API thrashing and unbounded server queries during fast typing.
- **Immediate Flush**: Pressing the `Enter` key or triggering explicit form submission flushes pending debounce timers immediately without waiting for the 300ms timer to expire.
- **Instant Cancellation & Reset**: Clicking the clear icon (`×`) or pressing `Escape` clears search text, cancels pending timers, and triggers an immediate query update with an empty string.

### Faceted Filter Registry & Query Parameter Mapping
CRM-1 collection views register structured facets mapped bi-directionally to API query parameters:

| View / Collection | Facet Dimension | Query Key | Target Values / Options | API Mapping |
| :--- | :--- | :--- | :--- | :--- |
| **Contacts** | **Lead Status** | `leadStatus` | `New`, `Working`, `Qualified`, `Closed` | `leadStatus=<LeadStatus>` |
| **Contacts** | **Consent** | `consentStatus` | `unknown`, `granted`, `withdrawn` | `consentStatus=<ConsentStatus>` |
| **Contacts** | **Subscription** | `unsubscribed` | `false`, `true` | `unsubscribed=<Boolean>` |
| **Companies** | **Source System** | `sourceSystem` | `hubspot`, `salesforce`, `csv_import`, `manual` | `sourceSystem=<Source>` |
| **Leads** | **Status** | `status` | `New`, `Working`, `Qualified`, `Closed` | `status=<LeadStatus>` |
| **Leads** | **Source System** | `sourceSystem` | `web_form`, `campaign`, `csv_import`, `outreach` | `sourceSystem=<Source>` |
| **Duplicates** | **Entity Type** | `entity` | `contact`, `company` | `entity=<Entity>` |
| **Duplicates** | **Resolution Status** | `status` | `pending`, `merged`, `dismissed` | `status=<ResolutionStatus>` |
| **Imports** | **Batch Status** | `status` | `pending`, `processing`, `completed`, `failed` | `status=<BatchStatus>` |

- **Pagination Reset Invariant**: Modifying any search query or faceted filter dimension immediately resets the active page to 1 (`page = 1`) to eliminate phantom pagination overflows.
- **Bi-directional URL Synchronization**: All active filters serialize to standard URL query parameters (`toQueryParams()` / `toQueryString()`) and hydrate deterministically from `URLSearchParams` (`fromQueryParams()`).

### Active Filter Tag Lifecycle & 'Clear All' Action
- **Active Filter Pill Tags**: When search text or any facet filter is applied, an active filter tag (`.cs-filter-pill`) is displayed containing the facet label and formatted display value (e.g. `Lead Status: Qualified` or `Search: "Sarah"`).
- **Individual Tag Dismissal**: Each pill tag features an accessible dismiss button (`.cs-filter-pill-remove`) with `aria-label="Remove filter: <Label> <Value>"`. Clicking dismiss clears only that specific filter without disturbing other active filters.
- **Bulk 'Clear All' Reset**: When at least one filter or search is active, a 'Clear All' button (`.cs-clear-all-filters-btn`) is displayed. Activating it purges all filters and search state, resetting query parameters and table results in a single atomic transaction.

### Empty Search/Filter State Contract & Reset Recovery
- **Dual Empty-State Contract**:
  1. **System Empty State**: Rendered when zero data exists in the table and no filters/search are applied (e.g. *"No contact records currently exist."*).
  2. **Filtered Empty State (`.cs-empty-filter-state`)**: Rendered when data exists in the system but the current search and filter combination returns zero records (e.g. *"No contacts match your search and filter criteria. Try adjusting your search term or clearing filters."*).
- **Reset Recovery Button**: Filtered empty states prominently render a **"Reset All Filters"** action button (`.cs-empty-reset-btn`) that directly triggers `clearAll()`, providing immediate one-click recovery back to the unfiltered collection view.

---

## 11. Exact Duplicate Key Policies (Deterministic Only)

As mandated by CRM SDS v2.0 and Gate G1 constraints, duplicate evaluation is **strictly deterministic**:
- **Contact Exact Email Key**: Normalized email (`normalizeEmail(email)`: lowercase, trimmed, whitespace stripped).
- **Contact Exact Phone + Name Combined Key**: `${normalizePhone(phone)}#${normalizeName(firstName + ' ' + lastName)}`.
- **Company Exact Tax Number Key**: Normalized tax number (`normalizeTaxNumber(taxNumber)`).
- **Prohibited**: Fuzzy auto-merge and probabilistic scoring are strictly forbidden.
- **Ambiguous Match Policy**: Any candidate matching multiple distinct records returns `AMBIGUOUS_REVIEW_REQUIRED` and requires explicit human review before any merge can proceed.

---

## 12. Lead Status Workflow Transitions (SDS Allowlist)

Permitted state transitions strictly enforce the directed acyclic graph:
- `New` -> `['Working', 'Qualified', 'Closed']`
- `Working` -> `['Qualified', 'Closed']`
- `Qualified` -> `['Closed']`
- `Closed` -> `[]` (Terminal state; no further transitions allowed)

Disallowed transitions (e.g. regressions, skips, or transitions originating from `Closed`) are rejected with HTTP 422 Unprocessable Entity (`INVALID_LEAD_STATUS_TRANSITION`).

---

## 13. Domain Event Taxonomy (Redis Streams & Outbox)

| Event Type | Aggregate | Description | Cross-Module Consumers |
|---|---|---|---|
| `crm.contact.created` | `Contact` | Published when a new golden contact is created. | CRM-2 Deals, CRM-4 Consent |
| `crm.contact.updated` | `Contact` | Published on contact property modification. | CRM-2, CRM-3 |
| `crm.contact.merged` | `Contact` | Published when contacts are merged under human review (EV-08). | CRM-2, CRM-3, CRM-4, ERP-3 |
| `crm.company.created` | `Company` | Published when a company is registered. | CRM-2, ERP-3 |
| `crm.company.updated` | `Company` | Published on company update. | CRM-2, ERP-3 |
| `crm.lead.created` | `Lead` | Published on lead ingestion or capture. | CRM-2 |
| `crm.lead.status_changed` | `Lead` | Published when lead status advances. | CRM-2 |
| `crm.contact.consent_changed` | `Contact` | Published when consent or unsubscribe state mutates (EV-12). | CRM-4 Consent |
| `crm.import.batch_loaded` | `ImportBatch` | Published when migration batch terminates (EV-05). | Migration Kit, CRM-5 |

---

## 14. Deterministic Mock Server (`crm1MockServerPlugin`)

Available in `@clearshift/contracts` for downstream module development and contract testing:
- **State Store**: `Crm1MockStateStore` seeds deterministic synthetic contacts, companies, leads, and import batches.
- **Fastify Plugin**: `crm1MockServerPlugin` serves all 15 endpoints under `/api/v1/crm-contacts` with Zod validation, deterministic error envelopes, duplicate rejection, and lead transition enforcement.

---

## 15. Gate G1 Sign-Off Review

| Sign-Off Role | Signee | Status | Date |
| :--- | :--- | :---: | :---: |
| **Group 1 Role 1** (Team Lead & Core Backend) | Aryaa Bhadane | **APPROVED** | 2026-10-23 |
| **Group 1 Role 4** (Data Reliability & QA Lead) | Data / QA Lead | **APPROVED** | 2026-10-23 |
| **Group 5 Peer Review** (CRM-5 Migration Control) | Peer Review Lead | **APPROVED** | 2026-10-23 |
| **Workstream 12 PMO** (Architecture Baseline) | PMO Lead | **VERIFIED** | 2026-10-23 |

---

## 16. Target Adapter & Migration Kit Integration ([CRM1-07] — Issue #12 / KIT-08)

### Target Adapter Architecture
CRM-1 implements the in-process `TargetAdapter` port specified in `@cs/kit` (`KIT-08` & `Decision C4`):
* **Class**: `Crm1TargetAdapter` (`apps/crm/modules/crm-1/src/migration/target-adapter.ts`)
* **Supported Entities**: `contacts` / `contact`, `companies` / `company`, `leads` / `lead`.
* **Atomic Local Transaction**: Domain mutation (contact/company/lead) and durable import receipt (`crm1_import_receipts`) commit atomically in one PostgreSQL transaction.
* **Idempotency Key Protocol**: Stable composite SHA-256 hash over `batchId + sourceRow + entity + canonicalPayload`.
  - Replay of identical key + payload returns HTTP 200 with `isExisting: true` and prior target ID.
  - Replay of identical key with altered payload/entity returns HTTP 409 Conflict.
* **Transient Infrastructure Failures**: Simulated or transient 503 failures are retryable and never recorded as rejected rows or receipts.
* **Consent Preservation**: Existing consent and unsubscribe suppression state is protected; older import timestamps or false states never overwrite newer consent records.
* **HTTP Endpoints**: Exposed under `/api/v1/crm-contacts/import/row` and `/api/v1/crm-contacts/import/receipts`.

---

## 17. UI Presentation States & Error Sanitization (CRM1-19)

Governs standard UI visual states across all CRM-1 entity tables and pages (`ContactsListPage`, `CompaniesListPage`, `LeadsPipelinePage`, `DuplicateReviewPage`, `ImportsOverviewPage`).

### 17.1 State Hierarchy & Dispatch Matrix

| Priority | State Condition | Visual Component | Accessibility / ARIA | Interactive Controls |
| :---: | :--- | :--- | :--- | :--- |
| 1 | 403 Forbidden / Missing Permission | `AccessDeniedView` | `role="region"`, `aria-labelledby="cs-access-denied-title"`, icon `aria-hidden="true"` | Primary CTA button (`Return to Safe Area` or custom `actionLabel`) |
| 2 | Error (API failure, network abort) | `ErrorAlert` | `role="alert"`, `aria-live="assertive"`, dismissible banner | Primary `Retry` button (`aria-label="Retry operation"`), optional secondary action |
| 3 | Initial or Active Fetching | `TableSkeleton` | `role="status"`, `aria-busy="true"`, `aria-label="Loading content..."` | Animated shimmering placeholders for toolbar, headers, and body rows |
| 4 | Empty (Zero total records or filtered out) | `EmptyState` | `role="status"`, semantic header and description | Primary CTA button (`actionLabel` / `onAction`), secondary CTA or reset filters |
| 5 | Normal Populated Data | `DataTable` | `role="table"`, sorting headers (`aria-sort`), paginator (`aria-label="Table Pagination"`) | Column sorting, search filter, page navigation, record actions |

### 17.2 Error Message Sanitization Standard

All error payloads rendered in user-facing components (`ErrorAlert`, `DataTableController`) MUST pass through `sanitizeErrorMessage()` before presentation:
- **Stack Traces**: Strips any trailing lines containing `at functionName (path/to/file.ts:line:col)`.
- **File System Paths**: Strips absolute or relative paths matching `(/[\w.-]+)+:\d+:\d+`.
- **Database / Internal Diagnostics**: Masks SQL queries, syntax errors, and database connection strings into human-readable messages (`"An unexpected error occurred while communicating with the server."`).
- **Sanitized Fallback**: Null, undefined, empty, or whitespace-only messages fall back to `"An unexpected error occurred. Please try again."`.

---

## 18. Exact Duplicate Key Policy & Human Review Audit Trail ([CRM1-12] — Issue #105 / KIT-10)

Governs deterministic exact duplicate matching, candidate detection, and authorized human merge resolution across contacts, companies, and leads.

### 18.1 Deterministic Key Normalization Rules

| Key Type | Target Entity | Normalization Formula | Duplicate Grouping Invariant |
| :--- | :--- | :--- | :--- |
| `email` | `crm1_contacts` | `normalizeEmail(email)` (trimmed, lowercase) | Identical email yields exact match candidate |
| `phone_name` | `crm1_contacts` | `${normalizePhone(phone)}#${normalizeName(first + " " + last)}` | Normalized phone + name composite key |
| `tax_number` / `tax_id` | `crm1_companies` | `normalizeTaxNumber(taxNumber)` (uppercase, stripped punctuation/spaces) | Company tax identifier exact match |
| `phone` | `crm1_contacts` | `normalizePhone(phone)` (stripped non-digits, preserved `+`) | Deterministic telephone key |
| `sku` | Shared reference | `normalizeSku(sku)` (uppercase, single-spaced) | Exact SKU matching |

### 18.2 Invariants & Human Review Policy

1. **Deterministic Grouping**: Identical normalized keys partition records into unique entries versus held duplicate candidates.
2. **Strict Prohibition of Fuzzy Auto-Merge**: Automatic fuzzy or unreviewed merging is strictly forbidden in ClearShift V1. If `autoMerge: true` is requested, the system throws `AutoMergeForbiddenError` (HTTP 422).
3. **Review Queue**: All duplicate candidates are held in `held_for_review` state pending authorized human review.
4. **Merge Decision Invariants**:
   - For `MERGE` decisions, `keptId !== mergedId` is strictly asserted (rejects self-merge with HTTP 400).
   - `keptId` and `mergedId` must be valid member record IDs of the candidate group.
   - `actorId` and `reason` are mandatory.
5. **Immutable Audit Trail**: Every human review decision durably captures actor ID, timestamp, kept ID, merged ID, reason code, and normalized key.

### 18.3 API Endpoints & Role Access Matrix

| Endpoint | Method | Allowed Roles | Description |
| :--- | :---: | :--- | :--- |
| `/api/v1/crm-contacts/duplicates/detect` | `POST` | `analyst`, `migration_runner`, `admin` | Detects candidates; returns unique records and held groups. Throws 422 on auto-merge. |
| `/api/v1/crm-contacts/duplicates/held` | `GET` | `viewer`, `analyst`, `editor`, `admin` | Lists candidate groups held for human review. |
| `/api/v1/crm-contacts/duplicates/resolve` | `POST` | `editor`, `analyst`, `admin` | Records human merge decision and emits immutable audit log entry. |
| `/api/v1/crm-contacts/duplicates/audit` | `GET` | `viewer`, `analyst`, `admin` | Queries paginated audit trail of human merge decisions. |
| `/api/v1/crm-contacts/duplicates/evaluate/contact` | `POST` | `analyst`, `migration_runner`, `admin` | Evaluates contact candidate against existing database contacts. |
| `/api/v1/crm-contacts/duplicates/evaluate/company` | `POST` | `analyst`, `migration_runner`, `admin` | Evaluates company candidate against existing database companies. |

---

## 19. Chunked Batch Ingestion & 10% Partial-Load Stop Policy ([CRM1-13] — Issue #106 / KIT-12)

Governs high-throughput batch ingestion, chunked processing, bounded exponential backoff retries, idempotent receipt preservation, and immediate batch halting when row failure rate exceeds the 10% threshold.

### 19.1 Batch Ingestion Execution Invariants

| Invariant | Specification | Enforcement Mechanism |
| :--- | :--- | :--- |
| **Chunk Size** | Process records in chunks of 500 rows (`CRM1_DEFAULT_CHUNK_SIZE = 500`, bounded [1, 1000]). | `chunkArray(records, chunkSize)` slices inputs into isolated chunks. |
| **Bounded Retry** | Transient row errors retry up to 3 times (`CRM1_DEFAULT_MAX_RETRIES = 3`, bounded [0, 5]) with bounded exponential backoff: `min(1000, 50 * 2^(attempt - 1))`. | `executeCrm1ChunkedBatchLoad` retries transient failures and preserves unchanged idempotency key. |
| **Failure Rate Threshold** | Batch halts immediately when failure rate exceeds 10% (`CRM1_DEFAULT_FAILURE_THRESHOLD = 0.10`) after minimum 50 attempted rows (`CRM1_DEFAULT_MIN_ATTEMPTED_ROWS = 50`). | `shouldHaltBatch(failed, attempted, threshold, minRows)` triggers `BatchLoadHaltedError`. |
| **Durable Partial Commits** | Committed rows and receipts prior to halt remain durable in the ledger; no rollback saga or destructive uncommitted data loss occurs. | Terminal batch state is `STOPPED_EXCESSIVE_FAILURES` with complete audit receipts. |
| **Zero Fuzzy Auto-Merge** | Exact normalized key matching only; ambiguous records are rejected or held for human review. | Strict deterministic validation via domain processor. |

### 19.2 Batch Execution Status Transitions

```
[ PENDING ] ──> [ IN_PROGRESS ] ──> ( All chunks completed ) ────────────> [ COMPLETED ]
                       │
                       └──> ( Failures > 10% after >= 50 attempted rows ) ──> [ STOPPED_EXCESSIVE_FAILURES ]
                       │
                       └──> ( Fatal unhandled exception ) ─────────────────> [ FAILED ]
```

### 19.3 API Endpoints & Role Access Matrix

| Endpoint | Method | Allowed Roles | Required Capability | Description |
| :--- | :---: | :--- | :--- | :--- |
| `/api/v1/crm-contacts/batches/execute-load` | `POST` | `migration_runner`, `admin` | `KIT_RUN` | Executes chunked batch ingestion with bounded retries and 10% stop policy. |
| `/api/v1/crm-contacts/batches/:batchId/report` | `GET` | `viewer`, `analyst`, `admin` | `KIT_READ` | Retrieves durable execution report, receipts, and failed rows. |
| `/api/v1/crm-contacts/import/batch` | `POST` | `migration_runner`, `admin` | `KIT_RUN` | Compatibility alias for batch load execution. |

---

## 20. Human-Operated Create, Edit & Detail Workflows ([CRM1-05] — Issue #10 / SDS §4.2)

Governs frontend forms, validation contracts, read-only field invariants, and navigation workflows for Contacts, Companies, Leads, and Import/Reject views.

### 20.1 Screen Inventory & Navigation Hierarchy

| Entity | List Screen | Create / Edit Form | Detail Screen | Key Invariants |
| :--- | :--- | :--- | :--- | :--- |
| **Contacts** | `ContactsListPage` | `ContactFormPage` / `ContactForm` | `ContactDetailPage` | First/Last name required; optional valid email, phone, address; company link must be valid UUID; Golden ID & consent/unsubscribe are read-only. |
| **Companies** | `CompaniesListPage` | `CompanyFormPage` / `CompanyForm` | `CompanyDetailPage` | Name required; tax number normalized; corporate email format; flat company structure in V1 (no hierarchy/parent company selector). |
| **Leads** | `LeadsPipelinePage` | `LeadFormPage` / `LeadForm` | `LeadDetailPage` | Contact UUID required; status transitions strictly follow `New -> Working -> Qualified -> Closed` allowlist. |
| **Imports** | `ImportsOverviewPage` | Migration Kit Ingestion | `ImportDetailPage` | Read-only audit review of committed receipts and filterable rejected rows with reason codes. |

### 20.2 Field Contracts & Authoritative Validation Rules

- **`CRM1_FIELD_CONTRACT`**: Guarantees synchronized labels, helper texts, and error messages between OpenAPI and React forms.
- **Client Validation & Server Authority**: Client validation gives immediate feedback on blur/submit; server validation remains authoritative and field-level error summaries are presented without losing form input state.
- **Read-Only Invariants**: System-computed fields (Golden ID, `source_system`/`source_id`, creation/modification timestamps, loaded/rejected counts) cannot be modified or bypassed via browser manipulation.
- **Safe Operator Confirmations**: Discarding unsaved changes triggers an accessible `ConfirmModal` (`role="alertdialog"`) preventing accidental data loss.
