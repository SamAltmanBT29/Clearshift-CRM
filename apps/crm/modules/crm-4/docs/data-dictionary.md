# CRM-4 Marketing Lists & Campaign History — Field-Level Data Dictionary

**Document:** `apps/crm/modules/crm-4/docs/data-dictionary.md`  
**Module ID:** `CRM-4`  
**Module Name:** Marketing Lists and Campaign History (Group 4)  
**Schema:** PostgreSQL 18.6 schema `crm4`  
**Traceability:** Issue #36 `[CRM4-01]`, SDS ClearShift CRM v2.0 §4.4, §7.4, Project Plan v3.0 §7.4, PLT-03.

---

## 1. Overview & Architectural Boundaries

All tables in this module reside in the dedicated PostgreSQL schema `crm4`. Master data ownership is strictly enforced:
- **Primary Keys:** Surrogate UUIDs generated via `gen_random_uuid()` (PostgreSQL v4 UUID).
- **Timestamps:** UTC timestamps with timezone (`timestamptz`), defaulting to `now()`.
- **Cross-Module Boundaries (PLT-03):** No cross-schema foreign keys are permitted to external module tables.
  - References to CRM-1 contacts (`contact_id`) are stored as UUIDs; referential validity is asserted through CRM-1's public reference resolver API.
- **BR-CRM4-01 (Monotonic Opt-Out):** Once a contact's consent is set to `unsubscribed`, neither migration imports nor standard UI actions may revert the status to `subscribed`.
- **Campaign History Only:** No outbound delivery (email/SMS dispatch, SMTP, or messaging queue) in V1.

---

## 2. Table Specifications

### 2.1 `crm4.crm4_lists` (Marketing Lists)

Marketing audience segments and target groupings.

| Column Name | PostgreSQL Data Type | Nullable | Default | Constraints & Indexes | Business Rule & Validation Logic | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `UUID` | **NO** | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID primary key. | `44444444-1111-4444-8444-000000000001` |
| `name` | `TEXT` | **NO** | *None* | `CHECK (length(btrim(name)) > 0)`<br>`INDEX (lower(name))` | Marketing list name; non-empty trimmed text. Max 255 chars. | `Q4 Enterprise Prospects` |
| `description` | `TEXT` | YES | `NULL` | None | Human-readable list purpose or description. | `Target enterprise leads for Q4 outreach` |
| `campaign_count` | `INTEGER` | **NO** | `0` | `CHECK (campaign_count >= 0)` | Computed count of campaigns targeting this list. | `2` |
| `member_count` | `INTEGER` | **NO** | `0` | `CHECK (member_count >= 0)` | Computed total participants across linked campaigns. | `150` |
| `source_system` | `TEXT` | YES | `NULL` | `UNIQUE (source_system, source_id)`<br>`CHECK (pair check with source_id)` | Legacy origin system tag for migration traceability. | `hubspot_legacy` |
| `source_id` | `TEXT` | YES | `NULL` | `UNIQUE (source_system, source_id)`<br>`CHECK (pair check with source_system)` | Legacy record primary key. Paired uniqueness prevents duplicate import. | `list_9041` |
| `created_at` | `TIMESTAMPTZ` | **NO** | `now()` | `INDEX (created_at DESC)` | Creation audit timestamp. | `2026-10-23T08:00:00.000Z` |
| `updated_at` | `TIMESTAMPTZ` | **NO** | `now()` | None | Last mutation audit timestamp. | `2026-10-23T08:30:00.000Z` |

---

### 2.2 `crm4.crm4_campaigns` (Campaign History)

Historical campaigns recorded against marketing lists.

| Column Name | PostgreSQL Data Type | Nullable | Default | Constraints & Indexes | Business Rule & Validation Logic | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `UUID` | **NO** | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID primary key. | `44444444-2222-4444-8444-000000000001` |
| `name` | `TEXT` | **NO** | *None* | `CHECK (length(btrim(name)) > 0)` | Campaign name; non-empty trimmed text. Max 255 chars. | `Q4 Product Launch Announcement` |
| `campaign_date` | `DATE` | **NO** | *None* | `INDEX (campaign_date)` | Recorded execution or reference date (YYYY-MM-DD). | `2026-11-01` |
| `list_id` | `UUID` | **NO** | *None* | `FK -> crm4_lists(id) ON DELETE RESTRICT`<br>`INDEX (list_id)` | Linked marketing list. **IMMUTABLE after creation**. | `44444444-1111-4444-8444-000000000001` |
| `member_count` | `INTEGER` | **NO** | `0` | `CHECK (member_count >= 0)` | Recorded number of campaign participants. | `150` |
| `source_system` | `TEXT` | YES | `NULL` | `UNIQUE (source_system, source_id)`<br>`CHECK (pair check with source_id)` | Legacy origin system tag. | `hubspot_legacy` |
| `source_id` | `TEXT` | YES | `NULL` | `UNIQUE (source_system, source_id)`<br>`CHECK (pair check with source_system)` | Legacy campaign identifier. | `camp_1204` |
| `created_at` | `TIMESTAMPTZ` | **NO** | `now()` | `INDEX (created_at DESC)` | Creation audit timestamp. | `2026-10-23T08:00:00.000Z` |
| `updated_at` | `TIMESTAMPTZ` | **NO** | `now()` | None | Last mutation audit timestamp. | `2026-10-23T08:30:00.000Z` |

---

### 2.3 `crm4.crm4_members` (Campaign Membership & Status)

Recorded engagement status for contacts participating in a campaign.

| Column Name | PostgreSQL Data Type | Nullable | Default | Constraints & Indexes | Business Rule & Validation Logic | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `UUID` | **NO** | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID primary key. | `44444444-3333-4444-8444-000000000001` |
| `campaign_id` | `UUID` | **NO** | *None* | `FK -> crm4_campaigns(id) ON DELETE CASCADE`<br>`INDEX (campaign_id)` | Parent campaign reference. Deleting campaign cascades to members. | `44444444-2222-4444-8444-000000000001` |
| `contact_id` | `UUID` | **NO** | *None* | `INDEX (contact_id)` | CRM-1 contact reference. Validated via CRM-1 resolver API. | `11111111-1111-4111-8111-000000000001` |
| `status` | `TEXT` | **NO** | `'sent'` | `CHECK (status IN ('sent', 'opened', 'clicked'))`<br>`INDEX (status)` | Participant engagement status. No arbitrary statuses allowed. | `opened` |
| `unsubscribed` | `BOOLEAN` | **NO** | `false` | None | Indicates whether contact opted out during or via campaign. | `false` |
| `source_system` | `TEXT` | YES | `NULL` | `UNIQUE (source_system, source_id)` | Legacy origin system tag. | `hubspot_legacy` |
| `source_id` | `TEXT` | YES | `NULL` | `UNIQUE (source_system, source_id)` | Legacy membership record primary key. | `mem_501` |
| `created_at` | `TIMESTAMPTZ` | **NO** | `now()` | `INDEX (created_at DESC)` | Membership creation timestamp. | `2026-10-23T08:00:00.000Z` |

**Table Invariants:**
- `UNIQUE (campaign_id, contact_id)`: A contact cannot be added more than once to the same campaign.

---

### 2.4 `crm4.crm4_consents` (Contact Consent Ledger)

Contact marketing consent state and audit trail.

| Column Name | PostgreSQL Data Type | Nullable | Default | Constraints & Indexes | Business Rule & Validation Logic | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `UUID` | **NO** | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID primary key. | `44444444-4444-4444-8444-000000000001` |
| `contact_id` | `UUID` | **NO** | *None* | `UNIQUE (contact_id)` | Unique reference to CRM-1 contact. One consent record per contact. | `11111111-1111-4111-8111-000000000001` |
| `status` | `TEXT` | **NO** | *None* | `CHECK (status IN ('subscribed', 'unsubscribed'))`<br>`INDEX (status)` | Consent status. **BR-CRM4-01**: `unsubscribed` is monotonic and cannot revert. | `subscribed` |
| `consent_date` | `TIMESTAMPTZ` | **NO** | `now()` | None | Exact timestamp of consent grant or withdrawal. | `2026-10-23T08:00:00.000Z` |
| `source` | `TEXT` | **NO** | *None* | `CHECK (length(btrim(source)) > 0)` | Channel or origin of consent assertion (e.g. web form, CSV import). | `web_form` |
| `source_system` | `TEXT` | YES | `NULL` | `UNIQUE (source_system, source_id)` | Legacy origin system tag. | `hubspot_legacy` |
| `source_id` | `TEXT` | YES | `NULL` | `UNIQUE (source_system, source_id)` | Legacy consent identifier. | `consent_991` |
| `created_at` | `TIMESTAMPTZ` | **NO** | `now()` | None | Creation audit timestamp. | `2026-10-23T08:00:00.000Z` |
| `updated_at` | `TIMESTAMPTZ` | **NO** | `now()` | `INDEX (updated_at DESC)` | Last update audit timestamp. | `2026-10-23T08:30:00.000Z` |

---

### 2.5 `crm4.crm4_import_batches` (Migration Kit Batches)

Tracks migration batches loaded into CRM-4.

| Column Name | PostgreSQL Data Type | Nullable | Default | Constraints & Indexes | Business Rule & Validation Logic | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `UUID` | **NO** | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID primary key. | `44444444-5555-4444-8444-000000000001` |
| `source_system` | `TEXT` | **NO** | *None* | `CHECK (length(btrim(source_system)) > 0)` | Source system identifier. | `hubspot` |
| `status` | `TEXT` | **NO** | `'pending'` | `CHECK (status IN ('pending', 'processing', 'completed', 'failed'))` | Batch lifecycle status. | `completed` |
| `idempotency_key` | `TEXT` | YES | `NULL` | `UNIQUE (idempotency_key)` | Batch-level idempotency key. | `batch-crm4-20261023-01` |
| `request_hash` | `TEXT` | YES | `NULL` | None | SHA-256 payload digest. | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `loaded_count` | `INTEGER` | **NO** | `0` | `CHECK (loaded_count >= 0)` | Count of successfully ingested records. | `100` |
| `rejected_count` | `INTEGER` | **NO** | `0` | `CHECK (rejected_count >= 0)` | Count of rejected records. | `0` |
| `created_at` | `TIMESTAMPTZ` | **NO** | `now()` | `INDEX (created_at DESC)` | Ingestion initiation timestamp. | `2026-10-23T08:00:00.000Z` |
| `updated_at` | `TIMESTAMPTZ` | **NO** | `now()` | None | Last update timestamp. | `2026-10-23T08:05:00.000Z` |
| `completed_at` | `TIMESTAMPTZ` | YES | `NULL` | None | Batch completion timestamp. | `2026-10-23T08:05:00.000Z` |

---

### 2.6 `crm4.crm4_import_receipts` (Durable Ingestion Receipts)

Row-level transaction receipts providing durable idempotency.

| Column Name | PostgreSQL Data Type | Nullable | Default | Constraints & Indexes | Business Rule & Validation Logic | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `UUID` | **NO** | `gen_random_uuid()` | Primary Key | Immutable receipt UUID. | `44444444-6666-4444-8444-000000000001` |
| `batch_id` | `UUID` | **NO** | *None* | `FK -> crm4_import_batches(id) ON DELETE CASCADE` | Associated batch identifier. | `44444444-5555-4444-8444-000000000001` |
| `source_row` | `INTEGER` | **NO** | *None* | `CHECK (source_row > 0)` | 1-based source spreadsheet/CSV row number. | `1` |
| `entity` | `TEXT` | **NO** | *None* | `CHECK (entity IN ('list', 'campaign', 'member', 'consent'))` | Ingested target entity type. | `consent` |
| `source_system` | `TEXT` | **NO** | *None* | `CHECK (length(btrim(source_system)) > 0)` | Source system identifier. | `hubspot` |
| `source_id` | `TEXT` | **NO** | *None* | `CHECK (length(btrim(source_id)) > 0)` | Source record identifier. | `con_1001` |
| `target_id` | `UUID` | **NO** | *None* | `INDEX (target_id)` | UUID of the committed target entity record. | `44444444-4444-4444-8444-000000000001` |
| `idempotency_key` | `TEXT` | **NO** | *None* | `UNIQUE (idempotency_key)` | Deterministic composite hash key. | `rcpt-crm4-hubspot-con_1001` |
| `created_at` | `TIMESTAMPTZ` | **NO** | `now()` | `INDEX (created_at DESC)` | Receipt persistence timestamp. | `2026-10-23T08:05:00.000Z` |

**Table Invariants:**
- `UNIQUE (batch_id, source_row, entity)`: Ensures exactly one outcome receipt per source row and entity in a batch.
