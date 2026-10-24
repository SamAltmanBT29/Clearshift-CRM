# CRM-2 Deals, Pipeline and Quotes: Security Architecture and Controls

## 1. Executive Summary

This specification defines the security architecture, authorization policies, sensitive data protection, and audit logging controls implemented in the **CRM-2 Deals, Pipeline and Quotes** module for ClearShift CRM V1.

All mechanisms strictly satisfy the **ClearShift CRM System Design Specification (SDS) v2.0 §7.2**, **Project Plan v3.0**, and the non-negotiable requirements of Sprint 2 Gate G2 ([CRM2-15] / Issue #128) and Sprint 3 Gate G4 ([CRM2-09] / Issue #24).

---

## 2. Authentication & JWT Validation

The CRM-2 module delegates identity issuance to ClearShift Hub Identity (`@cs/identity`) and enforces server-side verification using asymmetric key cryptography (EdDSA):

* **Algorithm**: EdDSA (Ed25519) asymmetric signatures.
* **Issuer (`iss`)**: Must equal `clearshift-hub`.
* **Audience (`aud`)**: Must equal `clearshift`.
* **Token Expiration (`exp`)**: Strict timestamp validation against system time. Expired tokens are rejected with HTTP `401 Unauthorized`.
* **Account Status**: Tokens for disabled accounts (`disabled: true` or `status: "disabled"`) are rejected immediately with HTTP `401 Unauthorized`.
* **Missing/Invalid Header**: Requests lacking an `Authorization: Bearer <token>` header or carrying malformed/tampered tokens fail closed with HTTP `401 Unauthorized`.

The Fastify authentication plugin (`crm2AuthPlugin`) registers pre-handler hooks across all `/api/v1/crm-deals/*` routes, attaching validated `HubTokenClaims` to `request.user`.

---

## 3. Role-Based Access Control (RBAC) & Endpoint Matrix

CRM-2 implements exact route-level role enforcement according to the SDS Endpoint Matrix (§4 / §7.2). The allowable roles are:
* `viewer`: Read-only access to deals, stages, quotes, summaries, and import receipts.
* `editor`: Full create/edit privileges on deals and quotes, and duplicate candidate resolution.
* `analyst`: Read access to deals, stages, quotes, duplicate analysis, and audit trails.
* `admin`: Complete administrative privileges across all CRM-2 endpoints.
* `migration_runner`: Dedicated service/runner role authorized to perform bulk data ingestion (`POST /import`, `POST /batches/execute-load`) and entity upserts (`POST/PATCH` on deals and quotes).

### Endpoint Role Matrix

| Endpoint Route | HTTP Method | Allowed Roles | Prohibited Roles (HTTP 403) |
|---|---|---|---|
| `/api/v1/crm-deals/stages` | `GET` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` (direct query) |
| `/api/v1/crm-deals/deals` | `GET` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `/api/v1/crm-deals/deals/:id` | `GET` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `/api/v1/crm-deals/deals` | `POST` | `editor`, `migration_runner`, `admin` | `viewer`, `analyst` |
| `/api/v1/crm-deals/deals/:id` | `PATCH` | `editor`, `migration_runner`, `admin` | `viewer`, `analyst` |
| `/api/v1/crm-deals/quotes` | `GET` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `/api/v1/crm-deals/quotes/:id` | `GET` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `/api/v1/crm-deals/quotes` | `POST` | `editor`, `migration_runner`, `admin` | `viewer`, `analyst` |
| `/api/v1/crm-deals/quotes/:id` | `PATCH` | `editor`, `migration_runner`, `admin` | `viewer`, `analyst` |
| `/api/v1/crm-deals/import` | `POST` | `migration_runner`, `admin` | `viewer`, `editor`, `analyst` |
| `/api/v1/crm-deals/import/row` | `POST` | `migration_runner`, `admin` | `viewer`, `editor`, `analyst` |
| `/api/v1/crm-deals/import/batch` | `POST` | `migration_runner`, `admin` | `viewer`, `editor`, `analyst` |
| `/api/v1/crm-deals/batches/execute-load` | `POST` | `migration_runner`, `admin` | `viewer`, `editor`, `analyst` |
| `/api/v1/crm-deals/import/receipts` | `GET` | `viewer`, `analyst`, `admin` | `editor`, `migration_runner` |
| `/api/v1/crm-deals/batches/:batchId/report` | `GET` | `viewer`, `analyst`, `admin` | `editor`, `migration_runner` |
| `/api/v1/crm-deals/duplicates/detect` | `POST` | `analyst`, `migration_runner`, `admin` | `viewer`, `editor` |
| `/api/v1/crm-deals/duplicates/held` | `GET` | `viewer`, `analyst`, `editor`, `admin` | `migration_runner` |
| `/api/v1/crm-deals/duplicates/resolve` | `POST` | `editor`, `analyst`, `admin` | `viewer`, `migration_runner` |
| `/api/v1/crm-deals/duplicates/audit` | `GET` | `viewer`, `analyst`, `admin` | `editor`, `migration_runner` |
| `/api/v1/crm-deals/deals/evaluate-duplicate` | `POST` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `/api/v1/crm-deals/quotes/evaluate-duplicate` | `POST` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `/api/v1/crm-deals/deals/:id/summary` | `GET` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `/api/v1/crm-deals/pipeline/summary` | `GET` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |

---

## 4. Sensitive Field Protection & Masking

Field-level protection is enforced on the server **prior to serialization and export**, ensuring that sensitive attributes cannot leak even if the user attempts to bypass UI presentation layers.

1. **Bank Details**:
   * Masked format: `XXXX-XXXX-7890` (preserving only the terminal 4 digits).
   * Short values (fewer than 4 digits) mask completely as `XXXX-XXXX-XXXX`.
2. **Salary Information**:
   * Numeric compensation values are masked as `XX,XXX`.
   * Unformatted or redacted values are converted to `"salary hidden"`.
3. **Credentials & Tokens**:
   * Auth tokens, passwords, bearer headers, and client secrets are stripped or replaced with `[REDACTED]` prior to logging.
4. **CSV Export Formula Injection Defense**:
   * Cell values beginning with formula prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) are automatically escaped with a leading single quote (`'`) to prevent spreadsheet remote code execution / CSV formula injection.
5. **Log Redaction**:
   * `maskSensitiveLog()` inspects log strings and object keys to prevent accidental leakage of PII, account numbers, or authorization headers into stdout or error collectors.

---

## 5. Audit Logging Architecture

The CRM-2 module maintains an append-only audit trail via `Crm2AuditService`:

* **Recorded Events**:
  * Deal lifecycle events (`crm2.deal.created`, `crm2.deal.updated`).
  * Quote lifecycle events (`crm2.quote.created`, `crm2.quote.updated`).
  * Migration batch execution (`crm2.import.row_loaded`, `crm2.import.batch_loaded`, `crm2.batch.execute_load`).
  * Deduplication events (`DUPLICATES_DETECTED`, `DUPLICATE_MERGE`, `DUPLICATE_REJECT_DUPLICATE`, `DUPLICATE_KEEP_SEPARATE`).
* **Event Structure**:
  * `actor`: Authenticated User ID (`sub`) and role set.
  * `action`: Action verb matching standard taxonomy.
  * `timestamp`: ISO-8601 UTC timestamp.
  * `entity`: Entity type (`deal`, `quote`, `crm2_import`, `crm2_batch`, `crm2_duplicates`).
  * `entityId`: Primary UUID of the affected entity.
  * `batchId`: Migration Batch ID or correlation ID when applicable.
  * `result`: Status outcome (`success`, `failure`, `rejected`, `halted`).
  * `diffRedacted`: Redacted object diff.
  * `metadata`: Contextual details with sensitive fields pre-redacted.
* **Safe Logging Invariant**:
  * Raw import rows, passwords, bearer tokens, full bank accounts, and raw national identifiers are never written to audit records or system logs.

---

## 6. Web Client Route Guarding

Client-side route guards in `apps/crm/modules/crm-2/web/src/auth/route-guard.ts` enforce SDS permissions prior to component mounting:

* **Unauthenticated User**: Automatically redirected to `/login?returnUrl=<target>`.
* **Expired Token**: Automatically redirected to `/login?returnUrl=<target>&reason=expired`.
* **Disabled User**: Denied access and redirected to `/login?returnUrl=<target>&reason=disabled`.
* **Insufficient Role**: Denied access and redirected to `/access-denied?required=<roles>`.

Server-side route enforcement remains the authoritative boundary; client-side guards provide seamless UX feedback.

---

## 7. Multi-Tenant Boundary & Object-Level Guards

1. **Multi-Tenant Boundary Isolation (`assertTenantIsolation`)**:
   * Evaluates request tenant context against JWT claims (`tenant_id`, `tenantId`, `org_id`, `organizationId`).
   * Validates header tenant indicators (`x-tenant-id`, `x-organization-id`, `x-org-id`).
   * Rejects header-token mismatches and cross-tenant resource mutations with `HTTP 403 Forbidden`.
2. **Cross-User Record Ownership (`assertRecordOwnership`)**:
   * Restricts mutations on records with assigned owners/creators to the record owner (`employee_id` or `sub`).
   * Non-owner callers without administrator privileges are blocked with `HTTP 403 Forbidden`.
   * Administrator users (`admin` role) possess universal override for operational maintenance.

---

## 8. Domain Invariants Enforced

* **Stage Set Invariant**: The stage set is exactly: `New`, `Qualified`, `Proposal`, `Negotiation`, `Won`, `Lost`. Stage records are seeded and cannot be renamed or duplicated.
* **Financial Precision**: Deal value and quote amount are explicit decimals, and currency is explicit 3-letter ISO code.
* **Quote Number Uniqueness**: Quote numbers are strictly unique.
* **Orphan Deal Representation**: `contact_id` is nullable so orphan deals can be represented and visibly flagged; orphan deals are never silently hidden.
* **Forward Pipeline Lifecycle**: Forward transitions and immediate transitions to Lost are permitted; backwards transitions from terminal states (`Won`, `Lost`) are blocked.

---

## 9. Synthetic Data Constraint

In strict compliance with ClearShift Core Rules:
* All development, testing, and demonstration data consists solely of 100% synthetic fixtures.
* Real customer, employee, or corporate data is strictly prohibited.
* No credentials, `.env` files, or production secrets may ever be committed to the repository.
