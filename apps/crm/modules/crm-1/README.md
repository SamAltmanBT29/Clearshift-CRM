# ClearShift CRM — Module CRM-1: Contacts, Companies and Leads

**Module ID:** `CRM-1`  
**Package:** `@clearshift/mod-crm1`  
**Milestone:** Gate G4 Release Candidate (Weeks 7–8)  
**Traceability:** ClearShift Project Plan v3.0 §7.1, §9.3–9.6, §17; SDS ClearShift CRM v2.0 §4.2, §4.7, §4.11, §4.12; Master Architecture Baseline 1.0-A §4.2; FR-CRM1-01..08; Issue #15, #117, #118, #122.

---

## 1. Module Overview & Architectural Role

Module **CRM-1 ("Contacts, Companies and Leads")** is the core master data foundation of ClearShift V1. It provides authoritative storage, business validation, and public APIs for customer identities, flat corporate accounts, forward-only sales leads, and atomic migration ingestion through the shared Migration Kit (KIT-08).

### Pinned Stack Governance:
- **Runtime:** Node.js 24 LTS patch
- **Language:** Strict TypeScript (ESM)
- **API Framework:** Fastify 5 + Zod OpenAPI validation
- **Database:** PostgreSQL 18.6 with Drizzle ORM (`crm1` schema)
- **Security:** Shared JWT verification (`@cs/identity`) and role-based access control (`@cs/rbac`)
- **Shared UI:** React 19 + Shared component primitives (`@clearshift/ui`)

### Master-Data Ownership Boundaries (PLT-03):
- **Exclusive Schema Ownership:** The `crm1` schema (`crm1_companies`, `crm1_contacts`, `crm1_leads`, `crm1_import_batches`, `crm1_import_receipts`, `crm1_import_rejects`) is strictly private to CRM-1.
- **Zero Cross-Module Direct SQL:** No sibling module (CRM-2, CRM-3, ERP-3) or Migration Kit component may perform direct SQL queries or mutations against `crm1` tables.
- **Public API & Projections:** Cross-module referential integrity is resolved strictly through authenticated public REST endpoints (`/api/v1/crm-contacts/*`) and read projections (`contactName`, `companyName`).

---

## 2. Domain Invariants & Business Rules

Each domain rule is strictly enforced in code, verified by automated unit/DB tests, and documented in the OpenAPI specification:

1. **Flat Master Companies (FR-CRM1-01):**
   - V1 exclusively models flat company entities (`crm1_companies`). Hierarchical parent companies, corporate group trees, and matrix account relationships are strictly out of scope.
   - Company name is required and non-empty (`crm1_companies_name_nonempty_check`).
   - Corporate tax numbers, emails, phones, and addresses are deterministically trimmed and validated.

2. **Contacts & Golden Identity (FR-CRM1-02, FR-CRM1-06):**
   - First and last names are mandatory (`length(btrim) > 0`).
   - Every contact carries an immutable, system-assigned Golden ID (`golden_id`) unique across the system (`crm1_contacts_golden_id_key`).
   - Company link (`company_id`) is optional; if present, it must reference an existing company in `crm1_companies` with foreign key enforcement (`ON DELETE RESTRICT`).

3. **Consent & Freshness Protection (GDPR / Privacy):**
   - Explicit consent status is tracked (`unknown`, `granted`, `withdrawn`).
   - Stale overwrite protection: Database trigger `crm1_contacts_preference_freshness_trigger` rejects updates where incoming consent or unsubscribe timestamps are older than or equal to existing timestamps (raises SQLSTATE `23514`).
   - Unsubscribe suppression status is never overridden by older migration data.

4. **Server-Paged Contact Search (FR-CRM1-04):**
   - Contact search matches case-insensitively across `firstName`, `lastName`, and `email` using indexed database columns (`crm1_contacts_name_search_idx`, `crm1_contacts_email_search_idx`).
   - Default page size is strictly **25 records** (`pageSize: 25`, max 100), and all results are server-paged to prevent unbounded memory consumption.

5. **Forward-Only Lead Lifecycle (FR-CRM1-03):**
   - Leads strictly progress through 4 valid stages: `New` ➔ `Working` ➔ `Qualified` ➔ `Closed`.
   - Regressive stage movement is barred by domain state machine transition guards (`CRM1_LEAD_STATUS_TRANSITIONS`).
   - Every lead references a valid contact (`ON DELETE RESTRICT`).

6. **Deterministic Exact Duplicate Deduplication (KIT-10):**
   - Deduplication uses deterministic normalized exact keys: `email` (lowercased, trimmed), `phone_name` (composite normalized phone + name), `tax_number` (uppercase, stripped non-alphanumeric).
   - **Strict Prohibition of Fuzzy Auto-Merge:** Automatic or unreviewed fuzzy merging is strictly barred in V1. Requesting `autoMerge: true` immediately throws `AutoMergeForbiddenError` (HTTP 422).
   - Duplicate candidates are held in a human review queue (`held_for_review`) and resolved with an immutable audit trail (`crm1_duplicates_audit`).

7. **Chunked Batch Ingestion & 10% Partial-Load Stop Policy (KIT-12):**
   - Batch ingestion processes records in chunks of 500 rows (`CRM1_DEFAULT_CHUNK_SIZE = 500`).
   - Transient failures retry up to 3 times with bounded exponential backoff (`min(1000, 50 * 2^(attempt - 1))`).
   - If row failure rate exceeds 10% after minimum 50 attempted rows, batch execution halts immediately with status `STOPPED_EXCESSIVE_FAILURES`.
   - All rows committed prior to halt remain durable in PostgreSQL; no compensating rollback saga or destructive uncommitted data loss occurs.

8. **Out-of-Scope Boundaries (V1 Lock):**
   - V1 strictly excludes: fuzzy auto-merge, compensating rollback sagas, complex parent-subsidiary corporate trees, outbound email delivery campaigns, and external cloud uploader integrations.

---

## 3. Public API Directory

All endpoints reside under the `/api/v1/crm-contacts` prefix with JWT bearer authentication and role-based capability enforcement:

| Verb | Path | Description | Required Roles | Responses |
| :--- | :--- | :--- | :--- | :---: |
| `GET` | `/contacts` | Server-paged contact search by name or email (default pageSize 25) | `viewer`, `editor`, `analyst`, `admin` | `200 OK` / `400` |
| `POST` | `/contacts` | Create a contact record | `editor`, `migration_runner`, `admin` | `201 Created` / `400` / `422` |
| `GET` | `/contacts/:id` | Retrieve contact details by UUID | `viewer`, `editor`, `analyst`, `admin` | `200 OK` / `404` |
| `PATCH` | `/contacts/:id` | Update contact attributes | `editor`, `migration_runner`, `admin` | `200 OK` / `400` / `404` |
| `GET` | `/companies` | Server-paged company directory | `viewer`, `editor`, `analyst`, `admin` | `200 OK` / `400` |
| `POST` | `/companies` | Create a flat company | `editor`, `migration_runner`, `admin` | `201 Created` / `400` / `422` |
| `GET` | `/companies/:id` | Retrieve company details by UUID | `viewer`, `editor`, `analyst`, `admin` | `200 OK` / `404` |
| `PATCH` | `/companies/:id` | Update company attributes | `editor`, `migration_runner`, `admin` | `200 OK` / `400` / `404` |
| `GET` | `/leads` | Paginated lead directory with status filter | `viewer`, `editor`, `analyst`, `admin` | `200 OK` / `400` |
| `POST` | `/leads` | Create a lead linked to an existing contact | `editor`, `migration_runner`, `admin` | `201 Created` / `400` / `422` |
| `GET` | `/leads/:id` | Retrieve lead details by UUID | `viewer`, `editor`, `analyst`, `admin` | `200 OK` / `404` |
| `PATCH` | `/leads/:id` | Advance lead lifecycle stage | `editor`, `migration_runner`, `admin` | `200 OK` / `400` / `404` / `422` |
| `POST` | `/import/row` | Atomic migration row ingestion with durable receipt | `migration_runner`, `admin` | `201 Created` / `200 OK` / `400` |
| `GET` | `/import/receipts` | Retrieve durable migration receipts | `viewer`, `analyst`, `admin` | `200 OK` |
| `POST` | `/imports` | Execute full batch import | `migration_runner`, `admin` | `201 Created` / `200 OK` / `400` |
| `GET` | `/imports/:batch` | Retrieve batch execution status and counters | `viewer`, `analyst`, `admin` | `200 OK` / `404` |
| `GET` | `/imports/:batch/rejects` | Retrieve rejected rows with reason codes | `viewer`, `analyst`, `admin` | `200 OK` / `404` |
| `POST` | `/duplicates/detect` | Detect exact duplicate candidate groups (throws 422 on auto-merge) | `analyst`, `migration_runner`, `admin` | `200 OK` / `422` |
| `GET` | `/duplicates/held` | List duplicate groups held for human review | `viewer`, `analyst`, `editor`, `admin` | `200 OK` |
| `POST` | `/duplicates/resolve` | Execute human merge decision with immutable audit entry | `editor`, `analyst`, `admin` | `200 OK` / `400` |
| `GET` | `/duplicates/audit` | Paginated query of human duplicate merge decisions | `viewer`, `analyst`, `admin` | `200 OK` |
| `POST` | `/batches/execute-load` | Execute chunked batch load with 10% stop policy | `migration_runner`, `admin` | `200 OK` / `422` |
| `GET` | `/batches/:batchId/report` | Retrieve durable batch execution report and audit | `viewer`, `analyst`, `admin` | `200 OK` / `404` |

---

## 4. Migration Kit Integration (KIT-08 Target Adapter)

The module integrates with Migration Kit via the `Crm1TargetAdapter`:
- **Atomic Commits:** Business target rows (company, contact, lead) and durable receipts (`crm1_import_receipts`) commit in a single PostgreSQL transaction.
- **Stable Idempotency Key:** `batchId:sourceRow:entity:canonicalPayload` ensures that retrying an import never creates duplicate business entities. Replays return `HTTP 200` with `isExisting: true`.
- **Preflight Dry Runs:** Supports schema and constraint pre-validation without mutating target tables or writing receipts.
- **Auditable Rejection Ledger:** Rows violating constraints are durably written to `crm1_import_rejects` with categorized reason codes (`INVALID_EMAIL`, `NULL_REQUIRED`, `FOREIGN_KEY_MISSING`) and safe messages.

---

## 5. Operations & Verification Runbook

### Database Migrations:
```bash
# Apply forward-only migration crm1_v1.sql
node infra/scripts/db-migrate.ts
```

### Deterministic Seeding & Reset:
```bash
# Verify dirty data packs and seed synthetic baseline
npm run seed:crm1

# Reset database cleanly and reseed identical state
node sample-data/crm-1/seed.ts --reset
```

### Run Test Suites:
```bash
# Full monorepo check
npm run typecheck
npm run lint
npm run security:check

# CRM-1 Module test suites (39 test files, 576+ tests passing)
DATABASE_URL_TEST="postgresql://localhost:5432/clearshift_test" npx vitest run apps/crm/modules/crm-1

# Specific test suites
npx vitest run apps/crm/modules/crm-1/tests/fixtures/seed.test.ts
npx vitest run apps/crm/modules/crm-1/tests/contracts/openapi.test.ts
npx vitest run apps/crm/modules/crm-1/tests/fixtures/dirty-pack.test.ts
npx vitest run apps/crm/modules/crm-1/tests/api/module-contract-regression.test.ts
npx vitest run apps/crm/modules/crm-1/tests/db/schema.test.ts
npx vitest run apps/crm/modules/crm-1/tests/web/browser-journey.test.tsx
```

### 5-Minute Operator Demo:
Consult [`docs/demo-scripts/crm-1-v1.md`](file:///Users/janmeshravindrarohida/Desktop/Clearshift-CRM/docs/demo-scripts/crm-1-v1.md) for the complete 5-minute Gate G4 operator walkthrough covering deterministic seeding, server-paged contact search, company creation, contact linking, forward-only lead lifecycle transitions, and atomic Target Adapter ingestion.
