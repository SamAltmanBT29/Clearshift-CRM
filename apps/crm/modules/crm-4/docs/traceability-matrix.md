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

---

## 3. Test Suite Registry & Test Counts

The CRM-4 test suite comprises executing test files verifying schema, security, domain invariants, and web APIs:

```
apps/crm/modules/crm-4/tests/
├── domain/
│   └── qa-g1-design.test.ts             — Data dictionary, ERD, and conservation equations (Gate G1)
├── security/
│   └── authorization.test.ts            (46 tests) — EdDSA auth, RBAC capability matrix, tenant isolation
└── web/
    └── routes.test.ts                   — API route contracts, Zod validations, CRUD handling
```
