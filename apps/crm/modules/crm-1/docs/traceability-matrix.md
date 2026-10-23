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
| **`FR-CRM1-02`** | Create and edit contact: first name, last name, email, phone, address, company link, lead status. | **Must** | SDS CRM v2.0 §4.2 | API / Domain | Regression | `apps/crm/modules/crm-1/tests/api/mutations.test.ts`<br>`CRM-1 mutation API` | **VERIFIED (Green)** |
| **`FR-CRM1-03`** | Create and edit flat company: name, tax number, email, phone, address. | **Must** | SDS CRM v2.0 §4.2 | API / Domain | Regression | `apps/crm/modules/crm-1/tests/api/mutations.test.ts`<br>`CRM-1 mutation API` | **VERIFIED (Green)** |
| **`FR-CRM1-04`** | Link contact to one company (optional field, restrict on delete). | **Must** | SDS CRM v2.0 §4.2 | Database | Schema | `apps/crm/modules/crm-1/tests/db/schema.test.ts`<br>`CRM-1 Drizzle schema constraints` | **VERIFIED (Green)** |
| **`FR-CRM1-05`** | Lead status workflow follow allowlist: `New -> Working -> Qualified -> Closed`. Regressions return 422. | **Must** | SDS CRM v2.0 §4.2 | Domain | Unit | `apps/crm/modules/crm-1/tests/domain/relationships.test.ts`<br>`CRM-1 Relationships & Domain Invariants` | **VERIFIED (Green)** |
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
| **`MIG-01`** | Atomic transaction: target business record and per-row import receipt commit in single transaction. | **Must** | KIT-08 & Decision C4 | Migration | Integration | `apps/crm/modules/crm-1/tests/services/crm1-mutation.service.test.ts`<br>`CRM-1 mutation service & idempotent imports` | **VERIFIED (Green)** |
| **`MIG-02`** | Mathematical row conservation invariant: `source = loaded + rejected + merged + skipped` (`unaccounted = 0`). | **Must** | ClearShift Core Rules | Migration | Unit | `apps/crm/modules/crm-1/tests/domain/qa-g1-design.test.ts`<br>`CRM-1 QA Gate G1 Design Specifications` | **VERIFIED (Green)** |
| **`MIG-03`** | Bounded batching (500 rows) and stop migration when failures exceed 10% of attempted rows. | **Must** | ClearShift Core Rules | Migration | Unit | `apps/crm/modules/crm-1/tests/domain/qa-g1-design.test.ts`<br>`CRM-1 QA Gate G1 Design Specifications` | **VERIFIED (Green)** |
| **`FR-CRM1-27-01`** | Standard cleaners execute: whitespace trimming, name proper casing, email lowercasing, phone normalization, tax stripping, date coercion. | **Must** | Issue #120 [CRM1-27] | Migration / QA | Unit | `apps/crm/modules/crm-1/tests/kit/cleaner.test.ts`<br>`CRM-1 cleaning rules and field audit` | **VERIFIED (Green)** |
| **`FR-CRM1-27-02`** | Every modified field value generates an audit entry with source_row, field_name, original_value, cleaned_value, and rule_id. | **Must** | Issue #120 [CRM1-27] | Migration / QA | Unit | `apps/crm/modules/crm-1/tests/kit/cleaner.test.ts`<br>`CRM-1 cleaning rules and field audit` | **VERIFIED (Green)** |
| **`FR-CRM1-27-03`** | Unrecoverable required-field and syntax anomalies result in structured row rejection with standard reason codes. | **Must** | Issue #120 [CRM1-27] | Migration / QA | Unit | `apps/crm/modules/crm-1/tests/kit/cleaner.test.ts`<br>`CRM-1 cleaning rules and field audit` | **VERIFIED (Green)** |
| **`FR-CRM1-27-04`** | Batch cleaning service and summary metrics breakdown by rule_id and reason_code. | **Must** | Issue #120 [CRM1-27] | Service | Integration | `apps/crm/modules/crm-1/tests/services/crm1-cleaning.service.test.ts`<br>`Crm1CleaningService` | **VERIFIED (Green)** |
| **`FR-CRM1-27-05`** | Cleaning audit UI component renders before/after audit trail and rejected row tables. | **Should** | Issue #120 [CRM1-27] | Web | Component | `apps/crm/modules/crm-1/tests/web/cleaning-audit-page.test.ts`<br>`CleaningAuditPage Frontend Component` | **VERIFIED (Green)** |

---

## 3. Test Suite Registry & Test Counts

The CRM-1 automated test suite comprises 12 executing test files with 170 individual test cases:

```
apps/crm/modules/crm-1/tests/
├── api/
│   ├── list.test.ts                         (46 tests) — Server-side paged list/read contracts & search
│   ├── mutations.test.ts                    ( 3 tests) — Validated contact/company/lead CRUD & 422 errors
│   └── routes.test.ts                       ( 4 tests) — Route registration & Fastify plugin mounting
├── db/
│   └── schema.test.ts                       ( 4 tests) — PostgreSQL 18 schema check constraints & FKs
├── domain/
│   ├── qa-g1-design.test.ts                 (15 tests) — Data dictionary, ERD, traceability, dirty pack
│   └── relationships.test.ts                (16 tests) — Lifecycle allowlist, foreign key restrictions
├── kit/
│   └── cleaner.test.ts                      (20 tests) — Standard normalizers, field-level audit, row rejects
├── security/
│   └── authorization.test.ts                (51 tests) — EdDSA JWTs, RBAC 5 roles, sensitive masking, audit
├── services/
│   ├── crm1-cleaning.service.test.ts        ( 6 tests) — Batch cleaning service and summary metrics
│   └── crm1-mutation.service.test.ts        ( 2 tests) — Atomic target + receipt commit in 1 transaction
└── web/
    ├── cleaning-audit-page.test.ts          ( 3 tests) — Cleaning audit page frontend component and columns
    ├── data-table.test.ts                   (21 tests) — Paginated data table and column layout
    ├── routes.test.ts                       (14 tests) — Frontend route guards, layout shell, ARIA landmarks
    └── search-filters.test.ts               (17 tests) — Debounced search, faceted filter toolbar
-----------------------------------------------------------------------------------------------------------
Total Automated Test Cases: 222 tests (100% Green, 0 Failures, 0 Skipped in test DB run)
```

---

## 4. Gate G3 Sign-Off Verification

* [x] **Cleaning Execution:** All approved V1 cleaning rules execute deterministically.
* [x] **Field Audit:** Every modified value generates an audit entry with before/after diff and rule ID.
* [x] **Anomaly Rejection:** Unrecoverable required-field and syntax anomalies result in structured row rejections.
* [x] **Row Outcome Conservation:** Balance sheet `source = loaded + rejected + merged + skipped` strictly upheld.
* [x] **Zero Duplicate Platform Infra:** Reuses shared normalizers and registry from `@cs/core`.
