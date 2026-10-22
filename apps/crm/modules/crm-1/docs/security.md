# CRM-1 Contacts, Companies and Leads: Security Architecture and Controls

## 1. Executive Summary

This specification defines the security architecture, authorization policies, sensitive data protection, and audit logging controls implemented in the **CRM-1 Contacts, Companies and Leads** module for ClearShift CRM V1.

All mechanisms strictly satisfy the **ClearShift CRM System Design Specification (SDS) v2.0 §7.1**, **Project Plan v3.0**, and the constraints of Gate G4.

---

## 2. Authentication & JWT Validation

The CRM-1 module delegates identity issuance to ClearShift Hub Identity (`@cs/identity`) and enforces server-side verification using asymmetric key cryptography (EdDSA):

* **Algorithm**: EdDSA (Ed25519) asymmetric signatures.
* **Issuer (`iss`)**: Must equal `clearshift-hub`.
* **Audience (`aud`)**: Must equal `clearshift`.
* **Token Expiration (`exp`)**: Strict timestamp validation against system time.
* **Account Status**: Tokens for disabled accounts (`disabled: true` or `status: "disabled"`) are rejected immediately with HTTP `401 Unauthorized`.
* **Missing/Invalid Header**: Requests lacking an `Authorization: Bearer <token>` header or carrying malformed/tampered tokens fail closed with HTTP `401 Unauthorized`.

The Fastify authentication plugin (`crm1AuthPlugin`) registers pre-handler hooks across all `/api/v1/crm-contacts/*` routes, attaching validated `HubTokenClaims` to `request.user`.

---

## 3. Role-Based Access Control (RBAC)

CRM-1 implements exact route-level role enforcement according to the SDS Endpoint Matrix. The allowable roles are:
* `viewer`: Read-only access to standard CRM views and import status/reject views.
* `editor`: Full create/edit privileges on business entities (contacts, companies, leads).
* `analyst`: Read access to contacts and import summaries/rejects (specifically restricted from companies and leads per SDS).
* `admin`: Complete administrative privileges across all CRM-1 endpoints.
* `migration_runner`: Dedicated service/runner role authorized to perform bulk data ingestion (`POST /imports`) and entity upserts (`POST/PATCH` on contacts, companies, leads).

### Endpoint Role Matrix

| Endpoint Route | HTTP Method | Allowed Roles | Prohibited Roles (HTTP 403) |
|---|---|---|---|
| `/api/v1/crm-contacts/contacts` | `GET` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` (direct query) |
| `/api/v1/crm-contacts/contacts` | `POST` | `editor`, `migration_runner`, `admin` | `viewer`, `analyst` |
| `/api/v1/crm-contacts/contacts/:id` | `GET` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `/api/v1/crm-contacts/contacts/:id` | `PATCH` | `editor`, `migration_runner`, `admin` | `viewer`, `analyst` |
| `/api/v1/crm-contacts/companies` | `GET` | `viewer`, `editor`, `admin` | `analyst`, `migration_runner` |
| `/api/v1/crm-contacts/companies` | `POST` | `editor`, `migration_runner`, `admin` | `viewer`, `analyst` |
| `/api/v1/crm-contacts/companies/:id` | `GET` | `viewer`, `editor`, `admin` | `analyst`, `migration_runner` |
| `/api/v1/crm-contacts/companies/:id` | `PATCH` | `editor`, `migration_runner`, `admin` | `viewer`, `analyst` |
| `/api/v1/crm-contacts/leads` | `GET` | `viewer`, `editor`, `admin` | `analyst`, `migration_runner` |
| `/api/v1/crm-contacts/leads` | `POST` | `editor`, `migration_runner`, `admin` | `viewer`, `analyst` |
| `/api/v1/crm-contacts/leads/:id` | `GET` | `viewer`, `editor`, `admin` | `analyst`, `migration_runner` |
| `/api/v1/crm-contacts/leads/:id` | `PATCH` | `editor`, `migration_runner`, `admin` | `viewer`, `analyst` |
| `/api/v1/crm-contacts/imports` | `POST` | `migration_runner`, `admin` | `viewer`, `editor`, `analyst` |
| `/api/v1/crm-contacts/imports/:batch` | `GET` | `viewer`, `analyst`, `admin` | `editor`, `migration_runner` |
| `/api/v1/crm-contacts/imports/:batch/rejects` | `GET` | `viewer`, `analyst`, `admin` | `editor`, `migration_runner` |

---

## 4. Sensitive Field Protection & Masking

Field-level protection is enforced on the server **prior to serialization and export**, ensuring that sensitive attributes cannot leak even if the user bypasses UI presentation layers.

1. **Bank Details**:
   * Masked format: `XXXX-XXXX-7890` (preserving only the terminal 4 digits).
   * Short values (fewer than 4 digits) mask completely as `XXXX`.
2. **Salary Information**:
   * Formatted numeric values are masked as `XX,XXX`.
   * Unformatted or redacted values are converted to `"salary hidden"`.
3. **Credentials & Tokens**:
   * Auth tokens, passwords, bearer headers, and client secrets are stripped or replaced with `[REDACTED]` prior to logging.
4. **CSV Export Injection Defense**:
   * Cell values beginning with formula prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) are automatically escaped with a leading single quote (`'`) to prevent spreadsheet remote code execution / DDE formula injection.
5. **Log Redaction**:
   * `maskSensitiveLog()` inspects log strings and object keys to prevent accidental leakage of PII, account numbers, or authorization headers into stdout or error collectors.

---

## 5. Audit Logging Architecture

The CRM-1 module maintains an append-only audit trail via `Crm1AuditService`:

* **Recorded Events**:
  * Entity state modifications (`contact_create`, `contact_update`, `company_create`, `company_update`, `lead_create`, `lead_update`).
  * Migration batch execution (`import_start`, `import_complete`).
  * Privileged exports and merge candidate evaluations.
* **Event Structure**:
  * `actor`: Authenticated User ID (`sub`) and role set.
  * `action`: Action verb matching standard taxonomy.
  * `timestamp`: ISO-8601 UTC timestamp.
  * `entity`: Entity type (`contact`, `company`, `lead`, `import_batch`).
  * `entityId`: Primary UUID of the affected entity.
  * `correlationId`: HTTP Request correlation ID or Migration Batch ID.
  * `result`: Status outcome (`success` or `failure`).
  * `metadata`: Contextual details with sensitive fields pre-redacted.
* **Safe Logging Invariant**:
  * Raw import rows, passwords, bearer tokens, full bank accounts, and raw national identifiers are never written to audit records or system logs.

---

## 6. Web Client Route Guarding

Client-side route guards in `apps/crm/modules/crm-1/web/auth/route-guard.ts` enforce the SDS permissions prior to component mounting:

* **Unauthenticated User**: Automatically redirected to `/login?returnUrl=<target>`.
* **Expired Token**: Automatically redirected to `/login?returnUrl=<target>`.
* **Disabled User**: Denied access and redirected to `/login?error=account_disabled`.
* **Insufficient Role**: Denied access and redirected to `/access-denied?required=<roles>`.

Server-side route enforcement remains the authoritative boundary; client-side guards provide seamless UX feedback.

---

## 7. Synthetic Data Constraint

In strict compliance with ClearShift Core Rules:
* All development, testing, and demonstration data consists solely of 100% synthetic fixtures.
* Real customer, employee, or corporate data is strictly prohibited.
* No credentials, `.env` files, or production secrets may ever be committed to the repository.
