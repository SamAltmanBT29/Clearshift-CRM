# CRM-5 Migration Control Center and Reports: Security Architecture and Controls

## 1. Executive Summary

This specification defines the security architecture, authorization policies, sensitive data protection, and audit logging controls implemented in the **CRM-5 Migration Control Center and Reports** module for ClearShift CRM V1.

All mechanisms strictly satisfy the **ClearShift CRM System Design Specification (SDS) v2.0 §4.8 & §7.5**, **Project Plan v3.0**, and the governance constraints of Gate G4.

---

## 2. Authentication & JWT Validation

The CRM-5 module delegates identity issuance to ClearShift Hub Identity (`@cs/identity`) and enforces server-side verification using asymmetric key cryptography (EdDSA):

* **Algorithm**: EdDSA (Ed25519) asymmetric signatures.
* **Issuer (`iss`)**: Must equal `clearshift-hub`.
* **Audience (`aud`)**: Must equal `clearshift`.
* **Token Expiration (`exp`)**: Strict timestamp validation against system time.
* **Account Status**: Tokens for disabled accounts (`disabled: true` or `status: "disabled"`) are rejected immediately with HTTP `401 Unauthorized`.
* **Missing/Invalid Header**: Requests lacking an `Authorization: Bearer <token>` header or carrying malformed/tampered tokens fail closed with HTTP `401 Unauthorized`.

The Fastify authentication plugin (`crm5AuthPlugin`) registers pre-handler hooks across all `/api/v1/crm-control/*` routes, attaching validated `HubTokenClaims` to `request.user`.

---

## 3. Role-Based Access Control (RBAC)

CRM-5 implements exact route-level role enforcement according to the SDS ClearShift CRM v2.0 §4.8 Endpoint Matrix. The allowable roles are:
* `viewer`: Read-only access to standard CRM views, run projections, batch summaries, and import receipts.
* `editor`: Authorization to resolve duplicate review candidate queues.
* `analyst`: Dedicated analytical role with full read access to migration run projections, quality scores, rejects, reconciliation balance sheets, duplicate review queues, and audit logs.
* `admin`: Complete administrative privileges across all CRM-5 endpoints.
* `migration_runner`: Dedicated execution role authorized to ingest run projections, quality scores, reconciliation reports, row rejections, execute chunked loads, and ingest migration rows via the target adapter.

### Endpoint Role Matrix

| Endpoint Route | HTTP Method | Allowed Roles | Prohibited Roles (HTTP 403) |
|---|---|---|---|
| `/api/v1/crm-control/health` | `GET` | *(Public probe)* | None |
| `/api/v1/crm-control/runs` | `GET` | `viewer`, `analyst`, `admin` | `editor`, `migration_runner` |
| `/api/v1/crm-control/scores` | `GET` | `analyst`, `admin` | `viewer`, `editor`, `migration_runner` |
| `/api/v1/crm-control/rejects` | `GET` | `analyst`, `admin` | `viewer`, `editor`, `migration_runner` |
| `/api/v1/crm-control/reconciliation/:batch` | `GET` | `analyst`, `admin` | `viewer`, `editor`, `migration_runner` |
| `/api/v1/crm-control/batches/:batch` | `GET` | `viewer`, `analyst`, `admin` | `editor`, `migration_runner` |
| `/api/v1/crm-control/runs` | `POST` | `migration_runner`, `admin` | `viewer`, `editor`, `analyst` |
| `/api/v1/crm-control/scores` | `POST` | `migration_runner`, `admin` | `viewer`, `editor`, `analyst` |
| `/api/v1/crm-control/reconciliation` | `POST` | `migration_runner`, `admin` | `viewer`, `editor`, `analyst` |
| `/api/v1/crm-control/rejects` | `POST` | `migration_runner`, `admin` | `viewer`, `editor`, `analyst` |
| `/api/v1/crm-control/duplicates/detect` | `POST` | `analyst`, `migration_runner`, `admin` | `viewer`, `editor` |
| `/api/v1/crm-control/duplicates/held` | `GET` | `analyst`, `admin` | `viewer`, `editor`, `migration_runner` |
| `/api/v1/crm-control/duplicates/resolve` | `POST` | `editor`, `analyst`, `admin` | `viewer`, `migration_runner` |
| `/api/v1/crm-control/duplicates/audit` | `GET` | `analyst`, `admin` | `viewer`, `editor`, `migration_runner` |
| `/api/v1/crm-control/batches/execute-load` | `POST` | `migration_runner`, `admin` | `viewer`, `editor`, `analyst` |
| `/api/v1/crm-control/import/row` | `POST` | `migration_runner`, `admin` | `viewer`, `editor`, `analyst` |
| `/api/v1/crm-control/import` | `POST` | `migration_runner`, `admin` | `viewer`, `editor`, `analyst` |
| `/api/v1/crm-control/import/receipts` | `GET` | `viewer`, `analyst`, `admin` | `editor`, `migration_runner` |

---

## 4. Sensitive Field Protection & Masking

Field-level protection is enforced on the server **prior to serialization and export**, ensuring sensitive attributes cannot leak even if the user bypasses UI presentation layers:

1. **Bank Details**:
   * Masked format: `XXXX-XXXX-7890` (preserving only the terminal 4 digits).
   * Short values (fewer than 4 digits) mask completely as `XXXX-XXXX-XXXX`.
2. **Salary Information**:
   * Formatted numeric values are masked as `XX,XXX`.
   * Unformatted or missing values are converted to `"salary hidden"`.
3. **Credentials & Tokens**:
   * Auth tokens, passwords, bearer headers, and client secrets are stripped or replaced with `[REDACTED]` prior to logging.
4. **CSV Export Injection Defense**:
   * Cell values beginning with formula prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) are automatically escaped with a leading single quote (`'`) to prevent spreadsheet remote code execution / DDE formula injection.
5. **Log Redaction**:
   * `maskSensitiveLog()` inspects log strings and object keys to prevent accidental leakage of PII, account numbers, or authorization headers into stdout or error collectors.

---

## 5. Audit Logging Architecture

The CRM-5 module maintains an append-only audit trail via `Crm5AuditService`:

* **Recorded Events**:
  * Run projection ingestion (`crm5.run.recorded`).
  * Quality score calculation ingestion (`crm5.score.recorded`).
  * Reconciliation balance sheet persistence (`crm5.reconciliation.recorded`).
  * Row rejection auditing (`crm5.reject.recorded`).
  * Human merge decisions (`crm5.duplicate.resolved`).
  * Chunked batch load execution (`crm5.batch.load_executed`).
* **Event Structure**:
  * `actor`: Authenticated User ID (`sub`) or explicit actorId.
  * `action`: Action taxonomy verb.
  * `timestamp`: ISO-8601 UTC timestamp.
  * `entity`: Target entity (`run_projection`, `quality_score`, `reconciliation_report`, `reject_projection`, `duplicate_candidate`, `batch_load`).
  * `entityId`: Primary UUID of the affected entity.
  * `batchId`: Correlated Migration Batch ID.
  * `result`: Status outcome (`success`, `failure`, `rejected`, `halted`).
  * `diffRedacted`: Contextual details with sensitive fields pre-redacted.
  * `metadata`: Operational telemetry with credentials stripped.
* **Safe Logging Invariant**:
  * Raw import rows, passwords, bearer tokens, full bank accounts, and raw personal identifiers are never written to audit records or system logs.

---

## 6. Web Client Route Guarding

Client-side route guards in `apps/crm/modules/crm-5/web/auth/route-guard.ts` enforce the SDS permissions prior to component mounting:

* **Unauthenticated User**: Automatically redirected to `/login?returnUrl=<target>`.
* **Expired Token**: Automatically redirected to `/login?returnUrl=<target>&reason=expired`.
* **Disabled User**: Denied access and redirected to `/login?returnUrl=<target>&reason=disabled`.
* **Insufficient Role / Capability**: Denied access and redirected to `/access-denied?required=<capability_or_roles>`.

Server-side route enforcement remains the authoritative boundary; client-side guards provide instant UX feedback.

---

## 7. Domain Invariants & Synthetic Data Constraints

1. **Cross-Module Isolation**: CRM-5 code never executes `INSERT`, `UPDATE`, or `DELETE` against tables owned by `crm-1`, `crm-2`, `crm-3`, `crm-4`, or platform schemas.
2. **Read-Only Reporting**: Dashboard projections read approved event/outcome projections and never mutate Kit batches directly.
3. **100% Synthetic Data**: All development, testing, and demonstration data consists solely of synthetic fixtures. No real personal, company, or customer data is ever permitted.
