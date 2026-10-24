# ClearShift CRM — Module CRM-2: Deals, Pipeline and Quotes

**Module ID:** `CRM-2`  
**Package:** `@cs/mod-crm2`  
**Milestone:** Gate G4 Release Candidate (Weeks 7–8)  
**Traceability:** ClearShift Project Plan v3.0 §7.2, §9.3; SDS ClearShift CRM v2.0 §4.3 (FR-CRM2-01..05); Master Architecture Baseline 1.0-A §4.2; Issue #16, #24, #137.

---

## 1. Module Overview & Architectural Role

Module **CRM-2 ("Deals, Pipeline and Quotes")** manages core sales opportunity lifecycles within ClearShift V1. It provides authoritative storage and business logic for pipeline stages, opportunity deals, linked CRM-1 contacts, simple commercial quotes, and transactional migration ingestion through Migration Kit (KIT-08).

### Pinned Stack Governance:
- **Runtime:** Node.js 24 LTS patch
- **Language:** Strict TypeScript (ESM)
- **API Framework:** Fastify 5 + Zod OpenAPI validation
- **Database:** PostgreSQL 18.6 with Drizzle ORM (`crm2` schema)
- **Security:** Shared JWT verification (`@cs/identity`) and role-based capability guards (`@cs/rbac`)
- **Shared UI:** React 19 + Shared component primitives (`@clearshift/ui`)

---

## 2. Domain Invariants & Business Rules

Each rule is strictly enforced in code and backed by automated tests:

1. **Six Fixed Pipeline Stages (FR-CRM2-03):**
   - The stage set is immutable and consists solely of: `New`, `Qualified`, `Proposal`, `Negotiation`, `Won`, `Lost`.
   - Seeded in migration `crm2_v1.sql` and protected by database trigger `crm2_stages_no_update` (raises SQLSTATE `55000` on UPDATE/DELETE).
   - Dynamic stage creation via `POST /stages` is barred (returns 404).

2. **Monetary Precision & Explicit ISO Currency:**
   - Deal values and quote amounts use PostgreSQL `NUMERIC(14,2)` and decimal string representations. Binary floating-point drift is strictly barred.
   - Currencies must match ISO 4217 3-letter uppercase format (e.g. `USD`, `EUR`, `GBP`, `INR`).

3. **Global Quote Number Uniqueness (FR-CRM2-04):**
   - Every simple quote carries a globally unique `quote_number` enforced by database unique constraint `crm2_quotes_quote_number_key`. Duplicate submissions return `409 Conflict`.

4. **Nullable Contact References & Orphan Deal Flagging (FR-CRM2-05):**
   - Deals support `contact_id = null` for inbound/unassigned opportunities ("Orphan Deals").
   - When `contact_id` is null, the API exposes `is_orphan: true`, and the React UI visibly renders an amber warning banner (`deal-form-orphan-warning`).

5. **Out-of-Scope Boundaries (V1 Lock):**
   - V1 strictly excludes V2/V3 features: drag-and-drop kanban boards (FR-CRM2-10), quote line items / SKU breakdown (FR-CRM2-11), weighted forecasting (FR-CRM2-20), PDF rendering (FR-CRM2-21), and compensating rollback sagas.

---

## 3. Public API Directory

All endpoints reside under the `/api/v1/crm-deals` prefix:

| Verb | Path | Description | Required Roles | Response |
| :--- | :--- | :--- | :--- | :---: |
| `GET` | `/stages` | Retrieve the 6 fixed pipeline stages in order | `viewer`, `editor`, `analyst`, `admin` | `200 OK` |
| `GET` | `/deals` | Paginated deal list with search and stage filter | `viewer`, `editor`, `analyst`, `admin` | `200 OK` |
| `GET` | `/deals/:id` | Retrieve single deal details by UUID | `viewer`, `editor`, `analyst`, `admin` | `200 OK` / `404` |
| `POST` | `/deals` | Create a sales opportunity | `editor`, `migration_runner`, `admin` | `201 Created` / `400` / `422` |
| `PATCH` | `/deals/:id` | Update deal fields and advance stage | `editor`, `migration_runner`, `admin` | `200 OK` / `400` / `404` / `422` |
| `GET` | `/quotes` | List simple quotes (filtered by `deal_id`) | `viewer`, `editor`, `analyst`, `admin` | `200 OK` |
| `GET` | `/quotes/:id` | Retrieve single quote details by UUID | `viewer`, `editor`, `analyst`, `admin` | `200 OK` / `404` |
| `POST` | `/quotes` | Create simple quote linked to a deal | `editor`, `migration_runner`, `admin` | `201 Created` / `400` / `409` / `422` |
| `PATCH` | `/quotes/:id` | Update quote details (amount, note) | `editor`, `migration_runner`, `admin` | `200 OK` / `400` / `404` |
| `POST` | `/import` | Transactional migration row ingestion with receipt | `migration_runner`, `admin` | `201 Created` / `200 OK` / `400` |
| `GET` | `/import/receipts` | List durable migration receipts | `viewer`, `analyst`, `admin` | `200 OK` |

---

## 4. Migration Kit Integration (KIT-08 Target Adapter)

The module implements the `Crm2TargetAdapter` conforming to the `@cs/kit` interface:
- **Durable Receipts:** Commits target business row and migration receipt atomically in one PostgreSQL transaction.
- **Idempotency:** Stable idempotency key (`batchId:sourceRow:entity`) guarantees safe retries with zero duplicate mutations.
- **Dry-Run Preflight:** Supports dry-run validation without database mutations or durable receipts.

---

## 5. Operations & Verification Runbook

### Database Migrations:
```bash
# Apply forward-only migration crm2_v1.sql
node infra/scripts/db-migrate.ts
```

### Deterministic Seeding & Reset:
```bash
# Seed synthetic baseline and generate dirty-data-v1.csv
node sample-data/crm-2/seed.ts

# Reset and verify determinism
node sample-data/crm-2/seed.ts --reset
```

### Run Test Suites:
```bash
# Monorepo test suite
npm test

# Module-specific test suites
npx vitest run apps/crm/modules/crm-2/tests/db/database-constraints.test.ts
npx vitest run apps/crm/modules/crm-2/tests/api/boundary-and-idempotency.test.ts
npx vitest run apps/crm/modules/crm-2/tests/api/authorization-matrix.test.ts
npx vitest run apps/crm/modules/crm-2/tests/contract/openapi-parity.test.ts
npx vitest run apps/crm/modules/crm-2/tests/migration/dirty-data-pack.test.ts
npx vitest run apps/crm/modules/crm-2/web/tests/form-states.test.tsx
```
