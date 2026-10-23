# ClearShift CRM — Dirty Data Pack Plan: CRM-1 Contacts, Companies and Leads

**Module ID:** `CRM-1`
**Module Name:** Contacts, Companies and Leads (Master Data Domain)
**Owning Team:** Team `crm-contacts` (Group 1 — Role 4 Data / QA Lead)
**Target Milestone:** Gate G1 — Design Complete (Sprint 1)
**Traceability:** ClearShift Project Plan v3.0 §§9.3–9.6, 17; SDS ClearShift CRM v2.0 §4.11, §4.12; Master Architecture Baseline 1.0-A §4.2; Issue #117 `[CRM1-24]`.

---

## 1. Objectives & Synthetic Test Strategy

The Dirty Data Pack Plan establishes the synthetic test fixture strategy for **CRM-1 Contacts, Companies and Leads**. It specifies the exact scenarios, seeded defect distributions, and expected row-level outcomes for testing the ClearShift migration pipeline under stress.

### Non-Negotiable Fixture Principles:
1. **100% Synthetic Data:** Zero real personal, customer, or employee records. All names, emails, phone numbers, and company identifiers are deterministically generated using synthetic dictionaries.
2. **Stable Deterministic Generation:** Fixtures are generated with a fixed PRNG seed (Seed 42) ensuring byte-for-byte reproducibility across CI runs.
3. **1-Indexed Source Rows:** Every row is labeled with a stable 1-indexed `source_row` integer that persists through staging, profiling, validation, and rejection auditing.
4. **Conservation Accounting Invariant:**
   $$\text{source\_count} = \text{loaded\_count} + \text{rejected\_count} + \text{merged\_count} + \text{skipped\_count}$$
   $$\text{unaccounted\_count} = 0$$
   Every parsed source row must reach exactly one terminal outcome. No row is ever dropped silently.
5. **Deterministic Deduplication:** Duplicate matching evaluates exact normalized keys only (`normalizeEmail`, `${normalizePhone}#${normalizeName}`, `normalizeTaxNumber`). Fuzzy auto-merging is strictly prohibited.

---

## 2. Dataset Sizing & Balance Sheet Specifications

Two standardized test packs are defined:
1. **Canonical Integration Pack (1,000 Rows):** Cross-module integration dataset conforming to SDS §4.11 / §4.12.
2. **Canonical Module Pack (100 Rows):** Fast, targeted module test pack executed during unit and contract test suites.

### Conservation Balance Sheet Target Values

| Metric | Module Pack (100 Rows) | Canonical Pack (1,000 Rows) | Description & Accounting Justification |
| :--- | :---: | :---: | :--- |
| **`source_count`** | **100** | **1,000** | Total raw source rows parsed from the input CSV/XLSX file. |
| **`loaded_count`** | **74** | **780** | Valid, clean records committed to target PostgreSQL tables with durable receipts. |
| **`rejected_count`** | **18** | **140** | Rows with unrecoverable defects (invalid syntax, missing mandatory fields, broken FKs). |
| **`merged_count`** | **8** | **80** | Rows matching exact duplicate keys; merged into surviving golden records via human review. |
| **`skipped_count`** | **0** | **0** | Explicitly bypassed rows with approved business justification (0 in V1 baseline). |
| **`unaccounted_count`**| **0** | **0** | Missing or unexplained rows. **Must strictly equal 0**. |
| **Conservation Status**| **OK** | **OK** | Evaluates `source == loaded + rejected + merged + skipped`. |

---

## 3. Seeded Defect Distribution by Category

In accordance with SDS ClearShift CRM v2.0 §4.11 ("Known problems in the Dirty Data Pack"), the 1,000-row and 100-row packs seed defects across 9 specific categories:

| Category ID | Category Name | Primary Target Entity | Count in 100-Pack | Count in 1,000-Pack | Expected Outcome | Stable Reason Code |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| `CAT-01` | **Clean Golden Records** | Contact / Company / Lead | 74 | 780 | `loaded` | None (Success) |
| `CAT-02` | **Exact Email Duplicates** | Contact | 4 (2 pairs) | 40 (20 pairs) | `merged` | `EXACT_EMAIL_MATCH` |
| `CAT-03` | **Exact Phone + Name Duplicates** | Contact | 4 (2 pairs) | 40 (20 pairs) | `merged` | `EXACT_PHONE_NAME_MATCH` |
| `CAT-04` | **Malformed RFC-5322 Emails** | Contact | 4 | 35 | `rejected` | `INVALID_EMAIL` |
| `CAT-05` | **Malformed Phone Numbers** | Contact | 2 | 25 | `rejected` | `INVALID_PHONE` |
| `CAT-06` | **Omitted Mandatory Names** | Contact | 4 | 30 | `rejected` | `EMPTY_MANDATORY_FIELD` |
| `CAT-07` | **Blank Company Names** | Company | 2 | 20 | `rejected` | `EMPTY_COMPANY_NAME` |
| `CAT-08` | **Referential Foreign Key Orphans** | Contact / Lead | 2 | 15 | `rejected` | `REFERENCE_NOT_FOUND` |
| `CAT-09` | **Lead Workflow Violations** | Lead | 2 | 10 | `rejected` | `INVALID_LEAD_STATUS_TRANSITION` |
| `CAT-10` | **CSV Formula Injection Vectors** | Contact | 1 | 3 | `rejected` | `FORMULA_INJECTION_RISK` |
| `CAT-11` | **Encoding & Length Boundaries** | Contact | 1 | 2 | `rejected` | `FIELD_TOO_LONG` |
| **TOTAL** | | | **100** | **1,000** | | |

---

## 4. Scenario Catalog & Synthetic Edge-Case Specifications

### SCENARIO-CRM1-01: Golden Clean Contacts (CAT-01)
* **Description:** Syntactically valid contact with non-empty first/last name, valid email address, phone, and flat address.
* **Target Entity:** `crm1_contacts`
* **Expected Terminal Outcome:** `loaded`
* **Synthetic Example Payload:**
  ```json
  {
    "sourceRow": 1,
    "first_name": "Marcus",
    "last_name": "Vance",
    "email": "marcus.vance@synthetic-corp.example",
    "phone": "+1-555-010-4491",
    "address": "123 Market St, San Francisco, CA 94105"
  }
  ```

### SCENARIO-CRM1-02: Clean Flat Companies (CAT-01)
* **Description:** Company with legal name, alphanumeric tax number, email, and single flat address string.
* **Target Entity:** `crm1_companies`
* **Expected Terminal Outcome:** `loaded`
* **Synthetic Example Payload:**
  ```json
  {
    "sourceRow": 2,
    "name": "Apex Robotics International",
    "tax_number": "US-EIN-123456789",
    "email": "info@apexrobotics.example",
    "phone": "+1-555-019-3322",
    "address": "500 Innovation Blvd, Austin, TX 78701"
  }
  ```

### SCENARIO-CRM1-04: Exact Email Duplicate Candidates (CAT-02)
* **Description:** Two distinct source records sharing identical normalized email addresses (`lowercase, trimmed`).
* **Target Entity:** `crm1_contacts`
* **Detection Rule:** `normalizeEmail(recordA.email) === normalizeEmail(recordB.email)`
* **Expected Terminal Outcome:** `merged` under authorized human review; surviving Golden ID absorbs legacy link.
* **Synthetic Example Payload (Pair):**
  ```json
  [
    { "sourceRow": 10, "first_name": "Sophia", "last_name": "Chen", "email": "sophia.chen@alpha-tech.example" },
    { "sourceRow": 11, "first_name": "Sophia", "last_name": "Chen", "email": "  SOPHIA.CHEN@Alpha-Tech.EXAMPLE  " }
  ]
  ```

### SCENARIO-CRM1-05: Exact Phone + Name Compound Duplicate Candidates (CAT-03)
* **Description:** Duplicate pair sharing normalized phone digits and normalized full name with different emails.
* **Target Entity:** `crm1_contacts`
* **Detection Rule:** `${normalizePhone(phone)}#${normalizeName(name)}`
* **Expected Terminal Outcome:** `merged` under human review.
* **Synthetic Example Payload (Pair):**
  ```json
  [
    { "sourceRow": 24, "first_name": "David", "last_name": "Kim", "phone": "+1-555-012-7744", "email": "d.kim@work.example" },
    { "sourceRow": 25, "first_name": "David", "last_name": "Kim", "phone": " (555) 012-7744 ", "email": "david.personal@example.net" }
  ]
  ```

### SCENARIO-CRM1-06: Malformed Email Syntax (CAT-04)
* **Description:** Email failing RFC-5322 validation (missing `@`, missing domain, spaces within local part).
* **Target Entity:** `crm1_contacts`
* **Expected Terminal Outcome:** `rejected`
* **Reason Code:** `INVALID_EMAIL`
* **Safe Audit Message:** `Email format does not conform to RFC-5322 syntax specification`
* **Synthetic Example Payload:**
  ```json
  {
    "sourceRow": 42,
    "first_name": "Alice",
    "last_name": "Walker",
    "email": "alice.walker_at_invalid-domain",
    "phone": "+1-555-011-3344"
  }
  ```

### SCENARIO-CRM1-08: Missing Mandatory Name (CAT-06)
* **Description:** Contact row where first name or last name is empty, null, or pure whitespace.
* **Target Entity:** `crm1_contacts`
* **Expected Terminal Outcome:** `rejected`
* **Reason Code:** `EMPTY_MANDATORY_FIELD`
* **Safe Audit Message:** `Mandatory field 'first_name' cannot be empty or whitespace`
* **Synthetic Example Payload:**
  ```json
  {
    "sourceRow": 55,
    "first_name": "   ",
    "last_name": "Montgomery",
    "email": "montgomery@example.com"
  }
  ```

### SCENARIO-CRM1-10: Referential Foreign Key Orphan (CAT-08)
* **Description:** Contact row referencing a `company_id` UUID that does not exist in `crm1_companies`.
* **Target Entity:** `crm1_contacts`
* **Expected Terminal Outcome:** `rejected`
* **Reason Code:** `REFERENCE_NOT_FOUND`
* **Safe Audit Message:** `Referenced company_id '00000000-0000-0000-0000-000000000000' does not exist in CRM-1`
* **Synthetic Example Payload:**
  ```json
  {
    "sourceRow": 68,
    "first_name": "Clara",
    "last_name": "Oswald",
    "email": "clara.oswald@example.co.uk",
    "company_id": "00000000-0000-0000-0000-000000000000"
  }
  ```

### SCENARIO-CRM1-11: Lead Status Workflow Regression (CAT-09)
* **Description:** Lead record with invalid status or forbidden backward transition (`Closed -> Working`).
* **Target Entity:** `crm1_leads`
* **Expected Terminal Outcome:** `rejected`
* **Reason Code:** `INVALID_LEAD_STATUS_TRANSITION`
* **Safe Audit Message:** `Status 'Reopened' is not permitted by CRM-1 lead workflow allowlist`
* **Synthetic Example Payload:**
  ```json
  {
    "sourceRow": 79,
    "contact_id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "status": "Reopened"
  }
  ```

### SCENARIO-CRM1-12: CSV Formula Injection Vector (CAT-10)
* **Description:** Value starting with spreadsheet formula execution trigger characters (`=`, `+`, `-`, `@`).
* **Target Entity:** `crm1_contacts`
* **Expected Terminal Outcome:** `rejected` (or neutralized by prepending single quote `'`).
* **Reason Code:** `FORMULA_INJECTION_RISK`
* **Synthetic Example Payload:**
  ```json
  {
    "sourceRow": 91,
    "first_name": "=cmd|'/C calc'!A0",
    "last_name": "VulnerabilityTest",
    "email": "injection.test@example.com"
  }
  ```

---

## 5. Execution & Verification Runbook

### Running Conservation Assertions
To execute the automated conservation and distribution assertions against the Dirty Data Pack plan:

```sh
DATABASE_URL_TEST=postgres://localhost:5432/clearshift_test npm test -- apps/crm/modules/crm-1/tests/domain/qa-g1-design.test.ts
```

### Gate G1 Sign-Off Checklist
* [x] **Zero Real Data:** 100% synthetic generation verified.
* [x] **Deterministic Key Matching:** Exact normalization tested; fuzzy scoring excluded.
* [x] **Known Defect Alignment:** 80 duplicates, 60 syntax errors, 50 missing names correctly mapped.
* [x] **Conservation Formula:** `source = loaded + rejected + merged + skipped` with `unaccounted = 0`.
* [x] **10% Threshold Guard:** Automatic halt behavior verified when failure rate exceeds 10%.
