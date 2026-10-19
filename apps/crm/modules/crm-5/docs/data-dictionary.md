# CRM-5 Migration Control Center and Reports — Module Data Dictionary

This document provides the module-level data dictionary for **CRM-5**, detailing table structures, column definitions, constraints, indexes, and domain rules.

For the central repository reference, see:
[`docs/data-dictionaries/crm-5.md`](../../../docs/data-dictionaries/crm-5.md)

---

## Tables Summary

1. **`crm5_runs`**: Migration run execution projections.
   * Primary Key: `id` (UUID)
   * Correlation Key: `batch_id` (Indexed)
   * Enforced Invariants: Non-negative records (`records_in >= 0`, `records_out >= 0`, `records_rejected >= 0`), valid status.

2. **`crm5_scores`**: 5-dimension data quality score cards.
   * Dimensions: `completeness`, `validity`, `duplicate_rate`, `reject_rate`, `link_integrity` (each `0.0000..1.0000`).
   * Overall Score: `100 * (completeness + validity + (1 - duplicate_rate) + (1 - reject_rate) + link_integrity) / 5`.

3. **`crm5_rejects`**: Row-level failure inspection.
   * Identifies row index (`row_index >= 1`), error code, human-readable reason, and privacy-safe payload hash.

4. **`crm5_reconciliation_reports`**: Conservation balance sheet.
   * Invariant: `source = loaded + rejected + merged + skipped + unaccounted`.
   * Status is `OK` if and only if `unaccounted = 0`.

---

## Public API Endpoints (`/api/v1/crm-control`)

* `GET /health`: Health check and version verification.
* `GET /runs`: Paginated migration run projections (bounded page size <= 100, deterministic sort: `startedAt desc, id asc`).
* `GET /scores`: Quality score cards and system average score (bounded page size <= 100, deterministic sort: `scoredAt desc`).
* `GET /rejects`: Paginated row-level reject audits (bounded page size <= 100, deterministic sort: `rowIndex asc`).
* `GET /reconciliation/:batch`: Conservation balance sheet for a migration batch.

