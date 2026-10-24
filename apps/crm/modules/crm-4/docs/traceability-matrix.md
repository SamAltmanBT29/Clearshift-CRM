# ClearShift CRM — Requirement-to-Test Traceability Matrix: CRM-4

**Module ID:** `CRM-4`
**Module Name:** Marketing Lists and Campaign History
**Owning Team:** Team `crm-marketing` (Group 4 — Role 4 Data / QA Lead)
**Schema Version:** 1.0.0
**Target Milestone:** Gate G1 — Design Complete (Sprint 1)
**Traceability:** ClearShift Project Plan v3.0 §§9.3–9.6, 17; SDS ClearShift CRM v2.0 §4.5, §4.7; Master Architecture Baseline 1.0-A §4.2; Issue #177 `[CRM4-24]`.

---

## 1. Executive Summary & Verification Standard

This Requirement-to-Test Traceability Matrix maps 100% of functional requirements, domain rules, privacy invariants, and migration safety guarantees for **CRM-4 Marketing Lists and Campaign History** to automated test suites in the repository.

### Verification Standards:
1. **Automated Test Coverage:** Every "Must" requirement is asserted by at least one executing unit, contract, schema, or regression test suite.
2. **Deterministic Duplicate Matching:** Deduplication rules rely solely on exact normalized keys; fuzzy auto-merge is strictly prohibited.
3. **Monotonic Privacy Enforcement (BR-CRM4-01):** Opt-out / unsubscribe is strictly monotonic. Once unsubscribed, re-subscription via migration, bulk load, or UI action is blocked and reported.
4. **Synthetic Fixtures Only:** All test fixtures are 100% synthetic; zero real personal, customer, or employee data permitted.
5. **Zero Silent Drops:** The row conservation equation $\text{source} = \text{loaded} + \text{rejected} + \text{merged} + \text{skipped}$ ($\text{unaccounted} = 0$) is enforced on every dataset.

---

## 2. Requirement Traceability Matrix

| Requirement ID | Requirement Description | Priority | Source Authority | Domain Layer | Test Type | Automated Test Suite & File Location | Verification Status |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :---: |
| **`FR-CRM4-01`** | Create and edit marketing lists (name, description, campaign/member counters). | **Must** | SDS CRM v2.0 §4.5 | API / Web | Contract | `apps/crm/modules/crm-4/tests/web/routes.test.ts` | **VERIFIED (Green)** |
| **`FR-CRM4-02`** | Create and edit campaign (name, date, list link). `list_id` is **IMMUTABLE** after creation. | **Must** | SDS CRM v2.0 §4.5 | Domain / API | Regression | `apps/crm/modules/crm-4/tests/security/authorization.test.ts` | **VERIFIED (Green)** |
| **`FR-CRM4-03`** | Campaign member rows: contact, status (sent, opened, clicked), unsubscribe flag. Arbitrary states rejected. | **Must** | SDS CRM v2.0 §4.5 | Database / API | Schema | `apps/crm/modules/crm-4/tests/domain/qa-g1-design.test.ts`<br>`apps/crm/modules/crm-4/tests/web/routes.test.ts` | **VERIFIED (Green)** |
| **`FR-CRM4-04`** | Consent screen per contact: status (subscribed / unsubscribed), date, source. | **Must** | SDS CRM v2.0 §4.5 | API / Web | Contract | `apps/crm/modules/crm-4/tests/web/routes.test.ts` | **VERIFIED (Green)** |
| **`FR-CRM4-05`** | Unsubscribe flag is visible on the contact screen across CRM modules via public reference projection. | **Must** | SDS CRM v2.0 §4.5 | Web / API | Unit | `apps/crm/modules/crm-4/src/public.ts`<br>`apps/crm/modules/crm-4/tests/web/routes.test.ts` | **VERIFIED (Green)** |
| **`BR-CRM4-01`** | **Opt-out / unsubscribe is strictly monotonic.** A contact with status "unsubscribed" can never be added to a list or re-subscribed. | **Must** | SDS CRM v2.0 §4.5 | Domain / Migration | Unit | `apps/crm/modules/crm-4/tests/domain/qa-g1-design.test.ts`<br>`packages/contracts/src/crm-4.ts` | **VERIFIED (Green)** |
| **`FR-CRM4-10`** | Campaign statistics: sent / opened / clicked / unsubscribed counts and percentages per campaign. | **Must** | SDS CRM v2.0 §7.1 | API | Contract | `apps/crm/modules/crm-4/tests/web/routes.test.ts` | **VERIFIED (Green)** |
| **`FR-CRM4-11`** | Consent history: all consent changes with date, source, and user audit trail. | **Must** | SDS CRM v2.0 §7.1 | Security | Security | `apps/crm/modules/crm-4/tests/security/authorization.test.ts` | **VERIFIED (Green)** |
| **`BR-CRM4-DUP-01`** | Deterministic list deduplication candidate key: `source_system + source_id` or normalized lowercase name. | **Must** | ClearShift Core Rules & SDS §4.11 | Domain | Unit | `apps/crm/modules/crm-4/tests/domain/qa-g1-design.test.ts` | **VERIFIED (Green)** |
| **`BR-CRM4-DUP-02`** | Deterministic campaign deduplication candidate key: `normalizedName#listId#campaignDate`. | **Must** | ClearShift Core Rules & SDS §4.11 | Domain | Unit | `apps/crm/modules/crm-4/tests/domain/qa-g1-design.test.ts` | **VERIFIED (Green)** |
| **`BR-CRM4-DUP-03`** | Deterministic member uniqueness candidate key: `campaignId#contactId`. | **Must** | ClearShift Core Rules & SDS §4.11 | Domain | Unit | `apps/crm/modules/crm-4/tests/domain/qa-g1-design.test.ts` | **VERIFIED (Green)** |
| **`MIG-CRM4-01`** | Target domain mutation and migration import receipt commit together in one local database transaction. | **Must** | KIT-08 & Decision C4 | Migration | Integration | `apps/crm/modules/crm-4/tests/domain/qa-g1-design.test.ts` | **VERIFIED (Green)** |
| **`MIG-CRM4-02`** | Row conservation balance sheet: `source = loaded + rejected + merged + skipped` (`unaccounted = 0`). | **Must** | ClearShift Core Rules | Migration | Unit | `apps/crm/modules/crm-4/tests/domain/qa-g1-design.test.ts` | **VERIFIED (Green)** |
| **`MIG-CRM4-03`** | Bounded batching (500 rows) and stop migration when failures exceed 10% of attempted rows. | **Must** | ClearShift Core Rules & SDS §4.11 | Migration | Unit | `apps/crm/modules/crm-4/tests/domain/qa-g1-design.test.ts` | **VERIFIED (Green)** |
| **`FR-CRM4-26`** | Module profiling configuration: column statistics, duplicate counts, non-destructive execution, and scorecard manifest alignment. | **Must** | SDS CRM v2.0 §4.5, §4.7 & Issue #179 | Migration | Unit | `apps/crm/modules/crm-4/tests/kit/profiler.test.ts` | **VERIFIED (Green)** |
| **`FR-CRM4-27`** | Module cleaning configuration: standard cleaners, field-level change audit trail, structured rejections, and row conservation. | **Must** | SDS CRM v2.0 §4.5, §4.7 & Issue #180 | Migration | Unit | `apps/crm/modules/crm-4/tests/kit/cleaner.test.ts` | **VERIFIED (Green)** |
| **`FR-CRM4-28`** | Mapping and value translation configuration: canonical/legacy mapping templates, deterministic type coercion, enum allowlists/translations, dry-run guards, and BR-CRM4-01 monotonic opt-out rule. | **Must** | SDS CRM v2.0 §4.5, §4.7 & Issue #181 | Migration | Unit | `apps/crm/modules/crm-4/tests/kit/mapping.test.ts` | **VERIFIED (Green)** |
| **`FR-CRM4-29`** | Module contract, regression and browser test suite: comprehensive end-to-end API lifecycle, deterministic deduplication and immutability invariants, repeated read payload stability, Zod/OpenAPI contract conformance, cross-module reference resolution, and browser journeys across core entities. | **Must** | SDS CRM v2.0 §4.5, §7.1 & Issue #182 | API / Web | Regression | `apps/crm/modules/crm-4/tests/api/module-contract-regression.test.ts`<br>`apps/crm/modules/crm-4/tests/web/browser-journey.test.tsx` | **VERIFIED (Green)** |
| **`FR-CRM4-30`** | Module reconciliation proof and Gate G4 evidence pack: mathematical conservation proof (`source = loaded + rejected + merged + skipped`, `unaccounted = 0`), relational link integrity across marketing lists, campaigns, members, and consents, durable import receipt completeness, and Gate G4 acceptance pack sign-off documentation. | **Must** | SDS CRM v2.0 §4.5, §4.7, §4.12 & Issue #183 | Migration | Regression | `apps/crm/modules/crm-4/tests/domain/reconciliation-acceptance.test.ts` | **VERIFIED (Green)** |

---

## 3. Test Suite Registry & Test Counts

The CRM-4 test suite comprises 22 executing test files verifying schema, security, domain invariants, API contracts, browser journeys, and migration reconciliation proofs (386 automated tests):

```
apps/crm/modules/crm-4/tests/
├── api/
│   ├── list.test.ts                     (27 tests) — Marketing list endpoints and queries
│   ├── mapping-routes.test.ts           (10 tests) — Mapping templates, validate & map endpoints
│   ├── module-contract-regression.test.ts (12 tests) — Comprehensive regression & contract conformance suite
│   ├── mutations.test.ts                (22 tests) — Lifecycle mutations and idempotency
│   └── routes.test.ts                   (24 tests) — Route authentication and error envelopes
├── contracts/
│   └── openapi.test.ts                  (9 tests)  — OpenAPI 3.1.0 schema conformance & Zod alignment
├── db/
│   └── schema.test.ts                   (6 tests)  — Database schema definitions & foreign key constraints
├── domain/
│   ├── duplicates.test.ts               (15 tests) — Deterministic deduplication exact-key evaluation
│   ├── invariants.test.ts               (15 tests) — BR-CRM4-01 monotonic opt-out & lifecycle invariants
│   ├── qa-g1-design.test.ts             (28 tests) — Data dictionary, ERD, and conservation equations (Gate G1)
│   ├── reconciliation-acceptance.test.ts (13 tests) — Migration reconciliation proof & Gate G4 audit verification
│   └── relationships.test.ts            (24 tests) — Entity relationships & cross-module link constraints
├── fixtures/
│   └── dirty-pack.test.ts               (22 tests) — Canonical 100-row dirty data pack & manifest
├── kit/
│   ├── cleaner.test.ts                  (22 tests) — Standard cleaners, field-level audit & row rejections
│   ├── mapping.test.ts                  (20 tests) — Mapping templates, type coercions & dry-run guards
│   ├── profiler.test.ts                 (21 tests) — Profiling stats, duplicate detection & manifest comparison
│   └── target-adapter.test.ts           (13 tests) — Target domain mutation & durable receipts
├── security/
│   └── authorization.test.ts            (46 tests) — EdDSA auth, RBAC capability matrix, tenant isolation
├── services/
│   └── crm4-mapping.service.test.ts     (5 tests)  — Mapping service unit tests
└── web/
    ├── browser-journey.test.tsx         (12 tests) — Multi-browser Chrome/Firefox user journeys across core entities
    ├── mapping-templates-page.test.ts   (4 tests)  — Migration mapping UI rendering & interactions
    └── routes.test.ts                   (16 tests) — Navigation routes, breadcrumbs & title formatting
```
