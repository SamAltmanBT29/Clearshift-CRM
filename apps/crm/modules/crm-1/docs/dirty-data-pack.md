# ClearShift CRM — Canonical Module Dirty Data Pack (CRM-1)
**Catalog ID:** `[CRM1-25]` / Issue #118  
**Module:** `CRM-1` Contacts, Companies and Leads (Master Data Domain)  
**Milestone:** Sprint 2 — Gate G2  
**Owner:** Group 1 — Role 4 — Data / QA Lead  
**Specification Traceability:** ClearShift Project Plan v3.0 §17; SDS ClearShift CRM v2.0 §4.11, §4.12; Master Architecture Baseline 1.0-A §4.2; `[CRM1-24]`.

---

## 1. Executive Summary & Design Invariants

The **CRM-1 Canonical Module Dirty Data Pack** establishes the deterministic 100-row synthetic test fixture and outcome manifest for testing the CRM-1 ingestion, normalization, duplicate detection, and migration pipeline under edge-case stress.

### Non-Negotiable Engineering Principles
1. **100% Synthetic Data:** Zero real personal, customer, or employee records. Names, corporate entities, phone numbers, and emails strictly utilize RFC-2606 reserved domains (`.example`, `example.com`, `example.org`, `example.net`, `example.co.uk`).
2. **Exact Conservation Balance Sheet:**
   $$\text{source\_count (100)} = \text{loaded (74)} + \text{rejected (18)} + \text{merged (8)} + \text{skipped (0)}$$
   $$\text{unaccounted\_count} = 0$$
   Every single source row reaches exactly one deterministic terminal outcome.
3. **Deterministic Deduplication:** Evaluates exact normalized keys (`normalizeEmail`, `${normalizePhone}#${normalizeName}`, `normalizeTaxNumber`). Fuzzy matching is strictly forbidden in V1.
4. **Disjoint Defect Classification:** Record defect categories have zero index overlap.
5. **Exact Reproducibility:** Deterministic generator produces byte-identical CSV, manifest, and SHA-256 fixture checksums across all CI and local runs.

---

## 2. Row Conservation Accounting Table

| Outcome Category | Expected Outcome | Terminal Outcome | Row Count | Record Indices | Accounting Justification |
|---|---|---|---|---|---|
| **Clean Golden Records** | `valid` | `loaded` | **50** | Rows 1–50 | Valid contacts with complete first/last name, valid email, phone, and valid company reference. |
| **Golden Corporate Records** | `valid` | `loaded` | **20** | Rows 51–70 | Corporate contacts across various seeded business domains. |
| **Valid Edge Cases** | `valid` | `loaded` | **4** | Rows 71–74 | Multi-lingual UTF-8 (Row 71), high 32-bit revenue (Row 72), space-delimited ISO timestamp (Row 73), zero revenue (Row 74). |
| **Exact Normalized Email Duplicates** | `exact_duplicate` | `merged` | **4** (2 pairs) | Rows 75–78 | Pair 1 (Rows 75 & 76: `sophia.chen@alpha-tech.example`); Pair 2 (Rows 77 & 78: `marcus.vance@synthetic-corp.example`). |
| **Exact Phone + Name Duplicates** | `exact_duplicate` | `merged` | **4** (2 pairs) | Rows 79–82 | Pair 3 (Rows 79 & 80: `+15550127744#david kim`); Pair 4 (Rows 81 & 82: `+15550192834#elena rostova`). |
| **Missing Mandatory Attributes** | `null_required` | `rejected` | **4** | Rows 83–86 | Empty `first_name` (Row 83), whitespace `first_name` (Row 84), empty `last_name` (Row 85), tab `last_name` (Row 86). |
| **Malformed RFC-5322 Emails** | `malformed` | `rejected` | **4** | Rows 87–90 | Missing `@` (Row 87), missing domain (Row 88), embedded space (Row 89), consecutive dots (Row 90). |
| **Malformed Phone Numbers** | `malformed` | `rejected` | **2** | Rows 91–92 | Alphabetic characters in phone (Row 91), insufficient digits (Row 92). |
| **Lead Status Allowlist Violations** | `malformed` | `rejected` | **2** | Rows 93–94 | Disallowed status `Reopened` (Row 93), disallowed status `Archived_Legacy` (Row 94). |
| **Missing Foreign Key References** | `foreign_key_missing` | `rejected` | **2** | Rows 95–96 | Parent company ID `00000000-0000-0000-0000-000000000000` (Row 95), `ffffffff-ffff-ffff-ffff-ffffffffffff` (Row 96). |
| **Formula Injection Vectors** | `malformed` | `rejected` | **2** | Rows 97–98 | Value starting with `=` (Row 97), value starting with `+` (Row 98). |
| **Boundary Value Violations** | `malformed` | `rejected` | **1** | Row 99 | Negative annual revenue `-50000.00` violating domain non-negative constraint. |
| **Field Length Violations** | `malformed` | `rejected` | **1** | Row 100 | First name exceeding maximum column length (500 chars > 255 capacity). |
| **TOTAL** | — | — | **100** | Rows 1–100 | Conservation Check: `100 = 74 + 18 + 8 + 0` (`unaccounted = 0`). |

---

## 3. Fixture Assets & Public Synchronization

The canonical dirty data pack is maintained in two synchronized repository locations:

1. **Module Fixtures:**
   - `apps/crm/modules/crm-1/tests/fixtures/dirty-pack-100.csv`
   - `apps/crm/modules/crm-1/tests/fixtures/manifest.json`
2. **Public Sample Data (Migration Kit consumption):**
   - `sample-data/crm-1/dirty-pack-100.csv`
   - `sample-data/crm-1/manifest.json`
   - `sample-data/crm-1/expected-profile.json`

---

## 4. Automated Verification Commands

```bash
# Run Dirty Data Pack assertions
npx vitest run apps/crm/modules/crm-1/tests/fixtures/dirty-pack.test.ts

# Run entire CRM-1 test suite
npm test -- apps/crm/modules/crm-1

# Run TypeScript and Lint checks
npm run typecheck
npm run lint
```
