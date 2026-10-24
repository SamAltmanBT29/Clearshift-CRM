# ClearShift CRM — Requirement-to-Test Traceability Matrix: CRM-1

**Module ID:** `CRM-1`
**Module Name:** Contacts, Companies and Leads
**Owning Team:** Team `crm-contacts` (Group 1 — Role 4 Data / QA Lead)
**Schema Version:** 1.0.0
**Target Milestone:** Gate G1 — Design Complete (Sprint 1)
**Traceability:** ClearShift Project Plan v3.0 §§9.3–9.6, 17; SDS ClearShift CRM v2.0 §4.2, §4.7, §4.11, §4.12; Master Architecture Baseline 1.0-A §4.2; Issue #117 `[CRM1-24]`.

---

## 1. Executive Summary & Verification Standard

This Requirement-to-Test Traceability Matrix maps 100% of the functional requirements, domain business rules, security policies, and migration invariants for **CRM-1 Contacts, Companies and Leads** to automated test suites in the repository.

### Verification Standards:
1. **Automated Test Coverage:** Every "Must" requirement is backed by at least one executing unit, contract, schema, or integration test suite.
2. **Deterministic Execution:** No test relies on non-deterministic fuzzy scoring, external internet connections, or mock timers.
3. **Synthetic Fixtures Only:** All test fixtures are 100% synthetic; no real personal or enterprise data is ever used.
4. **Minimum Domain Coverage:** Unit and domain test suites demonstrate green passes with $\ge 60\%$ statement and line coverage.

---

## 2. Requirement Traceability Matrix

| Requirement ID | Requirement Description | Priority | Source Authority | Domain Layer | Test Type | Automated Test Suite & File Location | Verification Status |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :---: |
| **`FR-CRM1-01`** | Show contact list with case-insensitive search by name and email, bounded paging (default 25, max 100). | **Must** | SDS CRM v2.0 §4.2 | API / Web | Contract | `apps/crm/modules/crm-1/tests/api/list.test.ts`<br>`CRM-1 List/Read API & Contracts (Issue #7 / [CRM1-02])` | **VERIFIED (Green)** |
| **`FR-CRM1-02`** | Create and edit contact: first name, last name, email, phone, address, company link, lead status. | **Must** | SDS CRM v2.0 §4.2 | API / Web | Regression | `apps/crm/modules/crm-1/tests/api/mutations.test.ts`<br>`apps/crm/modules/crm-1/web/tests/ContactForm.test.tsx` | **VERIFIED (Green)** |
| **`FR-CRM1-03`** | Create and edit flat company: name, tax number, email, phone, address. | **Must** | SDS CRM v2.0 §4.2 | API / Web | Regression | `apps/crm/modules/crm-1/tests/api/mutations.test.ts`<br>`apps/crm/modules/crm-1/web/tests/CompanyForm.test.tsx` | **VERIFIED (Green)** |
| **`FR-CRM1-04`** | Link contact to one company (optional field, restrict on delete). | **Must** | SDS CRM v2.0 §4.2 | Database | Schema | `apps/crm/modules/crm-1/tests/db/schema.test.ts`<br>`CRM-1 Drizzle schema constraints` | **VERIFIED (Green)** |
| **`FR-CRM1-05`** | Lead status workflow follow allowlist: `New -> Working -> Qualified -> Closed`. Regressions return 422. | **Must** | SDS CRM v2.0 §4.2 | Domain / Web | Unit | `apps/crm/modules/crm-1/tests/domain/relationships.test.ts`<br>`apps/crm/modules/crm-1/web/tests/LeadForm.test.tsx` | **VERIFIED (Green)** |
| **`FR-CRM1-05-01`** | Complete human-operated create/edit forms and detail workflows for Contacts, Companies, Leads, and Import/Reject views with field-level validation and back-to-list navigation. | **Must** | Issue #10 [CRM1-05] | Web / UI | Component / Contract | `apps/crm/modules/crm-1/web/tests/DetailPages.test.tsx`<br>`apps/crm/modules/crm-1/web/tests/ContactForm.test.tsx` | **VERIFIED (Green)** |
| **`FR-CRM1-06`** | Import screen / API: upload CSV/stream, profile report, run batch, watch status. | **Must** | SDS CRM v2.0 §4.2 | Migration | Integration | `apps/crm/modules/crm-1/tests/services/crm1-mutation.service.test.ts`<br>`CRM-1 mutation service & idempotent imports` | **VERIFIED (Green)** |
| **`FR-CRM1-07`** | Reject list: row-level failures with reason code and privacy-safe message, downloadable as CSV. | **Must** | SDS CRM v2.0 §4.2 | API | Contract | `apps/crm/modules/crm-1/tests/api/list.test.ts`<br>`CRM-1 List/Read API & Contracts (Issue #7 / [CRM1-02])` | **VERIFIED (Green)** |
| **`FR-CRM1-08`** | List screens render accessible empty state when dataset is empty ("No contacts yet — import a CSV file"). | **Should** | SDS CRM v2.0 §4.2 | Web | Unit | `apps/crm/modules/crm-1/tests/web/routes.test.ts`<br>`CRM-1 Frontend Route Registration & Layout Shell` | **VERIFIED (Green)** |
| **`FR-CRM1-10`** | Duplicate review: show candidate pairs, deterministic exact keys, Keep/Merge/Skip, human approval path. | **Must** | SDS CRM v2.0 §4.2 | Web / Domain | Unit | `apps/crm/modules/crm-1/tests/web/routes.test.ts`<br>`packages/contracts/src/crm-1-duplicates.ts` | **VERIFIED (Green)** |
| **`FR-CRM1-14`** | Import history: list past runs with user, source system, counts, link to receipts and reports. | **Must** | SDS CRM v2.0 §4.2 | API | Contract | `apps/crm/modules/crm-1/tests/api/list.test.ts`<br>`CRM-1 List/Read API & Contracts (Issue #7 / [CRM1-02])` | **VERIFIED (Green)** |
| **`FR-CRM1-16`** | Register module routes (`/crm-1/contacts`, `companies`, `leads`, `duplicates`, `imports`), skip link, ARIA. | **Must** | Standardization Plan | Web | Unit | `apps/crm/modules/crm-1/tests/web/routes.test.ts`<br>`CRM-1 Frontend Route Registration & Layout Shell` | **VERIFIED (Green)** |
| **`FR-CRM1-23`** | Append-only audit trail: capture actor, action, timestamp, entity, correlationId, redacted diff. | **Must** | SDS CRM v2.0 §4.2 | Security | Security | `apps/crm/modules/crm-1/tests/security/authorization.test.ts`<br>`CRM-1 Security & Authorization (Issue #14 / [CRM1-09])` | **VERIFIED (Green)** |
| **`BR-CRM1-DUP-01`** | Deterministic exact email key: trimmed, lowercase. Zero fuzzy auto-merging permitted in V1. | **Must** | CRM SDS v2.0 & Baseline | Domain | Unit | `apps/crm/modules/crm-1/tests/domain/qa-g1-design.test.ts`<br>`packages/contracts/src/crm-1-duplicates.ts` | **VERIFIED (Green)** |
| **`BR-CRM1-DUP-02`** | Deterministic exact combined key: `${normalizePhone(phone)}#${normalizeName(name)}`. | **Must** | CRM SDS v2.0 & Baseline | Domain | Unit | `apps/crm/modules/crm-1/tests/domain/qa-g1-design.test.ts`<br>`packages/contracts/src/crm-1-duplicates.ts` | **VERIFIED (Green)** |
| **`BR-CRM1-DUP-03`** | Deterministic company tax key: uppercase, alphanumeric only. | **Must** | CRM SDS v2.0 & Baseline | Domain | Unit | `apps/crm/modules/crm-1/tests/domain/qa-g1-design.test.ts`<br>`packages/contracts/src/crm-1-duplicates.ts` | **VERIFIED (Green)** |
| **`BR-CRM1-DUP-04`** | Ambiguous duplicate matches are held for human review; automatic merging is prohibited. | **Must** | CRM SDS v2.0 §4.2 | Domain | Unit | `apps/crm/modules/crm-1/tests/domain/qa-g1-design.test.ts`<br>`packages/contracts/src/crm-1-duplicates.ts` | **VERIFIED (Green)** |
| **`BR-CRM4-01`** | Unsubscribed contact protection: status `unsubscribed` can never be overwritten by import or bulk action. | **Must** | SDS CRM v2.0 §4.5 | Domain / DB | Schema | `apps/crm/modules/crm-1/tests/db/schema.test.ts`<br>`CRM-1 Drizzle schema constraints` | **VERIFIED (Green)** |
| **`SEC-01`** | Authenticate via asymmetric EdDSA JWTs and enforce 5 RBAC roles (viewer, editor, analyst, admin, migration_runner). | **Must** | SDS CRM v2.0 §7.1 | Security | Security | `apps/crm/modules/crm-1/tests/security/authorization.test.ts`<br>`CRM-1 Security & Authorization (Issue #14 / [CRM1-09])` | **VERIFIED (Green)** |
| **`SEC-02`** | Mask sensitive fields (bank accounts XXXX-XXXX-7890, salary XX,XXX, CSV formula injection escape). | **Must** | ClearShift Core Rules | Security | Security | `apps/crm/modules/crm-1/tests/security/authorization.test.ts`<br>`CRM-1 Security & Authorization (Issue #14 / [CRM1-09])` | **VERIFIED (Green)** |
| **`MIG-01`** | Atomic transaction: target business record and per-row import receipt commit in single transaction. | **Must** | KIT-08 & Decision C4 | Migration | Integration | `apps/crm/modules/crm-1/tests/migration/idempotency.test.ts`<br>`CRM-1 Target Adapter & Durable Import Receipts (Issue #12 / [CRM1-07])` | **VERIFIED (Green)** |
| **`MIG-02`** | Mathematical row conservation invariant: `source = loaded + rejected + merged + skipped` (`unaccounted = 0`). | **Must** | ClearShift Core Rules | Migration | Unit | `apps/crm/modules/crm-1/tests/domain/qa-g1-design.test.ts`<br>`CRM-1 QA Gate G1 Design Specifications` | **VERIFIED (Green)** |
| **`MIG-03`** | Bounded batching (500 rows) and stop migration when failures exceed 10% of attempted rows. | **Must** | ClearShift Core Rules | Migration | Unit | `apps/crm/modules/crm-1/tests/domain/qa-g1-design.test.ts`<br>`CRM-1 QA Gate G1 Design Specifications` | **VERIFIED (Green)** |
| **`FR-CRM1-27-01`** | Standard cleaners execute: whitespace trimming, name proper casing, email lowercasing, phone normalization, tax stripping, date coercion. | **Must** | Issue #120 [CRM1-27] | Migration / QA | Unit | `apps/crm/modules/crm-1/tests/kit/cleaner.test.ts`<br>`CRM-1 cleaning rules and field audit` | **VERIFIED (Green)** |
| **`FR-CRM1-27-02`** | Every modified field value generates an audit entry with source_row, field_name, original_value, cleaned_value, and rule_id. | **Must** | Issue #120 [CRM1-27] | Migration / QA | Unit | `apps/crm/modules/crm-1/tests/kit/cleaner.test.ts`<br>`CRM-1 cleaning rules and field audit` | **VERIFIED (Green)** |
| **`FR-CRM1-27-03`** | Unrecoverable required-field and syntax anomalies result in structured row rejection with standard reason codes. | **Must** | Issue #120 [CRM1-27] | Migration / QA | Unit | `apps/crm/modules/crm-1/tests/kit/cleaner.test.ts`<br>`CRM-1 cleaning rules and field audit` | **VERIFIED (Green)** |
| **`FR-CRM1-27-04`** | Batch cleaning service and summary metrics breakdown by rule_id and reason_code. | **Must** | Issue #120 [CRM1-27] | Service | Integration | `apps/crm/modules/crm-1/tests/services/crm1-cleaning.service.test.ts`<br>`Crm1CleaningService` | **VERIFIED (Green)** |
| **`FR-CRM1-27-05`** | Cleaning audit UI component renders before/after audit trail and rejected row tables. | **Should** | Issue #120 [CRM1-27] | Web | Component | `apps/crm/modules/crm-1/tests/web/cleaning-audit-page.test.ts`<br>`CleaningAuditPage Frontend Component` | **VERIFIED (Green)** |
| **`FR-CRM1-28-01`** | Mapping templates map source file columns to target schema attributes with type coercion rules. | **Must** | Issue #121 [CRM1-28] | Migration / QA | Unit | `apps/crm/modules/crm-1/tests/kit/mapping.test.ts`<br>`CRM-1 mapping templates and value translation` | **VERIFIED (Green)** |
| **`FR-CRM1-28-02`** | Enum translation tables map source values (e.g. status strings) to module enum allowlists. | **Must** | Issue #121 [CRM1-28] | Migration / QA | Unit | `apps/crm/modules/crm-1/tests/kit/mapping.test.ts`<br>`CRM-1 mapping templates and value translation` | **VERIFIED (Green)** |
| **`FR-CRM1-28-03`** | Unmapped required target fields raise validation error and block dry-run execution. | **Must** | Issue #121 [CRM1-28] | Migration / Service | Unit / API | `apps/crm/modules/crm-1/tests/services/crm1-mapping.service.test.ts`<br>`apps/crm/modules/crm-1/tests/api/mapping-routes.test.ts` | **VERIFIED (Green)** |
| **`FR-CRM1-28-04`** | Templates are named, versioned, and reproducible across runs with SHA-256 stable checksums. | **Must** | Issue #121 [CRM1-28] | Migration / QA | Unit | `apps/crm/modules/crm-1/tests/kit/mapping.test.ts`<br>`CRM-1 mapping templates and value translation` | **VERIFIED (Green)** |
| **`FR-CRM1-28-05`** | Mapping routes and React UI page for template inspection and enum translation review. | **Should** | Issue #121 [CRM1-28] | Web / API | Component / API | `apps/crm/modules/crm-1/tests/web/mapping-templates-page.test.ts`<br>`apps/crm/modules/crm-1/tests/api/mapping-routes.test.ts` | **VERIFIED (Green)** |
| **`FR-CRM1-12-01`** | Module registers normalized exact keys (trimmed lowercase email, tax number, phone+name composite, phone, sku). | **Must** | Issue #105 [CRM1-12] / KIT-10 | Domain | Unit | `apps/crm/modules/crm-1/tests/domain/duplicate-policy.test.ts`<br>`CRM-1 Exact Duplicate Key Policy` | **VERIFIED (Green)** |
| **`FR-CRM1-12-02`** | Identical normalized keys flagged deterministically as duplicate candidates; ambiguous candidates held for human review. | **Must** | Issue #105 [CRM1-12] / KIT-10 | Domain / API | Unit / API | `apps/crm/modules/crm-1/tests/domain/duplicate-policy.test.ts`<br>`apps/crm/modules/crm-1/tests/api/duplicates.test.ts` | **VERIFIED (Green)** |
| **`FR-CRM1-12-03`** | Automatic fuzzy merging is strictly prohibited in V1; autoMerge requests throw `AutoMergeForbiddenError` (HTTP 422). | **Must** | ClearShift Core Rules & [CRM1-12] | Domain / API | Unit / API | `apps/crm/modules/crm-1/tests/domain/duplicate-policy.test.ts`<br>`apps/crm/modules/crm-1/tests/api/duplicates.test.ts` | **VERIFIED (Green)** |
| **`FR-CRM1-12-04`** | Immutable audit log records human merge decisions with actor ID, timestamp, kept ID, merged ID, and reason. | **Must** | Issue #105 [CRM1-12] / KIT-10 | Domain / Security | Unit / API | `apps/crm/modules/crm-1/tests/domain/duplicate-policy.test.ts`<br>`apps/crm/modules/crm-1/tests/api/duplicates.test.ts` | **VERIFIED (Green)** |
| **`FR-CRM1-12-05`** | REST endpoints for duplicate candidate detection, held queue listing, resolution, and audit log inspection under `/api/v1/crm-contacts/duplicates/*`. | **Must** | Issue #105 [CRM1-12] / KIT-10 | API | Contract | `apps/crm/modules/crm-1/tests/api/duplicates.test.ts`<br>`CRM-1 Duplicate Key Policy & Human Review API` | **VERIFIED (Green)** |
| **`FR-CRM1-08-01`** | Synthetic dirty data pack (`dirty-data-v1.csv`, 100 rows) and outcome manifest checked into repo with SHA-256 checksum and schema/version. | **Must** | Issue #13 [CRM1-08] | QA / Data | Fixture | `apps/crm/modules/crm-1/tests/migration/rules.test.ts`<br>`CRM-1 data-quality rules` | **VERIFIED (Green)** |
| **`FR-CRM1-08-02`** | Comprehensive rule catalogue (`CRM1-DQ-001..019`) defines required/optional fields, formatting, enumerations, candidate keys, and stable reject codes. | **Must** | Issue #13 [CRM1-08] | Migration / QA | Unit | `apps/crm/modules/crm-1/tests/migration/rules.test.ts`<br>`CRM-1 data-quality rules` | **VERIFIED (Green)** |
| **`FR-CRM1-08-03`** | Deterministic profiling reproduces exact outcome counts (`100 = 54 accept + 8 normalize + 4 merge + 34 reject`) and raw input values/checksums remain immutable. | **Must** | Issue #13 [CRM1-08] | Migration / QA | Unit | `apps/crm/modules/crm-1/tests/migration/rules.test.ts`<br>`CRM-1 data-quality rules` | **VERIFIED (Green)** |
| **`FR-CRM1-08-04`** | Canonical mapping template (`sample-data/crm-1/mapping-template.json`) defines source-to-target mapping for `crm1_contacts` with SHA-256 checksum. | **Must** | Issue #13 [CRM1-08] | Migration / QA | Unit | `apps/crm/modules/crm-1/tests/migration/rules.test.ts`<br>`CRM-1 data-quality rules` | **VERIFIED (Green)** |
| **`FR-CRM1-25-01`** | Canonical Dirty Data Pack contains at least 100 realistic synthetic rows with zero real personal data or credentials. | **Must** | Issue #118 [CRM1-25] | QA / Data | Fixture | `apps/crm/modules/crm-1/tests/fixtures/dirty-pack.test.ts`<br>`CRM-1 Canonical Module Dirty Data Pack` | **VERIFIED (Green)** |
| **`FR-CRM1-25-02`** | Deterministic outcome manifest documents expected outcome per row (`valid`, `malformed`, `null_required`, `exact_duplicate`, `foreign_key_missing`) satisfying conservation balance sheet (`100 = 74 + 18 + 8 + 0`). | **Must** | Issue #118 [CRM1-25] | QA / Data | Fixture | `apps/crm/modules/crm-1/tests/fixtures/dirty-pack.test.ts`<br>`CRM-1 Canonical Module Dirty Data Pack` | **VERIFIED (Green)** |
| **`FR-CRM1-25-03`** | Edge case scenarios cover multi-byte UTF-8, whitespace padding, date format variants, boundary numbers, formula injection risks, and field length capacity. | **Must** | Issue #118 [CRM1-25] | QA / Data | Fixture | `apps/crm/modules/crm-1/tests/fixtures/dirty-pack.test.ts`<br>`CRM-1 Canonical Module Dirty Data Pack` | **VERIFIED (Green)** |
| **`FR-CRM1-25-04`** | Test suite verifies fixture counts and SHA-256 hashes reproduce identically across multiple runs and synchronize with `sample-data/crm-1/`. | **Must** | Issue #118 [CRM1-25] | QA / Data | Unit | `apps/crm/modules/crm-1/tests/fixtures/dirty-pack.test.ts`<br>`CRM-1 Canonical Module Dirty Data Pack` | **VERIFIED (Green)** |
| **`FR-CRM1-13-01`** | Load operations process records in chunks of 500 rows (`CRM1_DEFAULT_CHUNK_SIZE = 500`). | **Must** | Issue #106 [CRM1-13] / KIT-12 | Domain / Migration | Unit | `apps/crm/modules/crm-1/tests/domain/batch-loader.test.ts`<br>`executeCrm1ChunkedBatchLoad` | **VERIFIED (Green)** |
| **`FR-CRM1-13-02`** | Transient failures trigger bounded exponential backoff retries without corrupting idempotency keys (`maxRetries = 3`, backoff `min(1000, 50 * 2^(n-1))`). | **Must** | Issue #106 [CRM1-13] / KIT-12 | Domain / Migration | Unit | `apps/crm/modules/crm-1/tests/domain/batch-loader.test.ts`<br>`calculateBackoffDelay & retry` | **VERIFIED (Green)** |
| **`FR-CRM1-13-03`** | Batch execution stops immediately if row failures exceed 10% of attempted rows after minimum 50 attempted rows. | **Must** | Issue #106 [CRM1-13] / KIT-12 | Domain / Migration | Unit | `apps/crm/modules/crm-1/tests/domain/batch-loader.test.ts`<br>`shouldHaltBatch & BatchLoadHaltedError` | **VERIFIED (Green)** |
| **`FR-CRM1-13-04`** | Committed rows and receipts remain durable; batch state transitions to `STOPPED_EXCESSIVE_FAILURES` without rollback saga or destructive uncommitted data loss. | **Must** | Issue #106 [CRM1-13] / KIT-12 | Domain / Service | Integration | `apps/crm/modules/crm-1/tests/api/batch-loader.test.ts`<br>`Crm1Service.executeBatchLoad` | **VERIFIED (Green)** |
| **`FR-CRM1-13-05`** | Batch execution endpoints `POST /batches/execute-load` and `GET /batches/:batchId/report` enforced by RBAC (`KIT_RUN`, `KIT_READ`) and BatchLoaderPage operator UI. | **Must** | Issue #106 [CRM1-13] / KIT-12 | API / Web | Contract / Web | `apps/crm/modules/crm-1/tests/api/batch-loader.test.ts`<br>`apps/crm/modules/crm-1/tests/web/batch-loader-page.test.ts` | **VERIFIED (Green)** |
| **`FR-CRM1-26`** | Module profiling configuration: column statistics, duplicate counts, non-destructive execution, and scorecard manifest alignment. | **Must** | SDS ClearShift CRM v2.0 §4.2, §4.11, §4.12 & Issue #119 [CRM1-26] | Migration | Unit | `apps/crm/modules/crm-1/tests/kit/profiler.test.ts`<br>`CRM-1 Profiling Configuration & Manifest Assertions` | **VERIFIED (Green)** |
| **`FR-CRM1-29`** | Module contract, regression and browser test suite: OpenAPI 3.1.0 conformance, multi-browser simulated journeys, and zero flaky tests. | **Must** | Issue #122 [CRM1-29] / SDS §4.1, §4.2, §7.1 | API / Web / QA | Contract / Regression | `apps/crm/modules/crm-1/tests/api/module-contract-regression.test.ts`<br>`apps/crm/modules/crm-1/tests/contracts/openapi.test.ts`<br>`apps/crm/modules/crm-1/tests/web/browser-journey.test.tsx` | **VERIFIED (Green)** |

---

## 3. Test Suite Registry & Test Counts

The CRM-1 automated test suite comprises 30 test files:

```
apps/crm/modules/crm-1/tests/
├── api/
│   ├── batch-loader.test.ts                 ( 9 tests) — POST /batches/execute-load, 10% stop policy, idempotent retry, GET report (Issue #106 / [CRM1-13])
│   ├── duplicates.test.ts                   (18 tests) — POST /duplicates/detect (422 autoMerge), GET /held, POST /resolve, GET /audit (Issue #105 / [CRM1-12])
│   ├── list.test.ts                         (46 tests) — Server-side paged list/read contracts & search
│   ├── mapping-routes.test.ts               (10 tests) — Mapping templates, dry-run validation & batch map
│   ├── module-contract-regression.test.ts   (15 tests) — Comprehensive regression & contract conformance suite (Issue #122 / [CRM1-29])
│   ├── mutations.test.ts                    ( 3 tests) — Validated contact/company/lead CRUD & 422 errors
│   └── routes.test.ts                       ( 4 tests) — Route registration & Fastify plugin mounting
├── contracts/
│   └── openapi.test.ts                      (13 tests) — OpenAPI 3.1.0 schema conformance & Zod alignment (Issue #122 / [CRM1-29])
├── db/
│   └── schema.test.ts                       ( 4 tests) — PostgreSQL 18 schema check constraints & FKs
├── domain/
│   ├── batch-loader.test.ts                 (10 tests) — Chunking 500 rows, bounded backoff, 10% halt policy, durable partial commits (Issue #106 / [CRM1-13])
│   ├── duplicate-policy.test.ts             (27 tests) — Exact key registry, candidate detector, review queue, no fuzzy auto-merge (Issue #105 / [CRM1-12])
│   ├── qa-g1-design.test.ts                 (15 tests) — Data dictionary, ERD, traceability, dirty pack
│   └── relationships.test.ts                (16 tests) — Lifecycle allowlist, foreign key restrictions
├── fixtures/
│   └── dirty-pack.test.ts                   (31 tests) — 100-row synthetic pack, manifest outcomes, conservation equation & edge cases (Issue #118 / [CRM1-25])
├── kit/
│   ├── cleaner.test.ts                      (20 tests) — Standard normalizers, field-level audit, row rejects
│   ├── mapping.test.ts                      (15 tests) — Field mapping, type coercion, enums, dry-run guards
│   └── profiler.test.ts                     (21 tests) — Profiling stats, duplicate detection & manifest comparison (Issue #119 / [CRM1-26])
├── migration/
│   ├── idempotency.test.ts                  (14 tests) — Target adapter, durable receipts, idempotency retries & 409 conflicts (Issue #12 / [CRM1-07])
│   └── rules.test.ts                        (43 tests) — Data-quality rules, profiling assertions & fixture checksums (Issue #13 / [CRM1-08])
├── security/
│   └── authorization.test.ts                (51 tests) — EdDSA JWTs, RBAC 5 roles, sensitive masking, audit
├── services/
│   ├── crm1-cleaning.service.test.ts        ( 6 tests) — Batch cleaning service and summary metrics
│   ├── crm1-mapping.service.test.ts         ( 5 tests) — Mapping service, batch transformation & validation
│   └── crm1-mutation.service.test.ts        ( 2 tests) — Atomic target + receipt commit in 1 transaction
└── web/
    ├── batch-loader-page.test.ts            ( 3 tests) — BatchLoaderPage component, status badge, route definition (Issue #106 / [CRM1-13])
    ├── browser-journey.test.tsx             (13 tests) — Multi-browser Chrome/Firefox user journeys across core entities (Issue #122 / [CRM1-29])
    ├── cleaning-audit-page.test.ts          ( 3 tests) — Cleaning audit page frontend component and columns
    ├── data-table.test.ts                   (21 tests) — Paginated data table and column layout
    ├── mapping-templates-page.test.ts       ( 4 tests) — Mapping templates page component & route
    ├── routes.test.ts                       (14 tests) — Frontend route guards, layout shell, ARIA landmarks
    ├── search-filters.test.ts               (17 tests) — Debounced search, faceted filter toolbar
    ├── ui-states.test.ts                    (32 tests) — Shared loading, error, empty, and forbidden states
    ├── ContactForm.test.tsx                 (10 tests) — ContactForm create/edit, client validation, dirty confirmation (Issue #10 / [CRM1-05])
    ├── CompanyForm.test.tsx                 ( 7 tests) — CompanyForm create/edit, taxNumber formatting, flat company invariant (Issue #10 / [CRM1-05])
    ├── LeadForm.test.tsx                    ( 7 tests) — LeadForm create/edit, status transition validation (Issue #10 / [CRM1-05])
    └── DetailPages.test.tsx                 ( 4 tests) — Contact, Company, Lead, Import batch detail pages & back links (Issue #10 / [CRM1-05])
-----------------------------------------------------------------------------------------------------------
Total Automated Test Cases: 533 tests (100% Green, 0 Failures)
```

---

## 4. Gate G2 & G3 Sign-Off Verification

* [x] **Zero Real Data:** 100% synthetic generation verified with RFC-2606 reserved domains.
* [x] **Canonical Dirty Data Pack (100 rows):** Seeded anomalies and deterministic manifest published in fixtures and sample-data.
* [x] **Conservation Invariant:** Exactly balanced `source = loaded + rejected + merged + skipped` (`unaccounted = 0`).
* [x] **Deterministic Key Registration:** Exact normalized keys registered for email, phone+name, tax number, phone, and SKU.
* [x] **Deterministic Duplicate Grouping:** Identical keys grouped without non-deterministic heuristics.
* [x] **Zero Fuzzy Auto-Merge:** Auto-merging strictly prohibited in V1; raises 422 `AUTO_MERGE_FORBIDDEN`.
* [x] **Authorized Human Review:** Duplicate candidate groups held in `held_for_review` until explicit human decision.
* [x] **Self-Merge Assertion:** Prohibits self-merge (`keptId === mergedId`) with structured 400 validation error.
* [x] **Immutable Audit Log:** Captures actor ID, timestamp, kept ID, merged ID, and reason for every review decision.
* [x] **Cleaning Execution:** All approved V1 cleaning rules execute deterministically.
* [x] **Field Audit:** Every modified value generates an audit entry with before/after diff and rule ID.
* [x] **Anomaly Rejection:** Unrecoverable required-field and syntax anomalies result in structured row rejections.
* [x] **Mapping Templates:** Canonical and legacy mapping templates configured for contacts, companies, and leads.
* [x] **Enum Translation:** Synonyms mapped to strict allowlists (`lead_status`, `consent_status`, `boolean`).
* [x] **Dry-Run Guard:** Missing required fields raise structured validation errors and halt execution before DB mutation.
* [x] **Row Outcome Conservation:** Balance sheet `source = loaded + rejected + merged + skipped` strictly upheld.
* [x] **Chunked Ingestion (500 rows):** Records processed in isolated chunks of 500 rows.
* [x] **Bounded Exponential Backoff:** Transient errors retry up to 3 times without corrupting idempotency keys.
* [x] **10% Failure Rate Stop Policy:** Batch execution stops immediately when failure rate exceeds 10% after 50 attempted rows.
* [x] **Durable Partial Commits:** Transition to `STOPPED_EXCESSIVE_FAILURES` preserves all committed rows and receipts without rollback sagas.
* [x] **Zero Duplicate Platform Infra:** Reuses shared normalizers and registry from `@cs/core`.
* [x] **Human-Operated V1 Screens (CRM1-05):** Complete create/edit/detail workflows for contacts, companies, leads, and import batches linking back to their list context.
* [x] **Field-Level Contract Validation:** Field labels, helper text, and validation errors aligned with OpenAPI contract; client validation improves UX while server validation remains authoritative.
* [x] **Read-Only / Protected Invariants:** Golden ID, source metadata, and consent state cannot be mutated through standard UI forms; flat companies strictly preserved.
