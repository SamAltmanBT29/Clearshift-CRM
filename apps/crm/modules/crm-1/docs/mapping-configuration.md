# ClearShift CRM — Field Mapping & Enum Translation Configuration: CRM-1

- **Module ID:** `CRM-1`
- **Module Name:** Contacts, Companies and Leads
- **Owning Team:** Group 1 — Role 4 (Data / QA Lead)
- **Schema Version:** 1.0.0
- **Target Milestone:** Sprint 3 — Gate G3 (Clean & Map)
- **Traceability:** Issue #121 `[CRM1-28]`; ClearShift Project Plan v3.0 §3.4, §9.3; SDS ClearShift CRM v2.0 §4.5, §4.10, §4.14; Master Architecture Blueprint Baseline 1.0-A slot 28; `KIT-05`.

---

## 1. Executive Summary

This specification governs the deterministic field mapping, type coercion, enum translation, and dry-run validation guards for **CRM-1 Contacts, Companies and Leads**.
During Migration Step 4 (Map), source file columns are translated into target PostgreSQL schema attributes (`crm1_contacts`, `crm1_companies`, `crm1_leads`) using versioned, reproducible mapping templates.
To protect system integrity, missing required target fields trigger fatal validation errors and block dry-run execution prior to any database mutation.

---

## 2. Versioned Mapping Templates

CRM-1 supplies versioned, named templates with immutable SHA-256 integrity checksums:

| Template ID | Name | Version | Target Entity | Mandatory Required Fields |
| :--- | :--- | :--- | :--- | :--- |
| **`crm1-contacts-canonical`** | CRM-1 Contacts Canonical | 1 | `crm1_contacts` | `firstName`, `lastName` |
| **`crm1-contacts-legacy`** | CRM-1 Contacts Legacy Export | 1 | `crm1_contacts` | `firstName`, `lastName` |
| **`crm1-companies-canonical`** | CRM-1 Companies Canonical | 1 | `crm1_companies` | `name` |
| **`crm1-companies-legacy`** | CRM-1 Companies Legacy Export | 1 | `crm1_companies` | `name` |
| **`crm1-leads-canonical`** | CRM-1 Leads Canonical | 1 | `crm1_leads` | `contactId`, `status` |
| **`crm1-leads-legacy`** | CRM-1 Leads Legacy Export | 1 | `crm1_leads` | `contactId`, `status` |

---

## 3. Type Coercion Rules

All source column inputs undergo deterministic type coercion according to target schema requirements:

| Field Type | Coercion Specification | Validation / Bounds |
| :--- | :--- | :--- |
| **`string`** | Strips outer whitespace, preserves string value. | Pure string representation. |
| **`uuid`** | Standard 8-4-4-4-12 hex UUID regex validation. | Coerced to lowercase; invalid syntax rejected with `INVALID_UUID`. |
| **`integer`** | String parsed to integer. | Bounds: `0 <= n <= 2147483647` (PostgreSQL 32-bit INT); non-integers rejected with `INVALID_INTEGER`. |
| **`numeric`** | Decimal number string parsing. | Rounded to 4 decimal places (`Math.round(n * 10000) / 10000`); invalid numbers rejected with `INVALID_NUMERIC`. |
| **`date`** | ISO-8601 date/timestamp string parsing. | Verified with `ISO_TS_REGEX` and `Date.parse()`; invalid formats rejected with `INVALID_DATE`. |
| **`boolean`** | Normalizes boolean strings (`'true'`, `'yes'`, `'1'`, `'t'` &rarr; `true`; `'false'`, `'no'`, `'0'`, `'f'` &rarr; `false`). | Values outside boolean dictionary rejected with `INVALID_BOOLEAN`. |
| **`email`** | Lowercases and trims via `@cs/core` `normalizeEmail`. | Must contain `@` symbol; malformed formats rejected with `INVALID_EMAIL`. |
| **`phone`** | Normalizes via `@cs/core` `normalizePhone`. | Must retain at least 7 digits; invalid numbers rejected with `INVALID_PHONE`. |
| **`json`** | Validates and parses JSON string representation. | Non-parseable strings rejected with `INVALID_JSON`. |

---

## 4. Enum Translation Tables & Allowlists

Enum values are translated case-insensitively from common legacy system terms to strict CRM-1 schema check constraint values.

### 4.1 Lead Status (`lead_status`)
- **Target Allowlist:** `['New', 'Working', 'Qualified', 'Closed']`
- **Source Translations:**
  - `new`, `open`, `created`, `incoming`, `uncontacted`, `prospect` &rarr; `New`
  - `working`, `in_progress`, `in-progress`, `contacted`, `active`, `engaged`, `attempted` &rarr; `Working`
  - `qualified`, `qualify`, `approved`, `converted`, `sales_qualified`, `marketing_qualified`, `sql`, `mql` &rarr; `Qualified`
  - `closed`, `won`, `lost`, `dead`, `disqualified`, `unqualified`, `archive`, `archived` &rarr; `Closed`
- **Rejection:** Any value outside the translation table or allowlist emits `INVALID_ENUM_VALUE`.

### 4.2 Consent Status (`consent_status`)
- **Target Allowlist:** `['unknown', 'granted', 'withdrawn']`
- **Source Translations:**
  - `unknown`, `pending`, `none`, `null`, `unspecified`, `not_set`, `empty` &rarr; `unknown`
  - `granted`, `yes`, `true`, `1`, `opt_in`, `opt-in`, `optin`, `subscribed`, `consented`, `agreed` &rarr; `granted`
  - `withdrawn`, `no`, `false`, `0`, `opt_out`, `opt-out`, `optout`, `unsubscribed`, `revoked`, `rejected` &rarr; `withdrawn`
- **Default:** If source value is blank, defaults to `'unknown'` in accordance with GDPR/privacy baseline.

---

## 5. Dry-Run Readiness & Required Target Field Guards

The `assertDryRunReady(template, sourceColumns)` guard verifies that all required schema attributes in the template have a corresponding column in the source headers:

1. **Failure Mode:** If one or more required fields are unmapped, an `AppError('MAPPING_INCOMPLETE')` with HTTP status 400 is thrown immediately.
2. **Rejection Details:** The error envelope contains structured details identifying each missing target field and expected source column name:
   ```json
   {
     "error": {
       "code": "MAPPING_INCOMPLETE",
       "message": "Unmapped required target fields for crm1-contacts-canonical@1",
       "details": [
         {
           "field": "firstName",
           "code": "MISSING_SOURCE_COLUMN",
           "message": "source column \"first_name\" not found in source file headers"
         }
       ]
     }
   }
   ```
3. **Execution Halt:** Under no circumstance is a dry run or target write permitted when required fields remain unmapped.

---

## 6. Endpoints & API Integration

- `GET /mappings/templates`: Returns all registered templates and enum dictionaries with SHA-256 checksums.
- `GET /mappings/templates/:id`: Retrieves a single template by ID and optional version query.
- `POST /mappings/validate`: Validates template readiness against provided source headers; returns 200 `{ ready: true }` or 400 `MAPPING_INCOMPLETE`.
- `POST /mappings/map`: Pure, non-mutating batch mapping and type coercion returning mapped target entities and failure logs.
