# ClearShift CRM — Entity-Relationship Diagram & Master-Data Ownership: CRM-5

**Module ID:** `CRM-5`
**Module Name:** Migration Control Center and Reports
**Owning Team:** Team `crm-reports` (Group 5 — Role 4 Data / QA Lead)
**Schema Version:** 1.0.0
**Storage Engine:** PostgreSQL 18.6 with Drizzle ORM
**Target Milestone:** Gate G1 — Design Complete (Weeks 1–2)
**Traceability:** ClearShift Project Plan v3.0 §§9.3–9.6, 17; SDS ClearShift CRM v2.0 §4.2, §4.7, §4.8, §4.11, §4.12; Master Architecture Baseline 1.0-A §4.2; Issue #197 `[CRM5-24]`.

---

## 1. Visual Entity-Relationship Diagram (Mermaid)

```mermaid
erDiagram
    CRM5_RUNS ||--o| CRM5_SCORES : "correlates (1..1) [batch_id]"
    CRM5_RUNS ||--o{ CRM5_REJECTS : "logs failures (1..N) [batch_id]"
    CRM5_RUNS ||--|| CRM5_RECONCILIATION_REPORTS : "reconciles (1..1) [batch_id / UNIQUE]"
    CRM5_IMPORT_RECEIPTS }o--|| CRM5_RUNS : "tracks durable commit [target_id]"
    CRM5_IMPORT_RECEIPTS }o--|| CRM5_SCORES : "tracks durable commit [target_id]"
    CRM5_IMPORT_RECEIPTS }o--|| CRM5_REJECTS : "tracks durable commit [target_id]"
    CRM5_IMPORT_RECEIPTS }o--|| CRM5_RECONCILIATION_REPORTS : "tracks durable commit [target_id]"

    CLEARSHIFT_MODULES ||--o{ CRM5_RUNS : "projects (0..N) [Domain Guard, NO FK]"
    CLEARSHIFT_MODULES ||--o{ CRM5_SCORES : "scores (0..N) [Domain Guard, NO FK]"
    CLEARSHIFT_MODULES ||--o{ CRM5_REJECTS : "audits (0..N) [Domain Guard, NO FK]"
    CLEARSHIFT_MODULES ||--o{ CRM5_RECONCILIATION_REPORTS : "balances (0..N) [Domain Guard, NO FK]"

    CRM5_RUNS {
        uuid id PK "gen_random_uuid()"
        varchar batch_id "NOT NULL, Indexed (length 128)"
        varchar module "NOT NULL, crm-1..5 (length 64)"
        varchar step "NOT NULL, extract|profile|clean|map|load|validate|reconcile"
        varchar status "NOT NULL, pending|running|completed|failed|halted"
        integer records_in "NOT NULL, >= 0"
        integer records_out "NOT NULL, >= 0"
        integer records_rejected "NOT NULL, >= 0"
        timestamptz started_at "NOT NULL, default now()"
        timestamptz completed_at "Nullable UTC timestamp"
        jsonb metadata "Nullable non-sensitive telemetry"
        timestamptz created_at "NOT NULL, default now()"
        timestamptz updated_at "NOT NULL, default now()"
    }

    CRM5_SCORES {
        uuid id PK "gen_random_uuid()"
        varchar batch_id "NOT NULL, Indexed (length 128)"
        varchar module "NOT NULL, Indexed (length 64)"
        numeric completeness "Nullable NUMERIC(5,4) [0.0000..1.0000]"
        numeric validity "Nullable NUMERIC(5,4) [0.0000..1.0000]"
        numeric duplicate_rate "Nullable NUMERIC(5,4) [0.0000..1.0000]"
        numeric reject_rate "Nullable NUMERIC(5,4) [0.0000..1.0000]"
        numeric link_integrity "Nullable NUMERIC(5,4) [0.0000..1.0000]"
        numeric score "Nullable NUMERIC(5,2) [0.00..100.00]"
        boolean is_fully_scored "NOT NULL, default false"
        timestamptz scored_at "NOT NULL, default now()"
        timestamptz created_at "NOT NULL, default now()"
    }

    CRM5_REJECTS {
        uuid id PK "gen_random_uuid()"
        varchar batch_id "NOT NULL, Indexed (length 128)"
        varchar module "NOT NULL, Indexed (length 64)"
        integer row_index "NOT NULL, >= 1 (1-indexed source row)"
        varchar error_code "NOT NULL (length 64)"
        text error_message "NOT NULL sanitized reason"
        varchar raw_payload_hash "NOT NULL SHA-256 (64 hex chars)"
        timestamptz created_at "NOT NULL, default now()"
    }

    CRM5_RECONCILIATION_REPORTS {
        uuid id PK "gen_random_uuid()"
        varchar batch_id UK "NOT NULL, UNIQUE INDEX (length 128)"
        varchar module "NOT NULL, Indexed (length 64)"
        integer source_count "NOT NULL, >= 0"
        integer loaded_count "NOT NULL, >= 0"
        integer rejected_count "NOT NULL, >= 0"
        integer merged_count "NOT NULL, >= 0"
        integer skipped_count "NOT NULL, >= 0 (0 in V1 baseline)"
        integer unaccounted_count "NOT NULL, >= 0 (0 for OK status)"
        varchar status "NOT NULL, 'OK' | 'UNBALANCED'"
        timestamptz reconciled_at "NOT NULL, default now()"
        timestamptz created_at "NOT NULL, default now()"
    }

    CRM5_IMPORT_RECEIPTS {
        uuid id PK "gen_random_uuid()"
        varchar batch_id "NOT NULL, Indexed (length 128)"
        integer source_row "NOT NULL, >= 1"
        varchar source_system "Nullable originating system (length 64)"
        varchar source_id "Nullable legacy key (length 128)"
        varchar entity "NOT NULL target entity name (length 64)"
        integer schema_version "NOT NULL, default 1"
        varchar idempotency_key UK "NOT NULL, UNIQUE INDEX (length 256)"
        varchar payload_hash "NOT NULL, SHA-256 (length 64)"
        uuid target_id "NOT NULL, Indexed (polymorphic PK)"
        varchar kind "NOT NULL, 'created' | 'updated'"
        varchar outcome "NOT NULL, 'created' | 'updated' | 'rejected' | 'skipped'"
        jsonb response_payload "Nullable serialized outcome"
        timestamptz created_at "NOT NULL, default now()"
    }
```

---

## 2. Cardinality & Relationship Catalog

| Relationship ID | Originating Entity | Target Entity | Foreign Key / Correlation | Cardinality | Deletion Policy | Enforcement Mechanism |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| `REL-CRM5-01` | `crm5_runs` | `crm5_scores` | `batch_id` | `1:1` | N/A | Logical Event Correlation |
| `REL-CRM5-02` | `crm5_runs` | `crm5_rejects` | `batch_id` | `1:N` | N/A | Logical Event Correlation |
| `REL-CRM5-03` | `crm5_runs` | `crm5_reconciliation_reports` | `batch_id` | `1:1` (Unique) | N/A | Logical Event Correlation & Unique Index |
| `REL-CRM5-04` | `crm5_import_receipts` | `crm5_runs` | `target_id -> crm5_runs.id` | `N:1` | N/A | Polymorphic Foreign Reference |
| `REL-CRM5-05` | `crm5_import_receipts` | `crm5_scores` | `target_id -> crm5_scores.id` | `N:1` | N/A | Polymorphic Foreign Reference |
| `REL-CRM5-06` | `crm5_runs` | `clearshift_modules` | `module` | `N:1` | RESTRICT | Domain Application Guard (Allowlist) |

---

## 3. Master-Data Ownership & Non-Negotiable Boundaries (PLT-03)

### 3.1 Strict Read-Only Projection Boundary
1. **Zero External SQL Mutations:** CRM-5 code never executes `INSERT`, `UPDATE`, or `DELETE` statements against tables owned by `crm-1`, `crm-2`, `crm-3`, `crm-4`, or platform schemas.
2. **Event-Driven Ingestion:** All cross-module data consumed by CRM-5 enters exclusively through approved outbox event streams (`RUN_PROJECTED`, `SCORE_COMPUTED`, `REJECT_RECORDED`, `RECONCILIATION_COMPLETED`) or in-process adapter calls.
3. **No Direct Table Joins:** Cross-module telemetry does not use SQL foreign keys or cross-schema joins. References to external entities degrade gracefully to display identifiers (e.g. `contact_id`, `deal_id`, `ticket_id`).

### 3.2 Caller Privilege & In-Process Target Adapter Boundary (Decision C4 & KIT-08)
1. **Zero Direct Caller Writes:** The Migration Kit never writes directly to CRM-5 private tables (`crm5_runs`, `crm5_scores`, `crm5_rejects`, `crm5_reconciliation_reports`, `crm5_import_receipts`).
2. **Atomic Single Transaction:** Ingested rows and durable receipts commit together in a single PostgreSQL transaction. A failure in either causes a complete rollback.
3. **Idempotency Deduplication:** The unique `idempotencyKey` (`batch ID + source row + target entity/schema version`) prevents duplicate writes during network retries or event redelivery.

---

## 4. Gate G1 Architecture Sign-off Block

* **Change Record ID:** `CR-CRM5-G1-002`
* **Milestone:** Gate G1 — Design Complete (Sprint 1)
* **Date Approved:** 2026-10-23
* **Approval Authority:** Group 5 Role 4 (Data / QA Lead) & Role 2 (Integration / Backend Engineer)
* **Status:** Verified, Signed Off, and Enforced in CI
