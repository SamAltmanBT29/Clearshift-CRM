# ClearShift CRM — Data Dictionary: CRM-5 Migration Control Center and Reports

**Module ID:** `CRM-5`  
**Module Name:** Migration Control Center and Reports  
**Owning Team:** Team `crm-reports` (Group 5)  
**Schema Version:** 1.0.0  
**Storage Engine:** PostgreSQL 18.6 with Drizzle ORM  
**Target Milestone:** Gate G1 — Design Complete (Weeks 1–2)  
**Access Pattern:** Read-only event projections and quality audits; strictly zero direct cross-module writes.

---

## 1. Entity Relationship Overview

CRM-5 maintains 4 core tables to record migration runs, compute quality scores, inspect failed rows, and audit row-level reconciliation balance sheets:

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
                 └──────────────────────────────────────┘
```

---

## 2. Table Specifications

### 2.1 Table: `crm5_runs`
**Description:** Stores immutable migration batch execution events. Projected from Migration Kit outbox events. Deduplicated by `id` / `batch_id`.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Unique run projection identifier |
| `batch_id` | `VARCHAR(128)` | No | — | Indexed | Migration Kit batch correlation ID |
| `module` | `VARCHAR(64)` | No | — | Indexed | Target module (`crm-1`, `crm-2`, etc.) |
| `step` | `VARCHAR(32)` | No | — | Enum check | Migration step (`extract`, `profile`, `clean`, `map`, `load`, `validate`, `reconcile`) |
| `status` | `VARCHAR(32)` | No | `'pending'` | Enum check | Run status (`pending`, `running`, `completed`, `failed`, `halted`) |
| `records_in` | `INTEGER` | No | `0` | `>= 0` | Input record count to this step |
| `records_out` | `INTEGER` | No | `0` | `>= 0` | Successfully processed record count |
| `records_rejected` | `INTEGER` | No | `0` | `>= 0` | Rejected record count at this step |
| `started_at` | `TIMESTAMPTZ` | No | `now()` | — | Execution start timestamp |
| `completed_at` | `TIMESTAMPTZ` | Yes | `NULL` | — | Execution completion timestamp |
| `metadata` | `JSONB` | Yes | `NULL` | — | Non-sensitive runtime telemetry |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | — | Record creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | No | `now()` | — | Last update timestamp |

**Indexes:**
* `idx_crm5_runs_batch_id` ON `crm5_runs(batch_id)`
* `idx_crm5_runs_module` ON `crm5_runs(module)`

**Check Constraints:**
* `chk_crm5_runs_records_in`: `records_in >= 0`
* `chk_crm5_runs_records_out`: `records_out >= 0`
* `chk_crm5_runs_records_rejected`: `records_rejected >= 0`
* `chk_crm5_runs_status`: `status IN ('pending', 'running', 'completed', 'failed', 'halted')`

---

### 2.2 Table: `crm5_scores`
**Description:** Stores quality score cards for migration batches across 5 standard dimensions.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Unique quality score record ID |
| `batch_id` | `VARCHAR(128)` | No | — | Indexed | Associated batch identifier |
| `module` | `VARCHAR(64)` | No | — | Indexed | Target module |
| `completeness` | `NUMERIC(5, 4)` | Yes | `NULL` | `0.0000 .. 1.0000` | Normalized fraction of non-empty required fields |
| `validity` | `NUMERIC(5, 4)` | Yes | `NULL` | `0.0000 .. 1.0000` | Normalized fraction of syntax-valid records |
| `duplicate_rate` | `NUMERIC(5, 4)` | Yes | `NULL` | `0.0000 .. 1.0000` | Fraction of duplicate key conflicts detected |
| `reject_rate` | `NUMERIC(5, 4)` | Yes | `NULL` | `0.0000 .. 1.0000` | Fraction of rejected rows vs source |
| `link_integrity` | `NUMERIC(5, 4)` | Yes | `NULL` | `0.0000 .. 1.0000` | Foreign key & cross-entity reference validity fraction |
| `score` | `NUMERIC(5, 2)` | Yes | `NULL` | `0.00 .. 100.00` | Calculated overall score (null if any component unavailable) |
| `is_fully_scored`| `BOOLEAN` | No | `false` | — | True if all 5 components are present |
| `scored_at` | `TIMESTAMPTZ` | No | `now()` | — | Scoring calculation timestamp |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | — | Record creation timestamp |

**Formula:**
$$\text{Score} = 100 \times \frac{\text{completeness} + \text{validity} + (1 - \text{duplicate\_rate}) + (1 - \text{reject\_rate}) + \text{link\_integrity}}{5}$$

---

### 2.3 Table: `crm5_rejects`
**Description:** Audits failed rows for review and correction. Contains sanitized error reasons and cryptographic hash of source payload to prevent leaking personal information.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Unique rejection record ID |
| `batch_id` | `VARCHAR(128)` | No | — | Indexed | Associated batch identifier |
| `module` | `VARCHAR(64)` | No | — | Indexed | Target module |
| `row_index` | `INTEGER` | No | — | `>= 1` | 1-indexed row number in source dataset |
| `error_code` | `VARCHAR(64)` | No | — | — | Machine-readable error code (e.g. `INVALID_EMAIL`) |
| `error_message` | `TEXT` | No | — | — | Human-readable explanation |
| `raw_payload_hash` | `VARCHAR(64)` | No | — | 64 chars | SHA-256 hash of raw input row (privacy-safe) |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | — | Record creation timestamp |

---

### 2.4 Table: `crm5_reconciliation_reports`
**Description:** Audits the mathematical conservation of rows across the migration lifecycle.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Unique report identifier |
| `batch_id` | `VARCHAR(128)` | No | — | Unique Index | Batch identifier (1 report per batch) |
| `module` | `VARCHAR(64)` | No | — | Indexed | Target module |
| `source_count` | `INTEGER` | No | `0` | `>= 0` | Total records in original source |
| `loaded_count` | `INTEGER` | No | `0` | `>= 0` | Records committed to target database |
| `rejected_count`| `INTEGER` | No | `0` | `>= 0` | Records rejected by validation |
| `merged_count` | `INTEGER` | No | `0` | `>= 0` | Records merged into existing entities |
| `skipped_count` | `INTEGER` | No | `0` | `>= 0` | Records skipped by business rule |
| `unaccounted_count`| `INTEGER` | No | `0` | `>= 0` | Missing or unexplained records |
| `status` | `VARCHAR(16)` | No | — | `'OK' \| 'UNBALANCED'` | Balance status (`OK` only if `unaccounted = 0`) |
| `reconciled_at` | `TIMESTAMPTZ` | No | `now()` | — | Reconciliation timestamp |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | — | Record creation timestamp |

**Conservation Invariant:**
$$\text{source\_count} = \text{loaded\_count} + \text{rejected\_count} + \text{merged\_count} + \text{skipped\_count} + \text{unaccounted\_count}$$

---

## 3. Security, Privacy & Invariant Protections

1. **No Raw Secrets:** No passwords, bearer tokens, or full credit card / bank accounts are ever stored in CRM-5 tables.
2. **Formula Injection Defense:** All exported CSVs neutralize spreadsheet formula prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) by prepending a single quote (`'`).
3. **No Cross-Schema Mutation:** CRM-5 code never executes `INSERT`, `UPDATE`, or `DELETE` against tables owned by `crm-1`, `crm-2`, `crm-3`, `crm-4`, or platform schemas.

---

## 4. Public API Endpoint Directory (`/api/v1/crm-control`)

| Method | Endpoint | Query / Path Parameters | Bounded Paging | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/health` | None | N/A | Health check returning service status, module ID, and version |
| `GET` | `/runs` | `module`, `batchId`, `status`, `page`, `pageSize`, `limit` | Capped at 100 (rejects > 100 with 400) | Paginated migration run projections; sorted by `startedAt desc, id asc` |
| `GET` | `/scores` | `module`, `batchId`, `page`, `pageSize`, `limit` | Capped at 100 (rejects > 100 with 400) | Quality score cards and overall average score of fully scored batches |
| `GET` | `/rejects` | `module`, `batchId`, `page`, `pageSize`, `limit` | Capped at 100 (rejects > 100 with 400) | Row-level failed record audits; sorted by `rowIndex asc` |
| `GET` | `/reconciliation/:batch` | Path: `:batch` (batch identifier) | N/A | Exact row-count conservation balance sheet; returns 404 if not found |

