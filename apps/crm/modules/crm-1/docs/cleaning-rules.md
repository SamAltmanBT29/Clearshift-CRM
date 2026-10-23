# ClearShift CRM — Data Cleaning Rules & Field Audit Specification: CRM-1

- **Module ID:** `CRM-1`
- **Module Name:** Contacts, Companies and Leads
- **Owning Team:** Group 1 — Role 4 (Data / QA Lead)
- **Schema Version:** 1.0.0
- **Target Milestone:** Sprint 3 — Gate G3 (Clean & Map)
- **Traceability:** Issue #120 `[CRM1-27]`; ClearShift Project Plan v3.0 §3.4, §9.3; SDS ClearShift CRM v2.0 §4.2, §4.14; Master Architecture Blueprint Baseline 1.0-A §4.2; `KIT-04`.

---

## 1. Executive Summary

This document governs the deterministic data cleaning and normalization pipeline for **CRM-1 Contacts, Companies and Leads**.
During Migration Step 3 (Clean), source records extracted into staging undergo non-destructive standard transforms, recording a field-level audit entry for every transformed value and emitting structured row rejections for unrecoverable anomalies.

---

## 2. Rule Catalog & Transform Specifications

| Rule ID | Name | Target Fields | Operational Logic |
| :--- | :--- | :--- | :--- |
| **`RL-TEXT-01`** | Whitespace Normalization | All string fields | Trims leading and trailing whitespace; collapses two or more internal spaces or tabs into a single space (`v.trim().replace(/[ \t]{2,}/g, ' ')`). |
| **`RL-TEXT-02`** | Control Character Removal | All string fields | Removes non-printable ASCII control characters (`[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]`) that cause downstream database and display corruption. |
| **`RL-NAME-01`** | Proper Name Casing | `first_name`, `last_name`, `name`, `full_name` | Formats words to proper case, preserving special cultural casing (e.g. `O'Brien`, `McDonald`, `MacArthur`, hyphenated names like `Smith-Jones`). |
| **`RL-EMAIL-01`** | Email Normalization | `email`, `contact_email` | Lowercases and trims email addresses via `@cs/core` `normalizeEmail`. Flags or rejects invalid RFC syntax (missing `@` or dot in domain). |
| **`RL-PHONE-01`** | Phone Normalization | `phone`, `mobile`, `telephone` | Retains only digits and leading `+` via `@cs/core` `normalizePhone`. If a number has 10 digits without an international country prefix, prepends the declared batch country code (e.g. `+1`). |
| **`RL-TAX-01`** | Tax Identifier Standardization | `tax_number`, `taxNumber`, `ein` | Uppercases and strips punctuation delimiters (spaces, hyphens, periods) via `@cs/core` `normalizeTaxNumber`. |
| **`RL-DATE-01`** | Date Coercion | `created_at`, `updated_at`, `started_at`, `completed_at` | Coerces multi-format date representations (`YYYY-MM-DD`, `DD-MM-YYYY`, `DD/MM/YYYY`, `MM/DD/YYYY`) into standardized ISO-8601 timestamps (`YYYY-MM-DDTHH:mm:ss.sssZ`). Invalid date representations remain untouched without false audit generation. |
| **`RL-ENUM-01`** | Status & Enum Alignment | `lead_status`, `status`, `consent_status` | Maps lead status values case-insensitively to canonical allowlist (`New`, `Working`, `Qualified`, `Closed`). Lowercases consent statuses (`unknown`, `granted`, `withdrawn`). |

---

## 3. Field Change Audit Schema

Every modification made by an active cleaning rule generates an immutable audit record:

```typescript
export interface AuditEntry {
  source_row: number;       // 1-indexed source row number in source payload
  field_name: string;       // Name of the target property modified
  original_value: string;   // Exact pre-transformation string representation
  cleaned_value: string;    // Post-transformation clean value
  rule_id: string;          // Identifier of the executing cleaning rule (e.g., RL-TEXT-01)
}
```

*Note: Clean values that require no modification emit 0 audit entries, maintaining zero log pollution.*

---

## 4. Structured Row Rejections & Reason Codes

When a source row exhibits an unrecoverable anomaly that prevents safe staging and loading, the row is rejected with structured reason metadata:

| Reason Code | Trigger Condition | Severity | Plain-Language Error Message |
| :--- | :--- | :--- | :--- |
| **`REQUIRED_FIELD_MISSING`** | Empty or pure-whitespace value on a mandatory field (`first_name`, `last_name` for contacts; `name` for companies; `contact_id`, `status` for leads). | Fatal Row Rejection | `<field_name> is required and cannot be empty` |
| **`INVALID_EMAIL`** | Email address missing `@` or domain dot syntax. | Fatal Row Rejection | `Email '<value>' is not a valid format` |
| **`INVALID_PHONE`** | Phone number containing alphabetic letters. | Fatal Row Rejection | `Phone number '<value>' contains invalid alphabetic characters` |
| **`INVALID_LEAD_STATUS`** | Lead status value outside SDS allowlist (`New`, `Working`, `Qualified`, `Closed`). | Fatal Row Rejection | `Lead status '<value>' is not in allowed transitions` |
| **`FORMULA_INJECTION_RISK`** | Value starting with spreadsheet formula prefix character (`=`, `+`, `-`, `@`) on non-phone fields. | Security Rejection | `Field '<field>' contains unsafe spreadsheet formula prefix character` |

---

## 5. Row Outcome Conservation Balance Sheet

All evaluation strictly enforces the V1 ClearShift conservation balance sheet:

$$\text{source\_count} = \text{loaded} + \text{rejected} + \text{merged} + \text{skipped}$$
$$\text{unaccounted\_count} = 0$$

- **Loaded:** Rows that pass cleaning, required-field checks, and deduplication.
- **Rejected:** Rows with unrecoverable required-field or malformed syntax anomalies.
- **Merged:** Exact duplicate keys (`normalized email` or `normalized phone + name`) merged under explicit audit trail.
- **Skipped:** Explicitly skipped with authorized skip code.

---

## 6. Endpoints & Integrations

- **Service:** `Crm1CleaningService` in `apps/crm/modules/crm-1/src/services/crm1-cleaning.service.ts`
- **Module Cleaner:** `cleanRows`, `cleanContactRows`, `cleanCompanyRows`, `cleanLeadRows` in `apps/crm/modules/crm-1/src/kit/cleaner.ts`
- **API Endpoint:** `POST /api/v1/crm-contacts/cleaning/clean`
- **Frontend Audit View:** `CleaningAuditPage` in `apps/crm/modules/crm-1/web/pages/CleaningAuditPage.tsx`
