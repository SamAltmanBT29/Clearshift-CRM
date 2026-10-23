# ClearShift CRM — Dirty Data Pack Plan: CRM-4 Marketing Lists and Campaign History

**Module ID:** `CRM-4`
**Module Name:** Marketing Lists and Campaign History
**Owning Team:** Team `crm-marketing` (Group 4 — Role 4 Data / QA Lead)
**Target Milestone:** Gate G1 — Design Complete (Sprint 1)
**Traceability:** ClearShift Project Plan v3.0 §§9.3–9.6, 17; SDS ClearShift CRM v2.0 §4.5, §4.11, §4.12; Master Architecture Baseline 1.0-A §4.2; Issue #177 `[CRM4-24]`.

---

## 1. Objectives & Synthetic Test Strategy

The Dirty Data Pack Plan establishes the synthetic test fixture strategy for **CRM-4 Marketing Lists and Campaign History**. It defines the exact edge-case scenarios, seeded defect distributions, and expected row-level outcomes for validating the ClearShift migration pipeline under realistic legacy ingestion stress.

### Non-Negotiable Fixture Principles:
1. **100% Synthetic Data:** Zero real personal, customer, or employee data. All list names, campaign descriptions, contact identifiers, and consent assertions are generated deterministically using synthetic dictionaries.
2. **Stable Deterministic Generation:** Fixtures are generated with a fixed PRNG seed (Seed 44) ensuring byte-for-byte reproducibility across test runs.
3. **1-Indexed Source Rows:** Every source row is labeled with a stable 1-indexed `source_row` integer that persists through staging, profiling, cleaning, mapping, and audit logging.
4. **Conservation Accounting Invariant:**
   $$\text{source\_count} = \text{loaded\_count} + \text{rejected\_count} + \text{merged\_count} + \text{skipped\_count} \quad \text{and} \quad \text{unaccounted\_count} = 0$$
   Every parsed source row must reach exactly one terminal outcome. No row is ever silently dropped.
5. **Deterministic Deduplication:** Duplicate matching evaluates exact normalized keys only (`buildListExactKey`, `buildCampaignExactKey`, `buildMemberExactKey`, `buildConsentExactKey`). Fuzzy auto-merging is strictly prohibited.
6. **Monotonic Opt-Out Invariant (BR-CRM4-01):** Any migration row attempting to re-subscribe an already unsubscribed contact is detected as a fatal defect, logged in `crm4_import_rejects`, and rejected without overwriting the existing opt-out state.

---

## 2. Dataset Sizing & Balance Sheet Specifications

Two standardized test packs are defined:
1. **Canonical Module Pack (100 Rows):** Fast, targeted module test pack executed during unit and contract test suites.
2. **Canonical Integration Pack (1,000 Rows):** Full cross-module integration dataset conforming to SDS §4.11 / §4.12.

### Conservation Balance Sheet Target Values

| Metric | Module Pack (100 Rows) | Canonical Pack (1,000 Rows) | Description & Accounting Justification |
| :--- | :---: | :---: | :--- |
| **`source_count`** | **100** | **1,000** | Total raw source rows parsed from the input CSV/XLSX file. |
| **`loaded_count`** | **75** | **780** | Valid, clean records committed to target PostgreSQL tables with durable receipts. |
| **`rejected_count`** | **17** | **140** | Rows with unrecoverable defects (missing name, invalid date, invalid status, monotonic violation, broken FKs). |
| **`merged_count`** | **8** | **80** | Rows matching exact duplicate keys; merged into surviving golden records via deterministic exact matching. |
| **`skipped_count`** | **0** | **0** | Explicitly bypassed rows with approved business justification (0 in V1 baseline). |
| **`unaccounted_count`**| **0** | **0** | Missing or unexplained rows. **Must strictly equal 0**. |
| **Conservation Status**| **OK** | **OK** | Evaluates `source == loaded + rejected + merged + skipped`. |

---

## 3. Seeded Defect Distribution by Category

In accordance with SDS ClearShift CRM v2.0 §4.11 ("Known problems in the Dirty Data Pack"), the 100-row and 1,000-row packs seed defects across specific anomaly categories:

| Category ID | Category Name | Primary Target Entity | Count in 100-Pack | Count in 1,000-Pack | Expected Outcome | Stable Reason Code |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| `CAT-01` | **Clean Golden Records (Marketing Lists)** | List | 25 | 260 | `loaded` | None (Success) |
| `CAT-02` | **Clean Golden Records (Campaigns)** | Campaign | 25 | 260 | `loaded` | None (Success) |
| `CAT-03` | **Clean Golden Records (Campaign Members)** | Member | 15 | 160 | `loaded` | None (Success) |
| `CAT-04` | **Clean Golden Records (Consents)** | Consent | 10 | 100 | `loaded` | None (Success) |
| `CAT-05` | **Exact Duplicate Lists** | List | 4 (2 pairs) | 40 (20 pairs) | `merged` | `EXACT_LIST_DUPLICATE` |
| `CAT-06` | **Exact Duplicate Campaign Members** | Member | 4 (2 pairs) | 40 (20 pairs) | `merged` | `EXACT_MEMBER_DUPLICATE` |
| `CAT-07` | **Omitted Mandatory Name** | List | 3 | 25 | `rejected` | `EMPTY_MANDATORY_FIELD` |
| `CAT-08` | **Invalid Campaign Date Format** | Campaign | 3 | 25 | `rejected` | `INVALID_DATE_FORMAT` |
| `CAT-09` | **Invalid Member Status** | Member | 4 | 30 | `rejected` | `INVALID_MEMBER_STATUS` |
| `CAT-10` | **Monotonic Opt-Out Violation (BR-CRM4-01)** | Consent | 4 | 35 | `rejected` | `MONOTONIC_OPT_OUT_VIOLATION` |
| `CAT-11` | **Referential Orphan List Link** | Campaign | 3 | 25 | `rejected` | `ORPHAN_LIST_REFERENCE` |
| **Total** | | | **100** | **1,000** | | |

---

## 4. Execution Invariants & Rejection Threshold

1. **Deterministic Deduplication Candidate Keys:**
   - List key: `source_system + source_id` or trimmed lowercase name.
   - Campaign key: `normalizedName#listId#campaignDate`.
   - Member key: `campaignId#contactId`.
   - Consent key: `contactId`.

2. **10% Halt Threshold (Excessive Failures Policy):**
   - The migration engine monitors cumulative rejection rates in 500-row chunks.
   - If `rejected_count / attempted_count > 0.10` (10%) at any point after the first batch, migration halts immediately with error code `STOPPED_EXCESSIVE_FAILURES`.
   - Completed batches retain durable receipts in `crm4_import_receipts`, preserving partial progress without corrupting data integrity.
