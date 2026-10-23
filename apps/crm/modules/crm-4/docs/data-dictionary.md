# ClearShift CRM — Data Dictionary: CRM-4 Marketing Lists and Campaign History

**Module ID:** `CRM-4`  
**Module Name:** Marketing Lists and Campaign History  
**Owning Team:** Team `crm-marketing` (Group 4 — Role 4 Data / QA Lead)  
**Schema Version:** 1.0.0  
**Storage Engine:** PostgreSQL 18.6 with Drizzle ORM (schema `crm4`)  
**Target Milestone:** Gate G4 Release Candidate (Weeks 7–8)  
**Access Pattern:** Authenticated module API `/api/v1/crm-marketing` with EdDSA JWTs & RBAC. Zero direct cross-module SQL mutations.  
**Traceability:** ClearShift Project Plan v3.0 §7.4, §9; SDS ClearShift CRM v2.0 §4, §7.1; V1: FR-CRM4-01..05; BR-CRM4-01; Issue #45 `[CRM4-10]`.

---

## 1. Entity Relationship Overview

CRM-4 maintains 4 core tables in the `crm4` PostgreSQL schema to record marketing segmentation lists, campaign history, participant activity, and contact consent records:

```
┌──────────────────────────────────────┐
│             crm4_lists               │
│ (Marketing Lists & Segmentation)     │
└──────────────────┬───────────────────┘
                   │
         1:N       │ (list_id — IMMUTABLE)
                   ▼
┌──────────────────────────────────────┐       ┌──────────────────────────────────────┐
│           crm4_campaigns             │       │            crm4_consents             │
│   (Historical Campaign Headers)      │       │      (Contact Consent Registry)      │
└──────────────────┬───────────────────┘       └──────────────────┬───────────────────┘
                   │                                              │
         1:N       │ (campaign_id)                                │ (action-time check)
                   ▼                                              │
┌──────────────────────────────────────┐                          │
│            crm4_members              │ ◄────────────────────────┘
│    (Campaign Participant Records)    │
└──────────────────────────────────────┘
```

---

## 2. Table Specifications (Field-Level Data Dictionary)

### 2.1 Table: `crm4_lists`
**Description:** Marketing segment and recipient list headers.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Business Rule | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID. | `44444444-1111-4444-8444-000000000001` |
| `name` | `text` | No | — | `length(btrim(name)) > 0`, max 255 | Descriptive list name. | `Q1 Enterprise Outreach` |
| `description` | `text` | Yes | `NULL` | — | Optional description of audience criteria. | `Strategic Fortune 500 accounts` |
| `campaign_count`| `integer` | No | `0` | `>= 0` | Computed number of associated campaigns. | `3` |
| `member_count` | `integer` | No | `0` | `>= 0` | Computed count of members across campaigns. | `150` |
| `created_at` | `timestamptz` | No | `now()` | Read-only | Creation audit timestamp. | `2026-10-01T00:00:00.000Z` |
| `updated_at` | `timestamptz` | No | `now()` | Read-only | Last modification timestamp. | `2026-10-01T00:00:00.000Z` |

---

### 2.2 Table: `crm4_campaigns`
**Description:** Marketing campaign execution records and historical metadata.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Business Rule | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID. | `44444444-2222-4444-8444-000000000001` |
| `name` | `text` | No | — | `length(btrim(name)) > 0`, max 255 | Human-readable campaign name. | `Q1 Launch Blitz` |
| `campaign_date`| `date` | No | — | Format `YYYY-MM-DD` | Execution date or reference timeline. | `2026-11-01` |
| `list_id` | `uuid` | No | — | FK to `crm4_lists.id` ON DELETE RESTRICT | **IMMUTABLE after creation**. Cannot be reassigned. | `44444444-1111-4444-8444-000000000001` |
| `member_count` | `integer` | No | `0` | `>= 0` | Recorded count of campaign participants. | `2` |
| `created_at` | `timestamptz` | No | `now()` | Read-only | Creation audit timestamp. | `2026-10-10T00:00:00.000Z` |
| `updated_at` | `timestamptz` | No | `now()` | Read-only | Last update timestamp. | `2026-10-10T00:00:00.000Z` |

---

### 2.3 Table: `crm4_members`
**Description:** Individual contact participation and response logging for a campaign.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Business Rule | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID. | `44444444-3333-4444-8444-000000000001` |
| `campaign_id` | `uuid` | No | — | FK to `crm4_campaigns.id` ON DELETE CASCADE | Parent campaign reference. | `44444444-2222-4444-8444-000000000001` |
| `contact_id` | `uuid` | No | — | Valid CRM-1 contact UUID | Contact recipient identifier. | `11111111-1111-4111-8111-000000000001` |
| `status` | `text` | No | `'sent'` | IN `('sent', 'opened', 'clicked')` | Restricted to strict engagement allowlist. | `opened` |
| `unsubscribed` | `boolean` | No | `false` | — | Whether recipient unsubscribed during this campaign. | `false` |
| `created_at` | `timestamptz` | No | `now()` | Read-only | Record insertion timestamp. | `2026-10-15T00:00:00.000Z` |

---

### 2.4 Table: `crm4_consents`
**Description:** Contact communication consent registry enforcing global privacy mandates.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Business Rule | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID. | `44444444-4444-4444-8444-000000000001` |
| `contact_id` | `uuid` | No | — | Unique Index | CRM-1 contact identifier. Exactly one active record. | `11111111-1111-4111-8111-000000000001` |
| `status` | `text` | No | `'subscribed'` | IN `('subscribed', 'unsubscribed')` | **BR-CRM4-01: Once `unsubscribed`, cannot revert to `subscribed`**. | `unsubscribed` |
| `consent_date` | `timestamptz` | No | `now()` | — | Timestamp of the consent assertion. | `2026-10-02T00:00:00.000Z` |
| `source` | `text` | No | — | `length(btrim(source)) > 0` | Origin channel (e.g. `web_form`, `unsubscribe_link`). | `unsubscribe_link` |
| `created_at` | `timestamptz` | No | `now()` | Read-only | Record creation timestamp. | `2026-10-02T00:00:00.000Z` |
| `updated_at` | `timestamptz` | No | `now()` | Read-only | Last modification timestamp. | `2026-10-02T00:00:00.000Z` |

---

## 3. Business Invariants & Integrity Constraints

1. **BR-CRM4-01 Monotonic Opt-Out Invariant**:
   * An opt-out assertion (`status = 'unsubscribed'`) is permanent and monotonically non-decreasing.
   * Neither standard updates, migration batch loads, nor bulk actions may revert a contact's consent to `'subscribed'`.
   * Any update attempting this transition is rejected with `HTTP 409 Conflict`.
2. **Campaign List Immutability**:
   * A campaign's parent `list_id` cannot be modified after initial creation. Attempted mutations return `HTTP 403 Forbidden`.
3. **Engagement Status Allowlist**:
   * Member status is strictly confined to `'sent'`, `'opened'`, and `'clicked'`. Any other status string fails schema validation (`HTTP 400 Bad Request`).
4. **Formula Injection Sanitization**:
   * Any CSV exported from CRM-4 sanitizes fields starting with `=`, `+`, `-`, `@`, `\t`, or `\r` by prepending a single quote (`'`).
