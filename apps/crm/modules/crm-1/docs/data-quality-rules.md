# CRM-1 Data Quality Rules

Ruleset version: 1. Fixture: `sample-data/crm-1/dirty-data-v1.csv` (checksum in `expected-profile.json`).

Raw input is never modified. Rules run on a normalized copy (email, consent_status, unsubscribed, id, and company_id lowercased; text fields trimmed). Exact matching only: no fuzzy matching and no automatic destructive merge. In-file exact duplicates keep the first row and count later rows as `merged` (raw rows are kept); duplicates against existing target data go to human review. A row takes the highest-precedence outcome: `reject` > `merge` > `normalize` > `accept`.

## 1. Rule Catalogue

| rule_id | v | field | outcome | code | input condition | reason |
|---|---|---|---|---|---|---|
| CRM1-DQ-001 | 1 | first_name | reject | REQUIRED_FIELD_MISSING | first_name empty after trim | first_name is required |
| CRM1-DQ-002 | 1 | last_name | reject | REQUIRED_FIELD_MISSING | last_name empty after trim | last_name is required |
| CRM1-DQ-003 | 1 | id | reject | MALFORMED_UUID | id present and not a lowercase-normalized UUID | id must be a valid UUID |
| CRM1-DQ-004 | 1 | email | reject | MALFORMED_EMAIL | email present and not valid RFC-5322 format | email must be valid RFC-5322 format |
| CRM1-DQ-005 | 1 | phone | reject | MALFORMED_PHONE | phone present and has fewer than 7 digits or invalid characters | phone must contain at least 7 digits and valid telephone characters |
| CRM1-DQ-006 | 1 | lead_status | reject | INVALID_ENUM_VALUE | lead_status present and not in allowlist | lead_status must be one of: New, Working, Qualified, Closed |
| CRM1-DQ-007 | 1 | company_id | reject | MALFORMED_UUID | company_id present and not a valid UUID | company_id must be a valid UUID |
| CRM1-DQ-008 | 1 | company_id | reject | FOREIGN_KEY_MISSING | company_id present, valid UUID, but not found in company registry | referenced company does not exist in crm1_companies |
| CRM1-DQ-009 | 1 | formula_prefix | reject | FORMULA_PREFIX | raw text field starts with spreadsheet formula prefix (=, +, -, or @) | spreadsheet formula prefixes are not allowed |
| CRM1-DQ-010 | 1 | consent_status | reject | INVALID_ENUM_VALUE | consent_status present and not in allowlist | consent_status must be one of: unknown, granted, withdrawn |
| CRM1-DQ-011 | 1 | field_length | reject | STRING_TOO_LONG | field length exceeds 255 character schema constraint | field length cannot exceed 255 characters |
| CRM1-DQ-012 | 1 | created_at | reject | INVALID_TIMESTAMP | created_at present and not ISO-8601 timestamp | created_at must be ISO-8601 (YYYY-MM-DDThh:mm:ss[.fff]Z) |
| CRM1-DQ-013 | 1 | updated_at | reject | INVALID_TIMESTAMP | updated_at present and not ISO-8601 timestamp | updated_at must be ISO-8601 (YYYY-MM-DDThh:mm:ss[.fff]Z) |
| CRM1-DQ-014 | 1 | updated_at | reject | CHRONOLOGY_VIOLATION | updated_at earlier than created_at | updated_at cannot precede created_at |
| CRM1-DQ-015 | 1 | whitespace | normalize | WHITESPACE_NORMALIZED | leading/trailing whitespace or tabs in text/email/phone/enum fields | whitespace trimmed and normalized; raw value preserved |
| CRM1-DQ-016 | 1 | id | merge | DUPLICATE_EXACT | id already seen earlier in the batch | exact duplicate id; first row wins, later rows counted as merged, raw rows kept |
| CRM1-DQ-017 | 1 | email | merge | DUPLICATE_EXACT | normalized email already seen earlier in the batch | exact duplicate normalized email key; first row wins, later rows counted as merged, raw rows kept |
| CRM1-DQ-018 | 1 | phone_name | merge | DUPLICATE_EXACT | normalized compound (phone, name) already seen earlier in the batch | exact duplicate compound (phone, name) key; first row wins, later rows counted as merged, raw rows kept |
| CRM1-DQ-019 | 1 | source_key | merge | DUPLICATE_EXACT | (source_system, source_id) natural key already seen earlier in the batch | exact duplicate source-system and source-id pair; first row wins, later rows counted as merged, raw rows kept |

---

## 2. Fields

- **Required Fields:** `first_name`, `last_name`.
- **Optional Fields:** `id`, `email`, `phone`, `address`, `company_id`, `lead_status`, `golden_id`, `source_system`, `source_id`, `consent_status` (default `'unknown'`), `consent_updated_at`, `unsubscribed` (default `false`), `unsubscribed_updated_at`, `created_at`, `updated_at`.

---

## 3. Enumerations

- **`lead_status`:** `['New', 'Working', 'Qualified', 'Closed']` (conforms to CRM SDS allowlist).
- **`consent_status`:** `['unknown', 'granted', 'withdrawn']`.
- **`unsubscribed`:** `['true', 'false']` (boolean flag).

---

## 4. Duplicate Candidate Keys & Referential Integrity

- **Exact Duplicate Candidate Keys:**
  1. `id`: Primary UUID match.
  2. `email`: Normalized email (`normalizeEmail`).
  3. `(phone, name)`: Normalized phone and combined normalized name (`${normalizePhone}#${normalizeName}`).
  4. `(source_system, source_id)`: External natural identity key.
- **Referential Integrity:** `company_id` if present must resolve to an existing entity in `crm1_companies` table/ledger (`ON DELETE RESTRICT`).
- **No Fuzzy Auto-Merge:** Ambiguous candidates require explicit human review in V1; destructive auto-merging is strictly prohibited.

---

## 5. Source-to-Target Mapping

- Canonical Mapping Template: `sample-data/crm-1/mapping-template.json` (Template ID: `crm1-contacts-canonical@1`).
- Target Entity: `crm1_contacts`.
- Target Schemas & API Prefix: `/api/v1/crm-contacts`.
