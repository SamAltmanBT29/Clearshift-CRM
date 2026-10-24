# CRM-3 Support Tickets and Activities: Security Architecture and Controls

## 1. Executive Summary

This specification defines the security architecture, authorization policies, sensitive data protection, and audit logging controls implemented in the **CRM-3 Support Tickets and Activities** module for ClearShift CRM V1.

All mechanisms strictly satisfy the **ClearShift CRM System Design Specification (SDS) v2.0 §7.1**, **Project Plan v3.0 §7.3**, and the constraints of Gate G4.

---

## 2. Authentication & JWT Validation

The CRM-3 module delegates identity issuance to ClearShift Hub Identity (`@cs/identity`) and enforces server-side verification using asymmetric key cryptography (EdDSA):

* **Algorithm**: EdDSA (Ed25519) asymmetric signatures.
* **Issuer (`iss`)**: Must equal `clearshift-hub`.
* **Audience (`aud`)**: Must equal `clearshift`.
* **Token Expiration (`exp`)**: Strict timestamp validation against system time.
* **Account Status**: Tokens for disabled accounts (`disabled: true` or `status: "disabled"`) are rejected immediately with HTTP `401 Unauthorized`.
* **Missing/Invalid Header**: Requests lacking an `Authorization: Bearer <token>` header or carrying malformed/tampered tokens fail closed with HTTP `401 Unauthorized`.

The Fastify authentication plugin (`crm3AuthPlugin`) registers pre-handler hooks across all `/api/v1/crm-tickets/*` routes, attaching validated `HubTokenClaims` to `request.user`.

---

## 3. Role-Based Access Control (RBAC)

CRM-3 implements exact route-level role enforcement according to the SDS Endpoint Matrix:
* `viewer`: Read-only access to support tickets and notes.
* `editor`: Full create/edit privileges on tickets and notes.
* `analyst`: Read access to tickets and notes for reporting and analytics.
* `admin`: Complete administrative privileges across all CRM-3 endpoints.
* `migration_runner`: Authorized to perform bulk ticket ingestion (`POST /tickets`).

### Endpoint Role Matrix

| Endpoint Route | HTTP Method | Allowed Roles | Prohibited Roles (HTTP 403) |
|---|---|---|---|
| `/api/v1/crm-tickets/tickets` | `GET` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` (direct query) |
| `/api/v1/crm-tickets/tickets` | `POST` | `editor`, `migration_runner`, `admin` | `viewer`, `analyst` |
| `/api/v1/crm-tickets/tickets/:id` | `GET` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `/api/v1/crm-tickets/tickets/:id` | `PATCH` | `editor`, `admin` | `viewer`, `analyst`, `migration_runner` |
| `/api/v1/crm-tickets/tickets/:id/notes` | `GET` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `/api/v1/crm-tickets/notes` | `POST` | `editor`, `admin` | `viewer`, `analyst`, `migration_runner` |
| `/api/v1/crm-tickets/tickets/:id/notes` | `POST` | `editor`, `admin` | `viewer`, `analyst`, `migration_runner` |

---

## 4. Multi-Tenant Boundary & Record Ownership Protection

* **Tenant Isolation**:
  * Verified claims (`tenant_id`, `tenantId`, or `org_id`) are compared with the `x-tenant-id` request header. Mismatches trigger an immediate HTTP `403 Forbidden` (`Multi-tenant boundary violation`).
* **Author Identity & Ownership**:
  * Ticket note author is cryptographically resolved from `request.user.sub`.
  * Attempting to append a note with an `authorId` pointing to another user triggers an HTTP `403 Forbidden` (`AUTHOR_MISMATCH`).
* **Immutable Fields Protection**:
  * Fields such as `id`, `createdAt`, `updatedAt`, `sourceSystem`, and `sourceId` cannot be mutated via PATCH requests by non-admin callers.

---

## 5. Sensitive Field Protection & Masking

Field-level protection is enforced on the server **prior to serialization and export**, ensuring that sensitive attributes cannot leak even if presentation layers are bypassed:

1. **Bank Details**:
   * Masked format: `XXXX-XXXX-7890` (preserving only the terminal 4 digits).
   * Short values (fewer than 4 digits) mask completely as `XXXX-XXXX-XXXX`.
2. **Salary Information**:
   * Numeric compensation values are masked as `XX,XXX`.
   * Unformatted or redacted values are converted to `"salary hidden"`.
3. **Credentials & Tokens**:
   * Auth tokens, passwords, bearer headers, and client secrets are stripped or replaced with `[REDACTED]` prior to logging.
4. **CSV Export Injection Defense**:
   * Cell values beginning with formula prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) are automatically escaped with a leading single quote (`'`) to prevent spreadsheet remote code execution / DDE formula injection.
5. **Log Redaction**:
   * `maskSensitiveLog()` inspects log strings and object keys to prevent accidental leakage of PII, account numbers, or authorization headers into stdout or error collectors.

---

## 6. Audit Logging Architecture

The CRM-3 module maintains an append-only audit trail via `Crm3AuditService`:

* **Recorded Events**:
  * Entity state modifications (`ticket.created`, `ticket.updated`, `note.created`).
  * Migration batch loads and receipts.
  * Privileged operations and configuration changes.
* **Event Structure**:
  * `actor`: Authenticated User ID (`sub`) or system agent.
  * `action`: Action verb matching standard taxonomy.
  * `timestamp`: ISO-8601 UTC timestamp.
  * `entity`: Entity type (`ticket`, `note`, `import_batch`).
  * `entityId`: Primary UUID of the affected entity.
  * `batchId`: Migration Batch ID (when applicable).
  * `result`: Status outcome (`success` or `failure`).
  * `diffRedacted`: Redacted property changes.
  * `metadata`: Contextual details with sensitive fields pre-redacted.
* **Safe Logging Invariant**:
  * Raw import rows, passwords, bearer tokens, full bank accounts, and raw national identifiers are never written to audit records or system logs.

---

## 7. Web Client Route Guarding

Client-side route guards in `apps/crm/modules/crm-3/web/auth/route-guard.ts` enforce SDS permissions prior to component mounting:
* Unauthenticated visitors are redirected to `/login?returnUrl=<encoded_path>`.
* Expired sessions are redirected to `/login?returnUrl=<encoded_path>&reason=expired`.
* Disabled accounts are redirected to `/login?returnUrl=<encoded_path>&reason=disabled`.
* Users lacking the required capability/roles are redirected to `/access-denied?required=<roles>`.
