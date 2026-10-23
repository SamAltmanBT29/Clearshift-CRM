# ClearShift CRM — Dirty Data Pack Plan: CRM-5 Migration Control Center

**Module ID:** `CRM-5`
**Module Name:** Migration Control Center and Reports
**Owning Team:** Team `crm-reports` (Group 5 — Role 4 Data / QA Lead)
**Target Milestone:** Gate G1 — Design Complete (Sprint 1)
**Traceability:** ClearShift Project Plan v3.0 §§9.3–9.6, 17; SDS ClearShift CRM v2.0 §4.11, §4.12; Master Architecture Baseline 1.0-A §4.2; Master Architecture Spec §Slot 25; Issue #197 `[CRM5-24]`.

---

## 1. Objectives & Synthetic Test Strategy

The Dirty Data Pack Plan establishes the synthetic test fixture strategy for **CRM-5 Migration Control Center and Reports**. It defines the exact edge-case scenarios, seeded defect distributions, and expected row-level outcomes for validating the ClearShift migration pipeline under realistic stress conditions.

### Non-Negotiable Fixture Principles:
1. **100% Synthetic Data:** Zero real personal, employee, customer, or commercial data. All run IDs, batch titles, worker names, record counts, and notes are generated deterministically using synthetic generators.
2. **Deterministic Reproducibility:** Fixtures are generated with a fixed PRNG seed (Seed 42) ensuring byte-for-byte reproducibility across all test runs and CI runners.
3. **1-Indexed Source Rows:** Every source row is labeled with a stable 1-indexed `source_row` integer that persists through staging, profiling, cleaning, mapping, and audit logging.
4. **Conservation Accounting Invariant:**
   $$\text{source\_count} = \text{loaded\_count} + \text{rejected\_count} + \text{merged\_count} + \text{skipped\_count} \quad \text{and} \quad \text{unaccounted\_count} = 0$$
   Every parsed source row must reach exactly one terminal outcome. No row is ever dropped silently.
5. **Deterministic Deduplication:** Duplicate matching evaluates exact normalized keys only (`batch_id + step`, `id`, `email`, `tax_id`, `phone`, `sku`). Fuzzy auto-merging is strictly prohibited.

---

## 2. Dataset Sizing & Balance Sheet Specifications

Two standardized test packs are defined:
1. **Canonical Module Pack (100 Rows):** Fast, targeted module test pack executed during unit, contract, and profiler test suites (`dirty-pack-100.csv` and `manifest.json`).
2. **Canonical Integration Pack (1,000 Rows):** Full cross-module integration dataset conforming to SDS §4.11 / §4.12.

### Conservation Balance Sheet Target Values

| Metric | Module Pack (100 Rows) | Canonical Pack (1,000 Rows) | Description & Accounting Justification |
| :--- | :---: | :---: | :--- |
| **`source_count`** | **100** | **1,000** | Total raw source rows parsed from the input CSV/XLSX file. |
| **`loaded_count`** | **50** | **780** | Valid, clean records committed to target PostgreSQL tables with durable receipts. |
| **`rejected_count`** | **45** | **140** | Rows with unrecoverable defects (missing required, malformed UUID, invalid timestamps, boundary errors). |
| **`merged_count`** | **5** | **80** | Rows matching exact duplicate keys; merged into surviving canonical records via human review. |
| **`skipped_count`** | **0** | **0** | Explicitly bypassed rows with approved business justification (0 in V1 baseline). |
| **`unaccounted_count`**| **0** | **0** | Missing or unexplained rows. **Must strictly equal 0**. |
| **Conservation Status**| **OK** | **OK** | Evaluates $\text{source} == \text{loaded} + \text{rejected} + \text{merged} + \text{skipped}$. |

---

## 3. Seeded Defect Distribution by Category

In accordance with SDS ClearShift CRM v2.0 §4.11 ("Known problems in the Dirty Data Pack") and `manifest.json`, the 100-row and 1,000-row packs seed defects across 11 disjoint anomaly categories:

| Category ID | Category Name | Primary Target Entity | Count in 100-Pack | Count in 1,000-Pack | Expected Outcome | Stable Reason Code |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| `CAT-01` | **Clean Golden Records** | `crm5_runs` | 50 | 780 | `loaded` | None (Success) |
| `CAT-02` | **Missing Mandatory Fields (`NULL_REQUIRED`)** | `crm5_runs` | 7 | 25 | `rejected` | `NULL_REQUIRED_FIELD` |
| `CAT-03` | **Exact Duplicate Key Candidates (`EXACT_DUPLICATE`)** | `crm5_runs` | 5 | 80 | `merged` (Human Review) | `EXACT_DUPLICATE_KEY` |
| `CAT-04` | **Missing External References (`FOREIGN_KEY_MISSING`)** | `crm5_runs` | 5 | 20 | `rejected` | `REFERENCE_NOT_FOUND` |
| `CAT-05` | **Unstripped Whitespace (`WHITESPACE_PADDING`)** | `crm5_runs` | 5 | 15 | `rejected` / `cleaned` | `WHITESPACE_IN_IDENTIFIER` |
| `CAT-06` | **Non-ISO Date Variants (`DATE_FORMAT_VARIANTS`)** | `crm5_runs` | 6 | 20 | `rejected` | `INVALID_TIMESTAMP_FORMAT` |
| `CAT-07` | **Boundary & Negative Numbers (`BOUNDARY_NUMBERS`)** | `crm5_runs` | 5 | 15 | `rejected` | `RECORD_COUNT_OUT_OF_BOUNDS` |
| `CAT-08` | **Syntax-Violating UUIDs (`MALFORMED_UUID`)** | `crm5_runs` | 4 | 15 | `rejected` | `INVALID_UUID_SYNTAX` |
| `CAT-09` | **Record Count Conservation Invariant Violations** | `crm5_runs` | 4 | 15 | `rejected` | `COUNT_CONSERVATION_VIOLATION` |
| `CAT-10` | **Chronological Inversions (`completed_at < started_at`)** | `crm5_runs` | 3 | 10 | `rejected` | `CHRONOLOGY_VIOLATION` |
| `CAT-11` | **Corrupted JSON Telemetry (`MALFORMED_JSON_METADATA`)** | `crm5_runs` | 3 | 10 | `rejected` | `INVALID_JSON_SYNTAX` |
| `CAT-12` | **Spreadsheet Formula Injections (`FORMULA_INJECTION_RISK`)** | `crm5_runs` | 3 | 10 | `rejected` | `FORMULA_INJECTION_PREFIX` |

---

## 4. Edge-Case Coverage & Disjoint Invariant Assertions

The CRM-5 Canonical Dirty Data Pack asserts 4 mandatory edge-case classes:
1. **UTF-8 Character Encodings:** Multi-byte Unicode characters, accented glyphs, and non-ASCII module descriptors.
2. **Whitespace Padding:** Unstripped leading, trailing, and tab whitespace characters tested against sanitizing cleaners.
3. **Date Format Variants:** Mixed date representations (`DD/MM/YYYY`, localized dates, non-UTC timestamps) validating strict ISO-8601 parsing.
4. **Boundary Numbers:** Negative counters (`-10`), zero values, and integer maximums (`2,147,483,647`) asserting schema bounds.

### Disjoint Partitioning Guarantee
Every row in the 100-pack belongs to exactly one scenario category. There is zero overlap between clean records (indices 1..50) and defective records (indices 51..100). The profiler suite (`apps/crm/modules/crm-5/tests/kit/profiler.test.ts`) and fixture suite (`apps/crm/modules/crm-5/tests/fixtures/dirty-pack.test.ts`) assert this partition deterministically.

---

## 5. Gate G1 Sign-off & Verification

* **Dirty Data Pack Plan ID:** `DDP-CRM5-G1-001`
* **Milestone:** Gate G1 — Design Complete (Sprint 1)
* **Date Approved:** 2026-10-23
* **Approval Authority:** Group 5 Role 4 (Data / QA Lead) & Role 2 (Integration / Backend Engineer)
* **Status:** Verified, Manifest Aligned, and Passing in Automated Tests
