# ClearShift CRM — Canonical Module Dirty Data Pack: CRM-2

**Module ID:** `CRM-2`  
**Module Name:** Deals, Pipeline Stages and Quotes  
**Owning Team:** Team `crm-deals` (Group 2 — Role 4 Data / QA Lead)  
**Schema Version:** 1.0.0  
**Target Milestone:** Gate G2 — Synthetic Dirty Data Complete (Sprint 2)  
**Traceability:** ClearShift Project Plan v3.0 §§9.3–9.6, 17; SDS ClearShift CRM v2.0 §4.11, §4.12; Master Architecture Baseline 1.0-A §4.2; Issue #138 `[CRM2-25]`.

---

## 1. Executive Summary & Artifact Metadata

In accordance with Issue #138 (`[CRM2-25]`), this document records the delivery and verification of the canonical 100-row module **Dirty Data Pack** for CRM-2 Deals, Pipeline Stages and Quotes.

The fixture dataset exercises the complete migration ingestion pipeline, including CSV parsing, column profiling, data cleaning, deterministic exact-key deduplication, foreign-key reference validation, and error reporting.

### Canonical Fixture Identity
- **Primary CSV Fixture:** `sample-data/crm-2/dirty-data-v1.csv`
- **Manifest File:** `sample-data/crm-2/manifest.json`
- **Expected Profile Baseline:** `sample-data/crm-2/expected-profile.json`
- **Total Source Rows:** `100` (1 header line + 100 continuous 1-indexed data lines)
- **File Size:** `17,109 bytes`
- **SHA-256 Checksum:** `2104fee6e602b780246375c0e27b5cdcb27f704f7b4f0e7750e933fddae3c36a`
- **Deterministic PRNG Seed:** `42` (linear congruential generator; 100% reproducible byte-for-byte across test runs)

---

## 2. Row Conservation Balance Sheet

The canonical pack strictly validates the non-negotiable ClearShift migration row conservation equation:
$$\text{source\_count} = \text{loaded\_count} + \text{rejected\_count} + \text{merged\_count} + \text{skipped\_count} \quad \text{and} \quad \text{unaccounted\_count} = 0$$

| Accounting Metric | Planned (G1 Plan) | Actual (G2 Fixture) | Variance | Terminal Status | Business Justification |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`source_count`** | **100** | **100** | 0 | Input | Total source records parsed from CSV. |
| **`loaded_count`** | **75** | **75** | 0 | Terminal (`created`) | Clean standard deals (55), clean orphan deals (10), clean quotes (10). |
| **`rejected_count`**| **17** | **17** | 0 | Terminal (`rejected`) | Seeded unrecoverable syntax errors, invalid stages, bad dates, broken FKs. |
| **`merged_count`** | **8** | **8** | 0 | Terminal (`merged`) | 4 exact duplicate deal rows + 4 exact duplicate quote rows (4 master records). |
| **`skipped_count`** | **0** | **0** | 0 | Terminal (`skipped`) | Bypassed rows (0 in V1 baseline; skipping requires explicit reason code). |
| **`unaccounted`** | **0** | **0** | 0 | **Balanced** | **Zero unaccounted rows. Balance check is 100% satisfied.** |

---

## 3. Seeded Defect Scenario Distribution

The 100-row pack covers 11 distinct anomaly scenarios:

| Category ID | Scenario Description | Target Entity | Rows | Expected Outcome | Stable Reason Code | Edge Cases Exercised |
| :--- | :--- | :---: | :---: | :---: | :--- | :--- |
| **`CAT-01`** | **Clean Standard Deals** | Deal | 55 (1–55) | `loaded` | None (Clean) | Multi-byte UTF-8 corporate titles (e.g. `München Cloud Server Expansion`, `São Paulo Retail POS`, `Zürich FinTech`), ISO-4217 currencies (`USD`, `EUR`, `GBP`), non-negative decimal quantities. |
| **`CAT-02`** | **Clean Orphan Deals** | Deal | 10 (56–65) | `loaded` | None (Orphan) | Permitted orphan deals with `contact_id = null`. Rendered in UI with orphan warning pill. Never silently hidden or dropped. |
| **`CAT-03`** | **Clean Commercial Quotes** | Quote | 10 (66–75) | `loaded` | None (Clean) | Unique quote number (`Q-2026-0101` .. `Q-2026-0110`), linked to valid parent deal UUID, valid date, server-computed decimal amount. |
| **`CAT-04`** | **Exact Duplicate Deals** | Deal | 4 (76–79) | `merged` | `EXACT_DEAL_DUPLICATE` | 2 duplicate pairs: Pair 1 has leading/trailing whitespace; Pair 2 is lowercase orphan deals. Both pairs normalize to identical business keys. |
| **`CAT-05`** | **Exact Duplicate Quotes** | Quote | 4 (80–83) | `merged` | `EXACT_QUOTE_NUMBER_MATCH` | 2 duplicate pairs: Pair 1 has casing differences and whitespace; Pair 2 has exact matching quote reference numbers. |
| **`CAT-06`** | **Negative Monetary Values** | Deal | 3 (84–86) | `rejected` | `NEGATIVE_VALUE` | Values `-1500.00`, `-50000.50`, `-0.01` violating non-negative domain check. |
| **`CAT-07`** | **Invalid Currency Codes** | Deal | 3 (87–89) | `rejected` | `INVALID_CURRENCY` | Strings `euros` (non-3-letter), `US` (2 letters), `$$$` (symbols) failing ISO 4217 regex `^[A-Z]{3}$`. |
| **`CAT-08`** | **Missing Mandatory Name** | Deal | 3 (90–92) | `rejected` | `EMPTY_MANDATORY_FIELD` | Empty string `""`, whitespace only `"   "`, and tab characters `"\t\t"`. |
| **`CAT-09`** | **Invalid Pipeline Stage** | Deal | 3 (93–95) | `rejected` | `INVALID_STAGE` | Unapproved stage names `Draft`, `In Review`, `Cancelled` not in standard 6-stage allowlist. |
| **`CAT-10`** | **Malformed Close Date** | Deal | 3 (96–98) | `rejected` | `INVALID_DATE_FORMAT` | UK slash date `31/12/2026`, quarter string `Q4-2026`, and text `asap` failing ISO 8601 `YYYY-MM-DD`. |
| **`CAT-11`** | **Referential Orphan Quote** | Quote | 2 (99–100) | `rejected` | `PARENT_DEAL_NOT_FOUND` | Quotes referencing non-existent parent deals (`00000000-0000-0000-0000-000000000000` and `...999999999999`). |

---

## 4. Security & Sanitization Edge Cases

1. **Formula Injection Sanitization (Row 10):**
   - Source record contains potential CSV formula injection: `'=CMD('calc')!A1 Enterprise Cloud Migration`.
   - The value is explicitly escaped with a leading apostrophe (`'`) conforming to RFC 4180 safety requirements.
2. **UTF-8 Multi-Byte Character Preservation:**
   - Names containing German umlauts (`München`), Portuguese tildes (`São Paulo`), and accents (`Zürich`) are preserved through serialization and parsing without encoding corruption.
3. **No PII / Synthetic Fixture Guarantee:**
   - Zero real employee, company, or customer names. All entities use deterministically synthesized names and UUIDs.

---

## 5. Verification & Test Evidence

The automated Vitest test suite `apps/crm/modules/crm-2/tests/domain/dirty-data-pack.test.ts` executes 20 assertions covering:
- Exact 100-row count and 1-indexed source row sequence.
- Row conservation equation with zero unaccounted records.
- Exact breakdown for all 11 defect scenarios.
- Deterministic reproducibility (multiple runs yield identical SHA-256 checksum).
- Formula injection protection and UTF-8 multi-byte encoding.
- File integrity on disk (`dirty-data-v1.csv`, `manifest.json`, `expected-profile.json`).

### Test Execution Results
```
 ✓ apps/crm/modules/crm-2/tests/domain/dirty-data-pack.test.ts (20 tests)
   ✓ CRM-2 Canonical Module Dirty Data Pack (Issue #138 / [CRM2-25]) (20)
     ✓ 1. Dataset Sizing & Row Conservation Balance Sheet (3)
     ✓ 2. Defect Scenarios & Classification Integrity (11)
     ✓ 3. Determinism, UTF-8 & Security Edge Cases (3)
     ✓ 4. Manifest & Expected Profile Artifacts (3)

Test Files  1 passed (1)
     Tests  20 passed (20)
  Duration  134ms
```
