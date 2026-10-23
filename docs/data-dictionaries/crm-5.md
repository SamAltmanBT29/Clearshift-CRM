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

### 2.5 Table: `crm5_import_receipts`
**Description:** Stores durable import receipts committed alongside target business records in the same atomic local database transaction (KIT-08 & Decision C4). Guarantees idempotency deduplication and audit traceability.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Unique import receipt identifier |
| `batch_id` | `VARCHAR(128)` | No | — | Indexed | Migration Kit batch correlation ID |
| `source_row` | `INTEGER` | No | — | `>= 1` | Source row index in batch |
| `source_system` | `VARCHAR(64)` | Yes | `NULL` | — | Originating source system |
| `source_id` | `VARCHAR(128)` | Yes | `NULL` | — | Source system entity record ID |
| `entity` | `VARCHAR(64)` | No | — | Indexed | Target entity (`runs`, `scores`, `rejects`, `reconciliation`) |
| `schema_version` | `INTEGER` | No | `1` | — | Schema version |
| `idempotency_key` | `VARCHAR(256)` | No | — | Unique Index | Stable idempotency key |
| `payload_hash` | `VARCHAR(64)` | No | — | Length 64 | Deterministic SHA-256 canonical hash of payload |
| `target_id` | `UUID` | No | — | Indexed | Primary key of mutated domain record |
| `kind` | `VARCHAR(32)` | No | `'created'` | — | Record mutation kind (`created`, `linked`) |
| `outcome` | `VARCHAR(32)` | No | `'created'` | — | Row outcome (`created`, `linked`, `rejected`, `skipped`) |
| `response_payload` | `JSONB` | Yes | `NULL` | — | Serialized outcome payload for replay |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | — | Receipt timestamp |

**Indexes:**
* `idx_crm5_receipts_idempotency_key` ON `crm5_import_receipts(idempotency_key)` (UNIQUE)
* `idx_crm5_receipts_batch_row` ON `crm5_import_receipts(batch_id, source_row)`
* `idx_crm5_receipts_target_id` ON `crm5_import_receipts(target_id)`

---

## 3. Security, Privacy & Invariant Protections (CRM5-15)

1. **JWT Authentication & Hub Identity:**
   * Server validates asymmetric EdDSA (Ed25519) signatures via ClearShift Hub Identity (`@cs/identity`).
   * Validates issuer (`clearshift-hub`), audience (`clearshift`), and token expiration.
   * Immediately rejects disabled accounts (`disabled: true` or `status: 'disabled'`) with HTTP 401 Unauthorized.
2. **Role Capability Enforcement:**
   * Exact endpoint role enforcement based on SDS ClearShift CRM v2.0 §4.8.
   * Unauthenticated requests return HTTP 401; authenticated requests with forbidden roles return HTTP 403.
3. **Field-Level Protection & Masking:**
   * Bank account and card values are masked to `XXXX-XXXX-7890` (preserving only the terminal 4 digits).
   * Salary and compensation figures are masked to `XX,XXX` or `'salary hidden'`.
   * Credentials, passwords, bearer tokens, and secrets are replaced with `[REDACTED]`.
   * Field restrictions are enforced on the server before serialization and export.
4. **Formula Injection Defense:** All exported CSVs neutralize spreadsheet formula prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) by prepending a single quote (`'`).
5. **Append-Only Audit Trail:**
   * `Crm5AuditService` logs immutable audit events for state changes, duplicate resolutions, and chunked load executions.
   * Audit diffs and metadata are pre-sanitized; raw rows and secrets are never logged.
6. **No Cross-Schema Mutation:** CRM-5 code never executes `INSERT`, `UPDATE`, or `DELETE` against tables owned by `crm-1`, `crm-2`, `crm-3`, `crm-4`, or platform schemas.
7. **No Direct Target Writes by Caller:** The Migration Kit never writes directly to CRM-5 private tables; data enters strictly through the public API / in-process `TargetAdapter`.

---

## 4. Public API Endpoint Directory (`/api/v1/crm-control`)

| Method | Endpoint | Allowed Roles | Query / Path Parameters | Bounded Paging | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/health` | *(Public probe)* | None | N/A | Health check returning service status, module ID, and version |
| `GET` | `/runs` | `viewer`, `analyst`, `admin` | `module`, `batchId`, `status`, `page`, `pageSize`, `limit` | Capped at 100 (rejects > 100 with 400) | Paginated migration run projections; sorted by `startedAt desc, id asc` |
| `GET` | `/scores` | `analyst`, `admin` | `module`, `batchId`, `page`, `pageSize`, `limit` | Capped at 100 (rejects > 100 with 400) | Quality score cards and overall average score of fully scored batches |
| `GET` | `/rejects` | `analyst`, `admin` | `module`, `batchId`, `page`, `pageSize`, `limit` | Capped at 100 (rejects > 100 with 400) | Row-level failed record audits; sorted by `rowIndex asc` |
| `GET` | `/reconciliation/:batch` | `analyst`, `admin` | Path: `:batch` (batch identifier) | N/A | Exact row-count conservation balance sheet; returns 404 if not found |
| `GET` | `/batches/:batch` | `viewer`, `analyst`, `admin` | Path: `:batch` | N/A | Aggregated batch summary and read-model consistency |
| `POST` | `/runs` | `migration_runner`, `admin` | Body: `CreateRunInput` | N/A | Records migration step projection; idempotent by `idempotencyKey` |
| `POST` | `/scores` | `migration_runner`, `admin` | Body: `CreateScoreInput` | N/A | Records quality score card; computes weighted score automatically |
| `POST` | `/reconciliation` | `migration_runner`, `admin` | Body: `CreateReconciliationInput` | N/A | Records conservation balance sheet; evaluates conservation invariant |
| `POST` | `/rejects` | `migration_runner`, `admin` | Body: `CreateRejectInput` | N/A | Ingests row rejection audit record with payload SHA-256 hash |
| `POST` | `/duplicates/detect` | `analyst`, `migration_runner`, `admin` | Body: `DetectDuplicatesInput` | N/A | Detects exact duplicates using normalized keys; holds candidates for review |
| `GET` | `/duplicates/held` | `analyst`, `admin` | `batchId`, `keyType` | N/A | Lists duplicate candidates currently held for authorized human review |
| `POST` | `/duplicates/resolve` | `editor`, `analyst`, `admin` | Body: `ResolveDuplicateInput` | N/A | Records authorized human merge decision and generates immutable audit log |
| `GET` | `/duplicates/audit` | `analyst`, `admin` | `candidateId`, `actorId`, `page`, `pageSize` | Capped at 100 | Paginated query of human duplicate resolution audit records |
| `POST` | `/batches/execute-load` | `migration_runner`, `admin` | Body: `ExecuteBatchLoadInput` | N/A | Executes chunked 500-row batch loading with bounded exponential backoff retries and 10% stop threshold |
| `POST` | `/import/row` | `migration_runner`, `admin` | Headers: `Idempotency-Key`, `X-Correlation-ID`; Body: `ImportRowInput` | N/A | Safely loads mapped row via KIT-08 Target Adapter; commits mutation and receipt in one transaction |
| `POST` | `/import` | `migration_runner`, `admin` | Headers: `Idempotency-Key`, `X-Correlation-ID`; Body: `ImportRowInput` | N/A | Alias for `/import/row` |
| `GET` | `/import/receipts` | `viewer`, `analyst`, `admin` | None | N/A | Returns durable receipts committed alongside migrated target records |

---

## 5. Exact Duplicate Key Policy & Human Review Policy (CRM5-12)

### 5.1 Deterministic Key Normalization Rules
To ensure consistent, deterministic duplicate detection across modules and ingest streams without fuzzy heuristics, exact keys are normalized according to strict rules:

| Key Type | Normalization Rule | Example Input | Normalized Output |
| :--- | :--- | :--- | :--- |
| `email` | Trim whitespace, convert to lowercase | `"  Lead.Ops@Example.COM  "` | `"lead.ops@example.com"` |
| `tax_id` | Trim whitespace, uppercase, remove hyphens/spaces/dots/slashes | `" 12-345.678/9 "` | `"123456789"` |
| `sku` | Trim whitespace, uppercase, collapse internal whitespace | `"  item-xyz  400 "` | `"ITEM-XYZ 400"` |
| `phone` | Trim whitespace, strip non-digits, preserve leading `+` | `" +1 (555) 019-2834 "` | `"+15550192834"` |
| `composite` | Deterministic sorted key-value serialization | `{ batchId: "b1", step: "load" }` | `"batchId=b1;step=load"` |

### 5.2 Deterministic Candidate Holding Policy
1. Records sharing an identical normalized key are grouped and flagged deterministically as `duplicate_candidate`.
2. **Zero Automatic Merging in V1:** Automatic fuzzy merging is strictly prohibited. Any request requesting automated merge throws an unprocessable error (`AUTO_MERGE_FORBIDDEN` / HTTP 422).
3. All ambiguous or duplicate candidates transition to `held_for_review` until an authorized human operator provides a merge or separation decision.

### 5.3 Human Merge Decision Audit Requirements
Every human review resolution creates an immutable audit log entry recording:
* `id`: UUID of the audit entry.
* `candidate_id`: ID of the resolved candidate group.
* `decision`: `MERGE` | `REJECT_DUPLICATE` | `KEEP_SEPARATE`.
* `actor_id`: Non-empty string identifier of the authorized human reviewer.
* `timestamp`: Precise UTC timestamp of the decision.
* `kept_id`: ID of the surviving/canonical record.
* `merged_id`: ID of the absorbed duplicate record (`kept_id !== merged_id` enforced for `MERGE`).
* `reason`: Mandatory audit justification for traceability.

---

## 6. Chunked Batch Ingestion & Partial-Load Stop Behavior (CRM5-13)

### 6.1 Chunked Processing (500 Rows)
All load operations slice large input datasets into sequential chunks of 500 records (`DEFAULT_CHUNK_SIZE = 500`). This bounds database transaction sizes, memory allocation, and lock retention times.

### 6.2 Idempotent Retry with Exponential Backoff
Transient worker or network failures trigger bounded exponential backoff retries:
$$\text{delay} = \text{baseBackoffMs} \times 2^{\text{attempt}}$$
* **Maximum Retries:** Default 3 attempts (`DEFAULT_MAX_RETRIES = 3`).
* **Idempotency Protection:** The unique `idempotencyKey` passed per source row is strictly preserved across all retry attempts and never mutated.

### 6.3 10% Partial-Load Stop Policy (`STOPPED_EXCESSIVE_FAILURES`)
To prevent cascading data corruption or runaway failure cascades:
$$\text{failureRate} = \frac{\text{cumulativeFailedRows}}{\text{cumulativeAttemptedRows}}$$
* When `cumulativeAttemptedRows >= 50` and `failureRate > 0.10` (10%):
  1. Batch execution ceases immediately.
  2. Batch status transitions to `STOPPED_EXCESSIVE_FAILURES` (recorded as `halted` in `crm5_runs`).
  3. **Durability Guarantee:** Already committed rows and durable receipts are preserved.
  4. **No Destructive Rollback:** V2 compensating rollback sagas are explicitly out-of-scope; committed data remains intact.

---

## 5. Exact Duplicate Key Policy & Human Review Policy (CRM5-12)

### 5.1 Deterministic Key Normalization Rules
To ensure consistent, deterministic duplicate detection across modules and ingest streams without fuzzy heuristics, exact keys are normalized according to strict rules:

| Key Type | Normalization Rule | Example Input | Normalized Output |
| :--- | :--- | :--- | :--- |
| `email` | Trim whitespace, convert to lowercase | `"  Lead.Ops@Example.COM  "` | `"lead.ops@example.com"` |
| `tax_id` | Trim whitespace, uppercase, remove hyphens/spaces/dots/slashes | `" 12-345.678/9 "` | `"123456789"` |
| `sku` | Trim whitespace, uppercase, collapse internal whitespace | `"  item-xyz  400 "` | `"ITEM-XYZ 400"` |
| `phone` | Trim whitespace, strip non-digits, preserve leading `+` | `" +1 (555) 019-2834 "` | `"+15550192834"` |
| `composite` | Deterministic sorted key-value serialization | `{ batchId: "b1", step: "load" }` | `"batchId=b1;step=load"` |

### 5.2 Deterministic Candidate Holding Policy
1. Records sharing an identical normalized key are grouped and flagged deterministically as `duplicate_candidate`.
2. **Zero Automatic Merging in V1:** Automatic fuzzy merging is strictly prohibited. Any request requesting automated merge throws an unprocessable error (`AUTO_MERGE_FORBIDDEN` / HTTP 422).
3. All ambiguous or duplicate candidates transition to `held_for_review` until an authorized human operator provides a merge or separation decision.

### 5.3 Human Merge Decision Audit Requirements
Every human review resolution creates an immutable audit log entry recording:
* `id`: UUID of the audit entry.
* `candidate_id`: ID of the resolved candidate group.
* `decision`: `MERGE` | `REJECT_DUPLICATE` | `KEEP_SEPARATE`.
* `actor_id`: Non-empty string identifier of the authorized human reviewer.
* `timestamp`: Precise UTC timestamp of the decision.
* `kept_id`: ID of the surviving/canonical record.
* `merged_id`: ID of the absorbed duplicate record (`kept_id !== merged_id` enforced for `MERGE`).
* `reason`: Mandatory audit justification for traceability.

---

## 7. Frontend Module Routes, Navigation & Layout Shell (CRM5-16)

### 7.1 Module Route Registration
CRM-5 registers 5 primary sub-views under the common ClearShift layout shell:

| Route Path | View Identifier | Display Title | Nav Label | Required Capability |
| :--- | :--- | :--- | :--- | :--- |
| `/crm-5/runs` | `crm5-runs` | Migration Run Projections | Runs | `control.read` |
| `/crm-5/scores` | `crm5-scores` | Data Quality Scores | Quality Scores | `control.read` |
| `/crm-5/rejects` | `crm5-rejects` | Row-Level Rejection Audit | Rejections | `control.read` |
| `/crm-5/reconciliation` | `crm5-reconciliation` | Conservation Balance Sheet | Reconciliation | `control.read` |
| `/crm-5/duplicates` | `crm5-duplicates` | Exact Duplicate Candidate Review | Duplicate Review | `control.read` |

### 7.2 Hub Authentication & Route Guards
* **Session Verification:** Route guards verify the user's active Hub session before allowing access to any module route.
* **Unauthenticated Access:** Unauthenticated requests or expired sessions are intercepted and redirected to `/login?returnUrl=<encoded_path>`.
* **RBAC Authorization:** All module routes require the `control.read` capability. Users lacking this capability are redirected to `/access-denied?required=control.read`.

### 7.3 Layout Shell & Accessibility Standards
* **ARIA Landmarks:** Employs `<header role="banner">`, `<nav aria-label="Breadcrumb">`, `<nav role="tablist">`, and `<main id="main-content" role="main">` with `<section role="tabpanel">`.
* **Skip Link:** Provides `<a href="#main-content" class="cs-skip-link">Skip to main content</a>` for keyboard accessibility.
* **Keyboard Navigation:** Tab controls support `ArrowLeft`, `ArrowRight`, `Home`, and `End` navigation for full keyboard-driven operation.
* **Title Synchronization:** Dynamically sets `document.title` to `ClearShift | CRM-5 - <View Title>`.

---

## 8. KIT-08 Target Adapter Contract & Durable Receipts ([CRM5-07] — Issue #52)

### 8.1 Target Adapter Port Adherence
CRM-5 implements the in-process `TargetAdapter` port specified in `@cs/kit` (`KIT-08` & `Decision C4`):
* **Caller Privilege Boundary:** Migration Kit and external clients possess zero direct SQL insert/update permissions on CRM-5 tables. All writes enter through the public API (`POST /api/v1/crm-control/import/row`) or in-process adapter method `importRow()`.
* **Atomic Transaction Guarantee:** The mutated business record (`crm5_runs`, `crm5_scores`, `crm5_rejects`, or `crm5_reconciliation_reports`) and the durable receipt (`crm5_import_receipts`) commit atomically in one local PostgreSQL transaction. If either operation fails, the transaction is completely rolled back.

### 8.2 Strict Idempotency & Conflict Semantics
* **Canonical Payload Hash:** Input payloads are deterministically serialized with sorted keys and hashed via SHA-256 (`payload_hash`).
* **Identical Replay (HTTP 200):** If an incoming row presents an existing `idempotencyKey` and matching `payload_hash`, the prior execution result is returned without mutating data or duplicating receipts.
* **Payload Conflict (HTTP 409):** If an incoming row reuses an existing `idempotencyKey` with an altered payload (`new_hash !== existing_hash`), the request is rejected with `IDEMPOTENCY_CONFLICT` (HTTP 409) and zero mutations occur.

### 8.3 Error Classification Invariants
* **Domain Validation Failures:** Business rule violations (e.g. `recordsOut + recordsRejected > recordsIn`, out-of-range quality dimensions, unparseable payloads) are classified as business rejections (`VALIDATION_ERROR` / HTTP 422) with machine-readable reason codes and safe error messages. Corrupt records are never committed.
* **Infrastructure Failures:** Transient network, database, or worker outages (e.g. HTTP 503) are marked `retryable: true` and are **never** recorded in `crm5_rejects` as invalid data.

---

## 9. Main Paginated Data Table with Server-Side Sorting & Filtering (CRM5-17)

### 9.1 Stable Column Configurations
The CRM-5 primary collection table renders structured data matching the entity dictionary schemas:

| Entity Collection | Primary Columns | Sortable Columns |
| :--- | :--- | :--- |
| `crm5_runs` | `batchId`, `module`, `step`, `status`, `recordsIn`, `recordsOut`, `recordsRejected`, `startedAt`, `completedAt` | `batchId`, `module`, `step`, `status`, `recordsIn`, `recordsOut`, `recordsRejected`, `startedAt` |
| `crm5_scores` | `batchId`, `module`, `score`, `completeness`, `validity`, `duplicateRate`, `rejectRate`, `linkIntegrity`, `isFullyScored`, `scoredAt` | `batchId`, `module`, `score`, `completeness`, `validity`, `duplicateRate`, `rejectRate`, `linkIntegrity`, `scoredAt` |
| `crm5_rejects` | `id`, `batchId`, `module`, `rowIndex`, `errorCode`, `errorMessage`, `rawPayloadHash`, `createdAt` | `batchId`, `module`, `rowIndex`, `errorCode`, `createdAt` |
| `crm5_reconciliation_reports` | `batchId`, `module`, `sourceCount`, `loadedCount`, `rejectedCount`, `mergedCount`, `skippedCount`, `unaccountedCount`, `status`, `reconciledAt` | `batchId`, `module`, `sourceCount`, `loadedCount`, `rejectedCount`, `mergedCount`, `skippedCount`, `unaccountedCount`, `status`, `reconciledAt` |

### 9.2 Bounded Server-Side Pagination
* **Page Size Ceilings:** Default page size is 20 rows (`DEFAULT_PAGE_SIZE = 20`), with a strict bounded ceiling of 100 rows (`MAX_PAGE_SIZE = 100`) to prevent DOM degradation and memory bloat.
* **Navigation Controls:** First (`« First`), Previous (`‹ Prev`), Next (`Next ›`), and Last (`Last »`) controls with automatic boundary disabling (`aria-disabled="true"`).
* **State Resets:** Adjusting `pageSize` or active sorting resets current page back to 1.

### 9.3 Column Header Sorting Protocol
* **Deterministic Toggle Cycle:** Clicking a sortable column header cycles through `asc` ↔ `desc`.
* **WAI-ARIA Accessibility:** Headers announce sort direction via `aria-sort="ascending" | "descending" | "none"` and keyboard-accessible buttons (`<button class="cs-th-sort-btn">`).
* **Query Serialization:** Binds to standard API parameters `sort=<columnKey>&order=asc|desc&page=<N>&pageSize=<N>&limit=<N>`.

---

## 10. Search, Faceted Filters, and Active Filter Tags (CRM5-18)

### 10.1 300ms Keystroke Debouncing Protocol
* **Debounce Delay Window:** Free-text searches enforce an exact 300ms debounce interval (`SEARCH_DEBOUNCE_MS = 300`) to prevent API thrashing and unbounded server queries during fast typing.
* **Immediate Flush:** Pressing the `Enter` key or triggering explicit submission flushes pending timers immediately without waiting for the 300ms timer to expire.
* **Instant Cancellation & Reset:** Clicking the clear icon (`×`) or pressing `Escape` clears search text, cancels pending timers, and triggers an immediate query update with an empty string.

### 10.2 Faceted Filter Registry & Query Parameter Mapping
CRM-5 primary views register structured facets mapped bi-directionally to API query parameters:

| Facet Dimension | Query Key | Target Values / Options | API Mapping |
| :--- | :--- | :--- | :--- |
| **Search Query** | `search` | String (case-insensitive substring) | Mapped to `batchId` substring filter for server compatibility |
| **Source Module** | `module` | `crm-1`, `crm-2`, `crm-3`, `crm-4`, `crm-5` | `module=<CrmModule>` |
| **Run Status** | `status` | `pending`, `running`, `completed`, `failed`, `halted` | `status=<MigrationRunStatus>` |
| **Migration Step**| `step` | `extract`, `profile`, `clean`, `map`, `load`, `validate`, `reconcile` | `step=<MigrationStep>` |

* **Pagination Reset Invariant:** Modifying any search query or faceted filter dimension immediately resets the active page to 1 (`page = 1`) to eliminate phantom pagination overflows.
* **Bi-directional URL Synchronization:** All active filters serialize to standard URL query parameters (`toQueryParams()` / `toQueryString()`) and hydrate deterministically from `URLSearchParams` (`fromQueryParams()`).

### 10.3 Active Filter Tag Lifecycle & 'Clear All' Action
* **Active Filter Pill Tags:** When search text or any facet filter is applied, an active filter tag (`.cs-filter-pill`) is displayed containing the facet label and formatted display value (e.g. `Module: CRM-1 (Contacts & Accounts)`).
* **Individual Tag Dismissal:** Each pill tag features an accessible dismiss button (`.cs-filter-pill-remove`) with `aria-label="Remove filter: <Label> <Value>"`. Clicking dismiss clears only that specific filter without disturbing other active filters.
* **Bulk 'Clear All' Reset:** When at least one filter or search is active, a 'Clear All' button (`.cs-clear-all-filters-btn`) is displayed. Activating it purges all filters and search state, resetting query parameters and table results in a single atomic transaction.

### 10.4 Empty Search/Filter State Contract & Reset Recovery
* **Dual Empty-State Contract:**
  1. **System Empty State:** Rendered when zero data exists in the table and no filters/search are applied (e.g. *"No migration run projections currently recorded."*).
  2. **Filtered Empty State (`.cs-empty-filter-state`):** Rendered when data exists in the system but the current search and filter combination returns zero records (e.g. *"No records matched your search and filter criteria. Try adjusting your search term or clearing filters."*).
* **Reset Recovery Button:** Filtered empty states prominently render a **"Reset All Filters"** action button (`.cs-empty-reset-btn`) that directly triggers `clearAll()`, providing immediate one-click recovery back to the unfiltered collection view.

## 11. Profiler (CRM5-26)

`apps/crm/modules/crm-5/src/kit/profiler.ts` — `profileCrm5Batch(rows)`; read-only, never mutates input.

| Output | Meaning |
|---|---|
| `columnStats[col]` | `totalValues`, `nullCount/Rate`, `distinctCount`, `invalidFormatCount/Rate` |
| `defectsByCategory` | 11 categories, 1-based `recordIndices`, asserted against `tests/fixtures/manifest.json` |
| `exactDuplicateCount` | repeated `id` or repeated `(batch_id, step)` |
| `qualityMetrics` | 5 fractions + `overallScore` via `calculateQualityScore`; `null` (N/A) if unavailable |

---

## 12. UI Loading, Empty, Error, and 403 Access-Denied States (CRM5-19)

### 12.1 Animated Table Skeleton Shimmer Loader (`TableSkeleton`)
* **Visual Shimmer Feedback:** Displays structured placeholder table rows matching the column structure of the target entity collection with smooth shimmer animations (`@keyframes cs-shimmer`).
* **WAI-ARIA Accessibility:** Conforms strictly to WAI-ARIA status semantics with `role="status"`, `aria-busy="true"`, and an informative screen-reader announcement (`.cs-sr-only`) declaring that table data is actively loading.
* **Bounded Layout Ceilings:** Supports configurable `rowCount` (default: 5) and `columnCount` (default: 6) with optional column width overrides to prevent layout shifts during initial data fetching.

### 12.2 Zero-Data Condition & Actionable Call-to-Action (`EmptyState`)
* **Informative Zero-Data State:** Rendered whenever an entity collection or query result contains zero records, providing clear visual iconography, a descriptive heading, and explanatory subtext.
* **Contextual Call-to-Action:** Features a primary CTA button (`.cs-empty-cta-btn`) allowing operators to immediately initiate data migration, upload synthetic files, or create batches.
* **Secondary Action Support:** Optionally renders a secondary link or action button (`.cs-empty-secondary-btn`) for documentation or navigation.
* **Filter Reset Integration:** When zero records result from restrictive filters, renders in filter-reset mode (`.cs-empty-filter-state`) with a dedicated "Reset All Filters" button (`.cs-clear-all-filters-btn`).

### 12.3 API Error Alert Banner & Stack Trace Sanitization (`ErrorAlert`)
* **Accessible Alert Banner:** Renders with `role="alert"` and `aria-live="assertive"`, ensuring screen readers immediately announce upstream service or network failures.
* **Security & Sanitization Invariant (`sanitizeErrorMessage`):** Client-side error messages strictly sanitize raw server responses, stripping Node.js / V8 stack traces (`at Function...`), internal filesystem paths (`/Users/`, `/home/`, `/var/`), and SQL syntax error strings to prevent leaking system topology or sensitive internals.
* **Message Length Ceiling:** Sanitized messages are capped at a maximum of 240 characters to protect page layout integrity.
* **Interactive Recovery Action:** Provides a keyboard-accessible **Retry** button (`.cs-error-retry-btn`) that allows operators to re-trigger the failed query without reloading the page.

### 12.4 403 Forbidden Access-Denied View (`AccessDeniedView`)
* **Authorization Failure Handling:** Rendered whenever an endpoint returns HTTP 403 Forbidden or the client-side route guard detects insufficient permissions.
* **Clear Role & Capability Transparency:** Distinctly displays a `403 Forbidden` status badge, details the required capability (e.g. `control:read`), specifies any required role, and announces the current user's role.
* **Safe Return Path:** Features an accessible return button (`.cs-access-back-btn`) directing users back to the Migration Control Center home view (`/crm-5`).

---

## 13. Entity Create Form with Field-Level Validation, Modal Workflow, and Server Error Mapping (CRM5-20)

### 13.1 Field-Level Validation Specification & Invariants (`CreateRunFormSchema`)
CRM-5 implements an entity creation form for migration run projections adhering to Zod client-side schemas and ClearShift domain validation contracts:

| Field | Input Type | Validation Rules & Constraints | Error Message |
| :--- | :--- | :--- | :--- |
| **`batchId`** | Text | Required; trimmed; 1 .. 128 characters | `batchId is required` / `batchId cannot exceed 128 characters` |
| **`module`** | Select | Required; enum: `crm-1`, `crm-2`, `crm-3`, `crm-4`, `crm-5` | `Module is required` |
| **`step`** | Select | Required; enum: `extract`, `profile`, `clean`, `map`, `load`, `validate`, `reconcile` | `Step is required` |
| **`status`** | Select | Required; enum: `pending`, `running`, `completed`, `failed`, `halted` | `Status is required` |
| **`recordsIn`** | Number | Required integer; non-negative (`>= 0`) | `Records In must be an integer` / `Records In cannot be negative` |
| **`recordsOut`** | Number | Required integer; non-negative (`>= 0`) | `Records Out must be an integer` / `Records Out cannot be negative` |
| **`recordsRejected`** | Number | Required integer; non-negative (`>= 0`) | `Records Rejected must be an integer` / `Records Rejected cannot be negative` |
| **`operatorEmail`** | Email | Optional; format verified against standard RFC-5322 regex | `Invalid email address format` |
| **`operatorPhone`** | Tel | Optional; format verified against phone regex (`+?[0-9\s\-().]{7,20}`) | `Invalid phone number format` |
| **`samplingRate`** | Number | Optional decimal; strictly bounded in range `[0.00 .. 1.00]` | `Value must be a decimal between 0.00 and 1.00` |

* **Conservation Invariant Assertion:** Enforces the fundamental domain rule that `recordsOut + recordsRejected <= recordsIn`. If violated, blocks submission and attaches an inline validation error to `recordsOut`: *"Invariant violation: sum of recordsOut and recordsRejected cannot exceed recordsIn"*.

### 13.2 Double-Submit Prevention & Inflight Request Lock
* **Inflight Submission Lock:** When submission begins, `isSubmitting` flag locks the form against concurrent submit triggers.
* **Button State Mutation:** The primary submit button (`.cs-form-submit-btn`) transitions to `disabled={true}`, renders `.cs-btn-disabled`, displays an inline animated spinner (`.cs-spinner-sm`), and mutates text to *"Recording Run..."*.

### 13.3 Direct HTTP 400 Server Validation Error Mapping
* **ClearShift Error Envelope Parsing:** Intercepts server responses conforming to standard envelope `{ error: { code, message, details: [{ path: ['field'], message: '...' }] } }`.
* **Field-Level Direct Feedback:** Server error messages map directly to the corresponding DOM inputs, setting `aria-invalid="true"`, pointing `aria-describedby` to the error element ID, highlighting input borders with `.cs-input-error`, and rendering an accessible error badge (`.cs-field-error`, `role="alert"`).
* **Validation Summary Banner (`FormValidationSummary`):** Renders a high-visibility summary alert (`role="alert"`, `aria-live="polite"`) at the top of the form listing all field-level failures.

### 13.4 Accessible Modal Dialog Workflow (`CreateRunModal`)
* **WAI-ARIA Dialog Semantics:** Implements modal overlay conforming to WAI-ARIA standards (`role="dialog"`, `aria-modal="true"`, `aria-labelledby="<uniqueId>"`).
* **Keyboard & Overlay Dismissal:** Pressing the `Escape` key, clicking the close button (`.cs-modal-close-btn`), or clicking the backdrop overlay (`.cs-modal-backdrop`) dismisses the modal safely.
* **Success Lifecycle:** Successful form submission automatically closes the modal dialog, updates the table cache in `DataTableController`, and dispatches the confirmation toast.

### 13.5 Table Cache Management (`DataTableController`)
* **Local Cache Methods:** Added explicit cache manipulation APIs to `DataTableController`:
  - `setCachedData(data: T[])`: Seeds table cache and sets total.
  - `getCachedData(): T[]`: Retrieves current cached records.
  - `addRecordToCache(record: T)`: Prepends newly created projection to cache and increments total count.
  - `updateRecordInCache(idOrKey, updates)`: Updates an existing projection in-place by `id` or `batchId`.
  - `removeRecordFromCache(idOrKey)`: Evicts projection from cache and decrements total count.
  - `clearCache()`: Resets cache and sets total count to 0.

### 13.6 Confirmation Toast Notification (`ConfirmationToast`)
* **WAI-ARIA Status Semantics:** Renders floating toast notification (`role="status"`, `aria-live="polite"`, `.cs-toast`, `.cs-toast-success`).
* **Auto-Dismiss & Manual Close:** Supports configurable auto-dismiss timer (default: 5000ms) with clean timer teardown and accessible manual dismissal button (`.cs-toast-close`, `aria-label="Dismiss notification"`).

