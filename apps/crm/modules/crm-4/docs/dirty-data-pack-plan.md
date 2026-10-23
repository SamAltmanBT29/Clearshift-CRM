# ClearShift CRM — Dirty Data Pack Plan: CRM-4 Marketing Lists and Campaign History

**Module ID:** `CRM-4`
**Module Name:** Marketing Lists and Campaign History
**Owning Team:** Team `crm-marketing` (Group 4 — Role 4 Data / QA Lead)
**Target Milestone:** Sprint 2 — Gate G2
**Traceability:** ClearShift Project Plan v3.0 §§9.3–9.6, 17; SDS ClearShift CRM v2.0 §4.5, §4.11, §4.12; Master Architecture Baseline 1.0-A §4.2; Issue #178 `[CRM4-25]`.

---

## 1. Objectives & Synthetic Test Strategy

The Dirty Data Pack Plan establishes the synthetic test fixture strategy for **CRM-4 Marketing Lists and Campaign History**. It defines the exact edge-case scenarios, seeded defect distributions, and expected row-level outcomes for validating the ClearShift migration pipeline under realistic legacy ingestion stress.

### Non-Negotiable Fixture Principles:
1. **100% Synthetic Data:** Zero real personal, customer, or employee data. All list names, campaign descriptions, contact identifiers, and consent assertions are generated deterministically using synthetic dictionaries.
2. **Stable Deterministic Generation:** Fixtures are generated with a fixed PRNG seed ensuring byte-for-byte reproducibility across test runs.
3. **1-Indexed Source Rows:** Every source row is labeled with a stable 1-indexed `source_row` integer that persists through staging, profiling, cleaning, mapping, and audit logging.
4. **Conservation Accounting Invariant:**
   $$\text{source\_count} = \text{loaded\_count} + \text{rejected\_count} + \text{merged\_count} + \text{skipped\_count} \quad \text{and} \quad \text{unaccounted\_count} = 0$$
   Every parsed source row must reach exactly one terminal outcome. No row is ever silently dropped.
5. **Deterministic Deduplication:** Duplicate matching evaluates exact normalized keys only. Fuzzy auto-merging is strictly prohibited.
6. **Monotonic Opt-Out Invariant (BR-CRM4-01):** Any migration row attempting to re-subscribe an already unsubscribed contact is detected as a fatal defect, logged in `crm4_import_rejects`, and rejected without overwriting the existing opt-out state.

---

## 2. Canonical Module Fixture Specifications (100 Rows)

- **Fixture File Location:** [`apps/crm/modules/crm-4/tests/fixtures/dirty-pack-100.csv`](../tests/fixtures/dirty-pack-100.csv)
- **Manifest Location:** [`apps/crm/modules/crm-4/tests/fixtures/manifest.json`](../tests/fixtures/manifest.json)
- **Sample Data Mirror:** [`sample-data/crm-4/dirty-pack-100.csv`](../../../../sample-data/crm-4/dirty-pack-100.csv)
- **SHA-256 Checksum:** `aceed5c310863ea01ed33f649a93c0bbcc4de51316ab15af1e7ead57f77162e9`
- **Verification Suite:** [`apps/crm/modules/crm-4/tests/fixtures/dirty-pack.test.ts`](../tests/fixtures/dirty-pack.test.ts)

### Dataset Partitioning

| Metric | Module Pack (100 Rows) | Canonical Pack (1,000 Rows Target) | Description & Accounting Justification |
| :--- | :---: | :---: | :--- |
| **`source_count`** | **100** | **1,000** | Total raw source rows parsed from the input CSV/XLSX file. |
| **`clean_count`** | **50** | **520** | Clean, valid records committing successfully to target PostgreSQL tables. |
| **`defective_count`** | **50** | **480** | Seeded defect rows covering syntax errors, missing fields, duplicates, and rule violations. |
| **`unaccounted_count`**| **0** | **0** | Missing or unexplained rows. **Must strictly equal 0**. |
| **Conservation Status**| **OK** | **OK** | Evaluates `source == loaded + rejected + merged + skipped`. |

---

## 3. Seeded Defect Distribution by Category

In accordance with SDS ClearShift CRM v2.0 §4.11 and Issue #178 `[CRM4-25]`, the 100-row pack seeds defects across specific anomaly categories:

| Category ID | Category Name | Primary Target Entity | Count in 100-Pack | Expected Outcome | Stable Reason Code |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `CAT-01` | **Clean Golden Records (Marketing Lists)** | List | 15 | `valid` | None (Success with UTF-8 support) |
| `CAT-02` | **Clean Golden Records (Campaigns)** | Campaign | 15 | `valid` | None (Success with ISO dates) |
| `CAT-03` | **Clean Golden Records (Campaign Members)** | Member | 12 | `valid` | None (Success with sent/opened/clicked) |
| `CAT-04` | **Clean Golden Records (Consents)** | Consent | 8 | `valid` | None (Success with subscribed/unsubscribed) |
| `CAT-05` | **Missing Mandatory Fields** | List/Member/Consent | 7 | `null_required` | `EMPTY_MANDATORY_FIELD` |
| `CAT-06` | **Exact Key Duplicates** | List/Member/Consent | 6 | `exact_duplicate` | `EXACT_DUPLICATE_KEY` |
| `CAT-07` | **Referential Orphan References** | Campaign/Member | 6 | `foreign_key_missing` | `FOREIGN_KEY_MISSING` |
| `CAT-08` | **Invalid Member Status** | Member | 6 | `malformed` | `INVALID_MEMBER_STATUS` |
| `CAT-09` | **Monotonic Opt-Out Reversals** | Consent | 5 | `malformed` | `MONOTONIC_OPT_OUT_VIOLATION` |
| `CAT-10` | **Date Format Variants** | Campaign | 6 | `malformed` | `INVALID_DATE_FORMAT` |
| `CAT-11` | **Boundary Numbers** | List/Campaign | 5 | `malformed` | `BOUNDARY_NUMBER_ERROR` |
| `CAT-12` | **Whitespace Padding** | List/Member/Consent | 5 | `whitespace_padding` | `WHITESPACE_PADDING` |
| `CAT-13` | **Formula Injection Payloads** | List/Campaign | 4 | `malformed` | `FORMULA_INJECTION_RISK` |
| **Total** | | | **100** | | |

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
