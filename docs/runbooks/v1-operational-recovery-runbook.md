# ClearShift V1 Operational Recovery Runbook

**Document ID:** RUNBOOK-PMO-12  
**Issue Reference:** [PMO-12] V1 recovery runbook, demo rehearsal and incident roles (#215)  
**Target Milestone:** Gate G4 (V1 Build Complete)  
**Author / Workstream:** Workstream 12 — Project Management Office & DevOps Lead  
**Classification:** Operational Governance & Production Procedure  
**Status:** Approved & Enforced  

---

## 1. Executive Summary & Purpose

This operational runbook governs failure recovery, safe batch stoppage, node restart, and data reconciliation across all ClearShift V1 business modules (CRM-1 through CRM-5 and ERP-1 through ERP-5) and shared platform services.

The primary objective is to maintain strict data integrity, zero unaccounted rows, and guaranteed idempotency during hardware failures, database connection losses, worker crashes, or high error-rate incidents.

> [!IMPORTANT]
> **V1 Non-Negotiable Boundary:** ClearShift V1 **does not** include a compensating rollback saga, fuzzy duplicate matching, or automated target-side deletes. In the event of an operational failure, workers **stop safely**, preserve diagnostic evidence, and rely on **bounded retry** with deterministic idempotency keys (`batch ID + source row + target entity/schema version`).

---

## 2. Stop Conditions (Failure Triggers)

A migration run, batch ingestion process, or domain worker must automatically halt and transition to a quarantined state under any of the following conditions:

| Trigger Code | Condition | Detection Mechanism | Immediate Action |
|---|---|---|---|
| **STP-01** | **Error Threshold Exceeded** | Cumulative row failures > 10% of attempted rows in batch | Halt batch immediately; flag run as `HALTED_THRESHOLD_EXCEEDED` |
| **STP-02** | **Payload Limit Violation** | Source file > 50 MB or batch > 50,000 rows | Reject upload at boundary (HTTP 413 / error code `PAYLOAD_TOO_LARGE`) |
| **STP-03** | **Database Connection Drop** | PostgreSQL pool exhaustion or timeout > 5,000 ms | Pause worker consumption; retain batch in Redis stream; alert SEV-2 |
| **STP-04** | **Redis / Outbox Relay Loss** | Redis broker disconnect or stream write timeout | Stop transactional commits; fail open for read, stop ingestion |
| **STP-05** | **Worker Node Crash / OOM** | Container termination, unhandled SIGSEGV/SIGTERM | Orchestrator restarts node; job lock expires; reclaims via idempotency |
| **STP-06** | **Unaccounted Row Anomaly** | `source != loaded + rejected + merged + skipped` | Emergency freeze; quarantine batch; page Incident Commander (SEV-1) |
| **STP-07** | **General Ledger Imbalance** | ERP-4 debits != credits or posting to closed period | Reject journal transaction; abort batch; raise accounting alert |

---

## 3. Safe Batch Stoppage Procedure

When an automated stop condition fires or an operator issues a manual pause:

### Step 3.1: Halt Ingestion Stream
1. Set the module's migration state to `PAUSED` or `HALTED` via the Control Center API (`POST /api/v1/crm-control/runs/:id/pause`).
2. BullMQ / Redis Stream consumers immediately stop pulling new chunks from the queue.
3. Active worker chunk processing finishes the immediate 500-row unit atomically or rolls back to the chunk boundary.

### Step 3.2: Transactional Boundaries & State Commitment
- Every batch of up to 500 rows is processed inside a dedicated PostgreSQL transaction:
  ```sql
  BEGIN;
  -- 1. Insert target business entity rows (CRM/ERP)
  -- 2. Insert corresponding import receipt rows with idempotency key
  -- 3. Insert rejected rows into module import rejects table
  COMMIT;
  ```
- If an unhandled failure occurs mid-chunk, the PostgreSQL transaction rolls back completely for that chunk.
- No partial chunk writes are committed. Target table rows and import receipts commit atomically.

### Step 3.3: Preserve Diagnostic Evidence
- Never silently drop rows!
- All failed rows are recorded into the owning module's rejects table (e.g. `crm1_import_rejects`, `erp1_import_rejects`):
  - `batch_id`: UUID of the parent ingestion batch.
  - `row_number`: 1-based source row index in the CSV/XLSX file.
  - `source_id`: Source system entity ID (if parsed).
  - `error_code`: Standardized error identifier (`INVALID_DATA`, `CONSTRAINT_VIOLATION`, etc.).
  - `error_message`: Detailed validation description.
  - `raw_payload`: Exact source row representation for forensic review.
- Generate structured error log with correlation ID (`corr_id`).

---

## 4. Node Restart & Recovery Procedure

When a compute node or container crashes due to memory pressure, host eviction, or unhandled exceptions:

### Step 4.1: Clean Node Restart
1. Container restart initiated by systemd / Docker Compose / Kubernetes (`restart: on-failure`).
2. Verify process boots cleanly with Node.js 24 LTS runtime:
   ```bash
   node --version # Must match v24.x
   npm run typecheck
   ```
3. Establish database and Redis health before opening traffic:
   - Check `/health/live` returns HTTP 200 `{"status":"ok"}`.
   - Check `/health/ready` validates PostgreSQL and Redis pool connectivity.

### Step 4.2: Stale Job Lock Recovery
1. BullMQ locks have a default visibility timeout of 30,000 ms.
2. If a node dies while holding a lock on a batch chunk:
   - Lock automatically expires after timeout.
   - The scheduler re-queues the unacknowledged job to the stream.
   - A healthy worker picks up the chunk.

### Step 4.3: Deterministic Idempotency Enforcement
1. Every write operation generates a deterministic idempotency key:
   $$\text{IdempotencyKey} = \text{SHA256}(\text{batchId} + ":" + \text{sourceRowNumber} + ":" + \text{targetEntity} + ":" + \text{schemaVersion})$$
2. Prior to writing a target entity:
   - Worker queries `import_receipts` for the matching idempotency key.
   - If present: Worker skips duplicate insert and records status as `DUPLICATE_SKIPPED`.
   - If absent: Worker inserts target record and writes receipt atomically.
3. This guarantees that retrying an interrupted batch is 100% deterministic and safe.

---

## 5. Reconciliation Checks & Mathematical Invariants

After restarting or completing a quarantined run, operators must execute the ClearShift Reconciliation Verification:

### Step 5.1: The Master Invariant Formula
Every parsed source row must have exactly one terminal outcome:
`source = loaded + rejected + merged + skipped`
`unaccounted = 0`

$$\text{Source Rows} = \text{Loaded} + \text{Rejected} + \text{Merged} + \text{Skipped}$$
$$\text{Unaccounted Rows} = \text{Source Rows} - (\text{Loaded} + \text{Rejected} + \text{Merged} + \text{Skipped}) = 0$$

- **Loaded**: Successfully written to target business table with verified receipt.
- **Rejected**: Failed validation or domain rule; preserved in rejects table.
- **Merged**: Matched existing golden record with explicit human/audit sign-off.
- **Skipped**: Deliberately bypassed under an approved filter rule with recorded reason.

> [!CAUTION]
> If $\text{Unaccounted Rows} \ne 0$, the run is in an invalid state. **Do not sign off on Gate G4** until the reconciliation script identifies the delta.

### Step 5.2: Verification Command Execution
Run the automated reconciliation validation tool:
```bash
# Verify reconciliation balance sheet for a specific batch run
npm run migration:reconcile -- --runId <UUID>

# Verify full database target count matches receipt count
DATABASE_URL="postgresql://cs_app:app_secret_123@localhost:5432/clearshift" \
  npm run migration:verify-receipts
```

### Step 5.3: Dry Run vs. Real Load Verification
- **Dry Run**:
  - Validates syntax, schema, mappings, and duplicate detection.
  - Mutates **zero** target business records.
  - Writes **zero** permanent import receipts.
  - Emits full validation summary and estimated quality score.
- **Real Load**:
  - Executes chunked inserts within atomic PostgreSQL transactions.
  - Generates immutable receipts and audit log entries.

---

## 6. Operational Rollback Non-Claim (V1 Boundary)

To prevent operational misconfiguration and conflicting recovery strategies:

1. **No V2 Rollback Saga**: ClearShift V1 does not implement reverse-compensating distributed transactions (sagas). Operators must not attempt to trigger unapproved cascade deletion scripts.
2. **Forward Recovery Pattern**:
   - Quarantined batches remain isolated.
   - Faulty source files are corrected in the source repository or dirty-data pack.
   - Re-running the corrected batch uses deterministic idempotency keys to resume forward progress.
3. **Audit Trail Immutability**: No log entries, import receipts, or ledger rows may be updated or deleted in place. Corrections require appending new offset or correction records.
