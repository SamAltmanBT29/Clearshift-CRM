# ClearShift CRM — Data Dictionary: CRM-5 Migration Control Center and Reports

**Module ID:** `CRM-5`
**Module Name:** Migration Control Center and Reports
**Owning Team:** Team `crm-reports` (Group 5 — Role 4 Data / QA Lead)
**Schema Version:** 1.0.0
**Storage Engine:** PostgreSQL 18.6 with Drizzle ORM
**Target Milestone:** Gate G1 — Design Complete (Weeks 1–2)
**Access Pattern:** Authenticated module API `/api/v1/crm-control` with EdDSA JWTs & RBAC; Migration Kit in-process Target Adapter for atomic batch writes. Strictly zero direct cross-module SQL mutations.
**Traceability:** ClearShift Project Plan v3.0 §§9.3–9.6, 17; SDS ClearShift CRM v2.0 §4.2, §4.7, §4.8, §4.11, §4.12; Master Architecture Baseline 1.0-A §4.2; Issue #197 `[CRM5-24]`.

---

## 1. Entity Relationship Overview & Master-Data Ownership

CRM-5 maintains 5 core tables in the PostgreSQL schema to record migration runs, compute quality scores, inspect failed rows, audit conservation balance sheets, and store durable import receipts:

```
┌─────────────────────────────────┐
│           crm5_runs             │
│ (Migration Run Projections)     │
└────────────────┬────────────────┘
                 │
       1:1 / 1:N │ (linked by batch_id)
                 ▼
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│          crm5_scores            │       │          crm5_rejects           │
│ (5-Dimension Quality Scores)    │       │ (Row-Level Rejection Audit)     │
└─────────────────────────────────┘       └─────────────────────────────────┘
                 │                                         │
                 └──────────────────┬──────────────────────┘
                                    ▼
                 ┌──────────────────────────────────────┐
                 │    crm5_reconciliation_reports       │
                 │   (Conservation Balance Sheet)       │
                 └──────────────────┬───────────────────┘
                                    │
                                    │ (target_id)
                                    ▼
                 ┌──────────────────────────────────────┐
                 │        crm5_import_receipts          │
                 │      (Atomic Durable Receipts)       │
                 └──────────────────────────────────────┘
```

* **Complete ERD & Master-Data Boundaries:** See [`erd.md`](./erd.md).
* **Requirement Traceability:** See [`traceability-matrix.md`](./traceability-matrix.md).
* **Dirty Data Pack Strategy:** See [`dirty-data-pack-plan.md`](./dirty-data-pack-plan.md).

---

## 2. Table Specifications (Field-Level Data Dictionary)

### 2.1 Table: `crm5_runs`
**Description:** Migration run execution step projections. Ingested from Migration Kit outbox events or in-process target adapter.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Business Rule | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID primary key. | `550e8400-e29b-41d4-a716-446655440001` |
| `batch_id` | `varchar(128)` | No | — | Indexed, Non-empty | Migration Kit batch correlation ID. | `batch-2026-10-crm1-001` |
| `module` | `varchar(64)` | No | — | Indexed, Allowlist | Target module (`crm-1`, `crm-2`, `crm-3`, `crm-4`, `crm-5`). | `crm-1` |
| `step` | `varchar(32)` | No | — | Allowlist check | Migration pipeline step (`extract`, `profile`, `clean`, `map`, `load`, `validate`, `reconcile`). | `load` |
| `status` | `varchar(32)` | No | `'pending'` | Enum check | Run execution status: `pending`, `running`, `completed`, `failed`, or `halted`. | `completed` |
| `records_in` | `integer` | No | `0` | Check `>= 0` | Total input record count presented to step. | `1000` |
| `records_out` | `integer` | No | `0` | Check `>= 0` | Successfully processed record count. | `780` |
| `records_rejected` | `integer` | No | `0` | Check `>= 0` | Validation rejected record count. | `140` |
| `started_at` | `timestamptz` | No | `now()` | UTC timestamp | Timestamp when step commenced execution. | `2026-10-23T08:00:00.000Z` |
| `completed_at` | `timestamptz` | Yes | `NULL` | UTC timestamp | Timestamp when step completed. Null while running. | `2026-10-23T08:05:30.000Z` |
| `metadata` | `jsonb` | Yes | `NULL` | JSON telemetry | Non-sensitive runtime telemetry (worker ID, chunk count). Zero PII. | `{"workerId": "worker-01"}` |
| `created_at` | `timestamptz` | No | `now()` | UTC timestamp | Record creation timestamp. | `2026-10-23T08:00:00.000Z` |
| `updated_at` | `timestamptz` | No | `now()` | UTC timestamp | Record modification timestamp. | `2026-10-23T08:05:30.000Z` |

**Indexes & Checks:**
* `idx_crm5_runs_batch_id` ON `crm5_runs(batch_id)`
* `idx_crm5_runs_module` ON `crm5_runs(module)`
* Check `chk_crm5_runs_records_in`: `records_in >= 0`
* Check `chk_crm5_runs_records_out`: `records_out >= 0`
* Check `chk_crm5_runs_records_rejected`: `records_rejected >= 0`
* Check `chk_crm5_runs_status`: `status IN ('pending', 'running', 'completed', 'failed', 'halted')`

---

### 2.2 Table: `crm5_scores`
**Description:** 5-dimension data quality score cards and weighted composite scores for migration batches.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Business Rule | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID primary key. | `550e8400-e29b-41d4-a716-446655440002` |
| `batch_id` | `varchar(128)` | No | — | Indexed, Non-empty | Associated migration batch identifier. | `batch-2026-10-crm1-001` |
| `module` | `varchar(64)` | No | — | Indexed, Allowlist | Target module scored. | `crm-1` |
| `completeness` | `numeric(5,4)` | Yes | `NULL` | Check `0.0000..1.0000` | Normalized fraction of non-empty mandatory attributes. | `0.9850` |
| `validity` | `numeric(5,4)` | Yes | `NULL` | Check `0.0000..1.0000` | Normalized fraction of syntax-valid records. | `0.9720` |
| `duplicate_rate` | `numeric(5,4)` | Yes | `NULL` | Check `0.0000..1.0000` | Fraction of detected duplicate candidate conflicts. | `0.0400` |
| `reject_rate` | `numeric(5,4)` | Yes | `NULL` | Check `0.0000..1.0000` | Fraction of rejected rows relative to source records. | `0.0500` |
| `link_integrity` | `numeric(5,4)` | Yes | `NULL` | Check `0.0000..1.0000` | Fraction of valid foreign keys and entity links. | `0.9900` |
| `score` | `numeric(5,2)` | Yes | `NULL` | Check `0.00..100.00` | Calculated overall 100-point composite score. | `97.14` |
| `is_fully_scored`| `boolean` | No | `false` | Boolean flag | True if and only if all 5 quality dimensions are present. | `true` |
| `scored_at` | `timestamptz` | No | `now()` | UTC timestamp | Scoring calculation timestamp. | `2026-10-23T08:05:30.000Z` |
| `created_at` | `timestamptz` | No | `now()` | UTC timestamp | Record creation timestamp. | `2026-10-23T08:05:30.000Z` |

**Composite Score Formula:**
$$\text{Score} = 100 \times \frac{\text{completeness} + \text{validity} + (1 - \text{duplicate\_rate}) + (1 - \text{reject\_rate}) + \text{link\_integrity}}{5}$$

**Indexes & Checks:**
* `idx_crm5_scores_batch_id` ON `crm5_scores(batch_id)`
* `idx_crm5_scores_module` ON `crm5_scores(module)`
* Check `chk_crm5_scores_completeness`: `completeness IS NULL OR (completeness >= 0 AND completeness <= 1)`
* Check `chk_crm5_scores_validity`: `validity IS NULL OR (validity >= 0 AND validity <= 1)`
* Check `chk_crm5_scores_duplicate_rate`: `duplicate_rate IS NULL OR (duplicate_rate >= 0 AND duplicate_rate <= 1)`
* Check `chk_crm5_scores_reject_rate`: `reject_rate IS NULL OR (reject_rate >= 0 AND reject_rate <= 1)`
* Check `chk_crm5_scores_link_integrity`: `link_integrity IS NULL OR (link_integrity >= 0 AND link_integrity <= 1)`
* Check `chk_crm5_scores_score`: `score IS NULL OR (score >= 0 AND score <= 100)`

---

### 2.3 Table: `crm5_rejects`
**Description:** Audits failed rows for review and correction. Contains sanitized error reasons and cryptographic SHA-256 hash of source payload to prevent leaking personal information.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Business Rule | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID primary key. | `550e8400-e29b-41d4-a716-446655440003` |
| `batch_id` | `varchar(128)` | No | — | Indexed, Non-empty | Associated migration batch identifier. | `batch-2026-10-crm1-001` |
| `module` | `varchar(64)` | No | — | Indexed, Allowlist | Target module where rejection occurred. | `crm-1` |
| `row_index` | `integer` | No | — | Check `>= 1` | 1-indexed source row number in parsed input file. | `42` |
| `error_code` | `varchar(64)` | No | — | Non-empty | Machine-readable error code (e.g. `INVALID_EMAIL`). | `INVALID_EMAIL` |
| `error_message` | `text` | No | — | Sanitized text | Human-readable explanation. No raw secrets or PII. | `Email violates RFC-5322 syntax` |
| `raw_payload_hash`| `varchar(64)`| No | — | SHA-256 (64 hex) | Cryptographic SHA-256 hash of canonical input row. | `e3b0c44298fc1c149afbf4c8996...` |
| `created_at` | `timestamptz` | No | `now()` | UTC timestamp | Record creation timestamp. | `2026-10-23T08:02:15.000Z` |

**Indexes & Checks:**
* `idx_crm5_rejects_batch_id` ON `crm5_rejects(batch_id)`
* `idx_crm5_rejects_module` ON `crm5_rejects(module)`
* Check `chk_crm5_rejects_row_index`: `row_index >= 1`

---

### 2.4 Table: `crm5_reconciliation_reports`
**Description:** Conservation balance sheet auditing that zero records are unaccounted for across the entire migration pipeline.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Business Rule | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID primary key. | `550e8400-e29b-41d4-a716-446655440004` |
| `batch_id` | `varchar(128)` | No | — | Unique Index | Batch correlation identifier. Exactly one report per batch. | `batch-2026-10-crm1-001` |
| `module` | `varchar(64)` | No | — | Indexed, Allowlist | Target module reconciled. | `crm-1` |
| `source_count` | `integer` | No | `0` | Check `>= 0` | Total records in original parsed source. | `1000` |
| `loaded_count` | `integer` | No | `0` | Check `>= 0` | Records committed to target database. | `780` |
| `rejected_count`| `integer` | No | `0` | Check `>= 0` | Records rejected during validation. | `140` |
| `merged_count` | `integer` | No | `0` | Check `>= 0` | Duplicate records merged via human review. | `80` |
| `skipped_count` | `integer` | No | `0` | Check `>= 0` | Records skipped with approved business reason. | `0` |
| `unaccounted_count`| `integer` | No | `0` | Check `>= 0` | Discrepancy count. Must be 0 for `OK` status. | `0` |
| `status` | `varchar(16)` | No | — | Check `'OK' \| 'UNBALANCED'` | Balance status. `OK` iff `unaccounted_count == 0`. | `OK` |
| `reconciled_at` | `timestamptz` | No | `now()` | UTC timestamp | Reconciliation calculation timestamp. | `2026-10-23T08:06:00.000Z` |
| `created_at` | `timestamptz` | No | `now()` | UTC timestamp | Record creation timestamp. | `2026-10-23T08:06:00.000Z` |

**Conservation Invariant:**
$$\text{source\_count} = \text{loaded\_count} + \text{rejected\_count} + \text{merged\_count} + \text{skipped\_count} + \text{unaccounted\_count}$$

**Indexes & Checks:**
* `idx_crm5_recon_batch_unique` ON `crm5_reconciliation_reports(batch_id)` (UNIQUE)
* `idx_crm5_recon_module` ON `crm5_reconciliation_reports(module)`
* Check `chk_crm5_recon_source_count`: `source_count >= 0`
* Check `chk_crm5_recon_loaded_count`: `loaded_count >= 0`
* Check `chk_crm5_recon_rejected_count`: `rejected_count >= 0`
* Check `chk_crm5_recon_merged_count`: `merged_count >= 0`
* Check `chk_crm5_recon_skipped_count`: `skipped_count >= 0`
* Check `chk_crm5_recon_unaccounted_count`: `unaccounted_count >= 0`
* Check `chk_crm5_recon_status`: `status IN ('OK', 'UNBALANCED')`

---

### 2.5 Table: `crm5_import_receipts`
**Description:** Stores durable import receipts committed alongside target records in the same atomic local database transaction (KIT-08 & Decision C4).

| Column | PostgreSQL Type | Nullable | Default | Constraints | Business Rule | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID primary key. | `550e8400-e29b-41d4-a716-446655440005` |
| `batch_id` | `varchar(128)` | No | — | Indexed, Non-empty | Associated batch correlation ID. | `batch-2026-10-crm1-001` |
| `source_row` | `integer` | No | — | Check `>= 1` | 1-indexed source row number in parsed batch. | `1` |
| `source_system` | `varchar(64)` | Yes | `NULL` | Optional system ID | Originating source system identifier. | `salesforce_legacy` |
| `source_id` | `varchar(128)` | Yes | `NULL` | Optional external key | Originating record key in source system. | `SF-RUN-001` |
| `entity` | `varchar(64)` | No | — | Target entity name | Target entity mutated by write (`runs`, `scores`). | `runs` |
| `schema_version` | `integer` | No | `1` | Schema version | Schema version at time of ingestion. | `1` |
| `idempotency_key` | `varchar(256)` | No | — | Unique Index | Stable idempotency key reused across retries. | `batch-2026-10-crm1-001:1:runs:v1` |
| `payload_hash` | `varchar(64)` | No | — | SHA-256 (64 hex) | Deterministic SHA-256 canonical hash of row payload. | `e3b0c44298fc1c149afbf4c8996...` |
| `target_id` | `uuid` | No | — | Indexed, Polymorphic | UUID primary key of mutated domain record. | `550e8400-e29b-41d4-a716-446655440001` |
| `kind` | `varchar(32)` | No | `'created'` | Mutation kind | Record mutation kind: `created` or `updated`. | `created` |
| `outcome` | `varchar(32)` | No | `'created'` | Outcome allowlist | Terminal outcome: `created`, `updated`, `rejected`, `skipped`. | `created` |
| `response_payload`| `jsonb` | Yes | `NULL` | JSON result payload | Cached execution result for identical replays. | `{"id": "550e8400...", "status": "created"}` |
| `created_at` | `timestamptz` | No | `now()` | UTC timestamp | Atomic commit timestamp. | `2026-10-23T08:00:00.000Z` |

**Indexes & Checks:**
* `idx_crm5_receipts_idempotency_key` ON `crm5_import_receipts(idempotency_key)` (UNIQUE)
* `idx_crm5_receipts_batch_row` ON `crm5_import_receipts(batch_id, source_row)`
* `idx_crm5_receipts_target_id` ON `crm5_import_receipts(target_id)`
* Check `chk_crm5_receipts_source_row`: `source_row >= 1`

---

## 3. Public API Endpoints (`/api/v1/crm-control`)

| Method | Endpoint | Allowed Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | *(Public probe)* | Service health and version check. |
| `GET` | `/runs` | `viewer`, `analyst`, `admin` | Paginated migration run projections (bounded page size $\le 100$). |
| `GET` | `/scores` | `analyst`, `admin` | 5-dimension quality score cards and average quality score. |
| `GET` | `/rejects` | `analyst`, `admin` | Paginated row-level failure audits with privacy-safe payload hashes. |
| `GET` | `/reconciliation/:batch` | `analyst`, `admin` | Conservation balance sheet for a batch ($\text{unaccounted} = 0$). |
| `GET` | `/batches/:batch` | `viewer`, `analyst`, `admin` | Aggregated batch summary telemetry. |
| `POST` | `/runs` | `migration_runner`, `admin` | Ingest migration step run projection. |
| `POST` | `/scores` | `migration_runner`, `admin` | Record computed quality scorecard. |
| `POST` | `/reconciliation` | `migration_runner`, `admin` | Commit reconciliation balance sheet. |
| `POST` | `/rejects` | `migration_runner`, `admin` | Ingest row rejection audit record. |
| `POST` | `/duplicates/detect` | `analyst`, `migration_runner`, `admin` | Detect exact normalized duplicate candidates. |
| `GET` | `/duplicates/held` | `analyst`, `admin` | List duplicate candidates held for human review. |
| `POST` | `/duplicates/resolve` | `editor`, `analyst`, `admin` | Record explicit operator merge/reject decision with audit log. |
| `GET` | `/duplicates/audit` | `analyst`, `admin` | Query append-only audit trail of duplicate resolutions. |
| `POST` | `/batches/execute-load`| `migration_runner`, `admin` | Execute chunked 500-row batch loading with 10% stop condition. |
| `POST` | `/import/row` | `migration_runner`, `admin` | Ingest single row via KIT-08 Target Adapter with atomic receipt. |
| `GET` | `/import/receipts` | `viewer`, `analyst`, `admin` | Query durable target import receipts. |

---

## 4. Gate G1 Sign-off & Authority Block

* **Change Record ID:** `CR-CRM5-G1-003`
* **Milestone:** Gate G1 — Design Complete (Sprint 1)
* **Date Approved:** 2026-10-23
* **Approval Authority:** Group 5 Role 4 (Data / QA Lead) & Role 2 (Integration / Backend Engineer)
* **Status:** Verified and Formally Signed Off
