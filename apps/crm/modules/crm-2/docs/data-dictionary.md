# CRM-2 Deals, Pipeline and Quotes — Field-Level Data Dictionary

**Document:** `apps/crm/modules/crm-2/docs/data-dictionary.md`  
**Module ID:** `CRM-2`  
**Module Name:** Deals, Pipeline Stages and Quotes (Group 2 — Role 4 Data / QA Lead)  
**Schema:** PostgreSQL 18.6 schema `crm2`  
**Traceability:** Issue #137 `[CRM2-24]`, SDS ClearShift CRM v2.0 §4.2, §4.7, Master Architecture Baseline 1.0-A §4.2, PLT-03.

---

## 1. Overview & Architectural Boundaries

All tables in this module reside in the dedicated PostgreSQL schema `crm2`. Master data ownership is strictly enforced:
- **Primary Keys:** Surrogate UUIDs generated via `gen_random_uuid()` (PostgreSQL v4 UUID).
- **Timestamps:** UTC timestamps with timezone (`timestamptz`), defaulting to `now()`.
- **Monetary Quantities:** PostgreSQL `numeric(14,2)` precision. IEEE-754 floating point numbers are strictly forbidden.
- **Cross-Module Boundaries (PLT-03):** No cross-schema foreign keys are permitted to external module tables.
  - References to CRM-1 contacts (`contact_id`) are stored as nullable UUIDs; referential validity is asserted through CRM-1's public reference resolver API.
  - References to ERP-1 products (`product_id`) in quote lines are resolved through the ERP-1 catalog API.
  - Orphan deals (where `contact_id` is null or contact is deleted) are permitted by design so migrated legacy deals are never hidden from operators; the UI flags orphans with a visible warning badge.

---

## 2. Table Specifications

### 2.1 `crm2.crm2_stages` (Pipeline Stages)

Fixed pipeline stages defining the sales workflow. Seeded during database migration; read-only during normal business operations.

| Column Name | PostgreSQL Data Type | Nullable | Default | Constraints & Indexes | Business Rule & Validation Logic | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `UUID` | **NO** | `gen_random_uuid()` | Primary Key | Immutable surrogate primary key. | `11111111-1111-4000-8000-000000000001` |
| `name` | `TEXT` | **NO** | *None* | `UNIQUE`<br>`CHECK (name IN ('New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'))` | Fixed stage names. Additions, renames, and deletions are strictly rejected. | `Proposal` |
| `position` | `SMALLINT` | **NO** | *None* | `UNIQUE`<br>`CHECK (position BETWEEN 1 AND 6)` | Display ordering integer in sales pipeline. | `3` |
| `is_won` | `BOOLEAN` | **NO** | `false` | `CHECK (is_won = (name = 'Won'))` | Indicates successful deal terminal closure. Strictly true only for stage "Won". | `false` |

---

### 2.2 `crm2.crm2_deals` (Sales Opportunities)

Core business opportunities tracked through the sales pipeline.

| Column Name | PostgreSQL Data Type | Nullable | Default | Constraints & Indexes | Business Rule & Validation Logic | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `UUID` | **NO** | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID primary key. | `d1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a` |
| `name` | `TEXT` | **NO** | *None* | `CHECK (length(btrim(name)) > 0)`<br>`INDEX (lower(name))` | Opportunity title; trimmed length must be greater than zero. Max 255 chars. | `Acme Cloud Infrastructure Expansion` |
| `contact_id` | `UUID` | YES | `NULL` | `INDEX (contact_id)` | Link to CRM-1 contact. Nullable so orphan deals can be represented and warned about. | `a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d` |
| `value` | `NUMERIC(14,2)` | **NO** | *None* | `CHECK (value >= 0)` | Monetary opportunity value. Fixed decimal precision; negative amounts rejected. | `45000.00` |
| `currency` | `TEXT` | **NO** | *None* | `CHECK (currency ~ '^[A-Z]{3}$')` | ISO 4217 currency code: exactly 3 uppercase letters (e.g. USD, EUR, GBP, INR). | `USD` |
| `stage_id` | `UUID` | **NO** | *None* | `FK -> crm2_stages(id) ON DELETE RESTRICT`<br>`INDEX (stage_id)` | Mandatory reference to current pipeline stage. | `11111111-1111-4000-8000-000000000001` |
| `close_date` | `DATE` | YES | `NULL` | `INDEX (close_date)` | Expected or actual close date (YYYY-MM-DD). Form-required in V1. | `2026-11-30` |
| `source_system` | `TEXT` | YES | `NULL` | `UNIQUE (source_system, source_id)`<br>`CHECK (pair check with source_id)` | Legacy origin system tag for migration traceability. | `pipedrive_legacy` |
| `source_id` | `TEXT` | YES | `NULL` | `UNIQUE (source_system, source_id)`<br>`CHECK (pair check with source_system)` | Legacy record primary key. Paired uniqueness prevents duplicate import. | `deal_89412` |
| `created_at` | `TIMESTAMPTZ` | **NO** | `now()` | UTC Timestamp | Creation audit timestamp. | `2026-10-23T08:00:00.000Z` |
| `updated_at` | `TIMESTAMPTZ` | **NO** | `now()` | UTC Timestamp | Last mutation audit timestamp. | `2026-10-23T08:30:00.000Z` |

---

### 2.3 `crm2.crm2_quotes` (Commercial Quotes)

Commercial proposals generated for deals.

| Column Name | PostgreSQL Data Type | Nullable | Default | Constraints & Indexes | Business Rule & Validation Logic | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `UUID` | **NO** | `gen_random_uuid()` | Primary Key | Immutable surrogate primary key. | `q1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c` |
| `quote_number` | `TEXT` | **NO** | *None* | `UNIQUE`<br>`CHECK (length(btrim(quote_number)) > 0)` | Unique human-readable quote reference identifier. | `Q-2026-001` |
| `deal_id` | `UUID` | **NO** | *None* | `FK -> crm2_deals(id) ON DELETE RESTRICT`<br>`INDEX (deal_id)` | Parent deal. Deletion of parent deal is blocked while quotes exist. | `d1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a` |
| `quote_date` | `DATE` | **NO** | *None* | `INDEX (quote_date)` | Issuance date of the quote (YYYY-MM-DD). | `2026-10-23` |
| `amount` | `NUMERIC(14,2)` | **NO** | *None* | `CHECK (amount >= 0)` | Total quote monetary value. Decimal precision; negative amounts rejected. | `45000.00` |
| `note` | `TEXT` | YES | `NULL` | Free text | Commercial notes, payment schedules, and terms. | `Standard Net 30 payment terms.` |
| `source_system` | `TEXT` | YES | `NULL` | `UNIQUE (source_system, source_id)`<br>`CHECK (pair check with source_id)` | Origin system identifier for migration traceability. | `salesforce_quotes` |
| `source_id` | `TEXT` | YES | `NULL` | `UNIQUE (source_system, source_id)`<br>`CHECK (pair check with source_system)` | Legacy primary key in source system. | `sf_quote_10294` |
| `created_at` | `TIMESTAMPTZ` | **NO** | `now()` | UTC Timestamp | Creation audit timestamp. | `2026-10-23T08:10:00.000Z` |
| `updated_at` | `TIMESTAMPTZ` | **NO** | `now()` | UTC Timestamp | Last update audit timestamp. | `2026-10-23T08:20:00.000Z` |

---

### 2.4 `crm2.crm2_quote_lines` (Quote Line Items)

Granular product or service line items associated with a quote.

| Column Name | PostgreSQL Data Type | Nullable | Default | Constraints & Indexes | Business Rule & Validation Logic | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `UUID` | **NO** | `gen_random_uuid()` | Primary Key | Immutable surrogate primary key. | `l1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c` |
| `quote_id` | `UUID` | **NO** | *None* | `FK -> crm2_quotes(id) ON DELETE CASCADE`<br>`INDEX (quote_id)` | Parent quote. Cascade deleted if parent quote is purged. | `q1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c` |
| `line_number` | `INTEGER` | **NO** | *None* | `UNIQUE (quote_id, line_number)`<br>`CHECK (line_number > 0)` | 1-indexed line order within the quote. | `1` |
| `product_id` | `UUID` | YES | `NULL` | Application Guard | Reference to ERP-1 product catalog item. | `e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b` |
| `description` | `TEXT` | **NO** | *None* | `CHECK (length(btrim(description)) > 0)` | Item or service description. | `Enterprise Cloud Host Instance (Annual)` |
| `quantity` | `NUMERIC(12,4)` | **NO** | `'1.0000'` | `CHECK (quantity > 0)` | Order quantity with up to 4 decimal places. Strictly positive. | `3.0000` |
| `unit_price` | `NUMERIC(14,2)` | **NO** | *None* | `CHECK (unit_price >= 0)` | Unit price in deal currency. Non-negative. | `15000.00` |
| `line_total` | `NUMERIC(14,2)` | **NO** | *None* | `CHECK (line_total >= 0)` | Server-computed line amount (`quantity * unit_price`). | `45000.00` |
| `created_at` | `TIMESTAMPTZ` | **NO** | `now()` | UTC Timestamp | Creation audit timestamp. | `2026-10-23T08:15:00.000Z` |
| `updated_at` | `TIMESTAMPTZ` | **NO** | `now()` | UTC Timestamp | Last update audit timestamp. | `2026-10-23T08:15:00.000Z` |

---

### 2.5 `crm2.crm2_import_batches` (Migration Batch Ledger)

Tracks migration batch runs, processing states, and summary counters.

| Column Name | PostgreSQL Data Type | Nullable | Default | Constraints & Indexes | Business Rule & Validation Logic | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `UUID` | **NO** | `gen_random_uuid()` | Primary Key | Surrogate UUID for the batch run. | `b2a3c4d5-0000-4000-8000-222233334444` |
| `source_system` | `TEXT` | **NO** | *None* | `CHECK (length(btrim(source_system)) > 0)` | Ingest origin name (e.g. `pipedrive_deals`). | `pipedrive_deals` |
| `status` | `TEXT` | **NO** | `'pending'` | `CHECK (status IN ('pending', 'processing', 'completed', 'failed'))` | Batch state machine status. | `completed` |
| `idempotency_key` | `TEXT` | YES | `NULL` | `UNIQUE` | Batch idempotency key supplied by Migration Kit. | `mig-crm2-batch-2026-001` |
| `request_hash` | `TEXT` | YES | `NULL` | Paired with `idempotency_key` | SHA-256 payload digest verifying request integrity on retry. | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `loaded_count` | `INTEGER` | **NO** | `0` | `CHECK (loaded_count >= 0)` | Total records committed successfully. | `75` |
| `rejected_count` | `INTEGER` | **NO** | `0` | `CHECK (rejected_count >= 0)` | Total records rejected with recorded audits. | `17` |
| `created_at` | `TIMESTAMPTZ` | **NO** | `now()` | `INDEX (created_at)` | Ingest start timestamp. | `2026-10-23T08:00:00.000Z` |
| `updated_at` | `TIMESTAMPTZ` | **NO** | `now()` | UTC Timestamp | Last batch counter update. | `2026-10-23T08:02:15.000Z` |
| `completed_at` | `TIMESTAMPTZ` | YES | `NULL` | UTC Timestamp | Completion timestamp when terminal state reached. | `2026-10-23T08:02:15.000Z` |

---

### 2.6 `crm2.crm2_import_receipts` (Durable Per-Row Receipts)

Durable receipts committed atomically with target business mutations in the same PostgreSQL transaction (KIT-08).

| Column Name | PostgreSQL Data Type | Nullable | Default | Constraints & Indexes | Business Rule & Validation Logic | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `UUID` | **NO** | `gen_random_uuid()` | Primary Key | Surrogate UUID for the receipt. | `r2e3f4a5-b6c7-4d8e-9f0a-1b2c3d4e5f6a` |
| `batch_id` | `UUID` | **NO** | *None* | `FK -> crm2_import_batches(id) ON DELETE CASCADE` | Parent migration batch. Cascade-deleted if batch purged. | `b2a3c4d5-0000-4000-8000-222233334444` |
| `source_row` | `INTEGER` | **NO** | *None* | `CHECK (source_row > 0)`<br>`UNIQUE (batch_id, source_row, entity)` | 1-indexed source row number in input file. | `12` |
| `entity` | `TEXT` | **NO** | *None* | `CHECK (entity IN ('deal', 'quote', 'stage', 'quote_line'))` | Target entity type. | `deal` |
| `source_system` | `TEXT` | **NO** | *None* | `CHECK (length(btrim(source_system)) > 0)` | Origin legacy system tag. | `csv_upload_deals` |
| `source_id` | `TEXT` | **NO** | *None* | `CHECK (length(btrim(source_id)) > 0)` | Legacy identifier or synthetic row key. | `row_deal_12` |
| `target_id` | `UUID` | **NO** | *None* | `INDEX (target_id)` | Primary key of created/mutated target record. | `d1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a` |
| `idempotency_key` | `TEXT` | **NO** | *None* | `UNIQUE`<br>`CHECK (length(btrim(idempotency_key)) > 0)` | Stable key: `${batchId}:${sourceRow}:${entity}`. | `b2a3c4d5-0000-4000-8000-222233334444:12:deal` |
| `created_at` | `TIMESTAMPTZ` | **NO** | `now()` | UTC Timestamp | Commit timestamp. | `2026-10-23T08:01:00.000Z` |

---

### 2.7 `crm2.crm2_import_rejects` (Migration Reject Audits)

Stores row-level rejections with machine reason codes and privacy-safe diagnostic messages.

| Column Name | PostgreSQL Data Type | Nullable | Default | Constraints & Indexes | Business Rule & Validation Logic | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `UUID` | **NO** | `gen_random_uuid()` | Primary Key | Surrogate UUID for the rejection audit entry. | `j2a3b4c5-d6e7-4f8a-9b0c-1d2e3f4a5b6c` |
| `batch_id` | `UUID` | **NO** | *None* | `FK -> crm2_import_batches(id) ON DELETE CASCADE`<br>`INDEX (batch_id)` | Parent migration batch. | `b2a3c4d5-0000-4000-8000-222233334444` |
| `source_row` | `INTEGER` | **NO** | *None* | `CHECK (source_row > 0)` | 1-indexed source row number where failure occurred. | `33` |
| `entity` | `TEXT` | **NO** | *None* | `CHECK (entity IN ('deal', 'quote', 'stage', 'quote_line'))` | Target entity type. | `deal` |
| `reason_code` | `TEXT` | **NO** | *None* | `CHECK (length(btrim(reason_code)) > 0)` | Machine-readable rejection code (e.g. `NEGATIVE_VALUE`). | `NEGATIVE_VALUE` |
| `message` | `TEXT` | **NO** | *None* | `CHECK (length(btrim(message)) > 0)` | Privacy-safe, non-PII explanation of rejection. | `Deal monetary value must be a non-negative decimal quantity` |
| `created_at` | `TIMESTAMPTZ` | **NO** | `now()` | UTC Timestamp | Audit creation timestamp. | `2026-10-23T08:01:10.000Z` |

---

## 3. Migration Target Adapter & Durable Import Receipt Contract (KIT-08 / [CRM2-11])

### 3.1 Architecture & In-Process Execution Boundary
In strict accordance with SDS ClearShift CRM v2.0 §4.2, Gate G2 requirements, and Decision C4, migration data loading is governed by `Crm2TargetAdapter` implementing the `@cs/kit` `TargetAdapter` port:
- **Zero Direct SQL Privileges:** External migration loaders never write directly to `crm2.*` tables. All data commits occur strictly through in-process domain operations or public REST endpoints (`POST /api/v1/crm-deals/import/row`, `POST /api/v1/crm-deals/import/batch`).
- **Atomic Local Transaction:** For every imported row, the target business entity (deal, quote, stage link, quote line) and its durable import receipt (`crm2_import_receipts`) commit atomically in one local database transaction. If the receipt cannot be persisted, the domain mutation rolls back completely.
- **Type-Safe UPSERT:** Ingesting a record with a known `source_system` and `source_id` updates/links the existing target entity (`outcome: 'linked'`) without duplicating business records. New source entities are inserted (`outcome: 'created'`).

### 3.2 Durable Import Receipt Schema & Field Registry
Import receipts persist in `crm2.crm2_import_receipts` with immutable audit fields:
- `id`: UUID surrogate key
- `batch_id`: Migration batch identifier
- `source_row`: 1-indexed source row number
- `entity`: Target entity (`deal`, `quote`, `stage`, `quote_line`)
- `source_system`: Legacy origin system name
- `source_id`: Legacy primary key
- `target_id`: UUID of committed business entity
- `idempotency_key`: Stable deduplication key
- `payload_hash`: SHA-256 canonical payload digest
- `kind` / `outcome`: `created` or `linked`
- `created_at`: UTC timestamp of atomic commit

### 3.3 Idempotency Policy & Conflict Semantics
- **Identical Replay:** Re-submitting an identical row with the same `Idempotency-Key` and matching payload returns the previously generated receipt with HTTP 200 OK and `isExisting: true`, producing zero duplicate records.
- **Payload Conflict:** Submitting an existing `Idempotency-Key` with an altered payload immediately aborts with HTTP 409 Conflict (`IDEMPOTENCY_KEY_REUSED`) without mutating any data.
- **Preflight Dry-Run:** `preflight(batchId, rows)` validates business invariants across entire batches with zero database mutations.

---

## 4. Exact Duplicate Key Policy & Human Review Audit (CRM2-12 / Issue #125)

### 4.1 Policy Overview
To prevent data contamination and duplicate records during migration and ongoing CRM-2 operations, deterministic exact-duplicate matching keys and human review governance are enforced:
1. **Deterministic Exact Matching Only**: Fuzzy scoring, probabilistic algorithms, and automatic merging (`autoMerge: true`) are strictly forbidden in V1 (HTTP 422 `AUTO_MERGE_FORBIDDEN`).
2. **Review Holding Queue**: All detected duplicates are quarantined in `held_for_review` status pending authorized operator action.
3. **Mandatory Human Audit**: Merge and reject actions require authenticated `actorId`, explicit rationale (`reason`), and strict validation that `keptId !== mergedId`.
4. **Child Quotes Reassignment**: When merging deals (`MERGE`), child quotes referencing `mergedId` are safely reassigned to `keptId` within the domain service.

### 4.2 Normalized Exact Keys
- **Deal Business Key (`deal_business`)**: `${btrim(lower(name))}#${stageId}#${contactId || 'orphan'}`
- **Deal Name + Contact Key (`deal_name_contact`)**: `${contactId || 'orphan'}#${btrim(lower(name))}`
- **Quote Number Key (`quote_number`)**: `btrim(upper(quote_number))`
- **Quote Line Key (`quote_line_sku`)**: `${quoteId}#${lineNumber}#${btrim(upper(sku || 'NOSKU'))}`
- **Source System Pair Key (`source_key`)**: `${lower(source_system)}:${btrim(source_id)}`
- **Shared Platform Keys**: `email` (`btrim(lower(email))`), `tax_id` (`upper(replace(nonAlphanumeric, ''))`), `sku` (`btrim(upper(sku))`).

---

## 4. Chunked Batch Ingestion & Partial-Load Stop Behavior (CRM2-13)

### 4.1 500-Row Chunked Processing
All load operations slice large input datasets into sequential chunks of 500 records (`CRM2_DEFAULT_CHUNK_SIZE = 500`). This bounds PostgreSQL transaction sizes, memory allocation, and connection lock retention.

### 4.2 Idempotent Retry with Bounded Exponential Backoff
Transient worker or infrastructure failures trigger bounded exponential backoff retries:
$$\text{delay} = \text{baseBackoffMs} \times 2^{\text{attempt}}$$
* **Maximum Retries:** Default 3 attempts (`CRM2_DEFAULT_MAX_RETRIES = 3`).
* **Idempotency Protection:** The unique `idempotencyKey` passed per source row is strictly preserved across all retry attempts and never mutated or corrupted.

### 4.3 10% Partial-Load Stop Policy (`STOPPED_EXCESSIVE_FAILURES`)
To prevent cascading data corruption:
$$\text{failureRate} = \frac{\text{cumulativeFailedRows}}{\text{cumulativeAttemptedRows}}$$
* When `cumulativeAttemptedRows >= 50` and `failureRate > 0.10` (10%):
  1. Batch execution ceases immediately.
  2. Batch status transitions to `STOPPED_EXCESSIVE_FAILURES`.
  3. **Durability Guarantee:** Already committed rows and durable receipts are preserved.
  4. **No Destructive Rollback:** V2 compensating rollback sagas are explicitly out-of-scope; committed data remains intact.

