# ClearShift CRM — Dirty Data Pack Plan: CRM-2 Deals, Pipeline and Quotes

**Module ID:** `CRM-2`  
**Module Name:** Deals, Pipeline Stages and Quotes  
**Owning Team:** Team `crm-deals` (Group 2 — Role 4 Data / QA Lead)  
**Target Milestone:** Gate G1 — Design Complete (Sprint 1)  
**Traceability:** ClearShift Project Plan v3.0 §§9.3–9.6, 17; SDS ClearShift CRM v2.0 §4.11, §4.12; Master Architecture Baseline 1.0-A §4.2; Issue #137 `[CRM2-24]`.

---

## 1. Objectives & Synthetic Test Strategy

The Dirty Data Pack Plan establishes the synthetic test fixture strategy for **CRM-2 Deals, Pipeline Stages and Quotes**. It defines the exact edge-case scenarios, seeded defect distributions, and expected row-level outcomes for validating the ClearShift migration pipeline under realistic stress conditions.

### Non-Negotiable Fixture Principles:
1. **100% Synthetic Data:** Zero real personal, customer, deal, or quote data. All opportunity titles, account names, values, and notes are generated deterministically using synthetic dictionaries.
2. **Stable Deterministic Generation:** Fixtures are generated with a fixed PRNG seed (Seed 42) ensuring byte-for-byte reproducibility across test runs.
3. **1-Indexed Source Rows:** Every source row is labeled with a stable 1-indexed `source_row` integer that persists through staging, profiling, cleaning, mapping, and audit logging.
4. **Conservation Accounting Invariant:**
   $$\text{source\_count} = \text{loaded\_count} + \text{rejected\_count} + \text{merged\_count} + \text{skipped\_count} \quad \text{and} \quad \text{unaccounted\_count} = 0$$
   Every parsed source row must reach exactly one terminal outcome. No row is ever dropped silently.
5. **Deterministic Deduplication:** Duplicate matching evaluates exact normalized keys only (`source_system + source_id`, `${normalizedName}#${stageId}#${contactId || 'orphan'}`, `quote_number`). Fuzzy auto-merging is strictly prohibited.

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
| **`rejected_count`** | **17** | **140** | Rows with unrecoverable defects (negative value, invalid currency, missing stage, broken FKs). |
| **`merged_count`** | **8** | **80** | Rows matching exact duplicate keys; merged into surviving golden records via human review. |
| **`skipped_count`** | **0** | **0** | Explicitly bypassed rows with approved business justification (0 in V1 baseline). |
| **`unaccounted_count`**| **0** | **0** | Missing or unexplained rows. **Must strictly equal 0**. |
| **Conservation Status**| **OK** | **OK** | Evaluates `source == loaded + rejected + merged + skipped`. |

---

## 3. Seeded Defect Distribution by Category

In accordance with SDS ClearShift CRM v2.0 §4.11 ("Known problems in the Dirty Data Pack"), the 100-row and 1,000-row packs seed defects across specific anomaly categories:

| Category ID | Category Name | Primary Target Entity | Count in 100-Pack | Count in 1,000-Pack | Expected Outcome | Stable Reason Code |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| `CAT-01` | **Clean Golden Records (Standard Deals)** | Deal | 55 | 620 | `loaded` | None (Success) |
| `CAT-02` | **Clean Golden Records (Orphan Deals)** | Deal | 10 | 80 | `loaded` | None (Success) |
| `CAT-03` | **Clean Golden Records (Quotes)** | Quote | 10 | 80 | `loaded` | None (Success) |
| `CAT-04` | **Exact Duplicate Deals** | Deal | 4 (2 pairs) | 40 (20 pairs) | `merged` | `EXACT_DEAL_DUPLICATE` |
| `CAT-05` | **Exact Duplicate Quote Numbers** | Quote | 4 (2 pairs) | 40 (20 pairs) | `merged` | `EXACT_QUOTE_NUMBER_MATCH` |
| `CAT-06` | **Negative Monetary Deal Value** | Deal | 3 | 25 | `rejected` | `NEGATIVE_VALUE` |
| `CAT-07` | **Invalid ISO Currency Code** | Deal | 3 | 25 | `rejected` | `INVALID_CURRENCY` |
| `CAT-08` | **Omitted Mandatory Deal Name** | Deal | 3 | 25 | `rejected` | `EMPTY_MANDATORY_FIELD` |
| `CAT-09` | **Invalid / Unknown Pipeline Stage** | Deal | 3 | 25 | `rejected` | `INVALID_STAGE` |
| `CAT-10` | **Malformed Close Date Format** | Deal | 3 | 20 | `rejected` | `INVALID_DATE_FORMAT` |
| `CAT-11` | **Missing Parent Deal Link** | Quote | 2 | 20 | `rejected` | `PARENT_DEAL_NOT_FOUND` |

---

## 4. Field-by-Field Anomaly Injection Specifications

### 4.1 Deal Title (`name`)
- **Valid Values:** Single-line string, trimmed length $1 \dots 255$ characters (e.g. `"Enterprise Cloud Infrastructure Expansion"`).
- **Anomalies Seeded:**
  - Leading/trailing whitespace: `"  Healthcare AI Integration  "` -> cleaned via whitespace trimming.
  - Blank string / whitespace only: `""`, `"   "` -> rejected with code `EMPTY_MANDATORY_FIELD`.
  - CSV formula injection prefix: `"=CMD('calc')!A1"` -> sanitized by prefixing with apostrophe (`"'=CMD('calc')!A1"`).

### 4.2 Monetary Value (`value`)
- **Valid Values:** Decimal string with up to 2 decimal places, non-negative (e.g. `"45000.00"`).
- **Anomalies Seeded:**
  - Negative quantities: `"-1500.00"` -> rejected with code `NEGATIVE_VALUE`.
  - Currency symbol prefix: `"$75,000.00"` -> normalized to `"75000.00"` by cleaner.
  - Corrupted alphanumeric text: `"forty-five thousand"` -> rejected with code `MALFORMED_NUMERIC`.

### 4.3 Currency Code (`currency`)
- **Valid Values:** Exactly 3 uppercase letters conforming to ISO 4217 (e.g. `"USD"`, `"EUR"`, `"GBP"`, `"INR"`).
- **Anomalies Seeded:**
  - Lowercase codes: `"usd"` -> normalized to `"USD"` by cleaner.
  - Non-standard names: `"dollars"`, `"Euro"` -> mapped via enum translation dictionary.
  - Unrecoverable syntax: `"US"`, `"123"`, `"$$$"` -> rejected with code `INVALID_CURRENCY`.

### 4.4 Sales Pipeline Stage (`stage`)
- **Valid Values:** Allowlist of 6 fixed stages: `"New"`, `"Qualified"`, `"Proposal"`, `"Negotiation"`, `"Won"`, `"Lost"`.
- **Anomalies Seeded:**
  - Stage aliases: `"qualified"`, `"In Negotiation"` -> translated via enum mapping table.
  - Illegal stages: `"Draft"`, `"Review"`, `"Cancelled"` -> rejected with code `INVALID_STAGE`.

### 4.5 Expected Close Date (`close_date`)
- **Valid Values:** ISO 8601 calendar date `YYYY-MM-DD` (e.g. `"2026-11-30"`).
- **Anomalies Seeded:**
  - Alternate date formats: `"11/30/2026"`, `"2026.11.30"` -> coerced to ISO format by date cleaner.
  - Non-date strings: `"Q4 2026"`, `"asap"` -> rejected with code `INVALID_DATE_FORMAT`.

---

## 5. Rejection Reason Codes Allowlist

Every rejected row generates an entry in `crm2_import_rejects` with a stable, machine-readable reason code:

| Reason Code | Rejection Trigger Condition | Human-Readable Safe Message | HTTP Status |
| :--- | :--- | :--- | :---: |
| `EMPTY_MANDATORY_FIELD` | `name` is null, empty string, or whitespace only | "Mandatory deal name is required and cannot be blank" | 400 / Reject |
| `NEGATIVE_VALUE` | `value < 0` | "Monetary opportunity value must be a non-negative decimal" | 422 / Reject |
| `INVALID_CURRENCY` | `currency` fails 3-letter uppercase regex `^[A-Z]{3}$` | "Currency must be an ISO 4217 three-letter uppercase code" | 400 / Reject |
| `INVALID_STAGE` | Stage name is not in the 6 fixed pipeline stages | "Specified pipeline stage does not exist in standard stage allowlist" | 422 / Reject |
| `INVALID_DATE_FORMAT` | Date string fails YYYY-MM-DD parsing | "Close date must conform to ISO 8601 format (YYYY-MM-DD)" | 400 / Reject |
| `PARENT_DEAL_NOT_FOUND` | Quote specifies a `deal_id` that does not exist in target database | "Referenced parent deal does not exist in target database" | 404 / Reject |
| `EXACT_DEAL_DUPLICATE` | Normalized name, stage, and contact match existing target deal | "Deterministic exact deal duplicate detected; held for human review" | Review |
| `EXACT_QUOTE_NUMBER_MATCH` | Quote number matches an existing committed quote | "Quote number already exists in target database; held for human review" | Review |

---

## 6. Bounded Batching & 10% Failure Halt Threshold Simulation

In accordance with ClearShift Core Migration Rules:
1. **500-Row Chunking:** Migration processing occurs in bounded batches of at most 500 records. Memory footprint is strictly bounded.
2. **10% Error Threshold:** If cumulative failures in an active batch exceed 10% of attempted rows:
   - Migration execution halts immediately.
   - Already committed transactions and durable receipts are preserved.
   - Batch status updates to `failed` with failure diagnostics.
   - No row is ever dropped or left unaccounted for.
