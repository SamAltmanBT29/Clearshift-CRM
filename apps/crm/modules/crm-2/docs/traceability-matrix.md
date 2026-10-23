# ClearShift CRM — Requirement-to-Test Traceability Matrix: CRM-2

**Module ID:** `CRM-2`  
**Module Name:** Deals, Pipeline Stages and Quotes  
**Owning Team:** Team `crm-deals` (Group 2 — Role 4 Data / QA Lead)  
**Schema Version:** 1.0.0  
**Target Milestone:** Gate G1 — Design Complete (Sprint 1)  
**Traceability:** ClearShift Project Plan v3.0 §§9.3–9.6, 17; SDS ClearShift CRM v2.0 §4.2, §4.7, §4.11, §4.12; Master Architecture Baseline 1.0-A §4.2; Issue #137 `[CRM2-24]`.

---

## 1. Executive Summary & Verification Standard

This Requirement-to-Test Traceability Matrix maps 100% of functional requirements, domain rules, pipeline lifecycle invariants, and migration safety guarantees for **CRM-2 Deals, Pipeline Stages and Quotes** to automated test suites in the repository.

### Verification Standards:
1. **Automated Test Coverage:** Every "Must" requirement is asserted by at least one executing unit, contract, schema, or integration test suite.
2. **Deterministic Execution:** Duplicate detection and lifecycle rules rely solely on exact normalized keys and strict state machine graphs; fuzzy scoring is strictly prohibited.
3. **Synthetic Fixtures Only:** All test fixtures are 100% synthetic; no real personal or commercial data is permitted.
4. **Minimum Domain Coverage:** Domain logic and route suites demonstrate green passes with $\ge 60\%$ statement and line coverage.

---

## 2. Requirement Traceability Matrix

| Requirement ID | Requirement Description | Priority | Source Authority | Domain Layer | Test Type | Automated Test Suite & File Location | Verification Status |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :---: |
| **`FR-CRM2-01`** | Show paginated deals list with search by name, stage filtering, and bounded pagination (25 per page, max 100). | **Must** | SDS CRM v2.0 §4.2 | API / Web | Contract | `apps/crm/modules/crm-2/tests/api/crm2-routes.test.ts`<br>`apps/crm/modules/crm-2/web/tests/deals-table.test.ts` | **VERIFIED (Green)** |
| **`FR-CRM2-02`** | Create and edit deal: name, monetary value (decimal arithmetic), currency (ISO-4217), stage, close date, optional contact link. | **Must** | SDS CRM v2.0 §4.2 | API / Domain | Regression | `apps/crm/modules/crm-2/tests/api/crm2-routes.test.ts`<br>`apps/crm/modules/crm-2/web/tests/DealForm.test.tsx` | **VERIFIED (Green)** |
| **`FR-CRM2-03`** | Strict 6-stage sales pipeline state transitions: `New -> Qualified -> Proposal -> Negotiation -> Won`; active stages can transition to `Lost`; `Won` and `Lost` are terminal. Backward/skip moves return 422. | **Must** | SDS CRM v2.0 §4.2 | Domain | Unit | `apps/crm/modules/crm-2/tests/domain/relationships.test.ts`<br>`CRM-2 Relationships & State Transitions (Issue #21 / [CRM2-06])` | **VERIFIED (Green)** |
| **`FR-CRM2-04`** | Allow orphan deals with nullable `contact_id`; render visible orphan warning in UI without silently hiding records. | **Must** | SDS CRM v2.0 §4.2 | Web | Unit | `apps/crm/modules/crm-2/web/tests/deals-table.test.ts`<br>`apps/crm/modules/crm-2/web/tests/DealDetailPage.test.tsx` | **VERIFIED (Green)** |
| **`FR-CRM2-05`** | Create, read, and manage quotes linked to deals: unique `quote_number`, `quote_date`, `amount`, `currency`, `note`, `deal_id`. | **Must** | SDS CRM v2.0 §4.2 | API / Web | Contract | `apps/crm/modules/crm-2/tests/api/crm2-routes.test.ts`<br>`apps/crm/modules/crm-2/web/tests/QuoteForm.test.tsx` | **VERIFIED (Green)** |
| **`FR-CRM2-06`** | Calculate quote totals and deal sums using server-computed decimal arithmetic (`NUMERIC(14,2)`); never floating point numbers. | **Must** | ClearShift Core Rules & SDS §4.2 | Domain | Unit | `apps/crm/modules/crm-2/tests/domain/relationships.test.ts`<br>`CRM-2 Relationships & Domain Invariants` | **VERIFIED (Green)** |
| **`FR-CRM2-07`** | Provide fixed stage seed dataset (`New`, `Qualified`, `Proposal`, `Negotiation`, `Won`, `Lost`); runtime stage renaming and deletion are rejected. | **Must** | SDS CRM v2.0 §4.2 | Database | Schema | `apps/crm/modules/crm-2/tests/schema.test.sql`<br>`CRM-2 Schema & Guarded Migrations (Issue #16 / [CRM2-01])` | **VERIFIED (Green)** |
| **`FR-CRM2-08`** | Emit `deal.won` domain event through transactional outbox with approved event contract when deal reaches Won stage. | **Must** | SDS CRM v2.0 §8 & Project Plan §8 | Domain | Unit | `apps/crm/modules/crm-2/tests/domain/relationships.test.ts`<br>`CRM-2 Won Event Schema & Contracts` | **VERIFIED (Green)** |
| **`BR-CRM2-DUP-01`** | Deterministic deal duplicate candidate key based on normalized `source_system + source_id`. | **Must** | SDS v2.0 §4.11 & Baseline | Domain | Unit | `apps/crm/modules/crm-2/tests/domain/qa-g1-design.test.ts`<br>`CRM-2 QA Gate G1 Design Specifications` | **VERIFIED (Green)** |
| **`BR-CRM2-DUP-02`** | Deterministic deal business duplicate candidate key: `${normalizedName}#${stageId}#${contactId || "orphan"}`. No fuzzy matching. | **Must** | ClearShift Core Rules & SDS §4.11 | Domain | Unit | `apps/crm/modules/crm-2/tests/domain/qa-g1-design.test.ts`<br>`CRM-2 QA Gate G1 Design Specifications` | **VERIFIED (Green)** |
| **`BR-CRM2-DUP-03`** | Quote unique key normalization: `quote_number` trimmed and uppercase. | **Must** | SDS CRM v2.0 §4.2 | Domain | Unit | `apps/crm/modules/crm-2/tests/domain/qa-g1-design.test.ts`<br>`CRM-2 QA Gate G1 Design Specifications` | **VERIFIED (Green)** |
| **`MIG-CRM2-01`** | Target domain mutation and migration import receipt commit together in one local database transaction. | **Must** | KIT-08 & Decision C4 | Migration | Integration | `apps/crm/modules/crm-2/tests/api/crm2-routes.test.ts`<br>`CRM-2 Target Adapter & Durable Receipts` | **VERIFIED (Green)** |
| **`MIG-CRM2-02`** | Row conservation balance sheet: `source = loaded + rejected + merged + skipped` (`unaccounted = 0`). | **Must** | ClearShift Core Rules | Migration | Unit | `apps/crm/modules/crm-2/tests/domain/qa-g1-design.test.ts`<br>`CRM-2 QA Gate G1 Design Specifications` | **VERIFIED (Green)** |
| **`MIG-CRM2-03`** | Bounded batching (500 rows), idempotent retries with exponential backoff, and stop migration when failures exceed 10% of attempted rows (`STOPPED_EXCESSIVE_FAILURES`). | **Must** | ClearShift Core Rules & SDS §4.2 | Migration | Unit / API | `apps/crm/modules/crm-2/tests/domain/batch-loader.test.ts`<br>`apps/crm/modules/crm-2/tests/api/batch-loader.test.ts`<br>`apps/crm/modules/crm-2/tests/migration/target-adapter.test.ts`<br>`apps/crm/modules/crm-2/web/tests/batch-loader-ui.test.tsx` | **VERIFIED (Green)** |

---

## 3. Test Suite Registry & Test Counts

The CRM-2 automated test suite currently comprises 12 executing test files with 250+ individual test assertions:

```
apps/crm/modules/crm-2/
├── tests/
│   ├── api/
│   │   ├── crm2-routes.test.ts              (23 tests) — CRUD routes, Zod validation, stage filtering
│   │   ├── mutations.test.ts                (32 tests) — Deal and quote mutations, RBAC authorization
│   │   ├── list.test.ts                     (34 tests) — Bounded pagination, non-overlapping sorting
│   │   └── batch-loader.test.ts             (10 tests) — Batch execute-load, 500-chunking, 10% halt (CRM2-13)
│   ├── domain/
│   │   ├── relationships.test.ts            (51 tests) — State transitions, decimal sums, won events
│   │   ├── qa-g1-design.test.ts             (18 tests) — Data dictionary, ERD, and conservation equations
│   │   └── batch-loader.test.ts             (9 tests)  — 500 chunking, backoff delays, 10% halt policy (CRM2-13)
│   ├── migration/
│   │   └── target-adapter.test.ts           (5 tests)  — Target adapter port, durable receipts, dry-run preflight
│   └── schema.test.sql                      (SQL test) — Stage checks, currency format, non-negative checks
└── web/tests/
    ├── deals-table.test.ts                  (12 tests) — Search, filter, sorting, pagination, orphan badges
    ├── DealForm.test.tsx                    (11 tests) — Deal creation/editing forms and validation
    ├── QuoteForm.test.tsx                   (7 tests)  — Quote create/edit workflows
    ├── DealDetailPage.test.tsx              (5 tests)  — Deal details and derived quote totals
    ├── domain-invariants.test.ts            (8 tests)  — Frontend state machine and invariant guards
    └── batch-loader-ui.test.tsx             (4 tests)  — Batch loader monitor UI, 500 chunks, halt alert (CRM2-13)
```
