# ClearShift Migration Kit V1 Operational Runbook

**Document ID:** RUNBOOK-KIT-01  
**Issue Reference:** [KIT-01] Batch registry, state machine and immutable step ledger (#68)  
**Target Milestone:** Gate G4 (V1 Build Complete)  
**Author / Workstream:** Team 11 — Platform & Migration Kit Lead  
**Classification:** Operational Architecture & Failure-Safety Runbook  
**Status:** Approved & Enforced  

---

## 1. Executive Summary & Core Requirements

The seven-step pipeline is ClearShift’s core migration engine. A simple CRUD approach does not satisfy V1; the Kit must ingest, transform, load, validate, and reconcile repeatable datasets while guaranteeing strict auditability and mathematical row reconciliation.

This runbook documents:
1. The **Batch Registry (`kit_batches`)** tracking lifecycle state, attempts, checkpoints, telemetry, and correlation IDs.
2. The **State Machine & Transition Guard** enforced at both application and database engine levels.
3. The **Immutable Step Ledger (`kit_batch_steps`)** providing an append-only audit trail with zero in-place mutations.
4. The **Checkpoint Resumption Protocol** guaranteeing that retries resume safely from committed checkpoints and never restart implicitly from `created`.
5. The **Reconciliation Equation** ensuring `source = loaded + rejected + merged + skipped` with `unaccounted = 0`.

---

## 2. Seven-Step Migration Pipeline & State Graph

### 2.1 The Seven Steps
1. **Extract:** Parses CSV/XLSX source file into raw rows; verifies SHA-256 checksum and row count.
2. **Profile:** Computes empty, invalid, and duplicate frequency counts; generates column profiling report.
3. **Clean:** Executes approved cleaning rules (e.g. whitespace trim, casing normalization, phone/tax validation); logs dirty-to-clean diffs.
4. **Map:** Applies field and value mapping templates; verifies required target entity fields.
5. **Dry-Run:** Simulates data insertion with strict zero-target-mutation; computes predicted rejection rates.
6. **Load:** Executes chunked atomic database load (up to 500 rows per PostgreSQL transaction) with stable idempotency keys and import receipts.
7. **Validate & Reconcile:** Validates referential and business integrity post-load; verifies that every source row has exactly one terminal outcome.

### 2.2 Lifecycle State Transitions

```
[ created ]
     │
     ▼
[ extracting ] ──────► [ failed ]
     │                      ▲
     ▼                      │
[ extracted ]  ──────► [ failed ]
     │                      ▲
     ▼                      │
[ profiled ]   ──────► [ failed ]
     │                      ▲
     ▼                      │
[ cleaned ]    ──────► [ failed ]
     │                      ▲
     ▼                      │
[ mapped ]     ──────► [ failed ]
     │                      ▲
     ▼                      │
[ dry_run_passed ] ──► [ failed ]
     │                      ▲
     ▼                      │
 [ loading ]   ──────► [ failed ]
     │  ▲                   ▲
     │  └── [ load_failed_partial ] ──► [ rollback_pending ]
     │              │                          │
     │              ▼                          ▼
     │         [ failed ]             [ rollback_blocked ] / [ rolled_back ]
     ▼
  [ loaded ]   ──────► [ failed ]
     │                      ▲
     ▼                      │
[ validating ] ──────► [ failed ]
     │                      ▲
     ▼                      │
[ validated ]  ──────► [ failed ]
     │
     ▼
[ reconciled ] (TERMINAL SUCCESS)
```

### 2.3 State Classifications
- **Success Path (Forward-Only):**  
  `created` ➔ `extracting` ➔ `extracted` ➔ `profiled` ➔ `cleaned` ➔ `mapped` ➔ `dry_run_passed` ➔ `loading` ➔ `loaded` ➔ `validating` ➔ `validated` ➔ `reconciled`
- **Failure & Side States:**  
  `failed`, `load_failed_partial`, `rollback_pending`, `rollback_blocked`, `rolled_back`
- **Terminal States (Immutable):**  
  `reconciled` (complete success), `rolled_back` (complete reversal)
- **Resumable States:**  
  `failed`, `load_failed_partial`

---

## 3. Database Guards & Constraints

### 3.1 Transition Guard Trigger (`trg_guard_kit_batch_transition`)
PostgreSQL trigger `trg_guard_kit_batch_transition` executes BEFORE UPDATE OF `status` ON `public.kit_batches`:
- **Blocks Out-of-Order Jumps:** Attempting to skip pipeline steps (e.g., `created -> loading` or `extracted -> loaded`) raises an exception with SQLSTATE `22000`.
- **Prevents Implicit Restart:** Attempting to transition to `created` from any active or failed state raises an exception:
  ```
  Illegal state transition: batch <id> cannot restart from created implicitly; must resume from committed checkpoint
  ```
- **Blocks Terminal Reversion:** Batches in `reconciled` or `rolled_back` status reject all subsequent updates.
- **Enforces Reconciliation Invariant:** Transition to `reconciled` checks:
  $$\text{total\_rows} = \text{loaded\_rows} + \text{rejected\_rows} + \text{merged\_rows} + \text{skipped\_rows}$$
  and verifies $\text{unaccounted\_rows} = 0$.

### 3.2 Append-Only Step Ledger (`trg_guard_kit_batch_steps_immutable`)
PostgreSQL trigger `trg_guard_kit_batch_steps_immutable` executes BEFORE UPDATE OR DELETE ON `public.kit_batch_steps`:
- Strict append-only ledger; `UPDATE` and `DELETE` queries are aborted.
- Every state transition inserts a new sequential record with telemetry counts (`records_in`, `records_out`, `records_rejected`, `records_merged`, `records_skipped`), `duration_ms`, `correlation_id`, `actor`, and rule versions.

---

## 4. Checkpoint Resumption Protocol

ClearShift V1 strictly prohibits restarting failed batches from `created`. When a worker process fails or the error threshold is breached, the batch state transitions to `failed` or `load_failed_partial`.

### 4.1 Checkpoint-to-Resume Mapping Table

| Committed Checkpoint | Meaning | Valid Resume Target | Next Step Action |
|---|---|---|---|
| `created` | Upload registered, extraction pending | `extracting` | Run Step 1 (Extract) |
| `extracted` | Source rows extracted and verified | `profiled` | Run Step 2 (Profile) |
| `profiled` | Column statistics computed | `cleaned` | Run Step 3 (Clean) |
| `cleaned` | Cleaning rules applied | `mapped` | Run Step 4 (Map) |
| `mapped` | Entity mappings verified | `dry_run_passed`| Run Step 5 (Dry-Run) |
| `dry_run_passed` | Simulation complete without mutation | `loading` | Run Step 6 (Load) |
| `load_checkpoint` | Chunk load halted / partial writes committed | `loading` | Resume Step 6 from last idempotency key |
| `loaded` | Business entity rows & receipts committed | `validating` | Run Step 7 (Validate) |
| `validated` | Post-load integrity checks passed | `reconciled` | Finalize reconciliation |

### 4.2 Resumption Procedure
1. Inspect the batch failure reason, error code, and committed checkpoint:
   ```sql
   SELECT id, batch_number, status, checkpoint, attempt, error_code, error_message
   FROM public.kit_batches
   WHERE id = 'BATCH_UUID';
   ```
2. Trigger resumption via Migration Kit CLI or API:
   ```bash
   # CLI
   cs-kit batch resume --batch B-00042 --reason "transient_db_timeout_resolved"
   ```
   ```http
   POST /api/v1/migration-kit/batches/BATCH_UUID/resume
   Content-Type: application/json

   {
     "actor": "operator_sarah",
     "reason": "transient_db_timeout_resolved"
   }
   ```
3. The engine verifies `attempt < max_attempts` (default 3), advances the attempt counter, and resumes execution strictly from the committed checkpoint.

---

## 5. Failure-Safety & 10% Error Threshold Rule

1. **Stop Threshold:** If cumulative row rejections exceed **10%** of attempted rows in a batch of $\ge 50$ rows, workers must immediately halt ingestion.
2. **State Transition:** The batch status transitions to `load_failed_partial`, preserving all committed row receipts and ledger steps.
3. **Receipt Immutability:** Rows loaded before the halt threshold remain committed alongside their `crm5_import_receipts` or domain entity import receipts. Retrying the batch skips already-committed rows idempotently using the composite key:
   $$\text{batch\_id} + \text{source\_row} + \text{target\_entity} + \text{schema\_version}$$

---

## 6. Audit Trail Compliance & Observability

- **Platform Audit Trail:** Every batch creation and transition logs an immutable entry to `public.audit_logs` (PLT-10) with the caller's identity, role, action code (`kit.batch.created`, `kit.batch.transitioned`, `kit.batch.failed`), and redacted metadata.
- **End-to-End Correlation (PLT-11):** Every API request, background job, database row, and audit record propagates the `correlation_id` header across service boundaries.
- **Zero Raw Data Leakage:** Application logs never emit raw unmasked PII, source row payloads, or credentials.
