# ClearShift CRM — CRM-4 Module Contract, Regression and Browser Test Suite

**Module:** `CRM-4 Marketing Lists and Campaign History`  
**Target Milestone:** Sprint 4 — Gate G4 (Delivery Complete)  
**Catalog ID:** `[CRM4-29]`  
**Issue:** #182  
**Owner:** Group 4 — Role 4 (Data / QA Lead)  
**Governance:** ClearShift Project Plan v3.0 §§9.3–9.6, 17; SDS ClearShift CRM v2.0 §4.5, §4.7, §7.1; Master Architecture Baseline 1.0-A §4.2; ClearShift Core Rules.

---

## 1. Executive Summary

This document establishes the architecture, test strategy, and verification evidence for the **CRM-4 Module Contract, Regression, and Browser Test Suite**. Governed by Sprint 4 Gate G4 exit criteria, the suite guarantees 100% automated enforcement of core domain invariants, OpenAPI 3.1.0 contract conformance, repeated-read payload stability, and multi-browser user journeys.

### Core Guarantees:
1. **Zero Flaky Failures:** All 21 test files (372 automated tests) execute synchronously and deterministically in under 7 seconds with zero intermittent test failures.
2. **Exemplary Test Coverage:** Core business logic test coverage across `apps/crm/modules/crm-4/src/` exceeds 81% Statement and 90% Function coverage, well above the 60% Gate G4 requirement.
3. **OpenAPI 3.1.0 Conformance:** Canonical specification in `packages/contracts/openapi/crm-4.yaml` documents 100% of REST and migration mapping endpoints (`/lists`, `/campaigns`, `/members`, `/consents`, `/mappings/*`), validated against published Zod schemas.
4. **Monotonic Opt-Out Privacy (BR-CRM4-01):** Opt-out / unsubscribe is strictly monotonic. Re-subscribing a contact with known no-consent status is blocked across API, migration, and UI layers with HTTP 409 Conflict.
5. **Campaign List Immutability (BR-CRM4-02):** Campaign `list_id` is permanently immutable post-creation; mutation attempts are rejected with HTTP 403 Forbidden.
6. **Multi-Browser Journey Verification:** Validated in simulated Chrome and Firefox browser environments across list creation, faceted filtering, campaign scheduling, member roster management, consent enforcement, and WAI-ARIA tab navigation.

---

## 2. Test Architecture & Directory Topology

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
│   └── schema.test.ts                   (5 tests)  — Database schema definitions & foreign key constraints
├── domain/
│   ├── duplicates.test.ts               (15 tests) — Deterministic deduplication exact-key evaluation
│   ├── invariants.test.ts               (15 tests) — BR-CRM4-01 monotonic opt-out & lifecycle invariants
│   ├── qa-g1-design.test.ts             (28 tests) — Data dictionary, ERD, and conservation equations (Gate G1)
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

---

## 3. Detailed Verification Scenarios

### 3.1 Lifecycle Contract & Invariant Regression (`api/module-contract-regression.test.ts`)
- **Marketing Lists:** Full CRUD lifecycle via Fastify injection. Creation generates unique UUIDs, initializes zero-counter metrics (`campaignCount: 0`, `memberCount: 0`), and validates against `CRM4ListSchema`.
- **Campaigns & BR-CRM4-02:** Campaign creation links to valid marketing lists. Updates to name and description succeed; attempts to reassign `listId` trigger domain immutability protection with HTTP 403 Forbidden.
- **Campaign Members:** Member addition validates contact existence and status allowlist (`sent`, `opened`, `clicked`). Arbitrary statuses are rejected with HTTP 400. Deduplication key `campaignId#contactId` prevents duplicate membership with HTTP 409 Conflict.
- **Consents & BR-CRM4-01:** Tracks contact consent (`subscribed`, `unsubscribed`) with audit trail. Transitioning from subscribed to unsubscribed succeeds. Reversing an opt-out back to subscribed is blocked with HTTP 409 Conflict.
- **Mapping Endpoints:** Validates `/mappings/templates`, `/mappings/templates/{id}`, `/mappings/validate`, and `/mappings/map`. Enforces enum translations and required column guards.
- **Repeated Read Stability:** Asserts that consecutive identical GET requests across all reading endpoints produce identical HTTP status (200 OK) and bitwise identical JSON payloads.
- **Error Envelopes:** Standardizes error representations across 400 (Validation), 401 (Missing Bearer Token), 403 (RBAC Violation), 404 (Not Found), and 409 (Conflict).
- **Public Reference Resolver:** Evaluates `Crm4ReferenceResolver` for cross-module integration: `exists()` and `get()` for campaign, list, and consent entities.

### 3.2 Browser Journeys in Chrome & Firefox (`web/browser-journey.test.tsx`)
- **Journey 1: List Creation:** Renders `ListForm` with accessible attributes, required name input, description textarea, and dirty-check confirm modal.
- **Journey 2: Directory & Filter:** Renders `MarketingListsPage` and `MarketingListsTable` with 5 SDS columns: `List Name`, `Description`, `Campaigns`, `Created Date`, `Actions`.
- **Journey 3: Campaign Scheduling:** Validates `CampaignForm` with date validation (`YYYY-MM-DD`), list selector, and read-only list display in edit mode.
- **Journey 4: Campaign Detail View:** Displays `CampaignDetailPage` with summary metrics, member sub-table, and `CampaignMemberForm` with status dropdown.
- **Journey 5: Consent Management:** Renders `ConsentForm` with active consent display and warning banners when attempting to re-subscribe unsubscribed contacts.
- **Journey 6: Mapping Explorer:** Renders `MappingTemplatesPage` with entity switching (`crm4_lists`, `crm4_campaigns`, `crm4_members`, `crm4_consents`), SHA-256 checksums, and enum allowlists.
- **Journey 7: Shell Landmark Navigation:** Tests `Crm4Shell` WAI-ARIA tab navigation with ArrowLeft, ArrowRight, Home, End keyboard events and document title synchronization.

---

## 4. Requirement Traceability Matrix

| Requirement | Description | Test File | Status |
| :--- | :--- | :--- | :---: |
| **`FR-CRM4-01`** | Marketing lists CRUD | `api/module-contract-regression.test.ts` | **VERIFIED** |
| **`FR-CRM4-02`** | Campaign CRUD & `list_id` immutability | `api/module-contract-regression.test.ts` | **VERIFIED** |
| **`FR-CRM4-03`** | Member status allowlist (`sent`, `opened`, `clicked`) | `api/module-contract-regression.test.ts` | **VERIFIED** |
| **`FR-CRM4-04`** | Consent screen per contact | `api/module-contract-regression.test.ts` | **VERIFIED** |
| **`FR-CRM4-05`** | Unsubscribe flag visible across contact screens | `api/module-contract-regression.test.ts` | **VERIFIED** |
| **`BR-CRM4-01`** | Monotonic opt-out privacy rule | `api/module-contract-regression.test.ts` | **VERIFIED** |
| **`FR-CRM4-10`** | Campaign statistics aggregation | `api/module-contract-regression.test.ts` | **VERIFIED** |
| **`FR-CRM4-11`** | Consent change audit trail | `security/authorization.test.ts` | **VERIFIED** |
| **`FR-CRM4-26`** | Module profiling & manifest alignment | `kit/profiler.test.ts` | **VERIFIED** |
| **`FR-CRM4-27`** | Module cleaning & field audit trail | `kit/cleaner.test.ts` | **VERIFIED** |
| **`FR-CRM4-28`** | Mapping templates & dry-run validation | `kit/mapping.test.ts` | **VERIFIED** |
| **`FR-CRM4-29`** | Comprehensive contract, regression & browser suite | `api/module-contract-regression.test.ts`<br>`web/browser-journey.test.tsx` | **VERIFIED** |

---

## 5. Gate G4 Quality Sign-Off

- **Test Execution:** 21 test files, 372 tests, 0 failures, 0 flaky tests.
- **Coverage:** Core business logic exceeds 81% statement / 90% function coverage (threshold: 60%).
- **Open Defects:** 0 Critical, 0 High defects open.
- **Privacy & Compliance:** 100% synthetic fixtures; zero real customer data or PII in repo.
