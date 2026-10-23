# ClearShift CRM — Data Cleaning Rules & Field Audit Specification: CRM-4

- **Module ID:** `CRM-4`
- **Module Name:** Marketing Lists and Campaign History
- **Owning Team:** Group 4 — Role 4 (Data / QA Lead)
- **Schema Version:** 1.0.0
- **Target Milestone:** Sprint 3 — Gate G3 (Clean & Map)
- **Traceability:** Issue #180 `[CRM4-27]`; ClearShift Project Plan v3.0 §3.4, §9.3; SDS ClearShift CRM v2.0 §4.5, §4.7, §4.14; Master Architecture Blueprint Baseline 1.0-A §4.2; `KIT-04`.

---

## 1. Executive Summary

This specification governs the deterministic data cleaning, normalization pipeline, and field-level change audit trail for **CRM-4 Marketing Lists and Campaign History**.
During Migration Step 3 (Clean), raw source records extracted into staging undergo non-destructive standard transforms, recording a field-level audit entry for every transformed value and emitting structured row rejections for unrecoverable anomalies.

---

## 2. Rule Catalog & Transform Specifications

| Rule ID | Name | Target Fields | Operational Logic |
| :--- | :--- | :--- | :--- |
| **`RL-TEXT-01`** | Whitespace Normalization | All string fields | Trims leading and trailing whitespace; collapses repeated internal spaces or tabs into a single space (`v.trim().replace(/[ \t]{2,}/g, ' ')`). |
| **`RL-TEXT-02`** | Control Character Removal | All string fields | Removes non-printable ASCII control characters (`[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]`) that cause database and display corruption. |
| **`RL-NAME-01`** | Proper Name Casing | `first_name`, `last_name`, `full_name`, `contact_name` | Formats person names to proper case, preserving special cultural prefixes (e.g. `O'Brien`, `McDonald`, `MacArthur`, hyphenated names like `Smith-Jones`). |
| **`RL-EMAIL-01`** | Email Normalization | `email`, `contact_email` | Lowercases and trims email addresses via `@cs/core` `normalizeEmail`. |
| **`RL-PHONE-01`** | Phone Normalization | `phone`, `mobile`, `telephone` | Retains only digits and leading `+` via `@cs/core` `normalizePhone`. If a number has 10 digits without an international country prefix, prepends the declared batch country code (e.g. `+1`). |
| **`RL-DATE-01`** | Date Coercion | `campaign_date`, `date`, `started_at`, `completed_at` | Coerces multi-format date representations (`YYYY-MM-DD`, `DD-MM-YYYY`, `DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY.MM.DD`, `YYYY/MM/DD`, English month names) into standardized ISO-8601 date strings (`YYYY-MM-DD`). Unparseable dates trigger structured row rejection. |
| **`RL-ENUM-01`** | Status & Enum Alignment | `member_status`, `consent_status`, `prior_consent_status`, `unsubscribed` | Normalizes enum statuses case-insensitively to lowercase canonical allowlists. |
| **`RL-FORMULA-01`** | Formula Neutralization | All string fields | Sanitizes spreadsheet command trigger prefixes (`=`, `@`, `+`, `-`) by prepending a single quote (`'`) when formula neutralization is enabled. |

---

## 3. Field Change Audit Schema

Every modification made by an active cleaning rule generates an immutable audit entry:

```typescript
export interface AuditEntry {
  source_row: number;       // 1-indexed source row number in source payload
  field_name: string;       // Name of the target property modified
  original_value: string;   // Exact pre-transformation string representation
  cleaned_value: string;    // Post-transformation clean value
  rule_id: string;          // Identifier of the executing cleaning rule (e.g., RL-TEXT-01)
}
```

*Note: Clean values requiring no modification generate zero audit entries, maintaining zero log pollution.*

---

## 4. Structured Row Rejections & Reason Codes

When a source row exhibits an unrecoverable anomaly that prevents safe staging, mapping, and loading, the row is rejected with structured reason metadata:

| Reason Code | Trigger Condition | Severity | Plain-Language Error Message |
| :--- | :--- | :--- | :--- |
| **`REQUIRED_FIELD_MISSING`** | Empty or pure-whitespace value on a mandatory field (`name` for lists/campaigns; `contact_id`, `campaign_id`, `member_status` for members; `contact_id`, `consent_status`, `consent_source` for consents). | Fatal Row Rejection | `Required field '<field>' is missing or empty for entity '<entity>'` |
| **`INVALID_MEMBER_STATUS`** | Member status value outside SDS allowlist (`sent`, `opened`, `clicked`). States such as `bounced`, `delivered`, `draft`, `failed`, `queued` are rejected. | Fatal Row Rejection | `Member status '<status>' is not in allowed allowlist: sent, opened, clicked` |
| **`MONOTONIC_OPT_OUT_VIOLATION`** | Re-subscription attempt for a contact with known prior `unsubscribed` status (**BR-CRM4-01**). | Fatal Domain Rejection | `Domain rule violation (BR-CRM4-01): Opt-out is strictly monotonic. Once unsubscribed, re-subscription via import is prohibited.` |
| **`INVALID_DATE_FORMAT`** | Campaign date value that cannot be parsed into canonical `YYYY-MM-DD` date format. | Fatal Row Rejection | `Campaign date '<date>' cannot be parsed into canonical YYYY-MM-DD date format` |
| **`FORMULA_INJECTION_RISK`** | Value starting with spreadsheet formula execution prefix (e.g. `=cmd|'/C calc'!A0`). | Security Rejection | `Malicious spreadsheet calculation payload detected in field '<field>'` |

---

## 5. Row Outcome Conservation Balance Sheet

All evaluation strictly enforces the V1 ClearShift conservation balance sheet:

$$\text{source\_count} = \text{cleaned} + \text{rejected}$$
$$\text{unaccounted\_count} = 0$$

- **Cleaned:** Rows that pass cleaning, required-field checks, and domain invariant validation.
- **Rejected:** Rows with unrecoverable required-field, malformed syntax, or privacy violations.

---

## 6. Implementation Exports & Location

- **Cleaner Implementation:** `apps/crm/modules/crm-4/src/kit/cleaner.ts`
- **Automated Tests:** `apps/crm/modules/crm-4/tests/kit/cleaner.test.ts`
- **Module Facade:** Re-exported via `apps/crm/modules/crm-4/src/index.ts`
