# ADR-004: V1 Operational Recovery Boundary, Deterministic Idempotency, and Incident Command Model

## Status
Accepted

## Context
During high-volume synthetic batch migration runs across CRM and ERP modules, transient infrastructure issues (e.g., database connection pool exhaustion, Redis stream delay, or node restarts) and data validation anomalies (> 10% row failure threshold) may interrupt processing.

Without an unambiguous architecture decision, individual teams could attempt to implement conflicting recovery mechanisms:
1. Some modules might attempt to construct custom distributed rollback sagas or cascade deletions that risk data loss, phantom deletes, and non-deterministic states.
2. Other teams might use fuzzy matching or auto-merging that compromises the exact-match guarantee of V1.
3. Incident management during operational milestones (like Gate G4) would suffer from fragmented communication and unclear technical escalation pathways.

Traceability: ClearShift Project Plan v3.0 §§9.3, 11, 12, 17; SDS ClearShift Migration Kit v2.0 §4.2; V1 Standardization Plan Team 12 (PMO-12).

## Decision
1. **Stop-on-Failure Operational Model:**
   - Ingestion processes must automatically halt when cumulative row failures exceed 10% of attempted rows in an ingestion batch.
   - Processing halts safely: chunk transactions are rolled back or committed cleanly at chunk boundaries (500 rows per chunk). No rows are silently dropped.
   - Failed rows are quarantined in the owning module's rejects table with full diagnostic metadata (row number, error code, detailed message, raw payload).

2. **Explicit V1 Boundary (No Rollback Saga / No Fuzzy Auto-Merge):**
   - ClearShift V1 **strictly excludes** a compensating rollback saga. No distributed reverse-delete transactions are permitted or implemented in V1.
   - Recovery is forward-only: operators inspect quarantined rejects, rectify source data or configuration, and re-run ingestion.
   - Duplicate resolution in V1 is limited to deterministic normalized exact-key matching. Automated fuzzy deduplication is deferred to V2; any merge requires explicit human approval via the review UI.

3. **Deterministic Idempotency Key:**
   - Re-execution of batches must be safe and idempotent across retries.
   - The stable idempotency key is computed deterministically as:
     $$\text{IdempotencyKey} = \text{SHA256}(\text{batchId} + ":" + \text{sourceRowNumber} + ":" + \text{targetEntity} + ":" + \text{schemaVersion})$$
   - Target writes and import receipts commit atomically in a single PostgreSQL transaction. Retrying a chunk detects existing receipts and skips re-inserting duplicate records.

4. **Master Reconciliation Invariant:**
   - Every parsed source row must evaluate to exactly one terminal state:
     $$\text{Source Rows} = \text{Loaded} + \text{Rejected} + \text{Merged} + \text{Skipped}$$
     $$\text{Unaccounted Rows} = 0$$
   - Gate G4 sign-off requires mathematical proof that $\text{Unaccounted} = 0$.

5. **Incident Command Hierarchy:**
   - Establish formal incident roles (Incident Commander, Communications Lead, Module Tech Leads, Platform Lead, Integration Lead).
   - Enforce severity SLAs (SEV-1: 15-min response, 30-min updates; SEV-2: 30-min response, 60-min updates).
   - Require blameless post-mortem reviews for SEV-1 and SEV-2 incidents within 48 hours.

## Consequences
- Guarantees predictable, reproducible recovery across all 12 workstreams without complex distributed saga coordinators.
- Eliminates risk of partial, unverified, or accidental database deletions.
- Prepares teams for Gate G4 milestone review with standardized incident response and verified runbook procedures.
